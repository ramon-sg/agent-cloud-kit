/**
 * @file How `prepare` asks the user a question. It asks nothing up front: secrets and domains are
 * detected by the `cloud-ready` skill, locally or in the cloud, when they are needed.
 */

/** Asks one question, showing a suggestion; resolves to the raw answer. */
export interface Ask {
  (question: string, suggestion: string): Promise<string>;
}
