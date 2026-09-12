import { z } from "zod";

export const proposalDecisionSchema = z.object({
  approve: z.boolean(),
  note: z.string().trim().min(1).max(500).optional(),
}).strict();

export const proposalIdSchema = z.string().uuid();
