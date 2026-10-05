"use strict";
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _TypeExpressionParser_instances, _TypeExpressionParser_sourceFile, _TypeExpressionParser_collectTypeReferences, _TypeExpressionParser_convertTypeNode;
Object.defineProperty(exports, "__esModule", { value: true });
exports.typeExpressionParser = exports.TypeExpressionParser = void 0;
const typescript_1 = __importDefault(require("typescript"));
const generic_expression_node_1 = require("../ast/generic-expression-node");
const identifier_node_1 = require("../ast/identifier-node");
const literal_node_1 = require("../ast/literal-node");
const raw_expression_node_1 = require("../ast/raw-expression-node");
const union_expression_node_1 = require("../ast/union-expression-node");
/**
 * Parses a TypeScript type expression string into kysely-codegen AST nodes.
 * This properly handles all TypeScript syntax including generics, unions,
 * intersections, and complex nested types.
 */
class TypeExpressionParser {
    constructor() {
        _TypeExpressionParser_instances.add(this);
        _TypeExpressionParser_sourceFile.set(this, void 0);
    }
    /**
     * Extracts all type identifiers from a type expression.
     * This is used for import collection.
     */
    extractTypeIdentifiers(typeExpression) {
        // Handle empty string edge case:
        if (!typeExpression.trim()) {
            return [];
        }
        try {
            const sourceText = `type __T = ${typeExpression};`;
            __classPrivateFieldSet(this, _TypeExpressionParser_sourceFile, typescript_1.default.createSourceFile('temp.ts', sourceText, typescript_1.default.ScriptTarget.Latest, true, typescript_1.default.ScriptKind.TS), "f");
            const typeAlias = __classPrivateFieldGet(this, _TypeExpressionParser_sourceFile, "f").statements.find((stmt) => typescript_1.default.isTypeAliasDeclaration(stmt));
            if (!typeAlias) {
                return [];
            }
            const identifiers = new Set();
            __classPrivateFieldGet(this, _TypeExpressionParser_instances, "m", _TypeExpressionParser_collectTypeReferences).call(this, typeAlias.type, identifiers);
            return Array.from(identifiers);
        }
        catch {
            return [];
        }
    }
    /**
     * Parses a TypeScript type expression string into AST nodes.
     *
     * @param typeExpression - The type expression string (e.g., `JSONColumnType<CustomType>`)
     * @returns The parsed AST node, or `RawExpressionNode` if parsing fails
     */
    parse(typeExpression) {
        // Handle empty string edge case:
        if (!typeExpression.trim()) {
            return new raw_expression_node_1.RawExpressionNode(typeExpression);
        }
        try {
            // Wrap the type in a type alias to make it a valid TypeScript statement:
            const sourceText = `type __T = ${typeExpression};`;
            // Create a TypeScript source file:
            __classPrivateFieldSet(this, _TypeExpressionParser_sourceFile, typescript_1.default.createSourceFile('temp.ts', sourceText, typescript_1.default.ScriptTarget.Latest, true, typescript_1.default.ScriptKind.TS), "f");
            // Find the type alias declaration:
            const typeAlias = __classPrivateFieldGet(this, _TypeExpressionParser_sourceFile, "f").statements.find((stmt) => typescript_1.default.isTypeAliasDeclaration(stmt));
            if (!typeAlias) {
                return new raw_expression_node_1.RawExpressionNode(typeExpression);
            }
            // Convert the TypeScript AST to kysely-codegen AST:
            return __classPrivateFieldGet(this, _TypeExpressionParser_instances, "m", _TypeExpressionParser_convertTypeNode).call(this, typeAlias.type);
        }
        catch (error) {
            // If parsing fails for any reason, fall back to `RawExpressionNode`:
            console.warn(`Failed to parse type expression: ${typeExpression}`, error);
            return new raw_expression_node_1.RawExpressionNode(typeExpression);
        }
    }
}
exports.TypeExpressionParser = TypeExpressionParser;
_TypeExpressionParser_sourceFile = new WeakMap(), _TypeExpressionParser_instances = new WeakSet(), _TypeExpressionParser_collectTypeReferences = function _TypeExpressionParser_collectTypeReferences(node, identifiers) {
    if (typescript_1.default.isTypeReferenceNode(node)) {
        const typeName = node.typeName.getText(__classPrivateFieldGet(this, _TypeExpressionParser_sourceFile, "f"));
        identifiers.add(typeName);
        // Also collect type arguments:
        if (node.typeArguments) {
            for (const arg of node.typeArguments) {
                __classPrivateFieldGet(this, _TypeExpressionParser_instances, "m", _TypeExpressionParser_collectTypeReferences).call(this, arg, identifiers);
            }
        }
    }
    else if (typescript_1.default.isUnionTypeNode(node)) {
        for (const type of node.types) {
            __classPrivateFieldGet(this, _TypeExpressionParser_instances, "m", _TypeExpressionParser_collectTypeReferences).call(this, type, identifiers);
        }
    }
    else if (typescript_1.default.isIntersectionTypeNode(node)) {
        for (const type of node.types) {
            __classPrivateFieldGet(this, _TypeExpressionParser_instances, "m", _TypeExpressionParser_collectTypeReferences).call(this, type, identifiers);
        }
    }
    else if (typescript_1.default.isArrayTypeNode(node)) {
        __classPrivateFieldGet(this, _TypeExpressionParser_instances, "m", _TypeExpressionParser_collectTypeReferences).call(this, node.elementType, identifiers);
    }
    else if (typescript_1.default.isTupleTypeNode(node)) {
        for (const element of node.elements) {
            if (typescript_1.default.isNamedTupleMember(element)) {
                __classPrivateFieldGet(this, _TypeExpressionParser_instances, "m", _TypeExpressionParser_collectTypeReferences).call(this, element.type, identifiers);
            }
            else {
                __classPrivateFieldGet(this, _TypeExpressionParser_instances, "m", _TypeExpressionParser_collectTypeReferences).call(this, element, identifiers);
            }
        }
    }
    else if (typescript_1.default.isConditionalTypeNode(node)) {
        __classPrivateFieldGet(this, _TypeExpressionParser_instances, "m", _TypeExpressionParser_collectTypeReferences).call(this, node.checkType, identifiers);
        __classPrivateFieldGet(this, _TypeExpressionParser_instances, "m", _TypeExpressionParser_collectTypeReferences).call(this, node.extendsType, identifiers);
        __classPrivateFieldGet(this, _TypeExpressionParser_instances, "m", _TypeExpressionParser_collectTypeReferences).call(this, node.trueType, identifiers);
        __classPrivateFieldGet(this, _TypeExpressionParser_instances, "m", _TypeExpressionParser_collectTypeReferences).call(this, node.falseType, identifiers);
    }
    else if (typescript_1.default.isMappedTypeNode(node)) {
        if (node.type) {
            __classPrivateFieldGet(this, _TypeExpressionParser_instances, "m", _TypeExpressionParser_collectTypeReferences).call(this, node.type, identifiers);
        }
    }
    else if (typescript_1.default.isIndexedAccessTypeNode(node)) {
        __classPrivateFieldGet(this, _TypeExpressionParser_instances, "m", _TypeExpressionParser_collectTypeReferences).call(this, node.objectType, identifiers);
        __classPrivateFieldGet(this, _TypeExpressionParser_instances, "m", _TypeExpressionParser_collectTypeReferences).call(this, node.indexType, identifiers);
    }
    else if (typescript_1.default.isParenthesizedTypeNode(node)) {
        __classPrivateFieldGet(this, _TypeExpressionParser_instances, "m", _TypeExpressionParser_collectTypeReferences).call(this, node.type, identifiers);
    }
    // Note: We don't collect from literal types, keyword types, etc.
}, _TypeExpressionParser_convertTypeNode = function _TypeExpressionParser_convertTypeNode(node) {
    // For complex types (e.g. arrays, intersections, object types), preserve
    // the original syntax by using `RawExpressionNode`. This maintains output
    // fidelity.
    if (typescript_1.default.isArrayTypeNode(node) ||
        typescript_1.default.isIntersectionTypeNode(node) ||
        typescript_1.default.isTypeLiteralNode(node)) {
        const typeText = node.getText(__classPrivateFieldGet(this, _TypeExpressionParser_sourceFile, "f"));
        return new raw_expression_node_1.RawExpressionNode(typeText);
    }
    if (typescript_1.default.isTypeReferenceNode(node)) {
        const typeName = node.typeName.getText(__classPrivateFieldGet(this, _TypeExpressionParser_sourceFile, "f"));
        if (node.typeArguments && node.typeArguments.length > 0) {
            // Generic type like `JSONColumnType<CustomType>`:
            const args = node.typeArguments.map((arg) => __classPrivateFieldGet(this, _TypeExpressionParser_instances, "m", _TypeExpressionParser_convertTypeNode).call(this, arg));
            return new generic_expression_node_1.GenericExpressionNode(typeName, args);
        }
        // Simple identifier:
        return new identifier_node_1.IdentifierNode(typeName);
    }
    else if (typescript_1.default.isUnionTypeNode(node)) {
        // Union type like `A | B | C`:
        const types = node.types.map((type) => __classPrivateFieldGet(this, _TypeExpressionParser_instances, "m", _TypeExpressionParser_convertTypeNode).call(this, type));
        return types.length === 1 ? types[0] : new union_expression_node_1.UnionExpressionNode(types);
    }
    else if (typescript_1.default.isLiteralTypeNode(node)) {
        // String literal type like `"active" | "inactive"`:
        if (typescript_1.default.isStringLiteral(node.literal)) {
            return new literal_node_1.LiteralNode(node.literal.text);
        }
        else if (node.literal.kind === typescript_1.default.SyntaxKind.NullKeyword) {
            return new identifier_node_1.IdentifierNode('null');
        }
        else if (node.literal.kind === typescript_1.default.SyntaxKind.TrueKeyword) {
            return new identifier_node_1.IdentifierNode('true');
        }
        else if (node.literal.kind === typescript_1.default.SyntaxKind.FalseKeyword) {
            return new identifier_node_1.IdentifierNode('false');
        }
        else if (typescript_1.default.isNumericLiteral(node.literal)) {
            return new literal_node_1.LiteralNode(Number(node.literal.text));
        }
    }
    else if (node.kind === typescript_1.default.SyntaxKind.StringKeyword) {
        return new identifier_node_1.IdentifierNode('string');
    }
    else if (node.kind === typescript_1.default.SyntaxKind.NumberKeyword) {
        return new identifier_node_1.IdentifierNode('number');
    }
    else if (node.kind === typescript_1.default.SyntaxKind.BooleanKeyword) {
        return new identifier_node_1.IdentifierNode('boolean');
    }
    else if (node.kind === typescript_1.default.SyntaxKind.NullKeyword) {
        return new identifier_node_1.IdentifierNode('null');
    }
    else if (node.kind === typescript_1.default.SyntaxKind.UndefinedKeyword) {
        return new identifier_node_1.IdentifierNode('undefined');
    }
    else if (node.kind === typescript_1.default.SyntaxKind.NeverKeyword) {
        return new identifier_node_1.IdentifierNode('never');
    }
    else if (node.kind === typescript_1.default.SyntaxKind.AnyKeyword) {
        return new identifier_node_1.IdentifierNode('any');
    }
    else if (node.kind === typescript_1.default.SyntaxKind.UnknownKeyword) {
        return new identifier_node_1.IdentifierNode('unknown');
    }
    // For any other complex types, fall back to raw expression:
    const typeText = node.getText(__classPrivateFieldGet(this, _TypeExpressionParser_sourceFile, "f"));
    return new raw_expression_node_1.RawExpressionNode(typeText);
};
// Singleton instance for convenience:
exports.typeExpressionParser = new TypeExpressionParser();
//# sourceMappingURL=type-expression-parser.js.map