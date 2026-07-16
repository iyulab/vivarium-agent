/**
 * Proposal session — the multi-turn refinement loop (proposal loop).
 *
 * The proposal is shared state: each refine() takes the previous validated
 * proposal as its base — the base artifacts are the projection of that
 * proposal's ui patches, and the emitted changeset records the lineage in
 * provenance.baseState ({ kind: "changeset", ref, fingerprint }). The state
 * machine transitions (intent → plan → draft → validated | exhausted, design
 * ADR-0002) are recorded per turn and enumerable via history().
 *
 * An exhausted turn never advances the shared state ("changeset or nothing"):
 * the base artifacts and the refinement anchor stay at the last validated
 * proposal.
 */

import { randomUUID } from "node:crypto";
import { createAgentHarness } from "./harness.ts";
import type { AgentHarnessOptions, ProposeRequest, ProposeResult } from "./harness.ts";
import type { EditContextInput } from "./ports.ts";
import type { PriorProposalContext } from "./strategy.ts";

export interface ProposalSessionOptions extends AgentHarnessOptions {
  /** Stable session identifier used in lineage refs. Default: random UUID. */
  sessionId?: string;
}

export interface SessionTurnRecord {
  /** 1-based turn number. */
  turn: number;
  intent: string;
  status: "validated" | "exhausted";
  /** Changeset fingerprint for validated turns, null for exhausted ones. */
  fingerprint: string | null;
  attempts: number;
}

export interface RefineOverrides {
  /** Re-selection: a fresh edit context for this refinement turn. */
  editContext?: EditContextInput | null;
}

export interface ProposalSession {
  /** First turn: same contract as the harness propose(). */
  propose(request: ProposeRequest): Promise<ProposeResult>;
  /** Subsequent turn: refines the last validated proposal. */
  refine(instruction: string, overrides?: RefineOverrides): Promise<ProposeResult>;
  /** The state-machine transcript — one record per turn. */
  history(): SessionTurnRecord[];
  /** Projected artifact contents after the last validated proposal. */
  artifacts(): Record<string, string>;
  describe(): {
    sessionId: string;
    turns: number;
    provider: string;
    strategy: string;
    knowledgeSources: string[];
  };
}

interface UiPatchLike {
  artifactId: string;
  newContent: string;
  explanation: string;
}

function uiPatchesOf(changeset: Record<string, unknown>): UiPatchLike[] {
  const patches = changeset.patches as { ui?: UiPatchLike[] } | undefined;
  return patches?.ui ?? [];
}

function explanationsOf(changeset: Record<string, unknown>): string[] {
  const patches = changeset.patches as
    | { schema?: Array<{ explanation?: string }>; ui?: UiPatchLike[]; data?: Array<{ explanation?: string }> }
    | undefined;
  const all = [
    ...(patches?.schema ?? []),
    ...(patches?.ui ?? []),
    ...(patches?.data ?? []),
  ];
  return all.map((p) => p.explanation ?? "").filter((e) => e !== "");
}

export function createProposalSession(options: ProposalSessionOptions): ProposalSession {
  const { sessionId = randomUUID(), ...harnessOptions } = options;
  const harness = createAgentHarness(harnessOptions);

  const turns: SessionTurnRecord[] = [];
  let artifacts: Record<string, string> = {};
  let editContext: EditContextInput | null = null;
  let lastValidated: PriorProposalContext | null = null;

  async function run(request: ProposeRequest): Promise<ProposeResult> {
    const turn = turns.length + 1;
    const result = await harness.propose(request);

    turns.push({
      turn,
      intent: request.intent,
      status: result.proposal ? "validated" : "exhausted",
      fingerprint: result.proposal?.fingerprint ?? null,
      attempts: result.outcome.attempts,
    });

    if (result.proposal) {
      // Advance the shared state: project ui patches onto the base artifacts.
      const projected = { ...(request.artifacts ?? {}) };
      for (const patch of uiPatchesOf(result.proposal.changeset)) {
        projected[patch.artifactId] = patch.newContent;
      }
      artifacts = projected;
      lastValidated = {
        turn,
        ref: `proposal-session:${sessionId}#${turn}`,
        fingerprint: result.proposal.fingerprint,
        plan: result.proposal.plan,
        explanations: explanationsOf(result.proposal.changeset),
      };
    }
    return result;
  }

  return {
    async propose(request: ProposeRequest): Promise<ProposeResult> {
      if (turns.length > 0) {
        throw new Error("propose() starts a session and can run only once — use refine() for subsequent turns");
      }
      artifacts = { ...(request.artifacts ?? {}) };
      editContext = request.editContext ?? null;
      return run(request);
    },

    async refine(instruction: string, overrides?: RefineOverrides): Promise<ProposeResult> {
      if (turns.length === 0) {
        throw new Error("refine() requires a prior turn — call propose() first");
      }
      if (overrides && "editContext" in overrides) {
        editContext = overrides.editContext ?? null;
      }
      return run({
        intent: instruction,
        editContext,
        artifacts: { ...artifacts },
        prior: lastValidated,
      });
    },

    history(): SessionTurnRecord[] {
      return turns.map((t) => ({ ...t }));
    },

    artifacts(): Record<string, string> {
      return { ...artifacts };
    },

    describe() {
      return { sessionId, turns: turns.length, ...harness.describe() };
    },
  };
}
