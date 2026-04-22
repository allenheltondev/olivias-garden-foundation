function truncate(text, limit) {
  if (typeof text !== 'string') {
    return null;
  }

  const normalized = text.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit - 3)}...`;
}

function formatCoordinate(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(5) : 'n/a';
}

function buildAdminReviewUrl(submissionId) {
  const baseUrl = process.env.OKRA_ADMIN_FRONTEND_URL?.trim();
  if (!baseUrl) {
    return null;
  }

  const normalizedBase = baseUrl.replace(/\/+$/, '');
  return `${normalizedBase}/?submission=${encodeURIComponent(submissionId)}`;
}

function buildSlackPayload(detail) {
  const contributorName = truncate(detail.contributorName, 120) ?? 'Anonymous contributor';
  const contributorEmail = truncate(detail.contributorEmail, 160) ?? 'No email provided';
  const storyText = truncate(detail.storyText, 1500) ?? 'No story provided.';
  const rawLocationText = truncate(detail.rawLocationText, 300) ?? 'No location provided.';
  const createdAt = detail.createdAt ? new Date(detail.createdAt).toISOString() : null;
  const reviewUrl = buildAdminReviewUrl(detail.submissionId);
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'New okra submission awaiting review',
        emoji: true
      }
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Contributor*\n${contributorName}`
        },
        {
          type: 'mrkdwn',
          text: `*Email*\n${contributorEmail}`
        },
        {
          type: 'mrkdwn',
          text: `*Submitted*\n${createdAt ?? 'Unknown'}`
        },
        {
          type: 'mrkdwn',
          text: `*Privacy*\n${detail.privacyMode ?? 'city'}`
        },
        {
          type: 'mrkdwn',
          text: `*Raw location*\n${rawLocationText}`
        },
        {
          type: 'mrkdwn',
          text: `*Coordinates*\n${formatCoordinate(detail.displayLat)}, ${formatCoordinate(detail.displayLng)}`
        }
      ]
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Story*\n${storyText}`
      }
    }
  ];

  if (Array.isArray(detail.photoUrls)) {
    for (const [index, photoUrl] of detail.photoUrls.entries()) {
      if (typeof photoUrl !== 'string' || !photoUrl.trim()) {
        continue;
      }

      blocks.push({
        type: 'image',
        image_url: photoUrl,
        alt_text: `Okra submission photo ${index + 1}`
      });
    }
  }

  const photoCount = Array.isArray(detail.photoUrls) ? detail.photoUrls.length : 0;
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Submission ID: \`${detail.submissionId}\` - Photos included: ${photoCount}`
      }
    ]
  });

  if (reviewUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Open review queue',
            emoji: true
          },
          url: reviewUrl,
          style: 'primary'
        }
      ]
    });
  }

  return {
    text: `New okra submission from ${contributorName}`,
    blocks
  };
}

export async function handler(event) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL?.trim();
  const detail = event?.detail ?? {};
  const correlationId = detail.correlationId ?? event?.id ?? 'unknown';

  if (!webhookUrl) {
    console.info(JSON.stringify({
      level: 'info',
      message: 'Okra submission Slack webhook is not configured; skipping notification',
      correlationId,
      submissionId: detail.submissionId ?? null
    }));
    return;
  }

  const payload = buildSlackPayload(detail);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Okra submission Slack webhook returned non-success',
        correlationId,
        submissionId: detail.submissionId ?? null,
        status: response.status
      }));
      return;
    }

    console.info(JSON.stringify({
      level: 'info',
      message: 'Delivered okra submission Slack notification',
      correlationId,
      submissionId: detail.submissionId ?? null
    }));
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Okra submission Slack webhook request failed',
      correlationId,
      submissionId: detail.submissionId ?? null,
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}
