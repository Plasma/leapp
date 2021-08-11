import {Injectable} from '@angular/core';
import {apiPort, apiRoot, DaemonUrls} from '../routes';
import {DaemonService} from './daemon.service';
import {GetIamUserSessionRequestDto} from '../dtos/get-iam-user-session-request-dto';
import {Constants} from '../../models/constants';
import {ConfirmIamUserMfaCodeRequestDto} from '../dtos/confirm-iam-user-mfa-code-request-dto';
import {LeappBaseError} from '../../errors/leapp-base-error';
import {AppService, LoggerLevel} from '../../services/app.service';
import {LeappMissingMfaTokenError} from '../../errors/leapp-missing-mfa-token-error';
import {AwsIamUserService} from '../../services/session/aws/methods/aws-iam-user.service';
import {WorkspaceService} from '../../services/workspace.service';
import {WsDaemonMessage} from '../ws-daemon-message';

@Injectable({
  providedIn: 'root'
})
export class WebsocketService {

  private mfaSemaphore;
  private webSocket: any;
  private connectionRetries = 5;

  constructor(
    private daemonService: DaemonService,
    private awsIamUserService: AwsIamUserService,
    private appService: AppService,
    private workspaceService: WorkspaceService
  ) {
    this.mfaSemaphore = false;
  }

  launchDaemonWebSocket() {
    if(this.connectionRetries > 0) {
      this.webSocket = new WebSocket(`ws://localhost:${apiPort}${apiRoot}${DaemonUrls.openWebsocketConnection}`);

      this.webSocket.onerror = (_) => {
        this.connectionRetries--;
        this.workspaceService.getPersistedSessions().then(sessions => {
          this.workspaceService.sessions = sessions;
        });
        this.launchDaemonWebSocket();
      };
      this.webSocket.onclose = (_) => {
        this.workspaceService.getPersistedSessions().then(sessions => {
          this.workspaceService.sessions = sessions;
        });
        this.launchDaemonWebSocket();
      };

      this.webSocket.onmessage = async (evt) => {
        // Reset connection retries
        this.connectionRetries = 5;

        const data = JSON.parse(evt.data);

        if (data.MessageType === WsDaemonMessage.mfaTokenRequest && !this.mfaSemaphore) {
          await this.manageMfaTokenRequest(data);
        } else if (data.MessageType === WsDaemonMessage.updateAwsIamUserSessions) {
          this.workspaceService.getPersistedSessions().then(sessions => {
            this.workspaceService.sessions = sessions;
          });
        }
      };
    } else {
      this.webSocket = null;
      throw new LeappBaseError('Websocket Connection Failer Error', this, LoggerLevel.warn, 'Can\'t connect with Daemon Websocket, please check Daemon is active');
    }
  }

  private async manageMfaTokenRequest(data) {
    this.mfaSemaphore = true;

    const sessionId = JSON.parse(data.Data).SessionId;
    const response = await this.daemonService.callDaemon(DaemonUrls.getIamUser, new GetIamUserSessionRequestDto(sessionId), 'GET');
    const sessionAlias = response.data.Name;

    this.appService.inputDialog('Insert MFA Code', 'set code...', `Please add code for ${sessionAlias} session`, async (res) => {

      try {
        if (res !== Constants.confirmClosed) {
          await this.daemonService.callDaemon(DaemonUrls.iamUserConfirmMfaCode, new ConfirmIamUserMfaCodeRequestDto(sessionId, res), 'POST');
        } else {
          throw new LeappBaseError('Mfa Error', this, LoggerLevel.warn, 'Missing Mfa Code');
        }
      } catch (err) {
        await this.awsIamUserService.stop(sessionId);
        throw new LeappMissingMfaTokenError(this, err.message);
      } finally {
        this.mfaSemaphore = false;
      }
    });
  }
}
