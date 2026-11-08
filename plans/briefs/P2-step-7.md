# Brief: P2 S7 — Local studio review

- Implementer: **Hammer**.
- Scope: P2 release 0.2 review studio only. No Painting camera/glow-brush editor, chin editing (S13), AI provider, generic skill, export implementation, consumer UI or app hosting.
- Touches: **`packages/studio/**` only**, including tests/fixtures under that directory.
- Dependency/lockfile changes outside that directory: **not granted**. See pre-launch Touches decisions below.

## Sources and launch gate

- Approved scope: [P2 plan](../P2-asset-studio.md), the named step and its dependency/batch sections.
- Acceptance elaboration, not new decisions: local **unpublished** requirements at `/workspace/gw-a1-reqs/research/game-design/specs/A1-P2-requirements.md`, commit `27d0ac8`; common C-01/C-02/C-05, relevant P2 step, D5/D13/D14. This is not a durable main citation. Requirements marked Default there remain sourced defaults, not additional Bob approvals.
- [ ] **Unmet publication gate:** Wright records the published/merged Bloodtower requirements revision at `research/game-design/specs/A1-P2-requirements.md` and verifies these references before implementation launch; local `27d0ac8` alone does not close this gate.
- Brief layout: `plans/briefs/P2-step-<N>.md` with Brief Gate headings. #16 covers formats/contracts; #18 covers studio descriptor fixtures, not an implementation brief.
- [ ] Wright confirms S2 (#16) and S3 have merged to main; use their actual library contracts, no private substitute schema/store.
- [x] #18 merged at `d13194df`. Anvil's independent review **5818293815 — APPROVE** covers **descriptor prep ONLY**, not S7 completion. Descriptors/JSON consistency tests do not prove decodable media, pixels or browser behavior; all implementation ACs below remain open.
- [ ] This brief is merged to main and completeness checked before implementation starts. This docs-only commit opens no implementation job.
- Neutral generated fixtures only; no Bloodtower/RtDT art, paid provider, key, hardware or real user work folder. #18's merged descriptor fixtures are reference inputs, not evidence that S5/S7 implementation or real-media validation is complete. No new fixture contract chosen here.

## Cutover

- **N**. Adds local review UI; no replacement of CLI/work-folder schemas or consumer runtime.

## Survival invariants

- Read/write through merged CLI library; index/notes/settings remain its contract and authority. Browser page does not edit JSON directly or implement an alternate store/status machine (P2 S7, DEC-839).
- Looking/listening/filtering never mutates asset bytes, source job, masters, notes or statuses. Approve/reject persist only the intended library operation, not regenerated media or other stories' files.
- Job, masters, stored bytes and previously valid state survive invalid path/media/save operations; failure is visible with its original code, never a false successful approval (requirements C-05/P2-07/D5).
- S3 CLI setup, one-run overrides and existing formats/player tests survive unchanged. Fixtures do not modify real user settings; CI uses temp settings/work folders and no paid service.

## Done-when (e2e)

- [ ] **S7-01 — Loopback only.** Start studio by the approved/merged CLI entry point; assert the listening socket is bound to `127.0.0.1`, not `0.0.0.0` or a public interface. No cloud upload/remote host is introduced. Source: P2 S7; requirements P2-07a/D5.
- [ ] **S7-02 — Config at 1440×900.** Fresh temp settings and no work folder: browser shows only the path setup form, no job render/review. Save a valid path through the CLI config library; reload proves persistence. Change it later from settings; invalid/unwritable path shows library code without deleting valid settings or rendering first. Assert library calls, not just appearance. Sources: P2 S7; requirements P2-07a/c/D5.
- [ ] **S7-03 — Needs, filters, real decoders.** Open the reviewed #18 fixture job using merged formats/S3 library and deterministic real media generated from its descriptors. Show all four statuses and filter by kind/status; an empty result is explicit. Browser decodes WebP picture(s) at each requested profile and mood still at portrait size (scrolling allowed), plays decodable m4a with its caption and supplied sound. No renamed WAV/JSON masquerading as m4a/WebP. Asset-studio supports generic profiles; do not import Bloodtower's no-iPad-art rule into this neutral fixture. Sources: P2 S7; requirements P2-07b/D5/D14.
- [ ] **S7-04 — Pixels and masks.** Generate known asymmetric image/mask fixtures from the reviewed fixture specification; decode bytes and verify declared dimensions. Browser screenshot/pixel assertions prove grayscale mask overlays the matching painting at the known lit rectangle, not a different image/profile or shifted region. Source dimensions alone or #18 descriptor assertions are not sufficient. No editor is built. Sources: requirements P2-05b/P2-07b/D14; P2 S7.
- [ ] **S7-05 — Approve/reject library and integrity.** Approve a draft through CLI library → final; reject a separate draft with exact fixture note → rejected plus same note in `notes.json`. Refresh/reopen proves persistence and list/filter changes. Hash job/masters/store/unrelated story before/after: unchanged. Assert browser performs library-backed actions, not direct JSON writes. Sources: P2 S7; requirements P2-07c/C-05/D5.
- [ ] **S7-06 — Failure and stale review.** Unknown ID, corrupt/unplayable media, induced save failure and invalid path show codes; no success/final on failure. Double-click cannot make conflicting writes. Render a changed draft while review is stale: no approval of unreviewed replacement bytes without refreshing/reviewing. Original valid index/store state survives failure. Sources: requirements P2-07c/D5/C-05.
- [ ] **S7-07 — 1440×900 e2e evidence.** Automated browser run at exactly 1440×900 covers setup → job/filter → listen/look/mask → approve/reject → reload plus negative case. Record test command/results, viewport screenshots, socket address, decoded format/dimensions and preservation hashes; no real account/settings/API or secrets. Stub audio conversion uses valid tiny media as requirements D14 specifies; real S4/S5 services are not a prerequisite for isolated UI tests.
- [ ] **S7-08 — PR opened.** `pnpm install --frozen-lockfile` and `pnpm check` pass; implementation PR is opened from a fresh feature worktree with S7-01…07 evidence, only allowed paths, no merge/deploy/publish by implementer. If required tooling/entry-point wiring exceeds Touches, resolve the pre-launch decision first rather than waive the e2e.

## AREA / DEC checklist

- [x] DEC-382/384: one review studio and human approval; looking/listening, not rendering/editor scope creep.
- [x] DEC-394/403: remembered/changeable work folder and local web app.
- [x] DEC-839: work-folder index owns status; Approve/Reject through library.
- [x] DEC-843: 0.2 review first; 0.3 camera/portrait editor excluded. No new MEC/UI gameplay change or Loremaster production portrait requirement.
- [ ] Wright closes S2/S3 merge and unmet requirements-publication gates above. #18 descriptor review is recorded, not S7 acceptance.

## Pre-launch Touches decisions (Wright; not granted)

- [ ] After S3 merges, verify `asset-studio studio` can be wired without edits outside `packages/studio/**`. If CLI dispatcher/bin or `packages/cli/package.json` must change, list its exact path(s) for Wright before implementation launch. No alternate wrapper/second CLI contract to dodge this boundary.
- [ ] Inventory runtime/workspace dependency and browser/e2e runner needs against merged main. `packages/studio/package.json` is inside Touches, but any necessary **`pnpm-lock.yaml`**, root `package.json`, `pnpm-workspace.yaml` or shared config/workflow change is outside. Wright must explicitly decide exact expanded paths or supply prerequisite tooling in its owning lane. Do not alter manifests without a matching legitimate lock update or skip the browser test.
- No exact outside dependency set can be honestly certified before S3/fixture review; this checklist grants none. Keep S5's lockfile lane separate. The brief is publishable for completeness review, **not unconditional implementation-launch approval**.

## Locked copy

- No new game dialogue/product wording is decided. Fixture source text/notes stay exactly those accepted in #18 review; display uses existing library caption handling, not a new pause-markup interpretation. Errors show their library code. Path setup/settings/Approve/Reject follow P2 S7, not newly invented story labels.

## Review and handoff

- **ONE independent cross-review: Anvil reviews Hammer's S7 PR.** Reviewer checks loopback/config/library use, decoded media/pixels/mask evidence, persistent status/note and integrity, full 1440×900 flow, and no unapproved outside paths. Author does not self-review; no second review launched by this brief.
- Wright owns completeness, pre-launch Touches decisions and merge. S4/S5 real outputs later supply integration evidence; deterministic fixtures do not certify those renderers.
