# Brief: P2 S5 — Pictures, stills and glow masks

- Implementer: **Anvil**.
- Scope: P2 release 0.2, source-picture/still/mask rendering only. No AI rendering (S6), talking mouths/chin (0.3), camera player/editor, export implementation or consumer pack changes.
- Touches: `packages/cli/src/picture/**`, `packages/cli/src/glow/**`, `packages/cli/package.json`, `pnpm-lock.yaml`.
- Dependency change: `sharp` at one exact version in manifest and lockfile, as P2 S5 requires. This brief does not pick a new version or allow unrelated upgrades.

## Sources and launch gate

- Approved scope: [P2 plan](../P2-asset-studio.md), the named step and its dependency/batch sections.
- Acceptance elaboration, not new decisions: `bpaksi/bloodtower:research/game-design/specs/A1-P2-requirements.md`, source worktree `/workspace/gw-a1-reqs`, commit `27d0ac8`; common C-01/C-02/C-05, relevant P2 step, D5/D13/D14. Requirements marked Default there remain sourced defaults, not additional Bob approvals.
- Layout check: `origin/main` at `9adc4d8` has no briefs folder/template; #16 adds formats/contracts, #18 adds studio fixtures, neither supplies a brief convention. This checklist uses `plans/briefs/P2-step-<N>.md` with Brief Gate headings.
- [ ] Wright confirms S2 (#16) and S3 have merged to main; use their actual library contracts, no private substitute schema/store.
- [ ] Wright records completion of #18 fixture review and any required fixture corrections. Descriptors/JSON consistency tests alone do not prove decodable media, pixels or browser behavior.
- [ ] This brief is merged to main and completeness checked before implementation starts. This docs-only commit opens no implementation job.
- Neutral generated fixtures only; no Bloodtower/RtDT art, paid provider, key, hardware or real user work folder. #18 fixture paths are reference inputs, not permission to merge or edit its pending branch. No new fixture contract chosen here.

## Cutover

- **N**. No rename, removal or runtime/consumer format cutover. Existing formats/player behavior survives.

## Survival invariants

- Work-folder index remains the S3 source of status; job/source masters remain unchanged. Successful rendering creates drafts, never promotes final/rejected through a hidden path (P2 Shape; DEC-386/839).
- Original masters and older content-addressed files are retained byte-for-byte. Identical inputs reuse store bytes; changed inputs cannot overwrite old bytes or lose another profile's output.
- Failure leaves the preceding valid index/store/master intact; never store an unreadable placeholder as approved media (requirements C-05/P2-05/D5).
- Existing CLI/formats/player tests and entry points pass; no new public schema, consumer kind whitelist or mood list. No network or paid call in these tests.

## Done-when (e2e)

- [ ] **S5-01 — Decode and profile pixels.** Generate a small source PNG with known asymmetric colored regions; run `render --only picture` through the merged S3 interface in a temp work folder. Decode each emitted WebP as WebP; assert exact requested width/height and cover crop against known region positions. Use deterministic content/encoder settings and a documented pixel comparison appropriate to WebP encoding, not a file extension or a tautological JSON descriptor. Test multiple profiles from one source, including nonmatching aspect ratios; all profile outputs remain individually reachable. Sources: P2 S5; requirements P2-05a/c, D14.
- [ ] **S5-02 — All requested mood stills.** Generate source art for each requested cast mood at the fixture portrait profile; decode results and check exact dimensions. Voiced and voiceless fixture cast both receive requested stills; no talking mouths/Rhubarb/chin requirement added. Missing source fails with ID/code and never becomes an invented still. Sources: P2 S5; requirements P2-05a/D5, DEC-719/843.
- [ ] **S5-03 — Mask pixels and alignment.** Generate a paired picture/mask with a known lit rectangle and asymmetric off-center feature. `masters/glow.<entry>.png` becomes grayscale WebP with R=G=B at paired painting size. Decode it and verify the lit region stays aligned in the picture/mask overlay, including identical profile transforms where derived. A dimension-only test is insufficient. Sources: P2 S5; requirements P2-05b/D5/D14, DEC-401 as refined by DEC-844.
- [ ] **S5-04 — Negative media.** Wrong-size mask returns `AS-GLOW-1`, asset ID and both dimensions; colored mask is rejected; corrupt/unreadable source or missing hand master returns a coded failure. Assert no wrong-size/colored/corrupt draft is committed and prior valid files/index are unchanged. Sources: requirements P2-05/D5/C-05.
- [ ] **S5-05 — Store integrity and replay.** Hash originals/store/index before and after: identical render adds no duplicate store file; changed input creates new bytes/hash while old file and unrelated asset/profile hashes survive. Masters are not resaved in place. Induce write failure and prove no partial index replacement or false final status. Sources: P2 Shape/S3; requirements C-05/P2-05c/D5.
- [ ] **S5-06 — Integration/regression evidence.** `pnpm install --frozen-lockfile` then `pnpm check` passes; local deterministic CLI integration above runs without APIs/keys. PR records tests, expected/actual pixels or crop regions, mask overlay and store hashes; manifest/lock diff contains exact sharp pin only. Existing tests remain green.
- [ ] **S5-07 — PR opened.** Implementation is committed in a fresh feature worktree and an implementation PR is opened with S5-01…06 evidence and declared Touches. No merge or publish by implementer.

## AREA / DEC checklist

- [x] DEC-386/839: work folder/status/master ownership; renderer cannot approve.
- [x] DEC-401/844: separate `glow.<entry>` grayscale mask, same painting dimensions; kinds are consumer labels.
- [x] DEC-719/843: mood stills, 0.2 first; talking kits later.
- [x] Consumer-only DEC-206/207/575/576 remain consumer lint, not new global asset-studio restrictions (requirements S5). No UI/MEC gameplay change in this slice.
- [ ] Wright closes pre-launch gates above. No extra product decision requested.
- [ ] If merged S3 requires changing bin/dispatcher/store files outside Touches to wire `--only picture`, **stop before launch for Wright's explicit Touches decision**; do not self-expand.

## Locked copy

- No game dialogue or new product copy. Preserve existing errors; required mask code is `AS-GLOW-1`, with ID and both sizes. Use neutral fixture text only; no Loremaster story line or art work is commissioned.

## Review and handoff

- **ONE independent cross-review: Hammer reviews Anvil's S5 PR.** Reviewer checks every AC, malformed-media cases, exact dependency diff and preservation hashes. Author does not self-review. This is the task-specific review instruction; no second review is launched by this brief.
- Wright owns completeness, gate evidence and merge. Any unresolved Touches decision blocks implementation, not documentation publication.
