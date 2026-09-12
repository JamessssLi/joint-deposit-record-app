import { cashBalance, currencies, reportBalances, type Currency, type FxRates, type LedgerEvent } from "./balance-calculations";
import { safeInteger } from "./integer-math";

export function summarizeLedger(events: LedgerEvent[], reporting: Currency, rates: Partial<FxRates> = {}) {
  const cashByCurrency = Object.fromEntries(currencies.map((currency) => [currency, cashBalance(events, currency)])) as Record<Currency, number>;
  const days = new Map<string, Record<Currency, number>>();
  for (const event of events) {
    if (event.status !== "posted" || !["expense", "reimbursement", "expense_refund"].includes(event.type)) continue;
    const amounts = days.get(event.occurredAt) ?? { USD: 0, CNY: 0, HKD: 0 };
    amounts[event.currency] = safeInteger(amounts[event.currency] + event.amountMinor * (event.type === "expense_refund" ? -1 : 1), "消费金额");
    days.set(event.occurredAt, amounts);
  }
  return {
    cashByCurrency,
    cash: reportBalances(cashByCurrency, reporting, rates),
    trend: [...days.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([date, amounts]) => ({ date, ...reportBalances(amounts, reporting, rates) })),
  };
}

export function recordCurrency(type: string, reporting: Currency, investment?: { currency: Currency }): Currency {
  if (["investment_buy", "investment_sell", "dividend", "investment_valuation"].includes(type)) {
    if (!investment) throw new Error("请选择投资标的");
    return investment.currency;
  }
  return reporting;
}

export { reportBalances } from "./balance-calculations";
