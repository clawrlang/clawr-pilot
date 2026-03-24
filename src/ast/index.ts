export interface Program {
    kind: 'Program'
    statements: Statement[]
}

export interface SourcePosition {
    file: string
    line: number
    column: number
    endLine: number
    endColumn: number
}

export type VariableSemantics = 'const' | 'mut' | 'ref'

export interface FieldTypeAnnotation {
    kind: 'field'
    baseName: 'bitfield' | 'tritfield'
    length: number
}

export interface ValueSetTypeAnnotation {
    kind: 'subset'
    family: 'integer' | 'real' | 'truthvalue' | 'string'
    truthValues: Array<'false' | 'ambiguous' | 'true'> | null
}

export type TypeAnnotation = FieldTypeAnnotation | ValueSetTypeAnnotation

export type Statement =
    | VariableDeclaration
    | AssignmentStatement
    | ExpressionStatement
    | IfStatement

export interface VariableDeclaration {
    kind: 'VariableDeclaration'
    position: SourcePosition
    semantics: VariableSemantics
    identifier: IdentifierExpression
    typeAnnotation: TypeAnnotation | null
    initializer: Expression
}

export interface ExpressionStatement {
    kind: 'ExpressionStatement'
    position: SourcePosition
    expression: Expression
}

export interface AssignmentStatement {
    kind: 'AssignmentStatement'
    position: SourcePosition
    target: IdentifierExpression
    value: Expression
}

export interface IfStatement {
    kind: 'IfStatement'
    position: SourcePosition
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
    position: SourcePosition
    name: string
}

export interface IntegerLiteralExpression {
    kind: 'IntegerLiteral'
    position: SourcePosition
    value: bigint
}

export interface RealLiteralExpression {
    kind: 'RealLiteral'
    position: SourcePosition
    value: string
}

export interface TruthLiteralExpression {
    kind: 'TruthLiteral'
    position: SourcePosition
    value: 'false' | 'ambiguous' | 'true'
}

export interface StringLiteralExpression {
    kind: 'StringLiteral'
    position: SourcePosition
    value: string
}

export interface BinaryExpression {
    kind: 'BinaryExpression'
    position: SourcePosition
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
    position: SourcePosition
    operator: '!' | '~' | '-'
    operand: Expression
}

export interface MemberExpression {
    kind: 'MemberExpression'
    position: SourcePosition
    object: Expression
    property: string
}

export interface CallArgument {
    label: string | null
    value: Expression
}

export interface CallExpression {
    kind: 'CallExpression'
    position: SourcePosition
    callee: Expression
    arguments: CallArgument[]
}
