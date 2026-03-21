import { describe, expect, it } from 'bun:test'
import { parseClawr } from '../../src/parser'

describe('parser statement separators', () => {
    it('allows newline-separated statements without semicolons', () => {
        const program = parseClawr(
            'const x = 42\nprint(x.toString())\n',
            'test',
        )

        expect(program.statements).toHaveLength(2)
        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            semantics: 'const',
        })
        expect(program.statements[1]).toMatchObject({
            kind: 'ExpressionStatement',
        })
    })

    it('allows semicolon-separated statements on the same line', () => {
        const program = parseClawr('const x = 42; print(x.toString())', 'test')
        expect(program.statements).toHaveLength(2)
    })

    it('requires semicolon when two statements share a line', () => {
        expect(() =>
            parseClawr('const x = 42 print(x.toString())', 'test'),
        ).toThrowError(
            /Statements on the same line must be separated by a semicolon/,
        )
    })

    it('includes source position in the diagnostic', () => {
        expect(() =>
            parseClawr('const x = 42 print(x.toString())', 'src/hello.clawr'),
        ).toThrowError(/src\/hello\.clawr:1:14:/)
    })
})

describe('parser variable declaration semantics', () => {
    for (const semantics of ['const', 'mut', 'ref'] as const) {
        it(`allows ${semantics} variables`, () => {
            const program = parseClawr(`${semantics} x = 42`, 'test')

            expect(program.statements).toHaveLength(1)
            expect(program.statements[0]).toMatchObject({
                kind: 'VariableDeclaration',
                semantics,
            })
        })
    }

    for (const semantics of ['let', 'var'] as const) {
        it(`disallows ${semantics} variables`, () => {
            expect(() =>
                parseClawr(`${semantics} x = 42`, 'test'),
            ).toThrowError()
        })
    }
})

describe('parser truthvalue literals', () => {
    it('parses truthvalue declaration and print expression', () => {
        const program = parseClawr(
            'const maybe = ambiguous\nprint(maybe)',
            'test',
        )

        expect(program.statements).toHaveLength(2)
        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            semantics: 'const',
            initializer: {
                kind: 'TruthLiteral',
                value: 'ambiguous',
            },
        })
    })
})

describe('parser real literals', () => {
    it('parses real declaration with grouped digits', () => {
        const program = parseClawr('const pi = 3.141_592_653', 'test')

        expect(program.statements).toHaveLength(1)
        expect(program.statements[0]).toMatchObject({
            kind: 'VariableDeclaration',
            semantics: 'const',
            initializer: {
                kind: 'RealLiteral',
                value: '3.141592653',
            },
        })
    })
})
