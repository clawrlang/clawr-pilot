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

        const constraint = this.parseSubsetConstraint(familyToken)

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

    parseSubsetConstraint(familyToken: Token & { kind: 'IDENTIFIER' }): {
        constraint: SubsetConstraint
        position: SourcePosition
    } | null {
        const maybeAt = this.stream.peek({ skippingNewline: true })
        if (
            !(
                maybeAt &&
                maybeAt.kind === 'PUNCTUATION' &&
                maybeAt.symbol === '@'
            )
        ) {
            return null
        }

        this.stream.next({ skippingNewline: true })
        const directive = this.stream.expect('IDENTIFIER')

        if (directive.identifier === 'values') {
            if (familyToken.identifier !== 'truthvalue') {
                throw parseError(
                    this.file,
                    directive,
                    '@values is currently only supported for truthvalue subsets',
                )
            }

            const parsed = this.parseTruthvalueDirectiveValues()
            return {
                constraint: {
                    kind: 'truthvalue-values',
                    values: parsed.values,
                },
                position: parsed.position,
            }
        }

        if (directive.identifier === 'except') {
            if (familyToken.identifier !== 'truthvalue') {
                throw parseError(
                    this.file,
                    directive,
                    '@except is currently only supported for truthvalue subsets',
                )
            }

            const parsed = this.parseTruthvalueDirectiveValues()
            const excluded = new Set(parsed.values)
            const allTruthValues: Array<'false' | 'ambiguous' | 'true'> = [
                'false',
                'ambiguous',
                'true',
            ]
            const values = allTruthValues.filter(
                (value) => !excluded.has(value),
            )
            if (values.length === 0) {
                throw parseError(
                    this.file,
                    directive,
                    '@except removed all truthvalue members; subset cannot be empty',
                )
            }
            return {
                constraint: {
                    kind: 'truthvalue-values',
                    values,
                },
                position: parsed.position,
            }
        }

        if (directive.identifier === 'range') {
            if (familyToken.identifier !== 'integer') {
                throw parseError(
                    this.file,
                    directive,
                    '@range is currently only supported for integer subsets',
                )
            }

            const parsed = this.parseIntegerRangeDirective()
            return {
                constraint: parsed.constraint,
                position: parsed.position,
            }
        }

        throw parseError(
            this.file,
            directive,
            'Unsupported subset directive. Use @values(...), @except(...), or @range(...) in this vertical slice',
        )
    }

    parseTruthvalueDirectiveValues(): {
        values: Array<'false' | 'ambiguous' | 'true'>
        position: SourcePosition
    } {
        this.stream.expect('PUNCTUATION', '(')

        const values: Array<'false' | 'ambiguous' | 'true'> = []
        let closingToken: Token | null = null

        while (true) {
            const token = this.stream.next({ skippingNewline: true })
            if (!token) {
                throw new Error('Unexpected EOF in subset directive')
            }
            if (token.kind !== 'TRUTH_LITERAL') {
                throw parseError(
                    this.file,
                    token,
                    'Expected truth literals in subset directive',
                )
            }
            values.push(token.value)

            const separator = this.stream.peek({ skippingNewline: true })
            if (!separator) {
                throw parseError(
                    this.file,
                    token,
                    'Expected , or ) in subset directive',
                )
            }
            if (separator.kind === 'PUNCTUATION' && separator.symbol === ',') {
                this.stream.next({ skippingNewline: true })
                continue
            }
            if (separator.kind === 'PUNCTUATION' && separator.symbol === ')') {
                closingToken =
                    this.stream.next({ skippingNewline: true }) ?? null
                break
            }
            throw parseError(
                this.file,
                separator,
                'Expected , or ) in subset directive',
            )
        }

        if (!closingToken) {
            throw new Error('Unexpected parser state: missing closing token')
        }

        return {
            values: [...new Set(values)],
            position: this.positionFromToken(closingToken),
        }
    }

    parseIntegerRangeDirective(): {
        constraint: SubsetConstraint
        position: SourcePosition
    } {
        this.stream.expect('PUNCTUATION', '(')

        const minToken = this.stream.next({ skippingNewline: true })
        if (!minToken) {
            throw new Error('Unexpected EOF in @range directive')
        }
        if (minToken.kind !== 'INTEGER_LITERAL') {
            throw parseError(
                this.file,
                minToken,
                'Expected integer lower bound in @range(...)',
            )
        }
        this.stream.expect('OPERATOR', ['...'])

        const maybeMax = this.stream.peek({ skippingNewline: true })
        let max: bigint | null = null
        if (maybeMax && maybeMax.kind === 'INTEGER_LITERAL') {
            max = maybeMax.value
            this.stream.next({ skippingNewline: true })
        }

        const close = this.stream.expect('PUNCTUATION', ')')

        return {
            constraint: {
                kind: 'integer-range',
                min: minToken.value,
                max,
                minInclusive: true,
                maxInclusive: true,
            },
            position: this.positionFromToken(close),
        }
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
            typeToken.identifier === 'string'
        ) {
            return {
                kind: 'subset',
                family: typeToken.identifier,
                truthValues: null,
            }
        }

        if (typeToken.identifier === 'truthvalue') {
            return this.parseTruthvalueTypeAnnotation(typeToken)
        }

        return {
            kind: 'subset-alias',
            name: typeToken.identifier,
        }
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

    parseTruthvalueTypeAnnotation(
        typeToken: Token & { kind: 'IDENTIFIER' },
    ): TypeAnnotation {
        const next = this.stream.peek({ skippingNewline: true })
        if (!(next && next.kind === 'PUNCTUATION' && next.symbol === '[')) {
            return {
                kind: 'subset',
                family: 'truthvalue',
                truthValues: null,
            }
        }

        this.stream.next({ skippingNewline: true })

        const values: Array<'false' | 'ambiguous' | 'true'> = []
        while (true) {
            const token = this.stream.next({ skippingNewline: true })
            if (!token || token.kind !== 'TRUTH_LITERAL') {
                throw parseError(
                    this.file,
                    token ?? typeToken,
                    'truthvalue[...] annotations must list truth literals separated by |',
                )
            }
            values.push(token.value)

            const separator = this.stream.peek({ skippingNewline: true })
            if (
                separator &&
                separator.kind === 'OPERATOR' &&
                separator.operator === '|'
            ) {
                this.stream.next({ skippingNewline: true })
                continue
            }
            break
        }

        this.stream.expect('PUNCTUATION', ']')

        if (values.length === 0) {
            throw parseError(
                this.file,
                typeToken,
                'truthvalue[...] annotations must include at least one literal',
            )
        }

        return {
            kind: 'subset',
            family: 'truthvalue',
            truthValues: [...new Set(values)],
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
