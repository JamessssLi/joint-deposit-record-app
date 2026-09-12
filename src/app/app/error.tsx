"use client";

export default function LedgerError({ reset }: { reset: () => void }) {
  return <main className="min-h-screen bg-[#f3f2ed] p-6 text-[#1d3029]"><section className="mx-auto max-w-lg rounded-2xl border bg-white p-6"><h1 className="text-xl font-bold">账本暂时无法读取</h1><p className="my-4 text-sm text-gray-600">读取失败，暂不显示余额。请重试。</p><button onClick={reset} className="rounded-xl bg-[#1f5243] px-4 py-2 text-white">重新读取</button></section></main>;
}
