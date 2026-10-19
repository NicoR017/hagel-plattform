/** In-process change notifications (single API instance). Clients keep an SSE connection and pull when notified. */
export class Hub {
  private subs = new Map<string, Set<(seq: number) => void>>();
  subscribe(orgId: string, fn: (seq: number) => void): () => void {
    const s = this.subs.get(orgId) ?? new Set();
    s.add(fn);
    this.subs.set(orgId, s);
    return () => { s.delete(fn); };
  }
  publish(orgId: string, seq: number) { this.subs.get(orgId)?.forEach((f) => f(seq)); }
}
