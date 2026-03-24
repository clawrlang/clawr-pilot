import { describe, expect, it } from 'bun:test'
import { parseClawr } from '../../src/parser'
import {
    analyzeProgram,
    bitfieldSet,
    equalValueSets,
    integerRange,
    integerSingleton,
    integerTop,
    isSubsetValueSet,
    joinValueSets,
    meetValueSets,
    neverValueSet,
    realRange,
    realSingleton,
    realTop,
    stringLengthAndPattern,
    stringLengthRange,
    stringPattern,
    stringTop,
    truthvalueSet,
    truthvalueTop,
} from '../../src/semantics'

describe('semantics lattice', () => {
    it('joins integer singletons into a covering range', () => {
        expect(
            joinValueSets(integerSingleton(2n), integerSingleton(5n)),
        ).toEqual(integerRange({ min: 2n, max: 5n }))
    })

    it('meets overlapping integer ranges by intersection', () => {
        expect(
            meetValueSets(
                integerRange({ min: 0n, max: 10n }),
                integerRange({ min: 5n, max: 20n }),
            ),
        ).toEqual(integerRange({ min: 5n, max: 10n }))
    })

    it('normalizes equivalent real singleton values', () => {
        expect(
            equalValueSets(realSingleton('3.1400'), realSingleton('3.14')),
        ).toBe(true)
    })

    it('meets disjoint truthvalue sets to never', () => {
        expect(
            meetValueSets(truthvalueSet('false'), truthvalueSet('true')),
        ).toEqual(neverValueSet)
    })

    it('tracks subset relationships for field lengths', () => {
        expect(isSubsetValueSet(bitfieldSet(4), bitfieldSet())).toBe(true)
        expect(isSubsetValueSet(bitfieldSet(), bitfieldSet(4))).toBe(false)
    })

    it('recognizes truthvalue singleton as subset of truthvalue top', () => {
        expect(
            isSubsetValueSet(truthvalueSet('ambiguous'), truthvalueTop()),
        ).toBe(true)
    })

    it('meets open real intervals correctly', () => {
        expect(
            meetValueSets(
                realRange({ min: '0.0', max: '1.0', maxInclusive: false }),
                realRange({ min: '1.0', minInclusive: false, max: '2.0' }),
            ),
        ).toEqual(neverValueSet)
    })
})

describe('semantic scaffold', () => {
    it('records literal and field-annotation bindings it can infer today', () => {
        const program = parseClawr(
            [
                'const i = 42',
                'const r = 3.14',
                'const t = ambiguous',
                'const s = "hello"',
                'const b: bitfield[4] = bitfield("1010")',
                'const q: tritfield[3] = tritfield("0?1")',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)
        expect(semanticProgram.diagnostics).toEqual([])

        expect(semanticProgram.bindings.get('i')).toEqual(integerSingleton(42n))
        expect(semanticProgram.bindings.get('r')).toEqual(realSingleton('3.14'))
        expect(semanticProgram.bindings.get('t')).toEqual(
            truthvalueSet('ambiguous'),
        )
        expect(semanticProgram.bindings.get('s')).toEqual({
            family: 'string',
            form: 'singleton',
            value: 'hello',
        })
        expect(semanticProgram.bindings.get('b')).toEqual(bitfieldSet(4))
        expect(semanticProgram.bindings.get('q')).toEqual({
            family: 'tritfield',
            length: 3,
        })
    })

    it('infers identifier and operator expressions from existing bindings', () => {
        const program = parseClawr(
            [
                'const i = 42',
                'const iAlias = i',
                'const iNeg = -i',
                'const iArith = i + iAlias',
                'const r = 2.5e+3',
                'const rNeg = -r',
                'const rArith = r / rNeg',
                'const t = ambiguous',
                'const notT = !t',
                'const andT = t && true',
                'const b = bitfield("1010")',
                'const bFlip = ~b',
                'const cmp = i < iNeg',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)
        expect(semanticProgram.diagnostics).toEqual([])

        expect(semanticProgram.bindings.get('iAlias')).toEqual(
            integerSingleton(42n),
        )
        expect(semanticProgram.bindings.get('iNeg')).toEqual(
            integerSingleton(-42n),
        )
        expect(semanticProgram.bindings.get('iArith')).toEqual(integerTop())

        expect(semanticProgram.bindings.get('rNeg')).toEqual(
            realSingleton('-2500'),
        )
        expect(semanticProgram.bindings.get('rArith')).toEqual(realTop())

        expect(semanticProgram.bindings.get('notT')).toEqual(
            truthvalueSet('ambiguous'),
        )
        expect(semanticProgram.bindings.get('andT')).toEqual(
            truthvalueSet('ambiguous'),
        )

        expect(semanticProgram.bindings.get('b')).toEqual(bitfieldSet(4))
        expect(semanticProgram.bindings.get('bFlip')).toEqual(bitfieldSet(4))

        expect(semanticProgram.bindings.get('cmp')).toEqual(
            truthvalueSet('false', 'true'),
        )

        const iBinding = semanticProgram.bindingStates.get('i')
        expect(iBinding).toEqual({
            semantics: 'const',
            current: integerSingleton(42n),
            allowed: integerSingleton(42n),
        })
    })

    it('tracks current vs allowed sets for mut declarations', () => {
        const program = parseClawr(
            [
                'mut i = 42',
                'mut r = 3.14',
                'mut t = ambiguous',
                'mut s = "hello"',
                'mut b: bitfield[4] = bitfield("1010")',
                'mut q: tritfield[3] = tritfield("0?1")',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)
        expect(semanticProgram.diagnostics).toEqual([])

        expect(semanticProgram.bindings.get('i')).toEqual(integerSingleton(42n))
        expect(semanticProgram.bindings.get('r')).toEqual(realSingleton('3.14'))

        expect(semanticProgram.bindingStates.get('i')).toEqual({
            semantics: 'mut',
            current: integerSingleton(42n),
            allowed: integerTop(),
        })
        expect(semanticProgram.bindingStates.get('r')).toEqual({
            semantics: 'mut',
            current: realSingleton('3.14'),
            allowed: realTop(),
        })
        expect(semanticProgram.bindingStates.get('t')).toEqual({
            semantics: 'mut',
            current: truthvalueSet('ambiguous'),
            allowed: truthvalueTop(),
        })
        expect(semanticProgram.bindingStates.get('s')).toEqual({
            semantics: 'mut',
            current: {
                family: 'string',
                form: 'singleton',
                value: 'hello',
            },
            allowed: stringTop(),
        })
        expect(semanticProgram.bindingStates.get('b')).toEqual({
            semantics: 'mut',
            current: bitfieldSet(4),
            allowed: bitfieldSet(4),
        })
        expect(semanticProgram.bindingStates.get('q')).toEqual({
            semantics: 'mut',
            current: {
                family: 'tritfield',
                length: 3,
            },
            allowed: {
                family: 'tritfield',
                length: 3,
            },
        })
    })

    it('rejects ref declarations for value families in this stage', () => {
        const program = parseClawr('ref r = 3.14', 'test')

        const semanticProgram = analyzeProgram(program)

        expect(
            semanticProgram.diagnostics.map((diagnostic) => diagnostic.message),
        ).toEqual([
            'ref is only supported for shared structures (data/object/service), got real[3.14]',
        ])
        expect(semanticProgram.bindingStates.has('r')).toBe(false)
        expect(semanticProgram.bindings.has('r')).toBe(false)
    })

    it('supports subset declarations and checks initializer compatibility', () => {
        const okProgram = parseClawr(
            [
                'mut i: integer = 42',
                'mut t: truthvalue in {false, true} = false',
            ].join('\n'),
            'test',
        )
        const ok = analyzeProgram(okProgram)
        expect(ok.diagnostics).toEqual([])
        expect(ok.bindingStates.get('i')).toEqual({
            semantics: 'mut',
            current: integerSingleton(42n),
            allowed: integerTop(),
        })
        expect(ok.bindingStates.get('t')).toEqual({
            semantics: 'mut',
            current: truthvalueSet('false'),
            allowed: truthvalueSet('false', 'true'),
        })

        const badProgram = parseClawr(
            'mut t: truthvalue in {false, true} = ambiguous',
            'test',
        )
        const bad = analyzeProgram(badProgram)
        expect(
            bad.diagnostics.map((diagnostic) => diagnostic.message),
        ).toEqual([
            'type annotation truthvalue[false|true] is incompatible with initializer truthvalue[ambiguous]',
        ])
    })

    it('supports complete integer range constraints in declarations and aliases', () => {
        const program = parseClawr(
            [
                'subset byte = integer in [0..255]',
                'subset signedByte = integer in [-128..<128]',
                'subset atMostTen = integer in [...10]',
                'subset anyInteger = integer in [...]',
                'mut b: byte = 255',
                'mut s: signedByte = -128',
                'mut t: atMostTen = -100',
                'mut a: anyInteger = 42',
                's = 128',
                't = 11',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)

        expect(semanticProgram.bindingStates.get('b')).toEqual({
            semantics: 'mut',
            current: integerSingleton(255n),
            allowed: integerRange({ min: 0n, max: 255n }),
        })
        expect(semanticProgram.bindingStates.get('s')).toEqual({
            semantics: 'mut',
            current: integerSingleton(-128n),
            allowed: integerRange({
                min: -128n,
                max: 128n,
                maxInclusive: false,
            }),
        })
        expect(semanticProgram.bindingStates.get('t')).toEqual({
            semantics: 'mut',
            current: integerSingleton(-100n),
            allowed: integerRange({ max: 10n }),
        })
        expect(semanticProgram.bindingStates.get('a')).toEqual({
            semantics: 'mut',
            current: integerSingleton(42n),
            allowed: integerRange({}),
        })
        expect(
            semanticProgram.diagnostics.map((diagnostic) => diagnostic.message),
        ).toEqual([
            'assigned value integer[128] is not assignable to allowed set integer[-128..<128]',
            'assigned value integer[11] is not assignable to allowed set integer[...10]',
        ])
    })

    it('supports complete real range constraints in declarations and aliases', () => {
        const program = parseClawr(
            [
                'subset unitInterval = real in [0..<1]',
                'subset capped = real in [...10.5]',
                'subset anyReal = real in [...]',
                'mut u: unitInterval = 0.5',
                'mut c: capped = -10.0',
                'mut a: anyReal = 42.0',
                'u = 1.0',
                'c = 10.6',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)

        expect(semanticProgram.bindingStates.get('u')).toEqual({
            semantics: 'mut',
            current: realSingleton('0.5'),
            allowed: realRange({ min: '0', max: '1', maxInclusive: false }),
        })
        expect(semanticProgram.bindingStates.get('c')).toEqual({
            semantics: 'mut',
            current: realSingleton('-10'),
            allowed: realRange({ max: '10.5' }),
        })
        expect(semanticProgram.bindingStates.get('a')).toEqual({
            semantics: 'mut',
            current: realSingleton('42'),
            allowed: realRange({}),
        })
        expect(
            semanticProgram.diagnostics.map((diagnostic) => diagnostic.message),
        ).toEqual([
            'assigned value real[1] is not assignable to allowed set real[0..<1]',
            'assigned value real[10.6] is not assignable to allowed set real[...10.5]',
        ])
    })

    it('supports string length and regex constraints in declarations and aliases', () => {
        const program = parseClawr(
            [
                'subset shortText = string in [1..8]',
                'subset slug = string in /^[a-z0-9-]+$/',
                'subset shortSlug = string in ([1..8] and /^[a-z0-9-]+$/)',
                'subset broad = string in ([1..8] or /^[a-z0-9-]+$/)',
                'mut short: shortText = "tag"',
                'mut s: slug = "hello-world"',
                'mut both: shortSlug = "slug1"',
                'mut either: broad = "hello-world"',
                'short = "too long value"',
                's = "Hello World"',
                'both = "TOO-LONG VALUE"',
                'either = "NO SPACES"',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)

        expect(semanticProgram.bindingStates.get('short')).toEqual({
            semantics: 'mut',
            current: {
                family: 'string',
                form: 'singleton',
                value: 'tag',
            },
            allowed: stringLengthRange({ min: 1n, max: 8n }),
        })
        expect(semanticProgram.bindingStates.get('s')).toEqual({
            semantics: 'mut',
            current: {
                family: 'string',
                form: 'singleton',
                value: 'hello-world',
            },
            allowed: stringPattern('^[a-z0-9-]+$'),
        })
        expect(semanticProgram.bindingStates.get('both')).toEqual({
            semantics: 'mut',
            current: {
                family: 'string',
                form: 'singleton',
                value: 'slug1',
            },
            allowed: stringLengthAndPattern({
                min: 1n,
                max: 8n,
                pattern: '^[a-z0-9-]+$',
            }),
        })
        expect(
            semanticProgram.diagnostics.map((diagnostic) => diagnostic.message),
        ).toEqual([
            'assigned value string["too long value"] is not assignable to allowed set string[length 1..8]',
            'assigned value string["Hello World"] is not assignable to allowed set string[/^[a-z0-9-]+$/]',
            'assigned value string["TOO-LONG VALUE"] is not assignable to allowed set string[length 1..8 and /^[a-z0-9-]+$/]',
        ])
    })

    it('supports subset aliases declared with in-constraints', () => {
        const program = parseClawr(
            [
                'subset boolean = truthvalue in {false, true}',
                'subset natural = integer in [0...]',
                'mut b: boolean = true',
                'mut n: natural = 42',
                'n = -1',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)

        expect(semanticProgram.bindingStates.get('b')).toEqual({
            semantics: 'mut',
            current: truthvalueSet('true'),
            allowed: truthvalueSet('false', 'true'),
        })
        expect(
            semanticProgram.diagnostics.map((diagnostic) => diagnostic.message),
        ).toEqual([
            'assigned value integer[-1] is not assignable to allowed set integer[0...]',
        ])
    })

    it('reports unknown subset aliases in annotations', () => {
        const program = parseClawr('mut x: missingAlias = 1', 'test')
        const semanticProgram = analyzeProgram(program)

        expect(
            semanticProgram.diagnostics.map((diagnostic) => diagnostic.message),
        ).toEqual([
            "unknown subset alias 'missingAlias'",
            'type annotation never is incompatible with initializer integer[1]',
        ])
    })

    it('supports mut assignment and rejects const assignment', () => {
        const program = parseClawr(
            ['mut x = 1', 'x = 2', 'const y = 1', 'y = 2'].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)

        expect(semanticProgram.bindings.get('x')).toEqual(integerSingleton(2n))
        expect(
            semanticProgram.diagnostics.map((diagnostic) => diagnostic.message),
        ).toEqual(["cannot assign to const variable 'y'"])
    })

    it('rejects assignment outside allowed subset', () => {
        const program = parseClawr(
            [
                'mut t: truthvalue in {false, true} = false',
                't = ambiguous',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)

        expect(
            semanticProgram.diagnostics.map((diagnostic) => diagnostic.message),
        ).toEqual([
            'assigned value truthvalue[ambiguous] is not assignable to allowed set truthvalue[false|true]',
        ])
    })

    it('reports family mismatch diagnostics for invalid expressions', () => {
        const program = parseClawr(
            [
                'const i = 1',
                'const b = bitfield("101")',
                'const badUnary = !i',
                'const badLogical = i && true',
                'const badBit = b & i',
                'const badCmp = b < i',
                'if (i) { const ok = true }',
                'const unknownUse = missingName',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)

        expect(
            semanticProgram.diagnostics.map((diagnostic) => diagnostic.message),
        ).toEqual([
            "operator '!' requires truthvalue operand, got integer[1]",
            "operator '&&' requires truthvalue operands, got integer[1] and truthvalue[true]",
            "operator '&' requires matching bitfield or tritfield operands, got bitfield[3] and integer[1]",
            "operator '<' requires matching integer or real operands, got bitfield[3] and integer[1]",
            'if predicate must be truthvalue, got integer[1]',
            "unknown identifier 'missingName'",
        ])

        expect(
            semanticProgram.diagnostics.map((diagnostic) => diagnostic.position),
        ).toEqual([
            { file: 'test', line: 3, column: 18, endLine: 3, endColumn: 19 },
            { file: 'test', line: 4, column: 20, endLine: 4, endColumn: 28 },
            { file: 'test', line: 5, column: 16, endLine: 5, endColumn: 20 },
            { file: 'test', line: 6, column: 16, endLine: 6, endColumn: 20 },
            { file: 'test', line: 7, column: 5, endLine: 7, endColumn: 5 },
            {
                file: 'test',
                line: 8,
                column: 20,
                endLine: 8,
                endColumn: 30,
            },
        ])
    })
})
