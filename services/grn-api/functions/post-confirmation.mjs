import pg from "pg";
import { randomUUID } from "node:crypto";

const { DATABASE_URL } = process.env;

const POST_CONFIRMATION_TRIGGERS = new Set([
  "PostConfirmation_ConfirmSignUp",
  "PostConfirmation_AdminConfirmSignUp",
  "PostConfirmation_ConfirmForgotPassword",
]);

/**
 * Cognito PostConfirmation Lambda trigger.
 * Upserts a shell user row in Postgres so the API has a profile to work with.
 */
export async function handler(event) {
  const triggerSource = event.triggerSource;
  const correlationId =
    event.request?.clientMetadata?.correlationId ??
    event.request?.clientMetadata?.correlation_id ??
    randomUUID();

  if (!POST_CONFIRMATION_TRIGGERS.has(triggerSource)) {
    console.log(
      JSON.stringify({
        level: "WARN",
        message: "Skipping unsupported Cognito trigger",
        correlationId,
        triggerSource: triggerSource ?? "unknown",
      })
    );
    return event;
  }

  const attributes = event.request?.userAttributes;
  if (!attributes?.sub) {
    throw new Error("Missing userAttributes.sub in Cognito event");
  }

  const userId = attributes.sub;
  const email = attributes.email ?? null;

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO users (id, email)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE
         SET email = COALESCE(users.email, EXCLUDED.email)`,
      [userId, email]
    );
  } finally {
    await client.end();
  }

  console.log(
    JSON.stringify({
      level: "INFO",
      message: "Provisioned shell user after Cognito post-confirmation",
      correlationId,
      userId,
      hasEmail: email !== null,
    })
  );

  return event;
}
