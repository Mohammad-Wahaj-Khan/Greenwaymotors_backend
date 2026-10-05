import type { Environment } from './env.js';

export function createAppConfig(environment: Environment) {
  return {
    environment: environment.NODE_ENV,
    port: environment.PORT,
    webOrigin: environment.WEB_ORIGIN,
    cookieDomain: environment.COOKIE_DOMAIN,
    logLevel: environment.LOG_LEVEL
  } as const;
}
