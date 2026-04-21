import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveOptionalAuthContextMock = vi.fn();
const createDbClientMock = vi.fn();

vi.mock('../src/services/auth.mjs', () => ({
  resolveOptionalAuthContext: resolveOptionalAuthContextMock,
}));

vi.mock('../scripts/db-client.mjs', () => ({
  createDbClient: createDbClientMock,
}));

const { createDonationCheckoutSession, handleEventBridgeEvent } = await import('../src/services/donations.mjs');

describe('donations service', () => {
  beforeEach(() => {
    resolveOptionalAuthContextMock.mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.SLACK_WEBHOOK_URL;
    delete process.env.DATABASE_URL;
  });

  it('prefills checkout with a Stripe customer and includes the bee dedication in the description', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';

    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'cus_123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'cs_123', client_secret: 'cs_secret_123' }),
      });

    const result = await createDonationCheckoutSession(
      {
        mode: 'one_time',
        amountCents: 5000,
        returnUrl: 'https://oliviasgarden.org/donate?session_id={CHECKOUT_SESSION_ID}',
        donorName: 'Olivia Donor',
        donorEmail: 'donor@example.com',
        dedicationName: 'Grandma June',
      },
      { headers: {} },
      'corr-123',
    );

    expect(result).toEqual({
      clientSecret: 'cs_secret_123',
      checkoutSessionId: 'cs_123',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [customerUrl, customerOptions] = fetchMock.mock.calls[0];
    expect(customerUrl).toBe('https://api.stripe.com/v1/customers');
    expect(customerOptions.method).toBe('POST');
    const customerParams = customerOptions.body;
    expect(customerParams).toBeInstanceOf(URLSearchParams);
    expect(customerParams.get('email')).toBe('donor@example.com');
    expect(customerParams.get('name')).toBe('Olivia Donor');
    expect(customerParams.get('metadata[dedication_name]')).toBe('Grandma June');

    const [checkoutUrl, checkoutOptions] = fetchMock.mock.calls[1];
    expect(checkoutUrl).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(checkoutOptions.method).toBe('POST');
    const checkoutParams = checkoutOptions.body;
    expect(checkoutParams).toBeInstanceOf(URLSearchParams);
    expect(checkoutParams.get('ui_mode')).toBe('embedded_page');
    expect(checkoutParams.get('customer')).toBe('cus_123');
    expect(checkoutParams.get('customer_email')).toBeNull();
    expect(checkoutParams.get('line_items[0][price_data][product_data][description]')).toContain('Bee dedication: Grandma June.');
  });

  it('falls back to customer_email when Stripe customer prefill creation fails', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';

    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'no customer' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'cs_123', client_secret: 'cs_secret_123' }),
      });

    await createDonationCheckoutSession(
      {
        mode: 'recurring',
        amountCents: 2500,
        returnUrl: 'https://oliviasgarden.org/donate?session_id={CHECKOUT_SESSION_ID}',
        donorName: 'Olivia Donor',
        donorEmail: 'donor@example.com',
        dedicationName: 'Olivia',
        tShirtPreference: 'Medium',
      },
      { headers: {} },
      'corr-456',
    );

    const [, checkoutOptions] = fetchMock.mock.calls[1];
    const checkoutParams = checkoutOptions.body;
    expect(checkoutParams.get('customer')).toBeNull();
    expect(checkoutParams.get('customer_email')).toBe('donor@example.com');
    expect(checkoutParams.get('metadata[t_shirt_preference]')).toBe('Medium');
    expect(checkoutParams.get('line_items[0][price_data][product_data][description]')).toContain('Bee dedication: Olivia.');
  });

  it('does not prefill donor identity from auth context when anonymous donation is requested', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    resolveOptionalAuthContextMock.mockResolvedValue({
      userId: 'cf399090-0f65-4d15-bd10-50944ce0ff9b',
      name: 'Signed In Donor',
      email: 'signed-in@example.com',
    });

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'cs_anon_123', client_secret: 'cs_secret_anon_123' }),
    });

    const result = await createDonationCheckoutSession(
      {
        mode: 'one_time',
        amountCents: 2500,
        returnUrl: 'https://oliviasgarden.org/donate?session_id={CHECKOUT_SESSION_ID}',
        anonymousDonation: true,
        dedicationName: 'Anonymous donor',
      },
      { headers: {} },
      'corr-anon-123',
    );

    expect(result).toEqual({
      clientSecret: 'cs_secret_anon_123',
      checkoutSessionId: 'cs_anon_123',
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    const [checkoutUrl, checkoutOptions] = fetchMock.mock.calls[0];
    expect(checkoutUrl).toBe('https://api.stripe.com/v1/checkout/sessions');
    const checkoutParams = checkoutOptions.body;
    expect(checkoutParams.get('metadata[anonymous_donation]')).toBe('true');
    expect(checkoutParams.get('metadata[user_id]')).toBe('cf399090-0f65-4d15-bd10-50944ce0ff9b');
    expect(checkoutParams.get('metadata[donor_name]')).toBeNull();
    expect(checkoutParams.get('metadata[donor_email]')).toBeNull();
    expect(checkoutParams.get('customer')).toBeNull();
    expect(checkoutParams.get('customer_email')).toBeNull();
  });

  it('sends a Slack notification with donation details after checkout.session.completed from EventBridge', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/services/abc';

    const queryMock = vi.fn((sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') {
        return Promise.resolve({ rowCount: null });
      }

      return Promise.resolve({ rowCount: 1 });
    });
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      end: vi.fn().mockResolvedValue(undefined),
      query: queryMock,
    };
    createDbClientMock.mockResolvedValue(client);

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await handleEventBridgeEvent({
      id: 'evtbridge-123',
      'detail-type': 'checkout.session.completed',
      detail: {
        id: 'evt_123',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_123',
            payment_intent: 'pi_123',
            customer: 'cus_123',
            subscription: null,
            amount_total: 5000,
            currency: 'usd',
            metadata: {
              donation_mode: 'one_time',
              donor_name: 'Olivia Donor',
              donor_email: 'donor@example.com',
              dedication_name: 'Grandma June',
            },
          },
        },
      },
    });

    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.end).toHaveBeenCalledOnce();
    expect(queryMock).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(queryMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('insert into donation_events'),
      [
        'evt_123',
        'cs_123',
        'pi_123',
        'cus_123',
        null,
        null,
        'one_time',
        5000,
        'usd',
        'Olivia Donor',
        'donor@example.com',
        'Grandma June',
        null,
      ],
    );
    expect(queryMock).toHaveBeenNthCalledWith(3, 'COMMIT');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.slack.test/services/abc',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
    );
    const slackBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(slackBody.text).toContain(':sunflower: New donation');
    expect(slackBody.text).toContain('Mode: One-time');
    expect(slackBody.text).toContain('Amount: USD 50.00');
    expect(slackBody.text).toContain('Donor: Olivia Donor');
    expect(slackBody.text).toContain('Email: donor@example.com');
  });

  it('marks anonymous donations explicitly in Slack notifications', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/services/abc';

    const queryMock = vi.fn((sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') {
        return Promise.resolve({ rowCount: null });
      }

      return Promise.resolve({ rowCount: 1 });
    });
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      end: vi.fn().mockResolvedValue(undefined),
      query: queryMock,
    };
    createDbClientMock.mockResolvedValue(client);

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await handleEventBridgeEvent({
      id: 'evtbridge-456',
      'detail-type': 'checkout.session.completed',
      detail: {
        id: 'evt_456',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_456',
            payment_intent: 'pi_456',
            customer: 'cus_456',
            subscription: null,
            amount_total: 2500,
            currency: 'usd',
            metadata: {
              donation_mode: 'one_time',
              anonymous_donation: 'true',
              dedication_name: 'Anonymous donor',
            },
          },
        },
      },
    });

    const slackBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(slackBody.text).toContain('Donor: Anonymous');
    expect(slackBody.text).not.toContain('Email:');
    expect(slackBody.text).toContain('Bee nameplate: Anonymous donor');
  });
});
