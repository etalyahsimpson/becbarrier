/**
 * OpenAPI 3.1 document for the public REST surface, served at
 * GET /api/v1/openapi.json. Kept hand-maintained beside the routes so the
 * documented contract matches the implementation.
 */

export function openApiDocument(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'BECBarrier API',
      version: '1.0.0',
      description:
        'Authoritative REST API for BECBarrier: email-indicator review and governed supplier bank-change verification with mandatory hold, independent callback and dual approval. All business state transitions are executed by this service against PostgreSQL; the Python email-intelligence service is internal and non-authoritative.',
      license: { name: 'All rights reserved' },
    },
    servers: [{ url: '/', description: 'Same-origin via the web tier' }],
    tags: [
      { name: 'auth' },
      { name: 'email-samples' },
      { name: 'alerts' },
      { name: 'cases' },
      { name: 'suppliers' },
      { name: 'bank-changes' },
      { name: 'audit' },
      { name: 'reports' },
      { name: 'system' },
    ],
    components: {
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'bb_session' },
        csrfHeader: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' },
        idempotencyKey: { type: 'apiKey', in: 'header', name: 'Idempotency-Key' },
      },
      schemas: {
        ApiError: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  enum: [
                    'MALFORMED_INPUT', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND_IN_TENANT',
                    'STALE_REVISION', 'IDEMPOTENCY_CONFLICT', 'IDEMPOTENCY_IN_PROGRESS',
                    'PAYLOAD_TOO_LARGE', 'INVALID_TRANSITION', 'VERIFICATION_REQUIRED',
                    'VERIFICATION_HOLD', 'SEPARATION_OF_DUTIES', 'RATE_LIMITED',
                    'TEMPORARILY_UNAVAILABLE', 'EMAIL_ANALYSIS_UNAVAILABLE',
                  ],
                },
                message: { type: 'string' },
              },
              required: ['code', 'message'],
            },
            correlationId: { type: 'string' },
          },
          required: ['error', 'correlationId'],
        },
      },
    },
    paths: {
      '/api/v1/health': {
        get: { tags: ['system'], summary: 'Liveness (no secrets)', responses: { 200: { description: 'OK' } } },
      },
      '/api/v1/ready': {
        get: {
          tags: ['system'],
          summary: 'Readiness — not ready when the database is down',
          responses: { 200: { description: 'Ready' }, 503: { description: 'Database unavailable' } },
        },
      },
      '/api/v1/auth/demo-identities': {
        get: {
          tags: ['auth'],
          summary: 'List demo identities (development/test only)',
          responses: { 200: { description: 'Identities' }, 404: { description: 'Not available in production' } },
        },
      },
      '/api/v1/auth/demo-login': {
        post: {
          tags: ['auth'],
          summary: 'Sign in as a seeded demo identity (development/test only)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['userId', 'tenantId'],
                  properties: { userId: { type: 'string', format: 'uuid' }, tenantId: { type: 'string', format: 'uuid' } },
                },
                examples: {
                  login: { value: { userId: '00000000-0000-0000-0000-000000000001', tenantId: '00000000-0000-0000-0000-0000000000a1' } },
                },
              },
            },
          },
          responses: { 200: { description: 'Session issued (Set-Cookie)' }, 401: { description: 'Identity not found' } },
        },
      },
      '/api/v1/auth/logout': { post: { tags: ['auth'], summary: 'Clear session', responses: { 200: { description: 'OK' } } } },
      '/api/v1/auth/me': { get: { tags: ['auth'], summary: 'Current actor', responses: { 200: { description: 'Actor' } } } },
      '/api/v1/email-samples': {
        post: {
          tags: ['email-samples'],
          summary: 'Upload one .eml (≤ 2 MiB) for bounded analysis; findings and alerts are persisted',
          description:
            'Raw body with Content-Type message/rfc822, or JSON {"contentBase64": "..."}. Provenance is always RAW_UPLOAD for API uploads — claimed SPF/DKIM/DMARC results are never treated as verified.',
          security: [{ sessionCookie: [], csrfHeader: [] }],
          requestBody: {
            required: true,
            content: {
              'message/rfc822': { schema: { type: 'string', format: 'binary' } },
              'application/json': {
                schema: { type: 'object', required: ['contentBase64'], properties: { contentBase64: { type: 'string' } } },
              },
            },
          },
          responses: {
            201: { description: 'Sample analyzed and persisted' },
            200: { description: 'Content digest already present — replayed' },
            413: { description: 'Payload too large', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          },
        },
        get: { tags: ['email-samples'], summary: 'List tenant-scoped samples', security: [{ sessionCookie: [] }], responses: { 200: { description: 'List' } } },
      },
      '/api/v1/email-samples/{id}': {
        get: { tags: ['email-samples'], summary: 'Sample with normalized fields and findings', security: [{ sessionCookie: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Sample' }, 404: { description: 'Not found in tenant' } } },
      },
      '/api/v1/alerts': {
        get: { tags: ['alerts'], summary: 'Tenant-scoped, filterable, paginated alerts', security: [{ sessionCookie: [] }], responses: { 200: { description: 'List' } } },
      },
      '/api/v1/cases/{id}': {
        get: { tags: ['cases'], summary: 'Case with event timeline and links', security: [{ sessionCookie: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Case' } } },
      },
      '/api/v1/cases/{id}/events': {
        post: {
          tags: ['cases'],
          summary: 'Analyst assignment/comment/disposition with version precondition',
          security: [{ sessionCookie: [], csrfHeader: [], idempotencyKey: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['action', 'text', 'expectedVersion'],
                  properties: {
                    action: { type: 'string', enum: ['COMMENT', 'ASSIGN', 'DISPOSITION', 'LINK'] },
                    text: { type: 'string', maxLength: 1000 },
                    expectedVersion: { type: 'integer', minimum: 1 },
                    assigneeId: { type: 'string', format: 'uuid' },
                  },
                },
                examples: {
                  comment: { value: { action: 'COMMENT', text: 'Called supplier via approved contact; no change requested.', expectedVersion: 1 } },
                },
              },
            },
          },
          responses: { 201: { description: 'Event appended' }, 409: { description: 'Stale version' } },
        },
      },
      '/api/v1/suppliers': {
        get: { tags: ['suppliers'], summary: 'Supplier directory summary', security: [{ sessionCookie: [] }], responses: { 200: { description: 'List' } } },
      },
      '/api/v1/suppliers/{id}': {
        get: { tags: ['suppliers'], summary: 'Approved domains/contacts and masked payment references', security: [{ sessionCookie: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Supplier' } } },
      },
      '/api/v1/suppliers/{id}/bank-changes': {
        post: {
          tags: ['bank-changes'],
          summary: 'Create a bank-change request → mandatory ON_HOLD revision 1',
          security: [{ sessionCookie: [], csrfHeader: [], idempotencyKey: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['proposed', 'reason'],
                  properties: {
                    proposed: {
                      type: 'object',
                      required: ['accountIdentifier', 'beneficiaryName', 'bankName', 'currency'],
                      properties: {
                        accountIdentifier: { type: 'string', minLength: 6, maxLength: 42 },
                        beneficiaryName: { type: 'string' },
                        bankName: { type: 'string' },
                        currency: { type: 'string', pattern: '^[A-Z]{3}$' },
                      },
                    },
                    reason: { type: 'string', minLength: 4, maxLength: 500 },
                    linkedEmailSampleId: { type: 'string', format: 'uuid' },
                  },
                },
                examples: {
                  create: {
                    value: {
                      proposed: { accountIdentifier: 'GB00SYNT000045678123', beneficiaryName: 'Vulcan Steel Supplies Ltd', bankName: 'Example Trust Bank', currency: 'GBP' },
                      reason: 'Supplier emailed new remittance details; pending independent verification.',
                    },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Created — state ON_HOLD, revision 1' },
            403: { description: 'Role not permitted', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' }, examples: { denial: { value: { error: { code: 'FORBIDDEN', message: 'Role SECURITY_ANALYST is not permitted to perform this action.' }, correlationId: 'c-1' } } } } } },
          },
        },
      },
      '/api/v1/bank-changes/{id}': {
        get: { tags: ['bank-changes'], summary: 'Scoped state, masked before/after, callback, decisions, revisions, audit timeline', security: [{ sessionCookie: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Change detail' }, 404: { description: 'Not found in tenant' } } },
      },
      '/api/v1/bank-changes/{id}/verify': {
        post: {
          tags: ['bank-changes'],
          summary: 'Independent callback attestation against an approved directory contact',
          security: [{ sessionCookie: [], csrfHeader: [], idempotencyKey: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['revision', 'approvedContactId', 'result', 'method', 'evidenceRef'],
                  properties: {
                    revision: { type: 'integer', minimum: 1 },
                    approvedContactId: { type: 'string', format: 'uuid' },
                    result: { type: 'string', enum: ['CONFIRMED', 'DENIED', 'UNREACHABLE'] },
                    method: { type: 'string', enum: ['APPROVED_DIRECTORY_CONTACT'] },
                    evidenceRef: { type: 'string' },
                    notes: { type: 'string' },
                  },
                },
                examples: {
                  confirmed: { value: { revision: 1, approvedContactId: '00000000-0000-0000-0000-0000000000c1', result: 'CONFIRMED', method: 'APPROVED_DIRECTORY_CONTACT', evidenceRef: 'call-log-2026-11-21-001' } },
                },
              },
            },
          },
          responses: {
            200: { description: 'Attestation recorded; state CALLBACK_VERIFIED or REJECTED' },
            422: { description: 'Contact not established before request (invariant 3)' },
          },
        },
      },
      '/api/v1/bank-changes/{id}/decisions': {
        post: {
          tags: ['bank-changes'],
          summary: 'Distinct approval or rejection for the exact revision',
          security: [{ sessionCookie: [], csrfHeader: [], idempotencyKey: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['revision', 'decision'],
                  properties: { revision: { type: 'integer', minimum: 1 }, decision: { type: 'string', enum: ['APPROVE', 'REJECT'] }, note: { type: 'string' } },
                },
                examples: {
                  approve: { value: { revision: 1, decision: 'APPROVE' } },
                },
              },
            },
          },
          responses: {
            200: { description: 'Decision recorded', content: { 'application/json': { examples: { success: { value: { changeId: 'c-200', revision: 1, state: 'APPROVAL_1', approvalCount: 1, releaseEligible: false } } } } } },
            403: { description: 'Separation of duties violation', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' }, examples: { denial: { value: { error: { code: 'SEPARATION_OF_DUTIES', message: 'Actor cannot approve this change: SELF_APPROVAL_FORBIDDEN' }, correlationId: 'c-2' } } } } } },
            423: { description: 'Callback verification expired (hold preserved)' },
          },
        },
      },
      '/api/v1/bank-changes/{id}/release': {
        post: {
          tags: ['bank-changes'],
          summary: 'Release-for-ERP-instruction only (no funds move)',
          security: [{ sessionCookie: [], csrfHeader: [], idempotencyKey: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['revision'], properties: { revision: { type: 'integer', minimum: 1 } } } } },
          },
          responses: { 200: { description: 'RELEASED_FOR_ERP_UPDATE with releaseRef' }, 422: { description: 'Not eligible' }, 423: { description: 'Verification hold' } },
        },
      },
      '/api/v1/bank-changes/{id}/erp-ack': {
        post: {
          tags: ['bank-changes'],
          summary: 'Authenticated ERP acknowledgment (contract demonstration only)',
          description: 'Requires the X-ERP-Ack adapter secret. Demonstrates the exact-revision acknowledgment contract; BECBarrier never applies supplier-master updates or moves funds.',
          security: [{ sessionCookie: [], csrfHeader: [], idempotencyKey: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'X-ERP-Ack', in: 'header', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['releaseRef', 'revision', 'externalReceipt'],
                  properties: { releaseRef: { type: 'string', format: 'uuid' }, revision: { type: 'integer', minimum: 1 }, externalReceipt: { type: 'string' } },
                },
              },
            },
          },
          responses: { 200: { description: 'ERP_APPLIED recorded' }, 401: { description: 'Adapter authentication failed' } },
        },
      },
      '/api/v1/bank-changes/{id}/revisions': {
        post: {
          tags: ['bank-changes'],
          summary: 'Material edit → new immutable revision; prior callback/approvals void',
          security: [{ sessionCookie: [], csrfHeader: [], idempotencyKey: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['expectedRevision', 'proposed', 'reason'],
                  properties: {
                    expectedRevision: { type: 'integer', minimum: 1 },
                    proposed: { type: 'object' },
                    reason: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { 201: { description: 'New revision; state ON_HOLD' }, 409: { description: 'Stale revision' } },
        },
      },
      '/api/v1/bank-changes/{id}/cancel': {
        post: {
          tags: ['bank-changes'],
          summary: 'Cancel a pending change (initiator or admin)',
          security: [{ sessionCookie: [], csrfHeader: [], idempotencyKey: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: { description: 'CANCELLED' }, 422: { description: 'Terminal state' } },
        },
      },
      '/api/v1/audit-events': {
        get: { tags: ['audit'], summary: 'Tenant-scoped redacted audit history (auditor/admin)', security: [{ sessionCookie: [] }], responses: { 200: { description: 'List' }, 403: { description: 'Not permitted' } } },
      },
      '/api/v1/reports/summary': {
        get: {
          tags: ['reports'],
          summary: 'Persisted case/hold statistics; ?format=csv for redacted export (auditor/admin)',
          security: [{ sessionCookie: [] }],
          responses: { 200: { description: 'Summary' } },
        },
      },
      '/api/v1/realtime/summary': {
        get: { tags: ['system'], summary: 'Polling fallback for realtime counts', security: [{ sessionCookie: [] }], responses: { 200: { description: 'Counts' } } },
      },
    },
  };
}
