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
  PriorProposalContext,
} from "./strategy.ts";

export { createProposalSession } from "./session.ts";
export type {
  ProposalSession,
  ProposalSessionOptions,
  SessionTurnRecord,
  RefineOverrides,
} from "./session.ts";

export { createPlanThenGenerateStrategy, fenceUntrusted } from "./strategies/plan-then-generate.ts";
