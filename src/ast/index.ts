export interface Program {
    kind: 'Program'
    statements: Statement[]
}

export type Statement = ConstDeclaration | ExpressionStatement

export interface ConstDeclaration {
    kind: 'ConstDeclaration'
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
