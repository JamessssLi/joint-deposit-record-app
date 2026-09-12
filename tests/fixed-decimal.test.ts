import { describe, expect, it } from "vitest";
import { parseFixedDecimal } from "@/lib/domain/fixed-decimal";

describe("金额与份额输入使用整数换算", () => {
  it("按指定精度转换，不受二进制浮点舍入影响", () => {
    expect(parseFixedDecimal("1002.00", 2, { label: "实际总扣款" })).toBe(100_200);
    expect(parseFixedDecimal("0.29", 2)).toBe(29);
    expect(parseFixedDecimal("40.125", 3, { label: "份额" })).toBe(40_125);
  });

  it("零到账卖出可显式允许零，其他金额仍必须为正", () => {
    expect(parseFixedDecimal("0", 2, { allowZero: true })).toBe(0);
    expect(() => parseFixedDecimal("0", 2)).toThrow("必须大于 0");
  });

  it("拒绝静默截断多余小数或接受非数字文本", () => {
    expect(() => parseFixedDecimal("10.001", 2)).toThrow("最多 2 位小数");
    expect(() => parseFixedDecimal("1e3", 2)).toThrow("格式不正确");
    expect(() => parseFixedDecimal("-1", 2)).toThrow("格式不正确");
  });
});
