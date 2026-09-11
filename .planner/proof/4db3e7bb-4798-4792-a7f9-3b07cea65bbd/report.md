# Proof Report — Investigate automated UI proof capture

## Summary

Added `@playwright/test@1.50.0` and an automated `pnpm proof:ui:capture <run-id>` script that starts a local dev server with seeded data, logs in via the local-proof endpoint, and captures desktop + mobile screenshots plus a WebM video automatically.

## Changes

- `package.json` — added `@playwright/test@1.50.0` devDependency and `proof:ui:capture` script
- `scripts/capture-ui-proof.mjs` — new automated capture harness
- `agent-runner/src/prompt.ts` — updated agent instructions to recommend automated capture first
- `docs/UI_PROOF.md` — added automated capture section

## Verification Results

| Check | Status | Notes |
|-------|--------|-------|
| Lint | PASS | Pre-existing warnings in worker-configuration.d.ts |
| Type check | PASS | No new errors |
| Vitest | PASS | 57 tests passed |
| Agent-runner tests | FAIL | Pre-existing missing `@types/node` in agent-runner tsconfig |
| Browser capture | PENDING | Will attempt after this checkpoint |

## Limitations

- Agent-runner build failure is pre-existing and unrelated to this change.
- Browser capture has not yet been attempted.
