import { describe, expect, it } from 'bun:test'
import { parseClawr } from '../../src/parser'
import { lowerToCIr } from '../../src/codegen'
import type { CExpression, CStatement, CTranslationUnit } from '../../src/ir/c'

type CallTraceEntry = {
    callee: string
    args: string[]
}

function findMainFunction(ir: CTranslationUnit) {
    const main = ir.functions.find((fn) => fn.name === 'main')
    if (!main) {
        throw new Error('Expected lowered IR to contain a main function')
    }
    return main
}

function expressionIdentifierName(expression: CExpression): string | null {
    return expression.kind === 'CIdentifier' ? expression.name : null
}

function appendStatementCalls(statement: CStatement, calls: CallTraceEntry[]) {
    if (
        statement.kind === 'CExpressionStatement' &&
        statement.expression.kind === 'CCallExpression'
    ) {
        calls.push({
            callee: statement.expression.callee,
            args: statement.expression.args
                .map(expressionIdentifierName)
                .filter((value): value is string => value !== null),
        })
        return
    }

    if (statement.kind === 'CIfStatement') {
        for (const nested of statement.thenStatements) {
            appendStatementCalls(nested, calls)
        }
        for (const nested of statement.elseStatements) {
            appendStatementCalls(nested, calls)
        }
    }
}

function collectMainCallTrace(ir: CTranslationUnit): CallTraceEntry[] {
    const calls: CallTraceEntry[] = []
    const main = findMainFunction(ir)
    for (const statement of main.statements) {
        appendStatementCalls(statement, calls)
    }
    return calls
}

function countCalls(trace: CallTraceEntry[], callee: string): number {
    return trace.filter((entry) => entry.callee === callee).length
}

function hasCallWithIdentifierArg(
    trace: CallTraceEntry[],
    callee: string,
    identifierName: string,
): boolean {
    return trace.some(
        (entry) =>
            entry.callee === callee && entry.args.includes(identifierName),
    )
}

function countCallsWithIdentifierArg(
    trace: CallTraceEntry[],
    callee: string,
    identifierName: string,
): number {
    return trace.filter(
        (entry) =>
            entry.callee === callee && entry.args.includes(identifierName),
    ).length
}

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

        // Canonical mapping uses two planes: x0 for {?,1}, x1 for {1}.
        expect(serialized).toContain('aˇx0')
        expect(serialized).toContain('aˇx1')
        expect(serialized).toContain('bˇx0')
        expect(serialized).toContain('bˇx1')
        expect(serialized).toContain('3ULL')
        expect(serialized).toContain('1ULL')
        expect(serialized).toContain('6ULL')
        expect(serialized).toContain('4ULL')
    })

    it('lowers tritfield boolean lane operators on split planes', () => {
        const source = [
            'const a = tritfield("0?1")',
            'const b = tritfield("1?0")',
            'const c = a & b',
            'const d = a | b',
            '',
        ].join('\n')

        const ir = lowerToCIr(
            parseClawr(source, 'test-tritfield-boolean-ops-lowering.clawr'),
        )
        const serialized = JSON.stringify(ir)

        expect(serialized).toContain('cˇx0')
        expect(serialized).toContain('cˇx1')
        expect(serialized).toContain('dˇx0')
        expect(serialized).toContain('dˇx1')
        expect(serialized).toContain(') & (')
        expect(serialized).toContain(') | (')
    })

    it('lowers tritfield rotate, adjust, and modulate calls on split planes', () => {
        const source = [
            'const a = tritfield("0?1")',
            'const b = tritfield("1?0")',
            'const r = rotate(a, by: b)',
            'const s = adjust(a, towards: b)',
            'const m = modulate(a, by: b)',
            '',
        ].join('\n')

        const ir = lowerToCIr(
            parseClawr(source, 'test-tritfield-rotate-adjust-lowering.clawr'),
        )
        const serialized = JSON.stringify(ir)

        expect(serialized).toContain('rˇx0')
        expect(serialized).toContain('rˇx1')
        expect(serialized).toContain('sˇx0')
        expect(serialized).toContain('sˇx1')
        expect(serialized).toContain('mˇx0')
        expect(serialized).toContain('mˇx1')
        expect(serialized).toContain('~(')
    })

    it('lowers toString() calls for truthvalue and tritfield variables', () => {
        const source = [
            'const t = true',
            'const f = tritfield("0?1")',
            'print(t.toString())',
            'print(f.toString())',
            '',
        ].join('\n')

        const ir = lowerToCIr(parseClawr(source, 'test-tostring-kinds.clawr'))
        const serialized = JSON.stringify(ir)

        expect(serialized).toContain('truthvalue__toCString')
        expect(serialized).toContain('tritfield__toStringRC')
        expect(serialized).toContain('fˇx0')
        expect(serialized).toContain('fˇx1')
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

    it('lowers annotated bitfield/tritfield declarations', () => {
        const source = [
            'const a: bitfield[4] = bitfield("1010")',
            'const b: bitfield[4] = a ^ bitfield("0011")',
            'const t: tritfield[3] = tritfield("0?1")',
            'const u: tritfield[3] = rotate(t, by: tritfield("???"))',
            'print(b.toString())',
            'print(u.toString())',
            '',
        ].join('\n')

        const ir = lowerToCIr(parseClawr(source, 'test-annotated-fields.clawr'))
        const serialized = JSON.stringify(ir)

        expect(serialized).toContain('bitfield__toStringRC')
        expect(serialized).toContain('tritfield__toStringRC')
    })

    it('lowers unary minus on integer identifiers via Integer¸subtract', () => {
        const source = [
            'const a = 10',
            'const b = -a',
            'print(b.toString())',
            '',
        ].join('\n')

        const ir = lowerToCIr(parseClawr(source, 'test-int-unary-minus.clawr'))
        const serialized = JSON.stringify(ir)

        expect(serialized).toContain('Integer¸subtract')
        expect(serialized).toContain('0LL')
    })

    it('lowers unary minus on real identifiers via Real¸subtract', () => {
        const source = [
            'const a = 2.5e+3',
            'const b = -a',
            'print(b.toString())',
            '',
        ].join('\n')

        const ir = lowerToCIr(parseClawr(source, 'test-real-unary-minus.clawr'))
        const serialized = JSON.stringify(ir)

        expect(serialized).toContain('Real¸subtract')
        expect(serialized).toContain('0.0')
    })

    it('lowers integer comparisons to Integer¸compare truthvalue expressions', () => {
        const source = [
            'const a = 10',
            'const b = 20',
            'print(a < b)',
            'print(a == b)',
            '',
        ].join('\n')

        const ir = lowerToCIr(parseClawr(source, 'test-int-comparisons.clawr'))
        const serialized = JSON.stringify(ir)

        expect(serialized).toContain('Integer¸compare')
        expect(serialized).toContain('? 2 : 0')
    })

    it('lowers real comparisons to Real¸compare truthvalue expressions', () => {
        const source = [
            'const a = 1.5',
            'const b = 2.0',
            'print(a <= b)',
            'print(a != b)',
            '',
        ].join('\n')

        const ir = lowerToCIr(parseClawr(source, 'test-real-comparisons.clawr'))
        const serialized = JSON.stringify(ir)

        expect(serialized).toContain('Real¸compare')
        expect(serialized).toContain('? 2 : 0')
    })

    it('lowers if with true-only branch selection', () => {
        const source = [
            'const x = ambiguous',
            'if (x) {',
            '  print("then")',
            '} else {',
            '  print("else")',
            '}',
            '',
        ].join('\n')

        const ir = lowerToCIr(parseClawr(source, 'test-if-true-only.clawr'))
        const serialized = JSON.stringify(ir)

        expect(serialized).toContain('CIfStatement')
        expect(serialized).toContain('(2 ==')
    })

    it('lowers assignment statements across runtime kinds', () => {
        const source = [
            'mut i = 1',
            'i = 2',
            'mut t = false',
            't = true',
            'mut r = 1.5',
            'r = 2.0',
            'mut b = bitfield("1010")',
            'b = ~b',
            'print(i.toString())',
            '',
        ].join('\n')

        const ir = lowerToCIr(parseClawr(source, 'test-assignments.clawr'))
        const serialized = JSON.stringify(ir)
        const trace = collectMainCallTrace(ir)

        expect(serialized).toContain('CAssignmentStatement')
        expect(serialized).toContain('clawr_int_from_i64')
        expect(serialized).toContain('Real¸fromString')

        // RC-managed assignment replaces prior bindings.
        expect(hasCallWithIdentifierArg(trace, 'releaseRC', 'i')).toBe(true)
        expect(hasCallWithIdentifierArg(trace, 'releaseRC', 'r')).toBe(true)
    })

    it('emits mutateRC before isolated integer mutation', () => {
        const source = ['mut i = 1', 'i = 2', ''].join('\n')

        const ir = lowerToCIr(
            parseClawr(source, 'test-isolated-mutate-rc.clawr'),
        )
        const trace = collectMainCallTrace(ir)

        expect(hasCallWithIdentifierArg(trace, 'mutateRC', 'i')).toBe(true)
    })

    it('does not require mutateRC for shared ref assignments', () => {
        const source = ['ref s = "a"', 's = "b"', ''].join('\n')

        const ir = lowerToCIr(
            parseClawr(source, 'test-shared-assignment.clawr'),
        )
        const trace = collectMainCallTrace(ir)

        expect(countCalls(trace, 'mutateRC')).toBe(0)
        expect(hasCallWithIdentifierArg(trace, 'releaseRC', 's')).toBe(true)
    })

    it('retains borrowed integer aliases on declaration and assignment', () => {
        const source = [
            'const a = 1',
            'const b = a',
            'mut c = 2',
            'c = b',
            'print(c.toString())',
            '',
        ].join('\n')

        const ir = lowerToCIr(
            parseClawr(source, 'test-borrowed-int-alias.clawr'),
        )
        const trace = collectMainCallTrace(ir)

        // Borrowed integer identifiers must be retained when aliased.
        expect(countCalls(trace, 'retainRC')).toBeGreaterThanOrEqual(1)
        expect(hasCallWithIdentifierArg(trace, 'retainRC', 'a')).toBe(true)
        expect(hasCallWithIdentifierArg(trace, 'retainRC', 'b')).toBe(true)
    })

    it('moves fresh integer temporaries and still releases the old target value', () => {
        const source = [
            'mut i = 1',
            'i = 2 + 3',
            'print(i.toString())',
            '',
        ].join('\n')

        const ir = lowerToCIr(
            parseClawr(source, 'test-int-temporary-move.clawr'),
        )
        const trace = collectMainCallTrace(ir)

        // The expression 2 + 3 is lowered from fresh temporaries, so assignment
        // transport should move without retain.
        expect(countCalls(trace, 'retainRC')).toBe(0)

        // Replacing i must release i's previous value before rebinding.
        expect(hasCallWithIdentifierArg(trace, 'releaseRC', 'i')).toBe(true)
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
            /Only truthvalue expressions and supported <identifier>\.toString\(\) calls are supported as print arguments/,
        )
    })

    it('rejects toString calls on non-identifier receivers', () => {
        const source = 'print(1.toString())\n'
        const ast = parseClawr(source, 'test-tostring-non-identifier.clawr')

        expect(() => lowerToCIr(ast)).toThrow(
            /toString\(\) receiver must currently be a variable/,
        )
    })

    it('rejects unsupported bitfield arithmetic with a specific diagnostic', () => {
        const source = [
            'const a = bitfield("101")',
            'const b = bitfield("011")',
            'const c = a + b',
            '',
        ].join('\n')

        const ast = parseClawr(source, 'test-bitfield-invalid-operator.clawr')

        expect(() => lowerToCIr(ast)).toThrow(
            /Bitfield expressions currently support only bitfield\("\.\.\."\) constructors, identifiers, unary ~, and binary &, \|, \^/,
        )
    })

    it('rejects field declarations with mismatched annotated lengths', () => {
        const source = ['const a: bitfield[5] = bitfield("1010")', ''].join(
            '\n',
        )

        const ast = parseClawr(
            source,
            'test-annotated-bitfield-length-mismatch.clawr',
        )

        expect(() => lowerToCIr(ast)).toThrow(
            /bitfield length mismatch for a: declared 5, got 4/,
        )
    })

    it('rejects unsupported tritfield unary operations with a specific diagnostic', () => {
        const source = ['const a = tritfield("0?1")', 'const b = ~a', ''].join(
            '\n',
        )

        const ast = parseClawr(source, 'test-tritfield-invalid-operator.clawr')

        expect(() => lowerToCIr(ast)).toThrow(
            /Tritfield expressions currently support only tritfield\("\.\.\."\) constructors, identifiers, binary &, \|, and calls rotate\(\.\.\., by: \.\.\.\), adjust\(\.\.\., towards: \.\.\.\), modulate\(\.\.\., by: \.\.\.\)/,
        )
    })

    it('rejects tritfield binary operators with mismatched lengths', () => {
        const source = [
            'const a = tritfield("0?1")',
            'const b = tritfield("1?01")',
            'const c = a & b',
            '',
        ].join('\n')

        const ast = parseClawr(source, 'test-tritfield-mismatch-binary.clawr')

        expect(() => lowerToCIr(ast)).toThrow(
            /tritfield operands must have matching lengths for &; got left=3, right=4/,
        )
    })

    it('rejects tritfield calls with mismatched lengths', () => {
        const source = [
            'const a = tritfield("0?1")',
            'const b = tritfield("1?01")',
            'const c = rotate(a, by: b)',
            '',
        ].join('\n')

        const ast = parseClawr(source, 'test-tritfield-mismatch-call.clawr')

        expect(() => lowerToCIr(ast)).toThrow(
            /tritfield operands must have matching lengths for rotate; got left=3, right=4/,
        )
    })

    it('lowers bitfield.toString() to bitfield__toStringRC', () => {
        const source = [
            'const a = bitfield("1010")',
            'const b = a & bitfield("1100")',
            'print(a.toString())',
            'print(b.toString())',
            '',
        ].join('\n')

        const ir = lowerToCIr(
            parseClawr(source, 'test-bitfield-tostring.clawr'),
        )
        const serialized = JSON.stringify(ir)

        expect(serialized).toContain('bitfield__toStringRC')
        expect(serialized).toContain('4U')
    })
})
