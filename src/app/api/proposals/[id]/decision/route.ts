import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { proposalDecisionSchema, proposalIdSchema } from "@/lib/validation/decision";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsedId = proposalIdSchema.safeParse(id);
  const parsedBody = proposalDecisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsedId.success || !parsedBody.success) {
    return NextResponse.json({ error: "审批请求无效" }, { status: 400 });
  }
  const body = parsedBody.data;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { data, error } = await supabase.rpc("decide_proposal", { proposal_uuid: parsedId.data, approve: body.approve, note: body.note ?? null });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ledgerEntryId: data });
}
