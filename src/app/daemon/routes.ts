export const apiPort = '8080';

export const apiRoot = '/api/v1';

export enum DaemonUrls {
  openWebsocketConnection = `/websocket/register-client`, // GET
  iamUserConfirmMfaCode = `/aws/iam-user-sessions/:id/confirm-mfa-token`, // POST

  listAwsNamedProfiles = `/aws/named-profiles`, // GET
  createAwsNamedProfile = `/aws/named-profiles`, // POST
  editAwsNamedProfile = `/aws/named-profiles/:id`, // PATCH
  deleteAwsNamedProfile = `/aws/named-profiles/:id`, // DELETE

  createIamUser = `/aws/iam-user-sessions`, // POST
  listAwsIamUserSessions = `/aws/iam-user-sessions`, // GET
  getIamUser = `/aws/iam-user-sessions/:id`, // GET
  editIamUser = `/aws/iam-user-sessions/:id`, // PUT
  deleteIamUser = `/aws/iam-user-sessions/:id`, // DELETE
  startIamUserSession = `/aws/iam-user-sessions/:id/start`, // POST
  stopIamUserSession = `/aws/iam-user-sessions/:id/stop`, // POST
}
