import type { LedgerEvent } from "./balance-calculations";

const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Legacy rows use immutable created_at/id until effective_sequence is migrated. */
export function compareEvents(a: LedgerEvent, b: LedgerEvent): number {
  const date = compareText(a.occurredAt, b.occurredAt);
  if (date) return date;
  if (a.effectiveSequence == null && b.effectiveSequence != null) return -1;
  if (a.effectiveSequence != null && b.effectiveSequence == null) return 1;
  if (a.effectiveSequence != null && b.effectiveSequence != null) {
    const sequence = BigInt(a.effectiveSequence ?? 0) - BigInt(b.effectiveSequence ?? 0);
    if (sequence !== 0n) return sequence < 0n ? -1 : 1;
    return compareText(a.id, b.id);
  }
  return compareText(a.createdAt ?? "", b.createdAt ?? "") || compareText(a.id, b.id);
}
