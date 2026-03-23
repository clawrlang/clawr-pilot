import type { BinaryExpression, Expression } from '../ast'
import type { CExpression, CStatement } from '../ir/c'
import type { RuntimeType } from './lowering-types'

type LoweredRealExpression = {
    setup: CStatement[]
    value: CExpression
    heapTemps: string[]
}

export function isRealExpression(
    expression: Expression,
    variableKinds: Map<string, RuntimeType>,
): boolean {
    switch (expression.kind) {
        case 'RealLiteral':
            return true
        case 'Identifier':
            return variableKinds.get(expression.name) === 'real'
        case 'UnaryExpression':
            return (
                expression.operator === '-' &&
                isRealExpression(expression.operand, variableKinds)
            )
        case 'BinaryExpression':
            return (
                ['+', '-', '*', '/', '^'].includes(expression.operator) &&
                isRealExpression(expression.left, variableKinds) &&
                isRealExpression(expression.right, variableKinds)
            )
        default:
            return false
    }
}

export function lowerRealExpression(
    expression: Expression,
    variableKinds: Map<string, RuntimeType>,
    nextTemp: () => string,
): LoweredRealExpression {
    if (expression.kind === 'RealLiteral') {
        const temp = nextTemp()
        return {
            setup: [
                {
                    kind: 'CVariableDeclaration',
                    type: 'Real*',
                    name: temp,
                    initializer: {
                        kind: 'CCallExpression',
                        callee: 'Real¸fromString',
                        args: [
                            { kind: 'CStringLiteral', value: expression.value },
                        ],
                    },
                },
            ],
            value: { kind: 'CIdentifier', name: temp },
            heapTemps: [temp],
        }
    }

    if (
        expression.kind === 'Identifier' &&
        variableKinds.get(expression.name) === 'real'
    ) {
        return {
            setup: [],
            value: { kind: 'CIdentifier', name: expression.name },
            heapTemps: [],
        }
    }

    if (expression.kind === 'UnaryExpression' && expression.operator === '-') {
        const zero = lowerRealExpression(
            { kind: 'RealLiteral', value: '0.0' },
            variableKinds,
            nextTemp,
        )
        const operand = lowerRealExpression(
            expression.operand,
            variableKinds,
            nextTemp,
        )
        const temp = nextTemp()

        return {
            setup: [
                ...zero.setup,
                ...operand.setup,
                {
                    kind: 'CVariableDeclaration',
                    type: 'Real*',
                    name: temp,
                    initializer: {
                        kind: 'CCallExpression',
                        callee: 'Real¸subtract',
                        args: [zero.value, operand.value],
                    },
                },
            ],
            value: { kind: 'CIdentifier', name: temp },
            heapTemps: [...zero.heapTemps, ...operand.heapTemps, temp],
        }
    }

    if (expression.kind === 'BinaryExpression') {
        return lowerRealBinaryExpression(expression, variableKinds, nextTemp)
    }

    throw new Error('Unsupported real expression in this vertical slice')
}

function lowerRealBinaryExpression(
    expression: BinaryExpression,
    variableKinds: Map<string, RuntimeType>,
    nextTemp: () => string,
): LoweredRealExpression {
    const left = lowerRealExpression(expression.left, variableKinds, nextTemp)
    const right = lowerRealExpression(expression.right, variableKinds, nextTemp)
    const calleeMap: Record<string, string> = {
        '+': 'Real¸add',
        '-': 'Real¸subtract',
        '*': 'Real¸multiply',
        '/': 'Real¸divide',
        '^': 'Real¸power',
    }
    const callee = calleeMap[expression.operator]
    const temp = nextTemp()

    return {
        setup: [
            ...left.setup,
            ...right.setup,
            {
                kind: 'CVariableDeclaration',
                type: 'Real*',
                name: temp,
                initializer: {
                    kind: 'CCallExpression',
                    callee,
                    args: [left.value, right.value],
                },
            },
        ],
        value: { kind: 'CIdentifier', name: temp },
        heapTemps: [...left.heapTemps, ...right.heapTemps, temp],
    }
}
