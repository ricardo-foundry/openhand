<!--
Thanks for contributing to OpenHand! Please fill in the sections below.
If this is a draft, feel free to open it as "Draft" and iterate in the open.
-->

## Summary

<!-- One or two sentences: what does this PR change and why? -->

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change (API / CLI behavior)
- [ ] New tool or plugin
- [ ] Docs / chore / CI only

## Affected packages / apps

<!-- Tick every workspace touched -->

- [ ] `packages/core`
- [ ] `packages/tools`
- [ ] `packages/sandbox`
- [ ] `packages/llm`
- [ ] `apps/cli`
- [ ] `apps/server`
- [ ] `apps/web`
- [ ] `plugins/*`
- [ ] `docs/` or root

## How to test

<!-- Commands a reviewer can run to verify. Prefer copy-pasteable. -->

```bash
npm install
npm run build
npm test --workspaces
```

## Checklist

- [ ] `npm run build` succeeds.
- [ ] `npm test --workspaces` passes (or new tests added where appropriate).
- [ ] Public API changes are reflected in `docs/` and `CHANGELOG.md`.
- [ ] No secrets, credentials, or `.env` contents committed.
- [ ] PR title follows Conventional Commits (`feat:`, `fix:`, `docs:` ...).

## Screenshots / logs (optional)

<!-- Paste terminal output or UI screenshots here. -->

## Related issues

<!-- Closes #123, refs #456 -->
