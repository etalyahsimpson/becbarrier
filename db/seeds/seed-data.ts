/**
 * Deterministic synthetic seed keys shared by the seed script, integration
 * test runners and documentation. IDs are UUIDv5-derived so every consumer
 * resolves the same identifier without coordinating.
 *
 * All entities are invented: reserved .example domains, 555-range phone
 * numbers, invalid-check-digit synthetic account identifiers.
 */
import { uuidV5 } from '@becbarrier/security';

export const SEED = {
  tenants: {
    atlas: { key: 'tenant:atlas', slug: 'atlas-mfg', name: 'Atlas Precision Manufacturing' },
    cascade: { key: 'tenant:cascade', slug: 'cascade-retail', name: 'Cascade Retail Group' },
  },
  users: {
    'atlas-initiator': { key: 'user:atlas-initiator', email: 'avery.initiator@atlas-mfg.example', name: 'Avery Chen', role: 'FINANCE_INITIATOR' },
    'atlas-verifier': { key: 'user:atlas-verifier', email: 'blake.ortiz@atlas-mfg.example', name: 'Blake Ortiz', role: 'SUPPLIER_VERIFIER' },
    'atlas-approver1': { key: 'user:atlas-approver1', email: 'casey.nakamura@atlas-mfg.example', name: 'Casey Nakamura', role: 'FINANCE_APPROVER' },
    'atlas-approver2': { key: 'user:atlas-approver2', email: 'drew.whitfield@atlas-mfg.example', name: 'Drew Whitfield', role: 'FINANCE_APPROVER' },
    'atlas-analyst': { key: 'user:atlas-analyst', email: 'ellis.marsh@atlas-mfg.example', name: 'Ellis Marsh', role: 'SECURITY_ANALYST' },
    'atlas-auditor': { key: 'user:atlas-auditor', email: 'finn.alaric@atlas-mfg.example', name: 'Finn Alaric', role: 'AUDITOR' },
    'atlas-admin': { key: 'user:atlas-admin', email: 'gale.summers@atlas-mfg.example', name: 'Gale Summers', role: 'TENANT_ADMIN' },
    'cascade-initiator': { key: 'user:cascade-initiator', email: 'harper.lee@cascade-retail.example', name: 'Harper Lee', role: 'FINANCE_INITIATOR' },
    'cascade-verifier': { key: 'user:cascade-verifier', email: 'indigo.vasquez@cascade-retail.example', name: 'Indigo Vasquez', role: 'SUPPLIER_VERIFIER' },
    'cascade-approver1': { key: 'user:cascade-approver1', email: 'jordan.pike@cascade-retail.example', name: 'Jordan Pike', role: 'FINANCE_APPROVER' },
    'cascade-approver2': { key: 'user:cascade-approver2', email: 'kai.brennan@cascade-retail.example', name: 'Kai Brennan', role: 'FINANCE_APPROVER' },
    'cascade-analyst': { key: 'user:cascade-analyst', email: 'logan.firth@cascade-retail.example', name: 'Logan Firth', role: 'SECURITY_ANALYST' },
    'cascade-auditor': { key: 'user:cascade-auditor', email: 'morgan.adeyemi@cascade-retail.example', name: 'Morgan Adeyemi', role: 'AUDITOR' },
    'cascade-admin': { key: 'user:cascade-admin', email: 'noel.castellano@cascade-retail.example', name: 'Noel Castellano', role: 'TENANT_ADMIN' },
    'cross-auditor': { key: 'user:cross-auditor', email: 'dana.kross@audit-partners.example', name: 'Dana Kross', role: 'AUDITOR' },
  } as Record<string, { key: string; email: string; name: string; role: string }>,
  suppliers: {
    'vulcan-steel': { key: 'supplier:vulcan-steel', name: 'Vulcan Steel Supplies', domains: ['vulcan-steel.example'] },
    'meridian-pack': { key: 'supplier:meridian-pack', name: 'Meridian Packaging Co', domains: ['meridian-pack.example'] },
    'northlight': { key: 'supplier:northlight', name: 'Northlight Logistics', domains: ['northlight.example', 'northlight-logistics.example'] },
    'apexchem': { key: 'supplier:apexchem', name: 'Apex Industrial Chemicals', domains: ['apexchem.example'] },
    'granite-tools': { key: 'supplier:granite-tools', name: 'Granite Tooling Co', domains: ['granite-tools.example'] },
    'beacon-media': { key: 'supplier:beacon-media', name: 'Beacon Media Services', domains: ['beacon-media.example'] },
    'solstice-textiles': { key: 'supplier:solstice-textiles', name: 'Solstice Textiles', domains: ['solstice-textiles.example'] },
  } as Record<string, { key: string; name: string; domains: string[] }>,
  contacts: {
    'vulcan-phone': { key: 'contact:vulcan-phone', supplier: 'vulcan-steel', channel: 'PHONE', value: '+15550142', label: 'Vulcan accounts payable line' },
    'vulcan-alt-phone': { key: 'contact:vulcan-alt-phone', supplier: 'vulcan-steel', channel: 'PHONE', value: '+15550143', label: 'Vulcan treasury (alternate)' },
    'vulcan-email': { key: 'contact:vulcan-email', supplier: 'vulcan-steel', channel: 'EMAIL', value: 'accounts@vulcan-steel.example', label: 'Vulcan accounts mailbox' },
    'meridian-phone': { key: 'contact:meridian-phone', supplier: 'meridian-pack', channel: 'PHONE', value: '+15550152', label: 'Meridian billing desk' },
    'northlight-phone': { key: 'contact:northlight-phone', supplier: 'northlight', channel: 'PHONE', value: '+15550162', label: 'Northlight control tower' },
    'apexchem-phone': { key: 'contact:apexchem-phone', supplier: 'apexchem', channel: 'PHONE', value: '+15550172', label: 'Apex finance line' },
    'beacon-phone': { key: 'contact:beacon-phone', supplier: 'beacon-media', channel: 'PHONE', value: '+15550182', label: 'Beacon billing line' },
    'solstice-phone': { key: 'contact:solstice-phone', supplier: 'solstice-textiles', channel: 'PHONE', value: '+15550192', label: 'Solstice accounts line' },
  } as Record<string, { key: string; supplier: string; channel: string; value: string; label: string }>,
} as const;

export function seedId(key: string): string {
  return uuidV5(key);
}

export function userId(actor: string): string {
  return seedId(SEED.users[actor]!.key);
}

export function tenantId(tenant: 'atlas' | 'cascade'): string {
  return seedId(SEED.tenants[tenant]!.key);
}

export function supplierId(supplier: string): string {
  return seedId(SEED.suppliers[supplier]!.key);
}

export function contactId(contact: string): string {
  return seedId(SEED.contacts[contact]!.key);
}

export function changeId(changeKey: string): string {
  return seedId(`change:${changeKey}`);
}

export function emailSampleId(fixtureId: string): string {
  return seedId(`email-sample:${fixtureId}`);
}

/** Synthetic payment accounts (invalid check digits — cannot be real IBANs). */
export const SEED_ACCOUNTS: Record<string, { supplier: string; account: string; beneficiary: string; bank: string; currency: string }> = {
  'vulcan-steel': { supplier: 'vulcan-steel', account: 'GB00SYNT000033445566', beneficiary: 'Vulcan Steel Supplies Ltd', bank: 'Example Trust Bank', currency: 'GBP' },
  'meridian-pack': { supplier: 'meridian-pack', account: 'GB00SYNT000044556677', beneficiary: 'Meridian Packaging Co', bank: 'Example Commerce Bank', currency: 'GBP' },
  'northlight': { supplier: 'northlight', account: 'GB00SYNT000055667788', beneficiary: 'Northlight Logistics Ltd', bank: 'Example Freight Bank', currency: 'EUR' },
  'apexchem': { supplier: 'apexchem', account: 'GB00SYNT000066778899', beneficiary: 'Apex Industrial Chemicals plc', bank: 'Example Industrial Bank', currency: 'USD' },
  'beacon-media': { supplier: 'beacon-media', account: 'GB00SYNT000077889900', beneficiary: 'Beacon Media Services Ltd', bank: 'Example Media Bank', currency: 'GBP' },
  'solstice-textiles': { supplier: 'solstice-textiles', account: 'GB00SYNT000088990011', beneficiary: 'Solstice Textiles BV', bank: 'Example Trade Bank', currency: 'EUR' },
};
