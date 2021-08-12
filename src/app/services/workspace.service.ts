import {Injectable} from '@angular/core';
import {FileService} from './file.service';
import {AppService} from './app.service';
import {Session} from '../models/session';
import {Workspace} from '../models/workspace';
import {environment} from '../../environments/environment';
import {deserialize, serialize} from 'class-transformer';
import {NativeService} from './native-service';
import {BehaviorSubject, Observable} from 'rxjs';
import {SessionType} from "../models/session-type";
import {DaemonService} from "../daemon/services/daemon.service";
import {DaemonUrls} from "../daemon/routes";
import {EmptyDto} from "../daemon/dtos/empty-dto";
import {DaemonDataMapperService} from "../daemon/services/daemon-data-mapper.service";
import {AwsNamedProfileCreateRequestDto} from "../daemon/dtos/aws-named-profile-create-request-dto";
import {AwsNamedProfileEditRequestDto} from "../daemon/dtos/aws-named-profile-edit-request-dto";
import {AwsNamedProfileDeleteRequestDto} from "../daemon/dtos/aws-named-profile-delete-request-dto";

@Injectable({
  providedIn: 'root'
})
export class WorkspaceService extends NativeService {


  // Expose the observable$ part of the _sessions subject (read only stream)
  readonly sessions$: Observable<Session[]>;

  // - We set the initial state in BehaviorSubject's constructor
  // - Nobody outside the Store should have access to the BehaviorSubject
  //   because it has the write rights
  // - Writing to state should be handled by specialized Store methods
  // - Create one BehaviorSubject per store entity, for example if you have
  //   create a new BehaviorSubject for it, as well as the observable$, and getters/setters
  private readonly _sessions;

  // Private singleton workspace
  private _workspace: Workspace;

  constructor(
    private appService: AppService,
    private fileService: FileService,
    private daemonService: DaemonService,
    private daemonDataMapperService: DaemonDataMapperService
  ) {
    super();

    this._sessions = new BehaviorSubject<Session[]>([]);
    this.sessions$ = this._sessions.asObservable();

    this.create();
    // TODO: check if it is possible to call directly this._sessions.next(this.getPersistedSessions())
    this.getPersistedSessions().then(sessions => {
      this.sessions = sessions;
    });
  }

  get workspace(): Workspace {
    return this._workspace;
  }

  set workspace(value: Workspace) {
    this._workspace = value;
  }

  // the getter will return the last value emitted in _sessions subject
  get sessions(): Session[] {
    return this._sessions.getValue();
  }

  // assigning a value to this.sessions will push it onto the observable
  // and down to all of its subscribers (ex: this.sessions = [])
  set sessions(sessions: Session[]) {
    this.updatePersistedSessions(sessions);
    this._sessions.next(sessions);
  }

  create(): void {
    if (!this.fileService.exists(this.appService.getOS().homedir() + '/' + environment.lockFileDestination)) {
      this.fileService.newDir(this.appService.getOS().homedir() + '/.Leapp', { recursive: true});
      this._workspace = new Workspace();
      this.persist(this._workspace);
    }
  }

  get(): Workspace {
    if(!this._workspace) {
      const workspaceJSON = this.fileService.decryptText(this.fileService.readFileSync(this.appService.getOS().homedir() + '/' + environment.lockFileDestination));
      this._workspace = deserialize(Workspace, workspaceJSON);
      return this._workspace;
    }
    return this._workspace;
  }

  addSession(session: Session) {
    // we assign a new copy of session by adding a new session to it
    this.sessions = [
      ...this.sessions,
      session
    ];
  }

  removeSession(sessionId: string) {
    this.sessions = this.sessions.filter(session => session.sessionId !== sessionId);
  }

  updateDefaultRegion(defaultRegion: string) {
    const workspace = this.get();
    workspace.defaultRegion = defaultRegion;
    this.persist(workspace);
  }

  updateDefaultLocation(defaultLocation: string) {
    const workspace = this.get();
    workspace.defaultLocation = defaultLocation;
    this.persist(workspace);
  }

  getIdpUrl(idpUrlId: string): string {
    const workspace = this.get();
    const idpUrlFiltered = workspace.idpUrls.find(url => url.id === idpUrlId);
    return idpUrlFiltered ? idpUrlFiltered.url : null;
  }

  addIdpUrl(idpUrl: { id: string; url: string }): void {
    const workspace = this.get();
    workspace.idpUrls.push(idpUrl);
    this.persist(workspace);
  }

  updateIdpUrl(id: string, url: string) {
    const workspace = this.get();
    const index = workspace.idpUrls.findIndex(u => u.id === id);
    if(index > -1) {
      workspace.idpUrls[index].url = url;
      this.persist(workspace);
    }
  }

  removeIdpUrl(id: string) {
    const workspace = this.get();
    const index = workspace.idpUrls.findIndex(u => u.id === id);

    workspace.idpUrls.splice(index, 1);

    this.persist(workspace);
  }

  async getProfiles(): Promise<any[]> {
    return (await this.daemonService.callDaemon(DaemonUrls.listAwsNamedProfiles, new EmptyDto(), 'GET')).data;
  }

  async getProfileName(profileId): Promise<string> {
    const profiles = await this.getProfiles();
    const profileFiltered = profiles.find(profile => profile.Id === profileId);
    return profileFiltered ? profileFiltered.Name : null;
  }

  async getProfileId(name: string): Promise<string> {
    const profiles = await this.getProfiles();
    const profileFiltered = profiles.find(profile => profile.Name === name);
    return profileFiltered ? profileFiltered.Id : null;
  }

  async getDefaultProfileId(): Promise<string> {
    const profiles = await this.getProfiles();
    const profileFiltered = profiles.find(profile => profile.Name === 'default');
    return profileFiltered.id;
  }

  addProfile(name: string): void {
    this.daemonService.callDaemon(DaemonUrls.createAwsNamedProfile, new AwsNamedProfileCreateRequestDto(name), 'POST');
  }

  async updateProfile(id: string, name: string) {
    const profiles = await this.getProfiles();
    const profileIndex = profiles.findIndex(p => p.Id === id);
    if(profileIndex > -1) {
      this.daemonService.callDaemon(DaemonUrls.editAwsNamedProfile, new AwsNamedProfileEditRequestDto(id, name), 'PATCH');
    }
  }

  async removeProfile(id: string) {
    const profiles = await this.getProfiles();
    const profileIndex = profiles.findIndex(p => p.id === id);
    if(profileIndex > -1) {
      this.daemonService.callDaemon(DaemonUrls.deleteAwsNamedProfile, new AwsNamedProfileDeleteRequestDto(id), 'DELETE');
    }
  }

  configureAwsSso(region: string, portalUrl: string, expirationTime: string): void {
    const workspace = this.get();
    workspace.awsSsoConfiguration.region = region;
    workspace.awsSsoConfiguration.portalUrl = portalUrl;
    workspace.awsSsoConfiguration.expirationTime = expirationTime;
    this.persist(workspace);
  }

  removeExpirationTimeFromAwsSsoConfiguration(): void {
    const workspace = this.get();
    workspace.awsSsoConfiguration.expirationTime = undefined;
    this.persist(workspace);
  }

  getAwsSsoConfiguration(): {region: string; portalUrl: string; expirationTime: string} {
    return this.get().awsSsoConfiguration;
  }

  updateProxyConfiguration(proxyConfiguration: { proxyProtocol: string; proxyUrl: string; proxyPort: string; username: string; password: string }) {
    const workspace = this.get();
    workspace.proxyConfiguration = proxyConfiguration;
    this.persist(workspace);
  }

  async getPersistedSessions(): Promise<Session[]> {
    const workspace = this.get();

    // add daemon managed sessions
    let awsIamUserSessions = await this.daemonService.callDaemon(DaemonUrls.listAwsIamUserSessions, new EmptyDto(), 'GET');
    awsIamUserSessions = this.daemonDataMapperService.map(awsIamUserSessions.data, SessionType.awsIamUser);

    // Concat with all others
    return workspace.sessions.concat(awsIamUserSessions);
  }

  private persist(workspace: Workspace) {
    const path = this.appService.getOS().homedir() + '/' + environment.lockFileDestination;
    this.fileService.writeFileSync(path, this.fileService.encryptText(serialize(workspace)));
  }

  private updatePersistedSessions(sessions: Session[]): void {
    const workspace = this.get();
    workspace.sessions = sessions.filter(s => s.type !== SessionType.awsIamUser);
    this.persist(workspace);
  }


}
