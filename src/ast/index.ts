export interface Program {
    kind: 'Program'
    statements: Statement[]
}

export type VariableSemantics = 'const' | 'mut' | 'ref'

export type Statement = VariableDeclaration | ExpressionStatement

export interface VariableDeclaration {
    kind: 'VariableDeclaration'
    semantics: VariableSemantics
    identifier: IdentifierExpression
    initializer: Expression
}

export interface ExpressionStatement {
    kind: 'ExpressionStatement'
    expression: Expression
}

export type Expression =
    | IdentifierExpression
    | IntegerLiteralExpression
    | TruthLiteralExpression
    | MemberExpression
    | CallExpression

export interface IdentifierExpression {
    kind: 'Identifier'
    name: string
}

export interface IntegerLiteralExpression {
    kind: 'IntegerLiteral'
    value: bigint
}

export interface TruthLiteralExpression {
    kind: 'TruthLiteral'
    value: 'false' | 'ambiguous' | 'true'
}

export interface MemberExpression {
    kind: 'MemberExpression'
    object: Expression
    property: string
}

export interface CallExpression {
    kind: 'CallExpression'
    callee: Expression
    arguments: Expression[]
}
