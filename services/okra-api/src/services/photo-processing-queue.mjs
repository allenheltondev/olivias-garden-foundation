import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

function getRegion() {
  return process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
}

function getEventBusName() {
  return process.env.PHOTO_PROCESSING_EVENT_BUS_NAME ?? 'default';
}

export async function enqueuePhotoProcessing(photoIds) {
  if (!Array.isArray(photoIds) || photoIds.length === 0) {
    return;
  }

  const eb = new EventBridgeClient({ region: getRegion() });
  const eventBusName = getEventBusName();

  for (let i = 0; i < photoIds.length; i += 10) {
    const entries = photoIds.slice(i, i + 10).map((photoId) => ({
      EventBusName: eventBusName,
      Source: 'okra.photos',
      DetailType: 'photo.claimed',
      Detail: JSON.stringify({ photoId })
    }));

    const result = await eb.send(new PutEventsCommand({ Entries: entries }));

    if ((result.FailedEntryCount ?? 0) > 0) {
      throw new Error(`Failed to publish ${result.FailedEntryCount} photo processing event(s)`);
    }
  }
}
