/**
 * Headers shared by the two email paths (SPEC sections 6.2 and 6.3). Each call returns a fresh object,
 * so a message can never carry a header another message added, and nothing here is derived from
 * configuration or from a request: the values are fixed.
 */

/** RFC 3834: every message the plugin sends is automated and not a reply, so auto-responders stay quiet. */
export function autoSubmittedHeaders(): Record<string, string> {
  return { 'Auto-Submitted': 'auto-generated' };
}
