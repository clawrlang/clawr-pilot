import { describe, expect, it } from 'bun:test'
import { parseClawr } from '../../src/parser'
import {
    bitfieldSet,
    dataValueSet,
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
    SemanticAnalyzer,
    SemanticProgram,
    stringLengthAndPattern,
    stringLengthRange,
    stringPattern,
    stringTop,
    truthvalueSet,
    truthvalueTop,
} from '../../src/semantics'
import { Program } from '../../src/ast'

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
        expect(bad.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
            [
                'type annotation truthvalue[false|true] is incompatible with initializer truthvalue[ambiguous]',
            ],
        )
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
            "operator '&' requires matching binarylane or ternarylane operands, got binarylane[3] and integer[1]",
            "operator '<' requires matching integer or real operands, got binarylane[3] and integer[1]",
            'if predicate must be truthvalue, got integer[1]',
            "unknown identifier 'missingName'",
        ])

        expect(
            semanticProgram.diagnostics.map(
                (diagnostic) => diagnostic.position,
            ),
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

describe('function parameter mode call checks', () => {
    it('rejects isolated argument passed to ref parameter', () => {
        const program = parseClawr(
            [
                'func makeUnique() -> integer {',
                '  return makeUnique()',
                '}',
                'func takesRef(x: ref integer) -> integer {',
                '  return makeUnique()',
                '}',
                'mut x = 1',
                'takesRef(x)',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)

        expect(
            semanticProgram.diagnostics.map((diagnostic) => diagnostic.message),
        ).toEqual([
            "argument 1 for parameter 'x' must be a ref variable or a function returning ref",
        ])
    })

    it('rejects non-ref call expressions passed to ref parameters', () => {
        const program = parseClawr(
            [
                'func makeUnique() -> integer {',
                '  return makeUnique()',
                '}',
                'func makeIsolated() -> integer {',
                '  return makeUnique()',
                '}',
                'func takesRef(x: ref integer) -> integer {',
                '  return makeUnique()',
                '}',
                'takesRef(makeIsolated())',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)

        expect(
            semanticProgram.diagnostics.map((diagnostic) => diagnostic.message),
        ).toEqual([
            "argument 1 for parameter 'x' must be a ref variable or a function returning ref",
        ])
    })

    it('rejects shared argument passed to const parameter but allows in parameter', () => {
        const program = parseClawr(
            [
                'func makeUnique() -> integer {',
                '  return makeUnique()',
                '}',
                'func makeShared() -> ref integer {',
                '  return makeShared()',
                '}',
                'func takesConst(x: const integer) -> integer {',
                '  return makeUnique()',
                '}',
                'func takesIn(x: integer) -> integer {',
                '  return makeUnique()',
                '}',
                'takesConst(makeShared())',
                'takesIn(makeShared())',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)

        expect(
            semanticProgram.diagnostics.map((diagnostic) => diagnostic.message),
        ).toEqual([
            "argument 1 for parameter 'x' requires isolated semantics (const), got shared",
        ])
    })
})

describe('function return mode checks', () => {
    it('rejects returns whose value family does not match the declared return type', () => {
        const program = parseClawr(
            ['func bad() -> integer {', '  return true', '}'].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)

        expect(
            semanticProgram.diagnostics.map((diagnostic) => diagnostic.message),
        ).toEqual([
            'returned value truthvalue[true] is not assignable to declared return type integer',
        ])
    })

    it('rejects isolated returns for -> ref functions', () => {
        const program = parseClawr(
            ['func bad(x: integer) -> ref integer {', '  return x', '}'].join(
                '\n',
            ),
            'test',
        )

        const semanticProgram = analyzeProgram(program)

        expect(
            semanticProgram.diagnostics.map((diagnostic) => diagnostic.message),
        ).toEqual([
            "return in function 'bad' requires shared semantics for '-> ref', got isolated",
        ])
    })

    it('rejects shared returns for -> const functions', () => {
        const program = parseClawr(
            [
                'func makeShared() -> ref integer {',
                '  return makeShared()',
                '}',
                'func bad() -> const integer {',
                '  return makeShared()',
                '}',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)

        expect(
            semanticProgram.diagnostics.map((diagnostic) => diagnostic.message),
        ).toEqual([
            "return in function 'bad' requires isolated semantics for '-> const', got shared",
        ])
    })

    it('marks isolated non-unique returns for -> T for conservative normalization', () => {
        const program = parseClawr(
            [
                'func needsNormalization(x: integer) -> integer {',
                '  return x',
                '}',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)

        // No diagnostic: isolated non-unique returns are marked for normalization, not rejected
        expect(
            semanticProgram.diagnostics.map((diagnostic) => diagnostic.message),
        ).toEqual([])

        // The return should be marked as requiring conservative normalization
        expect(semanticProgram.returnsRequiringNormalization).toHaveLength(1)
        expect(
            semanticProgram.returnsRequiringNormalization[0].functionName,
        ).toBe('needsNormalization')
    })

    it('rejects shared returns for -> T', () => {
        const program = parseClawr(
            ['func bad(x: ref integer) -> integer {', '  return x', '}'].join(
                '\n',
            ),
            'test',
        )

        const semanticProgram = analyzeProgram(program)

        expect(
            semanticProgram.diagnostics.map((diagnostic) => diagnostic.message),
        ).toEqual([
            "return in function 'bad' requires unique-return semantics for '-> T', got shared",
        ])
    })

    it('accepts unique-return expressions for -> T', () => {
        const program = parseClawr(
            [
                'func makeUnique() -> integer {',
                '  return makeUnique()',
                '}',
                'func ok() -> integer {',
                '  return makeUnique()',
                '}',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)

        expect(semanticProgram.diagnostics).toEqual([])
    })

    it('rejects functions that may exit without returning a value', () => {
        const program = parseClawr(
            ['func bad() -> integer {', '  const x = 1', '}'].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)

        expect(
            semanticProgram.diagnostics.map((diagnostic) => diagnostic.message),
        ).toEqual(["function 'bad' may exit without returning a value"])
    })

    it('accepts if/else bodies that return on all paths', () => {
        const program = parseClawr(
            [
                'func makeUnique() -> integer {',
                '  return makeUnique()',
                '}',
                'func ok(flag: truthvalue) -> integer {',
                '  if (flag) {',
                '    return makeUnique()',
                '  } else {',
                '    return makeUnique()',
                '  }',
                '}',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)

        expect(semanticProgram.diagnostics).toEqual([])
    })
})

describe('truthvalue callable narrowing', () => {
    function infer(source: string) {
        return analyzeProgram(parseClawr(source, 'test'))
    }

    it('infers rotate(x, by:) value set', () => {
        // rotateUp: false→ambiguous, ambiguous→true, true→false
        expect(
            infer('const x = rotate(false, by: false)').bindings.get('x'),
        ).toEqual(truthvalueSet('true'))
        expect(
            infer('const x = rotate(false, by: true)').bindings.get('x'),
        ).toEqual(truthvalueSet('ambiguous'))
        expect(
            infer('const x = rotate(true, by: true)').bindings.get('x'),
        ).toEqual(truthvalueSet('false'))
    })

    it('infers rotateUp and rotateDown aliases', () => {
        expect(infer('const x = rotateUp(false)').bindings.get('x')).toEqual(
            truthvalueSet('ambiguous'),
        )
        expect(infer('const x = rotateDown(true)').bindings.get('x')).toEqual(
            truthvalueSet('ambiguous'),
        )
    })

    it('infers adjust(x, towards:) value set', () => {
        // adjust(false, towards: true) → ambiguous (mismatch)
        expect(
            infer('const x = adjust(false, towards: true)').bindings.get('x'),
        ).toEqual(truthvalueSet('ambiguous'))
        // adjust(true, towards: true) → true (match)
        expect(
            infer('const x = adjust(true, towards: true)').bindings.get('x'),
        ).toEqual(truthvalueSet('true'))
        // adjust(ambiguous, towards: false) → false (ambiguous passes through)
        expect(
            infer('const x = adjust(ambiguous, towards: false)').bindings.get(
                'x',
            ),
        ).toEqual(truthvalueSet('false'))
    })

    it('infers adjustUp and adjustDown aliases', () => {
        expect(infer('const x = adjustDown(true)').bindings.get('x')).toEqual(
            truthvalueSet('ambiguous'),
        )
        expect(infer('const x = adjustUp(false)').bindings.get('x')).toEqual(
            truthvalueSet('ambiguous'),
        )
    })

    it('infers modulate(x, by:) value set', () => {
        // ambiguous absorbs
        expect(
            infer('const x = modulate(ambiguous, by: true)').bindings.get('x'),
        ).toEqual(truthvalueSet('ambiguous'))
        // false * false = true (both neg → pos in balanced ternary)
        expect(
            infer('const x = modulate(false, by: false)').bindings.get('x'),
        ).toEqual(truthvalueSet('true'))
        // false * true = false
        expect(
            infer('const x = modulate(false, by: true)').bindings.get('x'),
        ).toEqual(truthvalueSet('false'))
        // true * true = true
        expect(
            infer('const x = modulate(true, by: true)').bindings.get('x'),
        ).toEqual(truthvalueSet('true'))
    })

    it('infers narrowed set when input spans multiple values', () => {
        // rotate(top, by: true) → all three values, since the rotation is a permutation
        const program = parseClawr(
            [
                'const t = ambiguous',
                'const f = false',
                'const x = rotate(t, by: f)',
            ].join('\n'),
            'test',
        )
        const result = analyzeProgram(program)
        // rotate(ambiguous, by: false) = false — but here t is a singleton
        expect(result.bindings.get('x')).toEqual(truthvalueSet('false'))
    })
})

describe('if/else branch-local narrowing', () => {
    it('narrows identifier predicate inside then/else branches', () => {
        const program = parseClawr(
            [
                'mut p = 1 < 2',
                'if (p) {',
                '  const mustBeTrue: truthvalue in {true} = p',
                '} else {',
                '  const mustBeFalse: truthvalue in {false, ambiguous} = p',
                '}',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)
        expect(semanticProgram.diagnostics).toEqual([])
    })

    it('narrows negated predicate inside then/else branches', () => {
        const program = parseClawr(
            [
                'mut p = 1 < 2',
                'if (!p) {',
                '  const mustBeFalse: truthvalue in {false} = p',
                '} else {',
                '  const mustBeTrueish: truthvalue in {ambiguous, true} = p',
                '}',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)
        expect(semanticProgram.diagnostics).toEqual([])
    })

    it('joins branch assignment results conservatively after if/else', () => {
        const program = parseClawr(
            [
                'mut p = 1 < 2',
                'if (p) {',
                '  p = true',
                '} else {',
                '  p = false',
                '}',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)
        expect(semanticProgram.bindingStates.get('p')).toEqual({
            semantics: 'mut',
            current: truthvalueSet('false', 'true'),
            allowed: truthvalueTop(),
        })
        expect(semanticProgram.bindings.get('p')).toEqual(
            truthvalueSet('false', 'true'),
        )
    })

    it('skips unreachable then-branch for known false predicate', () => {
        const program = parseClawr(
            [
                'const p = false',
                'if (p) { const x = 1 } else { const y = 2 }',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)
        expect(semanticProgram.diagnostics).toEqual([])
    })

    it('skips unreachable else-branch for known true predicate', () => {
        const program = parseClawr(
            [
                'const p = true',
                'if (p) { const x = 1 } else { const y = 2 }',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)
        expect(semanticProgram.diagnostics).toEqual([])
    })
})

describe('DATA-ANALYZE-001: nominal data type registration', () => {
    it('registers a data declaration as a distinct nominal type', () => {
        const program = parseClawr(
            'data Point { x: integer, y: integer }',
            'test',
        )

        const semanticProgram = analyzeProgram(program)
        expect(semanticProgram.diagnostics).toEqual([])

        const point = semanticProgram.dataTypes.get('Point')
        expect(point).toBeDefined()
        expect(point!.name).toBe('Point')
        expect(point!.fields.size).toBe(2)
        expect(point!.fields.get('x')?.valueSet).toEqual(integerTop())
        expect(point!.fields.get('y')?.valueSet).toEqual(integerTop())
    })

    it('registers multiple independent data types', () => {
        const program = parseClawr(
            [
                'data Point { x: integer, y: integer }',
                'data Color { r: integer, g: integer, b: integer }',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)
        expect(semanticProgram.diagnostics).toEqual([])

        expect(semanticProgram.dataTypes.has('Point')).toBe(true)
        expect(semanticProgram.dataTypes.has('Color')).toBe(true)
        expect(semanticProgram.dataTypes.get('Color')!.fields.size).toBe(3)
    })

    it('registers fields with non-integer value set annotations', () => {
        const program = parseClawr(
            'data Foo { alive: truthvalue in {false, true}, label: string }',
            'test',
        )

        const semanticProgram = analyzeProgram(program)
        expect(semanticProgram.diagnostics).toEqual([])

        const foo = semanticProgram.dataTypes.get('Foo')
        expect(foo!.fields.get('alive')?.valueSet).toEqual(
            truthvalueSet('false', 'true'),
        )
        expect(foo!.fields.get('label')?.valueSet).toEqual(stringTop())
    })

    it('rejects duplicate data type names', () => {
        const program = parseClawr(
            ['data Point { x: integer }', 'data Point { y: integer }'].join(
                '\n',
            ),
            'test',
        )

        const semanticProgram = analyzeProgram(program)
        expect(semanticProgram.diagnostics.map((d) => d.message)).toContain(
            "duplicate data type 'Point'",
        )
    })

    it('rejects duplicate field names within a data declaration', () => {
        const program = parseClawr('data Bad { x: integer, x: real }', 'test')

        const semanticProgram = analyzeProgram(program)
        expect(semanticProgram.diagnostics.map((d) => d.message)).toContain(
            "duplicate field 'x' in data type 'Bad'",
        )
    })
})

describe('DATA-ANALYZE-002: context-typed literal enforcement', () => {
    it('rejects a data literal with no type annotation', () => {
        const program = parseClawr(
            'data Point { x: integer, y: integer }\nconst p = { x: 1, y: 2 }',
            'test',
        )

        const semanticProgram = analyzeProgram(program)
        expect(semanticProgram.diagnostics.map((d) => d.message)).toContain(
            'data literal requires a known target type in V1; add a type annotation',
        )
    })

    it('accepts a data literal when the annotation names a registered data type', () => {
        const program = parseClawr(
            [
                'data Point { x: integer, y: integer }',
                'const p: Point = { x: 1, y: 2 }',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)
        expect(semanticProgram.diagnostics).toEqual([])

        expect(semanticProgram.bindingStates.get('p')).toEqual({
            semantics: 'const',
            current: dataValueSet('Point'),
            allowed: dataValueSet('Point'),
        })
    })

    it('accepts mut and ref declarations with a data type annotation', () => {
        const program = parseClawr(
            [
                'data Point { x: integer, y: integer }',
                'mut m: Point = { x: 0, y: 0 }',
                'ref r: Point = { x: 1, y: 1 }',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)
        expect(semanticProgram.diagnostics).toEqual([])

        expect(semanticProgram.bindingStates.get('m')?.semantics).toBe('mut')
        expect(semanticProgram.bindingStates.get('r')?.semantics).toBe('ref')
        expect(semanticProgram.bindings.get('m')).toEqual(dataValueSet('Point'))
        expect(semanticProgram.bindings.get('r')).toEqual(dataValueSet('Point'))
    })

    it('rejects a data literal when annotation does not name a registered data type', () => {
        const program = parseClawr('const p: Unknown = { x: 1 }', 'test')

        const semanticProgram = analyzeProgram(program)
        // 'Unknown' is not in dataTypes, so the early-return path is skipped and
        // inferExpressionValueSet fires the context-type-required diagnostic first.
        const messages = semanticProgram.diagnostics.map((d) => d.message)
        expect(messages).toContain(
            'data literal requires a known target type in V1; add a type annotation',
        )
    })
})

describe('DATA-ANALYZE-003/004: data literal field validation', () => {
    it('accepts a context-typed data literal with all required compatible fields', () => {
        const program = parseClawr(
            [
                'data Person { age: integer, alive: truthvalue in {false, true} }',
                'const p: Person = { age: 42, alive: true }',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)
        expect(semanticProgram.diagnostics).toEqual([])
        expect(semanticProgram.bindings.get('p')).toEqual(
            dataValueSet('Person'),
        )
    })

    it('rejects missing required fields in a context-typed data literal', () => {
        const program = parseClawr(
            [
                'data Person { age: integer, alive: truthvalue }',
                'const p: Person = { age: 42 }',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)
        expect(semanticProgram.diagnostics.map((d) => d.message)).toContain(
            "missing required field 'alive' for data type 'Person'",
        )
    })

    it('rejects unknown fields in a context-typed data literal', () => {
        const program = parseClawr(
            [
                'data Person { age: integer }',
                'const p: Person = { age: 42, extra: true }',
            ].join('\n'),
            'test',
        )

        const semanticProgram = analyzeProgram(program)
        expect(semanticProgram.diagnostics.map((d) => d.message)).toContain(
            "unknown field 'extra' for data type 'Person'",
        )
    })

    it('rejects incompatible field values against declared field value-sets', () => {
        const program = parseClawr(
            [
                'data Person { age: integer, alive: truthvalue in {false, true} }',
                'const p: Person = { age: true, alive: ambiguous }',
            ].join('\n'),
            'test',
        )

        const messages = analyzeProgram(program).diagnostics.map(
            (d) => d.message,
        )
        expect(messages).toContain(
            "field 'age' value truthvalue[true] is not assignable to integer",
        )
        expect(messages).toContain(
            "field 'alive' value truthvalue[ambiguous] is not assignable to truthvalue[false|true]",
        )
    })
})

function analyzeProgram(program: Program): SemanticProgram {
    const analyzer = new SemanticAnalyzer()
    return analyzer.analyzeProgram(program)
}
