import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const eventBridge = new EventBridgeClient({});

function notificationDetail(submission, correlationId) {
  return {
    submissionId: submission.id,
    status: submission.status,
    createdAt: submission.createdAt,
    contributorName: submission.contributorName ?? null,
    contributorEmail: submission.contributorEmail ?? null,
    storyText: submission.storyText ?? null,
    rawLocationText: submission.rawLocationText,
    privacyMode: submission.privacyMode,
    displayLat: submission.displayLat,
    displayLng: submission.displayLng,
    photoUrls: Array.isArray(submission.photoUrls) ? submission.photoUrls.slice(0, 3) : [],
    correlationId
  };
}

export async function publishSubmissionCreatedEvent(submission, correlationId) {
  try {
    await eventBridge.send(new PutEventsCommand({
      Entries: [
        {
          Source: 'okra.submissions',
          DetailType: 'submission.created',
          Detail: JSON.stringify(notificationDetail(submission, correlationId))
        }
      ]
    }));
  } catch (error) {
    console.error(JSON.stringify({
      level: 'warn',
      message: 'Failed to publish okra submission notification event',
      submissionId: submission?.id ?? null,
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}
