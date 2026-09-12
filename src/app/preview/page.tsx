import { notFound } from "next/navigation";
import PreviewClient from "./preview-client";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const ETF = "00000000-0000-4000-8000-000000000101";
const FUND = "00000000-0000-4000-8000-000000000102";
const at = (day: string, minute: string) => `${day}T${minute}:00Z`;

export default function PreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  const entries = [
    { id: "00000000-0000-4000-8000-000000000201", status: "posted", entry_type: "deposit", amount_minor: 300000, currency: "USD", occurred_at: "2026-09-01", created_at: at("2026-09-01", "09:00"), title: "A 九月共同存入" },
    { id: "00000000-0000-4000-8000-000000000202", status: "posted", entry_type: "deposit", amount_minor: 300000, currency: "USD", occurred_at: "2026-09-01", created_at: at("2026-09-01", "09:01"), title: "B 九月共同存入" },
    { id: "00000000-0000-4000-8000-000000000203", status: "posted", entry_type: "expense", amount_minor: 10000, currency: "USD", occurred_at: "2026-09-02", created_at: at("2026-09-02", "18:00"), title: "共同晚餐", category: "餐饮" },
    { id: "00000000-0000-4000-8000-000000000204", status: "posted", entry_type: "reimbursement", amount_minor: 12000, currency: "USD", occurred_at: "2026-09-03", created_at: at("2026-09-03", "11:00"), title: "A 代付旅行交通", category: "旅行", payer_member_id: A },
    { id: "00000000-0000-4000-8000-000000000205", status: "posted", entry_type: "settlement", amount_minor: 5000, currency: "USD", occurred_at: "2026-09-04", created_at: at("2026-09-04", "10:00"), title: "向 A 部分报销", payee_member_id: A },
    { id: "00000000-0000-4000-8000-000000000206", status: "posted", entry_type: "investment_buy", amount_minor: 100000, currency: "USD", occurred_at: "2026-09-05", created_at: at("2026-09-05", "09:00"), effective_sequence: "1", title: "ETF 买入 100 份", investment_id: ETF, quantity_milli: 100000 },
    { id: "00000000-0000-4000-8000-000000000207", status: "posted", entry_type: "investment_sell", amount_minor: 60000, currency: "USD", occurred_at: "2026-09-05", created_at: at("2026-09-05", "09:05"), effective_sequence: "2", title: "ETF 卖出 40 份", investment_id: ETF, quantity_milli: 40000 },
    { id: "00000000-0000-4000-8000-000000000208", status: "posted", entry_type: "investment_buy", amount_minor: 72000, currency: "CNY", occurred_at: "2026-09-06", created_at: at("2026-09-06", "13:00"), title: "人民币基金买入", investment_id: FUND, quantity_milli: 10000 },
  ];
  const proposals = [
    { id: "00000000-0000-4000-8000-000000000301", status: "pending_approval", submitter_id: B, payload: { type: "expense", title: "周末采购", amountMinor: 8650, currency: "USD" } },
    { id: "00000000-0000-4000-8000-000000000302", status: "overdue_pending", submitter_id: A, payload: { type: "deposit", title: "补录共同存入", amountMinor: 30000, currency: "USD" } },
  ];
  const investments = [
    { id: ETF, name: "标普 500 ETF", currency: "USD", opening_quantity_milli: 0, opening_cost_minor: 0 },
    { id: FUND, name: "人民币指数基金", currency: "CNY", opening_quantity_milli: 0, opening_cost_minor: 0 },
  ];
  const valuations = [{ id: "00000000-0000-4000-8000-000000000401", investment_id: ETF, value_date: "2026-09-07", created_at: at("2026-09-07", "09:00"), unit_value_minor: 1200, unit_value_1e4: 120000 }];
  return <PreviewClient entries={entries} proposals={proposals} investments={investments} valuations={valuations}/>;
}
