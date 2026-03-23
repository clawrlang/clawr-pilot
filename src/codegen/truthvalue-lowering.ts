import type { CallExpression, Expression } from '../ast'
import type { CExpression, CStatement } from '../ir/c'
import {
    type CallableSignatureSpec,
    type CallableRegistry,
    type BoundArgumentSpec,
    lookupFreeCallSpec,
    validateLabeledCall,
    mangleLabeledCallee,
    formatCallDisplayNameFromArguments,
    formatCallableDisplayName,
} from './callable-registry'
import { cExprCode, cTruthValue } from './lowering-utils'
import type { RuntimeType } from './lowering-types'

type TruthBaseName = 'adjust' | 'rotate'
type LoweredTruthExpression = { setup: CStatement[]; value: CExpression }
type TruthFreeAliasName = 'rotateUp' | 'rotateDown' | 'adjustUp' | 'adjustDown'
type TruthFreeAliasSpec = {
    name: TruthFreeAliasName
    target: TruthBaseName
    boundArguments: ReadonlyArray<BoundArgumentSpec>
}

const TRUTH_CALLABLES: CallableRegistry<TruthBaseName> = {
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

const TRUTH_FREE_ALIASES: Record<TruthFreeAliasName, TruthFreeAliasSpec> = {
    rotateUp: {
        name: 'rotateUp',
        target: 'rotate',
        boundArguments: [
            {
                label: 'by',
                value: { kind: 'TruthLiteral', value: 'true' },
            },
        ],
    },
    rotateDown: {
        name: 'rotateDown',
        target: 'rotate',
        boundArguments: [
            {
                label: 'by',
                value: { kind: 'TruthLiteral', value: 'false' },
            },
        ],
    },
    adjustUp: {
        name: 'adjustUp',
        target: 'adjust',
        boundArguments: [
            {
                label: 'towards',
                value: { kind: 'TruthLiteral', value: 'true' },
            },
        ],
    },
    adjustDown: {
        name: 'adjustDown',
        target: 'adjust',
        boundArguments: [
            {
                label: 'towards',
                value: { kind: 'TruthLiteral', value: 'false' },
            },
        ],
    },
}

function formatTruthFunctionCandidates(): string {
    const canonical = Object.values(TRUTH_CALLABLES.freeCalls).map((spec) =>
        formatCallableDisplayName(spec.baseName, spec.canonicalLabels),
    )
    const aliases = Object.keys(TRUTH_FREE_ALIASES).map((name) =>
        formatCallableDisplayName(name, [null]),
    )

    return [...canonical, ...aliases].join(', ')
}

export function isTruthExpression(
    expression: Expression,
    variableKinds: Map<string, RuntimeType>,
): boolean {
    switch (expression.kind) {
        case 'TruthLiteral':
            return true
        case 'Identifier':
            return variableKinds.get(expression.name) === 'truthvalue'
        case 'UnaryExpression':
            return (
                expression.operator === '!' &&
                isTruthExpression(expression.operand, variableKinds)
            )
        case 'BinaryExpression':
            return (
                (expression.operator === '&&' ||
                    expression.operator === '||') &&
                isTruthExpression(expression.left, variableKinds) &&
                isTruthExpression(expression.right, variableKinds)
            )
        case 'CallExpression':
            return isTruthCallExpression(expression, variableKinds)
        default:
            return false
    }
}

function isTruthCallExpression(
    expression: CallExpression,
    variableKinds: Map<string, RuntimeType>,
): boolean {
    if (expression.callee.kind === 'Identifier') {
        const spec = lookupFreeCallSpec(
            TRUTH_CALLABLES,
            expression.callee.name,
            expression.arguments.length,
        )
        if (spec) {
            return (
                isTruthExpression(
                    expression.arguments[0].value,
                    variableKinds,
                ) &&
                isTruthExpression(expression.arguments[1].value, variableKinds)
            )
        }

        const alias =
            TRUTH_FREE_ALIASES[
                expression.callee.name as keyof typeof TRUTH_FREE_ALIASES
            ]
        if (alias && expression.arguments.length === 1) {
            return isTruthExpression(
                expression.arguments[0].value,
                variableKinds,
            )
        }

        return false
    }

    return false
}

export function lowerTruthExpression(
    expression: Expression,
    variableKinds: Map<string, RuntimeType>,
    nextTemp: () => string,
): LoweredTruthExpression {
    if (expression.kind === 'TruthLiteral') {
        return {
            setup: [],
            value: {
                kind: 'CIntegerLiteral',
                value: cTruthValue(expression.value),
            },
        }
    }

    if (
        expression.kind === 'Identifier' &&
        variableKinds.get(expression.name) === 'truthvalue'
    ) {
        return {
            setup: [],
            value: { kind: 'CIdentifier', name: expression.name },
        }
    }

    if (expression.kind === 'UnaryExpression' && expression.operator === '!') {
        const operand = lowerTruthExpression(
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
                    type: 'int',
                    name: temp,
                    initializer: {
                        kind: 'CRawExpression',
                        code: `(2 - ${cExprCode(operand.value)})`,
                    },
                },
            ],
            value: { kind: 'CIdentifier', name: temp },
        }
    }

    if (expression.kind === 'BinaryExpression') {
        const left = lowerTruthExpression(
            expression.left,
            variableKinds,
            nextTemp,
        )
        const right = lowerTruthExpression(
            expression.right,
            variableKinds,
            nextTemp,
        )
        const temp = nextTemp()
        const leftCode = cExprCode(left.value)
        const rightCode = cExprCode(right.value)
        const code =
            expression.operator === '&&'
                ? `((${leftCode}) < (${rightCode}) ? (${leftCode}) : (${rightCode}))`
                : `((${leftCode}) > (${rightCode}) ? (${leftCode}) : (${rightCode}))`

        return {
            setup: [
                ...left.setup,
                ...right.setup,
                {
                    kind: 'CVariableDeclaration',
                    type: 'int',
                    name: temp,
                    initializer: {
                        kind: 'CRawExpression',
                        code,
                    },
                },
            ],
            value: { kind: 'CIdentifier', name: temp },
        }
    }

    if (expression.kind === 'CallExpression') {
        if (expression.callee.kind === 'Identifier') {
            const spec = lookupFreeCallSpec(
                TRUTH_CALLABLES,
                expression.callee.name,
                expression.arguments.length,
            )
            if (spec) {
                return lowerValidatedTruthRuntimeCall(
                    expression,
                    spec,
                    variableKinds,
                    nextTemp,
                )
            }

            const alias =
                TRUTH_FREE_ALIASES[
                    expression.callee.name as keyof typeof TRUTH_FREE_ALIASES
                ]
            if (alias && expression.arguments.length === 1) {
                return lowerValidatedTruthRuntimeCall(
                    {
                        ...expression,
                        arguments: [
                            expression.arguments[0],
                            ...alias.boundArguments,
                        ],
                    },
                    TRUTH_CALLABLES.freeCalls[alias.target],
                    variableKinds,
                    nextTemp,
                )
            }

            throw new Error(
                `No function named ${formatCallDisplayNameFromArguments(expression.callee.name, expression.arguments)}. Candidates: ${formatTruthFunctionCandidates()}.`,
            )
        }

        if (expression.callee.kind === 'MemberExpression') {
            throw new Error(
                `No method named ${formatCallDisplayNameFromArguments(expression.callee.property, expression.arguments)}.`,
            )
        }
    }

    throw new Error('Unsupported truthvalue expression in this vertical slice')
}

function lowerTruthRuntimeCall(
    callee: string,
    args: Array<{ setup: CStatement[]; value: CExpression }>,
    nextTemp: () => string,
): LoweredTruthExpression {
    const temp = nextTemp()

    return {
        setup: [
            ...args.flatMap((arg) => arg.setup),
            {
                kind: 'CVariableDeclaration',
                type: 'int',
                name: temp,
                initializer: {
                    kind: 'CCallExpression',
                    callee,
                    args: args.map((arg) => arg.value),
                },
            },
        ],
        value: { kind: 'CIdentifier', name: temp },
    }
}

function lowerValidatedTruthRuntimeCall(
    expression: CallExpression,
    spec: CallableSignatureSpec,
    variableKinds: Map<string, RuntimeType>,
    nextTemp: () => string,
): LoweredTruthExpression {
    validateLabeledCall(expression.arguments, spec)

    return lowerTruthRuntimeCall(
        mangleLabeledCallee(spec.baseName, spec.canonicalLabels),
        expression.arguments.map((argument) =>
            lowerTruthExpression(argument.value, variableKinds, nextTemp),
        ),
        nextTemp,
    )
}
