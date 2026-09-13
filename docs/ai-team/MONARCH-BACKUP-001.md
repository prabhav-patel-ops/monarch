# MONARCH-BACKUP-001 — Safe Backup Foundation

Status: APPROVED
Approved by: Prabhav
Lead: Jasmine
Research: Rose
Developer: Lily
Reviewer: Kitty

## Goal
Build a compatibility-preserving safety layer around the existing `monarch.v1` browser save without changing progression rules, historical quest state, or the persistence format used by the live app.

## Rose research handoff
Recommended scope is phases 1–3 only:

1. A compatibility-preserving adapter around the existing `monarch.v1` save.
2. IndexedDB recovery snapshots for rollback/recovery.
3. Validated, versioned portable backups plus conservative file-mediated fast-forward sync with branch preservation.

## Required safety behaviour
- Corrupt live storage must never be replaced by empty or seeded state.
- Interrupted writes must be recoverable at localStorage / IndexedDB boundaries.
- Import/reset operations need a pre-operation snapshot and rollback path.
- Identical import must be idempotent; older, descendant, and divergent lineage cases must be handled explicitly.
- Concurrent/stale-tab writes must not silently discard either branch.
- Handle `navigator.storage.persist()` granted, denied, or unavailable.
- Private browsing, origin/host changes, browser-data clearing, and PWA reinstall must have clear behaviour.
- Do not embed photo bytes in `monarch.v1`; protect against growth near localStorage limits.
- Export UI must distinguish "download started" from "verified file saved".
- Time-zone/DST and incorrect device clocks must not corrupt lineage/recovery ordering.

## Explicitly excluded from this foundation
- automatic record-level merging
- cloud accounts or cloud backends
- photo storage
- encryption
- paid services

## Lily implementation contract
- Work on a task branch, never directly on `main`.
- Read this file before coding.
- Keep changes small and reviewable.
- Add/extend tests for the safety behaviours implemented.
- Run `npm test` and `npm run build` before opening the PR.
- Open a PR to `main` and reference `MONARCH-BACKUP-001` in the title/body.
- Do not invent a deployment URL.

## Kitty review contract
After CI passes and the PR receives `kitty-review`, independently inspect the diff and verify:
- `monarch.v1` compatibility is preserved.
- live user state cannot be silently replaced by seed/empty state.
- rollback/recovery behaviour is tested.
- import/export remains safe and deterministic for covered cases.
- no scope expansion into cloud sync, auto-merge, photos, or encryption.

Return APPROVE or REQUEST CHANGES with tests performed and concrete risks.

## Final report contract
Jasmine closes the task only after Lily PR + CI + Kitty verdict are persisted in GitHub. Final report must include research summary, PR/commit, tests, Kitty verdict, remaining risks, and app/deployment status.
