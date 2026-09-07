# Daily workflow release — 7 September 2026

## Delivered flow

Use **Projects** to connect repositories and set working rules. Use **New task** to describe an outcome. The first message creates the task and queues a plan. Review the exact plan version, then select **Approve & build**. The task keeps Discussion, Plan, Changes, and Activity in one place. The phone view shows one pane at a time.

The Changes view reads pull requests, checks, files, and comments from GitHub. **Ask a question** uses a session with no tools. **Request a change** resumes the existing branches and pull requests. The runner checks saved heads and commit ancestry before it pushes. A task completes after all required pull requests merge. A failed revision keeps its source pull request under merge checks.

Project membership controls project, task, attachment, and review access. Project owners control membership changes.

## Verification

- PASS: `pnpm lint` (two existing generated-file warnings, no errors).
- PASS: `pnpm exec tsc --noEmit`.
- PASS: `pnpm build`.
- PASS: `pnpm test` — 57 app tests and 51 runner tests.
- PASS: migration on an empty database and on the older production plan-history schema. Existing plan markdown is preserved.
- PASS: local proof sign-in and dashboard with isolated seed projects.
- PASS: task creation from the first message, draft recovery after reload, theme recovery, and navigation to the stable task page.
- PASS: phone viewport exposes Discussion, Plan, Changes, and Activity, with the plan approval control present.
- BLOCKED: final phone screenshot, video, and extended browser interactions. The browser connection timed out during viewport reload. The desktop dashboard was visually inspected in the browser.
- NOT RUN: a paid live LLM implementation/revision and a real GitHub write during this release check. Tests include a real local Git race that rejects a stale push.
- NOT RUN: a physical iPhone test.

GitHub comment polling is not part of this release. Use the question and change-request controls inside Planner. Open the pull request in GitHub to merge it.

## Production data

Migration `0011_daily_workflow.sql` adds source-run links, project rules, and plan feedback. It accepts the older `plan_revisions.markdown` table and index found in production. Before the membership checks went live, the two existing projects were assigned to the only registered user after the account was verified. No seed data was added to production.

Production uses the `planner-runner` GitHub Actions environment and the `master` branch. OpenCode Go remains the provider. The local Docker daemon was stopped at release time; production jobs use the updated source from GitHub Actions.
