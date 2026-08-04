/**
 * Seeing the facets is not the same as being held to them.
 *
 * Once the live schema and data reach the prompts, an operation naming an
 * entity, field or row that does not exist stops being a thing the harness
 * cannot know and becomes a thing it declines to emit. The refusal is a
 * retryable error like any other: it goes back to the model with the reason,
 * and only a model that keeps insisting exhausts into "nothing".
 *
 * The bound is deliberate — the harness refuses only what it was GIVEN the
 * state to judge. With no schema supplied, every operation is authorable
 * exactly as before; unverifiable is not the same as wrong.
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
        { name: "name", type: "string", required: true },
      ],
    },
  ],
};

const DATA: DataInput = {
  entities: { item: [{ id: "sku-1", name: "Bolt" }] },
};

const UI_ONLY = JSON.stringify({
  uiPatches: [{ artifactId: "screen-main", newContent: "recovered", explanation: "Implements the intent." }],
});

function scriptedProvider(outputs: string[]) {
  const requests: ModelRequest[] = [];
  let generate = 0;
  return {
    requests,
    provider: {
      name: "fake",
      async complete(request: ModelRequest): Promise<string> {
        requests.push(request);
        if (request.system.startsWith("You are an editing planner")) return "1. do it";
        generate += 1;
        return outputs[Math.min(generate - 1, outputs.length - 1)];
      },
    },
  };
}

const FIXED_CLOCK = () => "2026-08-04T12:00:00Z";

async function proposeWith(outputs: string[], extra: Record<string, unknown> = {}) {
  const scripted = scriptedProvider(outputs);
  const harness = createAgentHarness({ provider: scripted.provider, clock: FIXED_CLOCK, maxAttempts: 2 });
  const result = await harness.propose({
    intent: "품목을 손봐줘",
    artifacts: { "screen-main": "base" },
    ...extra,
  });
  return { result, scripted };
}

const withFacets = { schema: SCHEMA, data: DATA };

test("field.add on an entity that does not exist is refused, and the reason names it", async () => {
  const bad = JSON.stringify({
    schemaOps: [
      { op: "field.add", entity: "invoice", field: { name: "dueAt", type: "date" }, explanation: "x" },
    ],
  });
  const { result, scripted } = await proposeWith([bad, UI_ONLY], withFacets);

  assert.ok(result.proposal, "the retry recovers — refusal is retryable, not fatal");
  const errors = result.outcome.retries[0].errors.join(" ");
  assert.match(errors, /invoice/, "the refusal names the entity that does not exist");
  assert.match(errors, /item/, "and names what does exist, so the retry is actionable");
  assert.match(scripted.requests.at(-1).user, /invoice/, "the reason reaches the model");
});

test("field.remove of a field the entity does not have is refused", async () => {
  const bad = JSON.stringify({
    schemaOps: [{ op: "field.remove", entity: "item", field: "quantity", explanation: "x" }],
  });
  const { result } = await proposeWith([bad, UI_ONLY], withFacets);

  assert.ok(result.proposal);
  const errors = result.outcome.retries[0].errors.join(" ");
  assert.match(errors, /quantity/);
  assert.match(errors, /item/);
});

test("field.add of a field that already exists is refused (adding is not renaming)", async () => {
  const bad = JSON.stringify({
    schemaOps: [
      { op: "field.add", entity: "item", field: { name: "name", type: "string" }, explanation: "x" },
    ],
  });
  const { result } = await proposeWith([bad, UI_ONLY], withFacets);

  assert.ok(result.proposal);
  assert.match(result.outcome.retries[0].errors.join(" "), /already/);
});

test("entity.create of an entity that already exists is refused", async () => {
  const bad = JSON.stringify({
    schemaOps: [
      { op: "entity.create", entity: "item", fields: [{ name: "id", type: "string" }], explanation: "x" },
    ],
  });
  const { result } = await proposeWith([bad, UI_ONLY], withFacets);

  assert.ok(result.proposal);
  assert.match(result.outcome.retries[0].errors.join(" "), /already/);
});

test("an entity created earlier in the same document is a legitimate target later", async () => {
  // The judgment is against the world the changeset will produce, not the world
  // it started from — otherwise a coherent two-operation change is refused for
  // being coherent.
  const good = JSON.stringify({
    schemaOps: [
      {
        op: "entity.create",
        entity: "supplier",
        fields: [{ name: "id", type: "string" }],
        explanation: "New supplier entity.",
      },
      {
        op: "field.add",
        entity: "supplier",
        field: { name: "name", type: "string" },
        explanation: "Suppliers have names.",
      },
    ],
  });
  const { result } = await proposeWith([good], withFacets);

  assert.ok(result.proposal, "create-then-extend must not be refused");
  assert.equal(result.outcome.retries.length, 0);
});

test("a data operation on an unknown entity is refused", async () => {
  const bad = JSON.stringify({
    dataPatches: [
      {
        id: "p1",
        explanation: "x",
        operations: [{ op: "delete", entity: "invoice", where: { field: "id", equals: "1" } }],
      },
    ],
  });
  const { result } = await proposeWith([bad, UI_ONLY], withFacets);

  assert.ok(result.proposal);
  assert.match(result.outcome.retries[0].errors.join(" "), /invoice/);
});

test("a `where` on a field no row has is refused — the invented identifier case", async () => {
  const bad = JSON.stringify({
    dataPatches: [
      {
        id: "p1",
        explanation: "x",
        operations: [
          { op: "update", entity: "item", where: { field: "sku", equals: "1" }, set: { name: "y" } },
        ],
      },
    ],
  });
  const { result } = await proposeWith([bad, UI_ONLY], withFacets);

  assert.ok(result.proposal);
  const errors = result.outcome.retries[0].errors.join(" ");
  assert.match(errors, /sku/);
});

test("a `where` whose value matches no visible row is refused — selecting nothing is not a change", async () => {
  const bad = JSON.stringify({
    dataPatches: [
      {
        id: "p1",
        explanation: "x",
        operations: [
          { op: "update", entity: "item", where: { field: "id", equals: "sku-404" }, set: { name: "y" } },
        ],
      },
    ],
  });
  const { result } = await proposeWith([bad, UI_ONLY], withFacets);

  assert.ok(result.proposal);
  assert.match(result.outcome.retries[0].errors.join(" "), /sku-404/);
});

test("insert values are checked against the schema, and a field added in the same document counts", async () => {
  const good = JSON.stringify({
    schemaOps: [
      {
        op: "field.add",
        entity: "item",
        field: { name: "restockAt", type: "date" },
        explanation: "Add restock date.",
      },
    ],
    dataPatches: [
      {
        id: "p1",
        explanation: "Seed one row.",
        operations: [
          {
            op: "insert",
            entity: "item",
            values: { id: "sku-2", name: "Nut", restockAt: "2026-08-20" },
          },
        ],
      },
    ],
  });
  const { result } = await proposeWith([good], withFacets);

  assert.ok(result.proposal, "the field the same document adds is a valid target");
  assert.equal(result.outcome.retries.length, 0);
});

test("an insert naming a field nothing declares is refused", async () => {
  const bad = JSON.stringify({
    dataPatches: [
      {
        id: "p1",
        explanation: "x",
        operations: [{ op: "insert", entity: "item", values: { id: "sku-2", colour: "red" } }],
      },
    ],
  });
  const { result } = await proposeWith([bad, UI_ONLY], withFacets);

  assert.ok(result.proposal);
  assert.match(result.outcome.retries[0].errors.join(" "), /colour/);
});

test("without a supplied schema nothing is refused — unverifiable is not wrong", async () => {
  // The exact payload refused above must still be authorable by a host that
  // did not supply the facets: the harness judges only what it was given the
  // state to judge, and silently widening that is how a working consumer breaks.
  const same = JSON.stringify({
    schemaOps: [
      { op: "field.add", entity: "invoice", field: { name: "dueAt", type: "date" }, explanation: "x" },
    ],
    dataPatches: [
      {
        id: "p1",
        explanation: "x",
        operations: [{ op: "delete", entity: "invoice", where: { field: "id", equals: "1" } }],
      },
    ],
  });
  const { result } = await proposeWith([same]);

  assert.ok(result.proposal, "no facets supplied → no facet judgment");
  assert.equal(result.outcome.retries.length, 0);
});

test("data judgment needs the data facet: schema alone does not conjure rows", async () => {
  const rowTargeting = JSON.stringify({
    dataPatches: [
      {
        id: "p1",
        explanation: "x",
        operations: [
          { op: "update", entity: "item", where: { field: "id", equals: "sku-404" }, set: { name: "y" } },
        ],
      },
    ],
  });
  const { result } = await proposeWith([rowTargeting], { schema: SCHEMA });

  assert.ok(result.proposal, "the entity and field exist in the schema; the rows were never shown");
  assert.equal(result.outcome.retries.length, 0);
});

test("an incoherent-but-well-targeted change still ships — this checks targets, not companionship", async () => {
  // BOUNDARY, pinned deliberately. This module refuses operations whose TARGET
  // does not exist. It does NOT judge whether the three facets moved together
  // — that is a separate question, and the answer on record is that no layer
  // enforces it: companionship is a norm and enforcement belongs to the
  // reviewer. Adding a field to the schema and a column to the screen while
  // leaving every row without a value is exactly the state that was measured
  // reaching production, and it must still validate here. If this test ever
  // starts failing, an enforcement layer has been introduced by accident at
  // precisely the address that was considered and declined.
  const schemaAndUiOnly = JSON.stringify({
    schemaOps: [
      {
        op: "field.add",
        entity: "item",
        field: { name: "restockAt", type: "date" },
        explanation: "Declare the restock date.",
      },
    ],
    uiPatches: [
      { artifactId: "screen-main", newContent: "<th>restockAt</th>", explanation: "Show the column." },
    ],
  });
  const { result } = await proposeWith([schemaAndUiOnly], withFacets);

  assert.ok(result.proposal, "a schema+ui change with no data patch is not this module's business");
  assert.equal(result.outcome.retries.length, 0, "and it is not even retried");
});

test("a refine turn must re-declare what an unapplied earlier turn added", async () => {
  // Sessions project the UI facet forward (a later turn's patch carries the
  // accumulated content) but NOT the schema and data facets — there is no
  // projection for a live backend the session cannot read. So a turn-2
  // document writing a field only turn 1 declared is not appliable on its own:
  // turn 1 was validated, not applied, and the live schema still lacks it.
  //
  // Refusing is the correct outcome, and it is fixed here on purpose. Before
  // the target check, that document validated and failed later inside a write
  // path instead — the refusal moved the failure earlier, it did not create
  // it. Whether a session should project schema operations forward is a
  // separate design question (it changes what every turn's document contains).
  const { createProposalSession } = await import("../session.ts");
  const addField = JSON.stringify({
    schemaOps: [
      { op: "field.add", entity: "item", field: { name: "restockAt", type: "date" }, explanation: "Add it." },
    ],
  });
  const writeItWithoutDeclaring = JSON.stringify({
    dataPatches: [
      {
        id: "p1",
        explanation: "Seed it.",
        operations: [
          { op: "update", entity: "item", where: { field: "id", equals: "sku-1" }, set: { restockAt: "2026-08-20" } },
        ],
      },
    ],
  });
  let generate = 0;
  const provider = {
    name: "fake",
    async complete(request: ModelRequest): Promise<string> {
      if (request.system.startsWith("You are an editing planner")) return "1. do it";
      generate += 1;
      return generate === 1 ? addField : writeItWithoutDeclaring;
    },
  };

  const session = createProposalSession({ provider, clock: FIXED_CLOCK, maxAttempts: 2 });
  const first = await session.propose({
    intent: "재입고일 필드 추가",
    artifacts: { "screen-main": "base" },
    schema: SCHEMA,
    data: DATA,
  });
  assert.ok(first.proposal, "turn 1 declares the field and validates");

  const second = await session.refine("그 값을 채워줘");
  assert.equal(second.proposal, null, "turn 2 cannot write a field the live schema does not have");
  assert.match(
    second.outcome.retries[0].errors.join(" "),
    /field\.add in the same changeset/,
    "and the reason tells the model exactly how to make the turn self-contained",
  );
});

test("persistent refusal exhausts — a changeset targeting nothing never ships as validated", async () => {
  const bad = JSON.stringify({
    schemaOps: [
      { op: "field.retype", entity: "invoice", field: "dueAt", newType: "date", explanation: "x" },
    ],
  });
  const { result } = await proposeWith([bad], withFacets);

  assert.equal(result.proposal, null);
  assert.equal(result.outcome.status, "exhausted");
  assert.equal(result.outcome.retries.length, 2);
});

test("an operation outside the vocabulary is left to the validator, on both facets", async () => {
  // Uniform policy, stated once: this module judges TARGETS. An op it does not
  // recognize has no target it knows how to judge, so it says nothing — rather
  // than reporting some incidental member as the fault and sending the retry
  // after the wrong thing.
  const unknownDataOp = JSON.stringify({
    dataPatches: [
      {
        id: "p1",
        explanation: "e",
        operations: [{ op: "upsert", entity: "item", where: { id: "sku-1" }, set: { name: "x" } }],
      },
    ],
  });
  const { result: dataResult } = await proposeWith([unknownDataOp], withFacets);
  assert.equal(dataResult.proposal, null, "the validator refuses it — this module did not");
  assert.doesNotMatch(
    dataResult.outcome.retries[0].errors.join(" "),
    /cannot read/,
    "and the reason is the unknown op, not an incidental `where` complaint",
  );

  const unknownSchemaOp = JSON.stringify({
    schemaOps: [{ op: "entity.archive", entity: "nonexistent", explanation: "e" }],
  });
  const { result: schemaResult } = await proposeWith([unknownSchemaOp], withFacets);
  assert.equal(schemaResult.proposal, null);
  assert.doesNotMatch(
    schemaResult.outcome.retries[0].errors.join(" "),
    /does not exist in the live schema/,
    "an unknown op is not reported as a missing entity, even though the entity is missing too",
  );
});
