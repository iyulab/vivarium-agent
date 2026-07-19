/**
 * Proposal session — the multi-turn refinement loop (proposal loop).
 *
 * The proposal is shared state: each refine() takes the previous validated
 * proposal as its refinement anchor — the anchor artifacts are the projection
 * of that proposal's ui patches, and the emitted changeset records the draft
 * lineage in provenance.baseState ({ kind: "changeset", ref, fingerprint }).
 * The state machine transitions (intent → plan → draft → validated |
 * exhausted, design ADR-0002) are recorded per turn and enumerable via
 * history().
 *
 * The anchor is NOT the declared base: the changeset's `kind:"ui-artifact"`
 * baseState entries (and ui-patch baseContent) stay anchored to the LIVE
 * world state the session knows — initially the artifacts passed to
 * propose() — so a draft chain whose intermediates were never applied still
 * emits appliable changesets (apply-side drift gates compare those entries
 * against the live state; the changeset-kind lineage entry is exempt). When
 * the world moves (a proposal was applied, an external change landed), tell
 * the session via RefineOverrides.baseArtifacts.
 *
 * An exhausted turn never advances the shared state ("changeset or nothing"):
 * the declared base and the refinement anchor stay where they were.
 */

import { randomUUID } from "node:crypto";
import { verifyAgainstBase } from "@vivariumjs/changeset";
import type { VerifiedDiffUiPatch } from "@vivariumjs/changeset";
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
  /**
   * Re-base: the current live artifacts — pass when the world changed since
   * the session last knew it (e.g. a proposal from this session was applied,
   * or an external change landed). Only re-anchors what emitted changesets
   * declare (and diff) as their base; the refinement anchor — the last
   * validated proposal's projection the model keeps iterating on — is
   * unaffected.
   */
  baseArtifacts?: Record<string, string>;
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

/**
 * A ui patch is one of two profiles (spec §5.2.2): whole-artifact@0 carries
 * the full `newContent`; verified-diff@0 carries only a `diff` (+ fingerprints)
 * and the result must be reconstructed by applying it to the matching base.
 */
type UiPatch =
  | { profile: "whole-artifact@0"; artifactId: string; newContent: string; explanation: string }
  | VerifiedDiffUiPatch;

function uiPatchesOf(changeset: Record<string, unknown>): UiPatch[] {
  const patches = changeset.patches as { ui?: UiPatch[] } | undefined;
  return patches?.ui ?? [];
}

function explanationsOf(changeset: Record<string, unknown>): string[] {
  const patches = changeset.patches as
    | {
        schema?: Array<{ explanation?: string }>;
        ui?: Array<{ explanation?: string }>;
        data?: Array<{ explanation?: string }>;
      }
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
  // The live world state emitted changesets declare as their base. Advances
  // only when the caller says the world moved (RefineOverrides.baseArtifacts)
  // — never on validation, because validated-but-unapplied drafts don't
  // change the world.
  let baseArtifacts: Record<string, string> = {};
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
      // whole-artifact@0 carries newContent directly; verified-diff@0 carries
      // only a diff (spec §5.2.2) — reconstruct its result by applying the diff
      // to the content matching baseFingerprint (the strategy diffed against
      // baseArtifacts ?? artifacts). A base mismatch or unknown profile is a
      // loud failure, never a silent undefined that a later refine turn would
      // feed to the model (regression: verified-diff surgical turn crashed the
      // next refine — issues/ISSUE-vivarium-agent-20260719-233000).
      const projected = { ...(request.artifacts ?? {}) };
      for (const patch of uiPatchesOf(result.proposal.changeset)) {
        if (patch.profile === "verified-diff@0") {
          const base = request.baseArtifacts?.[patch.artifactId] ?? request.artifacts?.[patch.artifactId];
          if (typeof base !== "string") {
            throw new Error(`session projection: no base content for verified-diff patch ${patch.artifactId}`);
          }
          const verdict = verifyAgainstBase(patch, base);
          if (!verdict.ok) {
            throw new Error(
              `session projection: verified-diff patch for ${patch.artifactId} did not apply to base — ` +
                verdict.errors.map((e) => e.message).join("; "),
            );
          }
          projected[patch.artifactId] = verdict.newContent;
        } else if (patch.profile === "whole-artifact@0") {
          projected[patch.artifactId] = patch.newContent;
        } else {
          throw new Error(
            `session projection: ui patch has unknown profile ${String((patch as unknown as { profile?: unknown }).profile)}`,
          );
        }
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
      baseArtifacts = { ...(request.baseArtifacts ?? request.artifacts ?? {}) };
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
      if (overrides?.baseArtifacts) {
        baseArtifacts = { ...overrides.baseArtifacts };
      }
      return run({
        intent: instruction,
        editContext,
        artifacts: { ...artifacts },
        baseArtifacts: { ...baseArtifacts },
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
