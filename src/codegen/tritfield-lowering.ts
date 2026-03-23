import type { CallExpression, Expression } from '../ast'
import type { CExpression, CStatement } from '../ir/c'
import type { VariableKind } from './lowering-types'

type LoweredTritfieldExpression = {
    setup: CStatement[]
    x0: CExpression
    x1: CExpression
}

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
            x0: {
                kind: 'CIdentifier',
                name: tritfieldPlaneName(expression.name, 0),
            },
            x1: {
                kind: 'CIdentifier',
                name: tritfieldPlaneName(expression.name, 1),
            },
        }
    }

    if (
        expression.kind === 'CallExpression' &&
        isTritfieldConstructorCall(expression)
    ) {
        const source = tritfieldConstructorSource(expression)
        const x0Bits = source
            .split('')
            .map((ch) => {
                if (ch === '0') return '0'
                if (ch === '?') return '1'
                return '1'
            })
            .join('')
        const x1Bits = source
            .split('')
            .map((ch) => {
                if (ch === '1') return '1'
                return '0'
            })
            .join('')
        const x0Numeric = BigInt(`0b${x0Bits}`)
        const x1Numeric = BigInt(`0b${x1Bits}`)

        return {
            setup: [],
            x0: {
                kind: 'CIntegerLiteral',
                value: `${x0Numeric.toString()}ULL`,
            },
            x1: {
                kind: 'CIntegerLiteral',
                value: `${x1Numeric.toString()}ULL`,
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

export function tritfieldPlaneName(baseName: string, plane: 0 | 1): string {
    return `${baseName}ˇx${plane}`
}
