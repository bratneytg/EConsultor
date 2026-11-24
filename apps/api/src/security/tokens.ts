import { SignJWT, jwtVerify } from 'jose';

const ISS = 'econsultor';

export const ACCESS_TTL_S = 10 * 60;
export const MFA_TTL_S = 5 * 60;

export interface AccessClaims {
  sub: string;
  sid: string;
}

export async function signAccess(secret: Uint8Array, claims: AccessClaims): Promise<string> {
  return new SignJWT({ sid: claims.sid, purpose: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(ISS)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_S}s`)
    .sign(secret);
}

export async function verifyAccess(secret: Uint8Array, token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISS, algorithms: ['HS256'] });
    if (payload.purpose !== 'access' || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
    return { sub: payload.sub, sid: payload.sid };
  } catch {
    return null;
  }
}

/** Token intermedio tras validar la contraseña cuando el usuario tiene MFA. Solo sirve para /auth/mfa/verify. */
export async function signMfa(secret: Uint8Array, userId: string): Promise<string> {
  return new SignJWT({ purpose: 'mfa' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISS)
    .setIssuedAt()
    .setExpirationTime(`${MFA_TTL_S}s`)
    .sign(secret);
}

export async function verifyMfa(secret: Uint8Array, token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISS, algorithms: ['HS256'] });
    return payload.purpose === 'mfa' && typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
