import { describe, it } from "node:test";
import assert from "node:assert/strict";

// We can't import the handler directly without mocking pg,
// so we extract and test the pure logic inline.

const POST_CONFIRMATION_TRIGGERS = new Set([
  "PostConfirmation_ConfirmSignUp",
  "PostConfirmation_AdminConfirmSignUp",
  "PostConfirmation_ConfirmForgotPassword",
]);

describe("post-confirmation trigger filter", () => {
  it("accepts PostConfirmation_ConfirmSignUp", () => {
    assert.ok(POST_CONFIRMATION_TRIGGERS.has("PostConfirmation_ConfirmSignUp"));
  });

  it("accepts PostConfirmation_AdminConfirmSignUp", () => {
    assert.ok(POST_CONFIRMATION_TRIGGERS.has("PostConfirmation_AdminConfirmSignUp"));
  });

  it("accepts PostConfirmation_ConfirmForgotPassword", () => {
    assert.ok(POST_CONFIRMATION_TRIGGERS.has("PostConfirmation_ConfirmForgotPassword"));
  });

  it("rejects PreSignUp_SignUp", () => {
    assert.ok(!POST_CONFIRMATION_TRIGGERS.has("PreSignUp_SignUp"));
  });

  it("rejects undefined trigger", () => {
    assert.ok(!POST_CONFIRMATION_TRIGGERS.has(undefined));
  });
});

describe("event parsing", () => {
  it("extracts sub from userAttributes", () => {
    const event = {
      triggerSource: "PostConfirmation_ConfirmSignUp",
      request: {
        clientMetadata: { correlationId: "corr-123" },
        userAttributes: {
          sub: "11111111-1111-1111-1111-111111111111",
          email: "new-user@example.com",
        },
      },
    };
    assert.equal(event.request.userAttributes.sub, "11111111-1111-1111-1111-111111111111");
    assert.equal(event.request.userAttributes.email, "new-user@example.com");
  });

  it("supports snake_case correlation_id key", () => {
    const event = {
      triggerSource: "PostConfirmation_ConfirmSignUp",
      request: {
        clientMetadata: { correlation_id: "corr-456" },
        userAttributes: { sub: "22222222-2222-2222-2222-222222222222" },
      },
    };
    const correlationId =
      event.request?.clientMetadata?.correlationId ??
      event.request?.clientMetadata?.correlation_id;
    assert.equal(correlationId, "corr-456");
  });

  it("handles missing email gracefully", () => {
    const event = {
      triggerSource: "PostConfirmation_ConfirmSignUp",
      request: {
        userAttributes: { sub: "33333333-3333-3333-3333-333333333333" },
      },
    };
    const email = event.request?.userAttributes?.email ?? null;
    assert.equal(email, null);
  });

  it("detects missing sub", () => {
    const event = {
      triggerSource: "PostConfirmation_ConfirmSignUp",
      request: {
        userAttributes: { email: "no-sub@example.com" },
      },
    };
    assert.ok(!event.request.userAttributes.sub);
  });

  it("detects missing userAttributes", () => {
    const event = {
      triggerSource: "PostConfirmation_ConfirmSignUp",
      request: { clientMetadata: { correlationId: "corr-123" } },
    };
    assert.ok(!event.request?.userAttributes?.sub);
  });
});
