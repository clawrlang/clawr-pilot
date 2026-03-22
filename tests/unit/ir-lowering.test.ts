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
            'print(rotate(f, by: t))',
            'print(rotateUp(f))',
            '',
        ].join('\n')
        const ast = parseClawr(source, 'test-truthvalue-labels.clawr')
        const ir = lowerToCIr(ast)
        const serialized = JSON.stringify(ir)

        expect(serialized).toContain('adjust__towards')
        expect(serialized).toContain('rotate__by')
    })

    it('rejects invalid truthvalue argument labels', () => {
        const source =
            'const f = false\nconst t = true\nprint(adjust(f, by: t))\n'
        const ast = parseClawr(source, 'test-invalid-truthvalue-labels.clawr')

        expect(() => lowerToCIr(ast)).toThrow(
            /Incorrect argument labels in call to adjust\(_:towards:\): have \(_:by:\), expected \(_:towards:\)/,
        )
    })

    it('rejects unlabeled truthvalue calls when labels are part of the signature', () => {
        const source = 'const f = false\nconst t = true\nprint(rotate(f, t))\n'
        const ast = parseClawr(source, 'test-unlabeled-truthvalue-call.clawr')

        expect(() => lowerToCIr(ast)).toThrow(
            /Incorrect argument labels in call to rotate\(_:by:\): have \(_:_:\), expected \(_:by:\)/,
        )
    })

    it('rejects truthvalue base functions in method-call form', () => {
        const adjustSource =
            'const a = ambiguous\nconst t = true\nprint(a.adjust(towards: t))\n'
        const adjustAst = parseClawr(
            adjustSource,
            'test-truthvalue-adjust-method-form.clawr',
        )
        expect(() => lowerToCIr(adjustAst)).toThrow(
            /No method named adjust\(towards:\)\./,
        )

        const rotateSource =
            'const a = ambiguous\nconst t = true\nprint(a.rotate(by: t))\n'
        const rotateAst = parseClawr(
            rotateSource,
            'test-truthvalue-rotate-method-form.clawr',
        )
        expect(() => lowerToCIr(rotateAst)).toThrow(
            /No method named rotate\(by:\)\./,
        )

        const rotateUpSource = 'const a = ambiguous\nprint(a.rotateUp())\n'
        const rotateUpAst = parseClawr(
            rotateUpSource,
            'test-truthvalue-rotate-up-method-form.clawr',
        )
        expect(() => lowerToCIr(rotateUpAst)).toThrow(
            /No method named rotateUp\(\)\./,
        )
    })

    it('lists candidate signatures for unknown truthvalue free-function calls', () => {
        const source =
            'const f = false\nconst t = true\nprint(spin(f, by: t))\n'
        const ast = parseClawr(source, 'test-unknown-truthvalue-function.clawr')

        expect(() => lowerToCIr(ast)).toThrow(
            /No function named spin\(_:by:\)\. Candidates: .*adjust\(_:towards:\).*rotate\(_:by:\).*rotateUp\(_:\).*adjustDown\(_:\)\./,
        )
    })
})
