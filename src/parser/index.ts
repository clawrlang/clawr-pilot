import { TokenStream } from '../lexer'
import type { Token } from '../lexer'
import { positionedError } from '../lexer/positioned-error'
import type {
    BinaryExpression,
    CallArgument,
    CallExpression,
    Expression,
    ExpressionStatement,
    FieldTypeAnnotation,
    IdentifierExpression,
    IfStatement,
    IntegerLiteralExpression,
    MemberExpression,
    Program,
    RealLiteralExpression,
    Statement,
    StringLiteralExpression,
    SourcePosition,
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

    parseIfStatement(): IfStatement {
        const ifToken = this.stream.expect('KEYWORD', 'if')
        this.stream.expect('PUNCTUATION', '(')
        const predicate = this.parseExpression()
        this.stream.expect('PUNCTUATION', ')')
        const thenStatements = this.parseBlockStatements()

        let elseStatements: Statement[] = []
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
            } else {
                elseStatements = this.parseBlockStatements()
            }
        }

        return {
            kind: 'IfStatement',
            position: this.positionFromToken(ifToken),
            predicate,
            thenStatements,
            elseStatements,
        }
    }

    parseBlockStatements(): Statement[] {
        this.stream.expect('PUNCTUATION', '{')
        const statements: Statement[] = []

        this.skipTrivia()
        while (true) {
            const next = this.stream.peek({ skippingNewline: true })
            if (!next) throw new Error('Unexpected EOF in block statement')
            if (next.kind === 'PUNCTUATION' && next.symbol === '}') {
                this.stream.next({ skippingNewline: true })
                return statements
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
        let typeAnnotation: FieldTypeAnnotation | null = null
        const maybeColon = this.stream.peek({ skippingNewline: true })
        if (
            maybeColon &&
            maybeColon.kind === 'PUNCTUATION' &&
            maybeColon.symbol === ':'
        ) {
            this.stream.next({ skippingNewline: true })
            typeAnnotation = this.parseFieldTypeAnnotation()
        }
        this.stream.expect('PUNCTUATION', '=')
        const initializer = this.parseExpression()

        return {
            kind: 'VariableDeclaration',
            position: this.positionFromToken(token),
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

    parseFieldTypeAnnotation(): FieldTypeAnnotation {
        const typeToken = this.stream.expect('IDENTIFIER')
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
                    position: expr.position,
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
                    position: expr.position,
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
                    position: expr.position,
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
                    position: expr.position,
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
                    position: expr.position,
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
                    position: expr.position,
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
                    position: expr.position,
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
                position: base.position,
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
            return {
                kind: 'UnaryExpression',
                position: this.positionFromToken(token),
                operator: '!',
                operand: this.parseUnaryExpression(),
            } satisfies UnaryExpression
        }

        if (token.kind === 'OPERATOR' && token.operator === '~') {
            this.stream.next({ skippingNewline: true })
            return {
                kind: 'UnaryExpression',
                position: this.positionFromToken(token),
                operator: '~',
                operand: this.parseUnaryExpression(),
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
                    position: expr.position,
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
                position: this.positionFromToken(operator),
                value: -operand.value,
            } satisfies IntegerLiteralExpression
        }

        if (operand.kind === 'RealLiteral') {
            return {
                kind: 'RealLiteral',
                position: this.positionFromToken(operator),
                value: operand.value.startsWith('-')
                    ? operand.value.slice(1)
                    : `-${operand.value}`,
            } satisfies RealLiteralExpression
        }

        return {
            kind: 'UnaryExpression',
            position: this.positionFromToken(operator),
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

        this.stream.expect('PUNCTUATION', ')')

        return {
            kind: 'CallExpression',
            position: callee.position,
            callee,
            arguments: args,
        }
    }

    positionFromToken(token: Token): SourcePosition {
        return {
            file: this.file,
            line: token.line,
            column: token.column,
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
