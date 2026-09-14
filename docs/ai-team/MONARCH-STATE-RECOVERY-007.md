# MONARCH-STATE-RECOVERY-007

Status: implemented

## Confirmed recovery facts

- 2026-09-13 was fully completed and must not render as broken.
- Weight on 2026-09-13: 85 kg.
- Codeforces rating on 2026-09-13: 1481.
- Confirmed streak sequence: 1 day, then 4 days, then an ongoing streak through 2026-09-14.
- The ongoing streak's start date is not added as a recovery fact because it was not explicitly confirmed. Existing verified day logs remain authoritative.

## Recovery behavior

The verified phone export through 2026-09-12 remains unchanged in `src/seed-save.js`. A pure, idempotent overlay adds only the confirmed facts above. It is used for fresh hosted origins and can be applied to an existing hosted save with:

`https://prabhav-patel-ops.github.io/monarch/?recover=confirmed-2026-09-14`

The recovery link loads the existing valid `monarch.v1`, keeps every unmentioned field and day, writes a rollback record through the transactional storage adapter, upserts the two measurements, marks the existing/generated 2026-09-13 quest board complete, recomputes derived totals, and removes the recovery parameter from the address after success. It also removes only untouched penalty quests that the stale first visit carried from the falsely broken September 13 into September 14; completed activity is retained. Reopening the link is harmless.

Corrupt saves remain write-blocked; the recovery never replaces damaged data with the bundled state.

## Verification

- Unit coverage proves pre-2026-09-13 day history is byte-for-byte unchanged.
- Unit coverage proves the repair is idempotent and retains hosted-only fields and side quests.
- Storage tests continue to cover rollback, stale-tab conflicts, corruption, checksum validation, and divergent imports.
- The production Pages build and deployed recovery URL are verified after merge.
