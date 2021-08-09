import {DaemonDto} from './daemon-dto';

export class StopIamUserSessionRequestDto extends DaemonDto {
  private id: string;

  constructor(id: string) {
    super();
    this.id = id;
  }

  requestBody(): { [p: string]: any } {
    return {};
  }

  requestUrl(): { [p: string]: any } {
    return { id: this.id };
  }

}
