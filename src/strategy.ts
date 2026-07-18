/**
 * Strategy port — how a proposal is produced. The v0 default is
 * plan-then-generate with a validate-retry loop (umbrella design ADR-0002),
 * but the strategy is a swappable module: this interface is the contract,
 * not the algorithm.
 *
 * State machine: intent → plan → draft → validated | exhausted. Every
 * transition is recorded so the proposal loop can expose it as shared state.
 */

import type { ModelProvider, KnowledgeQuery, EditContextInput } from "./ports.ts";

export interface RetrievedKnowledge {
  source: string;
  items: string[];
}

/**
 * Context of the prior validated proposal when the current call refines it
 * (proposal loop). The refinement is authored against the world *plus* the
 * prior changeset — strategies must record that lineage in the emitted
 * changeset's provenance.baseState ({ kind: "changeset", ref, fingerprint }).
 */
export interface PriorProposalContext {
  /** 1-based turn number of the prior proposal within the session. */
  turn: number;
  /** Stable reference, e.g. "proposal-session:<id>#<turn>". */
  ref: string;
  /** Fingerprint of the prior validated changeset. */
  fingerprint: string;
  /** The prior plan — model-derived, treated as fenced data in prompts. */
  plan: string;
  /** Patch explanations of the prior changeset (reviewer-facing summary). */
  explanations: string[];
}

export interface StrategyInput {
  intent: string;
  editContext: EditContextInput | null;
  /** Current artifact contents by id — the base state ui patches diff against. */
  artifacts: Record<string, string>;
  /**
   * The artifacts of the world the emitted changeset will be APPLIED to (the
   * live state), when it differs from `artifacts`. In a proposal session's
   * refine turn, `artifacts` is the projection of the prior (not yet released)
   * proposal — the refinement anchor for the model — while the world is still
   * at the state the chain started from. Strategies must anchor the
   * changeset's `kind:"ui-artifact"` baseState entries and ui-patch
   * baseContent to THIS state (falling back to `artifacts` when absent), so
   * the emitted changeset stays appliable; the draft chain itself is carried
   * by the `kind:"changeset"` lineage entry.
   */
  baseArtifacts?: Record<string, string> | null;
  knowledge: RetrievedKnowledge[];
  provider: ModelProvider;
  /** RFC 3339 timestamp supplied by the harness clock (determinism). */
  now: string;
  maxAttempts: number;
  /** Present when this proposal refines a prior one (proposal loop). */
  prior?: PriorProposalContext | null;
}

export interface AttemptRecord {
  attempt: number;
  /** Validation error strings that caused this attempt to be retried. */
  errors: string[];
}

export interface ValidatedOutcome {
  status: "validated";
  /** Conforming, fingerprinted changeset document (spec 0.1.0). */
  changeset: Record<string, unknown> & { fingerprint: string };
  plan: string;
  attempts: number;
  retries: AttemptRecord[];
}

export interface ExhaustedOutcome {
  status: "exhausted";
  plan: string | null;
  attempts: number;
  retries: AttemptRecord[];
}

export type StrategyOutcome = ValidatedOutcome | ExhaustedOutcome;

export interface ProposalStrategy {
  /** Recorded in provenance, e.g. "plan-then-generate@0". */
  readonly name: string;
  propose(input: StrategyInput): Promise<StrategyOutcome>;
}

export type { KnowledgeQuery };
