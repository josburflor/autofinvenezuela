import crypto from 'node:crypto';

const revokedSessionIds = new Set<string>();

function getSigningSecret(): Buffer {
  const rawSecret =
    process.env.ADMIN_AUTH_SECRET ||
    process.env.DATABASE_URL ||
    process.env.CLOUD_SQL_PASSWORD ||
    'autofin-venezuela-crm-admin-secret-2026';
  return crypto.createHash('sha256').update(rawSecret).digest();
}

export function hashAdminPassword(plainPassword: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(plainPassword, salt, 64).toString('hex');
  return `scrypt$${salt}$${derivedKey}`;
}

export function verifyAdminPassword(plainPassword: string, storedHash: string | null): boolean {
  if (!storedHash || !storedHash.startsWith('scrypt$')) {
    return false;
  }
  const parts = storedHash.split('$');
  if (parts.length !== 3) return false;

  const [, salt, hashHex] = parts;
  const expectedBuf = Buffer.from(hashHex, 'hex');
  const candidateBuf = crypto.scryptSync(plainPassword, salt, 64);

  if (expectedBuf.length !== candidateBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, candidateBuf);
}

export interface SignedAdminClaims {
  uid: string;
  email: string;
  role: string;
  jti: string;
  exp: number;
}

export function issueAdminSessionToken(user: {
  uid: string;
  email: string;
  role: string;
}): string {
  const claims: SignedAdminClaims = {
    uid: user.uid,
    email: user.email,
    role: user.role,
    jti: crypto.randomUUID(),
    exp: Date.now() + 12 * 60 * 60 * 1000, // 12 horas
  };

  const payloadB64 = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const signatureB64 = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payloadB64)
    .digest('base64url');

  return `autofin_adm.${payloadB64}.${signatureB64}`;
}

export function verifyAdminSessionToken(token: string): SignedAdminClaims | null {
  if (!token.startsWith('autofin_adm.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [, payloadB64, signatureB64] = parts;
  const expectedSigB64 = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payloadB64)
    .digest('base64url');

  const sigBuf = Buffer.from(signatureB64, 'utf8');
  const expectedBuf = Buffer.from(expectedSigB64, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8')
    ) as SignedAdminClaims;

    if (!decoded.uid || !decoded.jti || !decoded.exp) return null;
    if (Date.now() > decoded.exp) return null;
    if (revokedSessionIds.has(decoded.jti)) return null;

    return decoded;
  } catch {
    return null;
  }
}

export function revokeAdminSessionToken(token: string): void {
  const claims = verifyAdminSessionToken(token);
  if (claims?.jti) {
    revokedSessionIds.add(claims.jti);
  }
}
