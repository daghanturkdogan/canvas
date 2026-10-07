/** Close reason the room sends to an older tab when the same player connects from a newer one. */
export const REPLACED = 'replaced';

/** A replaced tab must stay quiet: reconnecting would replace the newer tab and start a never-ending fight. */
export function shouldReconnect(closeReason: string): boolean {
  return closeReason !== REPLACED;
}

/** Wait before retry number `attempt` (0-based): 0.5 s, 1 s, 2 s, 4 s, then 5 s. */
export function reconnectDelay(attempt: number): number {
  return Math.min(5000, 500 * 2 ** attempt);
}
