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
    const result = await eventBridge.send(new PutEventsCommand({
      Entries: [
        {
          Source: 'okra.submissions',
          DetailType: 'submission.created',
          Detail: JSON.stringify(notificationDetail(submission, correlationId))
        }
      ]
    }));

    if ((result?.FailedEntryCount ?? 0) > 0) {
      const failedEntries = Array.isArray(result?.Entries)
        ? result.Entries
            .filter((entry) => entry?.ErrorCode || entry?.ErrorMessage)
            .map((entry) => ({
              errorCode: entry.ErrorCode ?? null,
              errorMessage: entry.ErrorMessage ?? null
            }))
        : [];

      throw new Error(`Failed to publish ${result.FailedEntryCount} okra submission notification event(s): ${JSON.stringify(failedEntries)}`);
    }
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

export async function publishSubmissionEditSubmittedEvent(edit, correlationId) {
  try {
    await eventBridge.send(new PutEventsCommand({
      Entries: [
        {
          Source: 'okra.submissions',
          DetailType: 'submission.edit_submitted',
          Detail: JSON.stringify({
            submissionId: edit.submissionId,
            editId: edit.editId,
            status: edit.status,
            createdAt: edit.createdAt,
            idempotentReplay: Boolean(edit.idempotentReplay),
            correlationId
          })
        }
      ]
    }));
  } catch (error) {
    console.error(JSON.stringify({
      level: 'warn',
      message: 'Failed to publish okra submission edit event',
      submissionId: edit?.submissionId ?? null,
      editId: edit?.editId ?? null,
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}
