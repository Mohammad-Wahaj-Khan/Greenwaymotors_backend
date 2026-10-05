"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchLogLevel = exports.isValidLogLevel = exports.getLogLevelNumber = exports.LOG_LEVELS = exports.DEFAULT_LOG_LEVEL = void 0;
exports.DEFAULT_LOG_LEVEL = 'warn';
exports.LOG_LEVELS = ['silent', 'error', 'warn', 'info', 'debug'];
const getLogLevelNumber = (logLevel) => {
    return exports.LOG_LEVELS.indexOf(logLevel);
};
exports.getLogLevelNumber = getLogLevelNumber;
const isValidLogLevel = (logLevel) => {
    return (0, exports.getLogLevelNumber)(logLevel) !== -1;
};
exports.isValidLogLevel = isValidLogLevel;
const matchLogLevel = ({ actual, expected, }) => {
    return (0, exports.getLogLevelNumber)(actual) >= (0, exports.getLogLevelNumber)(expected);
};
exports.matchLogLevel = matchLogLevel;
//# sourceMappingURL=log-level.js.map