import nodemailer from 'nodemailer';
export function createEmailService(environment) {
    const transporter = nodemailer.createTransport({
        host: environment.SMTP_HOST,
        port: environment.SMTP_PORT,
        secure: false
    });
    async function send(email, subject, path, token) {
        const link = new URL(path, environment.WEB_ORIGIN);
        link.searchParams.set('token', token);
        await transporter.sendMail({
            from: environment.MAIL_FROM,
            to: email,
            subject,
            text: `${subject}: ${link.toString()}`
        });
    }
    return {
        sendVerificationEmail: ({ email, token }) => send(email, 'Verify your Green Way Motors email', '/verify-email', token),
        sendPasswordResetEmail: ({ email, token }) => send(email, 'Reset your Green Way Motors password', '/reset-password', token)
    };
}
//# sourceMappingURL=email.service.js.map