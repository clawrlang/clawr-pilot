import type { CallExpression, Expression } from '../ast'
import type { CExpression, CStatement } from '../ir/c'
import { cExprCode } from './lowering-utils'
import { isTruthExpression, lowerTruthExpression } from './truthvalue-lowering'
import type { VariableKind } from './lowering-types'

type LoweredStringExpression = {
    setup: CStatement[]
    value: CExpression
    releaseAfterUse?: string
}

export function lowerPrintCall(
    call: CallExpression,
    statements: CStatement[],
    variableKinds: Map<string, VariableKind>,
    nextTemp: () => string,
) {
    if (call.callee.kind !== 'Identifier' || call.callee.name !== 'print') {
        throw new Error('Only print(...) is supported in this vertical slice')
    }

    if (call.arguments.length !== 1) {
        throw new Error('print(...) must have exactly one argument')
    }

    if (call.arguments[0].label !== null) {
        throw new Error(
            'print(...) does not currently support labeled arguments',
        )
    }

    const render = lowerStringExpression(
        call.arguments[0].value,
        variableKinds,
        nextTemp,
    )
    statements.push(...render.setup)
    statements.push({
        kind: 'CExpressionStatement',
        expression: {
            kind: 'CCallExpression',
            callee: 'printf',
            args: [{ kind: 'CStringLiteral', value: '%s\n' }, render.value],
        },
    })
    if (render.releaseAfterUse) {
        statements.push({
            kind: 'CExpressionStatement',
            expression: {
                kind: 'CCallExpression',
                callee: 'releaseRC',
                args: [{ kind: 'CIdentifier', name: render.releaseAfterUse }],
            },
        })
    }
}

function lowerStringExpression(
    expression: Expression,
    variableKinds: Map<string, VariableKind>,
    nextTemp: () => string,
): LoweredStringExpression {
    if (expression.kind === 'TruthLiteral') {
        return {
            setup: [],
            value: {
                kind: 'CStringLiteral',
                value: expression.value,
            },
        }
    }

    if (expression.kind === 'StringLiteral') {
        const stringObjectTemp = nextTemp()
        const cStringTemp = nextTemp()
        return {
            setup: [
                {
                    kind: 'CVariableDeclaration',
                    type: 'String*',
                    name: stringObjectTemp,
                    initializer: {
                        kind: 'CCallExpression',
                        callee: 'String¸fromCString',
                        args: [
                            {
                                kind: 'CStringLiteral',
                                value: expression.value,
                            },
                        ],
                    },
                },
                {
                    kind: 'CVariableDeclaration',
                    type: 'const char*',
                    name: cStringTemp,
                    initializer: {
                        kind: 'CCallExpression',
                        callee: 'String·toCString',
                        args: [{ kind: 'CIdentifier', name: stringObjectTemp }],
                    },
                },
            ],
            value: { kind: 'CIdentifier', name: cStringTemp },
            releaseAfterUse: stringObjectTemp,
        }
    }

    if (expression.kind === 'Identifier') {
        const variableKind = variableKinds.get(expression.name)
        if (variableKind === 'truthvalue') {
            return {
                setup: [],
                value: {
                    kind: 'CRawExpression',
                    code: `(${expression.name} == 0 ? "false" : (${expression.name} == 2 ? "true" : "ambiguous"))`,
                },
            }
        }
        if (variableKind === 'string') {
            const cStringTemp = nextTemp()
            return {
                setup: [
                    {
                        kind: 'CVariableDeclaration',
                        type: 'const char*',
                        name: cStringTemp,
                        initializer: {
                            kind: 'CCallExpression',
                            callee: 'String·toCString',
                            args: [
                                { kind: 'CIdentifier', name: expression.name },
                            ],
                        },
                    },
                ],
                value: { kind: 'CIdentifier', name: cStringTemp },
            }
        }
    }

    if (isTruthExpression(expression, variableKinds)) {
        const lowered = lowerTruthExpression(
            expression,
            variableKinds,
            nextTemp,
        )
        const code = cExprCode(lowered.value)
        return {
            setup: lowered.setup,
            value: {
                kind: 'CRawExpression',
                code: `(${code} == 0 ? "false" : (${code} == 2 ? "true" : "ambiguous"))`,
            },
        }
    }

    if (expression.kind === 'CallExpression') {
        if (
            expression.callee.kind === 'MemberExpression' &&
            expression.callee.property === 'toString' &&
            expression.arguments.length === 0
        ) {
            const object = expression.callee.object
            if (object.kind !== 'Identifier') {
                throw new Error(
                    'toString() receiver must currently be a variable',
                )
            }

            const variableKind = variableKinds.get(object.name)
            let toStringCallee: 'Integer·toStringRC' | 'Real·toStringRC'
            if (variableKind === 'integer') {
                toStringCallee = 'Integer·toStringRC'
            } else if (variableKind === 'real') {
                toStringCallee = 'Real·toStringRC'
            } else {
                throw new Error(
                    'toString() is currently supported only for integer and real variables',
                )
            }

            const stringObjectTemp = nextTemp()
            const cStringTemp = nextTemp()
            return {
                setup: [
                    {
                        kind: 'CVariableDeclaration',
                        type: 'String*',
                        name: stringObjectTemp,
                        initializer: {
                            kind: 'CCallExpression',
                            callee: toStringCallee,
                            args: [{ kind: 'CIdentifier', name: object.name }],
                        },
                    },
                    {
                        kind: 'CVariableDeclaration',
                        type: 'const char*',
                        name: cStringTemp,
                        initializer: {
                            kind: 'CCallExpression',
                            callee: 'String·toCString',
                            args: [
                                {
                                    kind: 'CIdentifier',
                                    name: stringObjectTemp,
                                },
                            ],
                        },
                    },
                ],
                value: { kind: 'CIdentifier', name: cStringTemp },
                releaseAfterUse: stringObjectTemp,
            }
        }
    }

    throw new Error(
        'Only truthvalue expressions and <identifier>.toString() are supported as print arguments',
    )
}
