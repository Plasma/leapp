export const apiPort = '8080';

export const apiRoot = '/api/v1';

export enum DaemonUrls {
  openWebsocketConnection = `/websocket/register-client`, // GET
  iamUserConfirmMfaCode = `/aws/iam-user-sessions/:id/confirm-mfa-token`, // POST

  createIamUser = `/aws/iam-user-sessions`, // POST
  getIamUser = `/aws/iam-user-sessions/:id`, // GET
  editIamUser = `/aws/iam-user-sessions/:id`, // PUT
  deleteIamUser = `/aws/iam-user-sessions/:id`, // DELETE
  startIamUserSession = `/aws/iam-user-sessions/:id/start`, // POST
  stopIamUserSession = `/aws/iam-user-sessions/:id/stop`, // POST
}
