/**
 * Edit context version gate.
 *
 * The edit context is the runtime's public contract, and it tells consumers to
 * refuse a context whose `editContextVersion` major/minor they do not support
 * (0.2 is not additive over 0.1: the screen became a neighbourhood). Accepting
 * any version would let a context of another shape reach the model and be
 * read as if it were the one this harness understands.
 */

import type { EditContextInput } from "./ports.ts";

/** The edit context versions (major.minor) this harness reads. */
export const SUPPORTED_EDIT_CONTEXT_VERSIONS: readonly string[] = Object.freeze(["0.2"]);

/** Thrown when an edit context's version is not one this harness reads. */
export class EditContextVersionError extends Error {
  /** The `editContextVersion` the context carried. */
  readonly received: string;
  /** The major.minor versions this harness accepts. */
  readonly supported: readonly string[];

  constructor(received: string) {
    super(
      `edit context version ${JSON.stringify(received)} is not supported ` +
        `(supported: ${SUPPORTED_EDIT_CONTEXT_VERSIONS.join(", ")}) — ` +
        "produce the context with a runtime that emits a supported version",
    );
    this.name = "EditContextVersionError";
    this.received = received;
    this.supported = SUPPORTED_EDIT_CONTEXT_VERSIONS;
  }
}

const VERSION_PATTERN = /^(\d+)\.(\d+)(?:\.\d+)?$/;

/** Refuse a context whose major.minor is not supported. `null` means no context and passes. */
export function assertSupportedEditContext(context: EditContextInput | null | undefined): void {
  if (context === null || context === undefined) return;
  const received = context.editContextVersion;
  const match = typeof received === "string" ? VERSION_PATTERN.exec(received) : null;
  const majorMinor = match ? `${match[1]}.${match[2]}` : null;
  if (majorMinor === null || !SUPPORTED_EDIT_CONTEXT_VERSIONS.includes(majorMinor)) {
    throw new EditContextVersionError(String(received));
  }
}
