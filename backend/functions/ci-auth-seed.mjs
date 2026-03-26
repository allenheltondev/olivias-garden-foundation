import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  AdminInitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import pg from "pg";

const { USER_POOL_ID, USER_POOL_CLIENT_ID, DATABASE_URL } = process.env;
const cognito = new CognitoIdentityProviderClient();

/**
 * Deterministic password derived from the user label.
 * Meets Cognito complexity requirements (upper, lower, digit, special, 20+ chars).
 */
function deterministicPassword(label) {
  return `CiSeed!9x_${label}_Zq2w`;
}

/**
 * Decode the `sub` claim from a JWT id_token without verification
 * (fine for CI-only usage against our own Cognito pool).
 */
function decodeSubFromJwt(idToken) {
  const payload = idToken.split(".")[1];
  const json = Buffer.from(payload, "base64url").toString("utf-8");
  const claims = JSON.parse(json);
  if (!claims.sub) throw new Error("Unable to decode sub from id token");
  return claims.sub;
}

/**
 * Create-or-reuse a Cognito user with a deterministic email, set a known
 * password, and return fresh tokens via ADMIN_USER_PASSWORD_AUTH.
 */
async function getOrCreateUser(label) {
  const email = `ci+${label}@example.com`;
  const password = deterministicPassword(label);

  await ensureUser(email, password);

  try {
    return await authenticateUser(label, email, password);
  } catch (err) {
    if (err.name !== "NotAuthorizedException") throw err;

    // User is in a bad state — delete and recreate.
    await cognito.send(
      new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: email })
    );
    await ensureUser(email, password);
    return await authenticateUser(label, email, password);
  }
}

async function ensureUser(email, password) {
  try {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        MessageAction: "SUPPRESS",
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
        ],
      })
    );
  } catch (err) {
    if (err.name !== "UsernameExistsException") throw err;
  }

  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      Password: password,
      Permanent: true,
    })
  );
}

async function authenticateUser(label, email, password) {
  const authResult = await cognito.send(
    new AdminInitiateAuthCommand({
      UserPoolId: USER_POOL_ID,
      ClientId: USER_POOL_CLIENT_ID,
      AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: email, PASSWORD: password },
    })
  );

  const tokens = authResult.AuthenticationResult;
  return {
    email,
    access_token: tokens.AccessToken,
    id_token: tokens.IdToken,
    refresh_token: tokens.RefreshToken,
  };
}

/**
 * Upsert the user row in Postgres so the API's authorizer/handlers
 * find a valid profile with the expected tier and role.
 */
async function upsertUser(client, userId, email, { role, tier }) {
  const subscriptionStatus = tier === "premium" ? "active" : "none";
  const premiumExpires = tier === "premium" ? "now() + interval '365 days'" : "null";

  // Remove any stale row with the same email but a different id (happens when
  // Cognito recreates the user with a new sub).
  await client.query(`DELETE FROM users WHERE email = $1 AND id != $2`, [email, userId]);

  await client.query(
    `INSERT INTO users (id, email, display_name, is_verified, tier, subscription_status, premium_expires_at, user_type, onboarding_completed)
     VALUES ($1, $2, $3, true, $4, $5, ${premiumExpires}, $6, true)
     ON CONFLICT (id) DO UPDATE
       SET email            = EXCLUDED.email,
           display_name     = EXCLUDED.display_name,
           is_verified      = true,
           tier             = EXCLUDED.tier,
           subscription_status = EXCLUDED.subscription_status,
           premium_expires_at  = EXCLUDED.premium_expires_at,
           user_type        = EXCLUDED.user_type,
           onboarding_completed = true,
           updated_at       = now(),
           deleted_at       = null`,
    [userId, email, `CI ${role} (${tier})`, tier, subscriptionStatus, role]
  );
}

/**
 * Provision a single named user: create/reuse in Cognito, upsert in Postgres,
 * return tokens keyed by the caller-supplied name.
 */
async function provisionUser(client, { name, role, tier }) {
  const tokens = await getOrCreateUser(name);
  const userId = decodeSubFromJwt(tokens.id_token);
  await upsertUser(client, userId, tokens.email, { role, tier });
  return { name, ...tokens };
}

/**
 * Default user specs used when the Lambda is invoked with an empty payload.
 * Preserves backward compatibility with callers that don't send a `users` array.
 */
const LEGACY_USERS = [
  { name: "grower-free",    role: "grower",   tier: "free" },
  { name: "grower-premium", role: "grower",   tier: "premium" },
  { name: "gatherer",       role: "gatherer", tier: "free" },
];

export async function handler(event) {
  const userSpecs = Array.isArray(event?.users) && event.users.length > 0
    ? event.users
    : LEGACY_USERS;

  // Validate each spec
  for (const spec of userSpecs) {
    if (!spec.name || !spec.role || !spec.tier) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Each user must have name, role, and tier" }),
      };
    }
  }

  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const results = await Promise.all(
      userSpecs.map((spec) => provisionUser(client, spec))
    );

    // Build a map keyed by user name for easy extraction in CI scripts
    const users = {};
    for (const result of results) {
      const { name, ...tokens } = result;
      users[name] = tokens;
    }

    // Legacy shape: include top-level aliases so existing callers don't break
    const legacy = {};
    if (users["grower-free"])    legacy.grower_free = users["grower-free"];
    if (users["grower-premium"]) legacy.grower_premium = users["grower-premium"];
    if (users["grower-premium"]) legacy.grower = users["grower-premium"];
    if (users["gatherer"])       legacy.gatherer = users["gatherer"];

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ users, ...legacy }),
    };
  } finally {
    await client.end();
  }
}
