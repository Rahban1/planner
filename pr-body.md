### Problem

Planner currently supports single-user workflows: one person creates tasks, plans them via the agent, and approves or requests changes. Teams need a way to collaborate within a specific project without seeing other projects, and plans need an approval workflow where a creator can request sign-off from a manager before the agent implements.

### Approach

This PR introduces a lightweight collaboration layer scoped to individual projects:

1. **Project members** — a `project_members` table with email, name, and role (`owner`/`manager`/`member`). A new **MembersModal** lets owners add/remove collaborators and assign roles directly from the project page.
2. **Plan suggestions** — a `plan_suggestions` table tied to `agent_runs`. Team members can leave text suggestions on any plan. These appear in a new **Suggestions** tab inside `PlanModal`.
3. **Plan approvals** — a `plan_approvals` table tracking `pending`/`approved`/`rejected` requests. The creator of a plan can request approval from another member by email. The approver is notified via the UI (polling) and can accept, reject, or suggest further changes. A new **Approvals** tab in `PlanModal` shows the full history.
4. **UI integration** — the project detail page gets a members icon that opens `MembersModal`. `PlanModal` gains three tabs (Review / Suggestions / Approvals) so collaboration happens in context.

All new tables cascade-delete with their parent project or agent run, keeping cleanup automatic.

### Is this the best way?

This is a pragmatic first step. It adds collaboration without requiring a full authentication system (emails are used as identifiers, with a clear path to integrate OAuth or passwordless auth later). The approval flow is simple but covers the core need: explicit sign-off before implementation.

Trade-offs:
- No real-time push (websockets/Server-Sent Events). Polling at 10s keeps it simple and works behind Cloudflare Workers without extra infrastructure.
- No email notifications yet — approvals are visible only when the approver opens the plan or checks their pending list. This could be extended with a notification bell or email integration.
- Permissions are coarse-grained at the project level. Finer task-level permissions could be added later.

### Alternatives considered

1. **Full OAuth/SSO with RBAC** — Rejected because it would balloon scope dramatically (identity providers, sessions, tokens). The email-based approach lets us ship collaboration now and bolt on auth later.
2. **Inline comments on specific plan sections** — Rejected in favor of a simple suggestion list. Section-level commenting would require anchoring comments to markdown offsets, which is fragile and over-engineered for a first release.
3. **GitHub-style PR reviews for plans** — Rejected because it would require forking the plan into separate revisions with diff views. The existing `planVersion` + feedback loop already handles revisions; approvals layer on top cleanly.

### Best tool for the job

- **Drizzle ORM + SQLite (D1)** for schema and queries — already the project's database stack, so no new dependencies.
- **TanStack Query** for server-state — used consistently across the app; new hooks (`useProjectMembers`, `usePlanApprovals`, etc.) follow the existing mutation invalidation patterns.
- **React state + inline styles** for the tabbed UI in `PlanModal` — no new component library needed; keeps the bundle size minimal and matches the existing design system.

### Testing

- Migration file `0004_collaboration_feature.sql` created and registered in the Drizzle journal.
- The build completes successfully.
- Manual verification path (to be done in the dev server):
  1. Open a project page → click the members icon → add a collaborator by email.
  2. Create a plan run for a task → open PlanModal.
  3. Switch to **Suggestions** tab → add a suggestion.
  4. Switch to **Approvals** tab → request approval from the collaborator's email.
  5. Refresh / open the plan as the approver → see pending approval and approve/reject.