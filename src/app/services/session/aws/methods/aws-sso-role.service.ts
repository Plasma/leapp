import {Injectable} from '@angular/core';
import {AwsSessionService} from '../aws-session.service';
import {WorkspaceService} from '../../../workspace.service';
import {CredentialsInfo} from '../../../../models/credentials-info';

import {AwsSsoRoleSession} from '../../../../models/aws-sso-role-session';
import {FileService} from '../../../file.service';
import {AppService} from '../../../app.service';

import SSO, {
  AccountInfo,
  GetRoleCredentialsRequest,
  GetRoleCredentialsResponse,
  ListAccountRolesRequest,
  ListAccountsRequest,
  LogoutRequest,
  RoleInfo
} from 'aws-sdk/clients/sso';

import {environment} from '../../../../../environments/environment';

import SSOOIDC, {
  CreateTokenRequest,
  RegisterClientRequest,
  StartDeviceAuthorizationRequest
} from 'aws-sdk/clients/ssooidc';

import {KeychainService} from '../../../keychain.service';
import {SessionType} from '../../../../models/session-type';

export interface AwsSsoRoleSessionRequest {
  sessionName: string;
  region: string;
  email: string;
  roleArn: string;
}

export interface GenerateSSOTokenResponse {
  accessToken: string;
  expirationTime: Date;
}

export interface LoginResponse {
  accessToken: string;
  region: string;
  expirationTime: Date;
  portalUrlUnrolled: string;
}

export interface RegisterClientResponse {
  clientId?: string;
  clientSecret?: string;
  clientIdIssuedAt?: number;
  clientSecretExpiresAt?: number;
}

export interface StartDeviceAuthorizationResponse {
  deviceCode?: string;
  expiresIn?: number;
  interval?: number;
  userCode?: string;
  verificationUri?: string;
  verificationUriComplete?: string;
}

export interface VerificationResponse {
  clientId: string;
  clientSecret: string;
  deviceCode: string;
}

export interface SsoRoleSession {
  sessionName: string;
  roleArn: string;
  email: string;
  region: string;
  profileId: string;
}

@Injectable({
  providedIn: 'root'
})
export class AwsSsoRoleService extends AwsSessionService {

  private ssoPortal: SSO;
  private ssoOidc: SSOOIDC;
  private ssoWindow: any;

  constructor(
    protected workspaceService: WorkspaceService,
    private fileService: FileService,
    private appService: AppService,
    private keychainService: KeychainService
  ) {
    super(workspaceService);
  }

  static getProtocol(aliasedUrl: string): string {
    let protocol = aliasedUrl.split('://')[0];
    if (protocol.indexOf('http') === -1) {
      protocol = 'https';
    }
    return protocol;
  }

  static sessionTokenFromGetSessionTokenResponse(getRoleCredentialResponse: SSO.GetRoleCredentialsResponse): { sessionToken: any } {
    return {
      sessionToken: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        aws_access_key_id: getRoleCredentialResponse.roleCredentials.accessKeyId.trim(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        aws_secret_access_key: getRoleCredentialResponse.roleCredentials.secretAccessKey.trim(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        aws_session_token: getRoleCredentialResponse.roleCredentials.sessionToken.trim(),
      }
    };
  }

  create(accountRequest: AwsSsoRoleSessionRequest, profileId: string): void {
    const session = new AwsSsoRoleSession(accountRequest.sessionName, accountRequest.region, accountRequest.roleArn, profileId, accountRequest.email);
    this.workspaceService.addSession(session);
  }

  async applyCredentials(sessionId: string, credentialsInfo: CredentialsInfo): Promise<void> {
    const session = await this.get(sessionId);
    const profileName = await this.workspaceService.getProfileName((session as AwsSsoRoleSession).profileId);
    const credentialObject = {};
    credentialObject[profileName] = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      aws_access_key_id: credentialsInfo.sessionToken.aws_access_key_id,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      aws_secret_access_key: credentialsInfo.sessionToken.aws_secret_access_key,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      aws_session_token: credentialsInfo.sessionToken.aws_session_token,
      region: session.region
    };
    return await this.fileService.iniWriteSync(this.appService.awsCredentialPath(), credentialObject);
  }

  async deApplyCredentials(sessionId: string): Promise<void> {
    const session = await this.get(sessionId);
    const profileName = await this.workspaceService.getProfileName((session as AwsSsoRoleSession).profileId);
    const credentialsFile = await this.fileService.iniParseSync(this.appService.awsCredentialPath());
    delete credentialsFile[profileName];
    return await this.fileService.replaceWriteSync(this.appService.awsCredentialPath(), credentialsFile);
  }

  async generateCredentials(sessionId: string): Promise<CredentialsInfo> {
    const roleArn = (await this.get(sessionId) as AwsSsoRoleSession).roleArn;
    const region = this.workspaceService.getAwsSsoConfiguration().region;
    const portalUrl = this.workspaceService.getAwsSsoConfiguration().portalUrl;
    const accessToken = await this.getAccessToken(region, portalUrl);
    const credentials = await this.getRoleCredentials(accessToken, region, roleArn);
    return AwsSsoRoleService.sessionTokenFromGetSessionTokenResponse(credentials);
  }

  async sync(region: string, portalUrl: string): Promise<SsoRoleSession[]> {
    // Prepare Sso Client for operations
    this.getSsoOidcClient(region);
    // Get access token from either login procedure or keychain depending on being expired or not
    const accessToken = await this.getAccessToken(region, portalUrl);
    // get sessions from sso
    const sessions = await this.getSessions(accessToken, region);
    // remove all old sessions from workspace
    this.removeSsoSessionsFromWorkspace();

    return sessions;
  }

  async logout(): Promise<void> {
    // Obtain region and access token
    const region = this.workspaceService.getAwsSsoConfiguration().region;
    const savedAccessToken = await this.getAccessTokenFromKeychain();

    // Configure Sso Portal Client
    this.getSsoPortalClient(region);

    // Make a logout request to Sso
    const logoutRequest: LogoutRequest = { accessToken: savedAccessToken };
    this.ssoPortal.logout(logoutRequest).promise().then(_ => {}, _ => {
      // Delete access token and remove sso configuration info from workspace
      this.keychainService.deletePassword(environment.appName, 'aws-sso-access-token');
      this.workspaceService.removeExpirationTimeFromAwsSsoConfiguration();

      // Clean clients
      this.ssoOidc = null;
      this.ssoPortal = null;

      // Remove sessions from workspace
      this.removeSsoSessionsFromWorkspace();
    });
  }

  async getAccessToken(region: string, portalUrl: string): Promise<string> {
    if (this.ssoExpired()) {
      // Get login
      this.getSsoOidcClient(region);
      const loginResponse = await this.login(region, portalUrl);
      // Set configuration related data to workspace
      this.configureAwsSso(
        region,
        loginResponse.portalUrlUnrolled,
        loginResponse.expirationTime.toISOString(),
        loginResponse.accessToken
      );
      // Set access token
      return loginResponse.accessToken;
    } else {
      // Set access token
      return await this.getAccessTokenFromKeychain();
    }
  }

  // TODO: out of provisioning we are generating session credentials
  async getRoleCredentials(accessToken: string, region: string, roleArn: string): Promise<GetRoleCredentialsResponse> {
    this.getSsoPortalClient(region);

    const getRoleCredentialsRequest: GetRoleCredentialsRequest = {
      accountId: roleArn.substring(13, 25),
      roleName: roleArn.split('/')[1],
      accessToken
    };
    return this.ssoPortal.getRoleCredentials(getRoleCredentialsRequest).promise();
  }

  async awsSsoActive(): Promise<boolean> {
    const ssoToken = await this.getAccessTokenFromKeychain();
    return !this.ssoExpired() && ssoToken !== undefined;
  }

  private ssoExpired(): boolean {
    const expirationTime = this.workspaceService.getAwsSsoConfiguration().expirationTime;
    return !expirationTime || Date.parse(expirationTime) < Date.now();
  }

  private async login(region: string, portalUrl: string): Promise<LoginResponse> {

    const followRedirectClient = this.appService.getFollowRedirects()[AwsSsoRoleService.getProtocol(portalUrl)];

    portalUrl = await new Promise( (resolve, _) => {
      const request = followRedirectClient.request(portalUrl, response => resolve(response.responseUrl));
      request.end();
    });

    const registerClientResponse = await this.registerClient();
    const startDeviceAuthorizationResponse = await this.startDeviceAuthorization(registerClientResponse, portalUrl);
    const verificationResponse = await this.openVerificationBrowserWindow(registerClientResponse, startDeviceAuthorizationResponse);
    const generateSsoTokenResponse = await this.createToken(verificationResponse);

    return { portalUrlUnrolled: portalUrl, accessToken: generateSsoTokenResponse.accessToken, region, expirationTime: generateSsoTokenResponse.expirationTime };
  }

  private async getSessions(accessToken: string, region: string): Promise<SsoRoleSession[]> {
    const accounts: AccountInfo[] = await this.listAccounts(accessToken, region);

    const promiseArray: Promise<SsoRoleSession[]>[] = [];

    accounts.forEach((account) => {
      promiseArray.push(this.getSessionsFromAccount(account, accessToken, region));
    });

    return new Promise( (resolve, _) => {
      Promise.all(promiseArray).then( (sessionMatrix: SsoRoleSession[][]) => {
        resolve(sessionMatrix.flat());
      });
    });
  }

  private async getSessionsFromAccount(accountInfo: AccountInfo, accessToken: string, region: string): Promise<SsoRoleSession[]> {
    this.getSsoPortalClient(region);
    const listAccountRolesRequest: ListAccountRolesRequest = {
      accountId: accountInfo.accountId,
      accessToken,
      maxResults: 30 // TODO: find a proper value
    };

    const accountRoles: RoleInfo[] = [];

    await new Promise((resolve, _) => {
      this.recursiveListRoles(accountRoles, listAccountRolesRequest, resolve);
    });

    const awsSsoSessions: SsoRoleSession[] = [];

    const defaultId = await this.workspaceService.getDefaultProfileId();

    accountRoles.forEach((accountRole) => {
      const oldSession = this.findOldSession(accountInfo, accountRole);

      const awsSsoSession = {
        email: accountInfo.emailAddress,
        region: oldSession?.region || this.workspaceService.get().defaultRegion || environment.defaultRegion,
        roleArn: `arn:aws:iam::${accountInfo.accountId}/${accountRole.roleName}`,
        sessionName: accountInfo.accountName,
        profileId: oldSession?.profileId || defaultId
      };
      awsSsoSessions.push(awsSsoSession);
    });

    return awsSsoSessions;
  }

  private recursiveListRoles(accountRoles: RoleInfo[], listAccountRolesRequest: ListAccountRolesRequest, promiseCallback: any) {
    this.ssoPortal.listAccountRoles(listAccountRolesRequest).promise().then(response => {
      accountRoles.push(...response.roleList);

      if (response.nextToken !== null) {
        listAccountRolesRequest.nextToken = response.nextToken;
        this.recursiveListRoles(accountRoles, listAccountRolesRequest, promiseCallback);
      } else {
        promiseCallback(accountRoles);
      }
    });
  }

  private async listAccounts(accessToken: string, region: string): Promise<AccountInfo[]> {
    this.getSsoPortalClient(region);

    const listAccountsRequest: ListAccountsRequest = { accessToken, maxResults: 30 };
    const accountList: AccountInfo[] = [];

    return new Promise( (resolve, _) => {
      this.recursiveListAccounts(accountList, listAccountsRequest, resolve);
    });
  }

  private recursiveListAccounts(accountList: AccountInfo[], listAccountsRequest: ListAccountsRequest, promiseCallback: any) {
    this.ssoPortal.listAccounts(listAccountsRequest).promise().then(response => {
      accountList.push(...response.accountList);

      if (response.nextToken !== null) {
        listAccountsRequest.nextToken = response.nextToken;
        this.recursiveListAccounts(accountList, listAccountsRequest, promiseCallback);
      } else {
        promiseCallback(accountList);
      }
    });
  }

  private async removeSsoSessionsFromWorkspace(): Promise<void> {
    const sessions = await this.listAwsSsoRoles();
    sessions.forEach(sess => {
      // Verify and delete eventual iamRoleChained sessions from old Sso session
      this.listIamRoleChained(sess).then(iamRoleChainedSessions => {
        iamRoleChainedSessions.forEach(session => {
          this.delete(session.sessionId);
        });

        // Now we can safely remove
        this.workspaceService.removeSession(sess.sessionId);
      });
    });
  }

  // TODO: check name
  private configureAwsSso(region: string, portalUrl: string, expirationTime: string, accessToken: string) {
    this.workspaceService.configureAwsSso(region, portalUrl, expirationTime);
    this.keychainService.saveSecret(environment.appName, 'aws-sso-access-token', accessToken);
  }

  private getSsoOidcClient(region: string): void {
    if (!this.ssoOidc) {
      this.ssoOidc = new SSOOIDC({region});
    }
  }

  private getSsoPortalClient(region: string): void {
    if (!this.ssoPortal) {
      this.ssoPortal = new SSO({region});
    }
  }

  private async registerClient(): Promise<RegisterClientResponse> {
    const registerClientRequest: RegisterClientRequest = {
      clientName: 'leapp',
      clientType: 'public',
    };
    return this.ssoOidc.registerClient(registerClientRequest).promise();
  }

  private async startDeviceAuthorization(registerClientResponse: RegisterClientResponse, portalUrl: string): Promise<StartDeviceAuthorizationResponse> {
    const startDeviceAuthorizationRequest: StartDeviceAuthorizationRequest = {
      clientId: registerClientResponse.clientId,
      clientSecret: registerClientResponse.clientSecret,
      startUrl: portalUrl
    };
    return this.ssoOidc.startDeviceAuthorization(startDeviceAuthorizationRequest).promise();
  }

  private async openVerificationBrowserWindow(registerClientResponse: RegisterClientResponse, startDeviceAuthorizationResponse: StartDeviceAuthorizationResponse): Promise<VerificationResponse> {

    const pos = this.currentWindow.getPosition();

    this.ssoWindow = null;
    this.ssoWindow = this.appService.newWindow(startDeviceAuthorizationResponse.verificationUriComplete, true, 'Portal url - Client verification', pos[0] + 200, pos[1] + 50);
    this.ssoWindow.loadURL(startDeviceAuthorizationResponse.verificationUriComplete);

    return new Promise( (resolve, reject) => {

      // When the code is verified and the user has been logged in, the window can be closed
      this.ssoWindow.webContents.session.webRequest.onBeforeRequest({ urls: [
          'https://*.awsapps.com/start/user-consent/login-success.html',
        ] }, (details, callback) => {
        this.ssoWindow.close();
        this.ssoWindow = null;

        const verificationResponse: VerificationResponse = {
          clientId: registerClientResponse.clientId,
          clientSecret: registerClientResponse.clientSecret,
          deviceCode: startDeviceAuthorizationResponse.deviceCode
        };

        resolve(verificationResponse);

        callback({
          requestHeaders: details.requestHeaders,
          url: details.url,
        });
      });

      this.ssoWindow.webContents.session.webRequest.onErrorOccurred((details) => {
        if (
          details.error.indexOf('net::ERR_ABORTED') < 0 &&
          details.error.indexOf('net::ERR_FAILED') < 0 &&
          details.error.indexOf('net::ERR_CACHE_MISS') < 0
        ) {
          if (this.ssoWindow) {
            this.ssoWindow.close();
            this.ssoWindow = null;
          }
          reject(details.error.toString());
        }
      });
    });
  }

  private async createToken(verificationResponse: VerificationResponse): Promise<GenerateSSOTokenResponse> {
    const createTokenRequest: CreateTokenRequest = {
      clientId: verificationResponse.clientId,
      clientSecret: verificationResponse.clientSecret,
      grantType: 'urn:ietf:params:oauth:grant-type:device_code',
      deviceCode: verificationResponse.deviceCode
    };

    const createTokenResponse = await this.ssoOidc.createToken(createTokenRequest).promise();

    const expirationTime: Date = new Date(Date.now() + createTokenResponse.expiresIn * 1000);
    return { accessToken: createTokenResponse.accessToken, expirationTime };
  }

  private async getAccessTokenFromKeychain(): Promise<string> {
    return this.keychainService.getSecret(environment.appName, 'aws-sso-access-token');
  }

  private findOldSession(accountInfo: SSO.AccountInfo, accountRole: SSO.RoleInfo): { region: string; profileId: string } {

    for (let i = 0; i < this.workspaceService.sessions.length; i++) {
      const sess = this.workspaceService.sessions[i];

      if(sess.type === SessionType.awsSsoRole) {
        if (
          ((sess as AwsSsoRoleSession).email === accountInfo.emailAddress ) &&
          ((sess as AwsSsoRoleSession).roleArn === `arn:aws:iam::${accountInfo.accountId}/${accountRole.roleName}` )
        ) {
          return { region: (sess as AwsSsoRoleSession).region, profileId: (sess as AwsSsoRoleSession).profileId };
        }
      }
    }

    return undefined;
  }
}
