import { describe, expect, it } from 'bun:test'
import { parseClawr } from '../../../src/parser'

describe('parser subset declarations', () => {
    it('parses truthvalue subset declarations with in-set syntax', () => {
        const program = parseClawr(
            'subset boolean = truthvalue in {false, true}',
            'test',
        )

        expect(program.statements[0]).toMatchObject({
            kind: 'SubsetDeclaration',
            identifier: { name: 'boolean' },
            family: 'truthvalue',
            constraint: {
                kind: 'truthvalue-values',
                values: ['false', 'true'],
            },
        })
    })

    it('parses integer subset declarations with in-range syntax', () => {
        const program = parseClawr('subset natural = integer in [0...]', 'test')

        expect(program.statements[0]).toMatchObject({
            kind: 'SubsetDeclaration',
            identifier: { name: 'natural' },
            family: 'integer',
            constraint: {
                kind: 'integer-range',
                min: 0n,
                max: null,
            },
        })
    })

    it('parses bounded and upper-bounded integer range forms', () => {
        const program = parseClawr(
            [
                'subset byte = integer in [0..255]',
                'subset signedByte = integer in [-128..<128]',
                'subset atMostTen = integer in [...10]',
                'subset belowTen = integer in [...<-10]',
                'subset anyInteger = integer in [...]',
            ].join('\n'),
            'test',
        )

        expect(program.statements[0]).toMatchObject({
            kind: 'SubsetDeclaration',
            constraint: {
                kind: 'integer-range',
                min: 0n,
                max: 255n,
                minInclusive: true,
                maxInclusive: true,
            },
        })
        expect(program.statements[1]).toMatchObject({
            kind: 'SubsetDeclaration',
            constraint: {
                kind: 'integer-range',
                min: -128n,
                max: 128n,
                minInclusive: true,
                maxInclusive: false,
            },
        })
        expect(program.statements[2]).toMatchObject({
            kind: 'SubsetDeclaration',
            constraint: {
                kind: 'integer-range',
                min: null,
                max: 10n,
                minInclusive: true,
                maxInclusive: true,
            },
        })
        expect(program.statements[3]).toMatchObject({
            kind: 'SubsetDeclaration',
            constraint: {
                kind: 'integer-range',
                min: null,
                max: -10n,
                minInclusive: true,
                maxInclusive: false,
            },
        })
        expect(program.statements[4]).toMatchObject({
            kind: 'SubsetDeclaration',
            constraint: {
                kind: 'integer-range',
                min: null,
                max: null,
                minInclusive: true,
                maxInclusive: true,
            },
        })
    })

    it('parses real subset declarations with range syntax', () => {
        const program = parseClawr(
            [
                'subset unitInterval = real in [0..<1]',
                'subset capped = real in [...10.5]',
                'subset belowFreezing = real in [...<0]',
                'subset anyReal = real in [...]',
            ].join('\n'),
            'test',
        )

        expect(program.statements[0]).toMatchObject({
            kind: 'SubsetDeclaration',
            constraint: {
                kind: 'real-range',
                min: '0',
                max: '1',
                minInclusive: true,
                maxInclusive: false,
            },
        })
        expect(program.statements[1]).toMatchObject({
            kind: 'SubsetDeclaration',
            constraint: {
                kind: 'real-range',
                min: null,
                max: '10.5',
                minInclusive: true,
                maxInclusive: true,
            },
        })
        expect(program.statements[2]).toMatchObject({
            kind: 'SubsetDeclaration',
            constraint: {
                kind: 'real-range',
                min: null,
                max: '0',
                minInclusive: true,
                maxInclusive: false,
            },
        })
        expect(program.statements[3]).toMatchObject({
            kind: 'SubsetDeclaration',
            constraint: {
                kind: 'real-range',
                min: null,
                max: null,
                minInclusive: true,
                maxInclusive: true,
            },
        })
    })

    it('parses string subset declarations with length and regex syntax', () => {
        const program = parseClawr(
            [
                'subset shortText = string in [1..8]',
                'subset slug = string in /^[a-z0-9-]+$/i',
            ].join('\n'),
            'test',
        )

        expect(program.statements[0]).toMatchObject({
            kind: 'SubsetDeclaration',
            constraint: {
                kind: 'string-length',
                min: 1n,
                max: 8n,
                minInclusive: true,
                maxInclusive: true,
            },
        })
        expect(program.statements[1]).toMatchObject({
            kind: 'SubsetDeclaration',
            constraint: {
                kind: 'string-pattern',
                pattern: '^[a-z0-9-]+$',
                modifiers: 'i',
            },
        })
    })

    it('parses parenthesized single and/or string composite constraints', () => {
        const program = parseClawr(
            [
                'subset shortSlug = string in ([1..8] and /^[a-z0-9-]+$/)',
                'subset broad = string in ([1..8] or /^[a-z0-9-]+$/)',
            ].join('\n'),
            'test',
        )

        expect(program.statements[0]).toMatchObject({
            kind: 'SubsetDeclaration',
            constraint: {
                kind: 'string-composite',
                operator: 'and',
                left: {
                    kind: 'string-length',
                    min: 1n,
                    max: 8n,
                },
                right: {
                    kind: 'string-pattern',
                    pattern: '^[a-z0-9-]+$',
                    modifiers: '',
                },
            },
        })
        expect(program.statements[1]).toMatchObject({
            kind: 'SubsetDeclaration',
            constraint: {
                kind: 'string-composite',
                operator: 'or',
            },
        })
    })
})
