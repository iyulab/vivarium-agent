# Changelog

All notable changes to `@vivariumjs/agent` are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) ·
versioning: 0.x — minor for surface changes, patch for fixes. The agent
consumes the changeset contract; it never applies changesets itself.

## 0.1.1 — 2026-07-19

### Fixed

- **A surgical turn no longer breaks every following refine.** `verified-diff@0`
  patches carry a diff plus fingerprints, not `newContent` — the session
  projection read `patch.newContent` blindly, set the shared artifact to
  `undefined`, and the next refine fed `undefined` content to the model prompt
  and threw. The 0.1.0 headline feature thus broke multi-turn sessions.
  Projection is now profile-aware: `verified-diff@0` reconstructs its result via
  the SDK's `verifyAgainstBase` against the content matching `baseFingerprint`;
  a base mismatch or unknown profile is a loud throw, never a silent
  `undefined`. `whole-artifact@0` keeps using `newContent`.

## 0.1.0 — 2026-07-19

### Added

- **`uiEdits` → `verified-diff@0` strategy** (consumes changeset spec 0.2).
  The model communicates a local change as exact substring find/replace pairs;
  the strategy applies them to the base and derives the dialect diff mechanically
  (`addVerifiedDiffPatch`). The model never writes a diff itself, so the profile
  adds no new failure mode, and whole-artifact `uiPatches` remains the universal
  fallback.
- `applyUiEdits` refuses with actionable retry messages: unknown artifact,
  missing or ambiguous `find`, no-change edit, or mixed forms.
- `specVersion` minimality is automatic — a document that uses no `uiEdits`
  stays at 0.1.0.

### Changed

- Dependency: `@vivariumjs/changeset` `^0.2.0`.

## 0.0.3 — 2026-07-18

### Fixed

- **A surgical edit instruction could ship as a validated changeset that changed
  nothing** (found via consumer dogfooding, reproduced 3/3). Two root causes:
  - `buildGeneratePrompt` sent only PLAN + ARTIFACTS, so a retry whose error
    section stressed format compliance lost the edit instruction and the model
    regenerated the base verbatim. The fenced user INTENT now rides on **every**
    generation attempt.
  - No layer checked for no-ops: a payload whose patches all equalled the live
    base passed structural validation. The strategy now treats that as a
    retryable failure, exhausting if persistent — **the output is a changeset or
    nothing**, never a validated no-op.

## 0.0.2 — 2026-07-18

### Fixed

- **A refine chain whose intermediates were never applied could not pass
  apply-side drift gates.** A refine turn declared the prior proposal's
  projection as its `kind:"ui-artifact"` base — a state that had never existed
  on any stage (found by dogfooding against vivarium-stage: 409 DriftGate on the
  final refine). The session now tracks the live base separately: initialized
  from `propose()` artifacts, never advanced by validation (a validated-but-
  unapplied draft does not change the world), and re-based via the new
  `RefineOverrides.baseArtifacts` when the host applies a proposal or an external
  change lands. The draft chain stays in the `kind:"changeset"` lineage entry,
  which apply gates exempt.

## 0.0.1 — 2026-07-17

Initial npm release: the agent harness — pluggable provider / knowledge /
strategy ports, the plan-then-generate default strategy with a spec-validate
retry loop, provenance recording, and the multi-turn proposal session
(refinements chain on the prior proposal, lineage recorded in provenance).

- `@vivariumjs/changeset` is consumed from the registry (`^0.1.0`) rather than
  as a sibling `file:` dependency, so a standalone clone/install/import works.
- Publishable `dist` (strict `tsc`, `prepack`), engines `>=20`, tag-triggered
  publish workflow with post-publish registry verification.
