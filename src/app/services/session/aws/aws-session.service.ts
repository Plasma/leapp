import {Injectable} from '@angular/core';
import {Session} from '../../../models/session';
import {WorkspaceService} from '../../workspace.service';
import {CredentialsInfo} from '../../../models/credentials-info';
import {SessionType} from '../../../models/session-type';
import {SessionStatus} from '../../../models/session-status';
import {AwsIamRoleChainedSession} from '../../../models/aws-iam-role-chained-session';
import {SessionService} from '../../session.service';

@Injectable({
  providedIn: 'root'
})
export abstract class AwsSessionService extends SessionService {

  /* This service manage the session manipulation as we need top generate credentials and maintain them for a specific duration */
  protected constructor(protected workspaceService: WorkspaceService) {
    super(workspaceService);
  }

  // TODO: are they assumable (maybe assumer) or generic AWS sessions?
  async listAssumable(): Promise<Session[]> {
    return ((await this.list()).length > 0) ? (await this.list()).filter( (session) => session.type !== SessionType.azure ) : [];
  }

  async listIamRoleChained(parentSession?: Session): Promise<Session[]> {
    let childSession = ((await this.list()).length > 0) ? (await this.list()).filter( (session) => session.type === SessionType.awsIamRoleChained ) : [];
    if (parentSession) {
      childSession = childSession.filter(session => (session as AwsIamRoleChainedSession).parentSessionId === parentSession.sessionId );
    }
    return childSession;
  }

  async listAwsSsoRoles() {
    return ((await this.list()).length > 0) ? (await this.list()).filter((session) => session.type === SessionType.awsSsoRole) : [];
  }

  async start(sessionId: string): Promise<void> {
    try {
      this.stopAllWithSameNameProfile(sessionId);
      this.sessionLoading(sessionId);
      const credentialsInfo = await this.generateCredentials(sessionId);
      await this.applyCredentials(sessionId, credentialsInfo);
      this.sessionActivate(sessionId);
    } catch (error) {
      this.sessionError(sessionId, error);
    }
  }

  async rotate(sessionId: string): Promise<void> {
    try {
      this.sessionLoading(sessionId);
      const credentialsInfo = await this.generateCredentials(sessionId);
      await this.applyCredentials(sessionId, credentialsInfo);
      this.sessionRotated(sessionId);
    } catch (error) {
      this.sessionError(sessionId, error);
    }
  }

  async stop(sessionId: string): Promise<void> {
    try {
      await this.deApplyCredentials(sessionId);
      this.sessionDeactivated(sessionId);
    } catch (error) {
      this.sessionError(sessionId, error);
    }
  }

  async delete(sessionId: string): Promise<void> {
    try {
      if ((await this.get(sessionId)).status === SessionStatus.active) {
        await this.stop(sessionId);
      }
      (await this.listIamRoleChained(await this.get(sessionId))).forEach(sess => {
        if (sess.status === SessionStatus.active) {
          this.stop(sess.sessionId);
        }
        this.workspaceService.removeSession(sess.sessionId);
      });
      this.workspaceService.removeSession(sessionId);
    } catch(error) {
      this.sessionError(sessionId, error);
    }
  }

  async stopAllWithSameNameProfile(sessionId: string) {
    // Get profile to check
    const session = await this.get(sessionId);
    const profileId = (session as any).profileId;

    // Get all active sessions
    const activeSessions = await this.listActive();

    // Stop all that shares the same profile
    activeSessions.forEach(sess => {
      if( (sess as any).profileId === profileId ) {
        // Note: we changed stop with deactivated to accomodate the fact that now we extends this class also by the aws iam user service
        // which calls the daemon with stop: that means that if we were to check against same profile and call stop being in that instance
        // of Aws Session Service we would have called the daemon with a session not existing in the backend configuration leading to an error.
        this.sessionDeactivated(sess.sessionId);
      }
    });
  }

  abstract generateCredentials(sessionId: string): Promise<CredentialsInfo>;
  abstract applyCredentials(sessionId: string, credentialsInfo: CredentialsInfo): Promise<void>;
  abstract deApplyCredentials(sessionId: string): Promise<void>;
}
