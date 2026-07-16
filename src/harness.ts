/**
 * The agent harness: edit-context in, verified changeset (or nothing) out.
 *
 * Fixed principles enforced structurally:
 * 1. Output is a changeset or nothing — propose() resolves to a validated,
 *    fingerprinted document or null; there is no other effect channel.
 * 2. Reviewable by construction — validation and fingerprinting happen via
 *    the changeset SDK before anything leaves the harness.
 * 3. Edit context in, provenance out — the consumed edit context and the
 *    knowledge sources that informed the proposal are recorded.
 * 4. Knowledge is pluggable and inspectable — sources are injected and
 *    enumerated per proposal.
 * 5. The model is replaceable — providers are injected ports.
 */

import type { ModelProvider, KnowledgeSource, EditContextInput } from "./ports.ts";
import type {
  ProposalStrategy,
  StrategyOutcome,
  RetrievedKnowledge,
  PriorProposalContext,
} from "./strategy.ts";
import { createPlanThenGenerateStrategy } from "./strategies/plan-then-generate.ts";

export interface AgentHarnessOptions {
  provider: ModelProvider;
  knowledge?: KnowledgeSource[];
  strategy?: ProposalStrategy;
  /** Retry budget for the validate loop. Default 3. */
  maxAttempts?: number;
  /** RFC 3339 clock, injected for determinism. Default: system time. */
  clock?: () => string;
}

export interface ProposeRequest {
  intent: string;
  editContext?: EditContextInput | null;
  /** Current artifact contents by id — base state for ui patches. */
  artifacts?: Record<string, string>;
  /** Present when this proposal refines a prior one (proposal loop). */
  prior?: PriorProposalContext | null;
}

export interface Proposal {
  /** Conforming, fingerprinted changeset (spec 0.1.0). */
  changeset: Record<string, unknown> & { fingerprint: string };
  fingerprint: string;
  plan: string;
  provenance: {
    strategy: string;
    provider: string;
    knowledgeSources: string[];
    attempts: number;
    /** Fingerprint of the proposal this one refines, when in a session. */
    refinedFrom: string | null;
  };
}

export interface ProposeResult {
  /** Null when the strategy exhausted its retry budget: changeset or nothing. */
  proposal: Proposal | null;
  outcome: StrategyOutcome;
  knowledge: RetrievedKnowledge[];
}

export interface AgentHarness {
  propose(request: ProposeRequest): Promise<ProposeResult>;
  /** Enumerable audit surface: what this harness is wired with. */
  describe(): { provider: string; strategy: string; knowledgeSources: string[] };
}

export function createAgentHarness(options: AgentHarnessOptions): AgentHarness {
  const knowledge = options.knowledge ?? [];
  const strategy = options.strategy ?? createPlanThenGenerateStrategy();
  const maxAttempts = options.maxAttempts ?? 3;
  const clock = options.clock ?? (() => new Date().toISOString());

  return {
    describe() {
      return {
        provider: options.provider.name,
        strategy: strategy.name,
        knowledgeSources: knowledge.map((source) => source.name),
      };
    },

    async propose(request: ProposeRequest): Promise<ProposeResult> {
      const editContext = request.editContext ?? null;
      const retrieved: RetrievedKnowledge[] = [];
      for (const source of knowledge) {
        retrieved.push({
          source: source.name,
          items: await source.retrieve({ intent: request.intent, editContext }),
        });
      }

      const outcome = await strategy.propose({
        intent: request.intent,
        editContext,
        artifacts: request.artifacts ?? {},
        knowledge: retrieved,
        provider: options.provider,
        now: clock(),
        maxAttempts,
        prior: request.prior ?? null,
      });

      if (outcome.status !== "validated") {
        return { proposal: null, outcome, knowledge: retrieved };
      }
      return {
        proposal: {
          changeset: outcome.changeset,
          fingerprint: outcome.changeset.fingerprint,
          plan: outcome.plan,
          provenance: {
            strategy: strategy.name,
            provider: options.provider.name,
            knowledgeSources: retrieved.map((k) => k.source),
            attempts: outcome.attempts,
            refinedFrom: request.prior?.fingerprint ?? null,
          },
        },
        outcome,
        knowledge: retrieved,
      };
    },
  };
}
