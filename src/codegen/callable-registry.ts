import type { CallArgument, Expression } from '../ast'

export type CallableSignatureSpec<TBaseName extends string = string> = {
    baseName: TBaseName
    arity: number
    canonicalLabels: ReadonlyArray<string | null>
}

export type CallableRegistry<TBaseName extends string> = {
    freeCalls: Record<TBaseName, CallableSignatureSpec<TBaseName>>
    methods: Record<TBaseName, CallableSignatureSpec<TBaseName>>
}

export type BoundArgumentSpec = {
    label: string | null
    value: Expression
}

export type MethodAliasSpec<TBaseName extends string> = {
    property: string
    target: TBaseName
    boundArguments: ReadonlyArray<BoundArgumentSpec>
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

export function lookupMethodSpec<TBaseName extends string>(
    registry: CallableRegistry<TBaseName>,
    property: string,
    arity: number,
): CallableSignatureSpec<TBaseName> | null {
    const spec = registry.methods[property as TBaseName]
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

    const expected = spec.canonicalLabels
        .map((label, index) => {
            if (label === null) {
                return `argument ${index + 1} must be unlabeled`
            }

            return `argument ${index + 1} must be labeled ${label}:`
        })
        .join(', ')

    throw new Error(`Invalid labels for ${spec.baseName}(...): ${expected}`)
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
