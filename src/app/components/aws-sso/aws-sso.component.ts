import {Component, OnInit} from '@angular/core';
import {Router} from '@angular/router';
import {FormControl, FormGroup, Validators} from '@angular/forms';
import {AppService} from '../../services/app.service';
import {WorkspaceService} from '../../services/workspace.service';
import {AwsSsoRoleService, SsoRoleSession} from '../../services/session/aws/methods/aws-sso-role.service';

@Component({
  selector: 'app-aws-sso',
  templateUrl: './aws-sso.component.html',
  styleUrls: ['./aws-sso.component.scss']
})
export class AwsSsoComponent implements OnInit {

  isAwsSsoActive: boolean;
  regions = [];
  selectedRegion;
  portalUrl;
  loading = false;

  public form = new FormGroup({
    portalUrl: new FormControl('', [Validators.required, Validators.pattern('https?://.+')]),
    awsRegion: new FormControl('', [Validators.required])
  });

  constructor(
    private appService: AppService,
    private awsSsoRoleService: AwsSsoRoleService,
    private router: Router,
    private workspaceService: WorkspaceService
  ) {}

  ngOnInit() {
    this.awsSsoRoleService.awsSsoActive().then(res => {
      this.isAwsSsoActive = res;
      this.setValues();
    });
  }

  async login() {
    if (this.form.valid) {
      const defaultId = await this.workspaceService.getDefaultProfileId();

      this.awsSsoRoleService.sync(this.selectedRegion, this.form.value.portalUrl).then((ssoRoleSessions: SsoRoleSession[]) => {
        ssoRoleSessions.forEach(ssoRoleSession => {
          this.awsSsoRoleService.create(ssoRoleSession, defaultId);
        });
        this.router.navigate(['/sessions', 'session-selected']);
      });
    }
  }

  logout() {
    this.awsSsoRoleService.logout().then(_ => {
      this.isAwsSsoActive = false;
      this.setValues();
    });
  }

  forceSync() {
    const region = this.workspaceService.getAwsSsoConfiguration().region;
    const portalUrl = this.workspaceService.getAwsSsoConfiguration().portalUrl;

    this.awsSsoRoleService.sync(region, portalUrl).then((ssoRoleSessions: SsoRoleSession[]) => {
      ssoRoleSessions.forEach(ssoRoleSession => {
        this.awsSsoRoleService.create(ssoRoleSession, ssoRoleSession.profileId);
      });
      this.router.navigate(['/sessions', 'session-selected']);
    });
  }

  goBack() {
    this.router.navigate(['/sessions', 'session-selected']);
  }

  setValues() {
    this.regions = this.appService.getRegions();
    const region = this.workspaceService.getAwsSsoConfiguration().region;
    const portalUrl = this.workspaceService.getAwsSsoConfiguration().portalUrl;

    this.selectedRegion = region || this.regions[0].region;
    this.portalUrl = portalUrl;
    this.form.controls['portalUrl'].setValue(portalUrl);
  }
}
