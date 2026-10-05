export declare function hashPassword(password: string): Promise<string>;
export declare function verifyPassword(passwordHash: string, password: string): Promise<boolean>;
