import {Component, OnInit} from '@angular/core';
import {environment} from '../environments/environment';
import {FileService} from './services/file.service';
import {AppService, LoggerLevel} from './services/app.service';
import {Router} from '@angular/router';
import {WorkspaceService} from './services/workspace.service';
import {Workspace} from './models/workspace';
import {setTheme} from 'ngx-bootstrap/utils';
import {TimerService} from './services/timer.service';
import {RotationService} from './services/rotation.service';
import {SessionFactoryService} from './services/session-factory.service';
import {UpdaterService} from './services/updater.service';
import compareVersions from 'compare-versions';
import {RetrocompatibilityService} from './services/retrocompatibility.service';
import {LeappParseError} from './errors/leapp-parse-error';
import {DaemonService} from './daemon/services/daemon.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {

  daemonInstallingState = 0;
  daemonErrorMessage = '';

  /* Main app file: launches the Angular framework inside Electron app */
  constructor(
    private app: AppService,
    private workspaceService: WorkspaceService,
    private retrocompatibilityService: RetrocompatibilityService,
    private fileService: FileService,
    private rotationService: RotationService,
    private sessionProviderService: SessionFactoryService,
    private router: Router,
    private timerService: TimerService,
    private updaterService: UpdaterService,
    private daemonService: DaemonService
  ) {}

  async ngOnInit() {
    // 1. Angular App Boostrap
    this.angularBootstrap();

    // 2. Install and launch daemon
    await this.installAndLaunchDaemon();

    if(this.daemonInstallingState === 4) {
      // 3. Once daemon is verified as installed and working, start applying all the retrocompatibility and migration patches
      await this.applyRetrocompatibilityAndMigrationPatches();

      // 4. Change all sessions to stopped status in order to start with all inactive
      await this.changeAllSessionsStatusToStop();

      // 5. Start Global Timer (1s)
      this.timerService.start(this.rotationService.rotate.bind(this.rotationService));

      // 6. Launch Auto Updater Routines
      this.manageAutoUpdate();

      // 7. Navigate to the correct Angular page
      await this.navigateToNextPage();
    }
  }

  private async installAndLaunchDaemon() {
    try {
      // 1. Install Daemon UI
      this.daemonInstallingState = 1;
      // Launch Daemon
      await this.daemonService.installDaemon();
    } catch (err) {
      console.error(err);
      this.daemonInstallingState = 3;
      this.daemonErrorMessage = 'Daemon failed to install. Please check if you can run install manually then restart Leapp.';
      return;
    }

    try {
      // 2. Start Daemon UI
      this.daemonInstallingState = 2;
      // Start Daemon
      await this.daemonService.startDaemon();
    } catch (err) {
      this.daemonInstallingState = 3;
      this.daemonErrorMessage = 'Daemon communication is off. Please check that Daemon service is running then restart Leapp.';
      return;
    }

    // 3. Run normal app
    this.daemonInstallingState = 4;
  }

  private async navigateToNextPage() {
    // Go to initial page if no sessions are already created or
    // go to the list page if is your second visit
    if ((await this.workspaceService.getPersistedSessions()).length > 0) {
      this.router.navigate(['/sessions', 'session-selected']);
    } else {
      this.router.navigate(['/start', 'start-page']);
    }
  }

  private async changeAllSessionsStatusToStop() {
    // Check the existence of a pre-Leapp credential file and make a backup
    const workspace = this.workspaceService.get();
    this.showCredentialBackupMessageIfNeeded(workspace);

    // All sessions start stopped when app is launched
    if ((await this.workspaceService.getPersistedSessions()).length > 0) {
      (await this.workspaceService.getPersistedSessions()).forEach(sess => {
        const concreteSessionService = this.sessionProviderService.getService(sess.type);
        concreteSessionService.stop(sess.sessionId);
      });
    }
  }

  private async applyRetrocompatibilityAndMigrationPatches() {
    // Before retrieving an actual copy of the workspace we
    // check and in case apply, our retro compatibility service
    if (this.retrocompatibilityService.isRetroPatchNecessary()) {
      await this.retrocompatibilityService.adaptOldWorkspaceFile();
    }

    // After migrating from old versions of Leapp Client to latest Leapp Client we migrate one step at a time
    // the sessions that we want to manage from the daemon itself
    if (this.retrocompatibilityService.isMigrationPathNecessary()) {
      await this.retrocompatibilityService.migrateDataToDaemon();
    }
  }

  private angularBootstrap() {
    // We get the right moment to set an hook to app close
    const ipc = this.app.getIpcRenderer();
    ipc.on('app-close', () => {
      this.app.logger('Preparing for closing instruction...', LoggerLevel.info, this);
      this.beforeCloseInstructions();
    });

    // Use ngx bootstrap 4
    setTheme('bs4');

    if (environment.production) {
      // Clear both info and warn message in production
      // mode without removing them from code actually
      console.warn = () => {
      };
      console.log = () => {
      };
    }

    // Prevent Dev Tool to show on production mode
    this.app.blockDevToolInProductionMode();
  }

  /**
   * This is an hook on the closing app to remove credential file and force stop using them
   */
  private beforeCloseInstructions() {
    // Check if we are here
    this.app.logger('Closing app with cleaning process...', LoggerLevel.info, this);

    // We need the Try/Catch as we have a the possibility to call the method without sessions
    try {
      // Clean the config file
      this.app.cleanCredentialFile();
    } catch (err) {
      this.app.logger('No sessions to stop, skipping...', LoggerLevel.info, this, err.stack);
    }

    // Finally quit
    this.app.quit();
  }

  /**
   * Show that we created a copy of original credential file if present in the system
   */
  private showCredentialBackupMessageIfNeeded(workspace: Workspace) {
    const oldAwsCredentialsPath = this.app.getOS().homedir() + '/' + environment.credentialsDestination;
    const newAwsCredentialsPath = oldAwsCredentialsPath + '.leapp.bkp';
    const check = workspace.sessions.length === 0 &&
                  this.app.getFs().existsSync(oldAwsCredentialsPath) &&
                  !this.app.getFs().existsSync(newAwsCredentialsPath);

    this.app.logger(`Check existing credential file: ${check}`, LoggerLevel.info, this);

    if (check) {
      this.app.getFs().renameSync(oldAwsCredentialsPath, newAwsCredentialsPath);
      this.app.getFs().writeFileSync(oldAwsCredentialsPath,'');
      this.app.getDialog().showMessageBox({
        type: 'info',
        icon: __dirname + '/assets/images/Leapp.png',
        message: 'You had a previous credential file. We made a backup of the old one in the same directory before starting.'
      });
    }
  }

  /**
   * Launch Updater process
   *
   * @private
   */
  private manageAutoUpdate(): void {
    let savedVersion;

    try {
      savedVersion = this.updaterService.getSavedAppVersion();
    } catch (error) {
      savedVersion = this.updaterService.getCurrentAppVersion();
    }

    try {
      if (compareVersions(savedVersion, this.updaterService.getCurrentAppVersion()) <= 0) {
        // We always need to maintain this order: fresh <= saved <= online
        this.updaterService.updateVersionJson(this.updaterService.getCurrentAppVersion());
      }
    } catch (error) {
      this.updaterService.updateVersionJson(this.updaterService.getCurrentAppVersion());
    }

    const ipc = this.app.getIpcRenderer();
    ipc.on('UPDATE_AVAILABLE', async (_, info) => {

      const releaseNote = await this.updaterService.getReleaseNote();
      this.updaterService.setUpdateInfo(info.version, info.releaseName, info.releaseDate, releaseNote);
      if (this.updaterService.isUpdateNeeded()) {
        this.updaterService.updateDialog();
        this.workspaceService.sessions = [...this.workspaceService.sessions];
      }
    });
  }


}
