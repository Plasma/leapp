import {Injectable} from '@angular/core';
import {CredentialsInfo} from '../../../../models/credentials-info';
import {WorkspaceService} from '../../../workspace.service';
import {AwsIamUserSession} from '../../../../models/aws-iam-user-session';
import {KeychainService} from '../../../keychain.service';
import {Session} from '../../../../models/session';
import {AppService, LoggerLevel} from '../../../app.service';
import {FileService} from '../../../file.service';
import {LeappBaseError} from '../../../../errors/leapp-base-error';
import {SessionStatus} from '../../../../models/session-status';
import {AwsSessionService} from '../aws-session.service';
import {DaemonService} from '../../../../daemon/services/daemon.service';
import {IamUserCreateRequestDto} from '../../../../daemon/dtos/iam-user-create-request-dto';
import {StartIamUserSessionRequestDto} from '../../../../daemon/dtos/start-iam-user-session-request-dto';
import {StopIamUserSessionRequestDto} from '../../../../daemon/dtos/stop-iam-user-session-request-dto';
import {DeleteIamUserRequestDto} from '../../../../daemon/dtos/delete-iam-user-request-dto';
import {DaemonUrls} from '../../../../daemon/routes';
import {IamUserEditRequestDto} from '../../../../daemon/dtos/iam-user-edit-request-dto';

export interface AwsIamUserSessionRequest {
  accountName: string;
  accessKey: string;
  secretKey: string;
  region: string;
  mfaDevice?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AwsIamUserService extends AwsSessionService {

  constructor(
    protected workspaceService: WorkspaceService,
    private keychainService: KeychainService,
    private appService: AppService,
    private fileService: FileService,
    private daemonService: DaemonService) {
    super(workspaceService);
  }

  async start(sessionId: string): Promise<void> {
    try {
      // this.sessionLoading(sessionId);
      await this.daemonService.callDaemon(DaemonUrls.startIamUserSession, new StartIamUserSessionRequestDto(sessionId), 'POST');
      // this.sessionActivate(sessionId);
    } catch (error) {
      this.sessionError(sessionId, error);
    }
  }

  async rotate(sessionId: string): Promise<void> {
    return;
  }

  async stop(sessionId: string): Promise<void> {
    try {
      await this.daemonService.callDaemon(DaemonUrls.stopIamUserSession, new StopIamUserSessionRequestDto(sessionId), 'POST');

      // this.sessionDeactivated(sessionId);
      return;
    } catch (error) {
      this.sessionError(sessionId, error);
    }
  }

  async create(accountRequest: AwsIamUserSessionRequest, profileId: string): Promise<void> {
    const iamUserCreateDto = new IamUserCreateRequestDto(
      accountRequest.accountName,
      accountRequest.region,
      accountRequest.mfaDevice,
      profileId,
      accountRequest.accessKey,
      accountRequest.secretKey
    );

    try {
      const response = await this.daemonService.callDaemon(DaemonUrls.createIamUser, iamUserCreateDto, 'POST');
      // Temporary save also on local workspace
      const session = new AwsIamUserSession(accountRequest.accountName, accountRequest.region, profileId, accountRequest.mfaDevice);
      session.sessionId = response.data;

      console.log(session);

      this.workspaceService.addSession(session);
    } catch (err) {
      throw new LeappBaseError('Daemon Error', this, LoggerLevel.warn, err.message);
    }
  }

  async update(sessionId: string, session: Session, accessKey?: string, secretKey?: string) {
    const sessions = this.list();
    const index = sessions.findIndex(sess => sess.sessionId === sessionId);

    if(index > -1) {
      try {
        const iamUserEditDto = new IamUserEditRequestDto(
          sessionId,
          (session as AwsIamUserSession).sessionName,
          (session as AwsIamUserSession).region,
          (session as AwsIamUserSession).mfaDevice,
          (session as AwsIamUserSession).profileId,
          accessKey,
          secretKey
        );

        await this.daemonService.callDaemon(DaemonUrls.editIamUser, iamUserEditDto, 'PUT');

        this.workspaceService.sessions[index] = session;
        this.workspaceService.sessions = [...this.workspaceService.sessions];
        return;
      } catch (error) {
        this.sessionError(sessionId, error);
      }
    }
  }

  async delete(sessionId: string): Promise<void> {
    try {
      if (this.get(sessionId).status === SessionStatus.active) {
        await this.stop(sessionId);
      }
      this.listIamRoleChained(this.get(sessionId)).forEach(sess => {
        if (sess.status === SessionStatus.active) {
          this.stop(sess.sessionId);
        }

        this.daemonService.callDaemon(DaemonUrls.deleteIamUser, new DeleteIamUserRequestDto(sess.sessionId), 'DELETE');
        this.workspaceService.removeSession(sess.sessionId);
      });

      await this.daemonService.callDaemon(DaemonUrls.deleteIamUser, new DeleteIamUserRequestDto(sessionId), 'DELETE');
      this.workspaceService.removeSession(sessionId);

    } catch(error) {
      this.sessionError(sessionId, error);
    }
  }

  applyCredentials(sessionId: string, credentialsInfo: CredentialsInfo): Promise<void> {
    return Promise.resolve(undefined);
  }

  deApplyCredentials(sessionId: string): Promise<void> {
    return Promise.resolve(undefined);
  }

  generateCredentials(sessionId: string): Promise<CredentialsInfo> {
    return Promise.resolve(undefined);
  }
}
