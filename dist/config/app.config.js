export function createAppConfig(environment) {
    return {
        environment: environment.NODE_ENV,
        port: environment.PORT,
        webOrigin: environment.WEB_ORIGIN,
        cookieDomain: environment.COOKIE_DOMAIN,
        logLevel: environment.LOG_LEVEL
    };
}
//# sourceMappingURL=app.config.js.map