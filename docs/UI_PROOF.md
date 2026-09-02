# Create UI proof for an agent run

Use this procedure for a Planner user-interface change. It creates a new local database, loads test data, and starts the current branch. It does not use the production database, R2 bucket, or OAuth.

## Start the proof environment

Run this command in the repository root:

```bash
pnpm proof:ui
```

Wait until Vite reports that it is ready. Open this local URL in Chromium:

```text
http://127.0.0.1:3000/api/auth/local-proof
```

Select **Open proof dashboard**. Planner creates a local test session and opens the dashboard. This login path works only in a Vite development build on `localhost`, `127.0.0.1`, or `::1`. A production build returns `404`.

## Record the proof

Test the changed flow on the current branch. Store the required files in the run proof directory:

```text
.planner/proof/<run-id>/screenshots/desktop.png
.planner/proof/<run-id>/screenshots/mobile.png
.planner/proof/<run-id>/video/ui-flow.webm
```

Use a desktop viewport and a mobile viewport. Record a short Chromium video that shows the main changed flow. Check the browser console. Do not use the deployed Planner application to prove an unmerged branch.

Stop the command when the proof is complete. The command deletes its temporary database.
