import { createSecretKey } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Environment } from '../../config/env.js';
import { authenticationError } from '../errors/http-errors.js';

export interface AccessTokenClaims {
  sessionId: string;
  subject: string;
  type: 'access';
  mfaSatisfied: boolean;
}

function getHmacKey(environment: Environment): Uint8Array {
  return createSecretKey(Buffer.from(environment.ACCESS_TOKEN_PRIVATE_KEY)).export();
}

export function createAccessTokenService(environment: Environment) {
  const signingKey = getHmacKey(environment);

  return {
    async issue(subject: string, sessionId: string, mfaSatisfied = false): Promise<string> {
      return new SignJWT({ typ: 'access', mfa: mfaSatisfied, sid: sessionId })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(subject)
        .setJti(crypto.randomUUID())
        .setIssuedAt()
        .setExpirationTime(`${environment.ACCESS_TOKEN_TTL_SECONDS}s`)
        .sign(signingKey);
    },
    async verify(token: string): Promise<AccessTokenClaims> {
      try {
        const { payload } = await jwtVerify(token, signingKey, { algorithms: ['HS256'] });
        if (
          payload.typ !== 'access' ||
          typeof payload.sub !== 'string' ||
          typeof payload.sid !== 'string'
        ) {
          throw authenticationError('The access token is invalid.');
        }

        return {
          sessionId: payload.sid,
          subject: payload.sub,
          type: 'access',
          mfaSatisfied: payload.mfa === true
        };
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AppError') {
          throw error;
        }
        throw authenticationError('The access token is invalid or expired.');
      }
    }
  } as const;
}
