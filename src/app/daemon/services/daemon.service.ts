import {Injectable} from '@angular/core';
import path from 'path';
import {LoggerLevel} from '../../services/app.service';
import {FileService} from '../../services/file.service';
import {ExecuteService} from '../../services/execute.service';
import {LeappBaseError} from '../../errors/leapp-base-error';
import {HttpClient} from '@angular/common/http';
import {environment} from '../../../environments/environment';
import {NativeService} from '../../services/native-service';
import {apiPort, apiRoot, DaemonUrls} from '../routes';
import {DaemonDto} from '../dtos/daemon-dto';

export enum WSDaemonMessage {
  mfaTokenRequest
}

@Injectable({
  providedIn: 'root'
})
export class DaemonService extends NativeService {

  constructor(
    private httpClient: HttpClient,
    private fileService: FileService,
    private executeService: ExecuteService) {
    super();
  }

  async launchDaemon() {

    // Calling leapp-daemon
    let daemonPath = path.join(this.process.resourcesPath, 'extraResources').substring(1);

    if (!environment.production) {
      daemonPath = `./src/assets/extraResources`;
    }

    const daemonFile = daemonPath + '/leapp_daemon';

    try {
      if (this.fileService.exists(daemonFile)) {
        const result = await this.executeService.executeAbsolute(`${daemonPath}/awesomeService '${daemonFile}'`);
      }
    } catch(err) {
      throw new LeappBaseError('Daemon Error', this, LoggerLevel.warn, err);
    }
  }

  callDaemon(url: DaemonUrls, daemonDto: DaemonDto, httpVerb: string): Promise<any> {
    const daemonCommandUrl = daemonDto.transformUrl(`http://localhost:${apiPort}${apiRoot}${url}`);

    return this.httpClient.request(httpVerb, daemonCommandUrl, {body: daemonDto.requestBody(), responseType:'json'}).toPromise().catch((err) => {
      throw new LeappBaseError('Daemon Error', this, LoggerLevel.warn, err.error.error);
    });
  }
}
