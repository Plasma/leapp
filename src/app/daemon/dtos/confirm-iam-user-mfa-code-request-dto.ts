import {DaemonDto} from './daemon-dto';

export class ConfirmIamUserMfaCodeRequestDto extends DaemonDto {
  private id: string;
  private mfaToken: string;

  constructor(id: string, mfaToken: string) {
    super();

    this.id = id;
    this.mfaToken = mfaToken;
  }

  requestBody(): { [p: string]: any } {
    return { mfaToken: this.mfaToken };
  }

  requestUrl(): { [p: string]: any } {
    return { id: this.id };
  }

}
