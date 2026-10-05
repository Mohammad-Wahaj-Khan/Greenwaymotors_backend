export function createAuthConfig(environment) {
    return {
        accessTokenPrivateKey: environment.ACCESS_TOKEN_PRIVATE_KEY,
        accessTokenPublicKey: environment.ACCESS_TOKEN_PUBLIC_KEY,
        accessTokenTtlSeconds: environment.ACCESS_TOKEN_TTL_SECONDS,
        refreshTokenTtlDays: environment.REFRESH_TOKEN_TTL_DAYS
    };
}
//# sourceMappingURL=auth.config.js.map