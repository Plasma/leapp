import {Injectable} from '@angular/core';
import {SessionType} from '../../models/session-type';
import {Session} from '../../models/session';
import {AwsIamUserSession} from '../../models/aws-iam-user-session';

@Injectable({
  providedIn: 'root'
})
export class DaemonDataMapperService {

  constructor() { }

  map(data: any[], sessionType: SessionType): Session[] {
    if(sessionType === SessionType.awsIamUser) {
      return this.mapAwsIamUser(data);
    }
    return [];
  }

  private mapAwsIamUser(sessions: any[]) {
    const mappedData: AwsIamUserSession[] = [];

    sessions.forEach(session => {
      const awsIamUserSession = new AwsIamUserSession(session.Name, session.Region, session.AwsNamedProfileId, session.MfaDevice);
      awsIamUserSession.sessionId = session.Id;
      awsIamUserSession.status = session.Status;
      mappedData.push(awsIamUserSession);
    });

    return mappedData;
  }
}
