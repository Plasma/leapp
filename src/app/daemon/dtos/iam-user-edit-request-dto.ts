import {DaemonDto} from './daemon-dto';

export class IamUserEditRequestDto extends DaemonDto {

  private id: string;
  private name: string;
  private region: string;
  private mfaDevice: string;
  private awsNamedProfileId: string;
  private awsAccessKeyId: string;
  private awsSecretAccessKey: string;

  constructor(
      id: string,
      accountName: string,
      region: string,
      mfaDevice: string,
      awsNamedProfileId: string,
      awsAccessKeyId: string,
      awsSecretAccessKey: string) {
    super();

    this.name = accountName;
    this.region = region;
    this.mfaDevice = mfaDevice;
    this.awsNamedProfileId = awsNamedProfileId;
    this.awsAccessKeyId = awsAccessKeyId;
    this.awsSecretAccessKey = awsSecretAccessKey;
  }

  requestBody(): { [key: string]: any } {
    return {
      name: this.name,
      region: this.region,
      mfaDevice: this.mfaDevice,
      awsNamedProfileName: this.awsNamedProfileId,
      awsAccessKeyId: this.awsAccessKeyId,
      awsSecretAccessKey: this.awsSecretAccessKey
    };
  }

  requestUrl(): { [key: string]: any } {
    return { id: this.id };
  }

}
