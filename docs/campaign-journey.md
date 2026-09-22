# Marketing brief → campaign draft → approval

Open **Manage → Campaign journey** (`/manage/campaign-journey`).

1. Choose a saved marketing brief and an existing campaign workspace.
2. Choose an approved creative brief and enter the campaign details. Save the draft.
3. Validate the saved version. Missing advertising account connections or approved creative assets remain blockers.
4. Review the saved budget, market, audience, schedule, landing page and creative versions. A user with campaign publishing approval permission can approve it.

The page never publishes, activates, spends credits, generates creatives, or starts external jobs. It uses the existing campaign approval contract. Approval may expire or be withdrawn; publishing remains a separate controlled action.

## Prerequisites and boundaries

- A database-backed workspace, marketing brief viewing permission, and campaign viewing permission are required. Editing and approval require their existing separate permissions.
- Prepare missing briefs and creative approvals in their existing workspaces. This release guides campaign assembly and approval; it does not replace research or creative generation.
- Creative review and refresh remain available when approved briefs already exist. Refresh preserves campaign fields; if the selected approved version disappears or changes, choose an approved brief explicitly and save again before validation or approval.
- Campaigns retain the source brief ID and content hash. Missing or changed source content blocks validation and approval until an editor saves the current source into a new revision.
- Draft changes use the expected revision and hash. Concurrent edits must be reloaded, not silently overwritten.
- The form handles one platform, market and creative brief. More complex existing drafts retain the full campaign editor.
- Lists show the latest 30 briefs, 100 workflows and 100 approved creative briefs per workflow. No invented empty approval counts or performance estimates are displayed.
- Preview approval fixtures are seeded only by the disposable CI browser test, never in normal user previews. The ordinary preview can truthfully show missing prerequisites.

## Verification

`node --no-experimental-global-navigator --test test/campaign-journey.test.js`

PostgreSQL advertising certification includes the campaign draft suite and source/tenant/concurrent-edit checks. Preview workspace CI runs Chromium through saving, validation, approval, withdrawal, re-approval and reload against the actual preview server and a dedicated TLS database. Screenshots are saved in the preview workflow artifact.
