import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'bun:test'
import { parseClawr } from '../../src/parser'
import { lowerToCIr } from '../../src/codegen'

describe('IR lowering snapshot', () => {
    it('matches the canonical IR for const integer print program', () => {
        const source = 'const x = 42\nprint(x.toString())\n'
        const ast = parseClawr(source, 'test-input.clawr')
        const ir = lowerToCIr(ast)

        const expectedPath = path.join(
            __dirname,
            'snapshots',
            'const-integer.ir.json',
        )
        const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf-8'))

        expect(ir).toEqual(expected)
    })

    it('matches the canonical IR for const real print program', () => {
        const source = 'const x = -2.5e+3\nprint(x.toString())\n'
        const ast = parseClawr(source, 'test-real-input.clawr')
        const ir = lowerToCIr(ast)

        const expectedPath = path.join(
            __dirname,
            'snapshots',
            'real-to-string.ir.json',
        )
        const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf-8'))

        expect(ir).toEqual(expected)
    })

    it('mangles labeled truthvalue helper names into C calls', () => {
        const source = [
            'const f = false',
            'const t = true',
            'print(adjust(f, towards: t))',
            'print(f.rotate(by: t))',
            'print(f.rotateUp())',
            '',
        ].join('\n')
        const ast = parseClawr(source, 'test-truthvalue-labels.clawr')
        const ir = lowerToCIr(ast)
        const serialized = JSON.stringify(ir)

        expect(serialized).toContain('adjust__towards')
        expect(serialized).toContain('rotate__by')
        expect(serialized).not.toContain('TruthValue·')
    })

    it('rejects invalid truthvalue argument labels', () => {
        const source =
            'const f = false\nconst t = true\nprint(adjust(f, by: t))\n'
        const ast = parseClawr(source, 'test-invalid-truthvalue-labels.clawr')

        expect(() => lowerToCIr(ast)).toThrow(
            /Invalid labels for adjust\(\.\.\.\): argument 1 must be unlabeled, argument 2 must be labeled towards:/,
        )
    })

    it('rejects unlabeled truthvalue calls when labels are part of the signature', () => {
        const source = 'const f = false\nconst t = true\nprint(rotate(f, t))\n'
        const ast = parseClawr(source, 'test-unlabeled-truthvalue-call.clawr')

        expect(() => lowerToCIr(ast)).toThrow(
            /Invalid labels for rotate\(\.\.\.\): argument 1 must be unlabeled, argument 2 must be labeled by:/,
        )
    })
})
