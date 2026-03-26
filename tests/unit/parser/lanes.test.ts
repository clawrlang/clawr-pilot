import { describe, expect, it } from 'bun:test'
import { parseClawr } from '../../../src/parser'

describe('parser lane type annotations', () => {
    it('parses binarylane and ternarylane type annotations', () => {
        const program = parseClawr(
            [
                'const a: binarylane[4] = bitfield("1010")',
                'const b: ternarylane[3] = tritfield("0?1")',
            ].join('\n'),
            'test',
        )

        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            typeAnnotation: {
                kind: 'lane',
                baseName: 'binarylane',
                length: 4,
            },
        })
        expect(program.statements[1]).toMatchObject({
            kind: 'VariableDeclaration',
            typeAnnotation: {
                kind: 'lane',
                baseName: 'ternarylane',
                length: 3,
            },
        })
    })

    it('accepts bitfield/tritfield as temporary aliases', () => {
        const program = parseClawr(
            [
                'const a: bitfield[5] = bitfield("10101")',
                'const b: tritfield[2] = tritfield("0?")',
            ].join('\n'),
            'test',
        )

        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            typeAnnotation: {
                kind: 'lane',
                baseName: 'binarylane',
                length: 5,
            },
        })
        expect(program.statements[1]).toMatchObject({
            kind: 'VariableDeclaration',
            typeAnnotation: {
                kind: 'lane',
                baseName: 'ternarylane',
                length: 2,
            },
        })
    })

    it('parses subset type annotations', () => {
        const program = parseClawr(
            [
                'mut i: integer = 1',
                'mut withinByte: integer in [0..255] = 1',
                'mut r: real = 3.14',
                'mut boundedReal: real in [0..<1] = 0.5',
                'mut s: string = "x"',
                'mut shortLabel: string in [1..8] = "tag"',
                'mut slug: string in /^[a-z0-9-]+$/ = "hello-world"',
                'mut shortSlug: string in ([1..8] and /^[a-z0-9-]+$/) = "slug1"',
                'mut t: truthvalue in {false, true} = true',
            ].join('\n'),
            'test',
        )

        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            typeAnnotation: {
                kind: 'subset',
                family: 'integer',
                truthValues: null,
                integerRange: null,
            },
        })
        expect(program.statements[1]).toMatchObject({
            kind: 'VariableDeclaration',
            typeAnnotation: {
                kind: 'subset',
                family: 'integer',
                truthValues: null,
                integerRange: {
                    kind: 'integer-range',
                    min: 0n,
                    max: 255n,
                    minInclusive: true,
                    maxInclusive: true,
                },
            },
        })
        expect(program.statements[3]).toMatchObject({
            kind: 'VariableDeclaration',
            typeAnnotation: {
                kind: 'subset',
                family: 'real',
                truthValues: null,
                integerRange: null,
                realRange: {
                    kind: 'real-range',
                    min: '0',
                    max: '1',
                    minInclusive: true,
                    maxInclusive: false,
                },
            },
        })
        expect(program.statements[5]).toMatchObject({
            kind: 'VariableDeclaration',
            typeAnnotation: {
                kind: 'subset',
                family: 'string',
                truthValues: null,
                integerRange: null,
                realRange: null,
                stringLength: {
                    kind: 'string-length',
                    min: 1n,
                    max: 8n,
                    minInclusive: true,
                    maxInclusive: true,
                },
            },
        })
        expect(program.statements[6]).toMatchObject({
            kind: 'VariableDeclaration',
            typeAnnotation: {
                kind: 'subset',
                family: 'string',
                truthValues: null,
                integerRange: null,
                realRange: null,
                stringPattern: {
                    pattern: '^[a-z0-9-]+$',
                    modifiers: '',
                },
            },
        })
        expect(program.statements[7]).toMatchObject({
            kind: 'VariableDeclaration',
            typeAnnotation: {
                kind: 'subset',
                family: 'string',
                stringComposite: {
                    kind: 'string-composite',
                    operator: 'and',
                },
            },
        })
        expect(program.statements[8]).toMatchObject({
            kind: 'VariableDeclaration',
            typeAnnotation: {
                kind: 'subset',
                family: 'truthvalue',
                truthValues: ['false', 'true'],
                integerRange: null,
            },
        })
    })

    it('parses named subset aliases in type annotations', () => {
        const program = parseClawr(
            ['subset natural = integer in [0...]', 'mut n: natural = 1'].join(
                '\n',
            ),
            'test',
        )

        expect(program.statements[1]).toMatchObject({
            kind: 'VariableDeclaration',
            typeAnnotation: {
                kind: 'subset-alias',
                name: 'natural',
            },
        })
    })

    it('rejects invalid truthvalue subset members', () => {
        expect(() =>
            parseClawr('const x: truthvalue in {0} = true', 'test'),
        ).toThrow(
            /truthvalue constraints must list truth literals separated by commas/,
        )
    })

    it('rejects invalid integer range forms', () => {
        expect(() =>
            parseClawr('subset bad = integer in [0..]', 'test'),
        ).toThrow(/Use \.\.\. for integer ranges with an omitted upper bound/)
        expect(() =>
            parseClawr('subset bad = integer in [0...10]', 'test'),
        ).toThrow(
            /Lower-bounded integer ranges using \.\.\. cannot specify an upper bound/,
        )
        expect(() =>
            parseClawr('subset bad = integer in [..10]', 'test'),
        ).toThrow(
            /Use \.\.\. before the upper bound when omitting the lower bound/,
        )
        expect(() =>
            parseClawr('subset bad = integer in [..<-10]', 'test'),
        ).toThrow(
            /Use \.\.\. before the upper bound when omitting the lower bound/,
        )
        expect(() =>
            parseClawr('subset bad = integer in [..]', 'test'),
        ).toThrow(
            /Use \.\.\. before the upper bound when omitting the lower bound/,
        )
    })

    it('rejects invalid real range forms', () => {
        expect(() => parseClawr('subset bad = real in [0..]', 'test')).toThrow(
            /Use \.\.\. for real ranges with an omitted upper bound/,
        )
        expect(() =>
            parseClawr('subset bad = real in [0...1]', 'test'),
        ).toThrow(
            /Lower-bounded real ranges using \.\.\. cannot specify an upper bound/,
        )
        expect(() => parseClawr('subset bad = real in [..1]', 'test')).toThrow(
            /Use \.\.\. before the upper bound when omitting the lower bound/,
        )
    })

    it('rejects invalid string constraints', () => {
        expect(() =>
            parseClawr('subset bad = string in [0..]', 'test'),
        ).toThrow(
            /Use \.\.\. for string length ranges with an omitted upper bound/,
        )
        expect(() =>
            parseClawr('subset bad = string in [..8]', 'test'),
        ).toThrow(
            /Use \.\.\. before the upper bound when omitting the lower bound/,
        )
        expect(() => parseClawr('subset bad = string in true', 'test')).toThrow(
            /string constraints must be a length range like \[1\.\.8\] or a regex literal/,
        )
        expect(() =>
            parseClawr('subset bad = string in [1..8] and /x/', 'test'),
        ).toThrow(/Use parentheses around composite string constraints/)
        expect(() =>
            parseClawr(
                'subset bad = string in ([1..8] and /x/ and /y/)',
                'test',
            ),
        ).toThrow(/currently allow only one and\/or operator/)
    })

    it('rejects out-of-range field lengths', () => {
        expect(() =>
            parseClawr('const x: bitfield[0] = bitfield("1")', 'test'),
        ).toThrow(/Lane type annotation length must be in \[1, 64\]/)
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
