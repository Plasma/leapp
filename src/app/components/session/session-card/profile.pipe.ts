import { Pipe, PipeTransform } from '@angular/core';
import {WorkspaceService} from '../../../services/workspace.service';
import {Session} from '../../../models/session';
import {environment} from '../../../../environments/environment';

@Pipe({
  name: 'profile'
})
export class ProfilePipe implements PipeTransform {

  constructor(private workspaceService: WorkspaceService) {}

  transform(session: Session): Promise<string> {
    return new Promise<string>((resolve, _) => {
      this.workspaceService.getProfileName((session as any).profileId).then(profileName => {
        resolve(profileName ? profileName : environment.defaultAwsProfileName);
      });
    });
  }

}
