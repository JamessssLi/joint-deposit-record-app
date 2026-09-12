import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ valueDate: z.string().date(), priceTenThousandths: z.number().int().positive().max(999_999_999_999), note: z.string().trim().max(300).optional() }).strict();
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsedId = z.string().uuid().safeParse(id);
  const parsedInput = schema.safeParse(await request.json().catch(() => null));
  if (!parsedId.success || !parsedInput.success) return NextResponse.json({ error: "价格请求无效" }, { status: 400 });
  const input = parsedInput.data;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { data, error } = await supabase.rpc("set_investment_price_1e4", { target_investment: parsedId.data, value_date_input: input.valueDate, price_1e4: input.priceTenThousandths, note_input: input.note ?? null });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data });
}
