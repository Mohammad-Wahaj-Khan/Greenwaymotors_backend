import type { Environment } from '../../config/env.js';
export interface EmailService {
    sendVerificationEmail(input: {
        email: string;
        token: string;
    }): Promise<void>;
    sendPasswordResetEmail(input: {
        email: string;
        token: string;
    }): Promise<void>;
}
export declare function createEmailService(environment: Environment): EmailService;
