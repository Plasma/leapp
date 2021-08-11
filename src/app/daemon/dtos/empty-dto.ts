import {DaemonDto} from './daemon-dto';

export class EmptyDto extends DaemonDto {
  constructor() {
    super();
  }

  requestBody(): { [p: string]: any } {
    return {};
  }

  requestUrl(): { [p: string]: any } {
    return {};
  }

}
