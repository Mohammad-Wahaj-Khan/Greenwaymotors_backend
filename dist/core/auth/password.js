import argon2 from 'argon2';
const passwordOptions = {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1
};
export function hashPassword(password) {
    return argon2.hash(password, passwordOptions);
}
export function verifyPassword(passwordHash, password) {
    return argon2.verify(passwordHash, password);
}
//# sourceMappingURL=password.js.map