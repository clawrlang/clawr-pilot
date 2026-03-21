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
    const stream = new TokenStream(source, file)
    const statements: Statement[] = []

    skipTrivia(stream)
    while (stream.peek()) {
        statements.push(parseStatement(stream, file))
        consumeStatementTerminator(stream, file)
    }

    return {
        kind: 'Program',
        statements,
    }
}

function parseStatement(stream: TokenStream, file: string): Statement {
    const token = stream.peek({ skippingNewline: true })
    if (!token) throw new Error('Unexpected EOF')

    if (
        token.kind === 'KEYWORD' &&
        (token.keyword === 'const' ||
            token.keyword === 'mut' ||
            token.keyword === 'ref')
    ) {
        return parseVariableDeclaration(stream, file)
    }

    return parseExpressionStatement(stream, file)
}

function parseVariableDeclaration(
    stream: TokenStream,
    file: string,
): VariableDeclaration {
    const token = stream.peek({ skippingNewline: true })
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
    stream.next({ skippingNewline: true })

    const ident = stream.expect('IDENTIFIER')
    stream.expect('PUNCTUATION', '=')
    const initializer = parseExpression(stream, file)

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

function parseExpressionStatement(
    stream: TokenStream,
    file: string,
): ExpressionStatement {
    return {
        kind: 'ExpressionStatement',
        expression: parseExpression(stream, file),
    }
}

function parseExpression(stream: TokenStream, file: string): Expression {
    let expr = parsePrimary(stream, file)

    while (true) {
        const token = stream.peek({ skippingNewline: true })
        if (!token) return expr

        if (token.kind === 'OPERATOR' && token.operator === '.') {
            stream.next({ skippingNewline: true })
            const prop = stream.expect('IDENTIFIER')
            expr = {
                kind: 'MemberExpression',
                object: expr,
                property: prop.identifier,
            } satisfies MemberExpression
            continue
        }

        if (token.kind === 'PUNCTUATION' && token.symbol === '(') {
            expr = parseCallExpression(stream, file, expr)
            continue
        }

        return expr
    }
}

function parsePrimary(stream: TokenStream, file: string): Expression {
    const token = stream.next({ skippingNewline: true })
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
        file,
        token,
        `Unexpected token ${token.kind} in expression`,
    )
}

function parseCallExpression(
    stream: TokenStream,
    file: string,
    callee: Expression,
): CallExpression {
    stream.expect('PUNCTUATION', '(')
    const args: Expression[] = []

    let next = stream.peek({ skippingNewline: true })
    if (!next) throw new Error('Unexpected EOF in call expression')

    while (!(next.kind === 'PUNCTUATION' && next.symbol === ')')) {
        args.push(parseExpression(stream, file))
        next = stream.peek({ skippingNewline: true })
        if (!next) throw new Error('Unexpected EOF in call expression')

        if (next.kind === 'PUNCTUATION' && next.symbol === ',') {
            stream.next({ skippingNewline: true })
            next = stream.peek({ skippingNewline: true })
            if (!next) throw new Error('Unexpected EOF in call expression')
            continue
        }

        if (!(next.kind === 'PUNCTUATION' && next.symbol === ')')) {
            throw parseError(file, next, 'Expected , or ) in argument list')
        }
    }

    stream.expect('PUNCTUATION', ')')

    return {
        kind: 'CallExpression',
        callee,
        arguments: args,
    }
}

function consumeStatementTerminator(stream: TokenStream, file: string) {
    const next = stream.peek()
    if (!next) return

    if (next.kind === 'NEWLINE') {
        skipTrivia(stream)
        return
    }

    if (next.kind === 'PUNCTUATION' && next.symbol === ';') {
        stream.next()
        skipTrivia(stream)
        return
    }

    throw parseError(file, next, 'Expected newline or ; between statements')
}

function skipTrivia(stream: TokenStream) {
    while (stream.peek()?.kind === 'NEWLINE') stream.next()
}

function parseError(file: string, token: Token, message: string): Error {
    return positionedError(message, {
        file,
        line: token.line,
        column: token.column,
    })
}
