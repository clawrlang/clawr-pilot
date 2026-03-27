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

export interface LaneTypeAnnotation {
    kind: 'lane'
    baseName: 'binarylane' | 'ternarylane'
    length: number
}

export interface ValueSetTypeAnnotation {
    kind: 'subset'
    family: 'integer' | 'real' | 'truthvalue' | 'string'
    truthValues: Array<'false' | 'ambiguous' | 'true'> | null
    integerRange: {
        min: bigint | null
        max: bigint | null
        minInclusive: boolean
        maxInclusive: boolean
    } | null
    realRange: {
        min: string | null
        max: string | null
        minInclusive: boolean
        maxInclusive: boolean
    } | null
    stringLength: {
        min: bigint | null
        max: bigint | null
        minInclusive: boolean
        maxInclusive: boolean
    } | null
    stringPattern: {
        pattern: string
        modifiers: string
    } | null
    stringComposite: {
        operator: 'and' | 'or'
        left: StringAtomicSubsetConstraint
        right: StringAtomicSubsetConstraint
    } | null
}

export interface SubsetAliasTypeAnnotation {
    kind: 'subset-alias'
    name: string
}

export type TypeAnnotation =
    | LaneTypeAnnotation
    | ValueSetTypeAnnotation
    | SubsetAliasTypeAnnotation

export interface TruthValueSubsetConstraint {
    kind: 'truthvalue-values'
    values: Array<'false' | 'ambiguous' | 'true'>
}

export interface IntegerRangeSubsetConstraint {
    kind: 'integer-range'
    min: bigint | null
    max: bigint | null
    minInclusive: boolean
    maxInclusive: boolean
}

export interface RealRangeSubsetConstraint {
    kind: 'real-range'
    min: string | null
    max: string | null
    minInclusive: boolean
    maxInclusive: boolean
}

export interface StringLengthSubsetConstraint {
    kind: 'string-length'
    min: bigint | null
    max: bigint | null
    minInclusive: boolean
    maxInclusive: boolean
}

export interface StringPatternSubsetConstraint {
    kind: 'string-pattern'
    pattern: string
    modifiers: string
}

export type StringAtomicSubsetConstraint =
    | StringLengthSubsetConstraint
    | StringPatternSubsetConstraint

export interface StringCompositeSubsetConstraint {
    kind: 'string-composite'
    operator: 'and' | 'or'
    left: StringAtomicSubsetConstraint
    right: StringAtomicSubsetConstraint
}

export type SubsetConstraint =
    | TruthValueSubsetConstraint
    | IntegerRangeSubsetConstraint
    | RealRangeSubsetConstraint
    | StringLengthSubsetConstraint
    | StringPatternSubsetConstraint
    | StringCompositeSubsetConstraint

export type Statement =
    | SubsetDeclaration
    | DataDeclaration
    | VariableDeclaration
    | AssignmentStatement
    | ExpressionStatement
    | ReturnStatement
    | FunctionDeclaration
    | IfStatement

export interface DataFieldDeclaration {
    position: SourcePosition
    name: string
    typeAnnotation: TypeAnnotation
}

export interface DataDeclaration {
    kind: 'DataDeclaration'
    position: SourcePosition
    identifier: IdentifierExpression
    fields: DataFieldDeclaration[]
}

export interface FunctionParameter {
    position: SourcePosition
    name: string
    mode: 'in' | 'const' | 'mut' | 'ref'
    typeName: string | null
}

export interface FunctionReturnSlot {
    position: SourcePosition | null
    semantics: 'unique' | 'const' | 'ref' | null
    typeName: string | null
}

export interface FunctionDeclaration {
    kind: 'FunctionDeclaration'
    position: SourcePosition
    mutating: boolean
    identifier: IdentifierExpression
    parameters: FunctionParameter[]
    returnSlot: FunctionReturnSlot
    body: Statement[]
}

export interface SubsetDeclaration {
    kind: 'SubsetDeclaration'
    position: SourcePosition
    identifier: IdentifierExpression
    family: 'integer' | 'real' | 'truthvalue' | 'string'
    constraint: SubsetConstraint | null
}

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

export interface ReturnStatement {
    kind: 'ReturnStatement'
    position: SourcePosition
    value: Expression | null
}

export type AssignmentTarget = IdentifierExpression | MemberExpression

export interface AssignmentStatement {
    kind: 'AssignmentStatement'
    position: SourcePosition
    target: AssignmentTarget
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
    | DataLiteralExpression

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

export interface DataLiteralField {
    position: SourcePosition
    name: string
    value: Expression
}

export interface DataLiteralExpression {
    kind: 'DataLiteral'
    position: SourcePosition
    fields: DataLiteralField[]
}
