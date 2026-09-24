# Changelog

All notable changes to `@vivariumjs/agent` are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) ·
versioning: 0.x — minor for surface changes, patch for fixes. The agent
consumes the changeset contract; it never applies changesets itself.

## 0.4.0 — 2026-09-24

### Added
- `EditContextVersionError` (`received`, `supported`) and
  `SUPPORTED_EDIT_CONTEXT_VERSIONS` (`["0.2"]`).

### Changed
- Depends on `@vivariumjs/changeset` ^0.6.0 (spec 0.5.0). The agent never writes an
  `attestation`, so its documents are unaffected by that release's tightening.
- **Breaking — an edit context of an unsupported version is refused.** `propose()`,
  and a session's `propose()`/`refine()`, throw `EditContextVersionError` before any
  model call when `editContextVersion` is not 0.2 (patch levels such as 0.2.1 pass).
  The edit context contract asks consumers to refuse a major/minor they do not read,
  and 0.2 is not additive over 0.1; before, a context of any version was read as 0.2.
  A refused `refine()` override is not adopted — the session keeps its previous
  context. Migration: produce the context with a runtime that emits 0.2
  (`@vivariumjs/runtime` 0.4.0 or later).

## 0.3.1 — 2026-09-23

### Changed
- Depends on `@vivariumjs/changeset` ^0.5.0. No change to the agent's own API or output: documents are
  still stamped at the spec versions they were before.

## 0.3.0 — 2026-09-23

### Changed
- **Consumes edit context 0.2**: `screen.elements` (the selection's neighbourhood, with
  `relation` and `role`) in place of `screen.elementIds`, and an optional accessible `name`
  on `untrusted` entries. Breaking for callers that build the input type themselves.
- The refusal for writing a value into a field the same changeset removes now says why the
  write cannot survive — the removal applies after the document's data operations (changeset
  spec §5.4) and takes the values with it — instead of asserting that only a null clear is
  "meaningful". The behaviour is unchanged; the reason it gives is now the contract's.

### Dependencies
- `@vivariumjs/changeset` ^0.4.0 (was ^0.3.0).

## 0.2.1 — 2026-09-19

### Fixed
- **A changeset can clear what it removes.** With the live schema supplied, data operations were judged
  against the schema after the document's own `field.remove`, so clearing the removed field's values was
  refused as a write to an undeclared field — a change retiring a field together with its values could not
  be authored. Removal is now treated as retiring: setting a removed field to `null`, selecting rows by it,
  and deleting the rows of a removed entity are valid targets. Writing a value into a removed field, or
  inserting into a removed entity, is still refused.

### CI
- **Publish workflow** is rerun-safe and its registry check is conclusive: the publish step skips a version that is
  already live, the verification retries with `--prefer-online` (the registry's metadata cache otherwise re-serves the
  first 404 for its five-minute lifetime) over a ~10-minute window, and an exhausted window fails with the reason.

## 0.2.0 — 2026-09-18

### Added
- **A session call in the wrong order says so structurally.** `propose` opens a
  session and `refine` continues it — so there are exactly two ways to get the order
  wrong, and both are the caller's to fix. Until now both arrived as a plain `Error`,
  which left a host to recover the session's state by matching on the message text.
  `SessionCallOrderError` carries `reason` (`"no-prior-turn"` /
  `"session-already-started"`) and `turnCount` — the one number that decides which
  call is legal, `0` meaning only `propose` is. The messages are unchanged, so prose
  still reads as prose; a closed set of reasons fits here rather than a numeric code
  because the failures never cross a serialization boundary and no third case is
  coming.
- **`propose` and `refine` accept the live schema and data facets.** A changeset has
  three facets, and until now the harness only accepted one of them as input: the
  generation step was asked to emit schema and data operations while seeing nothing
  but UI artifact content. It could not name an entity, could not tell whether a field
  already existed, and could not identify a row for a `where` clause — so it either
  invented identifiers or dropped those facets and shipped a UI-only change that read
  as complete. `SchemaInput` and `DataInput` speak the changeset specification's own
  vocabulary (§5.1 logical schema operations, §5.3 data operations), so the view is
  the same for every host. Both are optional and absent means the previous behavior,
  byte for byte: a UI-only host is unaffected.
- **The generation prompt states the operation vocabulary it asks for.** Naming a
  facet without naming its operation shape left the model to guess members the
  specification closes — including the asymmetry that a schema operation carries its
  own `explanation` while a data patch carries one per patch.
- **Author-time target checking.** An operation naming an entity, field or row that
  does not exist used to pass validation, seal into the fingerprint, clear the approval
  gate, and surface inside a backend write path — the latest and most expensive place
  for it to fail. When the facets are supplied, the harness now refuses it at authoring
  time, as a retryable error naming both the missing target and the existing ones. The
  refusal is bounded twice: it judges only the facets it was given the state to judge,
  and it judges against the world the changeset *produces*, so creating an entity and
  extending it in the same document is coherent rather than contradictory. Supplying
  nothing keeps the previous behavior.
- **A proposal declares the schema and data bases it changes, when the host names
  them.** `SchemaInput` and `DataInput` take an optional `base: { ref, fingerprint }`
  — the facet's identity as the host's adapter reports it. When the changeset carries
  schema operations or data patches, that base goes into `provenance.baseState`
  (`kind: "schema"` / `"data"`; a data entry stamps spec 0.3.0), so a drift-detecting
  applier refuses the proposal once the live facet has moved. Until now even a
  three-facet proposal declared only its UI artifacts, and a stale proposal applied
  over a schema or rows that had changed under it. The harness does not compute these
  fingerprints — the specification leaves them to the adapter — and does not declare a
  facet the changeset leaves alone, since a whole-facet data fingerprint would then
  refuse unrelated changes. The base is kept out of the prompts.
- **`provenance.facetsSeen`** — which live facets reached the prompts. A proposal that
  touches no data reads differently depending on whether the rows were visible; nothing
  else in the document distinguishes a considered choice from a blind spot. Distinct
  from the changeset's `provenance.baseState`, which declares a fingerprinted state a
  drift gate checks.

### Changed
- **Depends on `@vivariumjs/changeset` `^0.3.0`** (was `^0.2.0`). A proposal that declares a
  data base carries `baseState.kind: "data"`, which is 0.3 vocabulary; the SDK stamps the
  document's `specVersion` accordingly.

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
