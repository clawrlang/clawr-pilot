import { describe, expect, it } from 'bun:test'
import type { CallArgument } from '../../src/ast'
import {
    callArgumentLabelsMatch,
    lookupFreeCallSpec,
    mangleLabeledCallee,
    validateLabeledCall,
    type CallableRegistry,
} from '../../src/codegen/callable-registry'

const truthArgument = (label: string | null): CallArgument => ({
    label,
    value: { kind: 'TruthLiteral', value: 'true' },
})

describe('callable registry', () => {
    const registry: CallableRegistry<'adjust' | 'rotate'> = {
        freeCalls: {
            adjust: {
                baseName: 'adjust',
                arity: 2,
                canonicalLabels: [null, 'towards'],
            },
            rotate: {
                baseName: 'rotate',
                arity: 2,
                canonicalLabels: [null, 'by'],
            },
        },
    }

    it('looks up free call specs by name and arity', () => {
        expect(lookupFreeCallSpec(registry, 'adjust', 2)).toEqual(
            registry.freeCalls.adjust,
        )
        expect(lookupFreeCallSpec(registry, 'adjust', 1)).toBeNull()
        expect(lookupFreeCallSpec(registry, 'missing', 2)).toBeNull()
    })

    it('matches argument labels exactly', () => {
        expect(
            callArgumentLabelsMatch(
                [truthArgument(null), truthArgument('towards')],
                [null, 'towards'],
            ),
        ).toBe(true)

        expect(
            callArgumentLabelsMatch(
                [truthArgument(null), truthArgument(null)],
                [null, 'towards'],
            ),
        ).toBe(false)

        expect(
            callArgumentLabelsMatch([truthArgument(null)], [null, 'towards']),
        ).toBe(false)
    })

    it('validates labeled calls against canonical labels', () => {
        expect(() =>
            validateLabeledCall(
                [truthArgument(null), truthArgument('towards')],
                registry.freeCalls.adjust,
            ),
        ).not.toThrow()

        expect(() =>
            validateLabeledCall(
                [truthArgument(null), truthArgument('by')],
                registry.freeCalls.adjust,
            ),
        ).toThrow(
            /Incorrect argument labels in call to adjust\(_:towards:\): have \(_:by:\), expected \(_:towards:\)/,
        )
    })

    it('mangles labeled callees deterministically', () => {
        expect(mangleLabeledCallee('rotate', [null, 'by'])).toBe('rotate__by')
        expect(mangleLabeledCallee('adjust', [null, 'towards'])).toBe(
            'adjust__towards',
        )
        expect(mangleLabeledCallee('plain', [null, null])).toBe('plain')
    })
})
