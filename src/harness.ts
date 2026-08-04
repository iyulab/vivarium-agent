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

import type {
  ModelProvider,
  KnowledgeSource,
  EditContextInput,
  SchemaInput,
  DataInput,
} from "./ports.ts";
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
  /**
   * The live artifacts the changeset will be applied to, when they differ
   * from `artifacts` (proposal-loop refine turns pass the prior proposal's
   * projection as `artifacts`). See StrategyInput.baseArtifacts.
   */
  baseArtifacts?: Record<string, string> | null;
  /**
   * The live schema facet the change is authored against (spec §5.1
   * vocabulary). Supply it to let the proposal touch the schema facet: an
   * operation naming an entity or field is only authorable against a schema
   * the model can read.
   */
  schema?: SchemaInput | null;
  /**
   * The live data facet (spec §5.3 vocabulary) — the rows a `where` clause can
   * select. Supply it to let the proposal touch the data facet.
   */
  data?: DataInput | null;
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
    /**
     * Which live facets the model was shown, sorted and deduplicated. Empty
     * when none were supplied.
     *
     * Fixed principle 3 says what the agent was looking at is recorded so a
     * reviewer can judge the proposal against the state it was made for. Once
     * the schema and data facets became inputs, "what it was looking at" grew
     * and this is the part of it the harness can state on its own. It matters
     * because the answer changes how a proposal reads: a change that touches
     * no data is a considered choice when the rows were visible and a blind
     * spot when they were not, and nothing else in the document tells them
     * apart.
     *
     * This is not the same as the changeset's `provenance.baseState`, which
     * declares a fingerprinted state the applier's drift gate checks. This
     * only reports what reached the prompts — a weaker and honest claim.
     */
    facetsSeen: Array<"schema" | "data">;
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
        baseArtifacts: request.baseArtifacts ?? null,
        schema: request.schema ?? null,
        data: request.data ?? null,
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
            facetsSeen: [
              ...(request.schema ? (["schema"] as const) : []),
              ...(request.data ? (["data"] as const) : []),
            ],
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
