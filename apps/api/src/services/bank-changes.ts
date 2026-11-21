import { randomUUID } from 'node:crypto';
import type { Db, DbClient } from '../db.js';
import type { AppConfig } from '../config.js';
import { err, type ActorState } from '../middleware/error.js';
import {
  canApprove,
  canCancel,
  canCreateBankChange,
  canRelease,
  canVerifyCallback,
  canReject,
  canonicalAccountIdentifier,
  maskAccountSuffix,
  nextStates,
} from '@becbarrier/domain';
import { createContextKey, sha256Hex, type EncryptedPayload } from '@becbarrier/security';
import type { BankChangeView, CreateBankChangeInput, DecisionInput, MaterialEditInput, ReleaseInput, ErpAckInput, VerifyCallbackInput } from '@becbarrier/contracts';
import { appendAuditEventWithConfig, AuditEventTypes } from './audit.js';
import { insertOutboxEvent, OutboxEventTypes } from './outbox.js';

/**
 * The authoritative financial guard. Every transition:
 *  1. locks the request row (SELECT ... FOR UPDATE) inside a transaction,
 *  2. re-verifies actor eligibility, expected revision, callback validity and
 *     distinct approvals INSIDE the lock,
 *  3. writes the state change + audit event + outbox event atomically.
 * Any failure preserves ON_HOLD / fails closed (invariant 8).
 */

export interface ChangeRow {
  id: string;
  tenant_id: string;
  supplier_id: string;
  initiator_user_id: string;
  state: string;
  revision: number;
  old_account_id: string | null;
  old_fingerprint: string | null;
  currency: string;
  reason: string;
  linked_email_sample_id: string | null;
  callback_expires_at: Date | null;
  released_at: Date | null;
  released_by_user_id: string | null;
  release_ref: string | null;
  erp_applied_at: Date | null;
  erp_receipt_ref: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface RevisionRow {
  revision: number;
  proposed_ciphertext: EncryptedPayload;
  proposed_fingerprint: string;
  beneficiary_mask: string;
  bank_name: string;
  masked_suffix: string;
  currency: string;
  reason: string;
  created_by_user_id: string;
  created_at: Date;
}

async function lockChange(
  client: DbClient,
  tenantId: string,
  changeId: string,
): Promise<ChangeRow> {
  const result = await client.query<ChangeRow>(
    `SELECT * FROM bank_change_requests
     WHERE id = $1 AND tenant_id = $2
     FOR UPDATE`,
    [changeId, tenantId],
  );
  const row = result.rows[0];
  if (!row) {
    // Neutral response: never disclose cross-tenant existence.
    throw err('NOT_FOUND_IN_TENANT', 'Bank change not found.');
  }
  return row;
}

function assertRevision(current: ChangeRow, expected: number): void {
  if (current.revision !== expected) {
    throw err(
      'STALE_REVISION',
      `Expected revision ${expected} but the current revision is ${current.revision}.`,
      { currentRevision: current.revision },
    );
  }
}

function actorContext(actor: ActorState) {
  return {
    userId: actor.userId,
    role: actor.role as never,
    membershipActive: true, // auth middleware verified a fresh, active membership
    accountStatus: 'ACTIVE' as const,
  };
}

async function currentCallback(
  client: DbClient,
  changeId: string,
  revision: number,
): Promise<{
  id: string;
  result: string;
  verifier_user_id: string;
  approved_contact_id: string;
  attested_at: Date;
  expires_at: Date;
  evidence_ref: string;
} | null> {
  const result = await client.query<{
    id: string;
    result: string;
    verifier_user_id: string;
    approved_contact_id: string;
    attested_at: Date;
    expires_at: Date;
    evidence_ref: string;
  }>(
    `SELECT id, result, verifier_user_id, approved_contact_id, attested_at, expires_at, evidence_ref
     FROM callback_verifications
     WHERE change_id = $1 AND revision = $2 AND result = 'CONFIRMED'
     LIMIT 1`,
    [changeId, revision],
  );
  return result.rows[0] ?? null;
}

async function approvalsForRevision(
  client: DbClient,
  changeId: string,
  revision: number,
): Promise<Array<{ approver_user_id: string; sequence: number; decision: string; created_at: Date }>> {
  const result = await client.query<{
    approver_user_id: string;
    sequence: number;
    decision: string;
    created_at: Date;
  }>(
    `SELECT approver_user_id, sequence, decision, created_at
     FROM approval_decisions
     WHERE change_id = $1 AND revision = $2 AND decision = 'APPROVE'
     ORDER BY sequence`,
    [changeId, revision],
  );
  return result.rows;
}

function cryptoFor(config: AppConfig) {
  return createContextKey(config.paymentEncryptionKey);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createBankChange(
  client: DbClient,
  config: AppConfig,
  actor: ActorState,
  input: CreateBankChangeInput,
): Promise<BankChangeView> {
  const eligibility = canCreateBankChange(actorContext(actor));
  if (!eligibility.eligible) {
    throw err('FORBIDDEN', `Not permitted to create bank changes: ${eligibility.reason}`);
  }
  const crypto = cryptoFor(config);
  const canonical = canonicalAccountIdentifier(input.proposed.accountIdentifier);
  const fingerprint = crypto.fingerprint(canonical);

  {
    const supplierResult = await client.query<{
      id: string;
      canonical_name: string;
      status: string;
    }>(
      `SELECT id, canonical_name, status FROM suppliers
       WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [input.supplierId, actor.tenantId],
    );
    const supplier = supplierResult.rows[0];
    if (!supplier) throw err('NOT_FOUND_IN_TENANT', 'Supplier not found.');
    if (supplier.status !== 'ACTIVE') throw err('INVALID_TRANSITION', 'Supplier is not active.');

    const accountResult = await client.query<{
      id: string;
      fingerprint: string;
    }>(
      `SELECT id, fingerprint FROM supplier_payment_accounts
       WHERE supplier_id = $1 AND active_to IS NULL LIMIT 1`,
      [supplier.id],
    );
    const activeAccount = accountResult.rows[0] ?? null;

    const changeId = randomUUID();
    const envelope = crypto.encryptBankPayload(
      JSON.stringify(input.proposed),
      { tenantId: actor.tenantId, supplierId: supplier.id, revision: 1 },
    );
    const maskedSuffix = maskAccountSuffix(input.proposed.accountIdentifier);

    await client.query(
      `INSERT INTO bank_change_requests
         (id, tenant_id, supplier_id, initiator_user_id, state, revision,
          old_account_id, old_fingerprint, currency, reason, linked_email_sample_id)
       VALUES ($1,$2,$3,$4,'ON_HOLD',1,$5,$6,$7,$8,$9)`,
      [
        changeId,
        actor.tenantId,
        supplier.id,
        actor.userId,
        activeAccount?.id ?? null,
        activeAccount?.fingerprint ?? null,
        input.proposed.currency,
        input.reason,
        input.linkedEmailSampleId ?? null,
      ],
    );
    await client.query(
      `INSERT INTO bank_change_revisions
         (id, tenant_id, change_id, revision, proposed_ciphertext, proposed_fingerprint,
          beneficiary_mask, bank_name, masked_suffix, currency, created_by_user_id, reason)
       VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        randomUUID(),
        actor.tenantId,
        changeId,
        JSON.stringify(envelope),
        fingerprint,
        input.proposed.beneficiaryName,
        input.proposed.bankName,
        maskedSuffix,
        input.proposed.currency,
        actor.userId,
        input.reason,
      ],
    );

    // BEC-08: mandatory hold, independent of any email risk score.
    await appendAuditEventWithConfig(client, config, {
      tenantId: actor.tenantId,
      aggregateType: 'bank_change_request',
      aggregateId: changeId,
      aggregateVersion: 1,
      actorUserId: actor.userId,
      eventType: AuditEventTypes.BANK_CHANGE_CREATED,
      safeMetadata: {
        supplierName: supplier.canonical_name,
        maskedSuffix,
        currency: input.proposed.currency,
        revision: 1,
      },
    });
    await appendAuditEventWithConfig(client, config, {
      tenantId: actor.tenantId,
      aggregateType: 'bank_change_request',
      aggregateId: changeId,
      aggregateVersion: 1,
      actorUserId: actor.userId,
      eventType: AuditEventTypes.BANK_CHANGE_HOLD,
      safeMetadata: {
        policy: 'MANDATORY_CALLBACK_AND_DUAL_APPROVAL',
        ruleId: 'BEC-08',
        linkedEmailSampleId: input.linkedEmailSampleId ?? null,
      },
    });
    await insertOutboxEvent(client, {
      tenantId: actor.tenantId,
      eventType: OutboxEventTypes.BANK_CHANGE_CREATED,
      redactedPayload: {
        changeId,
        supplierName: supplier.canonical_name,
        state: 'ON_HOLD',
        revision: 1,
        maskedSuffix,
        currency: input.proposed.currency,
      },
    });

    return getBankChangeViewWith(client, actor.tenantId, changeId);
  }
}

// ---------------------------------------------------------------------------
// Callback verification
// ---------------------------------------------------------------------------

export async function verifyCallback(
  client: DbClient,
  config: AppConfig,
  actor: ActorState,
  changeId: string,
  input: VerifyCallbackInput,
): Promise<BankChangeView> {
  {
    const change = await lockChange(client, actor.tenantId, changeId);
    assertRevision(change, input.revision);

    const eligibility = canVerifyCallback(actorContext(actor), change.initiator_user_id);
    if (!eligibility.eligible) {
      throw err(
        eligibility.reason === 'INITIATOR_CANNOT_VERIFY' ? 'SEPARATION_OF_DUTIES' : 'FORBIDDEN',
        `Not permitted to verify this change: ${eligibility.reason}`,
      );
    }

    // The callback contact MUST come from the approved directory and MUST
    // pre-date the change request (invariant 3). A number that appears only
    // in the requesting email can never satisfy this.
    const contactResult = await client.query<{
      id: string;
      supplier_id: string;
      contact_label: string;
      contact_established_at: Date;
      active: boolean;
    }>(
      `SELECT id, supplier_id, contact_label, contact_established_at, active
       FROM supplier_contacts
       WHERE id = $1 AND tenant_id = $2 AND supplier_id = $3
       FOR UPDATE`,
      [input.approvedContactId, actor.tenantId, change.supplier_id],
    );
    const contact = contactResult.rows[0];
    if (!contact || !contact.active) {
      throw err(
        'NOT_FOUND_IN_TENANT',
        'Callback contact is not an approved directory entry for this supplier.',
      );
    }
    if (contact.contact_established_at.getTime() >= change.created_at.getTime()) {
      throw err(
        'VERIFICATION_REQUIRED',
        'The approved contact was not established before this change request; an independently governed review of the directory update is required.',
      );
    }

    const expiresAt = new Date(Date.now() + config.callbackExpiryHours * 3600 * 1000);
    const callbackId = randomUUID();

    if (input.result === 'CONFIRMED') {
      const transition = nextStates('VERIFY_CALLBACK', change.state as never);
      if (!transition) {
        throw err('INVALID_TRANSITION', `Cannot record a confirmed callback from state ${change.state}.`);
      }
      const existing = await currentCallback(client, changeId, change.revision);
      if (existing) {
        throw err('INVALID_TRANSITION', 'This revision already has a confirmed callback.');
      }
      await client.query(
        `INSERT INTO callback_verifications
           (id, tenant_id, change_id, revision, verifier_user_id, approved_contact_id,
            result, method, evidence_ref, notes, attested_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,'CONFIRMED',$7,$8,$9,now(),$10)`,
        [callbackId, actor.tenantId, changeId, change.revision, actor.userId, contact.id,
          input.method, input.evidenceRef, input.notes ?? null, expiresAt],
      );
      await client.query(
        `UPDATE bank_change_requests
         SET state = 'CALLBACK_VERIFIED', callback_expires_at = $2, updated_at = now()
         WHERE id = $1 AND revision = $3`,
        [changeId, expiresAt, change.revision],
      );
      await appendAuditEventWithConfig(client, config, {
        tenantId: actor.tenantId,
        aggregateType: 'bank_change_request',
        aggregateId: changeId,
        aggregateVersion: change.revision,
        actorUserId: actor.userId,
        eventType: AuditEventTypes.CALLBACK_ATTESTED,
        safeMetadata: {
          revision: change.revision,
          contactLabel: contact.contact_label,
          contactId: contact.id,
          expiresAt: expiresAt.toISOString(),
          evidenceRef: input.evidenceRef,
        },
      });
      await insertOutboxEvent(client, {
        tenantId: actor.tenantId,
        eventType: OutboxEventTypes.CALLBACK_ATTESTED,
        redactedPayload: { changeId, revision: change.revision, verifier: actor.userName },
      });
    } else if (input.result === 'DENIED') {
      const transition = nextStates('RECORD_CALLBACK_DENIED', change.state as never);
      if (!transition) {
        throw err('INVALID_TRANSITION', `Cannot record a denied callback from state ${change.state}.`);
      }
      await client.query(
        `INSERT INTO callback_verifications
           (id, tenant_id, change_id, revision, verifier_user_id, approved_contact_id,
            result, method, evidence_ref, notes, attested_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,'DENIED',$7,$8,$9,now(),$10)`,
        [callbackId, actor.tenantId, changeId, change.revision, actor.userId, contact.id,
          input.method, input.evidenceRef, input.notes ?? null, expiresAt],
      );
      await client.query(
        `UPDATE bank_change_requests SET state = 'REJECTED', updated_at = now() WHERE id = $1`,
        [changeId],
      );
      await appendAuditEventWithConfig(client, config, {
        tenantId: actor.tenantId,
        aggregateType: 'bank_change_request',
        aggregateId: changeId,
        aggregateVersion: change.revision,
        actorUserId: actor.userId,
        eventType: AuditEventTypes.CALLBACK_DENIED,
        safeMetadata: { revision: change.revision, contactLabel: contact.contact_label, evidenceRef: input.evidenceRef },
      });
      await insertOutboxEvent(client, {
        tenantId: actor.tenantId,
        eventType: OutboxEventTypes.CALLBACK_DENIED,
        redactedPayload: { changeId, revision: change.revision, outcome: 'DENIED' },
      });
    } else {
      // UNREACHABLE — recorded, state preserved (fail closed).
      await client.query(
        `INSERT INTO callback_verifications
           (id, tenant_id, change_id, revision, verifier_user_id, approved_contact_id,
            result, method, evidence_ref, notes, attested_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,'UNREACHABLE',$7,$8,$9,now(),$10)`,
        [callbackId, actor.tenantId, changeId, change.revision, actor.userId, contact.id,
          input.method, input.evidenceRef, input.notes ?? null, expiresAt],
      );
      await appendAuditEventWithConfig(client, config, {
        tenantId: actor.tenantId,
        aggregateType: 'bank_change_request',
        aggregateId: changeId,
        aggregateVersion: change.revision,
        actorUserId: actor.userId,
        eventType: AuditEventTypes.CALLBACK_UNREACHABLE,
        safeMetadata: { revision: change.revision, contactLabel: contact.contact_label },
      });
    }

    return getBankChangeViewWith(client, actor.tenantId, changeId);
  }
}

// ---------------------------------------------------------------------------
// Approval decisions
// ---------------------------------------------------------------------------

export async function recordDecision(
  client: DbClient,
  config: AppConfig,
  actor: ActorState,
  changeId: string,
  input: DecisionInput,
): Promise<BankChangeView> {
  {
    const change = await lockChange(client, actor.tenantId, changeId);
    assertRevision(change, input.revision);

    const callback = await currentCallback(client, changeId, change.revision);
    const approvals = await approvalsForRevision(client, changeId, change.revision);

    if (input.decision === 'REJECT') {
      const eligibility = canReject(actorContext(actor));
      if (!eligibility.eligible) {
        throw err('FORBIDDEN', `Not permitted to reject: ${eligibility.reason}`);
      }
      const transition = nextStates('REJECT', change.state as never);
      if (!transition) {
        throw err('INVALID_TRANSITION', `Cannot reject from state ${change.state}.`);
      }
      await client.query(
        `INSERT INTO approval_decisions
           (id, tenant_id, change_id, revision, approver_user_id, decision, sequence, note)
         VALUES ($1,$2,$3,$4,$5,'REJECT',NULL,$6)`,
        [randomUUID(), actor.tenantId, changeId, change.revision, actor.userId, input.note ?? null],
      );
      await client.query(`UPDATE bank_change_requests SET state='REJECTED', updated_at=now() WHERE id=$1`, [changeId]);
      await appendAuditEventWithConfig(client, config, {
        tenantId: actor.tenantId,
        aggregateType: 'bank_change_request',
        aggregateId: changeId,
        aggregateVersion: change.revision,
        actorUserId: actor.userId,
        eventType: AuditEventTypes.REQUEST_REJECTED,
        safeMetadata: { revision: change.revision, rejectedByRole: actor.role, note: input.note ?? null },
      });
      await insertOutboxEvent(client, {
        tenantId: actor.tenantId,
        eventType: OutboxEventTypes.REQUEST_TERMINAL,
        redactedPayload: { changeId, revision: change.revision, terminalState: 'REJECTED' },
      });
      return getBankChangeViewWith(client, actor.tenantId, changeId);
    }

    // APPROVE path — full separation of duties (invariant 4).
    const eligibility = canApprove(actorContext(actor), {
      initiatorUserId: change.initiator_user_id,
      verifierUserId: callback?.verifier_user_id ?? null,
      firstApproverUserId: approvals[0]?.approver_user_id ?? null,
    });
    if (!eligibility.eligible) {
      throw err(
        eligibility.reason === 'ROLE_NOT_PERMITTED' ? 'FORBIDDEN' : 'SEPARATION_OF_DUTIES',
        `Actor cannot approve this change: ${eligibility.reason}`,
      );
    }

    const nextState = approvals.length === 0 ? 'APPROVAL_1' : approvals.length === 1 ? 'APPROVAL_2' : null;
    if (!nextState) {
      throw err('INVALID_TRANSITION', 'This revision already has two approvals.');
    }
    if (change.state !== (approvals.length === 0 ? 'CALLBACK_VERIFIED' : 'APPROVAL_1')) {
      throw err(
        'INVALID_TRANSITION',
        `Cannot approve from state ${change.state}; expected ${approvals.length === 0 ? 'CALLBACK_VERIFIED' : 'APPROVAL_1'}.`,
      );
    }
    if (!callback) {
      throw err('VERIFICATION_REQUIRED', 'A confirmed callback for this exact revision is required before approval.');
    }
    if (callback.expires_at.getTime() <= Date.now()) {
      // T18: verification expiry between approvals blocks release paths.
      throw err('VERIFICATION_HOLD', 'The callback verification has expired; a new independent verification is required.');
    }

    const sequence = approvals.length + 1;
    await client.query(
      `INSERT INTO approval_decisions
         (id, tenant_id, change_id, revision, approver_user_id, decision, sequence, note)
       VALUES ($1,$2,$3,$4,$5,'APPROVE',$6,$7)`,
      [randomUUID(), actor.tenantId, changeId, change.revision, actor.userId, sequence, input.note ?? null],
    );
    await client.query(
      `UPDATE bank_change_requests SET state=$2, updated_at=now() WHERE id=$1`,
      [changeId, nextState],
    );
    await appendAuditEventWithConfig(client, config, {
      tenantId: actor.tenantId,
      aggregateType: 'bank_change_request',
      aggregateId: changeId,
      aggregateVersion: change.revision,
      actorUserId: actor.userId,
      eventType: AuditEventTypes.DECISION_RECORDED,
      safeMetadata: { revision: change.revision, decision: 'APPROVE', sequence, state: nextState },
    });
    await insertOutboxEvent(client, {
      tenantId: actor.tenantId,
      eventType: OutboxEventTypes.DECISION_RECORDED,
      redactedPayload: { changeId, revision: change.revision, sequence, decision: 'APPROVE' },
    });

    return getBankChangeViewWith(client, actor.tenantId, changeId);
  }
}

// ---------------------------------------------------------------------------
// Release for ERP update instruction
// ---------------------------------------------------------------------------

export async function releaseForErp(
  client: DbClient,
  config: AppConfig,
  actor: ActorState,
  changeId: string,
  input: ReleaseInput,
): Promise<BankChangeView> {
  {
    const change = await lockChange(client, actor.tenantId, changeId);
    assertRevision(change, input.revision);

    const eligibility = canRelease(actorContext(actor));
    if (!eligibility.eligible) {
      throw err('FORBIDDEN', `Not permitted to release: ${eligibility.reason}`);
    }
    if (change.state !== 'APPROVAL_2') {
      throw err('INVALID_TRANSITION', `Release requires state APPROVAL_2; current state is ${change.state}.`);
    }

    const callback = await currentCallback(client, changeId, change.revision);
    if (!callback) {
      throw err('VERIFICATION_REQUIRED', 'No confirmed callback for this exact revision.');
    }
    if (callback.expires_at.getTime() <= Date.now()) {
      throw err('VERIFICATION_HOLD', 'The callback verification has expired; release is blocked.');
    }
    const approvals = await approvalsForRevision(client, changeId, change.revision);
    if (approvals.length !== 2 || new Set(approvals.map((a) => a.approver_user_id)).size !== 2) {
      throw err('VERIFICATION_REQUIRED', 'Two distinct approvals for this exact revision are required.');
    }

    const releaseRef = randomUUID();
    await client.query(
      `UPDATE bank_change_requests
         SET state='RELEASED_FOR_ERP_UPDATE', released_at=now(), released_by_user_id=$2,
             release_ref=$3, updated_at=now()
       WHERE id=$1`,
      [changeId, actor.userId, releaseRef],
    );
    await appendAuditEventWithConfig(client, config, {
      tenantId: actor.tenantId,
      aggregateType: 'bank_change_request',
      aggregateId: changeId,
      aggregateVersion: change.revision,
      actorUserId: actor.userId,
      eventType: AuditEventTypes.BANK_CHANGE_RELEASED,
      safeMetadata: { revision: change.revision, releaseRef, approvals: 2, callbackValid: true },
    });
    // Controlled export instruction — redacted payload only, no raw bank data.
    await insertOutboxEvent(client, {
      tenantId: actor.tenantId,
      eventType: OutboxEventTypes.RELEASE_INSTRUCTION,
      redactedPayload: {
        changeId,
        releaseRef,
        revision: change.revision,
        supplierId: change.supplier_id,
        instruction: 'APPROVED_SUPPLIER_BANK_UPDATE',
        note: 'External ERP application and authenticated acknowledgment required; no funds move within BECBarrier.',
      },
    });

    return getBankChangeViewWith(client, actor.tenantId, changeId);
  }
}

// ---------------------------------------------------------------------------
// ERP acknowledgment (contract demonstration, local adapter stub)
// ---------------------------------------------------------------------------

export async function recordErpAck(
  client: DbClient,
  config: AppConfig,
  actor: ActorState,
  changeId: string,
  input: ErpAckInput,
): Promise<BankChangeView> {
  {
    const change = await lockChange(client, actor.tenantId, changeId);
    assertRevision(change, input.revision);
    if (change.state !== 'RELEASED_FOR_ERP_UPDATE') {
      throw err('INVALID_TRANSITION', `ERP acknowledgment requires RELEASED_FOR_ERP_UPDATE; current state is ${change.state}.`);
    }
    if (!change.release_ref || change.release_ref !== input.releaseRef) {
      throw err('INVALID_TRANSITION', 'releaseRef does not match the released instruction for this exact revision.');
    }
    await client.query(
      `UPDATE bank_change_requests
         SET state='ERP_APPLIED', erp_applied_at=now(), erp_receipt_ref=$2, updated_at=now()
       WHERE id=$1`,
      [changeId, input.externalReceipt],
    );
    await appendAuditEventWithConfig(client, config, {
      tenantId: actor.tenantId,
      aggregateType: 'bank_change_request',
      aggregateId: changeId,
      aggregateVersion: change.revision,
      actorUserId: actor.userId,
      eventType: AuditEventTypes.ERP_ACK_RECORDED,
      safeMetadata: { revision: change.revision, externalReceipt: input.externalReceipt, adapter: 'LOCAL_CONTRACT_DEMO' },
    });
    await insertOutboxEvent(client, {
      tenantId: actor.tenantId,
      eventType: OutboxEventTypes.ERP_ACK,
      redactedPayload: { changeId, revision: change.revision, externalReceipt: input.externalReceipt },
    });
    return getBankChangeViewWith(client, actor.tenantId, changeId);
  }
}

// ---------------------------------------------------------------------------
// Material edit → new immutable revision
// ---------------------------------------------------------------------------

export async function createMaterialRevision(
  client: DbClient,
  config: AppConfig,
  actor: ActorState,
  changeId: string,
  input: MaterialEditInput,
): Promise<BankChangeView> {
  {
    const change = await lockChange(client, actor.tenantId, changeId);
    if (input.expectedRevision !== change.revision) {
      throw err(
        'STALE_REVISION',
        `Expected revision ${input.expectedRevision} but the current revision is ${change.revision}.`,
        { currentRevision: change.revision },
      );
    }
    const isInitiator = actor.userId === change.initiator_user_id;
    if (!isInitiator && actor.role !== 'TENANT_ADMIN') {
      throw err('FORBIDDEN', 'Only the initiator or a tenant administrator may edit a pending change.');
    }
    const transition = nextStates('MATERIAL_EDIT', change.state as never);
    if (!transition) {
      throw err('INVALID_TRANSITION', `Cannot edit a change in state ${change.state}.`);
    }

    const currentRevision = await client.query<RevisionRow>(
      `SELECT revision, proposed_ciphertext, proposed_fingerprint, beneficiary_mask,
              bank_name, masked_suffix, currency, reason, created_by_user_id, created_at
       FROM bank_change_revisions WHERE change_id = $1 AND revision = $2`,
      [changeId, change.revision],
    );
    const current = currentRevision.rows[0];
    if (!current) throw err('TEMPORARILY_UNAVAILABLE', 'Revision record missing.');

    const crypto = cryptoFor(config);
    const canonical = canonicalAccountIdentifier(input.proposed.accountIdentifier);
    const fingerprint = crypto.fingerprint(canonical);
    const materialChange =
      fingerprint !== current.proposed_fingerprint ||
      input.proposed.beneficiaryName !== current.beneficiary_mask ||
      input.proposed.currency !== current.currency;
    if (!materialChange) {
      throw err('MALFORMED_INPUT', 'The edit does not materially change the proposed payment details.');
    }

    const newRevision = change.revision + 1;
    const envelope = crypto.encryptBankPayload(JSON.stringify(input.proposed), {
      tenantId: actor.tenantId,
      supplierId: change.supplier_id,
      revision: newRevision,
    });
    const maskedSuffix = maskAccountSuffix(input.proposed.accountIdentifier);

    await client.query(
      `INSERT INTO bank_change_revisions
         (id, tenant_id, change_id, revision, proposed_ciphertext, proposed_fingerprint,
          beneficiary_mask, bank_name, masked_suffix, currency, created_by_user_id, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        randomUUID(), actor.tenantId, changeId, newRevision, JSON.stringify(envelope),
        fingerprint, input.proposed.beneficiaryName, input.proposed.bankName, maskedSuffix,
        input.proposed.currency, actor.userId, input.reason,
      ],
    );
    // Prior callback and approvals remain as history but are void for the new
    // revision; the request returns to ON_HOLD.
    await client.query(
      `UPDATE bank_change_requests
         SET revision=$2, state='ON_HOLD', callback_expires_at=NULL, updated_at=now()
       WHERE id=$1`,
      [changeId, newRevision],
    );
    await appendAuditEventWithConfig(client, config, {
      tenantId: actor.tenantId,
      aggregateType: 'bank_change_request',
      aggregateId: changeId,
      aggregateVersion: newRevision,
      actorUserId: actor.userId,
      eventType: AuditEventTypes.REVISION_CREATED,
      safeMetadata: {
        previousRevision: change.revision,
        newRevision,
        voidedEvidence: ['callback', 'approvals'],
      },
    });
    await appendAuditEventWithConfig(client, config, {
      tenantId: actor.tenantId,
      aggregateType: 'bank_change_request',
      aggregateId: changeId,
      aggregateVersion: newRevision,
      actorUserId: actor.userId,
      eventType: AuditEventTypes.BANK_CHANGE_HOLD,
      safeMetadata: { policy: 'MANDATORY_CALLBACK_AND_DUAL_APPROVAL', revision: newRevision },
    });
    await insertOutboxEvent(client, {
      tenantId: actor.tenantId,
      eventType: OutboxEventTypes.REVISION_CREATED,
      redactedPayload: { changeId, previousRevision: change.revision, newRevision, state: 'ON_HOLD' },
    });

    return getBankChangeViewWith(client, actor.tenantId, changeId);
  }
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export async function cancelChange(
  client: DbClient,
  config: AppConfig,
  actor: ActorState,
  changeId: string,
): Promise<BankChangeView> {
  {
    const change = await lockChange(client, actor.tenantId, changeId);
    const eligibility = canCancel(actorContext(actor), change.initiator_user_id);
    if (!eligibility.eligible) {
      throw err('FORBIDDEN', `Not permitted to cancel: ${eligibility.reason}`);
    }
    const transition = nextStates('CANCEL', change.state as never);
    if (!transition) {
      throw err('INVALID_TRANSITION', `Cannot cancel from state ${change.state}.`);
    }
    await client.query(`UPDATE bank_change_requests SET state='CANCELLED', updated_at=now() WHERE id=$1`, [changeId]);
    await appendAuditEventWithConfig(client, config, {
      tenantId: actor.tenantId,
      aggregateType: 'bank_change_request',
      aggregateId: changeId,
      aggregateVersion: change.revision,
      actorUserId: actor.userId,
      eventType: AuditEventTypes.REQUEST_CANCELLED,
      safeMetadata: { revision: change.revision },
    });
    await insertOutboxEvent(client, {
      tenantId: actor.tenantId,
      eventType: OutboxEventTypes.REQUEST_TERMINAL,
      redactedPayload: { changeId, revision: change.revision, terminalState: 'CANCELLED' },
    });
    return getBankChangeViewWith(client, actor.tenantId, changeId);
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export async function getBankChangeView(
  db: Db,
  tenantId: string,
  changeId: string,
): Promise<BankChangeView> {
  return db.withTransaction(async (client) => getBankChangeViewWith(client, tenantId, changeId));
}

async function getBankChangeViewWith(client: DbClient, tenantId: string, changeId: string): Promise<BankChangeView> {
  const result = await client.query<ChangeRow & { supplier_name: string; initiator_name: string }>(
    `SELECT c.*, s.canonical_name AS supplier_name, u.display_name AS initiator_name
     FROM bank_change_requests c
     JOIN suppliers s ON s.id = c.supplier_id
     JOIN users u ON u.id = c.initiator_user_id
     WHERE c.id = $1 AND c.tenant_id = $2`,
    [changeId, tenantId],
  );
  const change = result.rows[0];
  if (!change) throw err('NOT_FOUND_IN_TENANT', 'Bank change not found.');

  const revisionRes = await client.query<RevisionRow>(
    `SELECT revision, proposed_ciphertext, proposed_fingerprint, beneficiary_mask, bank_name,
            masked_suffix, currency, reason, created_by_user_id, created_at
     FROM bank_change_revisions WHERE change_id = $1 AND revision = $2`,
    [changeId, change.revision],
  );
  const revision = revisionRes.rows[0]!;

  let previousMasked: BankChangeView['previousMasked'] = null;
  if (change.old_account_id) {
    const oldRes = await client.query<{ masked_suffix: string; beneficiary_mask: string; currency: string }>(
      `SELECT masked_suffix, beneficiary_mask, currency FROM supplier_payment_accounts WHERE id = $1`,
      [change.old_account_id],
    );
    const old = oldRes.rows[0];
    if (old) {
      previousMasked = { accountSuffix: old.masked_suffix, beneficiaryName: old.beneficiary_mask, bankName: '' };
    }
  }

  const callbackRes = await client.query<{
    result: string;
    attested_at: Date;
    expires_at: Date;
    verifier_name: string;
    contact_label: string;
    revision: number;
  }>(
    `SELECT cv.result, cv.attested_at, cv.expires_at, cv.revision,
            u.display_name AS verifier_name, sc.contact_label
     FROM callback_verifications cv
     JOIN users u ON u.id = cv.verifier_user_id
     JOIN supplier_contacts sc ON sc.id = cv.approved_contact_id
     WHERE cv.change_id = $1 AND cv.revision = $2 AND cv.result = 'CONFIRMED'
     LIMIT 1`,
    [changeId, change.revision],
  );
  const callback = callbackRes.rows[0] ?? null;

  const approvalsRes = await client.query<{
    sequence: number;
    decision: string;
    approver_name: string;
    created_at: Date;
  }>(
    `SELECT ad.sequence, ad.decision, u.display_name AS approver_name, ad.created_at
     FROM approval_decisions ad
     JOIN users u ON u.id = ad.approver_user_id
     WHERE ad.change_id = $1 AND ad.revision = $2 AND ad.decision = 'APPROVE'
     ORDER BY ad.sequence`,
    [changeId, change.revision],
  );

  return {
    id: change.id,
    supplierId: change.supplier_id,
    supplierName: change.supplier_name,
    state: change.state as BankChangeView['state'],
    revision: change.revision,
    currency: change.currency,
    proposedMasked: {
      accountSuffix: revision.masked_suffix,
      beneficiaryName: revision.beneficiary_mask,
      bankName: revision.bank_name,
    },
    previousMasked,
    callback: callback
      ? {
          result: callback.result as 'CONFIRMED',
          verifiedByUserName: callback.verifier_name,
          verifiedAt: callback.attested_at.toISOString(),
          expiresAt: callback.expires_at.toISOString(),
          contactRef: callback.contact_label,
          revision: callback.revision,
        }
      : null,
    approvals: approvalsRes.rows.map((a) => ({
      sequence: a.sequence,
      decision: a.decision as 'APPROVE',
      approverUserName: a.approver_name,
      decidedAt: a.created_at.toISOString(),
    })),
    initiatorUserName: change.initiator_name,
    callbackExpiresAt: change.callback_expires_at ? change.callback_expires_at.toISOString() : null,
    createdAt: change.created_at.toISOString(),
    updatedAt: change.updated_at.toISOString(),
    releasedAt: change.released_at ? change.released_at.toISOString() : null,
    erpAppliedAt: change.erp_applied_at ? change.erp_applied_at.toISOString() : null,
  };
}

export interface ChangeListFilters {
  state?: string;
  supplierId?: string;
  limit?: number;
  cursor?: string;
}

export async function listBankChanges(
  db: Db,
  tenantId: string,
  filters: ChangeListFilters,
): Promise<{ items: BankChangeView[]; nextCursor: string | null }> {
  const limit = Math.min(filters.limit ?? 25, 100);
  const params: unknown[] = [tenantId];
  let where = 'c.tenant_id = $1';
  if (filters.state) {
    params.push(filters.state);
    where += ` AND c.state = $${params.length}`;
  }
  if (filters.supplierId) {
    params.push(filters.supplierId);
    where += ` AND c.supplier_id = $${params.length}`;
  }
  if (filters.cursor) {
    params.push(filters.cursor);
    where += ` AND c.id > $${params.length}`;
  }
  params.push(limit + 1);
  const result = await db.query<{ id: string }>(
    `SELECT c.id FROM bank_change_requests c WHERE ${where}
     ORDER BY c.created_at DESC, c.id LIMIT $${params.length}`,
    params,
  );
  const ids = result.rows.map((r) => r.id);
  if (ids.length === 0) return { items: [], nextCursor: null };
  const items: BankChangeView[] = [];
  for (const id of ids.slice(0, limit)) {
    items.push(await getBankChangeView(db, tenantId, id));
  }
  return {
    items,
    nextCursor: ids.length > limit ? ids[limit]! : null,
  };
}

/** Digest helper for idempotency records. */
export function requestDigest(body: unknown): string {
  return sha256Hex(JSON.stringify(body ?? {}));
}
