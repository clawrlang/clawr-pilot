import { describe, expect, it } from 'bun:test'
import { parseClawr } from '../../../src/parser'

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
            ).toThrowError(
                new RegExp(
                    `Unsupported variable semantics '${semantics}'. Use const, mut, or ref.`,
                ),
            )
        })
    }

    it('includes source position in unsupported semantics diagnostics', () => {
        expect(() => parseClawr('let x = 42', 'src/main.clawr')).toThrowError(
            /src\/main\.clawr:1:1:/,
        )
    })
})

describe('parser assignments', () => {
    it('parses identifier assignment statements', () => {
        const program = parseClawr('mut x = 1\nx = 2', 'test')

        expect(program.statements[1]).toMatchObject({
            kind: 'AssignmentStatement',
            target: { kind: 'Identifier', name: 'x' },
            value: { kind: 'IntegerLiteral', value: 2n },
        })
    })
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

    it('parses unary minus on identifiers as a unary expression', () => {
        const program = parseClawr('const x = -value', 'test')

        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            initializer: {
                kind: 'UnaryExpression',
                operator: '-',
                operand: {
                    kind: 'Identifier',
                    name: 'value',
                },
            },
        })
    })

    it('parses unary minus on parenthesized expressions', () => {
        const program = parseClawr('const x = -(a + b)', 'test')

        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            initializer: {
                kind: 'UnaryExpression',
                operator: '-',
                operand: {
                    kind: 'BinaryExpression',
                    operator: '+',
                },
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

    it('parses comparison operators below arithmetic', () => {
        const program = parseClawr('const x = a + b < c * d', 'test')

        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            initializer: {
                kind: 'BinaryExpression',
                operator: '<',
                left: {
                    kind: 'BinaryExpression',
                    operator: '+',
                },
                right: {
                    kind: 'BinaryExpression',
                    operator: '*',
                },
            },
        })
    })

    it('parses comparison operators above logical and', () => {
        const program = parseClawr('const x = a < b && c < d', 'test')

        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            initializer: {
                kind: 'BinaryExpression',
                operator: '&&',
                left: {
                    kind: 'BinaryExpression',
                    operator: '<',
                },
                right: {
                    kind: 'BinaryExpression',
                    operator: '<',
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

describe('parser if statements', () => {
    it('parses if/else with required parentheses and braces', () => {
        const program = parseClawr(
            [
                'if (true) {',
                '  print("then")',
                '} else {',
                '  print("else")',
                '}',
            ].join('\n'),
            'test',
        )

        expect(program.statements[0]).toMatchObject({
            kind: 'IfStatement',
            predicate: { kind: 'TruthLiteral', value: 'true' },
            thenStatements: [{ kind: 'ExpressionStatement' }],
            elseStatements: [{ kind: 'ExpressionStatement' }],
        })
    })

    it('requires parentheses around the predicate', () => {
        expect(() =>
            parseClawr('if true { print("x") } else { print("y") }', 'test'),
        ).toThrow(/Expected \(, got TRUTH_LITERAL/)
    })

    it('requires braces around branches', () => {
        expect(() => parseClawr('if (true) print("x")', 'test')).toThrow(
            /Expected \{, got IDENTIFIER/,
        )
    })

    it('parses else-if as a nested if in elseStatements', () => {
        const program = parseClawr(
            [
                'if (false) {',
                '  print("a")',
                '} else if (true) {',
                '  print("b")',
                '} else {',
                '  print("c")',
                '}',
            ].join('\n'),
            'test',
        )

        expect(program.statements[0]).toMatchObject({
            kind: 'IfStatement',
            elseStatements: [
                {
                    kind: 'IfStatement',
                    predicate: { kind: 'TruthLiteral', value: 'true' },
                },
            ],
        })
    })
})

describe('parser member assignments', () => {
    it('parses member assignment statements', () => {
        const program = parseClawr(
            'mut box = { value: 1 }\nbox.value = 2',
            'test',
        )
        expect(program.statements[1]).toMatchObject({
            kind: 'AssignmentStatement',
            target: {
                kind: 'MemberExpression',
                object: { kind: 'Identifier', name: 'box' },
                property: 'value',
            },
            value: { kind: 'IntegerLiteral', value: 2n },
        })
    })

    it('parses chained member assignment statements', () => {
        const program = parseClawr(
            'mut obj = { inner: { value: 1 } }\nobj.inner.value = 3',
            'test',
        )
        expect(program.statements[1]).toMatchObject({
            kind: 'AssignmentStatement',
            target: {
                kind: 'MemberExpression',
                object: {
                    kind: 'MemberExpression',
                    object: { kind: 'Identifier', name: 'obj' },
                    property: 'inner',
                },
                property: 'value',
            },
            value: { kind: 'IntegerLiteral', value: 3n },
        })
    })

    it('rejects assignment to non-lvalue expressions', () => {
        expect(() => parseClawr('mut x = 1\n(x + 1) = 2', 'test')).toThrow()
    })
})
