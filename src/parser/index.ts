import { TokenStream } from '../lexer'
import type { Token } from '../lexer'
import { positionedError } from '../lexer/positioned-error'
import type {
    BinaryExpression,
    CallExpression,
    Expression,
    ExpressionStatement,
    IdentifierExpression,
    IntegerLiteralExpression,
    MemberExpression,
    Program,
    RealLiteralExpression,
    Statement,
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
        this.stream.expect('PUNCTUATION', '=')
        const initializer = this.parseExpression()

        return {
            kind: 'VariableDeclaration',
            semantics,
            identifier: {
                kind: 'Identifier',
                name: ident.identifier,
            },
            initializer,
        }
    }

    parseExpressionStatement(): ExpressionStatement {
        return {
            kind: 'ExpressionStatement',
            expression: this.parseExpression(),
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
        let expr = this.parseAdditiveExpression()

        while (true) {
            const token = this.stream.peek({ skippingNewline: true })
            if (token && token.kind === 'OPERATOR' && token.operator === '&&') {
                this.stream.next({ skippingNewline: true })
                const right = this.parseAdditiveExpression()
                expr = {
                    kind: 'BinaryExpression',
                    operator: '&&',
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
        let expr = this.parseExponentiationExpression()

        while (true) {
            const token = this.stream.peek({ skippingNewline: true })
            if (
                token &&
                token.kind === 'OPERATOR' &&
                (token.operator === '*' || token.operator === '/')
            ) {
                this.stream.next({ skippingNewline: true })
                const right = this.parseExponentiationExpression()
                expr = {
                    kind: 'BinaryExpression',
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
        const base = this.parseUnaryExpression()

        const token = this.stream.peek({ skippingNewline: true })
        if (token && token.kind === 'OPERATOR' && token.operator === '^') {
            this.stream.next({ skippingNewline: true })
            // Right-associative: recurse here instead of looping
            const exponent = this.parseExponentiationExpression()
            return {
                kind: 'BinaryExpression',
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
                operator: '!',
                operand: this.parseUnaryExpression(),
            } satisfies UnaryExpression
        }

        if (token.kind === 'OPERATOR' && token.operator === '-') {
            this.stream.next({ skippingNewline: true })
            return this.parseNegatedPrimary(token)
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

        if (token.kind === 'IDENTIFIER') {
            return {
                kind: 'Identifier',
                name: token.identifier,
            } satisfies IdentifierExpression
        }

        if (token.kind === 'INTEGER_LITERAL') {
            return {
                kind: 'IntegerLiteral',
                value: token.value,
            } satisfies IntegerLiteralExpression
        }

        if (token.kind === 'REAL_LITERAL') {
            return {
                kind: 'RealLiteral',
                value: token.source,
            } satisfies RealLiteralExpression
        }

        if (token.kind === 'TRUTH_LITERAL') {
            return {
                kind: 'TruthLiteral',
                value: token.value,
            } satisfies TruthLiteralExpression
        }

        throw parseError(
            this.file,
            token,
            `Unexpected token ${token.kind} in expression`,
        )
    }

    parseNegatedPrimary(operator: Token): Expression {
        const value = this.stream.next({ skippingNewline: true })
        if (!value) throw new Error('Unexpected EOF after unary -')

        if (value.kind === 'INTEGER_LITERAL') {
            return {
                kind: 'IntegerLiteral',
                value: -value.value,
            } satisfies IntegerLiteralExpression
        }

        if (value.kind === 'REAL_LITERAL') {
            return {
                kind: 'RealLiteral',
                value: `-${value.source}`,
            } satisfies RealLiteralExpression
        }

        throw parseError(
            this.file,
            operator,
            'Unary - is currently supported only for numeric literals',
        )
    }

    parseCallExpression(callee: Expression): CallExpression {
        this.stream.expect('PUNCTUATION', '(')
        const args: Expression[] = []

        let next = this.stream.peek({ skippingNewline: true })
        if (!next) throw new Error('Unexpected EOF in call expression')

        while (!(next.kind === 'PUNCTUATION' && next.symbol === ')')) {
            args.push(this.parseExpression())
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
            callee,
            arguments: args,
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
