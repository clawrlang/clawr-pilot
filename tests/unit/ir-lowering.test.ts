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

        const actual = `${JSON.stringify(ir, null, 2)}\n`
        const expectedPath = path.join(
            __dirname,
            'snapshots',
            'const-integer.ir.json',
        )
        const expected = fs.readFileSync(expectedPath, 'utf-8')

        expect(actual).toBe(expected)
    })

    it('matches the canonical IR for const real print program', () => {
        const source = 'const x = -2.5e+3\nprint(x.toString())\n'
        const ast = parseClawr(source, 'test-real-input.clawr')
        const ir = lowerToCIr(ast)

        const actual = `${JSON.stringify(ir, null, 2)}\n`
        const expectedPath = path.join(
            __dirname,
            'snapshots',
            'real-to-string.ir.json',
        )
        const expected = fs.readFileSync(expectedPath, 'utf-8')

        expect(actual).toBe(expected)
    })
})
