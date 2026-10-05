"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SymbolCollection = void 0;
const case_converter_1 = require("../utils/case-converter");
class SymbolCollection {
    constructor(options) {
        this.symbolNames = {};
        this.symbols = {};
        this.identifierStyle = options?.identifierStyle ?? 'kysely-pascal-case';
        const entries = options?.entries?.sort(([a], [b]) => a.localeCompare(b)) ?? [];
        for (const [id, symbol] of entries) {
            this.set(id, symbol);
        }
    }
    entries() {
        return Object.entries(this.symbols)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([id, symbol]) => ({
            id,
            name: this.symbolNames[id],
            symbol: symbol,
        }));
    }
    get(id) {
        return this.symbols[id];
    }
    getName(id) {
        return this.symbolNames[id];
    }
    has(id) {
        return !!this.symbols[id];
    }
    set(id, symbol) {
        let symbolName = this.symbolNames[id];
        if (symbolName) {
            return symbolName;
        }
        const symbolNames = new Set(Object.values(this.symbolNames));
        // For `ModuleReference` symbols (imports), preserve the original name
        // to maintain exact import names like MY_CUSTOM_TYPE:
        if (symbol.type === 'ModuleReference') {
            symbolName = id;
        }
        else {
            const caseConverter = this.identifierStyle === 'screaming-snake-case'
                ? case_converter_1.toScreamingSnakeCase
                : case_converter_1.toKyselyPascalCase;
            // Replace characters with underscores except for:
            // - Word characters (A-Z, a-z, 0-9, _)
            // - Dollar sign ($)
            // - CJK Unified Ideographs Extension A (U+3400–U+4DBF)
            // - CJK Unified Ideographs (U+4E00–U+9FFF)
            // - CJK Compatibility Ideographs (U+F900–U+FAFF)
            symbolName = caseConverter(id.replaceAll(/[^\w$\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g, '_'));
        }
        if (symbolNames.has(symbolName)) {
            let suffix = 2;
            while (symbolNames.has(`${symbolName}${suffix}`)) {
                suffix++;
            }
            symbolName += suffix;
        }
        if (/^\d/.test(symbolName)) {
            symbolName = `_${symbolName}`;
        }
        this.symbols[id] = symbol;
        this.symbolNames[id] = symbolName;
        return symbolName;
    }
}
exports.SymbolCollection = SymbolCollection;
//# sourceMappingURL=symbol-collection.js.map