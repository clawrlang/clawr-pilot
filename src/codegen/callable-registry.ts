import type { CallArgument, Expression } from '../ast'

export type CallableSignatureSpec<TBaseName extends string = string> = {
    baseName: TBaseName
    arity: number
    canonicalLabels: ReadonlyArray<string | null>
}

export type CallableRegistry<TBaseName extends string> = {
    freeCalls: Record<TBaseName, CallableSignatureSpec<TBaseName>>
}

export type BoundArgumentSpec = {
    label: string | null
    value: Expression
}

function formatLabeledCallShape(labels: ReadonlyArray<string | null>): string {
    if (labels.length === 0) {
        return '()'
    }

    return `(${labels
        .map((label) => (label === null ? '_:' : `${label}:`))
        .join('')})`
}

export function formatCallableDisplayName(
    baseName: string,
    labels: ReadonlyArray<string | null>,
): string {
    return `${baseName}${formatLabeledCallShape(labels)}`
}

export function formatCallDisplayNameFromArguments(
    baseName: string,
    arguments_: ReadonlyArray<CallArgument>,
): string {
    return `${baseName}${formatLabeledCallShape(
        arguments_.map((argument) => argument.label),
    )}`
}

export function lookupFreeCallSpec<TBaseName extends string>(
    registry: CallableRegistry<TBaseName>,
    name: string,
    arity: number,
): CallableSignatureSpec<TBaseName> | null {
    const spec = registry.freeCalls[name as TBaseName]
    if (!spec || spec.arity !== arity) return null
    return spec
}

export function callArgumentLabelsMatch(
    arguments_: ReadonlyArray<CallArgument>,
    expected: ReadonlyArray<string | null>,
): boolean {
    return (
        arguments_.length === expected.length &&
        arguments_.every(
            (argument, index) => argument.label === expected[index],
        )
    )
}

export function validateLabeledCall(
    arguments_: ReadonlyArray<CallArgument>,
    spec: CallableSignatureSpec,
) {
    if (callArgumentLabelsMatch(arguments_, spec.canonicalLabels)) {
        return
    }

    const have = formatLabeledCallShape(
        arguments_.map((argument) => argument.label),
    )
    const expected = formatLabeledCallShape(spec.canonicalLabels)

    throw new Error(
        `Incorrect argument labels in call to ${formatCallableDisplayName(spec.baseName, spec.canonicalLabels)}: have ${have}, expected ${expected}`,
    )
}

export function mangleLabeledCallee(
    baseName: string,
    labels: ReadonlyArray<string | null>,
): string {
    if (labels.every((label) => label === null)) {
        return baseName
    }

    return `${baseName}_${labels.map((label) => label ?? '').join('_')}`
}
