import { createHash } from 'node:crypto';

/** Deterministic UUIDv5 so synthetic seed data has stable, reproducible IDs. */
const NAMESPACE_UUID = Buffer.from('7ec1f9ea3b1a4c0d9f2e6a8b5c4d3e2f10a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5', 'hex');

export function uuidV5(name: string, namespace: Buffer = NAMESPACE_UUID): string {
  const hash = createHash('sha1').update(Buffer.concat([namespace, Buffer.from(name, 'utf8')])).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = hash.toString('hex', 0, 16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** SHA-256 request digest for idempotency records. */
export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
