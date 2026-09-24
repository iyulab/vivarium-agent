# Vivarium Agent

> Agent harness that turns natural-language intent and on-screen selection into verified changesets, with pluggable domain knowledge.

**Status: published on npm — [`@vivariumjs/agent`](https://www.npmjs.com/package/@vivariumjs/agent), 0.x** (pre-1.0: minor versions may change the surface — see the [changelog](https://github.com/iyulab/vivarium-agent/blob/main/CHANGELOG.md)). This document fixes the harness's purpose, boundaries, and the contract it lives by. The core — pluggable provider/knowledge/strategy ports, the plan-then-generate default strategy with a spec-validate retry loop, provenance recording, and the multi-turn proposal session (refinements chain on the prior proposal, with lineage recorded in provenance) — is implemented and tested; model choices and retrieval design remain open.

**To host it in your app, start with the [getting-started guide](https://github.com/iyulab/vivarium-agent/blob/main/docs/getting-started.md)** (`npm install @vivariumjs/agent`).

**Supported Node**: the package declares `engines.node >= 20`, and CI runs a fresh
consumer install on that floor every build — the floor is executed, not just claimed.
It is a *supported* floor, not a recommendation: Node 20 reached end-of-life on
2026-04-30, so an actively supported release line is the better choice for new work.

---

## Why

"Make this textbox bigger. Add a due-date to the loan screen. Create a new request form." Editing a live application through conversation is the interface people actually want — but a raw LLM call is not an editing system. Three things are missing between "the user said something" and "a change that can be trusted":

1. **Grounding in what the user is pointing at.** "This textbox" is meaningless without the screen state and element selection behind it.
2. **Grounding in what the platform allows.** An agent that doesn't know the runtime's primitive surface, the data model's shape, or the house rules for deriving entities will generate plausible nonsense.
3. **An output that can be reviewed before it acts.** Free-form code or ad-hoc API calls cannot be gated; a fingerprinted changeset can.

Vivarium Agent is the harness that supplies all three: it consumes **edit context** (from a runtime such as [Vivarium](https://github.com/iyulab/vivarium)) plus natural language, retrieves the relevant platform knowledge, and emits a **changeset** ([`vivarium-changeset`](https://github.com/iyulab/vivarium-changeset)) — never a direct mutation.

## What this repository contains

- **The harness.** Session management, edit-context ingestion, knowledge retrieval orchestration, changeset assembly and validation. The plumbing that makes an LLM into a disciplined editor.
- **The knowledge interface.** A pluggable slot for domain knowledge — the runtime's primitive catalog, the target platform's schema conventions, methodology rules (e.g. entity-derivation conventions), house style. Knowledge is data fed to the harness, not code baked into it.
- **The proposal loop.** Multi-turn refinement: the agent proposes a changeset, the human (or a policy) reviews, the conversation continues with the proposal as shared state.

## What this repository is not

- **Not an applier.** The agent's output stops at a validated, fingerprinted changeset. It holds no credentials to any database or runtime and cannot make anything happen by itself. Apply belongs to [`vivarium-stage`](https://github.com/iyulab/vivarium-stage) or an equivalent consumer.
- **Not a model.** The harness is model-agnostic. Which LLM, local or hosted, one call or many — provider concerns behind an interface.
- **Not a chatbot framework.** Conversation exists here only in service of producing changes. General-purpose assistant features are out of scope.
- **Not the knowledge itself.** Primitive catalogs, schema conventions, and methodology rules ship with the platforms that own them. This repo defines the socket, not the plug.

## Fixed principles

1. **Output is a changeset or nothing.** No side channels: the agent never calls a data API, never patches UI directly, never applies. Everything it wants to happen must be expressible in the contract — if it can't be, that's a contract discussion, not an excuse for a bypass.
2. **Proposals are reviewable by construction.** Every emitted changeset validates against the spec, carries per-change explanations, and is fingerprinted before it leaves the harness.
3. **Edit context in, provenance out.** What the agent was looking at (screen, selection, base state, and which live facets it was shown) is recorded, so review can judge the proposal against the state it was made for — including telling a considered choice apart from a blind spot.
4. **Knowledge is pluggable and inspectable.** The harness must be able to say what knowledge sources informed a proposal. Swapping domains (a manufacturing platform vs. a note-taking tool) must not require changing harness code.
5. **The model is replaceable.** No fixed principle may depend on the behavior of a specific LLM.

## Decided in v0

- Host shape: a TypeScript library first; a sidecar can wrap the same core
  when demand for one materializes. The harness never owns credentials —
  model calls go through an injected provider port.
- Default strategy: plan-then-generate with a bounded validate-retry loop
  (the validator is the changeset SDK — deterministic, not a model).
  Strategies are swappable modules; this is a default, not a commitment.
- Surgical changes ride as `verified-diff@0` (changeset spec 0.2): the model
  answers with exact-substring edits, the strategy derives the strict-dialect
  diff via the SDK — the diff is computed, never model-written, and full
  `newContent` (whole-artifact) remains the universal fallback shape. The
  document's `specVersion` stays at the lowest version its features require.
- Input contract matches the output contract: a changeset has three facets, so
  the harness accepts three. The live schema and data are optional first-class
  inputs (`SchemaInput` / `DataInput`, in the specification's own vocabulary)
  and they reach the generation step, not just planning — a step asked to emit
  schema and data operations while seeing only UI content can only invent
  identifiers or drop those facets. Omitting them is unchanged behavior.
  Supplying them also lets the harness refuse, at authoring time, an operation
  targeting an entity, field or row that does not exist; that check is bounded
  to the facets it was given and judges against the world the changeset
  produces. Judging whether the three facets *belong* together is not the
  harness's job — that is a reviewer's.
- Session composition: a refinement is authored against the world *plus* the
  prior validated proposal (its projection becomes the base artifacts), and
  that lineage is machine-readable in the changeset's `provenance.baseState`
  (`{ kind: "changeset", ref, fingerprint }`). An exhausted turn never
  advances the shared state.

## Deliberately undecided

- Model provider(s), routing, and local-vs-hosted strategy
- Retrieval design (RAG shape, indexing, how catalogs and conventions are encoded)
- Rebasing a session onto a world that moved underneath it (v0 refuses via
  drift detection; a smarter strategy is future work)

## Relationship to the Vivarium family

A running instance of the family — propose, preview, approve, apply, roll back — is
browsable as a gallery of archived runs: [vivarium-gallery](https://github.com/iyulab/vivarium-gallery)
([live](https://iyulab.github.io/vivarium-gallery/)). Each exhibit keeps the final artifacts, the
turn ledger and the rollback record of an actual run. A run archived with its changeset
documents and approval records can be re-checked offline against them, without a server or a
model; the index marks the runs that cannot.


Depends on [`vivarium-changeset`](https://github.com/iyulab/vivarium-changeset) (its output contract) and consumes the edit-context format published by [`vivarium`](https://github.com/iyulab/vivarium). It has no dependency on `vivarium-stage` — the agent doesn't know or care who applies its proposals.

Standalone use is a first-class scenario: any product wanting a *"conversational editor that proposes reviewable changes"* — regardless of what it edits — can host this harness with its own knowledge plug and its own applier.

## License

Apache-2.0.