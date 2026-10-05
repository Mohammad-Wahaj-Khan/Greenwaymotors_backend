import { forbiddenError } from '../../core/errors/http-errors.js';
const refreshCookieName = 'greenway_refresh_token';
function sessionCookieOptions(environment) {
    return {
        httpOnly: true,
        secure: environment.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/auth',
        ...(environment.NODE_ENV === 'production' ? { domain: environment.COOKIE_DOMAIN } : {}),
        maxAge: environment.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
    };
}
function requestMetadata(request) {
    const userAgent = request.get('user-agent');
    return { ...(request.ip ? { ip: request.ip } : {}), ...(userAgent ? { userAgent } : {}) };
}
function requireTrustedOrigin(request, environment) {
    const origin = request.get('origin');
    const referer = request.get('referer');
    if (origin === environment.WEB_ORIGIN ||
        (origin === undefined && referer?.startsWith(`${environment.WEB_ORIGIN}/`))) {
        return;
    }
    throw forbiddenError('This cookie-authenticated request must originate from the configured web application.');
}
function readRefreshCookie(request) {
    const cookies = request.cookies;
    if (typeof cookies !== 'object' || cookies === null || !(refreshCookieName in cookies)) {
        return undefined;
    }
    const token = cookies[refreshCookieName];
    return typeof token === 'string' ? token : undefined;
}
function deliver(request, task, message) {
    void task.catch((error) => request.log.error({ err: error }, message));
}
export function createAuthController(service, email, environment) {
    const register = async (request, response) => {
        const result = await service.registerCustomer(request.body);
        deliver(request, email.sendVerificationEmail({ email: result.user.email, token: result.verificationToken }), 'verification email delivery failed');
        response.status(201).json({ data: result.user });
    };
    const login = async (request, response) => {
        const session = await service.login(request.body, requestMetadata(request));
        response.cookie(refreshCookieName, session.refreshToken, sessionCookieOptions(environment));
        response.json({ data: { accessToken: session.accessToken, user: session.user } });
    };
    const refresh = async (request, response) => {
        requireTrustedOrigin(request, environment);
        const token = readRefreshCookie(request);
        if (!token) {
            throw forbiddenError('A refresh session is required.');
        }
        const session = await service.refresh(token, requestMetadata(request));
        response.cookie(refreshCookieName, session.refreshToken, sessionCookieOptions(environment));
        response.json({ data: { accessToken: session.accessToken, user: session.user } });
    };
    const logout = async (request, response) => {
        requireTrustedOrigin(request, environment);
        await service.logout(readRefreshCookie(request));
        response.clearCookie(refreshCookieName, sessionCookieOptions(environment));
        response.json({ data: { loggedOut: true } });
    };
    const logoutAll = async (request, response) => {
        await service.logoutAll(request.auth.user.id);
        response.clearCookie(refreshCookieName, sessionCookieOptions(environment));
        response.json({ data: { loggedOut: true } });
    };
    const requestVerification = async (request, response) => {
        const record = await service.requestOneTimeToken(request.body.email, 'email_verification');
        if (record) {
            deliver(request, email.sendVerificationEmail(record), 'verification email delivery failed');
        }
        response.json({
            data: { message: 'If an eligible account exists, a verification email will be sent.' }
        });
    };
    const confirmVerification = async (request, response) => {
        await service.confirmEmailVerification(request.body.token);
        response.json({ data: { verified: true } });
    };
    const forgotPassword = async (request, response) => {
        const record = await service.requestOneTimeToken(request.body.email, 'password_reset');
        if (record) {
            deliver(request, email.sendPasswordResetEmail(record), 'password reset email delivery failed');
        }
        response.json({
            data: { message: 'If an eligible account exists, a password reset email will be sent.' }
        });
    };
    const resetPassword = async (request, response) => {
        const input = request.body;
        await service.resetPassword(input.token, input.newPassword);
        response.json({ data: { passwordReset: true } });
    };
    const me = (request, response) => {
        response.json({ data: request.auth.user });
    };
    const updateMe = async (request, response) => {
        const user = await service.updateProfile(request.auth.user.id, request.body);
        response.json({ data: user });
    };
    return {
        register,
        login,
        refresh,
        logout,
        logoutAll,
        requestVerification,
        confirmVerification,
        forgotPassword,
        resetPassword,
        me,
        updateMe
    };
}
//# sourceMappingURL=auth.controller.js.map