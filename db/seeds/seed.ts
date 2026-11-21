#!/usr/bin/env tsx
/**
 * Synthetic seed data (idempotent). Two tenants, role-separated users,
 * suppliers with approved domains/contacts, encrypted payment accounts,
 * email samples with recorded analyzer output, alerts/cases, and bank-change
 * requests at every workflow stage — each with full audit history and outbox
 * events, written through the same audit-chain writer as the live API.
 *
 * Requires: migrations applied (db:migrate), key material in the environment.
 * Usage: npm run db:seed:synthetic
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createContextKey, appendAuditEvent, sha256Hex } from '@becbarrier/security';
import { canonicalAccountIdentifier, maskAccountSuffix } from '@becbarrier/domain';
import { SEED, SEED_ACCOUNTS, seedId, tenantId, userId, supplierId, contactId, changeId, emailSampleId } from './seed-data.js';

interface FixtureManifest {
  fixtures: Array<{
    id: string;
    category: string;
    description: string;
    expected: {
      digest: string;
      parseStatus: string;
      score: number;
      priority: string | null;
      matchedRules: string[];
      unknownRules: string[];
      findings: Record<string, { outcome: string; severity: string }>;
      normalizedSummary: {
        from: Record<string, unknown> | null;
        replyTo: Record<string, unknown> | null;
        subject: string | null;
        toCount: number;
        authStatus: Record<string, unknown>;
        htmlPresent: boolean;
        attachmentNames: string[];
      } | null;
    };
  }>;
}

const DAY = 24 * 3600 * 1000;
const now = Date.now();
const T = (offsetDays: number): Date => new Date(now - offsetDays * DAY);

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const auditKey = process.env.AUDIT_HMAC_KEY;
  const paymentKey = process.env.PAYMENT_ENCRYPTION_KEY;
  if (!databaseUrl || !auditKey || !paymentKey || !/^[0-9a-fA-F]{64}$/.test(auditKey) || !/^[0-9a-fA-F]{64}$/.test(paymentKey)) {
    console.error('DATABASE_URL, AUDIT_HMAC_KEY and PAYMENT_ENCRYPTION_KEY (64 hex chars each where applicable) are required.');
    process.exit(1);
  }
  const crypto = createContextKey(paymentKey);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  const manifest: FixtureManifest = JSON.parse(
    await readFile(join(import.meta.dirname, '../../fixtures/emails/expected.json'), 'utf8'),
  );
  const fixtureById = new Map(manifest.fixtures.map((f) => [f.id, f]));

  try {
    await client.query('BEGIN');

    // --- tenants + audit sequences ----------------------------------------
    for (const tenant of Object.values(SEED.tenants)) {
      await client.query(
        `INSERT INTO tenants (id, slug, name, status, callback_expiry_hours, request_expiry_days, created_at)
         VALUES ($1,$2,$3,'ACTIVE',72,14,$4)
         ON CONFLICT (id) DO NOTHING`,
        [seedId(tenant.key), tenant.slug, tenant.name, T(400)],
      );
      await client.query(
        `INSERT INTO audit_sequences (tenant_id, last_sequence) VALUES ($1, 0) ON CONFLICT (tenant_id) DO NOTHING`,
        [seedId(tenant.key)],
      );
    }

    // --- users + memberships ----------------------------------------------
    for (const [actor, user] of Object.entries(SEED.users)) {
      await client.query(
        `INSERT INTO users (id, email, display_name, status, created_at)
         VALUES ($1,$2,$3,'ACTIVE',$4) ON CONFLICT (id) DO NOTHING`,
        [seedId(user.key), user.email, user.name, T(400)],
      );
      const tenants: Array<'atlas' | 'cascade'> = actor.startsWith('atlas')
        ? ['atlas']
        : actor.startsWith('cascade')
          ? ['cascade']
          : ['atlas', 'cascade']; // cross-auditor belongs to both tenants
      for (const t of tenants) {
        await client.query(
          `INSERT INTO memberships (id, tenant_id, user_id, role, active, created_at)
           VALUES ($1,$2,$3,$4,TRUE,$5)
           ON CONFLICT (tenant_id, user_id, role) DO NOTHING`,
          [seedId(`membership:${actor}:${t}`), tenantId(t), seedId(user.key), user.role, T(390)],
        );
      }
    }

    // --- suppliers ----------------------------------------------------------
    const supplierTenant: Record<string, 'atlas' | 'cascade'> = {
      'vulcan-steel': 'atlas',
      'meridian-pack': 'atlas',
      northlight: 'atlas',
      apexchem: 'atlas',
      'granite-tools': 'atlas',
      'beacon-media': 'cascade',
      'solstice-textiles': 'cascade',
    };
    for (const [key, supplier] of Object.entries(SEED.suppliers)) {
      const t = supplierTenant[key]!;
      const domains = supplier.domains.map((domain, index) => ({
        domain,
        aliasOf: key === 'northlight' && index === 1 ? 'northlight.example' : null,
        approvedAt: T(380).toISOString(),
      }));
      await client.query(
        `INSERT INTO suppliers (id, tenant_id, canonical_name, status, approved_domains, approved_domains_version, created_at, updated_at)
         VALUES ($1,$2,$3,'ACTIVE',$4,1,$5,$5)
         ON CONFLICT (id) DO NOTHING`,
        [seedId(supplier.key), tenantId(t), supplier.name, JSON.stringify(domains), T(380)],
      );
    }

    // --- approved callback contacts (established BEFORE any change) ----------
    for (const contact of Object.values(SEED.contacts)) {
      const supplier = SEED.suppliers[contact.supplier]!;
      const t = supplierTenant[contact.supplier]!;
      const canonical = contact.value.trim().toLowerCase();
      const fingerprint = crypto.fingerprint(`contact:${contact.channel}:${canonical}`);
      const masked =
        contact.channel === 'PHONE'
          ? `•••• ••• ${canonical.slice(-4)}`
          : `${canonical.slice(0, 2)}•••@${canonical.split('@')[1] ?? 'masked'}`;
      await client.query(
        `INSERT INTO supplier_contacts
           (id, tenant_id, supplier_id, channel, encrypted_contact_value, contact_fingerprint,
            masked_value, contact_label, contact_established_at, approved_by_user_id, version,
            active, provenance, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,TRUE,'DIRECTORY_SEED',$9)
         ON CONFLICT (id) DO NOTHING`,
        [
          seedId(contact.key), tenantId(t), seedId(supplier.key), contact.channel,
          JSON.stringify(crypto.encryptBankPayload(canonical, { tenantId: tenantId(t), supplierId: seedId(supplier.key), revision: 0 })),
          fingerprint, masked, contact.label, T(300),
          userId(t === 'atlas' ? 'atlas-admin' : 'cascade-admin'),
        ],
      );
    }

    // --- payment accounts -----------------------------------------------------
    for (const [key, account] of Object.entries(SEED_ACCOUNTS)) {
      const t = supplierTenant[key]!;
      const supplier = SEED.suppliers[key]!;
      const canonical = canonicalAccountIdentifier(account.account);
      const fingerprint = crypto.fingerprint(canonical);
      const maskedSuffix = maskAccountSuffix(account.account);
      const existing = await client.query<{ id: string }>(`SELECT id FROM supplier_payment_accounts WHERE id = $1`, [seedId(`account:${key}`)]);
      if (existing.rows[0]) continue;
      await client.query(
        `INSERT INTO supplier_payment_accounts
           (id, tenant_id, supplier_id, encrypted_bank_payload, fingerprint, key_id, masked_suffix,
            beneficiary_mask, currency, approved_version, active_from, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$10)`,
        [
          seedId(`account:${key}`), tenantId(t), seedId(supplier.key),
          JSON.stringify(crypto.encryptBankPayload(JSON.stringify({
            accountIdentifier: account.account, beneficiaryName: account.beneficiary,
            bankName: account.bank, currency: account.currency,
          }), { tenantId: tenantId(t), supplierId: seedId(supplier.key), revision: 0 })),
          fingerprint, crypto.keyId, maskedSuffix, account.beneficiary, account.currency, T(300),
        ],
      );
      await appendAuditEvent(client, auditKey, {
        tenantId: tenantId(t), aggregateType: 'supplier_payment_account', aggregateId: seedId(`account:${key}`),
        aggregateVersion: 1, actorUserId: userId(t === 'atlas' ? 'atlas-admin' : 'cascade-admin'),
        eventType: 'CONTACT_APPROVED', safeMetadata: { note: 'seed payment account', maskedSuffix },
      });
    }

    // --- email samples + findings + alerts + cases ----------------------------
    const seededSamples: Array<{ fixtureId: string; tenant: 'atlas' | 'cascade' }> = [
      { fixtureId: 'S02', tenant: 'atlas' },
      { fixtureId: 'S04', tenant: 'atlas' },
      { fixtureId: 'S07', tenant: 'atlas' },
      { fixtureId: 'N02', tenant: 'atlas' },
      { fixtureId: 'S05', tenant: 'cascade' },
      { fixtureId: 'A02', tenant: 'cascade' },
    ];
    for (const { fixtureId, tenant } of seededSamples) {
      const fixture = fixtureById.get(fixtureId)!;
      const sampleId = emailSampleId(fixtureId);
      const exists = await client.query(`SELECT 1 FROM email_samples WHERE id = $1`, [sampleId]);
      if (exists.rows[0]) continue;
      const summary = fixture.expected.normalizedSummary!;
      await client.query(
        `INSERT INTO email_samples
           (id, tenant_id, source_digest, provenance, parse_status, parsed_headers_json,
            normalized_fields_json, rule_version, score, priority, unknown_count,
            subject_display, uploader_user_id, created_at)
         VALUES ($1,$2,$3,'SYNTHETIC_FIXTURE',$4,$5,$6,'bec-rules-v1',$7,$8,$9,$10,$11,$12)`,
        [
          sampleId, tenantId(tenant), fixture.expected.digest, fixture.expected.parseStatus,
          JSON.stringify({ subject: summary.subject, from: summary.from }),
          JSON.stringify(summary), fixture.expected.score, fixture.expected.priority,
          fixture.expected.unknownRules.length,
          summary.subject ?? '(no subject)',
          userId(tenant === 'atlas' ? 'atlas-analyst' : 'cascade-analyst'),
          T(6),
        ],
      );
      for (const [ruleId, finding] of Object.entries(fixture.expected.findings)) {
        await client.query(
          `INSERT INTO email_findings
             (id, tenant_id, email_sample_id, rule_id, rule_version, outcome, severity,
              provenance, explanation, evidence_field, masked_excerpt)
           VALUES ($1,$2,$3,$4,'bec-rules-v1',$5,$6,'SYNTHETIC_FIXTURE',$7,NULL,NULL)`,
          [randomUUID(), tenantId(tenant), sampleId, ruleId, finding.outcome, finding.severity,
           `Seeded synthetic fixture ${fixtureId} (${fixture.category}): ${ruleId} ${finding.outcome}.`],
        );
      }
      await appendAuditEvent(client, auditKey, {
        tenantId: tenantId(tenant), aggregateType: 'email_sample', aggregateId: sampleId,
        aggregateVersion: 1, actorUserId: userId(tenant === 'atlas' ? 'atlas-analyst' : 'cascade-analyst'),
        eventType: 'EMAIL_SAMPLE_INGESTED',
        safeMetadata: { fixtureId, digest: fixture.expected.digest, score: fixture.expected.score,
          priority: fixture.expected.priority, provenance: 'SYNTHETIC_FIXTURE' },
      });
      if (fixture.expected.matchedRules.length > 0) {
        const alertId = seedId(`alert:${fixtureId}`);
        const priority = fixture.expected.priority ?? 'LOW';
        await client.query(
          `INSERT INTO alerts (id, tenant_id, email_sample_id, priority, title, reason_codes, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
          [alertId, tenantId(tenant), sampleId, priority,
           `Suspicious indicators in message from ${(summary.from as { domain?: string } | null)?.domain ?? 'unknown sender'}`,
           JSON.stringify(fixture.expected.matchedRules), T(6)],
        );
        if (priority === 'HIGH' || priority === 'CRITICAL') {
          const caseIdValue = seedId(`case:${fixtureId}`);
          await client.query(
            `INSERT INTO cases (id, tenant_id, title, status, priority, linked_email_sample_id, version, created_at, updated_at)
             VALUES ($1,$2,$3,'OPEN',$4,$5,1,$6,$6) ON CONFLICT (id) DO NOTHING`,
            [caseIdValue, tenantId(tenant),
             `High-risk email indicators — ${(summary.from as { domain?: string } | null)?.domain ?? 'unknown sender'}`,
             priority, sampleId, T(6)],
          );
          await client.query(
            `INSERT INTO case_events (id, tenant_id, case_id, actor_user_id, action, text, created_at)
             VALUES ($1,$2,$3,$4,'CREATE',$5,$6)`,
            [randomUUID(), tenantId(tenant), caseIdValue,
             userId(tenant === 'atlas' ? 'atlas-analyst' : 'cascade-analyst'),
             `Case opened automatically from seeded fixture ${fixtureId} (score ${fixture.expected.score}).`, T(6)],
          );
          await client.query(`UPDATE alerts SET case_id=$2 WHERE id=$1`, [alertId, caseIdValue]);
        }
      }
    }

    // --- seeded bank changes at every workflow stage ---------------------------
    await seedChanges(client, auditKey, crypto);

    await client.query('COMMIT');
    console.log('synthetic seed complete (tenants, users, suppliers, contacts, accounts, email samples, bank changes)');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

interface SeededChangeSpec {
  key: string;
  tenant: 'atlas' | 'cascade';
  supplier: string;
  initiator: string;
  verifier?: string;
  approvers?: string[];
  state: string;
  stateModifiers?: 'denied-callback' | 'material-edit';
  linkedFixture?: string;
  reason: string;
}

const CHANGES: SeededChangeSpec[] = [
  { key: 'BC-SEED-1', tenant: 'atlas', supplier: 'vulcan-steel', initiator: 'atlas-initiator', state: 'ON_HOLD', linkedFixture: 'S02', reason: 'Suspicious supplier email requested new remittance details.' },
  { key: 'BC-SEED-2', tenant: 'atlas', supplier: 'meridian-pack', initiator: 'atlas-initiator', verifier: 'atlas-verifier', state: 'CALLBACK_VERIFIED', reason: 'Supplier notified new account by email.' },
  { key: 'BC-SEED-3', tenant: 'atlas', supplier: 'northlight', initiator: 'atlas-initiator', verifier: 'atlas-verifier', approvers: ['atlas-approver1'], state: 'APPROVAL_1', reason: 'Annual banking review update.' },
  { key: 'BC-SEED-4', tenant: 'atlas', supplier: 'apexchem', initiator: 'atlas-initiator', verifier: 'atlas-verifier', approvers: ['atlas-approver1', 'atlas-approver2'], state: 'RELEASED_FOR_ERP_UPDATE', reason: 'Verified change of bank after merger.' },
  { key: 'BC-SEED-5', tenant: 'atlas', supplier: 'vulcan-steel', initiator: 'atlas-initiator', verifier: 'atlas-verifier', state: 'REJECTED', stateModifiers: 'denied-callback', linkedFixture: 'S07', reason: 'Urgent redirection attempt.' },
  { key: 'BC-SEED-6', tenant: 'atlas', supplier: 'meridian-pack', initiator: 'atlas-initiator', verifier: 'atlas-verifier', approvers: ['atlas-approver1'], state: 'ON_HOLD', stateModifiers: 'material-edit', reason: 'Corrected beneficiary name after supplier review.' },
  { key: 'BC-SEED-7', tenant: 'cascade', supplier: 'beacon-media', initiator: 'cascade-initiator', state: 'ON_HOLD', linkedFixture: 'S05', reason: 'Media supplier emailed new payment instructions.' },
  { key: 'BC-SEED-8', tenant: 'cascade', supplier: 'solstice-textiles', initiator: 'cascade-initiator', verifier: 'cascade-verifier', approvers: ['cascade-approver1', 'cascade-approver2'], state: 'APPROVAL_2', reason: 'Quarterly account re-confirmation.' },
];

async function seedChanges(client: pg.Client, auditKey: string, crypto: ReturnType<typeof createContextKey>): Promise<void> {
  for (const spec of CHANGES) {
    const id = changeId(spec.key);
    const exists = await client.query(`SELECT 1 FROM bank_change_requests WHERE id = $1`, [id]);
    if (exists.rows[0]) continue;

    const t = tenantId(spec.tenant);
    const supplier = SEED.suppliers[spec.supplier]!;
    const account = SEED_ACCOUNTS[spec.supplier];
    const initiator = userId(spec.initiator);
    const createdAt = T(8);

    const keyDigits = String(1 + CHANGES.findIndex((c) => c.key === spec.key)).padStart(3, '0');
    const proposed = {
      accountIdentifier: `GB00SYNT00${keyDigits}${sha256Hex(spec.key).slice(0, 6).toUpperCase()}`,
      beneficiaryName: `${supplier.name} Ltd`,
      bankName: 'Example Trust Bank',
      currency: account?.currency ?? 'GBP',
    };
    const canonical = canonicalAccountIdentifier(proposed.accountIdentifier);
    const fingerprint = crypto.fingerprint(canonical);
    const maskedSuffix = maskAccountSuffix(proposed.accountIdentifier);
    const oldAccountId = account ? seedId(`account:${spec.supplier}`) : null;

    const revisionCount = spec.stateModifiers === 'material-edit' ? 2 : 1;
    const currentState = spec.state; // after all steps

    await client.query(
      `INSERT INTO bank_change_requests
         (id, tenant_id, supplier_id, initiator_user_id, state, revision, old_account_id,
          old_fingerprint, currency, reason, linked_email_sample_id, callback_expires_at,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        id, t, seedId(supplier.key), initiator, currentState, revisionCount, oldAccountId,
        account ? crypto.fingerprint(canonicalAccountIdentifier(account.account)) : null,
        proposed.currency, spec.reason,
        spec.linkedFixture ? emailSampleId(spec.linkedFixture) : null,
        ['CALLBACK_VERIFIED', 'APPROVAL_1', 'APPROVAL_2', 'RELEASED_FOR_ERP_UPDATE'].includes(spec.state)
          ? new Date(now + 60 * DAY)
          : null,
        createdAt, T(2),
      ],
    );

    const revisionRows = [1, ...(revisionCount === 2 ? [2] : [])];
    for (const revision of revisionRows) {
      const revProposed = revision === 2
        ? { ...proposed, beneficiaryName: `${supplier.name} Ltd — Treasury` }
        : proposed;
      const revCanonical = canonicalAccountIdentifier(revProposed.accountIdentifier);
      await client.query(
        `INSERT INTO bank_change_revisions
           (id, tenant_id, change_id, revision, proposed_ciphertext, proposed_fingerprint,
            beneficiary_mask, bank_name, masked_suffix, currency, created_by_user_id, reason, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          seedId(`revision:${spec.key}:${revision}`), t, id, revision,
          JSON.stringify(crypto.encryptBankPayload(JSON.stringify(revProposed), { tenantId: t, supplierId: seedId(supplier.key), revision })),
          crypto.fingerprint(revCanonical), revProposed.beneficiaryName, revProposed.bankName,
          maskAccountSuffix(revProposed.accountIdentifier), revProposed.currency, initiator,
          revision === 2 ? 'Beneficiary corrected after supplier review.' : spec.reason,
          revision === 2 ? T(3) : createdAt,
        ],
      );
    }

    await appendAuditEvent(client, auditKey, {
      tenantId: t, aggregateType: 'bank_change_request', aggregateId: id, aggregateVersion: 1,
      actorUserId: initiator, eventType: 'BANK_CHANGE_CREATED',
      safeMetadata: { supplierName: supplier.name, maskedSuffix, currency: proposed.currency, revision: 1 },
      eventTime: createdAt,
    });
    await appendAuditEvent(client, auditKey, {
      tenantId: t, aggregateType: 'bank_change_request', aggregateId: id, aggregateVersion: 1,
      actorUserId: initiator, eventType: 'BANK_CHANGE_HOLD',
      safeMetadata: { policy: 'MANDATORY_CALLBACK_AND_DUAL_APPROVAL', ruleId: 'BEC-08' },
      eventTime: createdAt,
    });
    await client.query(
      `INSERT INTO outbox_events (id, tenant_id, business_event_id, event_type, redacted_payload, status, delivered_at)
       VALUES ($1,$2,$3,'bank.change.created',$4,'DELIVERED',now()) ON CONFLICT (business_event_id) DO NOTHING`,
      [randomUUID(), t, seedId(`outbox:${spec.key}:created`),
       JSON.stringify({ changeId: id, supplierName: supplier.name, state: 'ON_HOLD', revision: 1, maskedSuffix })],
    );

    if (spec.stateModifiers === 'denied-callback' && spec.verifier) {
      await seedCallback(client, auditKey, spec, 'DENIED', T(7), 1);
      continue;
    }

    if (spec.verifier) {
      await seedCallback(client, auditKey, spec, 'CONFIRMED', T(7), 1);
    }

    if (spec.stateModifiers === 'material-edit') {
      await appendAuditEvent(client, auditKey, {
        tenantId: t, aggregateType: 'bank_change_request', aggregateId: id, aggregateVersion: 2,
        actorUserId: initiator, eventType: 'REVISION_CREATED',
        safeMetadata: { previousRevision: 1, newRevision: 2, voidedEvidence: ['callback', 'approvals'] },
        eventTime: T(3),
      });
      continue; // material edit returns to ON_HOLD; approvals for rev1 remain as history
    }

    if (spec.approvers && spec.verifier) {
      const approvalRevision = 1;
      let sequence = 0;
      for (const approver of spec.approvers) {
        sequence += 1;
        await client.query(
          `INSERT INTO approval_decisions
             (id, tenant_id, change_id, revision, approver_user_id, decision, sequence, note, created_at)
           VALUES ($1,$2,$3,$4,$5,'APPROVE',$6,NULL,$7)`,
          [seedId(`decision:${spec.key}:${sequence}`), t, id, approvalRevision, userId(approver), sequence, T(6)],
        );
        await appendAuditEvent(client, auditKey, {
          tenantId: t, aggregateType: 'bank_change_request', aggregateId: id, aggregateVersion: approvalRevision,
          actorUserId: userId(approver), eventType: 'DECISION_RECORDED',
          safeMetadata: { revision: approvalRevision, decision: 'APPROVE', sequence, state: sequence === 1 ? 'APPROVAL_1' : 'APPROVAL_2' },
          eventTime: T(6),
        });
      }
    }

    if (spec.state === 'RELEASED_FOR_ERP_UPDATE') {
      const releaseRef = seedId(`release:${spec.key}`);
      await client.query(
        `UPDATE bank_change_requests SET released_at=$2, released_by_user_id=$3, release_ref=$4 WHERE id=$1`,
        [id, T(5), userId('atlas-approver1'), releaseRef],
      );
      await appendAuditEvent(client, auditKey, {
        tenantId: t, aggregateType: 'bank_change_request', aggregateId: id, aggregateVersion: 1,
        actorUserId: userId('atlas-approver1'), eventType: 'BANK_CHANGE_RELEASED',
        safeMetadata: { revision: 1, releaseRef, approvals: 2, callbackValid: true },
        eventTime: T(5),
      });
      await client.query(
        `INSERT INTO outbox_events (id, tenant_id, business_event_id, event_type, redacted_payload, status, delivered_at)
         VALUES ($1,$2,$3,'bank.change.release_instruction',$4,'DELIVERED',now()) ON CONFLICT (business_event_id) DO NOTHING`,
        [randomUUID(), t, seedId(`outbox:${spec.key}:release`),
         JSON.stringify({ changeId: id, releaseRef, revision: 1, supplierId: seedId(supplier.key), instruction: 'APPROVED_SUPPLIER_BANK_UPDATE' })],
      );
    }
  }
}

async function seedCallback(
  client: pg.Client,
  auditKey: string,
  spec: SeededChangeSpec,
  result: 'CONFIRMED' | 'DENIED',
  attestedAt: Date,
  revision: number,
): Promise<void> {
  const t = tenantId(spec.tenant);
  const id = changeId(spec.key);
  const contactKey = spec.supplier === 'vulcan-steel' ? 'vulcan-phone'
    : spec.supplier === 'meridian-pack' ? 'meridian-phone'
    : spec.supplier === 'northlight' ? 'northlight-phone'
    : spec.supplier === 'apexchem' ? 'apexchem-phone'
    : spec.supplier === 'beacon-media' ? 'beacon-phone'
    : 'solstice-phone';
  await client.query(
    `INSERT INTO callback_verifications
       (id, tenant_id, change_id, revision, verifier_user_id, approved_contact_id,
        result, method, evidence_ref, notes, attested_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'APPROVED_DIRECTORY_CONTACT',$8,NULL,$9,$10)`,
    [seedId(`callback:${spec.key}`), t, id, revision, userId(spec.verifier!), contactId(contactKey),
     result, `call-log-${spec.key.toLowerCase()}`, attestedAt,
     result === 'CONFIRMED' ? new Date(attestedAt.getTime() + 72 * 3600 * 1000) : attestedAt],
  );
  await appendAuditEvent(client, auditKey, {
    tenantId: t, aggregateType: 'bank_change_request', aggregateId: id, aggregateVersion: revision,
    actorUserId: userId(spec.verifier!), eventType: result === 'CONFIRMED' ? 'CALLBACK_ATTESTED' : 'CALLBACK_DENIED',
    safeMetadata: { revision, contactLabel: SEED.contacts[contactKey]!.label, outcome: result },
    eventTime: attestedAt,
  });
}

main().catch((err) => {
  console.error('seed failed:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
