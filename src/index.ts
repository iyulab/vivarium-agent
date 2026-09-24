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
  SchemaInput,
  FacetBase,
  DataInput,
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

export { EditContextVersionError, SUPPORTED_EDIT_CONTEXT_VERSIONS } from "./edit-context.ts";
export { createProposalSession, SessionCallOrderError } from "./session.ts";
export type {
  ProposalSession,
  ProposalSessionOptions,
  SessionTurnRecord,
  RefineOverrides,
  SessionCallOrderReason,
} from "./session.ts";

export { createPlanThenGenerateStrategy, fenceUntrusted } from "./strategies/plan-then-generate.ts";
