/**
 * Pluggable ports of the harness. The harness is model-agnostic (fixed
 * principle 5) and knowledge-agnostic (fixed principle 4): providers and
 * knowledge sources are injected, enumerable, and recorded in provenance.
 */

/** A single model call. The harness never owns credentials or transports. */
export interface ModelRequest {
  /** Instruction text authored by the harness (trusted). */
  system: string;
  /** Task payload; untrusted content inside is fenced and labeled. */
  user: string;
}

export interface ModelProvider {
  /** Recorded in provenance, e.g. "fake", "anthropic:claude-sonnet-5". */
  readonly name: string;
  complete(request: ModelRequest): Promise<string>;
}

export interface KnowledgeQuery {
  intent: string;
  /** The edit context the user is pointing with (see vivarium docs/edit-context.md). */
  editContext: EditContextInput | null;
}

/**
 * A pluggable knowledge source (primitive catalogs, schema conventions,
 * house rules). Knowledge is data fed to the harness, not code baked in.
 */
export interface KnowledgeSource {
  /** Recorded in provenance — "what informed this proposal". */
  readonly name: string;
  retrieve(query: KnowledgeQuery): Promise<string[]>;
}

/**
 * Agent-side structural view of the LIVE schema facet, in the changeset
 * spec's own logical vocabulary (§5.1 — entities, fields, logical types).
 *
 * This is the state a schema operation is authored against, not an operation:
 * `field.add` needs the entity's name and the fields already on it, and
 * `field.rename`/`retype`/`remove` need to know the target exists. Producing
 * that view from a backend is the consumer's adapter concern — the shape here
 * is the spec's vocabulary, so it is the same view for every consumer.
 */
export interface SchemaInput {
  entities: Array<{
    name: string;
    /**
     * `type` is unconstrained on purpose: this describes what EXISTS, and the
     * closed logical-type vocabulary (spec §5.1) constrains what may be
     * EMITTED. A live schema carrying a type this version cannot express is
     * still a fact the model should see, not a reason to refuse to read it.
     */
    fields: Array<{ name: string; type: string; required?: boolean }>;
  }>;
}

/**
 * Agent-side structural view of the LIVE data facet (spec §5.3 vocabulary):
 * the rows an `update`/`delete` `where` clause can actually select.
 *
 * Passed verbatim to the model — the harness never samples or truncates. A
 * silently trimmed view is worse than none: the model would author a `where`
 * against rows it was never shown, which is the identifier invention this
 * input exists to prevent. Deciding how much of a large facet the model should
 * see is the consumer's call, made where the cost is known.
 */
export interface DataInput {
  /** Rows keyed by entity name, matching `SchemaInput.entities[].name`. */
  entities: Record<string, Array<Record<string, unknown>>>;
}

/**
 * Agent-side structural view of the edit-context contract v0.1
 * (produced by the vivarium runtime; consumed here).
 */
export interface EditContextInput {
  editContextVersion: string;
  profile: string | null;
  selection: Array<{ id: string; tag: string }>;
  screen: { elementIds: string[] };
  source: { language: string; code: string } | null;
  untrusted: Record<string, { text: string | null; attributes: Record<string, string> }>;
}
