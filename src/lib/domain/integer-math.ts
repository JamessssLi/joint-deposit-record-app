export function safeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label}超出安全整数范围`);
  return value;
}

/** Exact half-up rounding for nonnegative monetary ratios; no float product. */
export function roundRatio(a: number, b: number, divisor: number): number {
  [a, b, divisor].forEach((value) => safeInteger(value, "核算数值"));
  if (a < 0 || b < 0 || divisor <= 0) throw new Error("无效核算比例");
  const product = BigInt(a) * BigInt(b);
  const denominator = BigInt(divisor);
  return safeInteger(Number((product * 2n + denominator) / (2n * denominator)), "核算结果");
}
