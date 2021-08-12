import {DaemonDto} from './daemon-dto';

export class AwsNamedProfileEditRequestDto extends DaemonDto {

  private id: string;
  private name: string;

  constructor(id: string, name: string) {
    super();

    this.id = id;
    this.name = name;
  }

  requestBody(): { [key: string]: any } {
    return {
      name: this.name
    };
  }

  requestUrl(): { [key: string]: any } {
    return {
      id: this.id
    };
  }

}
