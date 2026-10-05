"use strict";
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _DiffChecker_instances, _DiffChecker_sanitize;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiffChecker = void 0;
const diff_1 = require("diff");
class DiffChecker {
    constructor() {
        _DiffChecker_instances.add(this);
    }
    diff(oldTypes, newTypes) {
        if (oldTypes === newTypes) {
            return undefined;
        }
        return ((0, diff_1.createPatch)('', __classPrivateFieldGet(this, _DiffChecker_instances, "m", _DiffChecker_sanitize).call(this, oldTypes), __classPrivateFieldGet(this, _DiffChecker_instances, "m", _DiffChecker_sanitize).call(this, newTypes))
            .split('\n')
            // Remove header lines:
            .slice(4)
            .join('\n'));
    }
}
exports.DiffChecker = DiffChecker;
_DiffChecker_instances = new WeakSet(), _DiffChecker_sanitize = function _DiffChecker_sanitize(string) {
    // Add `\n` to the end to avoid the "No newline at end of file" warning:
    return `${string.trim()}\n`;
};
//# sourceMappingURL=diff-checker.js.map