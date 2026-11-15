/**
 * Is the key's operator still an admin? Asked of Cognito on every request, so
 * taking someone out of the admin group switches off every key they hold, the
 * same moment it locks them out of the admin app. Fails closed: if Cognito
 * cannot answer, the request is refused.
 */

import {
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand
} from '@aws-sdk/client-cognito-identity-provider';

export const ADMIN_GROUP = 'admin';

function isAdminGroup(name) {
  return typeof name === 'string' && name.toLowerCase() === ADMIN_GROUP;
}

export class CognitoOperatorDirectory {
  constructor(userPoolId, client) {
    if (!userPoolId) throw new Error('USER_POOL_ID is not configured');
    this.userPoolId = userPoolId;
    this.client = client ?? new CognitoIdentityProviderClient({});
  }

  /** Whether this username is an enabled user in the admin group. */
  async isAdmin(username) {
    const user = await this.client.send(new AdminGetUserCommand({ UserPoolId: this.userPoolId, Username: username }));
    if (user.Enabled === false) return false;
    let next;
    do {
      const out = await this.client.send(new AdminListGroupsForUserCommand({
        UserPoolId: this.userPoolId,
        Username: username,
        NextToken: next
      }));
      if ((out.Groups ?? []).some((g) => isAdminGroup(g.GroupName))) return true;
      next = out.NextToken;
    } while (next);
    return false;
  }

  /** Find a user by email for minting: `{ sub, username, email }`, or null. */
  async findByEmail(email) {
    const safe = String(email).replace(/["\\]/g, '');
    const out = await this.client.send(new ListUsersCommand({
      UserPoolId: this.userPoolId,
      Filter: `email = "${safe}"`,
      Limit: 2
    }));
    const users = out.Users ?? [];
    if (users.length !== 1) return null;
    const attr = (name) => users[0].Attributes?.find((a) => a.Name === name)?.Value ?? null;
    return { sub: attr('sub'), username: users[0].Username, email: attr('email') };
  }
}

/** For tests and local runs: a fixed set of admin usernames. */
export class StaticOperatorDirectory {
  constructor(admins = []) {
    this.admins = new Set(admins);
  }
  async isAdmin(username) {
    return this.admins.has(username);
  }
}
