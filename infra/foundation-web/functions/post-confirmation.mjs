import pg from "pg";
import { randomUUID } from "node:crypto";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";

const { DATABASE_URL } = process.env;

export const POST_CONFIRMATION_TRIGGERS = new Set([
  "PostConfirmation_ConfirmSignUp",
  "PostConfirmation_AdminConfirmSignUp",
  "PostConfirmation_ConfirmForgotPassword",
]);

export const SIGNUP_NOTIFICATION_TRIGGERS = new Set([
  "PostConfirmation_ConfirmSignUp",
  "PostConfirmation_AdminConfirmSignUp",
]);

function resolveCorrelationId(event) {
  return (
    event.request?.clientMetadata?.correlationId ??
    event.request?.clientMetadata?.correlation_id ??
    randomUUID()
  );
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

export function extractSignupContext(event) {
  const triggerSource = event.triggerSource;
  const correlationId = resolveCorrelationId(event);

  if (!POST_CONFIRMATION_TRIGGERS.has(triggerSource)) {
    return {
      correlationId,
      triggerSource,
      supported: false,
    };
  }

  const attributes = event.request?.userAttributes;
  if (!attributes?.sub) {
    throw new Error("Missing userAttributes.sub in Cognito event");
  }

  const givenName = firstNonEmptyString(attributes.given_name);
  const familyName = firstNonEmptyString(attributes.family_name);
  const fullName = firstNonEmptyString(
    attributes.name,
    [givenName, familyName].filter(Boolean).join(" "),
  );

  return {
    correlationId,
    triggerSource,
    supported: true,
    userId: attributes.sub,
    email: attributes.email ?? null,
    givenName,
    familyName,
    fullName,
    newsletterOptIn: attributes["custom:newsletter_opt_in"] === "true",
  };
}

export function buildSignupEventDetail(context) {
  return {
    userId: context.userId,
    email: context.email ?? null,
    givenName: context.givenName ?? null,
    familyName: context.familyName ?? null,
    fullName: context.fullName ?? null,
    newsletterOptIn: Boolean(context.newsletterOptIn),
    correlationId: context.correlationId,
  };
}

async function publishSignupEvent(context, eventBridgeClient, logger) {
  if (!SIGNUP_NOTIFICATION_TRIGGERS.has(context.triggerSource)) {
    return;
  }

  const result = await eventBridgeClient.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: "ogf.signups",
          DetailType: "user.signed-up",
          Detail: JSON.stringify(buildSignupEventDetail(context)),
        },
      ],
    }),
  );

  if ((result?.FailedEntryCount ?? 0) > 0) {
    throw new Error(
      `EventBridge reported ${result.FailedEntryCount} failed entries for signup event`,
    );
  }

  logger(
    JSON.stringify({
      level: "INFO",
      message: "Published foundation signup event",
      correlationId: context.correlationId,
      userId: context.userId,
    }),
  );
}

export async function linkGuestOrders(client, { userId, email }, errorLogger = console.error) {
  if (!email) return 0;
  try {
    const result = await client.query(
      `UPDATE store_orders
          SET user_id = $1,
              updated_at = now()
        WHERE user_id IS NULL
          AND email = $2`,
      [userId, email],
    );
    return result.rowCount ?? 0;
  } catch (error) {
    // store_orders may not exist yet in environments where store-api hasn't
    // been deployed. Swallow that case; surface unexpected errors so we know.
    if (error?.code === '42P01') {
      return 0;
    }
    errorLogger(
      JSON.stringify({
        level: "ERROR",
        message: "Failed to link guest orders to new user",
        userId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return 0;
  }
}

async function provisionShellUser(context, createClient, errorLogger) {
  const client = createClient();
  await client.connect();

  try {
    const result = await client.query(
      `INSERT INTO users (id, email, first_name, last_name, display_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE
         SET email = COALESCE(users.email, EXCLUDED.email),
             first_name = COALESCE(users.first_name, EXCLUDED.first_name),
             last_name = COALESCE(users.last_name, EXCLUDED.last_name),
             display_name = COALESCE(users.display_name, EXCLUDED.display_name),
             updated_at = now()
       RETURNING xmax = 0 AS inserted`,
      [
        context.userId,
        context.email,
        context.givenName,
        context.familyName,
        context.fullName,
      ],
    );

    const inserted = Boolean(result.rows[0]?.inserted);
    const linkedOrders = await linkGuestOrders(
      client,
      { userId: context.userId, email: context.email },
      errorLogger,
    );

    return { inserted, linkedOrders };
  } finally {
    await client.end();
  }
}

export function createHandler({
  createClient = () =>
    new pg.Client({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    }),
  eventBridgeClient = new EventBridgeClient({}),
  logger = console.log,
  errorLogger = console.error,
} = {}) {
  return async function handler(event) {
    const context = extractSignupContext(event);

    if (!context.supported) {
      logger(
        JSON.stringify({
          level: "WARN",
          message: "Skipping unsupported Cognito trigger",
          correlationId: context.correlationId,
          triggerSource: context.triggerSource ?? "unknown",
        }),
      );
      return event;
    }

    const { inserted, linkedOrders } = await provisionShellUser(
      context,
      createClient,
      errorLogger,
    );

    logger(
      JSON.stringify({
        level: "INFO",
        message: "Provisioned foundation shell user after Cognito post-confirmation",
        correlationId: context.correlationId,
        triggerSource: context.triggerSource,
        userId: context.userId,
        hasEmail: context.email !== null,
        inserted,
        linkedOrders,
      }),
    );

    if (inserted) {
      try {
        await publishSignupEvent(context, eventBridgeClient, logger);
      } catch (error) {
        errorLogger(
          JSON.stringify({
            level: "ERROR",
            message: "Failed to publish foundation signup event",
            correlationId: context.correlationId,
            userId: context.userId,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }

    return event;
  };
}

export const handler = createHandler();
