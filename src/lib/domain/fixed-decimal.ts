export function parseFixedDecimal(value: string, decimalPlaces: number, options: { allowZero?: boolean; label?: string } = {}) {
  const label = options.label ?? "数值";
  const normalized = value.trim();
  const pattern = new RegExp(`^\\d+(?:\\.\\d{1,${decimalPlaces}})?$`);
  if (!pattern.test(normalized)) throw new Error(`${label}格式不正确，最多 ${decimalPlaces} 位小数。`);

  const [whole, fraction = ""] = normalized.split(".");
  const scale = 10n ** BigInt(decimalPlaces);
  const scaled = BigInt(whole) * scale + BigInt(fraction.padEnd(decimalPlaces, "0"));
  if (scaled < 0n || (!options.allowZero && scaled === 0n)) throw new Error(`${label}必须大于 0。`);
  if (scaled > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label}超出支持范围。`);
  return Number(scaled);
}
