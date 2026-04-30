function truncate(text, limit) {
  if (typeof text !== 'string') return null;
  const normalized = text.trim();
  if (!normalized) return null;
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 3)}...`;
}

function escapeSlackMrkdwn(text) {
  if (typeof text !== 'string') return text;
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function formatCoordinate(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(5) : 'n/a';
}

function adminUrl(suffix) {
  const base = process.env.ADMIN_FRONTEND_URL?.trim();
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}${suffix}`;
}

function orgTypeLabel(type) {
  const map = {
    'food-pantry': 'Food pantry',
    shelter: 'Shelter',
    school: 'School or youth program',
    'mutual-aid': 'Mutual aid / community fridge',
    faith: 'Faith community',
    other: 'Other'
  };
  return map[type] ?? (type || 'Unspecified');
}

function formatMoney(amountCents, currency) {
  const amount = (Number(amountCents ?? 0) / 100).toFixed(2);
  return `${String(currency ?? 'usd').toUpperCase()} ${amount}`;
}

function renderOkraSubmissionCreated(detail) {
  const contributorName = escapeSlackMrkdwn(truncate(detail.contributorName, 120) ?? 'Anonymous contributor');
  const contributorEmail = escapeSlackMrkdwn(truncate(detail.contributorEmail, 160) ?? 'No email provided');
  const storyText = escapeSlackMrkdwn(truncate(detail.storyText, 1500) ?? 'No story provided.');
  const rawLocationText = escapeSlackMrkdwn(truncate(detail.rawLocationText, 300) ?? 'No location provided.');
  const reviewUrl = adminUrl(`/okra-queue?submission=${encodeURIComponent(detail.submissionId ?? '')}`);

  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: '*:pushpin: New okra submission awaiting review*' } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Contributor*\n${contributorName}` },
        { type: 'mrkdwn', text: `*Email*\n${contributorEmail}` },
        { type: 'mrkdwn', text: `*Submitted*\n${detail.createdAt ?? 'Unknown'}` },
        { type: 'mrkdwn', text: `*Privacy*\n${detail.privacyMode ?? 'city'}` },
        { type: 'mrkdwn', text: `*Raw location*\n${rawLocationText}` },
        { type: 'mrkdwn', text: `*Coordinates*\n${formatCoordinate(detail.displayLat)}, ${formatCoordinate(detail.displayLng)}` }
      ]
    },
    { type: 'section', text: { type: 'mrkdwn', text: `*Story*\n${storyText}` } }
  ];

  if (Array.isArray(detail.photoUrls)) {
    for (const [index, url] of detail.photoUrls.entries()) {
      if (typeof url !== 'string' || !url.trim()) continue;
      blocks.push({ type: 'image', image_url: url, alt_text: `Okra submission photo ${index + 1}` });
    }
  }

  const photoCount = Array.isArray(detail.photoUrls) ? detail.photoUrls.length : 0;
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `Submission ID: \`${detail.submissionId}\` - Photos included: ${photoCount}` }]
  });

  if (reviewUrl) {
    blocks.push({
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: 'Open review queue', emoji: true },
        url: reviewUrl,
        style: 'primary'
      }]
    });
  }

  return {
    summary: `New okra submission from ${contributorName}`,
    slack: {
      text: `*:pushpin: New okra submission awaiting review*\nContributor: ${contributorName}`,
      blocks
    }
  };
}

function renderSeedRequestCreated(detail) {
  const lines = ['*:clipboard: New okra seed request*'];
  lines.push(`Name: ${detail.name ?? 'Unknown'}`);
  lines.push(`Email: ${detail.email ?? 'Unknown'}`);
  if (detail.fulfillmentMethod === 'mail') {
    const a = detail.shippingAddress ?? {};
    const addressLine = [a.line1, a.line2].filter(Boolean).join(', ');
    lines.push('Fulfillment: Mail');
    lines.push(`Address: ${addressLine}, ${a.city}, ${a.region} ${a.postalCode}, ${a.country}`);
  } else {
    lines.push('Fulfillment: In-person exchange');
    if (detail.visitDetails?.approximateDate) lines.push(`Visiting: ${detail.visitDetails.approximateDate}`);
    if (detail.visitDetails?.notes) lines.push(`Notes: ${detail.visitDetails.notes}`);
  }
  if (detail.message) lines.push(`Message: ${detail.message}`);

  return {
    summary: `New seed request from ${detail.name ?? 'unknown'}`,
    slack: { text: lines.join('\n') }
  };
}

function renderDonationCompleted(detail) {
  const mode = detail.mode === 'recurring' ? 'Garden Club' : 'One-time';
  const amount = formatMoney(detail.amountCents, detail.currency);
  const lines = [':sunflower: New donation', `Mode: ${mode}`, `Amount: ${amount}`];
  if (detail.anonymous) lines.push('Donor: Anonymous');
  if (detail.donorName) lines.push(`Donor: ${detail.donorName}`);
  if (detail.donorEmail) lines.push(`Email: ${detail.donorEmail}`);
  if (detail.dedicationName) lines.push(`Bee nameplate: ${detail.dedicationName}`);
  if (detail.tShirtPreference) lines.push(`T-shirt choice: ${detail.tShirtPreference}`);
  lines.push('Gift includes a permanent acrylic bee placed in the garden.');

  const donor = detail.anonymous ? 'Anonymous donor' : (detail.donorName || detail.donorEmail || 'donor');
  return {
    summary: `${mode} donation: ${amount} (${donor})`,
    slack: { text: lines.join('\n') }
  };
}

function formatCancelDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function renderGardenClubCancellationScheduled(detail) {
  const donor = detail.donorEmail ?? 'unknown donor';
  const cancelDate = formatCancelDate(detail.cancelAt);
  const lines = [':calendar: Garden Club cancellation scheduled', `Donor: ${donor}`];
  if (cancelDate) lines.push(`Ends on: ${cancelDate}`);
  lines.push(`Subscription: ${detail.stripeSubscriptionId ?? 'unknown'}`);

  return {
    summary: `Garden Club cancellation scheduled for ${donor}${cancelDate ? ` (ends ${cancelDate})` : ''}`,
    slack: { text: lines.join('\n') }
  };
}

function renderGardenClubCancellationReverted(detail) {
  const donor = detail.donorEmail ?? 'unknown donor';
  const lines = [
    ':seedling: Garden Club cancellation reverted',
    `Donor: ${donor}`,
    `Subscription: ${detail.stripeSubscriptionId ?? 'unknown'}`
  ];

  return {
    summary: `Garden Club cancellation reverted for ${donor}`,
    slack: { text: lines.join('\n') }
  };
}

function renderGardenClubCanceled(detail) {
  const donor = detail.donorEmail ?? 'unknown donor';
  const lines = [
    ':wave: Garden Club ended',
    `Donor: ${donor}`,
    `Subscription: ${detail.stripeSubscriptionId ?? 'unknown'}`
  ];

  return {
    summary: `Garden Club ended for ${donor}`,
    slack: { text: lines.join('\n') }
  };
}

function renderUserSignedUp(detail) {
  const env = process.env.FOUNDATION_ENVIRONMENT ?? 'unknown';
  const lines = [
    '*:boom: New foundation signup*',
    `Environment: ${env}`,
    `Email: ${detail.email ?? 'missing'}`,
    `User ID: ${detail.userId}`,
    `Newsletter opt-in: ${detail.newsletterOptIn ? 'yes' : 'no'}`
  ];
  if (detail.fullName) lines.splice(2, 0, `Name: ${detail.fullName}`);

  const who = detail.fullName || detail.email || detail.userId;
  return {
    summary: `New signup: ${who}`,
    slack: { text: lines.join('\n') }
  };
}

function renderOrgInquiryReceived(detail) {
  const orgName = (detail.orgName ?? '').trim() || '(no organization name)';
  const lines = [
    ':seedling: New Good Roots org inquiry',
    `Organization: ${orgName} (${orgTypeLabel(detail.orgType)})`,
    `Contact: ${detail.contactName ?? 'unknown'} <${detail.email ?? 'unknown'}>`
  ];
  if (detail.phone) lines.push(`Phone: ${detail.phone}`);
  const location = [detail.city, detail.state].filter(Boolean).join(', ');
  if (location) lines.push(`Location: ${location}`);
  if (detail.message) lines.push('', detail.message);

  return {
    summary: `Good Roots inquiry from ${orgName}`,
    slack: { text: lines.join('\n') }
  };
}

function renderGeneralInquiryReceived(detail) {
  const contact = detail.contactName ?? 'unknown';
  const lines = [
    ':email: New website contact message',
    `Contact: ${contact} <${detail.email ?? 'unknown'}>`
  ];
  if (detail.referral) lines.push(`Referral: ${detail.referral}`);
  if (detail.message) lines.push('', detail.message);

  return {
    summary: `Website contact from ${contact}`,
    slack: { text: lines.join('\n') }
  };
}

const renderers = new Map([
  ['okra.submissions|submission.created', renderOkraSubmissionCreated],
  ['okra.seed-requests|seed-request.created', renderSeedRequestCreated],
  ['ogf.donations|donation.completed', renderDonationCompleted],
  ['ogf.donations|garden-club.cancellation_scheduled', renderGardenClubCancellationScheduled],
  ['ogf.donations|garden-club.cancellation_reverted', renderGardenClubCancellationReverted],
  ['ogf.donations|garden-club.canceled', renderGardenClubCanceled],
  ['ogf.signups|user.signed-up', renderUserSignedUp],
  ['ogf.contact|org-inquiry.received', renderOrgInquiryReceived],
  ['ogf.contact|general-inquiry.received', renderGeneralInquiryReceived]
]);

export function renderEvent(source, detailType, detail) {
  const renderer = renderers.get(`${source}|${detailType}`);
  if (!renderer) return null;
  return renderer(detail ?? {});
}

export function isContactEvent(source) {
  return source === 'ogf.contact';
}
