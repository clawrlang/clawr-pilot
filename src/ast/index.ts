export interface Program {
    kind: 'Program'
    statements: Statement[]
}

export type VariableSemantics = 'const' | 'mut' | 'ref'

export type Statement = VariableDeclaration | ExpressionStatement | IfStatement

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

export interface IfStatement {
    kind: 'IfStatement'
    predicate: Expression
    thenStatements: Statement[]
    elseStatements: Statement[]
}

export type Expression =
    | IdentifierExpression
    | IntegerLiteralExpression
    | RealLiteralExpression
    | TruthLiteralExpression
    | StringLiteralExpression
    | UnaryExpression
    | BinaryExpression
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

export interface RealLiteralExpression {
    kind: 'RealLiteral'
    value: string
}

export interface TruthLiteralExpression {
    kind: 'TruthLiteral'
    value: 'false' | 'ambiguous' | 'true'
}

export interface StringLiteralExpression {
    kind: 'StringLiteral'
    value: string
}

export interface BinaryExpression {
    kind: 'BinaryExpression'
    operator:
        | '+'
        | '-'
        | '*'
        | '/'
        | '^'
        | '&'
        | '|'
        | '&&'
        | '||'
        | '=='
        | '!='
        | '<'
        | '<='
        | '>'
        | '>='
    left: Expression
    right: Expression
}

export interface UnaryExpression {
    kind: 'UnaryExpression'
    operator: '!' | '~' | '-'
    operand: Expression
}

export interface MemberExpression {
    kind: 'MemberExpression'
    object: Expression
    property: string
}

export interface CallArgument {
    label: string | null
    value: Expression
}

export interface CallExpression {
    kind: 'CallExpression'
    callee: Expression
    arguments: CallArgument[]
}
