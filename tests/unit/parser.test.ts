import { describe, expect, it } from 'bun:test'
import { parseClawr } from '../../src/parser'

describe('parser statement separators', () => {
    it('allows newline-separated statements without semicolons', () => {
        const program = parseClawr(
            'const x = 42\nprint(x.toString())\n',
            'test',
        )

        expect(program.statements).toHaveLength(2)
        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            semantics: 'const',
        })
        expect(program.statements[1]).toMatchObject({
            kind: 'ExpressionStatement',
        })
    })

    it('allows semicolon-separated statements on the same line', () => {
        const program = parseClawr('const x = 42; print(x.toString())', 'test')
        expect(program.statements).toHaveLength(2)
    })

    it('requires semicolon when two statements share a line', () => {
        expect(() =>
            parseClawr('const x = 42 print(x.toString())', 'test'),
        ).toThrowError(
            /Statements on the same line must be separated by a semicolon/,
        )
    })

    it('includes source position in the diagnostic', () => {
        expect(() =>
            parseClawr('const x = 42 print(x.toString())', 'src/hello.clawr'),
        ).toThrowError(/src\/hello\.clawr:1:14:/)
    })
})

describe('parser variable declaration semantics', () => {
    for (const semantics of ['const', 'mut', 'ref'] as const) {
        it(`allows ${semantics} variables`, () => {
            const program = parseClawr(`${semantics} x = 42`, 'test')

            expect(program.statements).toHaveLength(1)
            expect(program.statements[0]).toMatchObject({
                kind: 'VariableDeclaration',
                semantics,
            })
        })
    }

    for (const semantics of ['let', 'var'] as const) {
        it(`disallows ${semantics} variables`, () => {
            expect(() =>
                parseClawr(`${semantics} x = 42`, 'test'),
            ).toThrowError()
        })
    }
})

describe('parser unicode identifiers', () => {
    it('parses declarations with unicode identifiers', () => {
        const program = parseClawr('const 变量 = 42', 'test')

        expect(program.statements).toHaveLength(1)
        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            semantics: 'const',
            identifier: {
                kind: 'Identifier',
                name: '变量',
            },
        })
    })
})

describe('parser truthvalue literals', () => {
    it('parses truthvalue declaration and print expression', () => {
        const program = parseClawr(
            'const maybe = ambiguous\nprint(maybe)',
            'test',
        )

        expect(program.statements).toHaveLength(2)
        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            semantics: 'const',
            initializer: {
                kind: 'TruthLiteral',
                value: 'ambiguous',
            },
        })
    })
})

describe('parser truthvalue operators', () => {
    it('parses labeled call arguments', () => {
        const program = parseClawr(
            'print(adjust(false, towards: true))',
            'test',
        )

        expect(program.statements[0]).toMatchObject({
            kind: 'ExpressionStatement',
            expression: {
                kind: 'CallExpression',
                callee: { kind: 'Identifier', name: 'print' },
                arguments: [
                    {
                        label: null,
                        value: {
                            kind: 'CallExpression',
                            callee: { kind: 'Identifier', name: 'adjust' },
                            arguments: [
                                {
                                    label: null,
                                    value: {
                                        kind: 'TruthLiteral',
                                        value: 'false',
                                    },
                                },
                                {
                                    label: 'towards',
                                    value: {
                                        kind: 'TruthLiteral',
                                        value: 'true',
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        })
    })

    it('parses unary !', () => {
        const program = parseClawr('const x = !ambiguous', 'test')

        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            initializer: {
                kind: 'UnaryExpression',
                operator: '!',
                operand: {
                    kind: 'TruthLiteral',
                    value: 'ambiguous',
                },
            },
        })
    })

    it('&& binds tighter than ||', () => {
        const program = parseClawr(
            'const x = false || ambiguous && true',
            'test',
        )

        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            initializer: {
                kind: 'BinaryExpression',
                operator: '||',
                left: { kind: 'TruthLiteral', value: 'false' },
                right: {
                    kind: 'BinaryExpression',
                    operator: '&&',
                },
            },
        })
    })

    it('! binds tighter than &&', () => {
        const program = parseClawr('const x = !false && true', 'test')

        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            initializer: {
                kind: 'BinaryExpression',
                operator: '&&',
                left: {
                    kind: 'UnaryExpression',
                    operator: '!',
                    operand: { kind: 'TruthLiteral', value: 'false' },
                },
                right: { kind: 'TruthLiteral', value: 'true' },
            },
        })
    })
})

describe('parser bitfield operators', () => {
    it('parses unary ~', () => {
        const program = parseClawr('const x = ~bitfield("101")', 'test')

        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            initializer: {
                kind: 'UnaryExpression',
                operator: '~',
                operand: {
                    kind: 'CallExpression',
                    callee: { kind: 'Identifier', name: 'bitfield' },
                },
            },
        })
    })

    it('& binds tighter than |', () => {
        const program = parseClawr('const x = a | b & c', 'test')

        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            initializer: {
                kind: 'BinaryExpression',
                operator: '|',
                left: { kind: 'Identifier', name: 'a' },
                right: {
                    kind: 'BinaryExpression',
                    operator: '&',
                    left: { kind: 'Identifier', name: 'b' },
                    right: { kind: 'Identifier', name: 'c' },
                },
            },
        })
    })
})

describe('parser real literals', () => {
    it('parses real declaration with grouped digits', () => {
        const program = parseClawr('const pi = 3.141_592_653', 'test')

        expect(program.statements).toHaveLength(1)
        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            semantics: 'const',
            initializer: {
                kind: 'RealLiteral',
                value: '3.141592653',
            },
        })
    })

    it('parses negated real declaration with signed exponent', () => {
        const program = parseClawr('const x = -2.5e+3', 'test')

        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            initializer: {
                kind: 'RealLiteral',
                value: '-2.5e+3',
            },
        })
    })
})

describe('parser binary expressions', () => {
    it('parses multiplication', () => {
        const program = parseClawr('const c = a * b', 'test')
        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            initializer: {
                kind: 'BinaryExpression',
                operator: '*',
                left: { kind: 'Identifier', name: 'a' },
                right: { kind: 'Identifier', name: 'b' },
            },
        })
    })

    it('parses division', () => {
        const program = parseClawr('const c = a / b', 'test')
        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            initializer: {
                kind: 'BinaryExpression',
                operator: '/',
            },
        })
    })

    it('parses exponentiation', () => {
        const program = parseClawr('const c = a ^ b', 'test')
        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            initializer: {
                kind: 'BinaryExpression',
                operator: '^',
            },
        })
    })

    it('* binds tighter than +', () => {
        const program = parseClawr('const c = a + b * d', 'test')
        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            initializer: {
                kind: 'BinaryExpression',
                operator: '+',
                left: { kind: 'Identifier', name: 'a' },
                right: {
                    kind: 'BinaryExpression',
                    operator: '*',
                    left: { kind: 'Identifier', name: 'b' },
                    right: { kind: 'Identifier', name: 'd' },
                },
            },
        })
    })

    it('^ binds tighter than *', () => {
        const program = parseClawr('const c = a * b ^ d', 'test')
        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            initializer: {
                kind: 'BinaryExpression',
                operator: '*',
                left: { kind: 'Identifier', name: 'a' },
                right: {
                    kind: 'BinaryExpression',
                    operator: '^',
                },
            },
        })
    })

    it('^ is right-associative', () => {
        const program = parseClawr('const c = a ^ b ^ d', 'test')
        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            initializer: {
                kind: 'BinaryExpression',
                operator: '^',
                left: { kind: 'Identifier', name: 'a' },
                right: {
                    kind: 'BinaryExpression',
                    operator: '^',
                    left: { kind: 'Identifier', name: 'b' },
                    right: { kind: 'Identifier', name: 'd' },
                },
            },
        })
    })

    it('| is lower precedence than ^', () => {
        const program = parseClawr('const c = a | b ^ c | d', 'test')
        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            initializer: {
                kind: 'BinaryExpression',
                operator: '|',
                left: {
                    kind: 'BinaryExpression',
                    operator: '|',
                    left: { kind: 'Identifier', name: 'a' },
                    right: {
                        kind: 'BinaryExpression',
                        operator: '^',
                        left: { kind: 'Identifier', name: 'b' },
                        right: { kind: 'Identifier', name: 'c' },
                    },
                },
                right: { kind: 'Identifier', name: 'd' },
            },
        })
    })

    it('^ is lower precedence than &', () => {
        const program = parseClawr('const c = a ^ b & c', 'test')
        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            initializer: {
                kind: 'BinaryExpression',
                operator: '^',
                left: { kind: 'Identifier', name: 'a' },
                right: {
                    kind: 'BinaryExpression',
                    operator: '&',
                    left: { kind: 'Identifier', name: 'b' },
                    right: { kind: 'Identifier', name: 'c' },
                },
            },
        })
    })

    it('parses parenthesized expressions', () => {
        const program = parseClawr('const c = (a + b)', 'test')
        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            initializer: {
                kind: 'BinaryExpression',
                operator: '+',
                left: { kind: 'Identifier', name: 'a' },
                right: { kind: 'Identifier', name: 'b' },
            },
        })
    })

    it('parentheses override default precedence', () => {
        const program = parseClawr('const c = (a | b) ^ (c & d)', 'test')
        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            initializer: {
                kind: 'BinaryExpression',
                operator: '^',
                left: {
                    kind: 'BinaryExpression',
                    operator: '|',
                    left: { kind: 'Identifier', name: 'a' },
                    right: { kind: 'Identifier', name: 'b' },
                },
                right: {
                    kind: 'BinaryExpression',
                    operator: '&',
                    left: { kind: 'Identifier', name: 'c' },
                    right: { kind: 'Identifier', name: 'd' },
                },
            },
        })
    })
})
