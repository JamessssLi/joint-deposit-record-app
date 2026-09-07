import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ householdId: z.string().uuid(), name: z.string().min(1).max(120), ticker: z.string().max(30).optional(), assetType: z.string().min(1).max(40), currency: z.enum(["USD", "CNY", "HKD"]), openingQuantityMilli: z.number().int().min(0), openingCostMinor: z.number().int().min(0), openingDate: z.string().date() });
export async function POST(request: Request) {
  const input = schema.parse(await request.json());
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { householdId, ...payload } = input;
  const { data, error } = await supabase.rpc("create_investment_proposal", { target_household: householdId, payload_input: { ...payload, occurredAt: input.openingDate }, request_key: crypto.randomUUID() });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data });
}
