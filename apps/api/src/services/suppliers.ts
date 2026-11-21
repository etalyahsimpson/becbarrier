import { randomUUID } from 'node:crypto';
import type { Db, DbClient } from '../db.js';
import type { AppConfig } from '../config.js';
import { err, type ActorState } from '../middleware/error.js';
import { createContextKey } from '@becbarrier/security';
import { appendAuditEventWithConfig, AuditEventTypes } from './audit.js';
import { insertOutboxEvent, OutboxEventTypes } from './outbox.js';

/**
 * Supplier master data: approved domains/aliases, pre-approved callback
 * contacts (encrypted), and masked payment account references. Contact
 * values are encrypted; the UI only ever sees masked values.
 */

export interface SupplierSummary {
  id: string;
  canonicalName: string;
  status: string;
  approvedDomains: string[];
  contactCount: number;
  activeAccountId: string | null;
  maskedSuffix: string | null;
  currency: string | null;
  openChanges: number;
}

export async function listSuppliers(db: Db, tenantId: string): Promise<SupplierSummary[]> {
  const result = await db.query<{
    id: string;
    canonical_name: string;
    status: string;
    approved_domains: Array<{ domain: string }>;
  }>(
    `SELECT id, canonical_name, status, approved_domains FROM suppliers WHERE tenant_id = $1 ORDER BY canonical_name`,
    [tenantId],
  );
  const items: SupplierSummary[] = [];
  for (const s of result.rows) {
    const contacts = await db.query<{ count: string }>(
      `SELECT count(*) AS count FROM supplier_contacts WHERE supplier_id = $1 AND active`,
      [s.id],
    );
    const account = await db.query<{ id: string; masked_suffix: string; currency: string }>(
      `SELECT id, masked_suffix, currency FROM supplier_payment_accounts WHERE supplier_id = $1 AND active_to IS NULL LIMIT 1`,
      [s.id],
    );
    const changes = await db.query<{ count: string }>(
      `SELECT count(*) AS count FROM bank_change_requests
       WHERE supplier_id = $1 AND state IN ('ON_HOLD','CALLBACK_VERIFIED','APPROVAL_1','APPROVAL_2')`,
      [s.id],
    );
    items.push({
      id: s.id,
      canonicalName: s.canonical_name,
      status: s.status,
      approvedDomains: (s.approved_domains ?? []).map((d) => d.domain),
      contactCount: Number(contacts.rows[0]!.count),
      activeAccountId: account.rows[0]?.id ?? null,
      maskedSuffix: account.rows[0]?.masked_suffix ?? null,
      currency: account.rows[0]?.currency ?? null,
      openChanges: Number(changes.rows[0]!.count),
    });
  }
  return items;
}

export async function getSupplierDetail(db: Db, tenantId: string, supplierId: string): Promise<unknown> {
  const result = await db.query<{
    id: string;
    canonical_name: string;
    status: string;
    approved_domains: unknown;
    approved_domains_version: number;
    created_at: Date;
  }>(
    `SELECT id, canonical_name, status, approved_domains, approved_domains_version, created_at
     FROM suppliers WHERE id = $1 AND tenant_id = $2`,
    [supplierId, tenantId],
  );
  const supplier = result.rows[0];
  if (!supplier) throw err('NOT_FOUND_IN_TENANT', 'Supplier not found.');

  const contacts = await db.query<{
    id: string;
    channel: string;
    masked_value: string;
    contact_label: string;
    contact_established_at: Date;
    version: number;
    active: boolean;
    provenance: string;
  }>(
    `SELECT id, channel, masked_value, contact_label, contact_established_at, version, active, provenance
     FROM supplier_contacts WHERE supplier_id = $1 AND tenant_id = $2 ORDER BY contact_established_at`,
    [supplierId, tenantId],
  );
  const accounts = await db.query<{
    id: string;
    masked_suffix: string;
    beneficiary_mask: string;
    currency: string;
    approved_version: number;
    active_from: Date;
    active_to: Date | null;
  }>(
    `SELECT id, masked_suffix, beneficiary_mask, currency, approved_version, active_from, active_to
     FROM supplier_payment_accounts WHERE supplier_id = $1 AND tenant_id = $2
     ORDER BY active_from DESC`,
    [supplierId, tenantId],
  );
  const changes = await db.query<{ id: string; state: string; revision: number; created_at: Date }>(
    `SELECT id, state, revision, created_at FROM bank_change_requests
     WHERE supplier_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 20`,
    [supplierId, tenantId],
  );

  return {
    id: supplier.id,
    canonicalName: supplier.canonical_name,
    status: supplier.status,
    approvedDomains: supplier.approved_domains,
    approvedDomainsVersion: supplier.approved_domains_version,
    createdAt: supplier.created_at.toISOString(),
    contacts: contacts.rows.map((c) => ({
      id: c.id,
      channel: c.channel,
      maskedValue: c.masked_value,
      label: c.contact_label,
      establishedAt: c.contact_established_at.toISOString(),
      version: c.version,
      active: c.active,
      provenance: c.provenance,
    })),
    paymentAccounts: accounts.rows.map((a) => ({
      id: a.id,
      maskedSuffix: a.masked_suffix,
      beneficiaryName: a.beneficiary_mask,
      currency: a.currency,
      approvedVersion: a.approved_version,
      activeFrom: a.active_from.toISOString(),
      activeTo: a.active_to ? a.active_to.toISOString() : null,
    })),
    recentChanges: changes.rows.map((c) => ({
      id: c.id,
      state: c.state,
      revision: c.revision,
      createdAt: c.created_at.toISOString(),
    })),
  };
}

/** Tenant administrator approves a new callback contact (audited). */
export async function approveContact(
  client: DbClient,
  config: AppConfig,
  actor: ActorState,
  supplierId: string,
  input: { channel: 'PHONE' | 'EMAIL'; value: string; label: string },
): Promise<{ contactId: string }> {
  if (actor.role !== 'TENANT_ADMIN') {
    throw err('FORBIDDEN', 'Only a tenant administrator may approve new supplier contacts.');
  }
  const crypto = createContextKey(config.paymentEncryptionKey);
  const canonical = input.value.trim().toLowerCase();
  const fingerprint = crypto.fingerprint(`contact:${input.channel}:${canonical}`);
  const masked =
    input.channel === 'PHONE'
      ? `•••• ••• ${canonical.slice(-4)}`
      : `${canonical.slice(0, 2)}•••@${canonical.split('@')[1] ?? 'masked'}`;

  {
    const supplier = await client.query<{ id: string; canonical_name: string }>(
      `SELECT id, canonical_name FROM suppliers WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [supplierId, actor.tenantId],
    );
    if (!supplier.rows[0]) throw err('NOT_FOUND_IN_TENANT', 'Supplier not found.');

    const contactId = randomUUID();
    await client.query(
      `INSERT INTO supplier_contacts
         (id, tenant_id, supplier_id, channel, encrypted_contact_value, contact_fingerprint,
          masked_value, contact_label, contact_established_at, approved_by_user_id, version,
          active, provenance)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),$9,1,TRUE,'VERIFIED_UPDATE')`,
      [
        contactId,
        actor.tenantId,
        supplierId,
        input.channel,
        JSON.stringify(crypto.encryptBankPayload(canonical, {
          tenantId: actor.tenantId,
          supplierId,
          revision: 0,
        })),
        fingerprint,
        masked,
        input.label,
        actor.userId,
      ],
    );
    await appendAuditEventWithConfig(client, config, {
      tenantId: actor.tenantId,
      aggregateType: 'supplier_contact',
      aggregateId: contactId,
      aggregateVersion: 1,
      actorUserId: actor.userId,
      eventType: AuditEventTypes.CONTACT_APPROVED,
      safeMetadata: { supplierId, channel: input.channel, label: input.label, maskedValue: masked },
    });
    await insertOutboxEvent(client, {
      tenantId: actor.tenantId,
      eventType: OutboxEventTypes.CONTACT_APPROVED,
      redactedPayload: { supplierId, contactId, channel: input.channel, label: input.label },
    });
    return { contactId };
  }
}
