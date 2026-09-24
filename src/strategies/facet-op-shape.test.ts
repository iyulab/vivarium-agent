/**
 * The operation shapes this harness asks a model to produce, asserted here
 * rather than borrowed from the validator underneath it.
 *
 * Why not just trust the SDK: the published changeset SDK this package depends
 * on does not validate data operation BODIES — `op` was the only member
 * checked, so a patch with a malformed `where` passed validation, sealed into
 * the fingerprint, and failed inside a backend write path. A later SDK closes
 * that. Which means a suite that only asks "did the SDK accept it?" is green
 * today for two different reasons — the operation is correct, or nobody
 * looked — and cannot tell them apart. On the day the dependency moves, the
 * ones that were never checked turn red all at once, at the worst moment: the
 * release.
 *
 * So these tests state the required members themselves, from the specification
 * (§5.1 schema operations, §5.3 data operations). They are deliberately
 * redundant with a validator we do not yet consume. Redundancy that survives a
 * dependency bump is not duplication — it is the thing that makes the bump
 * boring.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgentHarness } from "../harness.ts";
import type { ModelRequest, SchemaInput, DataInput } from "../ports.ts";

const SCHEMA: SchemaInput = {
  entities: [
    {
      name: "item",
      fields: [
        { name: "id", type: "string", required: true },
        { name: "name", type: "string" },
      ],
    },
  ],
};

const DATA: DataInput = { entities: { item: [{ id: "sku-1", name: "Bolt" }] } };

/** Spec §5.1 — required members per schema operation. */
const SCHEMA_OP_MEMBERS: Record<string, string[]> = {
  "entity.create": ["op", "entity", "fields"],
  "entity.rename": ["op", "entity", "newName"],
  "entity.remove": ["op", "entity"],
  "field.add": ["op", "entity", "field"],
  "field.rename": ["op", "entity", "field", "newName"],
  "field.retype": ["op", "entity", "field", "newType"],
  "field.remove": ["op", "entity", "field"],
  "constraint.add": ["op", "entity", "constraint"],
  "constraint.remove": ["op", "entity", "constraint"],
};

/** Spec §5.3 — required members per data operation, closed (no more, no fewer). */
const DATA_OP_MEMBERS: Record<string, string[]> = {
  insert: ["op", "entity", "values"],
  update: ["op", "entity", "where", "set"],
  delete: ["op", "entity", "where"],
};

function scripted(payload: string) {
  const requests: ModelRequest[] = [];
  return {
    requests,
    provider: {
      name: "fake",
      async complete(request: ModelRequest): Promise<string> {
        requests.push(request);
        return request.system.startsWith("You are an editing planner") ? "1. do it" : payload;
      },
    },
  };
}

async function emit(payload: string) {
  const rig = scripted(payload);
  const harness = createAgentHarness({
    provider: rig.provider,
    clock: () => "2026-08-04T12:00:00Z",
    maxAttempts: 1,
  });
  const result = await harness.propose({
    intent: "손봐줘",
    artifacts: { "screen-main": "base" },
    schema: SCHEMA,
    data: DATA,
  });
  assert.ok(result.proposal, `expected a validated changeset, got ${JSON.stringify(result.outcome.retries)}`);
  return result.proposal.changeset.patches as {
    schema?: Array<Record<string, unknown>>;
    data?: Array<{ id?: unknown; explanation?: unknown; operations?: Array<Record<string, unknown>> }>;
  };
}

test("every emitted schema operation carries exactly the members its op defines (§5.1)", async () => {
  // One payload exercising the whole vocabulary, so a member requirement
  // cannot rot unnoticed on the operations nobody happened to test.
  const payload = JSON.stringify({
    schemaOps: [
      { op: "entity.create", entity: "supplier", fields: [{ name: "id", type: "string" }], explanation: "e" },
      { op: "field.add", entity: "supplier", field: { name: "code", type: "string" }, explanation: "e" },
      { op: "field.rename", entity: "supplier", field: "code", newName: "ref", explanation: "e" },
      { op: "field.retype", entity: "supplier", field: "ref", newType: "number", explanation: "e" },
      { op: "constraint.add", entity: "supplier", constraint: { kind: "unique", fields: ["ref"] }, explanation: "e" },
      { op: "field.remove", entity: "supplier", field: "ref", explanation: "e" },
      { op: "entity.rename", entity: "supplier", newName: "vendor", explanation: "e" },
      { op: "entity.remove", entity: "vendor", explanation: "e" },
    ],
  });
  const patches = await emit(payload);
  const ops = patches.schema ?? [];
  assert.equal(ops.length, 8, "every operation reaches the document");

  const seen = new Set<string>();
  for (const op of ops) {
    const kind = op.op as string;
    seen.add(kind);
    const required = SCHEMA_OP_MEMBERS[kind];
    assert.ok(required, `unknown schema op emitted: ${kind}`);
    for (const member of required) {
      assert.ok(member in op, `${kind} must carry "${member}"`);
    }
    // §5 — every patch object in every facet carries an explanation. The
    // schema facet carries it PER OPERATION; the data facet carries it per
    // patch (§5.3). That asymmetry is a thing models get wrong, so it is
    // pinned on both sides rather than assumed.
    assert.equal(typeof op.explanation, "string", `${kind} must carry its own explanation`);
    assert.ok((op.explanation as string).length > 0);
  }
  assert.deepEqual(
    [...seen].sort(),
    Object.keys(SCHEMA_OP_MEMBERS).sort().filter((k) => k !== "constraint.remove"),
    "the payload covers the vocabulary (constraint.remove shares constraint.add's shape)",
  );
});

test("every emitted data operation carries exactly its members, and no more (§5.3 closed model)", async () => {
  const payload = JSON.stringify({
    dataPatches: [
      {
        id: "p1",
        explanation: "One reviewable unit of work.",
        operations: [
          { op: "insert", entity: "item", values: { id: "sku-2", name: "Nut" } },
          { op: "update", entity: "item", where: { field: "id", equals: "sku-1" }, set: { name: "Bolt II" } },
          { op: "delete", entity: "item", where: { field: "id", equals: "sku-1" } },
        ],
      },
    ],
  });
  const patches = await emit(payload);
  const patch = (patches.data ?? [])[0];
  assert.ok(patch, "the data patch reaches the document");
  assert.equal(typeof patch.id, "string", "a data patch carries an id for run-once bookkeeping");
  assert.equal(typeof patch.explanation, "string", "explanation is per patch, not per operation");

  for (const op of patch.operations ?? []) {
    const kind = op.op as string;
    const required = DATA_OP_MEMBERS[kind];
    assert.ok(required, `unknown data op emitted: ${kind}`);
    assert.deepEqual(
      Object.keys(op).sort(),
      [...required].sort(),
      `${kind} must carry exactly ${required.join(", ")} — the model is closed, so an extra member is a violation`,
    );
  }
});

test("an emitted `where` is exactly { field, equals } with a literal (§5.3)", async () => {
  const payload = JSON.stringify({
    dataPatches: [
      {
        id: "p1",
        explanation: "e",
        operations: [
          { op: "update", entity: "item", where: { field: "id", equals: "sku-1" }, set: { name: "x" } },
        ],
      },
    ],
  });
  const patches = await emit(payload);
  const where = (patches.data ?? [])[0]?.operations?.[0]?.where as Record<string, unknown>;
  assert.deepEqual(Object.keys(where).sort(), ["equals", "field"], "no operators, no extra clauses");
  assert.equal(typeof where.field, "string");
  const literal = where.equals;
  assert.ok(
    literal === null || ["string", "number", "boolean"].includes(typeof literal),
    "`equals` is a literal — arrays, objects and expressions are outside 0.x",
  );
});

test("a `where` written as a key/value map is refused — the shape a producer reaches for first", async () => {
  // Measured, not assumed: with the SDK this package currently depends on,
  // `{ id: "sku-1" }` reached the finished document. It is caught here for a
  // reason narrower than "the harness validates shapes now" — the target check
  // needs to READ the predicate to judge it, and a check that silently passes
  // input it could not read is a gate that never ran. The refusal says what it
  // could not judge; the shape rules themselves stay the validator's to state.
  const payload = JSON.stringify({
    dataPatches: [
      {
        id: "p1",
        explanation: "e",
        operations: [{ op: "update", entity: "item", where: { id: "sku-1" }, set: { name: "x" } }],
      },
    ],
  });
  const rig = scripted(payload);
  const harness = createAgentHarness({
    provider: rig.provider,
    clock: () => "2026-08-04T12:00:00Z",
    maxAttempts: 1,
  });
  const result = await harness.propose({
    intent: "손봐줘",
    artifacts: { "screen-main": "base" },
    schema: SCHEMA,
    data: DATA,
  });

  if (result.proposal) {
    const where = (result.proposal.changeset.patches as { data?: Array<{ operations?: Array<{ where?: unknown }> }> })
      .data?.[0]?.operations?.[0]?.where as Record<string, unknown>;
    assert.fail(
      `a key/value \`where\` reached the document as ${JSON.stringify(where)} — ` +
        `the dependency does not validate operation bodies, so this must be caught here`,
    );
  }
  assert.equal(result.outcome.status, "exhausted");
});

test("the generation prompt states these shapes — the tests and the instruction cannot drift apart", async () => {
  // The assertions above describe what we accept; the prompt describes what we
  // ask for. Two statements of one contract drift unless something compares
  // them, so the vocabulary tested above is required to appear in the prompt.
  const rig = scripted(
    JSON.stringify({
      uiPatches: [{ artifactId: "screen-main", newContent: "changed", explanation: "e" }],
    }),
  );
  const harness = createAgentHarness({ provider: rig.provider, clock: () => "2026-08-04T12:00:00Z" });
  await harness.propose({
    intent: "손봐줘",
    artifacts: { "screen-main": "base" },
    schema: SCHEMA,
    data: DATA,
  });

  const system = rig.requests.at(-1)!.system;
  for (const op of Object.keys(SCHEMA_OP_MEMBERS)) {
    assert.ok(system.includes(op), `the prompt must name the schema operation "${op}"`);
  }
  for (const op of Object.keys(DATA_OP_MEMBERS)) {
    assert.match(system, new RegExp(`\\b${op}\\b`), `the prompt must name the data operation "${op}"`);
  }
});
