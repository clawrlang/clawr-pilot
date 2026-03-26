import { describe, expect, it } from 'bun:test'
import { parseClawr } from '../../../src/parser'

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
