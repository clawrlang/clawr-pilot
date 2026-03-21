import { TokenStream } from '../lexer'
import type { Token } from '../lexer'
import { positionedError } from '../lexer/positioned-error'
import type {
    CallExpression,
    Expression,
    ExpressionStatement,
    IdentifierExpression,
    IntegerLiteralExpression,
    MemberExpression,
    Program,
    Statement,
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
            statements.push(this.parseStatement())
            this.consumeStatementTerminator()
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

        throw parseError(
            this.file,
            token,
            `Unexpected token ${token.kind} in expression`,
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

    consumeStatementTerminator() {
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
