export type ProposalStatus =
  | "draft"
  | "pending_approval"
  | "overdue_pending"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "deleted_draft";

export type ProposalAction = "submit" | "approve" | "reject" | "withdraw" | "markOverdue" | "deleteDraft";

const transitions: Record<ProposalStatus, Partial<Record<ProposalAction, ProposalStatus>>> = {
  draft: { submit: "pending_approval", deleteDraft: "deleted_draft" },
  pending_approval: { approve: "approved", reject: "rejected", withdraw: "withdrawn", markOverdue: "overdue_pending" },
  overdue_pending: { approve: "approved", reject: "rejected", withdraw: "withdrawn" },
  approved: {},
  rejected: {},
  withdrawn: {},
  deleted_draft: {},
};

export function transitionProposal(status: ProposalStatus, action: ProposalAction): ProposalStatus {
  const next = transitions[status][action];
  if (!next) throw new Error(`不能对 ${status} 执行 ${action}`);
  return next;
}

export function canReview(submitterId: string, reviewerId: string, status: ProposalStatus): boolean {
  return submitterId !== reviewerId && (status === "pending_approval" || status === "overdue_pending");
}
