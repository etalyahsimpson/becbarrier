import { Role } from '@becbarrier/contracts';

/**
 * Separation-of-duties and eligibility policies (handoff invariants 3, 4, 6).
 * These are pure functions; the Express controllers must re-verify everything
 * server-side inside the row lock before any transition.
 */

export interface ActorContext {
  userId: string;
  role: Role;
  membershipActive: boolean;
  accountStatus: 'ACTIVE' | 'DISABLED';
}

export interface ChangeParticipants {
  initiatorUserId: string;
  verifierUserId: string | null;
  firstApproverUserId: string | null;
}

export type EligibilityDenial =
  | 'ROLE_NOT_PERMITTED'
  | 'MEMBERSHIP_INACTIVE'
  | 'SELF_APPROVAL_FORBIDDEN'
  | 'VERIFIER_CANNOT_APPROVE'
  | 'DUPLICATE_APPROVER'
  | 'INITIATOR_CANNOT_VERIFY';

export type EligibilityResult = { eligible: true } | { eligible: false; reason: EligibilityDenial };

/** Who may create a bank-change request. */
export function canCreateBankChange(actor: ActorContext): EligibilityResult {
  if (actor.accountStatus !== 'ACTIVE' || !actor.membershipActive) return deny('MEMBERSHIP_INACTIVE');
  if (actor.role !== 'FINANCE_INITIATOR' && actor.role !== 'TENANT_ADMIN') return deny('ROLE_NOT_PERMITTED');
  return ok();
}

/** Who may attest an independent callback: a verifier that is not the initiator. */
export function canVerifyCallback(actor: ActorContext, initiatorUserId: string): EligibilityResult {
  if (actor.accountStatus !== 'ACTIVE' || !actor.membershipActive) return deny('MEMBERSHIP_INACTIVE');
  if (actor.role !== 'SUPPLIER_VERIFIER') return deny('ROLE_NOT_PERMITTED');
  if (actor.userId === initiatorUserId) return deny('INITIATOR_CANNOT_VERIFY');
  return ok();
}

/**
 * Who may approve: a finance approver that is neither the initiator nor the
 * verifier nor a previous approver of the same revision (invariant 4).
 */
export function canApprove(
  actor: ActorContext,
  participants: ChangeParticipants,
): EligibilityResult {
  if (actor.accountStatus !== 'ACTIVE' || !actor.membershipActive) return deny('MEMBERSHIP_INACTIVE');
  if (actor.role !== 'FINANCE_APPROVER') return deny('ROLE_NOT_PERMITTED');
  if (actor.userId === participants.initiatorUserId) return deny('SELF_APPROVAL_FORBIDDEN');
  if (participants.verifierUserId !== null && actor.userId === participants.verifierUserId) {
    return deny('VERIFIER_CANNOT_APPROVE');
  }
  if (participants.firstApproverUserId === actor.userId) return deny('DUPLICATE_APPROVER');
  return ok();
}

/** Who may reject or cancel: initiator (cancel own), approver (reject), admin (cancel). */
export function canReject(actor: ActorContext): EligibilityResult {
  if (actor.accountStatus !== 'ACTIVE' || !actor.membershipActive) return deny('MEMBERSHIP_INACTIVE');
  if (actor.role !== 'FINANCE_APPROVER' && actor.role !== 'SUPPLIER_VERIFIER' && actor.role !== 'TENANT_ADMIN') {
    return deny('ROLE_NOT_PERMITTED');
  }
  return ok();
}

export function canCancel(actor: ActorContext, initiatorUserId: string): EligibilityResult {
  if (actor.accountStatus !== 'ACTIVE' || !actor.membershipActive) return deny('MEMBERSHIP_INACTIVE');
  if (actor.role === 'TENANT_ADMIN') return ok();
  if (actor.role === 'FINANCE_INITIATOR' && actor.userId === initiatorUserId) return ok();
  return deny('ROLE_NOT_PERMITTED');
}

/** Release is executed by an authorized finance function (approver tier). */
export function canRelease(actor: ActorContext): EligibilityResult {
  if (actor.accountStatus !== 'ACTIVE' || !actor.membershipActive) return deny('MEMBERSHIP_INACTIVE');
  if (actor.role !== 'FINANCE_APPROVER' && actor.role !== 'TENANT_ADMIN') return deny('ROLE_NOT_PERMITTED');
  return ok();
}

function ok(): EligibilityResult {
  return { eligible: true };
}
function deny(reason: EligibilityDenial): EligibilityResult {
  return { eligible: false, reason };
}
