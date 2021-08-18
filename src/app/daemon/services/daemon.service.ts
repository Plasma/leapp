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
import {Constants} from '../../models/constants';
import {EmptyDto} from '../dtos/empty-dto';

@Injectable({
  providedIn: 'root'
})
export class DaemonService extends NativeService {

  macInstaller = '/leapp-daemon-macos-amd64';
  windowInstaller = '/leapp-daemon-windows-amd64.exe';
  linuxInstaller = '/leapp-daemon-linux-amd64';
  user = 'root';

  constructor(
    private httpClient: HttpClient,
    private fileService: FileService,
    private executeService: ExecuteService) {
    super();

    this.user = this.os.userInfo().username;
  }

  async isDaemonActive(): Promise<boolean> {
    try {
      await this.callDaemon(DaemonUrls.listAwsNamedProfiles, new EmptyDto(), 'GET');
      return true;
    } catch (err) {
      return false;
    }
  }

  async installDaemon() {
    const daemonFile = this.daemonPath();
    if (this.fileService.exists(daemonFile)) {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      await this.executeService.executeAbsolute(`sudo '${daemonFile}' -service install`, { LEAPP_USER: this.user});
    }
  }

  async startDaemon() {
    const daemonFile = this.daemonPath();
    if(this.fileService.exists(daemonFile)) {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      await this.executeService.executeAbsolute(`sudo '${daemonFile}' -service start`, { LEAPP_USER: this.user});
    }
  }

  callDaemon(url: DaemonUrls, daemonDto: DaemonDto, httpVerb: string): Promise<any> {
    const daemonCommandUrl = daemonDto.transformUrl(`http://localhost:${apiPort}${apiRoot}${url}`);

    return this.httpClient.request(httpVerb, daemonCommandUrl, {body: daemonDto.requestBody(), responseType:'json'}).toPromise().catch((err) => {
      throw new LeappBaseError('Daemon Error', this, LoggerLevel.warn, err.error.error);
    });
  }

  private daemonPath() {
    // Calling leapp-daemon
    let daemonPath = path.join(this.process.resourcesPath, 'extraResources').substring(1);

    if (!environment.production) {
      daemonPath = `${__dirname}/src/assets/extraResources`.replace('dist/leapp-client/', '');
    }

    let daemonFile = daemonPath + this.macInstaller;
    if (this.detectOs() === Constants.windows) {
      daemonFile = daemonPath + this.windowInstaller;
    } else if (this.detectOs() === Constants.linux) {
      daemonFile = daemonPath + this.linuxInstaller;
    }
    return daemonFile;
  }

  private detectOs() {
    const hrNames = {
      linux: Constants.linux,
      darwin: Constants.mac,
      win32: Constants.windows
    };
    const os = this.os.platform();
    return hrNames[os];
  }
}
