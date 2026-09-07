import type { LedgerEvent } from "@/lib/domain/balance-calculations";

export type InvestmentPosition = {
  quantityMilli: number;
  remainingCostMinor: number;
  realizedGainMinor: number;
  dividendMinor: number;
};

export function calculateInvestmentPosition(events: LedgerEvent[], investmentId: string, openingQuantityMilli: number, openingCostMinor: number): InvestmentPosition {
  return events.filter((event) => event.status === "posted" && event.investmentId === investmentId).reduce<InvestmentPosition>((position, event) => {
    if (event.type === "investment_buy") return { ...position, quantityMilli: position.quantityMilli + (event.quantityMilli || 0), remainingCostMinor: position.remainingCostMinor + event.amountMinor };
    if (event.type === "investment_sell") {
      const quantity = event.quantityMilli || 0;
      if (!quantity || quantity > position.quantityMilli) return position;
      const disposedCost = Math.round(position.remainingCostMinor * quantity / position.quantityMilli);
      return { ...position, quantityMilli: position.quantityMilli - quantity, remainingCostMinor: position.remainingCostMinor - disposedCost, realizedGainMinor: position.realizedGainMinor + event.amountMinor - disposedCost };
    }
    if (event.type === "dividend") return { ...position, dividendMinor: position.dividendMinor + event.amountMinor };
    return position;
  }, { quantityMilli: openingQuantityMilli, remainingCostMinor: openingCostMinor, realizedGainMinor: 0, dividendMinor: 0 });
}
