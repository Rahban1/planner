### Problem

Planner’s authenticated application shell needs a clear, accessible way for a signed-in user to end their session. Logout must invalidate Planner’s existing server session rather than only navigating away or inventing a client-side identity state.

### Approach

The shared `TopBar` already exposes the logout control and the root shell already posts to `POST /api/auth/logout`, which expires the `planner_session` HttpOnly cookie before navigating to `/landing`. This change hardens that existing control with explicit `type="button"` semantics and adds a focused regression test covering its accessible name, title, click callback, and non-submit behavior. The Google/GitHub OAuth and D1 session architecture remains unchanged.

### Is this the best way?

Yes for this scoped UI task. Reusing the existing root-shell handler and provider-independent logout endpoint keeps the browser session, server authorization, and redirect behavior aligned. The trade-off is that this PR does not revoke provider grants or delete historical D1 session rows; Planner does not use provider tokens as its application session, and cookie expiration is the existing logout contract.

### Alternatives considered

- **Navigate directly to `/landing`:** rejected because the valid `planner_session` cookie would remain usable.
- **Clear a localStorage identity or add a login modal:** rejected because authenticated identity comes from verified Google/GitHub OAuth and server-side D1 sessions; a second client identity source would be insecure and inconsistent.
- **Delete every D1 session row or revoke provider tokens:** not selected for this UI task because it would change multi-device/provider session semantics beyond the current contract.

### Best tool for the job

The existing React `TopBar` component, `lucide-react` `LogOut` icon, and same-origin `fetch` handler are the appropriate tools. They match the current design system, preserve keyboard/screen-reader access through the button’s accessible label, and avoid adding dependencies or a second authentication layer.

### Testing

Proof bundle: [`.planner/proof/311f0c32-5618-49e0-b976-e20feda123e4/report.md`](.planner/proof/311f0c32-5618-49e0-b976-e20feda123e4/report.md)

- **PASS:** `git diff --check`.
- **BLOCKED:** focused `TopBar` Vitest regression test; project dependencies were absent and the locked install stalled.
- **BLOCKED:** `pnpm proof:ui`; the dedicated local proof command could not launch Wrangler because dependencies were unavailable, so no Chromium screenshots or video were created.
- **NOT RUN:** lint, TypeScript, full tests, and build because dependency setup was blocked.

The PR is ready for human review, but the proof pack is intentionally partial and does not claim complete verification.
