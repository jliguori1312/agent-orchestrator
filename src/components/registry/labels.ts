// The label state machine (plan §6). Names live here so no two components
// invent a variant, and NEXT_LABELS is the single source of truth for which
// moves are legal. The map lists human-driven targets too (a human applies
// `agent-ready`, approves the plan, and merges) so the diagram stays complete;
// the orchestrator performs only the subset it is responsible for.
export const LABELS = {
  ready: 'agent-ready',
  inProgress: 'agent-in-progress',
  planApproval: 'needs-human-plan-approval',
  approved: 'agent-approved',
  prOpened: 'agent-pr-opened',
  merged: 'agent-merged',
  fixNeeded: 'agent-fix-needed',
  needsHuman: 'needs-human',
  blocked: 'agent-blocked',
} as const

export type Label = (typeof LABELS)[keyof typeof LABELS]

export const NEXT_LABELS: Record<Label, readonly Label[]> = {
  [LABELS.ready]: [LABELS.inProgress],
  [LABELS.inProgress]: [LABELS.planApproval, LABELS.needsHuman, LABELS.blocked, LABELS.fixNeeded],
  [LABELS.planApproval]: [LABELS.approved, LABELS.needsHuman, LABELS.blocked],
  [LABELS.approved]: [LABELS.prOpened, LABELS.needsHuman, LABELS.blocked],
  [LABELS.prOpened]: [LABELS.merged, LABELS.needsHuman, LABELS.blocked, LABELS.fixNeeded],
  [LABELS.merged]: [],
  [LABELS.fixNeeded]: [],
  [LABELS.needsHuman]: [],
  [LABELS.blocked]: [],
}

export function canTransition(from: Label, to: Label): boolean {
  return NEXT_LABELS[from].includes(to)
}
