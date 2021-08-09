export abstract class DaemonDto {

  transformUrl(url: string): string {
    const urlKeys = this.requestUrl();

    for (const key of Object.keys(urlKeys)) {
      const value = urlKeys[key];
      url = (url as any).replaceAll(`:${key}`, value);
    }

    return url;
  }

  abstract requestBody(): { [key: string]: any };

  abstract requestUrl(): { [key: string]: any };
}
