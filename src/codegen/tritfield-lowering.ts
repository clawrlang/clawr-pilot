import type { CallExpression, Expression } from '../ast'
import type { CExpression, CStatement } from '../ir/c'
import type { VariableKind } from './lowering-types'

type LoweredTritfieldExpression = { setup: CStatement[]; value: CExpression }

export function isTritfieldExpression(
    expression: Expression,
    variableKinds: Map<string, VariableKind>,
): boolean {
    switch (expression.kind) {
        case 'Identifier':
            return variableKinds.get(expression.name) === 'tritfield'
        case 'CallExpression':
            return isTritfieldConstructorCall(expression)
        default:
            return false
    }
}

export function lowerTritfieldExpression(
    expression: Expression,
    variableKinds: Map<string, VariableKind>,
): LoweredTritfieldExpression {
    if (
        expression.kind === 'Identifier' &&
        variableKinds.get(expression.name) === 'tritfield'
    ) {
        return {
            setup: [],
            value: { kind: 'CIdentifier', name: expression.name },
        }
    }

    if (
        expression.kind === 'CallExpression' &&
        isTritfieldConstructorCall(expression)
    ) {
        const source = tritfieldConstructorSource(expression)
        const packedBits = source
            .split('')
            .map((ch) => {
                if (ch === '0') return '00'
                if (ch === '?') return '01'
                return '11'
            })
            .join('')
        const numeric = BigInt(`0b${packedBits}`)

        return {
            setup: [],
            value: {
                kind: 'CIntegerLiteral',
                value: `${numeric.toString()}ULL`,
            },
        }
    }

    throw new Error('Unsupported tritfield expression in this vertical slice')
}

function isTritfieldConstructorCall(expression: CallExpression): boolean {
    if (expression.callee.kind !== 'Identifier') return false
    if (expression.callee.name !== 'tritfield') return false
    if (expression.arguments.length !== 1) return false
    if (expression.arguments[0].label !== null) return false
    if (expression.arguments[0].value.kind !== 'StringLiteral') return false

    const source = expression.arguments[0].value.value
    return source.length > 0 && /^[01?]+$/.test(source)
}

function tritfieldConstructorSource(expression: CallExpression): string {
    const first = expression.arguments[0]
    if (
        first &&
        first.label === null &&
        first.value.kind === 'StringLiteral' &&
        first.value.value.length > 0 &&
        /^[01?]+$/.test(first.value.value)
    ) {
        return first.value.value
    }

    throw new Error('Invalid tritfield constructor in this vertical slice')
}
