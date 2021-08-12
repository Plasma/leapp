import {DaemonDto} from './daemon-dto';

export class AwsNamedProfileCreateRequestDto extends DaemonDto {

  private name: string;

  constructor(name: string) {
    super();

    this.name = name;
  }

  requestBody(): { [key: string]: any } {
    return {
      name: this.name
    };
  }

  requestUrl(): { [key: string]: any } {
    return {};
  }

}
