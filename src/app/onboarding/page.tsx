"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [message, setMessage] = useState("");
  async function create(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/households", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, reportingCurrency: currency }) });
    const body = await response.json();
    if (!response.ok) return setMessage(body.error || "创建失败");
    router.push("/app");
  }
  return <main className="grid min-h-screen place-items-center bg-[#f3f2ed] p-4"><form onSubmit={create} className="w-full max-w-md space-y-4 rounded-2xl border bg-white p-7"><div><p className="text-xs tracking-widest text-[#587064]">共筑</p><h1 className="mt-1 text-2xl font-bold">创建你们的共同账本</h1><p className="mt-2 text-sm text-gray-500">创建后可邀请另一位成员共同记录与审批。</p></div><input value={name} onChange={(event) => setName(event.target.value)} required placeholder="账本名称，例如：我们的共同账户" className="w-full rounded-xl border p-3"/><select value={currency} onChange={(event) => setCurrency(event.target.value)} className="w-full rounded-xl border p-3"><option>USD</option><option>CNY</option><option>HKD</option></select><button className="w-full rounded-xl bg-[#1f5243] py-3 font-bold text-white">创建空账本</button>{message && <p className="text-sm text-red-700">{message}</p>}</form></main>;
}
