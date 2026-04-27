import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

function getRegion() {
  return process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
}

function getEventBusName() {
  return process.env.STORE_IMAGE_PROCESSING_EVENT_BUS_NAME ?? 'default';
}

export async function enqueueStoreImageProcessing(imageId) {
  if (!imageId) return;

  const eb = new EventBridgeClient({ region: getRegion() });
  const result = await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: getEventBusName(),
      Source: 'ogf.admin-api.store-images',
      DetailType: 'store_product_image.claimed',
      Detail: JSON.stringify({ imageId })
    }]
  }));

  if ((result.FailedEntryCount ?? 0) > 0) {
    throw new Error('Failed to publish store product image processing event');
  }
}
