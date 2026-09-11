# Proof Report — Investigate automated UI proof capture

## Summary

Added `@playwright/test@1.50.0` and an automated `pnpm proof:ui:capture <run-id>` script that starts a local dev server with seeded data, logs in via the local-proof endpoint, and captures desktop + mobile screenshots plus a WebM video automatically.

## Changes

- `package.json` — added `@playwright/test@1.50.0` devDependency and `proof:ui:capture` script
- `scripts/capture-ui-proof.mjs` — new automated capture harness
- `agent-runner/src/prompt.ts` — updated agent instructions to recommend automated capture first
- `agent-runner/test/prompt-proof.test.mjs` — updated test assertions to match new prompt text
- `docs/UI_PROOF.md` — added automated capture section

## Verification Results

| Check | Status | Notes |
|-------|--------|-------|
| Lint | PASS | Pre-existing warnings in worker-configuration.d.ts |
| Type check | PASS | No new errors |
| Build | PASS | Production build succeeded |
| Vitest | PASS | 57 tests passed |
| Agent-runner tests | PASS | 51 tests passed after `npm ci` |
| Browser capture | PASS | Desktop, mobile screenshots and WebM video captured |

## Artifacts

- `.planner/proof/4db3e7bb-4798-4792-a7f9-3b07cea65bbd/screenshots/desktop.png`
- `.planner/proof/4db3e7bb-4798-4792-a7f9-3b07cea65bbd/screenshots/mobile.png`
- `.planner/proof/4db3e7bb-4798-4792-a7f9-3b07cea65bbd/video/ui-flow.webm`
