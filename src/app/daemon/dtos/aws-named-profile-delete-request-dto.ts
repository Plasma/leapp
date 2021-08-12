import {DaemonDto} from './daemon-dto';

export class AwsNamedProfileDeleteRequestDto extends DaemonDto {

  private id: string;

  constructor(id: string) {
    super();

    this.id = id;
  }

  requestBody(): { [key: string]: any } {
    return {};
  }

  requestUrl(): { [key: string]: any } {
    return {
      id: this.id
    };
  }

}
