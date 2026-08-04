/**
 * Author-time target checking for the schema and data facets.
 *
 * The changeset SDK validates that an operation is well FORMED — that
 * `field.add` carries an `entity` and a `field`, that a `where` is a field and
 * a literal. It cannot validate that the operation is well TARGETED, because
 * it has never seen the live world. Nothing else in the chain can either: an
 * operation renaming a field the entity does not have passes validation, seals
 * into the fingerprint, clears the approval gate, and surfaces inside a backend
 * write path — the latest and most expensive place for it to fail.
 *
 * Now that the harness is given the live facets, that gap closes here, at the
 * earliest point the mistake is knowable and the cheapest place to correct it:
 * the refusal returns to the model as a retryable error naming what does not
 * exist AND what does, so the next attempt has somewhere to go.
 *
 * Two bounds hold this honest:
 *
 * 1. **Only what we were given the state to judge.** No schema supplied means
 *    no schema judgment; no data supplied means no row judgment. Unverifiable
 *    is not the same as wrong, and quietly widening the judgment would break
 *    hosts that are doing nothing incorrect.
 * 2. **Judged against the world the document PRODUCES, not the one it started
 *    from.** Operations are folded in order, so creating an entity and then
 *    extending it is coherent rather than self-contradictory.
 *
 * A malformed operation is not this module's business — it is reported by the
 * validator that owns shape. Anything unrecognizable here is skipped rather
 * than guessed at, so a judgment tool never becomes the thing that crashes on
 * the input it exists to judge.
 */

import type { SchemaInput, DataInput } from "../ports.ts";

/** The projected schema: entity name → declared field names, in document order. */
type Projection = Map<string, Set<string>>;

function project(schema: SchemaInput): Projection {
  const entities: Projection = new Map();
  for (const entity of schema.entities ?? []) {
    if (typeof entity?.name !== "string") continue;
    entities.set(entity.name, new Set((entity.fields ?? []).map((f) => f?.name).filter((n): n is string => typeof n === "string")));
  }
  return entities;
}

function known(entities: Projection): string {
  const names = [...entities.keys()];
  return names.length ? names.join(", ") : "(none)";
}

function refuse(message: string): never {
  throw new Error(message);
}

/**
 * Shape guard. A member of the wrong type is not this module's finding — the
 * validator that owns shape reports it, in its own vocabulary. Everything here
 * treats an unusable member as "nothing to judge" and moves on, uniformly:
 * one module reporting the same fault in two vocabularies is how a retry loop
 * gets told two different things about one mistake.
 */
function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function requireEntity(entities: Projection, name: string, op: string): Set<string> {
  const fields = entities.get(name);
  if (!fields) {
    refuse(
      `${op} targets entity "${name}", which does not exist in the live schema — existing entities: ${known(entities)}. ` +
        `Target one of those, or create it first with entity.create in the same changeset.`,
    );
  }
  return fields;
}

function requireField(fields: Set<string>, entity: string, field: string, op: string): string {
  if (!fields.has(field)) {
    refuse(
      `${op} targets field "${field}" on entity "${entity}", which does not have it — existing fields: ` +
        `${[...fields].join(", ") || "(none)"}. Target one of those, or add it first with field.add.`,
    );
  }
  return field;
}

function refuseIfPresent(fields: Set<string>, entity: string, field: string, op: string): string {
  if (fields.has(field)) {
    refuse(
      `${op} would add field "${field}" to entity "${entity}", which already has it — ` +
        `use field.retype or field.rename to change an existing field.`,
    );
  }
  return field;
}

function fieldNameOf(op: Record<string, unknown>): unknown {
  const field = op.field;
  // `field.add` and `entity.create` carry a field OBJECT; the other operations
  // carry the field NAME. Both shapes reach here.
  if (field !== null && typeof field === "object" && !Array.isArray(field)) {
    return (field as { name?: unknown }).name;
  }
  return field;
}

/**
 * Fold the document's schema operations into the live schema, refusing any
 * whose target does not exist in the world as of that point. Returns the
 * projected schema so the data facet can be judged against the same world.
 */
export function projectSchemaOps(schema: SchemaInput, ops: Array<Record<string, unknown>>): Projection {
  const entities = project(schema);
  for (const op of ops) {
    if (op === null || typeof op !== "object") continue;
    const kind = str(op.op);
    const entity = str(op.entity);
    // Every operation in the vocabulary names an entity; without a usable one
    // there is no target to judge.
    if (kind === null || entity === null) continue;
    switch (kind) {
      case "entity.create": {
        if (entities.has(entity)) {
          refuse(
            `entity.create would create entity "${entity}", which already exists — ` +
              `extend it with field.add instead.`,
          );
        }
        const declared = Array.isArray(op.fields) ? op.fields : [];
        entities.set(
          entity,
          new Set(
            declared
              .map((f) => (f !== null && typeof f === "object" ? str((f as { name?: unknown }).name) : null))
              .filter((n): n is string => n !== null),
          ),
        );
        break;
      }
      case "entity.rename": {
        const fields = requireEntity(entities, entity, "entity.rename");
        const newName = str(op.newName);
        if (newName === null) break;
        if (entities.has(newName)) {
          refuse(`entity.rename would rename "${entity}" to "${newName}", which already exists.`);
        }
        entities.delete(entity);
        entities.set(newName, fields);
        break;
      }
      case "entity.remove": {
        requireEntity(entities, entity, "entity.remove");
        entities.delete(entity);
        break;
      }
      case "field.add": {
        const fields = requireEntity(entities, entity, "field.add");
        const name = str(fieldNameOf(op));
        if (name === null) break;
        fields.add(refuseIfPresent(fields, entity, name, "field.add"));
        break;
      }
      case "field.rename": {
        const fields = requireEntity(entities, entity, "field.rename");
        const current = str(op.field);
        const newName = str(op.newName);
        if (current === null || newName === null) break;
        fields.delete(requireField(fields, entity, current, "field.rename"));
        fields.add(refuseIfPresent(fields, entity, newName, "field.rename"));
        break;
      }
      case "field.retype": {
        const fields = requireEntity(entities, entity, "field.retype");
        const field = str(op.field);
        if (field === null) break;
        requireField(fields, entity, field, "field.retype");
        break;
      }
      case "field.remove": {
        const fields = requireEntity(entities, entity, "field.remove");
        const field = str(op.field);
        if (field === null) break;
        fields.delete(requireField(fields, entity, field, "field.remove"));
        break;
      }
      case "constraint.add":
      case "constraint.remove": {
        const fields = requireEntity(entities, entity, kind);
        const constraint = op.constraint;
        const targets =
          constraint !== null && typeof constraint === "object" && Array.isArray((constraint as { fields?: unknown }).fields)
            ? (constraint as { fields: unknown[] }).fields
            : [];
        for (const target of targets) {
          const name = str(target);
          if (name !== null) requireField(fields, entity, name, kind);
        }
        break;
      }
      default:
        break; // unknown op — the validator refuses it, this module does not guess
    }
  }
  return entities;
}

/** Spec §5.3 vocabulary. Anything else is the validator's to refuse. */
const DATA_OPS = new Set(["insert", "update", "delete"]);

interface DataOperation {
  op?: unknown;
  entity?: unknown;
  where?: unknown;
  set?: unknown;
  values?: unknown;
}

function checkWrittenFields(
  entities: Projection | null,
  entity: string,
  written: unknown,
  op: string,
  member: string,
): void {
  if (!entities || written === null || typeof written !== "object" || Array.isArray(written)) return;
  const fields = entities.get(entity);
  if (!fields) return;
  for (const name of Object.keys(written)) {
    if (!fields.has(name)) {
      refuse(
        `${op} writes "${name}" on entity "${entity}" in \`${member}\`, which the schema does not declare — ` +
          `declared fields: ${[...fields].join(", ") || "(none)"}. Add it with field.add in the same changeset, or use a declared field.`,
      );
    }
  }
}

/**
 * Judge the document's data operations against the projected schema (field
 * names) and the live rows (that a `where` selects something that exists).
 *
 * `entities` is null when no schema was supplied, `rows` null when no data was
 * — each judgment is skipped independently, because they answer different
 * questions and a host may reasonably supply one and not the other.
 */
export function checkDataOperations(
  entities: Projection | null,
  rows: DataInput | null,
  patches: Array<{ operations?: unknown }>,
): void {
  for (const patch of patches) {
    const operations = Array.isArray(patch?.operations) ? patch.operations : [];
    for (const raw of operations) {
      if (raw === null || typeof raw !== "object") continue;
      const operation = raw as DataOperation;
      const kind = str(operation.op);
      const entity = str(operation.entity);
      if (kind === null || entity === null) continue;
      // Same policy the schema side follows: an operation outside the
      // vocabulary is the validator's to refuse, in its own words. Judging its
      // members here would answer a question nobody asked — reporting an
      // unreadable `where` when the real fault is that `upsert` does not exist.
      if (!DATA_OPS.has(kind)) continue;
      if (entities && !entities.has(entity)) {
        refuse(
          `data operation "${kind}" targets entity "${entity}", which does not exist in the live schema — ` +
            `existing entities: ${known(entities)}.`,
        );
      }
      if (kind === "insert") {
        checkWrittenFields(entities, entity, operation.values, `data insert`, "values");
        continue;
      }
      checkWrittenFields(entities, entity, operation.set, `data ${kind}`, "set");
      const where = operation.where;
      if (where === undefined) continue; // absent `where` is the validator's finding
      // A `where` this check cannot READ is an input failure of the check, and
      // saying nothing about it is the one thing a judgment step must not do:
      // the operation would sail past a gate that never ran, and the model
      // would get no signal that its predicate is unusable. So this reports
      // what it could not judge — it does not restate the shape rules, which
      // belong to the validator that owns them.
      const field =
        where !== null && typeof where === "object" && !Array.isArray(where)
          ? str((where as { field?: unknown }).field)
          : null;
      if (field === null) {
        refuse(
          `data ${kind} on "${entity}" carries a \`where\` this check cannot read: ` +
            `${JSON.stringify(where)}. It must be { "field": <name>, "equals": <literal> } — ` +
            `a key/value map is not a predicate, and rows cannot be selected by one.`,
        );
      }
      const equals = (where as { equals?: unknown }).equals;
      if (entities) {
        const fields = entities.get(entity);
        if (fields && !fields.has(field)) {
          refuse(
            `data ${kind} selects rows of "${entity}" by field "${field}", which the schema does not declare — ` +
              `declared fields: ${[...fields].join(", ") || "(none)"}.`,
          );
        }
      }
      // Row-level judgment needs the rows. An entity absent from the supplied
      // data facet is not evidence of anything: a host may show the model only
      // the entities the intent concerns.
      const visible = rows?.entities?.[entity];
      if (!Array.isArray(visible)) continue;
      if (!visible.some((row) => row !== null && typeof row === "object" && (row as Record<string, unknown>)[field] === equals)) {
        refuse(
          `data ${kind} selects rows of "${entity}" where ${field} equals ${JSON.stringify(equals)}, ` +
            `but no visible row matches — a run-once operation that selects nothing is not a change. ` +
            `Use a value present in the data you were shown.`,
        );
      }
    }
  }
}
