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
