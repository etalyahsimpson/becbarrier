import { z } from 'zod';
import { ROLES } from './enums.js';

/** Session identity resolved server-side from the signed session cookie. */
export const sessionActorSchema = z.object({
  userId: z.string().uuid(),
  userName: z.string(),
  tenantId: z.string().uuid(),
  tenantSlug: z.string(),
  role: z.enum(ROLES),
  sessionId: z.string(),
  expiresAt: z.number(),
});
export type SessionActor = z.infer<typeof sessionActorSchema>;

/** Public identity list served by the strictly development-only demo adapter. */
export const demoIdentitySchema = z.object({
  userId: z.string().uuid(),
  userName: z.string(),
  email: z.string(),
  tenantId: z.string().uuid(),
  tenantName: z.string(),
  tenantSlug: z.string(),
  role: z.enum(ROLES),
});
export type DemoIdentity = z.infer<typeof demoIdentitySchema>;
