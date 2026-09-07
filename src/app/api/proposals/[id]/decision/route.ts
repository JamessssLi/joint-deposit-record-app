import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({ approve: z.boolean(), note: z.string().max(500).optional() });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = bodySchema.parse(await request.json());
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { data, error } = await supabase.rpc("decide_proposal", { proposal_uuid: id, approve: body.approve, note: body.note ?? null });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ledgerEntryId: data });
}
