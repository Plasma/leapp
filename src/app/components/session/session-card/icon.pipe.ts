import { Pipe, PipeTransform } from '@angular/core';
import {Session} from '../../../models/session';
import {environment} from '../../../../environments/environment';
import {SessionStatus} from '../../../models/session-status';
import {WorkspaceService} from '../../../services/workspace.service';

@Pipe({
  name: 'icon'
})
export class IconPipe implements PipeTransform {

  constructor(private workspaceService: WorkspaceService) {}

  transform(session: Session): Promise<string> {
    return new Promise((resolve, _) => {
      this.workspaceService.getProfileName((session as any).profileId).then(name => {
        const iconName = name === environment.defaultAwsProfileName ? 'home' : 'user';
        resolve(session.status === SessionStatus.active ? `${iconName} orange` : iconName);
      });
    });
  }

}
