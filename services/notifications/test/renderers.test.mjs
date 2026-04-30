import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderEvent, isContactEvent } from '../src/services/renderers.mjs';

describe('renderEvent', () => {
  const originalAdminUrl = process.env.ADMIN_FRONTEND_URL;
  const originalEnv = process.env.FOUNDATION_ENVIRONMENT;

  beforeEach(() => {
    process.env.ADMIN_FRONTEND_URL = 'https://admin.example.com';
    process.env.FOUNDATION_ENVIRONMENT = 'staging';
  });

  afterEach(() => {
    process.env.ADMIN_FRONTEND_URL = originalAdminUrl;
    process.env.FOUNDATION_ENVIRONMENT = originalEnv;
  });

  it('returns null for unregistered (source, detailType) pairs', () => {
    expect(renderEvent('okra.submissions', 'submission.edit_submitted', {})).toBeNull();
    expect(renderEvent('something.else', 'whatever', {})).toBeNull();
  });

  it('renders an okra submission with photos and a deep-link review button', () => {
    const result = renderEvent('okra.submissions', 'submission.created', {
      submissionId: 'sub-1',
      contributorName: 'Olivia',
      contributorEmail: 'olivia@example.com',
      storyText: 'A short okra story.',
      rawLocationText: 'Austin, TX',
      privacyMode: 'city',
      displayLat: 30.27,
      displayLng: -97.74,
      photoUrls: ['https://cdn.example.com/p1.jpg', 'https://cdn.example.com/p2.jpg']
    });

    expect(result.summary).toBe('New okra submission from Olivia');
    expect(result.slack.text).toContain('New okra submission');
    expect(result.slack.blocks.some((b) => b.type === 'image' && b.image_url === 'https://cdn.example.com/p1.jpg')).toBe(true);
    const button = result.slack.blocks.find((b) => b.type === 'actions');
    expect(button.elements[0].url).toBe('https://admin.example.com/okra-queue?submission=sub-1');
  });

  it('omits the review button when no admin frontend URL is configured', () => {
    delete process.env.ADMIN_FRONTEND_URL;
    const result = renderEvent('okra.submissions', 'submission.created', { submissionId: 'sub-2' });
    expect(result.slack.blocks.some((b) => b.type === 'actions')).toBe(false);
  });

  it('does not leak contributor identifiers in seed-request rendering', () => {
    const result = renderEvent('okra.seed-requests', 'seed-request.created', {
      name: 'Olivia',
      email: 'olivia@example.com',
      fulfillmentMethod: 'mail',
      shippingAddress: { line1: '100 Garden Ln', city: 'Austin', region: 'TX', postalCode: '73301', country: 'US' },
      contributorCognitoSub: 'cog-123'
    });

    expect(result.summary).toBe('New seed request from Olivia');
    expect(result.slack.text).toContain('Fulfillment: Mail');
    expect(result.slack.text).toContain('Address: 100 Garden Ln, Austin, TX 73301, US');
    expect(result.slack.text).not.toContain('cog-123');
  });

  it('renders donations with mode-specific labels and money formatting', () => {
    const oneTime = renderEvent('ogf.donations', 'donation.completed', {
      mode: 'one_time',
      amountCents: 5000,
      currency: 'usd',
      donorName: 'Olivia Donor',
      donorEmail: 'donor@example.com'
    });
    expect(oneTime.summary).toBe('One-time donation: USD 50.00 (Olivia Donor)');
    expect(oneTime.slack.text).toContain('Mode: One-time');
    expect(oneTime.slack.text).toContain('Amount: USD 50.00');

    const recurring = renderEvent('ogf.donations', 'donation.completed', {
      mode: 'recurring',
      amountCents: 1500,
      currency: 'usd'
    });
    expect(recurring.summary).toBe('Garden Club donation: USD 15.00 (donor)');
    expect(recurring.slack.text).toContain('Mode: Garden Club');
  });

  it('marks anonymous donations and skips donor identifiers', () => {
    const result = renderEvent('ogf.donations', 'donation.completed', {
      mode: 'one_time',
      amountCents: 2500,
      currency: 'usd',
      anonymous: true,
      dedicationName: 'Anonymous donor'
    });
    expect(result.summary).toBe('One-time donation: USD 25.00 (Anonymous donor)');
    expect(result.slack.text).toContain('Donor: Anonymous');
    expect(result.slack.text).not.toContain('Email:');
    expect(result.slack.text).toContain('Bee nameplate: Anonymous donor');
  });

  it('renders signups using the consumer FOUNDATION_ENVIRONMENT', () => {
    const result = renderEvent('ogf.signups', 'user.signed-up', {
      userId: 'user-1',
      email: 'new@example.com',
      fullName: 'New User',
      newsletterOptIn: true
    });
    expect(result.summary).toBe('New signup: New User');
    expect(result.slack.text).toContain('Environment: staging');
    expect(result.slack.text).toContain('Name: New User');
    expect(result.slack.text).toContain('Newsletter opt-in: yes');
  });

  it('renders Good Roots org inquiries with org-type label and optional fields', () => {
    const result = renderEvent('ogf.contact', 'org-inquiry.received', {
      orgName: 'Harvest House',
      orgType: 'food-pantry',
      contactName: 'Jordan Rivers',
      email: 'jordan@harvesthouse.org',
      city: 'McKinney',
      state: 'TX',
      message: 'We feed 200 families a week.'
    });

    expect(result.summary).toBe('Good Roots inquiry from Harvest House');
    expect(result.slack.text).toContain('Organization: Harvest House (Food pantry)');
    expect(result.slack.text).toContain('Location: McKinney, TX');
    expect(result.slack.text).toContain('We feed 200 families a week.');
  });

  it('falls back to a placeholder org name and omits empty location', () => {
    const result = renderEvent('ogf.contact', 'org-inquiry.received', {
      contactName: 'Jordan',
      email: 'jordan@example.com'
    });
    expect(result.summary).toContain('(no organization name)');
    expect(result.slack.text).not.toContain('Location:');
  });

  it('renders Garden Club cancellation_scheduled with formatted end date', () => {
    const result = renderEvent('ogf.donations', 'garden-club.cancellation_scheduled', {
      donorEmail: 'donor@example.com',
      stripeSubscriptionId: 'sub_123',
      cancelAt: '2027-05-15T00:00:00.000Z'
    });
    expect(result.summary).toBe('Garden Club cancellation scheduled for donor@example.com (ends May 14, 2027)');
    expect(result.slack.text).toContain('Donor: donor@example.com');
    expect(result.slack.text).toContain('Ends on: May 14, 2027');
  });

  it('renders Garden Club cancellation_reverted', () => {
    const result = renderEvent('ogf.donations', 'garden-club.cancellation_reverted', {
      donorEmail: 'donor@example.com',
      stripeSubscriptionId: 'sub_123'
    });
    expect(result.summary).toBe('Garden Club cancellation reverted for donor@example.com');
    expect(result.slack.text).toContain('Subscription: sub_123');
  });

  it('renders Garden Club canceled', () => {
    const result = renderEvent('ogf.donations', 'garden-club.canceled', {
      donorEmail: 'donor@example.com',
      stripeSubscriptionId: 'sub_123'
    });
    expect(result.summary).toBe('Garden Club ended for donor@example.com');
    expect(result.slack.text).toContain('Garden Club ended');
  });
});

describe('isContactEvent', () => {
  it('only returns true for ogf.contact', () => {
    expect(isContactEvent('ogf.contact')).toBe(true);
    expect(isContactEvent('ogf.signups')).toBe(false);
  });
});
