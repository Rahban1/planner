# Logout button verification report

## Summary

This proof pack covers the accessible logout control in `TopBar`. The code commit under test is `407c825165fff154960fc523bbe7f773cc8bd185`.

## Checks

- **PASS — diff hygiene:** `git diff --check` completed successfully.
- **BLOCKED — focused regression test:** `pnpm exec vitest run src/components/TopBar.test.tsx --config vitest.config.ts` could not start because repository dependencies were absent. A locked `pnpm install --frozen-lockfile` was attempted but stalled without output and was stopped.
- **BLOCKED — browser:** `pnpm proof:ui` started the repository proof script but could not launch Wrangler because dependencies were unavailable (`wrangler` not found).
- **NOT RUN — lint, types, full tests, build:** skipped because dependency setup was blocked and these gates could not provide independent evidence.

## Reproduction

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm exec vitest run src/components/TopBar.test.tsx --config vitest.config.ts
```

The implementation adds explicit `type="button"` semantics to the existing accessible logout control and verifies its label, title, type, and click callback.
