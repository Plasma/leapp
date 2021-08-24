import {DaemonDto} from './daemon-dto';

export class AwsNamedProfileCreateRequestDto extends DaemonDto {

  private name: string;
  private id: string;

  constructor(id: string, name: string) {
    super();

    this.id = id;
    this.name = name;
  }

  requestBody(): { [key: string]: any } {
    return {
      name: this.name,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      session_id: this.id
    };
  }

  requestUrl(): { [key: string]: any } {
    return { id: this.id };
  }

}
