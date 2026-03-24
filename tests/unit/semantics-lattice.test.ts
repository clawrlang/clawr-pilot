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
    })
})
