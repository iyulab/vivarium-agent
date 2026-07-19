import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, verifyFingerprint, artifactFingerprint } from "@vivariumjs/changeset";
import { createProposalSession } from "./session.ts";
import type { ModelRequest } from "./ports.ts";

const BASE = "export default function mount() {}";
const CONTENT_A = "export default function mount() { /* bigger button */ }";
const CONTENT_B = "export default function mount() { /* bigger, rounded button */ }";
const CONTENT_C = "export default function mount() { /* bigger, rounded, blue button */ }";

const payload = (newContent: string, explanation: string) =>
  JSON.stringify({ uiPatches: [{ artifactId: "screen-main", newContent, explanation }] });

const uiEditsPayload = (find: string, replace: string, explanation: string) =>
  JSON.stringify({ uiEdits: [{ artifactId: "screen-main", find, replace, explanation }] });

/**
 * Scripted provider for multi-turn sessions: planner calls (recognized by
 * their system prompt) return canned plans; generator calls consume a queue.
 */
function sessionProvider(generations: string[]) {
  const requests: ModelRequest[] = [];
  const planPrompts: ModelRequest[] = [];
  let planCount = 0;
  let generateIndex = 0;
  return {
    requests,
    planPrompts,
    provider: {
      name: "fake",
      async complete(request: ModelRequest): Promise<string> {
        requests.push(request);
        if (request.system.includes("editing planner")) {
          planPrompts.push(request);
          planCount += 1;
          return `plan-${planCount}: adjust the selected button.`;
        }
        const output = generations[Math.min(generateIndex, generations.length - 1)];
        generateIndex += 1;
        return output;
      },
    },
  };
}

const FIXED_CLOCK = () => "2026-07-16T12:00:00Z";

test("refine produces a new changeset based on the previous one", async () => {
  const scripted = sessionProvider([
    payload(CONTENT_A, "Make the button bigger."),
    payload(CONTENT_B, "Round the corners of the bigger button."),
  ]);
  const session = createProposalSession({
    provider: scripted.provider,
    clock: FIXED_CLOCK,
    sessionId: "s1",
  });

  const first = await session.propose({
    intent: "이 버튼을 더 크게",
    artifacts: { "screen-main": BASE },
  });
  assert.ok(first.proposal);

  const second = await session.refine("모서리를 둥글게");
  assert.ok(second.proposal, "refine must produce a validated proposal");

  const doc = second.proposal.changeset;
  assert.equal(validate(doc).valid, true);
  assert.equal(verifyFingerprint(doc), true);

  // ① The refined changeset's declared ui base stays at the LIVE origin —
  //    the prior proposal was never applied, so anchoring to its projection
  //    would make this changeset unappliable under apply-side drift gates.
  const ui = (doc.patches as { ui: Array<Record<string, unknown>> }).ui[0];
  assert.equal(ui.baseFingerprint, artifactFingerprint(BASE));

  // ② Session lineage lands in changeset provenance.baseState — the draft
  //    chain is carried here, not in the ui-artifact base entries.
  const baseState = (doc.provenance as { baseState: Array<Record<string, unknown>> }).baseState;
  const lineage = baseState.find((e) => e.kind === "changeset");
  assert.ok(lineage, "baseState must record the prior changeset");
  assert.equal(lineage.ref, "proposal-session:s1#1");
  assert.equal(lineage.fingerprint, first.proposal.fingerprint);
  const uiBase = baseState.find((e) => e.kind === "ui-artifact" && e.ref === "screen-main");
  assert.equal(uiBase?.fingerprint, artifactFingerprint(BASE));

  // Agent-side provenance carries the refinement anchor too.
  assert.equal(second.proposal.provenance.refinedFrom, first.proposal.fingerprint);
  assert.equal(first.proposal.provenance.refinedFrom, null);
});

test("session history records every state-machine transition and feeds the model", async () => {
  const scripted = sessionProvider([
    payload(CONTENT_A, "Make the button bigger."),
    payload(CONTENT_B, "Round the corners."),
  ]);
  const session = createProposalSession({
    provider: scripted.provider,
    clock: FIXED_CLOCK,
    sessionId: "s2",
  });

  await session.propose({ intent: "크게", artifacts: { "screen-main": BASE } });
  await session.refine("둥글게");

  const history = session.history();
  assert.equal(history.length, 2);
  assert.deepEqual(
    history.map((t) => ({ turn: t.turn, status: t.status, intent: t.intent })),
    [
      { turn: 1, status: "validated", intent: "크게" },
      { turn: 2, status: "validated", intent: "둥글게" },
    ],
  );
  assert.ok(history[0].fingerprint && history[1].fingerprint);
  assert.notEqual(history[0].fingerprint, history[1].fingerprint);

  // The refine planner sees the prior proposal as fenced shared state.
  const refinePlan = scripted.planPrompts[1];
  assert.match(refinePlan.user, /PRIOR PROPOSAL \(turn 1, sha256:/);
  assert.match(refinePlan.user, /plan-1: adjust the selected button\./);
  assert.match(refinePlan.user, /Round|bigger/);
  // Prior summary is data, not instructions — inside an untrusted fence.
  const fenceStart = refinePlan.user.indexOf("<<UNTRUSTED>> (prior proposal summary");
  const fenceEnd = refinePlan.user.indexOf("<</UNTRUSTED>>", fenceStart);
  const planIndex = refinePlan.user.indexOf("plan-1:");
  assert.ok(fenceStart !== -1 && fenceStart < planIndex && planIndex < fenceEnd);

  // Shared artifact state advanced to the latest projection.
  assert.equal(session.artifacts()["screen-main"], CONTENT_B);
  assert.deepEqual(session.describe().sessionId, "s2");
  assert.equal(session.describe().turns, 2);
});

test("an exhausted turn never advances the shared state", async () => {
  const scripted = sessionProvider([
    payload(CONTENT_A, "Make the button bigger."),
    "not json at all",
    payload(CONTENT_C, "Paint it blue."),
  ]);
  const session = createProposalSession({
    provider: scripted.provider,
    clock: FIXED_CLOCK,
    sessionId: "s3",
    maxAttempts: 1,
  });

  await session.propose({ intent: "크게", artifacts: { "screen-main": BASE } });
  const failed = await session.refine("이상한 지시");
  assert.equal(failed.proposal, null);
  assert.equal(session.history()[1].status, "exhausted");
  assert.equal(session.history()[1].fingerprint, null);
  // Base stays at the last VALIDATED proposal.
  assert.equal(session.artifacts()["screen-main"], CONTENT_A);

  const third = await session.refine("파랗게");
  assert.ok(third.proposal);
  const doc = third.proposal.changeset;
  const ui = (doc.patches as { ui: Array<Record<string, unknown>> }).ui[0];
  assert.equal(ui.baseFingerprint, artifactFingerprint(BASE), "declared base stays at the live origin");
  const lineage = (doc.provenance as { baseState: Array<Record<string, unknown>> }).baseState.find(
    (e) => e.kind === "changeset",
  );
  assert.equal(lineage?.ref, "proposal-session:s3#1", "lineage anchors to the last validated turn");
});

test("refine re-bases to the live artifacts when the world moved (apply-each-turn flow)", async () => {
  const scripted = sessionProvider([
    payload(CONTENT_A, "Make the button bigger."),
    payload(CONTENT_B, "Round the corners."),
  ]);
  const session = createProposalSession({
    provider: scripted.provider,
    clock: FIXED_CLOCK,
    sessionId: "s4",
  });

  await session.propose({ intent: "크게", artifacts: { "screen-main": BASE } });
  // The host applied turn 1 — the live world is now CONTENT_A. It tells the
  // session so the next changeset declares (and diffs against) that state.
  const second = await session.refine("둥글게", {
    baseArtifacts: { "screen-main": CONTENT_A },
  });
  assert.ok(second.proposal);
  const doc = second.proposal.changeset;
  const ui = (doc.patches as { ui: Array<Record<string, unknown>> }).ui[0];
  assert.equal(ui.baseFingerprint, artifactFingerprint(CONTENT_A));
  const baseState = (doc.provenance as { baseState: Array<Record<string, unknown>> }).baseState;
  const uiBase = baseState.find((e) => e.kind === "ui-artifact" && e.ref === "screen-main");
  assert.equal(uiBase?.fingerprint, artifactFingerprint(CONTENT_A));
  // The re-base sticks for subsequent turns until overridden again.
  assert.equal(session.artifacts()["screen-main"], CONTENT_B, "refinement anchor still advances");
});

test("verified-diff surgical turn projects correctly and does not crash the next refine", async () => {
  // Regression: issues/ISSUE-vivarium-agent-20260719-233000. A surgical turn
  // emits a verified-diff@0 patch (diff only, no newContent); the session
  // projection blindly read patch.newContent → undefined → the next refine fed
  // undefined artifact content to the model prompt and threw uncaught (HTTP
  // 500). Mirrors drive-scenario's apply-each-turn flow (baseArtifacts per turn).
  const SEED = "export default function mount(){ /* empty */ }";
  const V1 = 'export default function mount(){ render("Top Products"); }';
  const V2 = 'export default function mount(){ render("Best Sellers"); }';
  const V3 = 'export default function mount(){ render("Best Sellers"); /* bulk */ }';
  const scripted = sessionProvider([
    payload(V1, "Build the table."), // turn 1 — whole-artifact build
    uiEditsPayload("Top Products", "Best Sellers", "retitle"), // turn 2 — surgical (verified-diff)
    payload(V3, "Bulk tweak."), // turn 3 — must not crash
  ]);
  const session = createProposalSession({ provider: scripted.provider, clock: FIXED_CLOCK, sessionId: "svd" });

  const t1 = await session.propose({ intent: "build", artifacts: { "screen-main": SEED } });
  assert.ok(t1.proposal, "turn 1 validated");

  // Host applied turn 1 → live is V1; it tells the session (apply-each-turn).
  const t2 = await session.refine("표 제목만 교체", { baseArtifacts: { "screen-main": V1 } });
  assert.ok(t2.proposal, "turn 2 (surgical) validated");
  // The turn actually exercised the verified-diff path (not whole-artifact).
  const ui2 = (t2.proposal.changeset.patches as { ui: Array<Record<string, unknown>> }).ui[0];
  assert.equal(ui2.profile, "verified-diff@0", "surgical turn emits a verified-diff patch");
  // The projection reconstructed V2 from the diff — NOT undefined (the bug).
  assert.equal(session.artifacts()["screen-main"], V2, "verified-diff projected to applied result");

  // Host applied turn 2 → live is V2. The next refine must not crash.
  const t3 = await session.refine("일괄 변경", { baseArtifacts: { "screen-main": V2 } });
  assert.ok(t3.proposal, "turn 3 after a verified-diff turn is validated (was HTTP 500)");
  assert.equal(session.artifacts()["screen-main"], V3, "shared state advanced through the verified-diff turn");
});

test("session misuse fails loudly", async () => {
  const scripted = sessionProvider([payload(CONTENT_A, "Bigger.")]);
  const session = createProposalSession({ provider: scripted.provider, clock: FIXED_CLOCK });

  await assert.rejects(() => session.refine("먼저 refine"), /propose\(\) first/);
  await session.propose({ intent: "크게", artifacts: { "screen-main": BASE } });
  await assert.rejects(
    () => session.propose({ intent: "다시", artifacts: {} }),
    /only once/,
  );
});
