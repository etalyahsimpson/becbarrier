import { ChangeState } from '@becbarrier/contracts';

/**
 * Server-controlled bank-change state machine (handoff section 5.1).
 *
 * DRAFT → SUBMITTED → ON_HOLD → CALLBACK_VERIFIED → APPROVAL_1 → APPROVAL_2
 *   → RELEASED_FOR_ERP_UPDATE → ERP_APPLIED (authenticated external ack only)
 *
 * ON_HOLD / CALLBACK_VERIFIED / APPROVAL_* → REJECTED | CANCELLED | EXPIRED
 * ANY material edit → new immutable revision → ON_HOLD (prior evidence void)
 * ANY error, stale version or missing evidence → NO RELEASE, NO advancement.
 */

export type WorkflowAction =
  | 'SUBMIT'
  | 'VERIFY_CALLBACK'
  | 'RECORD_CALLBACK_DENIED'
  | 'RECORD_CALLBACK_UNREACHABLE'
  | 'APPROVE_1'
  | 'APPROVE_2'
  | 'REJECT'
  | 'CANCEL'
  | 'EXPIRE'
  | 'RELEASE'
  | 'ERP_ACK'
  | 'MATERIAL_EDIT';

const TRANSITIONS: Record<WorkflowAction, Partial<Record<ChangeState, ChangeState>>> = {
  SUBMIT: { DRAFT: 'SUBMITTED' },
  VERIFY_CALLBACK: { ON_HOLD: 'CALLBACK_VERIFIED' },
  RECORD_CALLBACK_DENIED: { ON_HOLD: 'REJECTED', CALLBACK_VERIFIED: 'REJECTED', APPROVAL_1: 'REJECTED', APPROVAL_2: 'REJECTED' },
  RECORD_CALLBACK_UNREACHABLE: {},
  APPROVE_1: { CALLBACK_VERIFIED: 'APPROVAL_1' },
  APPROVE_2: { APPROVAL_1: 'APPROVAL_2' },
  REJECT: {
    ON_HOLD: 'REJECTED',
    CALLBACK_VERIFIED: 'REJECTED',
    APPROVAL_1: 'REJECTED',
    APPROVAL_2: 'REJECTED',
  },
  CANCEL: {
    DRAFT: 'CANCELLED',
    SUBMITTED: 'CANCELLED',
    ON_HOLD: 'CANCELLED',
    CALLBACK_VERIFIED: 'CANCELLED',
    APPROVAL_1: 'CANCELLED',
    APPROVAL_2: 'CANCELLED',
  },
  EXPIRE: {
    ON_HOLD: 'EXPIRED',
    CALLBACK_VERIFIED: 'EXPIRED',
    APPROVAL_1: 'EXPIRED',
    APPROVAL_2: 'EXPIRED',
  },
  RELEASE: { APPROVAL_2: 'RELEASED_FOR_ERP_UPDATE' },
  ERP_ACK: { RELEASED_FOR_ERP_UPDATE: 'ERP_APPLIED' },
  MATERIAL_EDIT: {
    ON_HOLD: 'ON_HOLD',
    CALLBACK_VERIFIED: 'ON_HOLD',
    APPROVAL_1: 'ON_HOLD',
    APPROVAL_2: 'ON_HOLD',
  },
};

export function nextStates(action: WorkflowAction, from: ChangeState): ChangeState | null {
  const table = TRANSITIONS[action];
  return table[from] ?? null;
}

export function canTransition(action: WorkflowAction, from: ChangeState): boolean {
  return nextStates(action, from) !== null;
}

/** States from which release-for-ERP is reachable without new evidence. */
export function isReleaseBlockedState(state: ChangeState): boolean {
  return state !== 'APPROVAL_2';
}

/** Requests in these states still require governed action before release. */
export function isActiveHoldState(state: ChangeState): boolean {
  return ['ON_HOLD', 'CALLBACK_VERIFIED', 'APPROVAL_1', 'APPROVAL_2'].includes(state);
}

export function isTerminal(state: ChangeState): boolean {
  return ['ERP_APPLIED', 'REJECTED', 'CANCELLED', 'EXPIRED'].includes(state);
}
