import {Injectable} from '@angular/core';
import {NativeService} from './native-service';
import {SessionStatus} from '../models/session-status';
import {Session} from '../models/session';
import {WorkspaceService} from './workspace.service';

@Injectable({
  providedIn: 'root'
})
export abstract class SessionService extends NativeService {

  protected constructor(protected workspaceService: WorkspaceService) {
    super();
  }

  async get(sessionId: string): Promise<Session> {

    const sessionFiltered = (await this.list()).find(session => session.sessionId === sessionId);
    return sessionFiltered ? sessionFiltered : null;
  }

  async list(): Promise<Session[]> {
    return await this.workspaceService.getPersistedSessions();
  }

  async listActive(): Promise<Session[]> {
    return ((await this.list()).length > 0) ? (await this.list()).filter( (session) => session.status === SessionStatus.active ) : [];
  }

  async update(sessionId: string, session: Session) {
    const sessions = (await this.list());
    const index = sessions.findIndex(sess => sess.sessionId === sessionId);
    if(index > -1) {
      this.workspaceService.sessions[index] = session;
      this.workspaceService.sessions = [...this.workspaceService.sessions];
    }
  }

  protected sessionActivate(sessionId: string) {
    const index = this.workspaceService.sessions.findIndex(s => s.sessionId === sessionId);
    if (index > -1) {
      const currentSession: Session = this.workspaceService.sessions[index];
      currentSession.status = SessionStatus.active;
      currentSession.startDateTime = new Date().toISOString();
      this.workspaceService.sessions[index] = currentSession;
      this.workspaceService.sessions = [...this.workspaceService.sessions];
    }
  }

  protected sessionLoading(sessionId: string) {
    const session = this.workspaceService.sessions.find(s => s.sessionId === sessionId);
    if (session) {
      const index = this.workspaceService.sessions.indexOf(session);
      const currentSession: Session = this.workspaceService.sessions[index];
      currentSession.status = SessionStatus.pending;
      this.workspaceService.sessions[index] = currentSession;
      this.workspaceService.sessions = [...this.workspaceService.sessions];
    }
  }

  protected sessionRotated(sessionId: string) {
    const session = this.workspaceService.sessions.find(s => s.sessionId === sessionId);
    if (session) {
      const index = this.workspaceService.sessions.indexOf(session);
      const currentSession: Session = this.workspaceService.sessions[index];
      currentSession.startDateTime = new Date().toISOString();
      currentSession.status = SessionStatus.active;
      this.workspaceService.sessions[index] = currentSession;
      this.workspaceService.sessions = [...this.workspaceService.sessions];
    }
  }

  protected sessionDeactivated(sessionId: string) {
    const session = this.workspaceService.sessions.find(s => s.sessionId === sessionId);
    if (session) {
      const index = this.workspaceService.sessions.indexOf(session);
      const currentSession: Session = this.workspaceService.sessions[index];
      currentSession.status = SessionStatus.inactive;
      currentSession.startDateTime = undefined;
      this.workspaceService.sessions[index] = currentSession;
      this.workspaceService.sessions = [...this.workspaceService.sessions];
    }
  }

  protected sessionError(sessionId: string, error: any) {
    this.sessionDeactivated(sessionId);
    throw error;
  }

  abstract start(sessionId: string): Promise<void>;

  abstract rotate(sessionId: string): Promise<void>;

  abstract stop(sessionId: string): Promise<void>;

  abstract delete(sessionId: string): Promise<void>;
}
