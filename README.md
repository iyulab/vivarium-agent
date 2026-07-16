# Vivarium Agent

> Agent harness that turns natural-language intent and on-screen selection into verified changesets, with pluggable domain knowledge.

**Status: design phase (pre-0.1).** This document fixes the harness's purpose, boundaries, and the contract it lives by. Model choices, prompting strategy, and retrieval design are intentionally left open.

---

## Why

"Make this textbox bigger. Add a due-date to the loan screen. Create a new request form." Editing a live application through conversation is the interface people actually want — but a raw LLM call is not an editing system. Three things are missing between "the user said something" and "a change that can be trusted":

1. **Grounding in what the user is pointing at.** "This textbox" is meaningless without the screen state and element selection behind it.
2. **Grounding in what the platform allows.** An agent that doesn't know the runtime's primitive surface, the data model's shape, or the house rules for deriving entities will generate plausible nonsense.
3. **An output that can be reviewed before it acts.** Free-form code or ad-hoc API calls cannot be gated; a fingerprinted changeset can.

Vivarium Agent is the harness that supplies all three: it consumes **edit context** (from a runtime such as [Vivarium](https://github.com/iyulab/vivarium)) plus natural language, retrieves the relevant platform knowledge, and emits a **changeset** ([`vivarium-changeset`](https://github.com/iyulab/vivarium-changeset)) — never a direct mutation.

## What this repository contains

- **The harness.** Session management, edit-context ingestion, knowledge retrieval orchestration, changeset assembly and validation. The plumbing that makes an LLM into a disciplined editor.
- **The knowledge interface.** A pluggable slot for domain knowledge — the runtime's primitive catalog, the target platform's schema conventions, methodology rules (e.g. [Formology](https://github.com/iyulab/Formology)-style entity derivation), house style. Knowledge is data fed to the harness, not code baked into it.
- **The proposal loop.** Multi-turn refinement: the agent proposes a changeset, the human (or a policy) reviews, the conversation continues with the proposal as shared state.

## What this repository is not

- **Not an applier.** The agent's output stops at a validated, fingerprinted changeset. It holds no credentials to any database or runtime and cannot make anything happen by itself. Apply belongs to [`vivarium-stage`](https://github.com/iyulab/vivarium-stage) or an equivalent consumer.
- **Not a model.** The harness is model-agnostic. Which LLM, local or hosted, one call or many — provider concerns behind an interface.
- **Not a chatbot framework.** Conversation exists here only in service of producing changes. General-purpose assistant features are out of scope.
- **Not the knowledge itself.** Primitive catalogs, schema conventions, and methodology rules ship with the platforms that own them. This repo defines the socket, not the plug.

## Fixed principles

1. **Output is a changeset or nothing.** No side channels: the agent never calls a data API, never patches UI directly, never applies. Everything it wants to happen must be expressible in the contract — if it can't be, that's a contract discussion, not an excuse for a bypass.
2. **Proposals are reviewable by construction.** Every emitted changeset validates against the spec, carries per-change explanations, and is fingerprinted before it leaves the harness.
3. **Edit context in, provenance out.** What the agent was looking at (screen, selection, base state) is recorded in the changeset's provenance, so review can judge the proposal against the state it was made for.
4. **Knowledge is pluggable and inspectable.** The harness must be able to say what knowledge sources informed a proposal. Swapping domains (a manufacturing platform vs. a note-taking tool) must not require changing harness code.
5. **The model is replaceable.** No fixed principle may depend on the behavior of a specific LLM.

## Deliberately undecided

- Model provider(s), routing, and local-vs-hosted strategy
- Retrieval design (RAG shape, indexing, how catalogs and conventions are encoded)
- Prompting and planning strategy (single-shot, plan-then-generate, self-review loops)
- Host process shape (library, sidecar service, or both)
- How multi-changeset sessions compose (stacking proposals vs. rebasing)

## Relationship to the Vivarium family

Depends on [`vivarium-changeset`](https://github.com/iyulab/vivarium-changeset) (its output contract) and consumes the edit-context format published by [`vivarium`](https://github.com/iyulab/vivarium). It has no dependency on `vivarium-stage` — the agent doesn't know or care who applies its proposals.

Standalone use is a first-class scenario: any product wanting a *"conversational editor that proposes reviewable changes"* — regardless of what it edits — can host this harness with its own knowledge plug and its own applier.

## License

Apache-2.0.