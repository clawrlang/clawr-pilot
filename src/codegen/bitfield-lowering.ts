import type { CallExpression, Expression } from '../ast'
import type { CExpression, CStatement } from '../ir/c'
import { cExprCode } from './lowering-utils'
import type { RuntimeType } from './lowering-types'

type LoweredBitfieldExpression = { setup: CStatement[]; value: CExpression }

export function isBitfieldExpression(
    expression: Expression,
    variableKinds: Map<string, RuntimeType>,
): boolean {
    switch (expression.kind) {
        case 'Identifier':
            return variableKinds.get(expression.name) === 'bitfield'
        case 'UnaryExpression':
            return (
                expression.operator === '~' &&
                isBitfieldExpression(expression.operand, variableKinds)
            )
        case 'BinaryExpression':
            return (
                (expression.operator === '&' ||
                    expression.operator === '|' ||
                    expression.operator === '^') &&
                isBitfieldExpression(expression.left, variableKinds) &&
                isBitfieldExpression(expression.right, variableKinds)
            )
        case 'CallExpression':
            return isBitfieldConstructorCall(expression)
        default:
            return false
    }
}

export function lowerBitfieldExpression(
    expression: Expression,
    variableKinds: Map<string, RuntimeType>,
    nextTemp: () => string,
): LoweredBitfieldExpression {
    if (
        expression.kind === 'Identifier' &&
        variableKinds.get(expression.name) === 'bitfield'
    ) {
        return {
            setup: [],
            value: { kind: 'CIdentifier', name: expression.name },
        }
    }

    if (
        expression.kind === 'CallExpression' &&
        isBitfieldConstructorCall(expression)
    ) {
        const source = bitfieldConstructorSource(expression)
        const numeric = BigInt(`0b${source}`)
        return {
            setup: [],
            value: {
                kind: 'CIntegerLiteral',
                value: `${numeric.toString()}ULL`,
            },
        }
    }

    if (expression.kind === 'UnaryExpression' && expression.operator === '~') {
        const operand = lowerBitfieldExpression(
            expression.operand,
            variableKinds,
            nextTemp,
        )
        const temp = nextTemp()

        return {
            setup: [
                ...operand.setup,
                {
                    kind: 'CVariableDeclaration',
                    type: 'unsigned long long',
                    name: temp,
                    initializer: {
                        kind: 'CRawExpression',
                        code: `(~(${cExprCode(operand.value)}))`,
                    },
                },
            ],
            value: { kind: 'CIdentifier', name: temp },
        }
    }

    if (
        expression.kind === 'BinaryExpression' &&
        (expression.operator === '&' ||
            expression.operator === '|' ||
            expression.operator === '^')
    ) {
        const left = lowerBitfieldExpression(
            expression.left,
            variableKinds,
            nextTemp,
        )
        const right = lowerBitfieldExpression(
            expression.right,
            variableKinds,
            nextTemp,
        )
        const temp = nextTemp()

        return {
            setup: [
                ...left.setup,
                ...right.setup,
                {
                    kind: 'CVariableDeclaration',
                    type: 'unsigned long long',
                    name: temp,
                    initializer: {
                        kind: 'CRawExpression',
                        code: `((${cExprCode(left.value)}) ${expression.operator} (${cExprCode(right.value)}))`,
                    },
                },
            ],
            value: { kind: 'CIdentifier', name: temp },
        }
    }

    throw new Error('Unsupported bitfield expression in this vertical slice')
}

function isBitfieldConstructorCall(expression: CallExpression): boolean {
    if (expression.callee.kind !== 'Identifier') return false
    if (expression.callee.name !== 'bitfield') return false
    if (expression.arguments.length !== 1) return false
    if (expression.arguments[0].label !== null) return false
    if (expression.arguments[0].value.kind !== 'StringLiteral') return false

    const source = expression.arguments[0].value.value
    return source.length > 0 && /^[01]+$/.test(source)
}

function bitfieldConstructorSource(expression: CallExpression): string {
    const first = expression.arguments[0]
    if (
        first &&
        first.label === null &&
        first.value.kind === 'StringLiteral' &&
        first.value.value.length > 0 &&
        /^[01]+$/.test(first.value.value)
    ) {
        return first.value.value
    }

    throw new Error('Invalid bitfield constructor in this vertical slice')
}
