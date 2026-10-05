import type { ContactMethod, UserStatus, UserType } from '../../generated/database.types.js';
export interface UserSummary {
    id: string;
    userType: UserType;
    email: string;
    fullName: string;
    phone: string | null;
    whatsapp: string | null;
    countryId: number | null;
    city: string | null;
    preferredContact: ContactMethod | null;
    status: UserStatus;
    emailVerifiedAt: string | null;
}
export interface AuthContext {
    user: UserSummary;
    permissions: ReadonlySet<string>;
    mfaRequired: boolean;
    mfaSatisfied: boolean;
}
export interface SessionIssue {
    accessToken: string;
    refreshToken: string;
    user: UserSummary;
    mfaSetupRequired?: boolean;
}
export interface LoginChallenge {
    mfaChallengeRequired: true;
    challengeToken: string;
    expiresAt: string;
}
