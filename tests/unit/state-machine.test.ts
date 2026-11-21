/** Bank-change state machine contracts (handoff section 5.1). */
import { canTransition, isActiveHoldState, isTerminal, nextStates } from '@becbarrier/domain';

describe('bank-change state machine', () => {
  it('follows the governed forward path', () => {
    expect(canTransition('SUBMIT', 'DRAFT')).toBe(true);
    expect(canTransition('VERIFY_CALLBACK', 'ON_HOLD')).toBe(true);
    expect(canTransition('APPROVE_1', 'CALLBACK_VERIFIED')).toBe(true);
    expect(canTransition('APPROVE_2', 'APPROVAL_1')).toBe(true);
    expect(canTransition('RELEASE', 'APPROVAL_2')).toBe(true);
    expect(canTransition('ERP_ACK', 'RELEASED_FOR_ERP_UPDATE')).toBe(true);
  });

  it('never releases from a hold state', () => {
    expect(canTransition('RELEASE', 'ON_HOLD')).toBe(false);
    expect(canTransition('RELEASE', 'CALLBACK_VERIFIED')).toBe(false);
    expect(canTransition('RELEASE', 'APPROVAL_1')).toBe(false);
  });

  it('permits rejection from hold states only', () => {
    expect(canTransition('REJECT', 'ON_HOLD')).toBe(true);
    expect(canTransition('REJECT', 'APPROVAL_2')).toBe(true);
    expect(canTransition('REJECT', 'REJECTED')).toBe(false);
    expect(canTransition('REJECT', 'RELEASED_FOR_ERP_UPDATE')).toBe(false);
  });

  it('material edit returns any hold state to ON_HOLD', () => {
    for (const state of ['ON_HOLD', 'CALLBACK_VERIFIED', 'APPROVAL_1', 'APPROVAL_2'] as const) {
      expect(nextStates('MATERIAL_EDIT', state)).toBe('ON_HOLD');
    }
    expect(canTransition('MATERIAL_EDIT', 'REJECTED')).toBe(false);
    expect(canTransition('MATERIAL_EDIT', 'RELEASED_FOR_ERP_UPDATE')).toBe(false);
  });

  it('terminal states are recognized', () => {
    expect(isTerminal('ERP_APPLIED')).toBe(true);
    expect(isTerminal('REJECTED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isTerminal('EXPIRED')).toBe(true);
    expect(isTerminal('APPROVAL_2')).toBe(false);
    expect(isActiveHoldState('ON_HOLD')).toBe(true);
    expect(isActiveHoldState('RELEASED_FOR_ERP_UPDATE')).toBe(false);
  });
});
