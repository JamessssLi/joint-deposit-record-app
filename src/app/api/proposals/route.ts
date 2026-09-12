import { NextResponse } from "next/server";
import { proposalSchema } from "@/lib/validation/proposal";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const parsed = proposalSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "提案内容无效", issues: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { householdId, idempotencyKey, ...payload } = body;
  const { data, error } = await supabase.rpc("submit_proposal", { target_household: householdId, payload_input: payload, request_key: idempotencyKey });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data });
}
