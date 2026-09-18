/**
 * A changeset that changes the schema or data facet declares the base it was
 * authored against — when the consumer can say what that base is.
 *
 * `ui-artifact` fingerprints are spec-defined, so the harness computes them.
 * Schema and data fingerprints are adapter-defined (spec §4): only the consumer
 * holding the adapter can name them, and it does so on the view it supplies
 * (`SchemaInput.base` / `DataInput.base`). Without a declaration the facet is
 * unchecked — a stale proposal applies over a schema or rows that moved.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgentHarness } from "../harness.ts";
import { createProposalSession } from "../session.ts";
import type { ModelRequest, SchemaInput, DataInput } from "../ports.ts";

const SCHEMA_BASE = { ref: "schema", fingerprint: "sha256:" + "a".repeat(64) };
const DATA_BASE = { ref: "data", fingerprint: "sha256:" + "b".repeat(64) };

const ENTITIES: SchemaInput["entities"] = [
  { name: "item", fields: [{ name: "id", type: "string", required: true }, { name: "quantity", type: "number" }] },
];
const ROWS: DataInput["entities"] = { item: [{ id: "sku-1", quantity: 12 }, { id: "sku-2", quantity: 3 }] };

const SCHEMA_OP = {
  op: "field.add",
  entity: "item",
  field: { name: "restockAt", type: "date" },
  explanation: "Add the restock date.",
};
const DATA_PATCH = {
  id: "restock",
  explanation: "Restock the low row.",
  operations: [{ op: "update", entity: "item", where: { field: "id", equals: "sku-2" }, set: { quantity: 10 } }],
};
const UI_PATCH = { artifactId: "screen-main", newContent: "<table>v2</table>", explanation: "Show it." };

function scripted(payload: object) {
  const requests: ModelRequest[] = [];
  return {
    requests,
    provider: {
      name: "fake",
      async complete(request: ModelRequest): Promise<string> {
        requests.push(request);
        return requests.length === 1 ? "1. Do it." : JSON.stringify(payload);
      },
    },
  };
}

const CLOCK = () => "2026-09-18T12:00:00Z";

async function propose(payload: object, schema: SchemaInput | null, data: DataInput | null) {
  const s = scripted(payload);
  const harness = createAgentHarness({ provider: s.provider, clock: CLOCK });
  const result = await harness.propose({
    intent: "재입고",
    artifacts: { "screen-main": "<table></table>" },
    schema,
    data,
  });
  assert.ok(result.proposal, `payload must validate: ${JSON.stringify(result)}`);
  const doc = result.proposal.changeset as any;
  return { doc, kinds: (doc.provenance.baseState as any[]).map((e) => e.kind), requests: s.requests };
}

test("a changeset with data patches declares the supplied data base, and stamps spec 0.3.0", async () => {
  const { doc } = await propose(
    { dataPatches: [DATA_PATCH] },
    { base: SCHEMA_BASE, entities: ENTITIES },
    { base: DATA_BASE, entities: ROWS },
  );
  const entry = doc.provenance.baseState.find((e: any) => e.kind === "data");
  assert.deepEqual(entry, { kind: "data", ...DATA_BASE });
  assert.equal(doc.specVersion, "0.3.0", "a data entry is gated on 0.3.0 (spec §4)");
});

test("a changeset with schema operations declares the supplied schema base", async () => {
  const { doc } = await propose(
    { schemaOps: [SCHEMA_OP] },
    { base: SCHEMA_BASE, entities: ENTITIES },
    { base: DATA_BASE, entities: ROWS },
  );
  const entry = doc.provenance.baseState.find((e: any) => e.kind === "schema");
  assert.deepEqual(entry, { kind: "schema", ...SCHEMA_BASE });
});

test("an untouched facet is not declared — a whole-facet data fingerprint would drift on every row change", async () => {
  const { kinds, doc } = await propose(
    { uiPatches: [UI_PATCH] },
    { base: SCHEMA_BASE, entities: ENTITIES },
    { base: DATA_BASE, entities: ROWS },
  );
  assert.deepEqual([...new Set(kinds)], ["ui-artifact"]);
  assert.notEqual(doc.specVersion, "0.3.0", "no data entry, no 0.3 feature — minimality holds (spec §9)");
});

test("a three-facet change declares all three bases", async () => {
  const { kinds } = await propose(
    { schemaOps: [SCHEMA_OP], dataPatches: [DATA_PATCH], uiPatches: [UI_PATCH] },
    { base: SCHEMA_BASE, entities: ENTITIES },
    { base: DATA_BASE, entities: ROWS },
  );
  assert.deepEqual([...kinds].sort(), ["data", "schema", "ui-artifact"]);
});

test("without a supplied base the facet stays undeclared — the harness never invents a fingerprint", async () => {
  const { kinds } = await propose(
    { schemaOps: [SCHEMA_OP], dataPatches: [DATA_PATCH] },
    { entities: ENTITIES },
    { entities: ROWS },
  );
  assert.deepEqual([...new Set(kinds)], ["ui-artifact"]);
});

test("the base identity stays out of the prompts — it is for the document, not the model", async () => {
  const { requests } = await propose(
    { dataPatches: [DATA_PATCH] },
    { base: SCHEMA_BASE, entities: ENTITIES },
    { base: DATA_BASE, entities: ROWS },
  );
  assert.equal(requests.length, 2);
  for (const r of requests) {
    assert.ok(!r.user.includes(DATA_BASE.fingerprint) && !r.user.includes(SCHEMA_BASE.fingerprint));
    assert.ok(r.user.includes("sku-2"), "the view itself still reaches the prompt");
  }
});

test("a session re-base replaces the declared base together with the view", async () => {
  const moved = { ref: "data", fingerprint: "sha256:" + "c".repeat(64) };
  let call = 0;
  const provider = {
    name: "fake",
    async complete(): Promise<string> {
      call += 1;
      return call % 2 === 1 ? "1. Do it." : JSON.stringify({ dataPatches: [DATA_PATCH] });
    },
  };
  const session = createProposalSession({ provider, clock: CLOCK });
  const first = await session.propose({
    intent: "재입고",
    artifacts: { "screen-main": "<table></table>" },
    schema: { entities: ENTITIES },
    data: { base: DATA_BASE, entities: ROWS },
  });
  const second = await session.refine("다시", { data: { base: moved, entities: ROWS } });
  const dataEntry = (p: any) => p.proposal.changeset.provenance.baseState.find((e: any) => e.kind === "data");
  assert.equal(dataEntry(first).fingerprint, DATA_BASE.fingerprint);
  assert.equal(dataEntry(second).fingerprint, moved.fingerprint);
});
