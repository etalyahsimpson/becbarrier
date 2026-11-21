/** Separation-of-duties policies (invariant 4) and scoring determinism. */
import { canApprove, canCreateBankChange, canVerifyCallback } from '@becbarrier/domain';
import { computeScore, maskAccountSuffix, scoreToPriority, canonicalAccountIdentifier } from '@becbarrier/domain';

const ACTIVE = { userId: 'u-1', role: 'FINANCE_APPROVER' as const, membershipActive: true, accountStatus: 'ACTIVE' as const };

describe('separation-of-duties policies', () => {
  it('forbids initiator self-approval', () => {
    const result = canApprove(ACTIVE, {
      initiatorUserId: 'u-1',
      verifierUserId: 'u-9',
      firstApproverUserId: null,
    });
    expect(result).toEqual({ eligible: false, reason: 'SELF_APPROVAL_FORBIDDEN' });
  });

  it('forbids the verifier from approving', () => {
    const result = canApprove(ACTIVE, {
      initiatorUserId: 'u-0',
      verifierUserId: 'u-1',
      firstApproverUserId: null,
    });
    expect(result).toEqual({ eligible: false, reason: 'VERIFIER_CANNOT_APPROVE' });
  });

  it('forbids the same approver twice', () => {
    const result = canApprove(ACTIVE, {
      initiatorUserId: 'u-0',
      verifierUserId: 'u-9',
      firstApproverUserId: 'u-1',
    });
    expect(result).toEqual({ eligible: false, reason: 'DUPLICATE_APPROVER' });
  });

  it('accepts a genuinely distinct approver', () => {
    const result = canApprove(ACTIVE, {
      initiatorUserId: 'u-0',
      verifierUserId: 'u-9',
      firstApproverUserId: 'u-8',
    });
    expect(result).toEqual({ eligible: true });
  });

  it('requires the verifier role for callbacks and rejects the initiator', () => {
    expect(
      canVerifyCallback(
        { ...ACTIVE, role: 'SUPPLIER_VERIFIER' },
        'someone-else',
      ),
    ).toEqual({ eligible: true });
    expect(
      canVerifyCallback(
        { ...ACTIVE, role: 'SUPPLIER_VERIFIER' },
        'u-1',
      ),
    ).toEqual({ eligible: false, reason: 'INITIATOR_CANNOT_VERIFY' });
    expect(
      canVerifyCallback(ACTIVE, 'someone-else'),
    ).toEqual({ eligible: false, reason: 'ROLE_NOT_PERMITTED' });
  });

  it('requires initiator or admin to create changes', () => {
    expect(canCreateBankChange({ ...ACTIVE, role: 'FINANCE_INITIATOR' })).toEqual({ eligible: true });
    expect(canCreateBankChange({ ...ACTIVE, role: 'SECURITY_ANALYST' })).toEqual({
      eligible: false,
      reason: 'ROLE_NOT_PERMITTED',
    });
    expect(canCreateBankChange({ ...ACTIVE, membershipActive: false })).toEqual({
      eligible: false,
      reason: 'MEMBERSHIP_INACTIVE',
    });
  });
});

describe('deterministic scoring', () => {
  it('sums distinct triggered severities and caps at 100', () => {
    expect(computeScore([{ severity: 'MEDIUM' }])).toBe(25);
    expect(computeScore([{ severity: 'LOW' }, { severity: 'MEDIUM' }])).toBe(35);
    expect(
      computeScore([{ severity: 'HIGH' }, { severity: 'HIGH' }, { severity: 'HIGH' }, { severity: 'CRITICAL' }]),
    ).toBe(100);
  });

  it('maps scores to priority bands', () => {
    expect(scoreToPriority(0)).toBe('NONE');
    expect(scoreToPriority(10)).toBe('LOW');
    expect(scoreToPriority(25)).toBe('MEDIUM');
    expect(scoreToPriority(50)).toBe('HIGH');
    expect(scoreToPriority(75)).toBe('CRITICAL');
    expect(scoreToPriority(100)).toBe('CRITICAL');
  });

  it('canonicalizes and masks account identifiers', () => {
    expect(canonicalAccountIdentifier('gb00 synt 0000 1122')).toBe('GB00SYNT00001122');
    expect(maskAccountSuffix('GB00SYNT0000112233')).toBe('•••• 2233');
    expect(maskAccountSuffix('1234')).toBe('****');
  });
});
