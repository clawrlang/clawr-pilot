import { describe, expect, it } from 'bun:test'
import { parseClawr } from '../../src/parser'
import { lowerToCIr } from '../../src/codegen'

describe('codegen lowering behavior', () => {
    it('lowers tritfield constructor with canonical lane encoding', () => {
        const source = [
            'const a = tritfield("0?1")',
            'const b = tritfield("1?0")',
            '',
        ].join('\n')

        const ir = lowerToCIr(
            parseClawr(source, 'test-tritfield-constructor-lowering.clawr'),
        )
        const serialized = JSON.stringify(ir)

        // Canonical mapping uses 0->00, ?->01, 1->11 on each lane.
        expect(serialized).toContain('7ULL')
        expect(serialized).toContain('52ULL')
    })

    it('lowers bitfield constructor and lane operators', () => {
        const source = [
            'const a = bitfield("1010")',
            'const b = bitfield("1100")',
            'const c = a & b',
            'const d = c | a',
            'const e = c ^ b',
            'const f = ~e',
            '',
        ].join('\n')

        const ir = lowerToCIr(
            parseClawr(source, 'test-bitfield-lowering.clawr'),
        )
        const serialized = JSON.stringify(ir)

        expect(serialized).toContain('unsigned long long')
        expect(serialized).toContain('10ULL')
        expect(serialized).toContain('12ULL')
        expect(serialized).toContain(') & (')
        expect(serialized).toContain(') | (')
        expect(serialized).toContain(') ^ (')
        expect(serialized).toContain('~(')
    })

    it('lowers integer binary operators to Integer runtime calls', () => {
        const source = [
            'const a = 10',
            'const b = 2',
            'const sum = a + b',
            'const diff = a - b',
            'const prod = a * b',
            'const quot = a / b',
            'const pow = a ^ b',
            'print(pow.toString())',
            '',
        ].join('\n')

        const ir = lowerToCIr(parseClawr(source, 'test-int-lowering.clawr'))
        const serialized = JSON.stringify(ir)

        expect(serialized).toContain('Integer¸add')
        expect(serialized).toContain('Integer¸subtract')
        expect(serialized).toContain('Integer¸multiply')
        expect(serialized).toContain('Integer¸divide')
        expect(serialized).toContain('Integer¸power')
    })

    it('lowers real binary operators to Real runtime calls', () => {
        const source = [
            'const x = 2.0',
            'const y = 3.0',
            'const sum = x + y',
            'const diff = x - y',
            'const prod = x * y',
            'const quot = x / y',
            'const pow = x ^ y',
            'print(pow.toString())',
            '',
        ].join('\n')

        const ir = lowerToCIr(parseClawr(source, 'test-real-lowering.clawr'))
        const serialized = JSON.stringify(ir)

        expect(serialized).toContain('Real¸add')
        expect(serialized).toContain('Real¸subtract')
        expect(serialized).toContain('Real¸multiply')
        expect(serialized).toContain('Real¸divide')
        expect(serialized).toContain('Real¸power')
    })

    it('lowers truthvalue operators and free aliases to canonical runtime helpers', () => {
        const source = [
            'const f = false',
            'const a = ambiguous',
            'const t = true',
            'const neg = !t',
            'const both = t && a',
            'const either = f || a',
            'print(rotateUp(f))',
            'print(rotateDown(t))',
            'print(adjustUp(a))',
            'print(adjustDown(a))',
            'print(neg)',
            'print(both)',
            'print(either)',
            '',
        ].join('\n')

        const ir = lowerToCIr(parseClawr(source, 'test-truth-lowering.clawr'))
        const serialized = JSON.stringify(ir)

        expect(serialized).toContain('rotate__by')
        expect(serialized).toContain('adjust__towards')
        expect(serialized).toContain('(2 -')
        expect(serialized).toContain(' ? (')
        expect(serialized).not.toContain('rotateUp')
        expect(serialized).not.toContain('adjustUp')
    })

    it('rejects non-truth print argument without toString conversion', () => {
        const source = 'print(1)\n'
        const ast = parseClawr(source, 'test-print-non-truth-literal.clawr')

        expect(() => lowerToCIr(ast)).toThrow(
            /Only truthvalue expressions and <identifier>\.toString\(\) are supported as print arguments/,
        )
    })

    it('rejects toString calls on non-identifier receivers', () => {
        const source = 'print(1.toString())\n'
        const ast = parseClawr(source, 'test-tostring-non-identifier.clawr')

        expect(() => lowerToCIr(ast)).toThrow(
            /toString\(\) receiver must currently be a variable/,
        )
    })
})
