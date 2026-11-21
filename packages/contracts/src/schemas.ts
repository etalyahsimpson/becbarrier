import { z } from 'zod';
import {
  CALLBACK_RESULTS,
  CASE_STATUSES,
  CHANGE_STATES,
  DECISIONS,
  PROVENANCE_GRADES,
  RULE_OUTCOMES,
  SEVERITIES,
} from './enums.js';

/** ---------- common primitives ---------- */

export const uuidSchema = z.string().uuid();
export const cursorSchema = z.string().max(256).regex(/^[A-Za-z0-9._:-]{1,256}$/);
export const positiveInt = z.coerce.number().int().positive();
export const boundedLimit = positiveInt.max(100).default(25);

/** ---------- structured error envelope ---------- */

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
  correlationId: z.string(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** ---------- email intelligence (mirrors the Python Pydantic contract) ---------- */

export const ruleFindingSchema = z.object({
  ruleId: z.string(),
  version: z.string(),
  outcome: z.enum(RULE_OUTCOMES),
  severity: z.enum(SEVERITIES),
  provenance: z.enum(PROVENANCE_GRADES),
  explanation: z.string(),
  evidenceField: z.string().nullable().optional(),
  maskedExcerpt: z.string().nullable().optional(),
});
export type RuleFinding = z.infer<typeof ruleFindingSchema>;

export const emailAnalysisResponseSchema = z.object({
  digest: z.string().length(64),
  parseStatus: z.enum(['OK', 'MALFORMED', 'REJECTED_OVERSIZE', 'UNKNOWN']),
  provenance: z.enum(PROVENANCE_GRADES),
  ruleVersion: z.string(),
  normalized: z.unknown(),
  findings: z.array(ruleFindingSchema),
  score: z.number().int().min(0).max(100),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'NONE']).nullable(),
  unknownCount: z.number().int().min(0),
});
export type EmailAnalysisResponse = z.infer<typeof emailAnalysisResponseSchema>;

/** ---------- bank-change workflow DTOs ---------- */

/** Proposed bank fields — the plaintext exists only in memory and encrypted columns. */
export const proposedBankFieldsSchema = z.object({
  accountIdentifier: z.string().min(6).max(42),
  beneficiaryName: z.string().min(2).max(140),
  bankName: z.string().min(2).max(140),
  currency: z.string().length(3).regex(/^[A-Z]{3}$/),
});
export type ProposedBankFields = z.infer<typeof proposedBankFieldsSchema>;

export const createBankChangeSchema = z.object({
  supplierId: uuidSchema,
  proposed: proposedBankFieldsSchema,
  linkedEmailSampleId: uuidSchema.optional(),
  reason: z.string().min(4).max(500),
});
export type CreateBankChangeInput = z.infer<typeof createBankChangeSchema>;

export const verifyCallbackSchema = z.object({
  revision: positiveInt,
  approvedContactId: uuidSchema,
  result: z.enum(CALLBACK_RESULTS),
  method: z.literal('APPROVED_DIRECTORY_CONTACT'),
  evidenceRef: z.string().min(4).max(200),
  notes: z.string().max(500).optional(),
});
export type VerifyCallbackInput = z.infer<typeof verifyCallbackSchema>;

export const decisionSchema = z.object({
  revision: positiveInt,
  decision: z.enum(DECISIONS),
  note: z.string().max(500).optional(),
});
export type DecisionInput = z.infer<typeof decisionSchema>;

export const releaseSchema = z.object({
  revision: positiveInt,
});
export type ReleaseInput = z.infer<typeof releaseSchema>;

export const erpAckSchema = z.object({
  releaseRef: uuidSchema,
  revision: positiveInt,
  externalReceipt: z.string().min(4).max(200),
});
export type ErpAckInput = z.infer<typeof erpAckSchema>;

export const materialEditSchema = z.object({
  expectedRevision: positiveInt,
  proposed: proposedBankFieldsSchema,
  reason: z.string().min(4).max(500),
});
export type MaterialEditInput = z.infer<typeof materialEditSchema>;

/** ---------- cases ---------- */

export const caseEventSchema = z.object({
  action: z.enum(['COMMENT', 'ASSIGN', 'DISPOSITION', 'LINK']),
  text: z.string().min(1).max(1000),
  expectedVersion: positiveInt,
  assigneeId: uuidSchema.optional(),
});
export type CaseEventInput = z.infer<typeof caseEventSchema>;

/** ---------- generic list responses ---------- */

export function paginatedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    total: z.number().int().min(0).optional(),
  });
}

/** ---------- view models returned by the API ---------- */

export const bankChangeViewSchema = z.object({
  id: uuidSchema,
  supplierId: uuidSchema,
  supplierName: z.string(),
  state: z.enum(CHANGE_STATES),
  revision: z.number().int().positive(),
  currency: z.string(),
  proposedMasked: z.object({
    accountSuffix: z.string(),
    beneficiaryName: z.string(),
    bankName: z.string(),
  }),
  previousMasked: z
    .object({
      accountSuffix: z.string(),
      beneficiaryName: z.string(),
      bankName: z.string(),
    })
    .nullable(),
  callback: z
    .object({
      result: z.enum(CALLBACK_RESULTS),
      verifiedByUserName: z.string(),
      verifiedAt: z.string(),
      expiresAt: z.string(),
      contactRef: z.string(),
      revision: z.number().int(),
    })
    .nullable(),
  approvals: z.array(
    z.object({
      sequence: z.number().int(),
      decision: z.enum(DECISIONS),
      approverUserName: z.string(),
      decidedAt: z.string(),
    }),
  ),
  initiatorUserName: z.string(),
  callbackExpiresAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  releasedAt: z.string().nullable(),
  erpAppliedAt: z.string().nullable(),
});
export type BankChangeView = z.infer<typeof bankChangeViewSchema>;

export const caseViewSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  status: z.enum(CASE_STATUSES),
  priority: z.string().nullable(),
  assigneeUserName: z.string().nullable(),
  linkedChangeId: uuidSchema.nullable(),
  linkedEmailSampleId: uuidSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CaseView = z.infer<typeof caseViewSchema>;
