import { describe, expect, it } from "vitest";
import { calculateInvestmentPosition, latestValuation, valuePosition } from "@/lib/domain/investment-calculations";
import { ledgerEventFromRow } from "@/lib/domain/ledger-adapter";
import { canReview, transitionProposal } from "@/lib/domain/ledger-state-machine";
import { recordCurrency, reportBalances, summarizeLedger } from "@/lib/domain/ledger-summary";
import { reimbursementSummary, type LedgerEvent } from "@/lib/domain/balance-calculations";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const event = (data: Partial<LedgerEvent> = {}): LedgerEvent => ({ id: A, type: "investment_buy", currency: "USD", status: "posted", occurredAt: "2026-09-01", createdAt: "2026-09-01T00:00:00Z", amountMinor: 100000, quantityMilli: 100000, investmentId: "X", ...data });

describe("P1 投资重放 AC-03/69/76/77", () => {
  const buy = event({ effectiveSequence: "1" });
  const sell = event({ id: B, type: "investment_sell", amountMinor: 60000, quantityMilli: 40000, effectiveSequence: "2" });
  it.each([[buy, sell], [sell, buy]])("同日买100卖40，展示顺序不改变数量/成本/收益", (...events) => {
    expect(calculateInvestmentPosition(events, "X")).toEqual({ quantityMilli: 60000, remainingCostMinor: 60000, realizedGainMinor: 20000, dividendMinor: 0 });
  });
  it("旧库没有序号时按发生日、创建时刻、ID回放", () => {
    const oldBuy = event();
    const oldSell = event({ ...sell, effectiveSequence: undefined, createdAt: "2026-09-01T00:01:00Z" });
    expect(calculateInvestmentPosition([oldSell, oldBuy], "X").quantityMilli).toBe(60000);
    expect(calculateInvestmentPosition([event({ ...oldSell, occurredAt: "2026-09-02" }), oldBuy], "X").remainingCostMinor).toBe(60000);
  });
  it("发生日优先于入账序号；历史超卖明确失败", () => {
    expect(() => calculateInvestmentPosition([buy, event({ ...sell, occurredAt: "2026-08-31" })], "X")).toThrow("超过当时持仓");
    expect(() => calculateInvestmentPosition([buy, event({ ...sell, quantityMilli: 100001 })], "X")).toThrow("超过当时持仓");
  });
  it.each([undefined, 0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("拒绝损坏数量 %s", (quantityMilli) => {
    expect(() => calculateInvestmentPosition([event({ quantityMilli })], "X")).toThrow("数量无效");
  });
  it("T-04 实际扣款与净到账权威，不按参考价重算或再扣费", () => {
    const result = calculateInvestmentPosition([event({ ...buy, amountMinor: 100200 }), event({ ...sell, amountMinor: 59800 })], "X");
    expect(result).toEqual({ quantityMilli: 60000, remainingCostMinor: 60120, realizedGainMinor: 19720, dividendMinor: 0 });
  });
  it("T-06 三次部分卖出尾差清零，零到账处置有效", () => {
    const trades = [event({ quantityMilli: 3000, amountMinor: 10000, effectiveSequence: "1" })];
    const costs = [];
    for (let i = 0; i < 3; i++) {
      trades.push(event({ id: `sell-${i}`, type: "investment_sell", quantityMilli: 1000, amountMinor: 4000, effectiveSequence: String(i + 2) }));
      costs.push(calculateInvestmentPosition(trades, "X").remainingCostMinor);
    }
    expect(costs).toEqual([6667, 3333, 0]);
    expect(calculateInvestmentPosition(trades, "X").realizedGainMinor).toBe(2000);
    expect(calculateInvestmentPosition([buy, event({ ...sell, quantityMilli: 100000, amountMinor: 0 })], "X").realizedGainMinor).toBe(-100000);
  });
  it("忽略作废和其他标的；不更改传入数组", () => {
    const events = [sell, event({ quantityMilli: 1, status: "voided" }), buy, event({ investmentId: "Y" })];
    const before = structuredClone(events);
    expect(calculateInvestmentPosition(events, "X").quantityMilli).toBe(60000);
    expect(events).toEqual(before);
  });
  it("50组有效买卖排列与独立数量/成本预期一致", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const trades = Array.from({ length: seed }, (_, i) => event({ id: `b${i}`, quantityMilli: 1000, amountMinor: 1000, effectiveSequence: String(i + 1) }));
      trades.push(event({ type: "investment_sell", quantityMilli: seed * 1000, amountMinor: seed * 1200, effectiveSequence: String(seed + 1) }));
      const expected = { quantityMilli: 0, remainingCostMinor: 0, realizedGainMinor: seed * 200, dividendMinor: 0 };
      expect(calculateInvestmentPosition([...trades].reverse(), "X")).toEqual(expected);
      expect(calculateInvestmentPosition([...trades.slice(seed / 2), ...trades.slice(0, seed / 2)], "X")).toEqual(expected);
    }
  });
});

describe("P1 人工估值缺失与排序 AC-24", () => {
  const position = calculateInvestmentPosition([event()], "X");
  const price = { id: A, valueDate: "2026-09-01", createdAt: "2026-09-01T12:00:00Z", unitValueMinor: 1200 };
  it("缺价格按剩余成本暂估，不显示假零市值或假收益", () => {
    expect(valuePosition(position)).toEqual({ marketMinor: 100000, unrealizedGainMinor: null, source: "cost_estimate" });
  });
  it("真实零估值与缺价格不同", () => {
    expect(valuePosition(position, { ...price, unitValueMinor: 0 })).toEqual({ marketMinor: 0, unrealizedGainMinor: -100000, source: "manual" });
  });
  it("同日按创建时间/ID选最新，与返回列表排序无关", () => {
    const sameTime = { ...price, id: B, unitValueMinor: 1400 };
    const earlier = { ...price, createdAt: "2026-09-01T11:00:00Z", unitValueMinor: 1100 };
    expect(latestValuation([sameTime, earlier, price])).toEqual(sameTime);
    expect(latestValuation([price, earlier, sameTime])).toEqual(sameTime);
    expect(valuePosition(position, sameTime).marketMinor).toBe(140000);
  });
});

describe("P1 多币种汇总与领域边界", () => {
  it("USD100+CNY720无汇率不显示USD820；有测试汇率则USD200", () => {
    const events = [event({ type: "deposit", amountMinor: 10000 }), event({ id: B, type: "deposit", currency: "CNY", amountMinor: 72000 })];
    const summary = summarizeLedger(events, "USD");
    expect(summary.cashByCurrency).toEqual({ USD: 10000, CNY: 72000, HKD: 0 });
    expect(summary.cash).toEqual({ amountMinor: null, missingCurrencies: ["CNY"] });
    expect(summarizeLedger(events, "USD", { CNY: 7.2 }).cash.amountMinor).toBe(20000);
  });
  it.each([0, -1, NaN, Infinity, undefined])("无效汇率 %s 不能伪造合计", (CNY) => {
    expect(reportBalances({ USD: 10000, CNY: 72000, HKD: 0 }, "USD", { CNY }).amountMinor).toBeNull();
  });
  it("同币种无需汇率，负现金保留；分币种先汇总再折算", () => {
    expect(reportBalances({ USD: 0, CNY: -72000, HKD: 0 }, "CNY").amountMinor).toBe(-72000);
    const events = Array.from({ length: 10 }, () => event({ type: "deposit", currency: "CNY", amountMinor: 1 }));
    expect(summarizeLedger(events, "USD", { CNY: 7.2 }).cash.amountMinor).toBe(1);
  });
  it("消费趋势日期正序、退款为负、报销不重复算消费", () => {
    const events = [event({ type: "expense_refund", occurredAt: "2026-09-03", amountMinor: 12000 }), event({ type: "reimbursement", occurredAt: "2026-09-01", amountMinor: 10000 }), event({ type: "settlement", occurredAt: "2026-09-02", amountMinor: 10000 })];
    expect(summarizeLedger(events, "USD").trend.map((point) => [point.date, point.amountMinor])).toEqual([["2026-09-01", 10000], ["2026-09-03", -12000]]);
  });
  it("1500条领域输入全部参与核算（不代替数据库分页验收）", () => {
    expect(summarizeLedger(Array.from({ length: 1500 }, () => event({ type: "deposit", amountMinor: 100 })), "USD").cash.amountMinor).toBe(150000);
  });
  it.each(["investment_buy", "investment_sell", "dividend", "investment_valuation"])("%s 使用标的币种", (type) => {
    expect(recordCurrency(type, "USD", { currency: "CNY" })).toBe("CNY");
    expect(() => recordCurrency(type, "USD")).toThrow("选择投资标的");
  });
  it("真实UUID成员不被演示名字过滤，代录归实际垫付者", () => {
    const rows = reimbursementSummary([event({ type: "reimbursement", submitterId: B, payerMemberId: A, amountMinor: 10000 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ memberId: A, availableMinor: 10000 });
  });
  it("旧member_id仅映射提交者，不猜测垫付人", () => {
    const row = ledgerEventFromRow({ id: A, entry_type: "reimbursement", amount_minor: 10000, currency: "USD", status: "posted", occurred_at: "2026-09-01", created_at: "2026-09-01T00:00:00+00:00", member_id: B, title: "历史代付" });
    expect(row.submitterId).toBe(B);
    expect(row.payerMemberId).toBeUndefined();
    expect(reimbursementSummary([row])).toEqual([]);
    expect(() => ledgerEventFromRow({ ...row, id: "guyan" })).toThrow();
  });
  it("proposal批准为approved，不能把posted当审批终态；不能自批", () => {
    expect(transitionProposal("pending_approval", "approve")).toBe("approved");
    expect(() => transitionProposal("approved", "approve")).toThrow();
    expect(canReview(A, A, "pending_approval")).toBe(false);
    expect(canReview(A, B, "pending_approval")).toBe(true);
  });
});
