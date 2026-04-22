import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

function getRegion() {
  return process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
}

function getEventBusName() {
  return process.env.AVATAR_PROCESSING_EVENT_BUS_NAME ?? 'default';
}

export async function enqueueAvatarProcessing(userId, avatarId) {
  if (!userId || !avatarId) {
    return;
  }

  const eb = new EventBridgeClient({ region: getRegion() });

  const result = await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: getEventBusName(),
      Source: 'ogf.web-api.avatars',
      DetailType: 'avatar.claimed',
      Detail: JSON.stringify({ userId, avatarId })
    }]
  }));

  if ((result.FailedEntryCount ?? 0) > 0) {
    throw new Error('Failed to publish avatar processing event');
  }
}
