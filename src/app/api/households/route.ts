import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ name: z.string().min(1).max(80), reportingCurrency: z.enum(["USD", "CNY", "HKD"]).default("USD") });
export async function POST(request: Request) {
  const input = schema.parse(await request.json());
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { data, error } = await supabase.rpc("create_household", { household_name: input.name, reporting_currency_input: input.reportingCurrency });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data });
}
