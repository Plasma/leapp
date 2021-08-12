import { Injectable } from '@angular/core';
import {AwsSessionService} from './session/aws/aws-session.service';
import {SessionFactoryService} from './session-factory.service';

@Injectable({
  providedIn: 'root'
})
export class RotationService {

  constructor(
    private sessionService: AwsSessionService,
    private sessionProviderService: SessionFactoryService) { }

  rotate(): void {
    this.sessionService.listActive().then(activeSessions => {
      activeSessions.forEach(session => {
        if (session.expired()) {
          const concreteSessionService = this.sessionProviderService.getService(session.type);
          concreteSessionService.rotate(session.sessionId);
        }
      });
    });
  }
}
