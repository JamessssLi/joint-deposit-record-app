import type { Currency, FxRates, LedgerEvent } from "@/lib/domain/balance-calculations";

export type TrendPoint = { label: string; total: number; account: number; reimbursed: number };
export type SankeyFlow = { source: string; target: string; value: number };

function reported(event: LedgerEvent, reporting: Currency, rates: FxRates) {
  return Math.round(event.amountMinor / rates[event.currency] * rates[reporting]);
}

export function expenseTrend(events: LedgerEvent[], reporting: Currency, rates: FxRates, granularity: "day" | "month", days = 30): TrendPoint[] {
  const end = new Date("2026-09-07T00:00:00Z");
  const keys: string[] = [];
  if (granularity === "day") for (let i = days - 1; i >= 0; i--) { const date = new Date(end); date.setUTCDate(end.getUTCDate() - i); keys.push(date.toISOString().slice(0, 10)); }
  else for (let i = 11; i >= 0; i--) { const date = new Date(end); date.setUTCMonth(end.getUTCMonth() - i); keys.push(date.toISOString().slice(0, 7)); }
  const result = new Map(keys.map((label) => [label, { label, total: 0, account: 0, reimbursed: 0 }]));
  events.filter((event) => event.status === "posted").forEach((event) => {
    const key = granularity === "day" ? event.occurredAt : event.occurredAt.slice(0, 7); const point = result.get(key); if (!point) return;
    const amount = reported(event, reporting, rates);
    if (event.type === "expense") { point.total += amount; point.account += amount; }
    if (event.type === "reimbursement") { point.total += amount; point.reimbursed += amount; }
    if (event.type === "expense_refund") { point.total -= amount; point.account -= amount; }
  });
  return [...result.values()];
}

export function consumptionSankey(events: LedgerEvent[], reporting: Currency, rates: FxRates): SankeyFlow[] {
  const flows = new Map<string, number>();
  events.filter((event) => event.status === "posted" && ["expense", "reimbursement", "expense_refund"].includes(event.type)).forEach((event) => {
    const source = event.type === "expense" ? "共同账户支付" : event.type === "reimbursement" ? "成员代付" : "退款 / 调整";
    const target = event.category || "其他"; const value = reported(event, reporting, rates) * (event.type === "expense_refund" ? -1 : 1); const key = `${source}→${target}`;
    flows.set(key, (flows.get(key) || 0) + value);
  });
  return [...flows.entries()].filter(([, value]) => value > 0).map(([key, value]) => { const [source, target] = key.split("→"); return { source, target, value }; });
}
