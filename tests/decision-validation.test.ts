import { describe, expect, it } from "vitest";
import { proposalDecisionSchema, proposalIdSchema } from "@/lib/validation/decision";

describe("审批请求校验", () => {
  it("只接受布尔决定和可选的非空备注", () => {
    expect(proposalDecisionSchema.safeParse({ approve: true }).success).toBe(true);
    expect(proposalDecisionSchema.safeParse({ approve: false, note: "  金额已核对  " }).data).toEqual({ approve: false, note: "金额已核对" });
    expect(proposalDecisionSchema.safeParse({ approve: "true" }).success).toBe(false);
    expect(proposalDecisionSchema.safeParse({ approve: false, note: "   " }).success).toBe(false);
  });

  it("拒绝多余字段和非法提案 ID", () => {
    expect(proposalDecisionSchema.safeParse({ approve: true, unexpected: true }).success).toBe(false);
    expect(proposalIdSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(proposalIdSchema.safeParse("00000000-0000-4000-8000-000000000001").success).toBe(true);
  });
});
