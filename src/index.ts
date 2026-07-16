export { createAgentHarness } from "./harness.ts";
export type {
  AgentHarness,
  AgentHarnessOptions,
  ProposeRequest,
  ProposeResult,
  Proposal,
} from "./harness.ts";

export type {
  ModelProvider,
  ModelRequest,
  KnowledgeSource,
  KnowledgeQuery,
  EditContextInput,
} from "./ports.ts";

export type {
  ProposalStrategy,
  StrategyInput,
  StrategyOutcome,
  ValidatedOutcome,
  ExhaustedOutcome,
  AttemptRecord,
  RetrievedKnowledge,
} from "./strategy.ts";

export { createPlanThenGenerateStrategy, fenceUntrusted } from "./strategies/plan-then-generate.ts";
