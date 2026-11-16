# Plant record

Opening a plant from Garden > Plants shows its existing crop details, bed assignment, care-reminder shortcut, editable growing notes, and dated planting/harvest history.

## Existing data and writes

- Plant milestones use the saved crop creation and planting dates; expected harvest dates remain estimates in the crop details.
- Harvest history uses the same crop-scoped endpoint/query cache as the harvest editor. Each recorded amount keeps its own unit; totals across unlike units are not calculated.
- Growing notes use the existing crop update contract and retain the current crop fields. Notes are an editable current observation, not a versioned journal.
- Failed saves retain drafts; offline writes are disabled. Failed harvest refreshes retain cached records and offer retry.
- A recorded harvest opens the existing sharing draft only when explicitly selected. Managing harvests uses the existing harvest editor.
- Note saves and bed/timing edits are gated to avoid simultaneous whole-crop updates.

## Follow-up

[Issue #449](https://github.com/allenheltondev/olivias-garden-foundation/issues/449) tracks crop-linked journal observations/photos and actual care history. Current journal photo/notes and reminder records have no crop association. This view does not guess associations from titles, crop names, or garden-wide activity. No new backend endpoints or API contract changes are included in this pass.
