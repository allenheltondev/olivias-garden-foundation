import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  POST_CONFIRMATION_TRIGGERS,
  SIGNUP_NOTIFICATION_TRIGGERS,
  buildSlackPayload,
  createHandler,
  extractSignupContext,
} from "../post-confirmation.mjs";

function buildEvent(overrides = {}) {
  return {
    triggerSource: "PostConfirmation_ConfirmSignUp",
    request: {
      clientMetadata: { correlationId: "corr-123" },
      userAttributes: {
        sub: "11111111-1111-1111-1111-111111111111",
        email: "new-user@example.com",
        given_name: "Olivia",
        family_name: "Garden",
        "custom:newsletter_opt_in": "true",
      },
    },
    ...overrides,
  };
}

describe("post-confirmation trigger sets", () => {
  it("accepts supported post-confirmation triggers", () => {
    assert.ok(POST_CONFIRMATION_TRIGGERS.has("PostConfirmation_ConfirmSignUp"));
    assert.ok(POST_CONFIRMATION_TRIGGERS.has("PostConfirmation_AdminConfirmSignUp"));
    assert.ok(POST_CONFIRMATION_TRIGGERS.has("PostConfirmation_ConfirmForgotPassword"));
  });

  it("limits Slack notifications to signup confirmations", () => {
    assert.ok(SIGNUP_NOTIFICATION_TRIGGERS.has("PostConfirmation_ConfirmSignUp"));
    assert.ok(!SIGNUP_NOTIFICATION_TRIGGERS.has("PostConfirmation_ConfirmForgotPassword"));
  });
});

describe("extractSignupContext", () => {
  it("extracts user details and newsletter opt-in", () => {
    const context = extractSignupContext(buildEvent());
    assert.equal(context.supported, true);
    assert.equal(context.userId, "11111111-1111-1111-1111-111111111111");
    assert.equal(context.email, "new-user@example.com");
    assert.equal(context.fullName, "Olivia Garden");
    assert.equal(context.newsletterOptIn, true);
  });

  it("supports snake_case correlation ids", () => {
    const context = extractSignupContext(
      buildEvent({
        request: {
          clientMetadata: { correlation_id: "corr-456" },
          userAttributes: { sub: "22222222-2222-2222-2222-222222222222" },
        },
      }),
    );

    assert.equal(context.correlationId, "corr-456");
  });

  it("returns unsupported for non-post-confirmation triggers", () => {
    const context = extractSignupContext(buildEvent({ triggerSource: "PreSignUp_SignUp" }));
    assert.equal(context.supported, false);
  });

  it("throws when sub is missing", () => {
    assert.throws(
      () =>
        extractSignupContext(
          buildEvent({
            request: {
              userAttributes: { email: "missing-sub@example.com" },
            },
          }),
        ),
      /Missing userAttributes\.sub/,
    );
  });
});

describe("buildSlackPayload", () => {
  it("includes the key signup details", () => {
    const payload = buildSlackPayload(extractSignupContext(buildEvent()));
    assert.match(payload.text, /New foundation signup/);
    assert.match(payload.text, /Olivia Garden/);
    assert.match(payload.text, /Newsletter opt-in: yes/);
  });
});

describe("createHandler", () => {
  it("provisions the shell user and posts Slack for new signups", async () => {
    const queries = [];
    let slackCalled = false;

    const handler = createHandler({
      createClient: () => ({
        connect: async () => {},
        query: async (sql, params) => {
          queries.push({ sql, params });
          return { rows: [{ inserted: true }] };
        },
        end: async () => {},
      }),
      fetchImpl: async () => {
        slackCalled = true;
        return { ok: true };
      },
      slackWebhookUrl: "https://hooks.slack.test/example",
      logger: () => {},
      errorLogger: () => {},
    });

    const event = buildEvent();
    const result = await handler(event);

    assert.equal(result, event);
    assert.equal(queries.length, 1);
    assert.equal(queries[0].params[0], "11111111-1111-1111-1111-111111111111");
    assert.equal(slackCalled, true);
  });

  it("skips Slack when the user already exists", async () => {
    let slackCalled = false;

    const handler = createHandler({
      createClient: () => ({
        connect: async () => {},
        query: async () => ({ rows: [{ inserted: false }] }),
        end: async () => {},
      }),
      fetchImpl: async () => {
        slackCalled = true;
        return { ok: true };
      },
      slackWebhookUrl: "https://hooks.slack.test/example",
      logger: () => {},
      errorLogger: () => {},
    });

    await handler(buildEvent());
    assert.equal(slackCalled, false);
  });

  it("does not let Slack failures fail the Cognito flow", async () => {
    let errorLogged = false;

    const handler = createHandler({
      createClient: () => ({
        connect: async () => {},
        query: async () => ({ rows: [{ inserted: true }] }),
        end: async () => {},
      }),
      fetchImpl: async () => ({ ok: false, status: 500, text: async () => "boom" }),
      slackWebhookUrl: "https://hooks.slack.test/example",
      logger: () => {},
      errorLogger: () => {
        errorLogged = true;
      },
    });

    const event = buildEvent();
    const result = await handler(event);

    assert.equal(result, event);
    assert.equal(errorLogged, true);
  });

  it("skips unsupported triggers", async () => {
    let queryCalled = false;

    const handler = createHandler({
      createClient: () => ({
        connect: async () => {},
        query: async () => {
          queryCalled = true;
          return { rows: [] };
        },
        end: async () => {},
      }),
      logger: () => {},
      errorLogger: () => {},
    });

    const result = await handler(buildEvent({ triggerSource: "PreSignUp_SignUp" }));
    assert.equal(result.triggerSource, "PreSignUp_SignUp");
    assert.equal(queryCalled, false);
  });
});
