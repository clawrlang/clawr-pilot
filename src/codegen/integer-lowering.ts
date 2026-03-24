import type { BinaryExpression, Expression } from '../ast'
import type { CExpression, CStatement } from '../ir/c'
import type { RuntimeType } from './lowering-types'

type LoweredIntegerExpression = {
    setup: CStatement[]
    value: CExpression
    heapTemps: string[]
}

export function isIntegerExpression(
    expression: Expression,
    variableKinds: Map<string, RuntimeType>,
): boolean {
    switch (expression.kind) {
        case 'IntegerLiteral':
            return true
        case 'Identifier':
            return variableKinds.get(expression.name) === 'integer'
        case 'UnaryExpression':
            return (
                expression.operator === '-' &&
                isIntegerExpression(expression.operand, variableKinds)
            )
        case 'BinaryExpression':
            return (
                ['+', '-', '*', '/', '^'].includes(expression.operator) &&
                isIntegerExpression(expression.left, variableKinds) &&
                isIntegerExpression(expression.right, variableKinds)
            )
        default:
            return false
    }
}

export function lowerIntegerExpression(
    expression: Expression,
    variableKinds: Map<string, RuntimeType>,
    nextTemp: () => string,
): LoweredIntegerExpression {
    if (expression.kind === 'IntegerLiteral') {
        const temp = nextTemp()
        return {
            setup: [
                {
                    kind: 'CVariableDeclaration',
                    type: 'Integer*',
                    name: temp,
                    initializer: {
                        kind: 'CCallExpression',
                        callee: 'clawr_int_from_i64',
                        args: [
                            {
                                kind: 'CIntegerLiteral',
                                value: `${expression.value.toString()}LL`,
                            },
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
        variableKinds.get(expression.name) === 'integer'
    ) {
        return {
            setup: [],
            value: { kind: 'CIdentifier', name: expression.name },
            heapTemps: [],
        }
    }

    if (expression.kind === 'UnaryExpression' && expression.operator === '-') {
        const zero = lowerIntegerExpression(
            {
                kind: 'IntegerLiteral',
                position: expression.position,
                value: 0n,
            },
            variableKinds,
            nextTemp,
        )
        const operand = lowerIntegerExpression(
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
                    type: 'Integer*',
                    name: temp,
                    initializer: {
                        kind: 'CCallExpression',
                        callee: 'Integer¸subtract',
                        args: [zero.value, operand.value],
                    },
                },
            ],
            value: { kind: 'CIdentifier', name: temp },
            heapTemps: [...zero.heapTemps, ...operand.heapTemps, temp],
        }
    }

    if (expression.kind === 'BinaryExpression') {
        return lowerIntegerBinaryExpression(expression, variableKinds, nextTemp)
    }

    throw new Error('Unsupported integer expression in this vertical slice')
}

function lowerIntegerBinaryExpression(
    expression: BinaryExpression,
    variableKinds: Map<string, RuntimeType>,
    nextTemp: () => string,
): LoweredIntegerExpression {
    const left = lowerIntegerExpression(
        expression.left,
        variableKinds,
        nextTemp,
    )
    const right = lowerIntegerExpression(
        expression.right,
        variableKinds,
        nextTemp,
    )
    const calleeMap: Record<string, string> = {
        '+': 'Integer¸add',
        '-': 'Integer¸subtract',
        '*': 'Integer¸multiply',
        '/': 'Integer¸divide',
        '^': 'Integer¸power',
    }
    const callee = calleeMap[expression.operator]
    const temp = nextTemp()

    return {
        setup: [
            ...left.setup,
            ...right.setup,
            {
                kind: 'CVariableDeclaration',
                type: 'Integer*',
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
