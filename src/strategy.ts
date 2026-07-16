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

export interface StrategyInput {
  intent: string;
  editContext: EditContextInput | null;
  /** Current artifact contents by id — the base state ui patches diff against. */
  artifacts: Record<string, string>;
  knowledge: RetrievedKnowledge[];
  provider: ModelProvider;
  /** RFC 3339 timestamp supplied by the harness clock (determinism). */
  now: string;
  maxAttempts: number;
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
