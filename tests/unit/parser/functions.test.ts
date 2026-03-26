import { describe, expect, it } from 'bun:test'
import { parseClawr } from '../../../src/parser'

describe('parser function and method declarations', () => {
    it('parses function declarations with parameters and return slots', () => {
        const program = parseClawr(
            [
                'func sum(a: integer, b: integer) -> integer {',
                '  const total = a + b',
                '  print(total)',
                '}',
            ].join('\n'),
            'test',
        )

        expect(program.statements).toHaveLength(1)
        expect(program.statements[0]).toMatchObject({
            kind: 'FunctionDeclaration',
            mutating: false,
            identifier: { name: 'sum' },
            parameters: [
                { name: 'a', mode: 'in', typeName: 'integer' },
                { name: 'b', mode: 'in', typeName: 'integer' },
            ],
            returnSlot: {
                semantics: 'unique',
                typeName: 'integer',
            },
        })
    })

    it('parses mutating func declarations as function declarations with mutating flag', () => {
        const program = parseClawr(
            [
                'mutating func roll(pins: integer) -> const integer {',
                '  const result = pins',
                '  print(result)',
                '}',
            ].join('\n'),
            'test',
        )

        expect(program.statements).toHaveLength(1)
        expect(program.statements[0]).toMatchObject({
            kind: 'FunctionDeclaration',
            mutating: true,
            identifier: { name: 'roll' },
            parameters: [{ name: 'pins', mode: 'in', typeName: 'integer' }],
            returnSlot: {
                semantics: 'const',
                typeName: 'integer',
            },
        })
    })

    it('parses explicit parameter modes and keeps omitted mode as in', () => {
        const program = parseClawr(
            [
                'func demo(a: integer, b: in integer, c: const integer, d: mut integer, e: ref integer) -> ref object {',
                '  print(a)',
                '}',
            ].join('\n'),
            'test',
        )

        expect(program.statements[0]).toMatchObject({
            kind: 'FunctionDeclaration',
            parameters: [
                { name: 'a', mode: 'in', typeName: 'integer' },
                { name: 'b', mode: 'in', typeName: 'integer' },
                { name: 'c', mode: 'const', typeName: 'integer' },
                { name: 'd', mode: 'mut', typeName: 'integer' },
                { name: 'e', mode: 'ref', typeName: 'integer' },
            ],
            returnSlot: { semantics: 'ref', typeName: 'object' },
        })
    })

    it('rejects invalid parameter modes with a clear diagnostic', () => {
        expect(() =>
            parseClawr('func bad(x: pure integer) { print(x) }', 'test'),
        ).toThrowError(
            /Invalid parameter mode 'pure'. Use in, const, mut, or ref./,
        )
    })

    it('rejects invalid return semantic modifiers with a clear diagnostic', () => {
        expect(() =>
            parseClawr('func bad() -> mut integer { const x = 1 }', 'test'),
        ).toThrowError(
            /Invalid return semantics modifier 'mut'. Use const, ref, or omit for unique return./,
        )
    })

    it('parses return statements inside function bodies', () => {
        const program = parseClawr(
            ['func identity(x: integer) -> integer {', '  return x', '}'].join(
                '\n',
            ),
            'test',
        )

        expect(program.statements[0]).toMatchObject({
            kind: 'FunctionDeclaration',
            body: [
                {
                    kind: 'ReturnStatement',
                    value: { kind: 'Identifier', name: 'x' },
                },
            ],
        })
    })
})
