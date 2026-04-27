export async function postToSlack(webhookUrl, payload, { correlationId, source, detailType } = {}) {
  if (!webhookUrl?.trim()) {
    console.info(JSON.stringify({
      level: 'info',
      correlationId,
      source,
      detailType,
      message: 'Slack webhook not configured; skipping notification'
    }));
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      console.error(JSON.stringify({
        level: 'error',
        correlationId,
        source,
        detailType,
        status: response.status,
        message: 'Slack webhook returned non-success'
      }));
      return;
    }
    console.info(JSON.stringify({
      level: 'info',
      correlationId,
      source,
      detailType,
      message: 'Delivered Slack notification'
    }));
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      correlationId,
      source,
      detailType,
      message: 'Slack webhook request failed',
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}
