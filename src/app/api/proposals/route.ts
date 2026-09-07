import { NextResponse } from "next/server";
import { proposalSchema } from "@/lib/validation/proposal";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const body = proposalSchema.parse(await request.json());
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { data, error } = await supabase.rpc("submit_proposal", { target_household: body.householdId, payload_input: { type: body.type, amountMinor: body.amountMinor, currency: body.currency, occurredAt: body.occurredAt, title: body.title, category: body.category, investmentId: body.investmentId, quantityMilli: body.quantityMilli, unitPriceMinor: body.unitPriceMinor, unitValueMinor: body.unitValueMinor }, request_key: body.idempotencyKey });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data });
}
