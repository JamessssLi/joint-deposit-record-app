"use client";

import { useState } from "react";

type Row = Record<string, unknown>;

export default function PriceModal({ close, investment, refresh, setMessage }: { close: () => void; investment: Row; refresh: () => void; setMessage: (value: string) => void }) {
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/investments/${String(investment.id)}/price`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ valueDate: new Date().toISOString().slice(0, 10), priceMinor: Math.round(Number(price) * 100), note: note || undefined }) });
    const body = await response.json();
    if (!response.ok) return setMessage(body.error || "价格更新失败");
    close(); setMessage("最新价格已直接更新，并已保留价格历史。"); refresh();
  }
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-6"><div className="mb-4 flex justify-between"><b>更新价格 · {String(investment.name)}</b><button onClick={close}>×</button></div><form onSubmit={submit} className="space-y-3"><p className="text-sm text-gray-500">价格更新不需要审批，不影响共同现金、持仓或成本。</p><input required value={price} onChange={(event) => setPrice(event.target.value)} type="number" step=".0001" placeholder={`最新单位价格（${String(investment.currency)}）`} className="w-full rounded-xl border p-3"/><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="价格说明（可选）" className="w-full rounded-xl border p-3"/><button className="w-full rounded-xl bg-[#1f5243] py-3 font-bold text-white">保存最新价格</button></form></div></div>;
}
