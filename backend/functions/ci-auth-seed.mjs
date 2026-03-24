import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
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

  // Attempt to create; swallow UsernameExistsException for idempotency.
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

  // Always reset password so we have a known credential for auth.
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      Password: password,
      Permanent: true,
    })
  );

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
 * find a valid profile with the expected tier.
 */
async function upsertSubscriptionTier(client, userId, email, tier, subscriptionStatus) {
  const premiumExpires = tier === "premium" ? "now() + interval '365 days'" : "null";

  // Remove any stale row with the same email but a different id (happens when
  // Cognito recreates the user with a new sub).
  await client.query(`DELETE FROM users WHERE email = $1 AND id != $2`, [email, userId]);

  await client.query(
    `INSERT INTO users (id, email, display_name, is_verified, tier, subscription_status, premium_expires_at)
     VALUES ($1, $2, $3, true, $4, $5, ${premiumExpires})
     ON CONFLICT (id) DO UPDATE
       SET email            = EXCLUDED.email,
           display_name     = EXCLUDED.display_name,
           is_verified      = true,
           tier             = EXCLUDED.tier,
           subscription_status = EXCLUDED.subscription_status,
           premium_expires_at  = EXCLUDED.premium_expires_at,
           updated_at       = now(),
           deleted_at       = null`,
    [userId, email, `CI ${tier.charAt(0).toUpperCase() + tier.slice(1)} User`, tier, subscriptionStatus]
  );
}

export async function handler() {
  const [growerFree, growerPremium, gatherer] = await Promise.all([
    getOrCreateUser("grower-free"),
    getOrCreateUser("grower-premium"),
    getOrCreateUser("gatherer"),
  ]);

  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await upsertSubscriptionTier(client, decodeSubFromJwt(growerFree.id_token), growerFree.email, "free", "none");
    await upsertSubscriptionTier(client, decodeSubFromJwt(growerPremium.id_token), growerPremium.email, "premium", "active");
    await upsertSubscriptionTier(client, decodeSubFromJwt(gatherer.id_token), gatherer.email, "free", "none");
  } finally {
    await client.end();
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grower: growerPremium,
      grower_free: growerFree,
      grower_premium: growerPremium,
      gatherer,
    }),
  };
}
