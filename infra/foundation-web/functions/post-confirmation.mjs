import pg from "pg";
import { randomUUID } from "node:crypto";

const { DATABASE_URL, SLACK_WEBHOOK_URL, FOUNDATION_ENVIRONMENT = "unknown" } = process.env;

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

  const givenName = attributes.given_name?.trim() || null;
  const familyName = attributes.family_name?.trim() || null;
  const fullName = [givenName, familyName].filter(Boolean).join(" ").trim() || null;

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

export function buildSlackPayload(context, foundationEnvironment = FOUNDATION_ENVIRONMENT) {
  const lines = [
    ":seedling: New foundation signup",
    `Environment: ${foundationEnvironment}`,
    `Email: ${context.email ?? "missing"}`,
    `User ID: ${context.userId}`,
    `Newsletter opt-in: ${context.newsletterOptIn ? "yes" : "no"}`,
  ];

  if (context.fullName) {
    lines.splice(2, 0, `Name: ${context.fullName}`);
  }

  return {
    text: lines.join("\n"),
  };
}

async function notifySlack(context, fetchImpl, logger, { slackWebhookUrl, foundationEnvironment }) {
  if (!slackWebhookUrl || !SIGNUP_NOTIFICATION_TRIGGERS.has(context.triggerSource)) {
    return;
  }

  const response = await fetchImpl(slackWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildSlackPayload(context, foundationEnvironment)),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Slack webhook returned ${response.status}${body ? `: ${body}` : ""}`);
  }

  logger(
    JSON.stringify({
      level: "INFO",
      message: "Delivered foundation signup Slack notification",
      correlationId: context.correlationId,
      userId: context.userId,
    }),
  );
}

async function provisionShellUser(context, createClient) {
  const client = createClient();
  await client.connect();

  try {
    const result = await client.query(
      `INSERT INTO users (id, email)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE
         SET email = COALESCE(users.email, EXCLUDED.email)
       RETURNING xmax = 0 AS inserted`,
      [context.userId, context.email],
    );

    return Boolean(result.rows[0]?.inserted);
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
  fetchImpl = fetch,
  logger = console.log,
  errorLogger = console.error,
  slackWebhookUrl = SLACK_WEBHOOK_URL,
  foundationEnvironment = FOUNDATION_ENVIRONMENT,
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

    const inserted = await provisionShellUser(context, createClient);

    logger(
      JSON.stringify({
        level: "INFO",
        message: "Provisioned foundation shell user after Cognito post-confirmation",
        correlationId: context.correlationId,
        triggerSource: context.triggerSource,
        userId: context.userId,
        hasEmail: context.email !== null,
        inserted,
      }),
    );

    if (inserted) {
      try {
        await notifySlack(context, fetchImpl, logger, { slackWebhookUrl, foundationEnvironment });
      } catch (error) {
        errorLogger(
          JSON.stringify({
            level: "ERROR",
            message: "Failed to deliver foundation signup Slack notification",
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
