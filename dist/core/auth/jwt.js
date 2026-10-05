import { createSecretKey } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { authenticationError } from '../errors/http-errors.js';
function getHmacKey(environment) {
    return createSecretKey(Buffer.from(environment.ACCESS_TOKEN_PRIVATE_KEY)).export();
}
export function createAccessTokenService(environment) {
    const signingKey = getHmacKey(environment);
    return {
        async issue(subject, mfaSatisfied = false) {
            return new SignJWT({ typ: 'access', mfa: mfaSatisfied })
                .setProtectedHeader({ alg: 'HS256' })
                .setSubject(subject)
                .setJti(crypto.randomUUID())
                .setIssuedAt()
                .setExpirationTime(`${environment.ACCESS_TOKEN_TTL_SECONDS}s`)
                .sign(signingKey);
        },
        async verify(token) {
            try {
                const { payload } = await jwtVerify(token, signingKey, { algorithms: ['HS256'] });
                if (payload.typ !== 'access' || typeof payload.sub !== 'string') {
                    throw authenticationError('The access token is invalid.');
                }
                return {
                    subject: payload.sub,
                    type: 'access',
                    mfaSatisfied: payload.mfa === true
                };
            }
            catch (error) {
                if (error instanceof Error && error.name === 'AppError') {
                    throw error;
                }
                throw authenticationError('The access token is invalid or expired.');
            }
        }
    };
}
//# sourceMappingURL=jwt.js.map