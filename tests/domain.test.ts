import { describe, expect, it } from "vitest";
import { cashBalance, expenseTotalReporting, holdingMilli, reimbursementSummary, toReportingMinor, type FxRates, type LedgerEvent } from "@/lib/domain/balance-calculations";

const rates: FxRates = { USD: 1, CNY: 7.2, HKD: 7.8 };
const posted = "posted" as const;

describe("多币种账务计算", () => {
  it("以报告币种安全汇总现金", () => {
    const events: LedgerEvent[] = [
      { id: "1", type: "opening_balance", amountMinor: 10000, currency: "USD", status: posted, occurredAt: "2026-09-01" },
      { id: "2", type: "deposit", amountMinor: 72000, currency: "CNY", status: posted, occurredAt: "2026-09-02" },
      { id: "3", type: "expense", amountMinor: 2000, currency: "USD", status: posted, occurredAt: "2026-09-03" },
    ];
    expect(cashBalance(events, "USD")).toBe(8000);
    expect(toReportingMinor(72000, "CNY", "USD", rates)).toBe(10000);
  });

  it("成员代付计入共同消费但不改变共同现金", () => {
    const events: LedgerEvent[] = [
      { id: "1", type: "reimbursement", amountMinor: 3000, currency: "USD", status: posted, occurredAt: "2026-09-01", memberId: "linzhixia", category: "家居" },
      { id: "2", type: "settlement", amountMinor: 1000, currency: "USD", status: posted, occurredAt: "2026-09-02", memberId: "linzhixia" },
    ];
    expect(cashBalance(events, "USD")).toBe(-1000);
    expect(expenseTotalReporting(events, "USD", rates)).toBe(3000);
    const summary = reimbursementSummary(events)[0];
    expect(summary.paidMinor - summary.reimbursedMinor).toBe(2000);
  });

  it("审批中的报销会预留可再申请额度", () => {
    const events: LedgerEvent[] = [{ id: "1", type: "reimbursement", amountMinor: 5000, currency: "USD", status: posted, occurredAt: "2026-09-01", memberId: "guyan" }];
    const proposals = [{ status: "overdue_pending", payload: { type: "settlement" as const, amountMinor: 2000, currency: "USD" as const, memberId: "guyan" as const } }];
    const row = reimbursementSummary(events, proposals).find((item) => item.memberId === "guyan" && item.currency === "USD");
    expect(row?.pendingMinor).toBe(2000);
    expect(row?.availableMinor).toBe(3000);
  });

  it("已入账买卖会推导投资持仓", () => {
    const events: LedgerEvent[] = [
      { id: "1", type: "investment_buy", amountMinor: 10000, currency: "USD", status: posted, occurredAt: "2026-09-01", investmentId: "etf", quantityMilli: 10000 },
      { id: "2", type: "investment_sell", amountMinor: 5000, currency: "USD", status: posted, occurredAt: "2026-09-02", investmentId: "etf", quantityMilli: 3000 },
    ];
    expect(holdingMilli(events, "etf", 5000)).toBe(12000);
  });
});
