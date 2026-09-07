import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ name: z.string().trim().min(1).max(120), ticker: z.string().trim().max(30).optional(), assetType: z.string().trim().min(1).max(40), currency: z.enum(["USD", "CNY", "HKD"]) });
export async function POST(request: Request) {
  const { householdId, ...input } = schema.extend({ householdId: z.string().uuid() }).parse(await request.json());
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { data, error } = await supabase.rpc("create_investment_direct", { target_household: householdId, investment_name: input.name, ticker_input: input.ticker ?? "", asset_type_input: input.assetType, investment_currency: input.currency });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data });
}
