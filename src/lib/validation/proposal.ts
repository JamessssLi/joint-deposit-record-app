import { z } from "zod";

export const proposalSchema = z.object({
  householdId: z.string().uuid(),
  type: z.enum(["deposit", "expense", "expense_refund", "reimbursement", "settlement", "investment_buy", "investment_sell", "dividend"]),
  amountMinor: z.number().int().positive().max(9_999_999_999),
  currency: z.enum(["USD", "CNY", "HKD"]),
  occurredAt: z.string().date(),
  title: z.string().trim().min(1).max(160),
  category: z.string().trim().max(60).optional(),
  investmentId: z.string().uuid().optional(),
  quantityMilli: z.number().int().positive().optional(),
  unitPriceMinor: z.number().int().positive().optional(),
  idempotencyKey: z.string().uuid(),
});
