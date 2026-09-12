import type { LedgerEvent } from "@/lib/domain/balance-calculations";
import { compareEvents } from "./event-order";
import { roundRatio, safeInteger } from "./integer-math";

export type InvestmentPosition = {
  quantityMilli: number;
  remainingCostMinor: number;
  realizedGainMinor: number;
  dividendMinor: number;
};

export function calculateInvestmentPosition(events: LedgerEvent[], investmentId: string, openingQuantityMilli = 0, openingCostMinor = 0): InvestmentPosition {
  safeInteger(openingQuantityMilli, "期初数量");
  safeInteger(openingCostMinor, "期初成本");
  if (openingQuantityMilli < 0 || openingCostMinor < 0 || (!openingQuantityMilli && openingCostMinor)) throw new Error("期初投资数据无效，需核对");
  return events.filter((event) => event.status === "posted" && event.investmentId === investmentId).sort(compareEvents).reduce<InvestmentPosition>((position, event) => {
    safeInteger(event.amountMinor, "交易金额");
    if (event.amountMinor < 0) throw new Error(`交易金额无效：${event.id}`);
    if (["investment_buy", "investment_sell"].includes(event.type)) {
      const quantity = event.quantityMilli;
      if (quantity == null || !Number.isSafeInteger(quantity) || quantity <= 0) throw new Error(`交易数量无效：${event.id}`);
      if (event.type === "investment_buy") {
        if (!event.amountMinor) throw new Error(`买入实际扣款必须大于零：${event.id}`);
        return { ...position, quantityMilli: safeInteger(position.quantityMilli + quantity, "持仓"), remainingCostMinor: safeInteger(position.remainingCostMinor + event.amountMinor, "成本") };
      }
      if (quantity > position.quantityMilli) throw new Error(`卖出超过当时持仓，需核对流水：${event.id}`);
      const disposedCost = roundRatio(position.remainingCostMinor, quantity, position.quantityMilli);
      return { ...position, quantityMilli: position.quantityMilli - quantity, remainingCostMinor: position.remainingCostMinor - disposedCost, realizedGainMinor: safeInteger(position.realizedGainMinor + event.amountMinor - disposedCost, "已实现收益") };
    }
    if (event.type === "dividend") return { ...position, dividendMinor: safeInteger(position.dividendMinor + event.amountMinor, "分红") };
    return position;
  }, { quantityMilli: openingQuantityMilli, remainingCostMinor: openingCostMinor, realizedGainMinor: 0, dividendMinor: 0 });
}

export type UnitValuation = { id: string; valueDate: string; createdAt: string; unitValueMinor: number };

export function latestValuation(valuations: UnitValuation[]): UnitValuation | undefined {
  return [...valuations].sort((a, b) => {
    const left = [a.valueDate, a.createdAt, a.id];
    const right = [b.valueDate, b.createdAt, b.id];
    for (let i = 0; i < left.length; i++) {
      if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
    }
    return 0;
  }).at(-1);
}

export function valuePosition(position: InvestmentPosition, valuation?: UnitValuation) {
  if (!position.quantityMilli) return { marketMinor: 0, unrealizedGainMinor: 0, source: "closed" as const };
  if (!valuation) return { marketMinor: position.remainingCostMinor, unrealizedGainMinor: null, source: "cost_estimate" as const };
  const marketMinor = roundRatio(position.quantityMilli, valuation.unitValueMinor, 1000);
  return { marketMinor, unrealizedGainMinor: marketMinor - position.remainingCostMinor, source: "manual" as const };
}
