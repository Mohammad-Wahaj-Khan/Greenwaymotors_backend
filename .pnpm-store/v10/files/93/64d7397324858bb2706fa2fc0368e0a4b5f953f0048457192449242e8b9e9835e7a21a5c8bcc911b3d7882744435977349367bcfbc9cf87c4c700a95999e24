import type { ExpressionNode } from '../ast/expression-node';
/**
 * Parses a TypeScript type expression string into kysely-codegen AST nodes.
 * This properly handles all TypeScript syntax including generics, unions,
 * intersections, and complex nested types.
 */
export declare class TypeExpressionParser {
    #private;
    /**
     * Extracts all type identifiers from a type expression.
     * This is used for import collection.
     */
    extractTypeIdentifiers(typeExpression: string): string[];
    /**
     * Parses a TypeScript type expression string into AST nodes.
     *
     * @param typeExpression - The type expression string (e.g., `JSONColumnType<CustomType>`)
     * @returns The parsed AST node, or `RawExpressionNode` if parsing fails
     */
    parse(typeExpression: string): ExpressionNode;
}
export declare const typeExpressionParser: TypeExpressionParser;
