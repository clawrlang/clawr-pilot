import { TokenStream } from '../lexer'
import type { Token } from '../lexer'
import { positionedError } from '../lexer/positioned-error'
import type {
    AssignmentStatement,
    BinaryExpression,
    CallArgument,
    CallExpression,
    Expression,
    ExpressionStatement,
    FunctionDeclaration,
    FunctionParameter,
    FunctionReturnSlot,
    IdentifierExpression,
    IfStatement,
    IntegerLiteralExpression,
    MemberExpression,
    Program,
    RealLiteralExpression,
    SourcePosition,
    Statement,
    SubsetConstraint,
    SubsetDeclaration,
    StringLiteralExpression,
    TypeAnnotation,
    TruthLiteralExpression,
    UnaryExpression,
    VariableDeclaration,
    VariableSemantics,
} from '../ast'

export function parseClawr(source: string, file: string): Program {
    const parser = new Parser(source, file)
    return parser.parseProgram()
}

export class Parser {
    private stream: TokenStream
    private file: string

    constructor(source: string, file: string) {
        this.stream = new TokenStream(source, file)
        this.file = file
    }

    parseProgram(): Program {
        const statements: Statement[] = []

        this.skipTrivia()
        while (this.stream.peek()) {
            const statement = this.parseStatement()
            statements.push(statement)
            const endLine = this.lastTokenLine()
            this.consumeStatementTerminator(endLine)
        }

        return {
            kind: 'Program',
            statements,
        }
    }

    parseStatement(): Statement {
        const subsetDeclaration = this.tryParseSubsetDeclaration()
        if (subsetDeclaration) return subsetDeclaration

        const assignment = this.tryParseAssignmentStatement()
        if (assignment) return assignment

        const token = this.stream.peek({ skippingNewline: true })
        if (!token) throw new Error('Unexpected EOF')

        if (token.kind === 'KEYWORD' && token.keyword === 'if') {
            return this.parseIfStatement()
        }

        const functionLike = this.tryParseFunctionLikeDeclaration()
        if (functionLike) return functionLike

        if (
            token.kind === 'KEYWORD' &&
            (token.keyword === 'const' ||
                token.keyword === 'mut' ||
                token.keyword === 'ref')
        ) {
            return this.parseVariableDeclaration()
        }

        return this.parseExpressionStatement()
    }

    tryParseFunctionLikeDeclaration(): FunctionDeclaration | null {
        const probe = this.stream.clone()
        const first = probe.next({ skippingNewline: true })
        if (!first || first.kind !== 'KEYWORD') return null

        if (first.keyword === 'func') {
            return this.parseFunctionLikeDeclaration(false)
        }

        if (first.keyword === 'mutating') {
            const second = probe.next({ skippingNewline: true })
            if (
                second &&
                second.kind === 'KEYWORD' &&
                second.keyword === 'func'
            ) {
                return this.parseFunctionLikeDeclaration(true)
            }
        }

        return null
    }

    parseFunctionLikeDeclaration(mutating: boolean): FunctionDeclaration {
        const startToken = mutating
            ? this.stream.expect('KEYWORD', 'mutating')
            : this.stream.peek({ skippingNewline: true })

        if (!startToken) {
            throw new Error('Unexpected EOF while parsing function declaration')
        }

        this.stream.expect('KEYWORD', 'func')
        const nameToken = this.stream.expect('IDENTIFIER')
        const identifier: IdentifierExpression = {
            kind: 'Identifier',
            position: this.positionFromToken(nameToken),
            name: nameToken.identifier,
        }

        const parameters = this.parseFunctionParameters()
        const returnSlot = this.parseFunctionReturnSlot()
        const body = this.parseBlockStatements()

        const position = this.mergePositions(
            this.positionFromToken(startToken),
            body.endPosition,
        )

        return {
            kind: 'FunctionDeclaration',
            position,
            mutating,
            identifier,
            parameters,
            returnSlot,
            body: body.statements,
        }
    }

    parseFunctionParameters(): FunctionParameter[] {
        this.stream.expect('PUNCTUATION', '(')
        const parameters: FunctionParameter[] = []

        let next = this.stream.peek({ skippingNewline: true })
        if (!next) throw new Error('Unexpected EOF in parameter list')

        while (!(next.kind === 'PUNCTUATION' && next.symbol === ')')) {
            const nameToken = this.stream.expect('IDENTIFIER')
            let typeName: string | null = null

            const maybeColon = this.stream.peek({ skippingNewline: true })
            if (
                maybeColon &&
                maybeColon.kind === 'PUNCTUATION' &&
                maybeColon.symbol === ':'
            ) {
                this.stream.next({ skippingNewline: true })
                typeName = this.parseTypeNameInSignature()
            }

            const parameterEndToken = this.stream.peek({
                skippingNewline: true,
            })
            parameters.push({
                position: this.positionFromToken(
                    parameterEndToken ?? nameToken,
                ),
                name: nameToken.identifier,
                typeName,
            })

            next = this.stream.peek({ skippingNewline: true })
            if (!next) throw new Error('Unexpected EOF in parameter list')
            if (next.kind === 'PUNCTUATION' && next.symbol === ',') {
                this.stream.next({ skippingNewline: true })
                next = this.stream.peek({ skippingNewline: true })
                if (!next) throw new Error('Unexpected EOF in parameter list')
                continue
            }
            if (!(next.kind === 'PUNCTUATION' && next.symbol === ')')) {
                throw parseError(
                    this.file,
                    next,
                    'Expected , or ) in parameter list',
                )
            }
        }

        this.stream.expect('PUNCTUATION', ')')
        return parameters
    }

    parseFunctionReturnSlot(): FunctionReturnSlot {
        const maybeArrow = this.stream.peek({ skippingNewline: true })
        if (
            !maybeArrow ||
            maybeArrow.kind !== 'PUNCTUATION' ||
            maybeArrow.symbol !== '->'
        ) {
            return {
                position: null,
                semantics: null,
                typeName: null,
            }
        }

        this.stream.next({ skippingNewline: true })

        let semantics: FunctionReturnSlot['semantics'] = 'unique'
        let token = this.stream.peek({ skippingNewline: true })
        if (!token) throw new Error('Unexpected EOF after ->')

        if (token.kind === 'KEYWORD' && token.keyword === 'const') {
            this.stream.next({ skippingNewline: true })
            semantics = 'const'
            token = this.stream.peek({ skippingNewline: true })
            if (!token) throw new Error('Unexpected EOF after -> const')
        } else if (token.kind === 'KEYWORD' && token.keyword === 'ref') {
            this.stream.next({ skippingNewline: true })
            semantics = 'ref'
            token = this.stream.peek({ skippingNewline: true })
            if (!token) throw new Error('Unexpected EOF after -> ref')
        }

        const typeName = this.parseTypeNameInSignature()
        const end = this.stream.peek({ skippingNewline: true })

        return {
            position: this.positionFromToken(end ?? token),
            semantics,
            typeName,
        }
    }

    parseTypeNameInSignature(): string {
        const token = this.stream.next({ skippingNewline: true })
        if (!token) throw new Error('Unexpected EOF in type annotation')

        if (token.kind === 'IDENTIFIER') {
            return token.identifier
        }

        if (
            token.kind === 'KEYWORD' &&
            (token.keyword === 'data' ||
                token.keyword === 'object' ||
                token.keyword === 'service' ||
                token.keyword === 'trait' ||
                token.keyword === 'role' ||
                token.keyword === 'union' ||
                token.keyword === 'enum')
        ) {
            return token.keyword
        }

        throw parseError(this.file, token, 'Expected type name in signature')
    }

    tryParseSubsetDeclaration(): SubsetDeclaration | null {
        const probe = this.stream.clone()
        const maybeSubset = probe.next({ skippingNewline: true })
        const maybeName = probe.next({ skippingNewline: true })
        const maybeEquals = probe.peek({ skippingNewline: true })
        if (
            !maybeSubset ||
            maybeSubset.kind !== 'IDENTIFIER' ||
            maybeSubset.identifier !== 'subset' ||
            !maybeName ||
            maybeName.kind !== 'IDENTIFIER' ||
            !maybeEquals ||
            maybeEquals.kind !== 'PUNCTUATION' ||
            maybeEquals.symbol !== '='
        ) {
            return null
        }

        const subsetToken = this.stream.expect('IDENTIFIER')
        const nameToken = this.stream.expect('IDENTIFIER')
        this.stream.expect('PUNCTUATION', '=')
        const familyToken = this.stream.expect('IDENTIFIER')

        if (
            familyToken.identifier !== 'integer' &&
            familyToken.identifier !== 'real' &&
            familyToken.identifier !== 'string' &&
            familyToken.identifier !== 'truthvalue'
        ) {
            throw parseError(
                this.file,
                familyToken,
                'subset declarations currently support integer, real, string, and truthvalue families',
            )
        }

        const constraint = this.parseSubsetConstraintAfterIn(familyToken)

        return {
            kind: 'SubsetDeclaration',
            position: this.mergePositions(
                this.positionFromToken(subsetToken),
                constraint
                    ? constraint.position
                    : this.positionFromToken(familyToken),
            ),
            identifier: {
                kind: 'Identifier',
                position: this.positionFromToken(nameToken),
                name: nameToken.identifier,
            },
            family: familyToken.identifier,
            constraint: constraint?.constraint ?? null,
        }
    }

    parseSubsetConstraintAfterIn(familyToken: Token & { kind: 'IDENTIFIER' }): {
        constraint: SubsetConstraint
        position: SourcePosition
    } | null {
        const next = this.stream.peek({ skippingNewline: true })
        if (!(next && next.kind === 'KEYWORD' && next.keyword === 'in')) {
            return null
        }
        this.stream.next({ skippingNewline: true })

        if (familyToken.identifier === 'truthvalue') {
            const parsed = this.parseTruthvalueSetConstraint(
                familyToken,
                'truthvalue constraints must list truth literals separated by commas',
            )
            return {
                constraint: {
                    kind: 'truthvalue-values',
                    values: parsed.values,
                },
                position: parsed.position,
            }
        }

        if (familyToken.identifier === 'integer') {
            return this.parseIntegerRangeConstraint()
        }

        if (familyToken.identifier === 'real') {
            return this.parseRealRangeConstraint()
        }

        if (familyToken.identifier === 'string') {
            return this.parseStringConstraint(familyToken)
        }

        throw parseError(
            this.file,
            familyToken,
            `${familyToken.identifier} constraints are not supported in this vertical slice`,
        )
    }

    parseTruthvalueSetConstraint(
        contextToken: Token,
        listError: string,
    ): {
        values: Array<'false' | 'ambiguous' | 'true'>
        position: SourcePosition
    } {
        this.stream.expect('PUNCTUATION', '{')

        const values: Array<'false' | 'ambiguous' | 'true'> = []
        let closingToken: Token | null = null

        while (true) {
            const token = this.stream.next({ skippingNewline: true })
            if (!token) {
                throw new Error('Unexpected EOF in truthvalue constraint')
            }
            if (token.kind !== 'TRUTH_LITERAL') {
                throw parseError(this.file, token, listError)
            }
            values.push(token.value)

            const separator = this.stream.peek({ skippingNewline: true })
            if (!separator) {
                throw parseError(
                    this.file,
                    token,
                    'Expected , or } in truthvalue constraint',
                )
            }
            if (separator.kind === 'PUNCTUATION' && separator.symbol === ',') {
                this.stream.next({ skippingNewline: true })
                continue
            }
            if (separator.kind === 'PUNCTUATION' && separator.symbol === '}') {
                closingToken =
                    this.stream.next({ skippingNewline: true }) ?? null
                break
            }
            throw parseError(
                this.file,
                separator,
                'Expected , or } in truthvalue constraint',
            )
        }

        if (!closingToken) {
            throw new Error('Unexpected parser state: missing closing token')
        }

        if (values.length === 0) {
            throw parseError(
                this.file,
                contextToken,
                'truthvalue constraints must include at least one literal',
            )
        }

        return {
            values: [...new Set(values)],
            position: this.positionFromToken(closingToken),
        }
    }

    parseIntegerRangeConstraint(): {
        constraint: Extract<SubsetConstraint, { kind: 'integer-range' }>
        position: SourcePosition
    } {
        this.stream.expect('PUNCTUATION', '[')

        const min = this.parseOptionalSignedIntegerRangeBound()
        const rangeOperator = this.stream.expect('OPERATOR', [
            '...',
            '..',
            '..<',
        ])
        let upperExclusive = false

        if (min === null && rangeOperator.operator === '...') {
            const maybeLessThan = this.stream.peek({ skippingNewline: true })
            if (
                maybeLessThan &&
                maybeLessThan.kind === 'OPERATOR' &&
                maybeLessThan.operator === '<'
            ) {
                this.stream.next({ skippingNewline: true })
                upperExclusive = true
            }
        }

        const max = this.parseOptionalSignedIntegerRangeBound()

        const close = this.stream.expect('PUNCTUATION', ']')

        if (min !== null && rangeOperator.operator === '...') {
            if (max !== null || upperExclusive) {
                throw parseError(
                    this.file,
                    rangeOperator,
                    'Lower-bounded integer ranges using ... cannot specify an upper bound',
                )
            }
        } else if (min !== null) {
            if (min !== null && max === null) {
                throw parseError(
                    this.file,
                    rangeOperator,
                    'Use ... for integer ranges with an omitted upper bound',
                )
            }
        } else {
            if (rangeOperator.operator !== '...') {
                throw parseError(
                    this.file,
                    rangeOperator,
                    'Use ... before the upper bound when omitting the lower bound',
                )
            }
            if (max === null && upperExclusive) {
                throw parseError(
                    this.file,
                    rangeOperator,
                    'Integer range must include at least one bound',
                )
            }
        }

        return {
            constraint: {
                kind: 'integer-range',
                min,
                max,
                minInclusive: true,
                maxInclusive:
                    min === null
                        ? !upperExclusive
                        : rangeOperator.operator !== '..<',
            },
            position: this.positionFromToken(close),
        }
    }

    parseRealRangeConstraint(): {
        constraint: Extract<SubsetConstraint, { kind: 'real-range' }>
        position: SourcePosition
    } {
        this.stream.expect('PUNCTUATION', '[')

        const min = this.parseOptionalSignedRealRangeBound()
        const rangeOperator = this.stream.expect('OPERATOR', [
            '...',
            '..',
            '..<',
        ])
        let upperExclusive = false

        if (min === null && rangeOperator.operator === '...') {
            const maybeLessThan = this.stream.peek({ skippingNewline: true })
            if (
                maybeLessThan &&
                maybeLessThan.kind === 'OPERATOR' &&
                maybeLessThan.operator === '<'
            ) {
                this.stream.next({ skippingNewline: true })
                upperExclusive = true
            }
        }

        const max = this.parseOptionalSignedRealRangeBound()

        const close = this.stream.expect('PUNCTUATION', ']')

        if (min !== null && rangeOperator.operator === '...') {
            if (max !== null || upperExclusive) {
                throw parseError(
                    this.file,
                    rangeOperator,
                    'Lower-bounded real ranges using ... cannot specify an upper bound',
                )
            }
        } else if (min !== null) {
            if (max === null) {
                throw parseError(
                    this.file,
                    rangeOperator,
                    'Use ... for real ranges with an omitted upper bound',
                )
            }
        } else {
            if (rangeOperator.operator !== '...') {
                throw parseError(
                    this.file,
                    rangeOperator,
                    'Use ... before the upper bound when omitting the lower bound',
                )
            }
            if (max === null && upperExclusive) {
                throw parseError(
                    this.file,
                    rangeOperator,
                    'Real range must include at least one bound',
                )
            }
        }

        return {
            constraint: {
                kind: 'real-range',
                min,
                max,
                minInclusive: true,
                maxInclusive:
                    min === null
                        ? !upperExclusive
                        : rangeOperator.operator !== '..<',
            },
            position: this.positionFromToken(close),
        }
    }

    parseOptionalSignedIntegerRangeBound(): bigint | null {
        const next = this.stream.peek({ skippingNewline: true })
        if (!next) return null

        if (next.kind === 'INTEGER_LITERAL') {
            this.stream.next({ skippingNewline: true })
            return next.value
        }

        if (next.kind !== 'OPERATOR' || next.operator !== '-') {
            return null
        }

        this.stream.next({ skippingNewline: true })
        const magnitude = this.stream.next({ skippingNewline: true })
        if (!magnitude) {
            throw new Error('Unexpected EOF in integer range constraint')
        }
        if (magnitude.kind !== 'INTEGER_LITERAL') {
            throw parseError(
                this.file,
                magnitude,
                'Expected integer bound after - in range constraint',
            )
        }

        return -magnitude.value
    }

    parseOptionalSignedRealRangeBound(): string | null {
        const next = this.stream.peek({ skippingNewline: true })
        if (!next) return null

        if (next.kind === 'REAL_LITERAL') {
            this.stream.next({ skippingNewline: true })
            return next.source
        }

        if (next.kind === 'INTEGER_LITERAL') {
            this.stream.next({ skippingNewline: true })
            return next.value.toString()
        }

        if (next.kind !== 'OPERATOR' || next.operator !== '-') {
            return null
        }

        this.stream.next({ skippingNewline: true })
        const magnitude = this.stream.next({ skippingNewline: true })
        if (!magnitude) {
            throw new Error('Unexpected EOF in real range constraint')
        }
        if (magnitude.kind === 'REAL_LITERAL') {
            return magnitude.source.startsWith('-')
                ? magnitude.source.slice(1)
                : `-${magnitude.source}`
        }
        if (magnitude.kind === 'INTEGER_LITERAL') {
            return `-${magnitude.value.toString()}`
        }
        throw parseError(
            this.file,
            magnitude,
            'Expected real bound after - in range constraint',
        )
    }

    parseStringConstraint(contextToken: Token & { kind: 'IDENTIFIER' }): {
        constraint:
            | Extract<SubsetConstraint, { kind: 'string-length' }>
            | Extract<SubsetConstraint, { kind: 'string-pattern' }>
            | Extract<SubsetConstraint, { kind: 'string-composite' }>
        position: SourcePosition
    } {
        const next = this.stream.peek({ skippingNewline: true })
        if (!next) {
            throw new Error('Unexpected EOF in string constraint')
        }

        if (next.kind === 'PUNCTUATION' && next.symbol === '(') {
            return this.parseStringCompositeConstraint(contextToken)
        }

        const parsed = this.parseStringAtomicConstraint(contextToken)
        const trailing = this.stream.peek({ skippingNewline: true })
        if (
            trailing &&
            trailing.kind === 'KEYWORD' &&
            (trailing.keyword === 'and' || trailing.keyword === 'or')
        ) {
            throw parseError(
                this.file,
                trailing,
                'Use parentheses around composite string constraints, for example ([1..8] and /.../)',
            )
        }

        return parsed
    }

    parseStringAtomicConstraint(contextToken: Token): {
        constraint:
            | Extract<SubsetConstraint, { kind: 'string-length' }>
            | Extract<SubsetConstraint, { kind: 'string-pattern' }>
        position: SourcePosition
    } {
        const next = this.stream.peek({ skippingNewline: true })
        if (!next) {
            throw new Error('Unexpected EOF in string constraint')
        }

        if (next.kind === 'PUNCTUATION' && next.symbol === '[') {
            return this.parseStringLengthConstraint()
        }

        if (next.kind === 'REGEX_LITERAL') {
            const regex = this.stream.next({ skippingNewline: true })
            if (!regex || regex.kind !== 'REGEX_LITERAL') {
                throw new Error('Unexpected parser state: missing regex token')
            }
            return {
                constraint: {
                    kind: 'string-pattern',
                    pattern: regex.pattern,
                    modifiers: regex.modifiers
                        ? [...regex.modifiers].sort().join('')
                        : '',
                },
                position: this.positionFromToken(regex),
            }
        }

        throw parseError(
            this.file,
            contextToken,
            'string constraints must be a length range like [1..8] or a regex literal',
        )
    }

    parseStringCompositeConstraint(contextToken: Token): {
        constraint: Extract<SubsetConstraint, { kind: 'string-composite' }>
        position: SourcePosition
    } {
        this.stream.expect('PUNCTUATION', '(')
        const left = this.parseStringAtomicConstraint(contextToken).constraint

        const operatorToken = this.stream.next({ skippingNewline: true })
        if (
            !operatorToken ||
            operatorToken.kind !== 'KEYWORD' ||
            (operatorToken.keyword !== 'and' && operatorToken.keyword !== 'or')
        ) {
            throw parseError(
                this.file,
                operatorToken ?? contextToken,
                "string composite constraints require exactly one operator: 'and' or 'or'",
            )
        }

        const right = this.parseStringAtomicConstraint(operatorToken).constraint
        const trailing = this.stream.peek({ skippingNewline: true })
        if (
            trailing &&
            trailing.kind === 'KEYWORD' &&
            (trailing.keyword === 'and' || trailing.keyword === 'or')
        ) {
            throw parseError(
                this.file,
                trailing,
                'string composite constraints currently allow only one and/or operator',
            )
        }

        const close = this.stream.expect('PUNCTUATION', ')')

        return {
            constraint: {
                kind: 'string-composite',
                operator: operatorToken.keyword,
                left,
                right,
            },
            position: this.positionFromToken(close),
        }
    }

    parseStringLengthConstraint(): {
        constraint: Extract<SubsetConstraint, { kind: 'string-length' }>
        position: SourcePosition
    } {
        this.stream.expect('PUNCTUATION', '[')

        const min = this.parseOptionalUnsignedIntegerRangeBound()
        const rangeOperator = this.stream.expect('OPERATOR', [
            '...',
            '..',
            '..<',
        ])
        let upperExclusive = false

        if (min === null && rangeOperator.operator === '...') {
            const maybeLessThan = this.stream.peek({ skippingNewline: true })
            if (
                maybeLessThan &&
                maybeLessThan.kind === 'OPERATOR' &&
                maybeLessThan.operator === '<'
            ) {
                this.stream.next({ skippingNewline: true })
                upperExclusive = true
            }
        }

        const max = this.parseOptionalUnsignedIntegerRangeBound()
        const close = this.stream.expect('PUNCTUATION', ']')

        if (min !== null && rangeOperator.operator === '...') {
            if (max !== null || upperExclusive) {
                throw parseError(
                    this.file,
                    rangeOperator,
                    'Lower-bounded string length ranges using ... cannot specify an upper bound',
                )
            }
        } else if (min !== null) {
            if (max === null) {
                throw parseError(
                    this.file,
                    rangeOperator,
                    'Use ... for string length ranges with an omitted upper bound',
                )
            }
        } else {
            if (rangeOperator.operator !== '...') {
                throw parseError(
                    this.file,
                    rangeOperator,
                    'Use ... before the upper bound when omitting the lower bound',
                )
            }
            if (max === null && upperExclusive) {
                throw parseError(
                    this.file,
                    rangeOperator,
                    'String length range must include at least one bound',
                )
            }
        }

        return {
            constraint: {
                kind: 'string-length',
                min,
                max,
                minInclusive: true,
                maxInclusive:
                    min === null
                        ? !upperExclusive
                        : rangeOperator.operator !== '..<',
            },
            position: this.positionFromToken(close),
        }
    }

    parseOptionalUnsignedIntegerRangeBound(): bigint | null {
        const next = this.stream.peek({ skippingNewline: true })
        if (!next) return null
        if (next.kind !== 'INTEGER_LITERAL') return null
        this.stream.next({ skippingNewline: true })
        return next.value
    }

    tryParseAssignmentStatement(): AssignmentStatement | null {
        const probe = this.stream.clone()
        const maybeIdentifier = probe.next({ skippingNewline: true })
        const maybeEquals = probe.peek({ skippingNewline: true })
        if (
            !maybeIdentifier ||
            maybeIdentifier.kind !== 'IDENTIFIER' ||
            !maybeEquals ||
            maybeEquals.kind !== 'PUNCTUATION' ||
            maybeEquals.symbol !== '='
        ) {
            return null
        }

        const identifier = this.stream.expect('IDENTIFIER')
        const target: IdentifierExpression = {
            kind: 'Identifier',
            position: this.positionFromToken(identifier),
            name: identifier.identifier,
        }
        this.stream.expect('PUNCTUATION', '=')
        const value = this.parseExpression()

        return {
            kind: 'AssignmentStatement',
            position: this.mergePositions(target.position, value.position),
            target,
            value,
        }
    }

    parseIfStatement(): IfStatement {
        const ifToken = this.stream.expect('KEYWORD', 'if')
        this.stream.expect('PUNCTUATION', '(')
        const predicate = this.parseExpression()
        this.stream.expect('PUNCTUATION', ')')
        const thenBlock = this.parseBlockStatements()
        const thenStatements = thenBlock.statements

        let elseStatements: Statement[] = []
        let endPosition = thenBlock.endPosition
        const next = this.stream.peek({ skippingNewline: true })
        if (next && next.kind === 'KEYWORD' && next.keyword === 'else') {
            this.stream.next({ skippingNewline: true })
            const elseHead = this.stream.peek({ skippingNewline: true })
            if (
                elseHead &&
                elseHead.kind === 'KEYWORD' &&
                elseHead.keyword === 'if'
            ) {
                // else-if is parsed as syntactic sugar: else { if (...) { ... } }
                elseStatements = [this.parseIfStatement()]
                endPosition = elseStatements[0].position
            } else {
                const elseBlock = this.parseBlockStatements()
                elseStatements = elseBlock.statements
                endPosition = elseBlock.endPosition
            }
        }

        return {
            kind: 'IfStatement',
            position: this.mergePositions(
                this.positionFromToken(ifToken),
                endPosition,
            ),
            predicate,
            thenStatements,
            elseStatements,
        }
    }

    parseBlockStatements(): {
        statements: Statement[]
        endPosition: SourcePosition
    } {
        this.stream.expect('PUNCTUATION', '{')
        const statements: Statement[] = []

        this.skipTrivia()
        while (true) {
            const next = this.stream.peek({ skippingNewline: true })
            if (!next) throw new Error('Unexpected EOF in block statement')
            if (next.kind === 'PUNCTUATION' && next.symbol === '}') {
                const closeToken = this.stream.next({ skippingNewline: true })
                if (!closeToken)
                    throw new Error('Unexpected EOF in block statement')
                return {
                    statements,
                    endPosition: this.positionFromToken(closeToken),
                }
            }

            const statement = this.parseStatement()
            statements.push(statement)

            const maybeBlockEnd = this.stream.peek({ skippingNewline: true })
            if (
                maybeBlockEnd &&
                maybeBlockEnd.kind === 'PUNCTUATION' &&
                maybeBlockEnd.symbol === '}'
            ) {
                continue
            }

            const endLine = this.lastTokenLine()
            this.consumeStatementTerminator(endLine)
        }
    }

    parseVariableDeclaration(): VariableDeclaration {
        const token = this.stream.peek({ skippingNewline: true })
        if (
            !token ||
            token.kind !== 'KEYWORD' ||
            (token.keyword !== 'const' &&
                token.keyword !== 'mut' &&
                token.keyword !== 'ref')
        ) {
            throw new Error('Expected const, mut, or ref keyword')
        }

        const semantics = token.keyword as VariableSemantics
        this.stream.next({ skippingNewline: true })

        const ident = this.stream.expect('IDENTIFIER')
        let typeAnnotation: TypeAnnotation | null = null
        const maybeColon = this.stream.peek({ skippingNewline: true })
        if (
            maybeColon &&
            maybeColon.kind === 'PUNCTUATION' &&
            maybeColon.symbol === ':'
        ) {
            this.stream.next({ skippingNewline: true })
            typeAnnotation = this.parseTypeAnnotation()
        }
        this.stream.expect('PUNCTUATION', '=')
        const initializer = this.parseExpression()

        return {
            kind: 'VariableDeclaration',
            position: this.mergePositions(
                this.positionFromToken(token),
                initializer.position,
            ),
            semantics,
            identifier: {
                kind: 'Identifier',
                position: this.positionFromToken(ident),
                name: ident.identifier,
            },
            typeAnnotation,
            initializer,
        }
    }

    parseTypeAnnotation(): TypeAnnotation {
        const typeToken = this.stream.expect('IDENTIFIER')
        if (
            typeToken.identifier === 'bitfield' ||
            typeToken.identifier === 'tritfield'
        ) {
            return this.parseFieldTypeAnnotation(typeToken)
        }

        if (
            typeToken.identifier === 'integer' ||
            typeToken.identifier === 'real' ||
            typeToken.identifier === 'string' ||
            typeToken.identifier === 'truthvalue'
        ) {
            return this.parseValueSetTypeAnnotation(typeToken)
        }

        return {
            kind: 'subset-alias',
            name: typeToken.identifier,
        }
    }

    parseValueSetTypeAnnotation(
        typeToken: Token & { kind: 'IDENTIFIER' },
    ): TypeAnnotation {
        const family = typeToken.identifier
        if (
            family !== 'integer' &&
            family !== 'real' &&
            family !== 'string' &&
            family !== 'truthvalue'
        ) {
            throw parseError(
                this.file,
                typeToken,
                'Invalid value-set type annotation',
            )
        }

        const annotation: TypeAnnotation = {
            kind: 'subset',
            family,
            truthValues: null,
            integerRange: null,
            realRange: null,
            stringLength: null,
            stringPattern: null,
            stringComposite: null,
        }

        const maybeIn = this.stream.peek({ skippingNewline: true })
        if (
            !(maybeIn && maybeIn.kind === 'KEYWORD' && maybeIn.keyword === 'in')
        ) {
            return annotation
        }
        this.stream.next({ skippingNewline: true })

        if (family === 'truthvalue') {
            const parsed = this.parseTruthvalueSetConstraint(
                typeToken,
                'truthvalue constraints must list truth literals separated by commas',
            )
            return {
                ...annotation,
                truthValues: parsed.values,
            }
        }

        if (family === 'integer') {
            const parsed = this.parseIntegerRangeConstraint()
            return {
                ...annotation,
                integerRange: parsed.constraint,
            }
        }

        if (family === 'real') {
            const parsed = this.parseRealRangeConstraint()
            return {
                ...annotation,
                realRange: parsed.constraint,
            }
        }

        if (family === 'string') {
            const parsed = this.parseStringConstraint(typeToken)
            if (parsed.constraint.kind === 'string-length') {
                return {
                    ...annotation,
                    stringLength: parsed.constraint,
                }
            }
            if (parsed.constraint.kind === 'string-pattern') {
                return {
                    ...annotation,
                    stringPattern: parsed.constraint,
                }
            }
            return {
                ...annotation,
                stringComposite: parsed.constraint,
            }
        }

        throw parseError(
            this.file,
            typeToken,
            `${family} constraints are not supported in this vertical slice`,
        )
    }

    parseFieldTypeAnnotation(
        typeToken: Token & { kind: 'IDENTIFIER' },
    ): TypeAnnotation {
        if (
            typeToken.identifier !== 'bitfield' &&
            typeToken.identifier !== 'tritfield'
        ) {
            throw parseError(
                this.file,
                typeToken,
                'Only bitfield[N] and tritfield[N] type annotations are supported in this vertical slice',
            )
        }

        this.stream.expect('PUNCTUATION', '[')
        const lengthToken = this.stream.next()
        if (!lengthToken || lengthToken.kind !== 'INTEGER_LITERAL') {
            throw parseError(
                this.file,
                lengthToken ?? typeToken,
                `Expected INTEGER_LITERAL, got ${lengthToken?.kind ?? 'EOF'}`,
            )
        }
        this.stream.expect('PUNCTUATION', ']')

        if (lengthToken.value <= 0n || lengthToken.value > 64n) {
            throw parseError(
                this.file,
                lengthToken,
                'Field type annotation length must be in [1, 64]',
            )
        }

        return {
            kind: 'field',
            baseName: typeToken.identifier,
            length: Number(lengthToken.value),
        }
    }

    parseExpressionStatement(): ExpressionStatement {
        const expression = this.parseExpression()
        return {
            kind: 'ExpressionStatement',
            position: expression.position,
            expression,
        }
    }

    parseExpression(): Expression {
        return this.parseLogicalOrExpression()
    }

    parseLogicalOrExpression(): Expression {
        let expr = this.parseLogicalAndExpression()

        while (true) {
            const token = this.stream.peek({ skippingNewline: true })
            if (token && token.kind === 'OPERATOR' && token.operator === '||') {
                this.stream.next({ skippingNewline: true })
                const right = this.parseLogicalAndExpression()
                expr = {
                    kind: 'BinaryExpression',
                    position: this.mergePositions(
                        expr.position,
                        right.position,
                    ),
                    operator: '||',
                    left: expr,
                    right,
                } satisfies BinaryExpression
                continue
            }

            return expr
        }
    }

    parseLogicalAndExpression(): Expression {
        let expr = this.parseComparisonExpression()

        while (true) {
            const token = this.stream.peek({ skippingNewline: true })
            if (token && token.kind === 'OPERATOR' && token.operator === '&&') {
                this.stream.next({ skippingNewline: true })
                const right = this.parseComparisonExpression()
                expr = {
                    kind: 'BinaryExpression',
                    position: this.mergePositions(
                        expr.position,
                        right.position,
                    ),
                    operator: '&&',
                    left: expr,
                    right,
                } satisfies BinaryExpression
                continue
            }

            return expr
        }
    }

    parseBitwiseOrExpression(): Expression {
        let expr = this.parseExponentiationExpression()

        while (true) {
            const token = this.stream.peek({ skippingNewline: true })
            if (token && token.kind === 'OPERATOR' && token.operator === '|') {
                this.stream.next({ skippingNewline: true })
                const right = this.parseExponentiationExpression()
                expr = {
                    kind: 'BinaryExpression',
                    position: this.mergePositions(
                        expr.position,
                        right.position,
                    ),
                    operator: '|',
                    left: expr,
                    right,
                } satisfies BinaryExpression
                continue
            }

            return expr
        }
    }

    parseBitwiseAndExpression(): Expression {
        let expr = this.parseUnaryExpression()

        while (true) {
            const token = this.stream.peek({ skippingNewline: true })
            if (token && token.kind === 'OPERATOR' && token.operator === '&') {
                this.stream.next({ skippingNewline: true })
                const right = this.parseUnaryExpression()
                expr = {
                    kind: 'BinaryExpression',
                    position: this.mergePositions(
                        expr.position,
                        right.position,
                    ),
                    operator: '&',
                    left: expr,
                    right,
                } satisfies BinaryExpression
                continue
            }

            return expr
        }
    }

    parseComparisonExpression(): Expression {
        let expr = this.parseAdditiveExpression()

        while (true) {
            const token = this.stream.peek({ skippingNewline: true })
            if (
                token &&
                token.kind === 'OPERATOR' &&
                (token.operator === '==' ||
                    token.operator === '!=' ||
                    token.operator === '<' ||
                    token.operator === '<=' ||
                    token.operator === '>' ||
                    token.operator === '>=')
            ) {
                this.stream.next({ skippingNewline: true })
                const right = this.parseAdditiveExpression()
                expr = {
                    kind: 'BinaryExpression',
                    position: this.mergePositions(
                        expr.position,
                        right.position,
                    ),
                    operator: token.operator,
                    left: expr,
                    right,
                } satisfies BinaryExpression
                continue
            }

            return expr
        }
    }

    parseAdditiveExpression(): Expression {
        let expr = this.parseMultiplicativeExpression()

        while (true) {
            const token = this.stream.peek({ skippingNewline: true })
            if (
                token &&
                token.kind === 'OPERATOR' &&
                (token.operator === '+' || token.operator === '-')
            ) {
                this.stream.next({ skippingNewline: true })
                const right = this.parseMultiplicativeExpression()
                expr = {
                    kind: 'BinaryExpression',
                    position: this.mergePositions(
                        expr.position,
                        right.position,
                    ),
                    operator: token.operator,
                    left: expr,
                    right,
                } satisfies BinaryExpression
                continue
            }

            return expr
        }
    }

    parseMultiplicativeExpression(): Expression {
        let expr = this.parseBitwiseOrExpression()

        while (true) {
            const token = this.stream.peek({ skippingNewline: true })
            if (
                token &&
                token.kind === 'OPERATOR' &&
                (token.operator === '*' || token.operator === '/')
            ) {
                this.stream.next({ skippingNewline: true })
                const right = this.parseBitwiseOrExpression()
                expr = {
                    kind: 'BinaryExpression',
                    position: this.mergePositions(
                        expr.position,
                        right.position,
                    ),
                    operator: token.operator,
                    left: expr,
                    right,
                } satisfies BinaryExpression
                continue
            }

            return expr
        }
    }

    parseExponentiationExpression(): Expression {
        const base = this.parseBitwiseAndExpression()

        const token = this.stream.peek({ skippingNewline: true })
        if (token && token.kind === 'OPERATOR' && token.operator === '^') {
            this.stream.next({ skippingNewline: true })
            // Right-associative: recurse here instead of looping
            const exponent = this.parseExponentiationExpression()
            return {
                kind: 'BinaryExpression',
                position: this.mergePositions(base.position, exponent.position),
                operator: '^',
                left: base,
                right: exponent,
            } satisfies BinaryExpression
        }

        return base
    }

    parseUnaryExpression(): Expression {
        const token = this.stream.peek({ skippingNewline: true })
        if (!token) throw new Error('Unexpected EOF while parsing expression')

        if (token.kind === 'OPERATOR' && token.operator === '!') {
            this.stream.next({ skippingNewline: true })
            const operand = this.parseUnaryExpression()
            return {
                kind: 'UnaryExpression',
                position: this.mergePositions(
                    this.positionFromToken(token),
                    operand.position,
                ),
                operator: '!',
                operand,
            } satisfies UnaryExpression
        }

        if (token.kind === 'OPERATOR' && token.operator === '~') {
            this.stream.next({ skippingNewline: true })
            const operand = this.parseUnaryExpression()
            return {
                kind: 'UnaryExpression',
                position: this.mergePositions(
                    this.positionFromToken(token),
                    operand.position,
                ),
                operator: '~',
                operand,
            } satisfies UnaryExpression
        }

        if (token.kind === 'OPERATOR' && token.operator === '-') {
            this.stream.next({ skippingNewline: true })
            return this.parseNegatedExpression(token)
        }

        return this.parsePostfixExpression()
    }

    parsePostfixExpression(): Expression {
        let expr = this.parsePrimary()

        while (true) {
            const token = this.stream.peek({ skippingNewline: true })
            if (!token) return expr

            if (token.kind === 'OPERATOR' && token.operator === '.') {
                this.stream.next({ skippingNewline: true })
                const prop = this.stream.expect('IDENTIFIER')
                expr = {
                    kind: 'MemberExpression',
                    position: this.mergePositions(
                        expr.position,
                        this.positionFromToken(prop),
                    ),
                    object: expr,
                    property: prop.identifier,
                } satisfies MemberExpression
                continue
            }

            if (token.kind === 'PUNCTUATION' && token.symbol === '(') {
                expr = this.parseCallExpression(expr)
                continue
            }

            return expr
        }
    }

    parsePrimary(): Expression {
        const token = this.stream.next({ skippingNewline: true })
        if (!token) throw new Error('Unexpected EOF while parsing expression')

        if (token.kind === 'PUNCTUATION' && token.symbol === '(') {
            const grouped = this.parseExpression()
            this.stream.expect('PUNCTUATION', ')')
            return grouped
        }

        if (token.kind === 'IDENTIFIER') {
            return {
                kind: 'Identifier',
                position: this.positionFromToken(token),
                name: token.identifier,
            } satisfies IdentifierExpression
        }

        if (token.kind === 'INTEGER_LITERAL') {
            return {
                kind: 'IntegerLiteral',
                position: this.positionFromToken(token),
                value: token.value,
            } satisfies IntegerLiteralExpression
        }

        if (token.kind === 'REAL_LITERAL') {
            return {
                kind: 'RealLiteral',
                position: this.positionFromToken(token),
                value: token.source,
            } satisfies RealLiteralExpression
        }

        if (token.kind === 'TRUTH_LITERAL') {
            return {
                kind: 'TruthLiteral',
                position: this.positionFromToken(token),
                value: token.value,
            } satisfies TruthLiteralExpression
        }

        if (token.kind === 'STRING_LITERAL') {
            return {
                kind: 'StringLiteral',
                position: this.positionFromToken(token),
                value: token.value,
            } satisfies StringLiteralExpression
        }

        throw parseError(
            this.file,
            token,
            `Unexpected token ${token.kind} in expression`,
        )
    }

    parseNegatedExpression(operator: Token): Expression {
        const operand = this.parseUnaryExpression()

        if (operand.kind === 'IntegerLiteral') {
            return {
                kind: 'IntegerLiteral',
                position: this.mergePositions(
                    this.positionFromToken(operator),
                    operand.position,
                ),
                value: -operand.value,
            } satisfies IntegerLiteralExpression
        }

        if (operand.kind === 'RealLiteral') {
            return {
                kind: 'RealLiteral',
                position: this.mergePositions(
                    this.positionFromToken(operator),
                    operand.position,
                ),
                value: operand.value.startsWith('-')
                    ? operand.value.slice(1)
                    : `-${operand.value}`,
            } satisfies RealLiteralExpression
        }

        return {
            kind: 'UnaryExpression',
            position: this.mergePositions(
                this.positionFromToken(operator),
                operand.position,
            ),
            operator: '-',
            operand,
        } satisfies UnaryExpression
    }

    parseCallExpression(callee: Expression): CallExpression {
        this.stream.expect('PUNCTUATION', '(')
        const args: CallArgument[] = []

        let next = this.stream.peek({ skippingNewline: true })
        if (!next) throw new Error('Unexpected EOF in call expression')

        while (!(next.kind === 'PUNCTUATION' && next.symbol === ')')) {
            args.push(this.parseCallArgument())
            next = this.stream.peek({ skippingNewline: true })
            if (!next) throw new Error('Unexpected EOF in call expression')

            if (next.kind === 'PUNCTUATION' && next.symbol === ',') {
                this.stream.next({ skippingNewline: true })
                next = this.stream.peek({ skippingNewline: true })
                if (!next) throw new Error('Unexpected EOF in call expression')
                continue
            }

            if (!(next.kind === 'PUNCTUATION' && next.symbol === ')')) {
                throw parseError(
                    this.file,
                    next,
                    'Expected , or ) in argument list',
                )
            }
        }

        const closeToken = this.stream.expect('PUNCTUATION', ')')

        return {
            kind: 'CallExpression',
            position: this.mergePositions(
                callee.position,
                this.positionFromToken(closeToken),
            ),
            callee,
            arguments: args,
        }
    }

    positionFromToken(token: Token): SourcePosition {
        const width = this.tokenWidth(token)
        return {
            file: this.file,
            line: token.line,
            column: token.column,
            endLine: token.line,
            endColumn: token.column + Math.max(0, width - 1),
        }
    }

    mergePositions(start: SourcePosition, end: SourcePosition): SourcePosition {
        return {
            file: start.file,
            line: start.line,
            column: start.column,
            endLine: end.endLine,
            endColumn: end.endColumn,
        }
    }

    tokenWidth(token: Token): number {
        switch (token.kind) {
            case 'NEWLINE':
                return 1
            case 'KEYWORD':
                return token.keyword.length
            case 'IDENTIFIER':
                return token.identifier.length
            case 'REAL_LITERAL':
                return token.source.length
            case 'INTEGER_LITERAL':
                return token.value.toString().length
            case 'TRUTH_LITERAL':
                return token.value.length
            case 'STRING_LITERAL':
                return token.value.length + 2
            case 'REGEX_LITERAL': {
                const modifiers = token.modifiers
                    ? [...token.modifiers].sort().join('').length
                    : 0
                return token.pattern.length + 2 + modifiers
            }
            case 'PUNCTUATION':
                return token.symbol.length
            case 'OPERATOR':
                return token.operator.length
        }
    }

    parseCallArgument(): CallArgument {
        const probe = this.stream.clone()
        const maybeLabel = probe.next({ skippingNewline: true })
        const maybeColon = probe.peek({ skippingNewline: true })

        if (
            maybeLabel &&
            maybeLabel.kind === 'IDENTIFIER' &&
            maybeColon &&
            maybeColon.kind === 'PUNCTUATION' &&
            maybeColon.symbol === ':'
        ) {
            const label = this.stream.expect('IDENTIFIER').identifier
            this.stream.expect('PUNCTUATION', ':')
            return {
                label,
                value: this.parseExpression(),
            }
        }

        return {
            label: null,
            value: this.parseExpression(),
        }
    }

    lastTokenLine(): number {
        // peek() without skippingNewline: if next is NEWLINE or EOF the statement
        // already ended on the line before; otherwise we are still on the same line.
        const next = this.stream.peek()
        if (!next || next.kind === 'NEWLINE') return -1
        // The statement ended on the line of its last consumed token, which is
        // the line just before this (possibly same-line) token.
        return next.line
    }

    consumeStatementTerminator(statementEndLine: number) {
        const next = this.stream.peek()
        if (!next) return

        if (next.kind === 'NEWLINE') {
            this.skipTrivia()
            return
        }

        if (next.kind === 'PUNCTUATION' && next.symbol === ';') {
            this.stream.next()
            this.skipTrivia()
            return
        }

        // At this point there is a non-whitespace token with no separator.
        if (next.line === statementEndLine) {
            throw parseError(
                this.file,
                next,
                `Statements on the same line must be separated by a semicolon`,
            )
        }

        throw parseError(
            this.file,
            next,
            'Expected newline or ; between statements',
        )
    }

    skipTrivia() {
        while (this.stream.peek()?.kind === 'NEWLINE') this.stream.next()
    }
}

function parseError(file: string, token: Token, message: string): Error {
    return positionedError(message, {
        file,
        line: token.line,
        column: token.column,
    })
}
