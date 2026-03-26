import { describe, expect, it } from 'bun:test'
import { parseClawr } from '../../../src/parser'

describe('parser data field separators', () => {
    it('parses data declarations with mixed newline and comma separators', () => {
        const program = parseClawr(
            [
                'data Person {',
                '  name: string,',
                '  age: integer',
                '  alive: truthvalue,',
                '}',
            ].join('\n'),
            'test',
        )

        expect(program.statements).toHaveLength(1)
        expect(program.statements[0]).toMatchObject({
            kind: 'DataDeclaration',
            identifier: { name: 'Person' },
            fields: [{ name: 'name' }, { name: 'age' }, { name: 'alive' }],
        })
    })

    it('parses data literals with mixed newline and comma separators', () => {
        const program = parseClawr(
            [
                'const person = {',
                '  name: "Ada",',
                '  age: 42',
                '  alive: true,',
                '}',
            ].join('\n'),
            'test',
        )

        expect(program.statements).toHaveLength(1)
        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            semantics: 'const',
            initializer: {
                kind: 'DataLiteral',
                fields: [{ name: 'name' }, { name: 'age' }, { name: 'alive' }],
            },
        })
    })
})

describe('parser data declarations', () => {
    it('parses data declarations with typed fields', () => {
        const program = parseClawr(
            'data Person { age: integer, alive: truthvalue }',
            'test',
        )

        expect(program.statements).toHaveLength(1)
        expect(program.statements[0]).toMatchObject({
            kind: 'DataDeclaration',
            identifier: { name: 'Person' },
            fields: [
                {
                    name: 'age',
                    typeAnnotation: {
                        kind: 'subset',
                        family: 'integer',
                    },
                },
                {
                    name: 'alive',
                    typeAnnotation: {
                        kind: 'subset',
                        family: 'truthvalue',
                    },
                },
            ],
        })
    })

    it('parses data declarations with newline-separated fields', () => {
        const program = parseClawr(
            [
                'data Person {',
                '  age: integer',
                '  alive: truthvalue',
                '}',
            ].join('\n'),
            'test',
        )

        expect(program.statements).toHaveLength(1)
        expect(program.statements[0]).toMatchObject({
            kind: 'DataDeclaration',
            identifier: { name: 'Person' },
            fields: [
                {
                    name: 'age',
                    typeAnnotation: {
                        kind: 'subset',
                        family: 'integer',
                    },
                },
                {
                    name: 'alive',
                    typeAnnotation: {
                        kind: 'subset',
                        family: 'truthvalue',
                    },
                },
            ],
        })
    })

    it('rejects malformed field separators', () => {
        expect(() =>
            parseClawr(
                'data Person { age: integer alive: truthvalue }',
                'test',
            ),
        ).toThrowError(/Expected , or } in data field list/)
    })
})

describe('parser data literals', () => {
    it('parses data literals with named fields', () => {
        const program = parseClawr(
            'const person = { age: 42, alive: true }',
            'test',
        )

        expect(program.statements).toHaveLength(1)
        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            semantics: 'const',
            initializer: {
                kind: 'DataLiteral',
                fields: [
                    {
                        name: 'age',
                        value: {
                            kind: 'IntegerLiteral',
                            value: 42n,
                        },
                    },
                    {
                        name: 'alive',
                        value: {
                            kind: 'TruthLiteral',
                            value: 'true',
                        },
                    },
                ],
            },
        })
    })

    it('parses data literals with newline-separated fields', () => {
        const program = parseClawr(
            ['const person = {', '  age: 42', '  alive: true', '}'].join('\n'),
            'test',
        )

        expect(program.statements).toHaveLength(1)
        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            semantics: 'const',
            initializer: {
                kind: 'DataLiteral',
                fields: [
                    {
                        name: 'age',
                        value: {
                            kind: 'IntegerLiteral',
                            value: 42n,
                        },
                    },
                    {
                        name: 'alive',
                        value: {
                            kind: 'TruthLiteral',
                            value: 'true',
                        },
                    },
                ],
            },
        })
    })

    it('parses data literals with complex expressions as field values', () => {
        const program = parseClawr(
            'const person = { age: 21 + 21, alive: !false }',
            'test',
        )

        expect(program.statements).toHaveLength(1)
        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            semantics: 'const',
            initializer: {
                kind: 'DataLiteral',
                fields: [
                    {
                        name: 'age',
                        value: {
                            kind: 'BinaryExpression',
                            operator: '+',
                        },
                    },
                    {
                        name: 'alive',
                        value: {
                            kind: 'UnaryExpression',
                            operator: '!',
                        },
                    },
                ],
            },
        })
    })

    it('parses data literals with mixed comma and newline separators', () => {
        const program = parseClawr(
            ['const person = {', '  age: 42,', '  alive: true', '}'].join('\n'),
            'test',
        )

        expect(program.statements).toHaveLength(1)
        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            semantics: 'const',
            initializer: {
                kind: 'DataLiteral',
                fields: [
                    {
                        name: 'age',
                    },
                    {
                        name: 'alive',
                    },
                ],
            },
        })
    })

    it('rejects malformed data literal separators', () => {
        expect(() =>
            parseClawr('const person = { age: 42 alive: true }', 'test'),
        ).toThrowError(/Expected , or } in data literal/)
    })

    it('parses empty data literal', () => {
        const program = parseClawr('const empty = {}', 'test')

        expect(program.statements).toHaveLength(1)
        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            semantics: 'const',
            initializer: {
                kind: 'DataLiteral',
                fields: [],
            },
        })
    })
})
