import {Injectable} from '@angular/core';
import {AppService, LoggerLevel} from './app.service';
import {environment} from '../../environments/environment';
import {FileService} from './file.service';
import {Workspace} from '../models/workspace';
import {serialize} from 'class-transformer';
import {KeychainService} from './keychain.service';
import {AwsIamRoleFederatedSession} from '../models/aws-iam-role-federated-session';
import {AwsIamRoleChainedSession} from '../models/aws-iam-role-chained-session';
import {AwsIamUserSession} from '../models/aws-iam-user-session';
import {AwsSsoRoleSession} from '../models/aws-sso-role-session';
import {AzureSession} from '../models/azure-session';
import {WorkspaceService} from './workspace.service';
import {SessionType} from '../models/session-type';
import {DaemonService} from '../daemon/services/daemon.service';
import {DaemonUrls} from '../daemon/routes';
import {IamUserCreateRequestDto} from '../daemon/dtos/iam-user-create-request-dto';
import {Session} from '../models/session';
import {AwsNamedProfileCreateRequestDto} from "../daemon/dtos/aws-named-profile-create-request-dto";

@Injectable({
  providedIn: 'root'
})
export class RetrocompatibilityService {

  constructor(
    private appService: AppService,
    private fileService: FileService,
    private keychainService: KeychainService,
    private workspaceService: WorkspaceService,
    private daemonService: DaemonService
  ) { }

  static adaptIdpUrls(oldWorkspace: any, workspace: Workspace) {
    workspace.idpUrls = oldWorkspace.workspaces[0].idpUrl;
  }

  isRetroPatchNecessary(): boolean {
    if (this.fileService.exists(this.appService.getOS().homedir() + '/' + environment.lockFileDestination)) {
      const workspaceParsed = this.parseWorkspaceFile();
      // use a never more used property to check if workspace has changed to new version
      return workspaceParsed.defaultWorkspace === 'default';
    }
    return false;
  }

  isMigrationPathNecessary() {
    let sessionsToMigrate = this.workspaceService.sessions.filter(sess => sess.type === SessionType.awsIamUser);
    let namedProfiles = this.workspaceService.get().profiles;

    if (!sessionsToMigrate) {
      sessionsToMigrate = [];
    }
    if (!namedProfiles) {
      namedProfiles = [];
    }

    return sessionsToMigrate.length > 0 || namedProfiles.length > 0;
  }

  async adaptOldWorkspaceFile(): Promise<Workspace> {
    (this.workspaceService as any).workspace = undefined;

    // We need to adapt Sessions, IdpUrls, AwsSso Config, Proxy Config
    const workspace = new Workspace();
    const oldWorkspace = this.parseWorkspaceFile();

    // if there are no session, remove it, is useless, and let Leapp generate a fresh one
    if (oldWorkspace.workspaces.length === 0 || oldWorkspace.workspaces[0].sessions.length === 0) {
      // Just persist a fresh workspace data
      this.persists(workspace);
    } else {
      // Adapt data structure
      RetrocompatibilityService.adaptIdpUrls(oldWorkspace, workspace);
      this.adaptProxyConfig(oldWorkspace, workspace);
      this.adaptGeneralProperties(oldWorkspace, workspace);
      await this.adaptAwsSsoConfig(oldWorkspace, workspace);
      await this.adaptSessions(oldWorkspace, workspace);

      // Persist adapted workspace data
      this.persists(workspace);
      // Apply sessions to behaviour subject
      this.workspaceService.sessions = workspace.sessions;

      return workspace;
    }
  }

  async migrateDataToDaemon() {
    const sessionsToMigrate = this.workspaceService.sessions.filter(sess => sess.type === SessionType.awsIamUser);
    const otherSessions = this.workspaceService.sessions.filter(sess => sess.type !== SessionType.awsIamUser);
    const namedProfilesToMigrate = this.workspaceService.get().profiles;

    for(let i = 0; i < namedProfilesToMigrate.length; i++) {
      await this.migrateNamedProfile(namedProfilesToMigrate[i]);
    }

    for(let i = 0; i < sessionsToMigrate.length; i++) {
      await this.migrateAwsIamUserSession(sessionsToMigrate[i]);
    }

    for(let i = 0; i < otherSessions.length; i++) {
      await this.updateNamedProfiles(otherSessions[i]);
    }

    this.workspaceService.sessions = [...this.workspaceService.sessions.filter(sess => sess.type !== SessionType.awsIamUser)];
    this.workspaceService.removeAllProfiles();
    this.appService.logger('migrated all data to daemon.', LoggerLevel.info, this, null);
  }

  private async migrateAwsIamUserSession(sess: Session) {
    const awsAccessKeyId = this.keychainService.getSecret(environment.appName, `${sess.sessionId}-iam-user-aws-session-access-key-id`);
    const awsSecretAccessKey = this.keychainService.getSecret(environment.appName, `${sess.sessionId}-iam-user-aws-session-secret-access-key`);

    const namedProfilesToMigrate = this.workspaceService.get().profiles;
    namedProfilesToMigrate.forEach(profile => {
      if (profile.id === (sess as AwsIamUserSession).profileId) {
        const name = profile.name;
        this.workspaceService.getProfileId(name).then(newProfileId => {
          this.daemonService.callDaemon(DaemonUrls.createIamUser, new IamUserCreateRequestDto(sess.sessionName, sess.region, (sess as AwsIamUserSession).mfaDevice, newProfileId, awsAccessKeyId, awsSecretAccessKey), 'POST');
        });
      }
    });
  }

  private parseWorkspaceFile(): any {
    const workspaceJSON = this.fileService.decryptText(
      this.fileService.readFileSync(this.appService.getOS().homedir() + '/' + environment.lockFileDestination)
    );
    return JSON.parse(workspaceJSON);
  }

  private persists(workspace: Workspace): void {
    // this.appService.getFs().unlinkSync(this.appService.getOS().homedir() + '/' + environment.lockFileDestination);
    this.fileService.writeFileSync(
      this.appService.getOS().homedir() + '/' + environment.lockFileDestination,
      this.fileService.encryptText(serialize(workspace))
    );
  }

  private async adaptSessions(oldWorkspace: any, workspace: Workspace): Promise<void> {
    // Loop through sessions and generate data
    for(let i = 0; i < oldWorkspace.workspaces[0].sessions.length; i++) {
      const session = oldWorkspace.workspaces[0].sessions[i];
      // Get session type
      const sessionType = session.account.type;
      switch (sessionType) {
        case 'AWS': this.createNewAwsFederatedOrIamRoleChainedSession(session, workspace); break;
        case 'AWS_TRUSTER': this.createNewAwsFederatedOrIamRoleChainedSession(session, workspace); break;
        case 'AWS_PLAIN_USER': await this.createNewAwsIamUserSession(session, workspace); break;
        case 'AWS_SSO': this.createNewAwsSingleSignOnSession(session, workspace); break;
        case 'AZURE': this.createNewAzureSession(session, workspace); break;
      }
    }
  }



  private async adaptAwsSsoConfig(oldWorkspace: any, workspace: Workspace): Promise<void> {
    // check if we have at least one SSO session
    // otherwise standard generated properties are just fine
    for(let i = 0; i < oldWorkspace.workspaces[0].sessions.length; i++) {
      const session = oldWorkspace.workspaces[0].sessions[i];
      // We have changed the enum type so we must check it manually
      if (session.account.type === 'AWS_SSO') {
        // OK, let's check if we have data saved in the keychain
        let region;
        let portalUrl;
        let expirationTime;
        try {
          region = await this.keychainService.getSecret(environment.appName, 'AWS_SSO_REGION');
          portalUrl = await this.keychainService.getSecret(environment.appName, 'AWS_SSO_PORTAL_URL');
          expirationTime = await this.keychainService.getSecret(environment.appName, 'AWS_SSO_EXPIRATION_TIME');
        } catch(err) {
          // we need all or nothing, otherwise it means that configuration is incomplete so its better
          // to force the user to redo the process on the new fresh workspace
        }

        workspace.awsSsoConfiguration = {
          region,
          portalUrl,
          expirationTime
        };
        break;
      }
    }
  }

  private adaptProxyConfig(oldWorkspace: any, workspace: Workspace) {
    workspace.proxyConfiguration = oldWorkspace.workspaces[0].proxyConfiguration;
  }

  private adaptGeneralProperties(oldWorkspace: any, workspace: Workspace) {
    workspace.defaultRegion   = oldWorkspace.workspaces[0].defaultRegion;
    workspace.defaultLocation = oldWorkspace.workspaces[0].defaultLocation;
  }

  private createNewAwsFederatedOrIamRoleChainedSession(session: any, workspace: Workspace) {
    if(!session.account.parent) {
      // Federated
      const federatedSession = new AwsIamRoleFederatedSession(
        session.account.accountName,
        session.account.region,
        session.account.idpUrl,
        session.account.idpArn,
        session.account.role.roleArn,
        workspace.profiles[0].id
      );
      federatedSession.sessionId = session.id;

      workspace.sessions.push(federatedSession);
    } else {
      // IamRoleChained
      const iamRoleChainedSession = new AwsIamRoleChainedSession(
        session.account.accountName,
        session.account.region,
        session.account.role.roleArn,
        workspace.profiles[0].id,
        session.account.parent
      );
      iamRoleChainedSession.sessionId = session.id;

      workspace.sessions.push(iamRoleChainedSession);
    }
  }

  private async createNewAwsIamUserSession(session: any, workspace: Workspace) {
    const iamUserSession = new AwsIamUserSession(
      session.account.accountName,
      session.account.region,
      workspace.profiles[0].id,
      session.account.mfaDevice
    );
    iamUserSession.sessionId = session.id;

    const accessKey = await this.keychainService.getSecret(
      environment.appName, `${session.account.accountName}___${session.account.user}___accessKey`);

    const secretKey = await this.keychainService.getSecret(
      environment.appName, `${session.account.accountName}___${session.account.user}___secretKey`);

    this.keychainService.saveSecret(environment.appName, `${session.id}-iam-user-aws-session-access-key-id`, accessKey);
    this.keychainService.saveSecret(environment.appName, `${session.id}-iam-user-aws-session-secret-access-key`, secretKey);

    workspace.sessions.push(iamUserSession);
  }

  private createNewAwsSingleSignOnSession(session: any, workspace: Workspace) {
    const ssoSession = new AwsSsoRoleSession(
      session.account.accountName,
      session.account.region,
      `arn:aws:iam::${session.account.accountNumber}:role/${session.account.role.name}`,
      workspace.profiles[0].id,
      session.account.email
    );
    ssoSession.sessionId = session.id;

    workspace.sessions.push(ssoSession);
  }

  private createNewAzureSession(session: any, workspace: Workspace) {
    const azureSession = new AzureSession(
      session.account.accountName,
      session.account.region,
      session.account.subscriptionId,
      session.account.tenantId
    );
    azureSession.sessionId = session.id;
    workspace.sessions.push(azureSession);
  }


  private async migrateNamedProfile(namedProfilesToMigrateElement: { id: string; name: string }) {
    try {
      await this.daemonService.callDaemon(DaemonUrls.createAwsNamedProfile, new AwsNamedProfileCreateRequestDto(namedProfilesToMigrateElement.name), 'POST');
    } catch (err) {}
  }

  private async updateNamedProfiles(session: Session) {
    const namedProfilesToMigrate = this.workspaceService.get().profiles;
    namedProfilesToMigrate.forEach(profile => {
      if (profile.id === (session as AwsIamUserSession).profileId) {
        const name = profile.name;
        this.workspaceService.getProfileId(name).then(newProfileId => {
          // Update profile Id
          (session as AwsIamUserSession).profileId = newProfileId;
        });
      }
    });
  }
}
