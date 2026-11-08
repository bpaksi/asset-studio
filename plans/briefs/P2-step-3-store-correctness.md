# Brief: P2 S3 — Store-correctness follow-up

- Owner: **Wright** (scope, completeness and merge); implementation stays with the assigned **runner**, after this brief merges. Gamewright supplies documentation only.
- Scope: repair existing per-story index/notes mutation correctness, not a new product feature.
- Implementation Touches: `packages/cli/src/store/**`; **only necessary approve/reject call sites and their tests** in `packages/cli/src/needs/**` (currently `needs.ts` and `needs.test.ts`). Other needs behavior is not newly in scope.
- Excluded: S5 picture/glow work, renderer implementations, CLI command-entry/bin/dispatcher changes, config, formats/schema changes, studio UI, network calls, new dependencies and manifest/lockfile changes. No new user-facing command, option or workflow.
- This docs-only change touches only `plans/briefs/P2-step-3-store-correctness.md`; it implements nothing.

## Sources and launch gate

- Approved [P2 plan](../P2-asset-studio.md#s3-cli-skeleton-settings-store-and-needs), S3 and [Shape](../P2-asset-studio.md#shape): immutable content-addressed bytes; the work-folder index owns status; explicit approve/reject owns final/rejected; rejection saves its note. S3 landed in [#17](https://github.com/bpaksi/asset-studio/pull/17), main base `aceea69`.
- Published Bloodtower [A1/P2 requirements, S3, P2-03c and D5](https://github.com/bpaksi/bloodtower/blob/main/research/game-design/specs/A1-P2-requirements.md#s3--cli-settings-immutable-store-needs): concurrent mutation must serialize or fail with a coded error; existing final/rejected statuses survive. [Common acceptance C-05](https://github.com/bpaksi/bloodtower/blob/main/research/game-design/specs/A1-P2-requirements.md#common-acceptance-and-defaults) preserves the preceding good state on failure. D5 originated as a Gamewright default, **not** a separate Bob ruling.
- **Authority recorded from Wright's 2026-11-08 request:** Wright adopts that existing D5 invariant as an approved-plan small tweak under Bob's Nov 1 rule, relayed by Wright: “once a plan is approved (meaning I've reviewed the mockups and evals) then small tweaks shouldn't need another review from me.” This records Wright's adoption of the narrow correctness repair, not a new product decision or blanket approval of wider scope.
- Related decided contracts, repeated in P2's [rulings table](../P2-asset-studio.md#what-is-settled-from-the-rulings): DEC-384 (human approval), DEC-386 (masters/drafts in work folder), DEC-839 (work-folder index owns status). No new AREA/DEC card is invented here.
- [ ] Wright verifies completeness and this brief is merged to main before launching the runner. **S7 and multiple renderers wait for this fix** and its accepted implementation evidence; publishing this brief alone does not clear that dependency.

## Cutover

- **N**. No rename, removal, migration or persisted-format cutover. Existing jobs, work folders, library contracts and single-writer behavior remain valid.

## Survival invariants

- Concurrent mutations of **one story's index or notes** either serialize or fail with a **stable coded error**. Never report success while silently losing an entry, overwriting unrelated state or leaving partial files. An in-process-only guard is not sufficient evidence for separate CLI/library processes.
- Successful operations affect only the intended ID. Existing finals, rejections and exact rejection/redo notes survive unrelated mutation, reopening and retry. A rejected status and its corresponding note must not be left inconsistent across index/notes by a failed reject operation.
- Failed mutation preserves the preceding valid logical state, including any other operation already successfully committed; it must not roll another writer back. No partial/truncated JSON, false final/rejected result or repair-by-deletion.
- Content-addressed files and their bytes, older hashes, source masters, job input and other stories remain unchanged. Identical content still reuses its stored bytes; changed content retains older stored bytes. No auto-approval or renderer-driven status promotion is added.
- Existing single-writer approve/reject/needs behavior and coded failures remain intact. No new UI, network, paid call, credential or dependency is needed.

## Done-when (e2e)

- [ ] **S3-C01 — Real subprocess contention.** Use a neutral job and a temporary work folder seeded with valid index/notes, unrelated final/rejected sentinels, masters and immutable store bytes. Start **two real subprocesses**, using the store/approve/reject library path under test, mutating **different IDs in the same story**. Coordinate their overlap so a serial-only scheduling accident cannot count as coverage. Assert either both succeed and both mutations survive reload, or one succeeds and the other exits nonzero with a stable coded error, its preceding data intact and the successful peer's mutation preserved. Cover index mutation and notes mutation, including concurrent rejections with distinct exact notes. A pair of promises in one process is not this e2e.
- [ ] **S3-C02 — No silent/partial writes.** After each contention outcome, parse and validate index and notes with the merged schemas. Assert complete expected ID/status/note sets, no disappeared sentinels and no dangling rejected-status/note pair. Compare content hashes of masters, existing store files, job and an unrelated story against their pre-run hashes. Failed contenders must not return a success result.
- [ ] **S3-C03 — Induced failure and pair consistency.** Deterministically induce a write/commit failure during mutation, including reject's index-plus-notes update. Test an attempted mutation of each persisted file and failure after an operation has begun, not only pre-validation rejection. On error, reload in a fresh process: both files remain valid and mutually consistent, prior logical data and any successful peer mutation survive, and no partial operation is presented as committed. Record the injected boundary and expected/actual state; no filesystem-permission assumption that silently passes when run as root.
- [ ] **S3-C04 — Release and recovery.** After contention or the induced error, prove the failed operation releases any exclusion/resources it acquired: a new subprocess can perform the next valid mutation without a permanent busy state or manual deletion of user data. Retry the failed different-ID mutation through the same public library path; reload proves the original data, peer's successful update and recovered update coexist with exact notes. Use bounded test timeouts so a leaked resource/deadlock fails the test. Do not mandate a lock design, filename, error-code spelling or crash-recovery protocol.
- [ ] **S3-C05 — Single-writer regression.** Existing CLI/store/needs tests pass unchanged in behavior. Verify approve affects only its ID, reject preserves the exact note and needs retains finals/rejections. Existing invalid-ID/missing-or-corrupt-file failures stay failures without mutation. Check identical-content reuse and retention of older content-addressed bytes. No command-entry changes, new flags, schema changes or added dependencies.
- [ ] **S3-C06 — Fresh normal checks and evidence.** From the implementation worktree, run `pnpm install --frozen-lockfile` and `pnpm check` (lint, typecheck/build, tests). Attach commands/results plus subprocess exit codes, coded errors, fixture state comparisons and failure/recovery evidence for S3-C01–05. A mocked unit test or green checks alone does not replace the subprocess e2e.
- [ ] **S3-C07 — PR opened.** Commit only the declared implementation Touches in a fresh runner worktree and **open the implementation PR** with S3-C01–06 evidence. Done is PR opened, not local files or an unpushed commit. No merge, deploy or package publication by the runner. For this documentation handoff likewise, Done is the docs-only brief PR opened; a local patch remains an unpublished handoff.

## AREA / DEC checklist

- [x] **D5 adoption:** Wright closes the narrow concurrent-mutation invariant as an approved-plan correctness tweak; its original default provenance is retained above. Serialization **or** coded failure are both allowed; no new product choice is inferred.
- [x] **DEC-384 / DEC-839:** explicit human approval/rejection remains the only route to final/rejected; status stays in the work-folder index, not job input. The reject note remains consistent with that status.
- [x] **DEC-386:** masters, prior content-addressed bytes and existing drafts/finals/rejections are preserved; no migration, deletion or new storage format.
- [x] **Touches / sequencing:** store plus necessary approve/reject call sites/tests only; no S5 or command-entry work. S7 and multiple renderers remain blocked on this fix. Runner implementation starts only after the brief merges.
- [x] **Design gaps:** none identified within this invariant. Exclusion strategy, stable error-code spelling, test synchronization and failure injection are runner engineering choices, not adopted product decisions. This brief makes no new arbitrary-process-kill/power-loss recovery promise. If a real compatibility change, broader scope or semantic choice is discovered, stop that portion and report to Wright; Wright owns resolution/escalation, not an inferred ruling.

## Locked copy

- No dialogue, Begin/Pick beat, new UI copy or art is in scope; a Copy table is not applicable. Preserve existing command/error copy and codes. The concurrency/failure result must be machine-readable through a stable code; this brief does not choose its spelling or add a CLI entry point.

## Documentation validation

- Fresh worktree based on main `aceea69`, 2026-11-08 (ET): `pnpm install --frozen-lockfile` and `pnpm check` passed (lint; typecheck/build; 204 tests: root 5, formats 139, player 13, CLI 47). `git diff --check` and all five required Brief Gate headings passed. No runtime code or tests changed.
- These are baseline/documentation checks, **not** evidence that the new subprocess/failure acceptance has been implemented. Implementation ACs remain unchecked. Docs publication is complete only once its PR is opened.
