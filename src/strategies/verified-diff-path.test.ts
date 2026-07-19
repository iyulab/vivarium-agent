import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, verifyFingerprint, verifyAgainstBase } from "@vivariumjs/changeset";
import type { VerifiedDiffUiPatch } from "@vivariumjs/changeset";
import { createAgentHarness } from "../harness.ts";
import type { ModelRequest } from "../ports.ts";

const BASE = 'const title = "Loans";\nexport function LoanScreen() {\n  return <Table title={title} />;\n}\n';

function scriptedProvider(outputs: string[]) {
  const requests: ModelRequest[] = [];
  let generateCalls = 0;
  return {
    requests,
    provider: {
      name: "fake",
      async complete(request: ModelRequest): Promise<string> {
        requests.push(request);
        if (requests.length === 1) return "1. Rename the table title.";
        generateCalls += 1;
        return outputs[Math.min(generateCalls - 1, outputs.length - 1)];
      },
    },
  };
}

const FIXED_CLOCK = () => "2026-07-19T12:00:00Z";

test("uiEdits ride as verified-diff@0: derived diff, 0.2.0 stamp, layer-2 verifiable", async () => {
  const scripted = scriptedProvider([
    JSON.stringify({
      uiEdits: [{
        artifactId: "screen-loans",
        find: 'const title = "Loans";',
        replace: 'const title = "Active loans";',
        explanation: "Rename the table title only",
      }],
    }),
  ]);
  const harness = createAgentHarness({ provider: scripted.provider, clock: FIXED_CLOCK });

  const result = await harness.propose({ intent: "rename the title", artifacts: { "screen-loans": BASE } });

  assert.ok(result.proposal, "must produce a proposal");
  const doc = result.proposal.changeset as Record<string, unknown>;
  assert.equal(validate(doc).valid, true);
  assert.equal(verifyFingerprint(doc), true);
  assert.equal(doc.specVersion, "0.2.0", "builder lifted the version (§9 minimality)");
  const patch = (doc.patches as { ui: VerifiedDiffUiPatch[] }).ui[0];
  assert.equal(patch.profile, "verified-diff@0");
  const verdict = verifyAgainstBase(patch, BASE);
  assert.ok(verdict.ok, "layer-2 verifies against the live base");
  assert.ok(verdict.ok && verdict.newContent.includes('"Active loans"'));
  assert.equal(result.proposal.provenance.attempts, 1);
});

test("whole-artifact fallback: failed find is fed back, full newContent recovers at 0.1.0", async () => {
  const next = BASE.replace('"Loans"', '"Active loans"');
  const scripted = scriptedProvider([
    JSON.stringify({
      uiEdits: [{ artifactId: "screen-loans", find: "NOT PRESENT", replace: "x", explanation: "bad edit" }],
    }),
    JSON.stringify({
      uiPatches: [{ artifactId: "screen-loans", newContent: next, explanation: "Full rewrite fallback" }],
    }),
  ]);
  const harness = createAgentHarness({ provider: scripted.provider, clock: FIXED_CLOCK });

  const result = await harness.propose({ intent: "rename the title", artifacts: { "screen-loans": BASE } });

  assert.ok(result.proposal);
  assert.equal(result.proposal.provenance.attempts, 2);
  assert.match(result.outcome.retries[0].errors.join(" "), /find-string not present/);
  const retryPrompt = scripted.requests.at(-1)!;
  assert.match(retryPrompt.user, /fall back to uiPatches/);
  const doc = result.proposal.changeset as Record<string, unknown>;
  assert.equal(doc.specVersion, "0.1.0", "no 0.2 feature used — minimality keeps the floor");
  const patch = (doc.patches as { ui: Array<{ profile: string }> }).ui[0];
  assert.equal(patch.profile, "whole-artifact@0");
});

test("edits that change nothing are refused like a no-op (intent kept in front of the model)", async () => {
  const scripted = scriptedProvider([
    JSON.stringify({
      uiEdits: [{ artifactId: "screen-loans", find: '"Loans"', replace: '"Loans"', explanation: "no change" }],
    }),
  ]);
  const harness = createAgentHarness({ provider: scripted.provider, clock: FIXED_CLOCK, maxAttempts: 2 });

  const result = await harness.propose({ intent: "rename", artifacts: { "screen-loans": BASE } });

  assert.equal(result.proposal, null, "no-op edits must never ship");
  assert.match(result.outcome.retries[0].errors.join(" "), /produce no change/);
});

test("ambiguous find and cross-form collision are actionable errors", async () => {
  const ambiguousBase = "row\nrow\n";
  const scripted = scriptedProvider([
    JSON.stringify({
      uiEdits: [{ artifactId: "a", find: "row", replace: "cell", explanation: "x" }],
    }),
    JSON.stringify({
      uiEdits: [{ artifactId: "a", find: "row\nrow", replace: "cell\nrow", explanation: "x" }],
      uiPatches: [{ artifactId: "a", newContent: "cell\nrow\n", explanation: "y" }],
    }),
    JSON.stringify({
      uiEdits: [{ artifactId: "a", find: "row\nrow\n", replace: "cell\nrow\n", explanation: "make first row a cell" }],
    }),
  ]);
  const harness = createAgentHarness({ provider: scripted.provider, clock: FIXED_CLOCK, maxAttempts: 3 });

  const result = await harness.propose({ intent: "first row becomes a cell", artifacts: { a: ambiguousBase } });

  assert.ok(result.proposal, "third attempt recovers");
  assert.match(result.outcome.retries[0].errors.join(" "), /ambiguous/);
  assert.match(result.outcome.retries[1].errors.join(" "), /both uiEdits and uiPatches/);
});
