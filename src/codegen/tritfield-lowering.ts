import type { CallExpression, Expression } from '../ast'
import type { CExpression, CStatement } from '../ir/c'
import type { VariableKind } from './lowering-types'
import {
    type CallableRegistry,
    lookupFreeCallSpec,
    validateLabeledCall,
} from './callable-registry'

type LoweredTritfieldExpression = {
    setup: CStatement[]
    x0: CExpression
    x1: CExpression
    length: number
}

type TritBaseName = 'rotate' | 'adjust'

const TRIT_CALLABLES: CallableRegistry<TritBaseName> = {
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

export function isTritfieldExpression(
    expression: Expression,
    variableKinds: Map<string, VariableKind>,
): boolean {
    switch (expression.kind) {
        case 'Identifier':
            return variableKinds.get(expression.name) === 'tritfield'
        case 'BinaryExpression':
            return (
                (expression.operator === '&' || expression.operator === '|') &&
                isTritfieldExpression(expression.left, variableKinds) &&
                isTritfieldExpression(expression.right, variableKinds)
            )
        case 'CallExpression':
            return (
                isTritfieldConstructorCall(expression) ||
                isTritfieldOperatorCall(expression, variableKinds)
            )
        default:
            return false
    }
}

export function lowerTritfieldExpression(
    expression: Expression,
    variableKinds: Map<string, VariableKind>,
    tritfieldLengths: Map<string, number>,
    nextTemp: () => string,
): LoweredTritfieldExpression {
    if (
        expression.kind === 'Identifier' &&
        variableKinds.get(expression.name) === 'tritfield'
    ) {
        const knownLength = tritfieldLengths.get(expression.name)
        if (knownLength === undefined) {
            throw new Error('Unknown tritfield length in this vertical slice')
        }

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
            length: knownLength,
        }
    }

    if (
        expression.kind === 'CallExpression' &&
        isTritfieldConstructorCall(expression)
    ) {
        const source = tritfieldConstructorSource(expression)
        if (source.length > 64) {
            throw new Error(
                'tritfield constructor currently supports up to 64 lanes',
            )
        }

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
            length: source.length,
        }
    }

    if (
        expression.kind === 'BinaryExpression' &&
        (expression.operator === '&' || expression.operator === '|')
    ) {
        const left = lowerTritfieldExpression(
            expression.left,
            variableKinds,
            tritfieldLengths,
            nextTemp,
        )
        const right = lowerTritfieldExpression(
            expression.right,
            variableKinds,
            tritfieldLengths,
            nextTemp,
        )
        ensureSameLength(left.length, right.length)

        const x0Temp = nextTemp()
        const x1Temp = nextTemp()
        const mask = maskLiteral(left.length)

        return {
            setup: [
                ...left.setup,
                ...right.setup,
                {
                    kind: 'CVariableDeclaration',
                    type: 'unsigned long long',
                    name: x0Temp,
                    initializer: {
                        kind: 'CRawExpression',
                        code: `(((${emitExpr(left.x0)}) ${expression.operator} (${emitExpr(right.x0)})) & ${mask})`,
                    },
                },
                {
                    kind: 'CVariableDeclaration',
                    type: 'unsigned long long',
                    name: x1Temp,
                    initializer: {
                        kind: 'CRawExpression',
                        code: `(((${emitExpr(left.x1)}) ${expression.operator} (${emitExpr(right.x1)})) & ${mask})`,
                    },
                },
            ],
            x0: { kind: 'CIdentifier', name: x0Temp },
            x1: { kind: 'CIdentifier', name: x1Temp },
            length: left.length,
        }
    }

    if (
        expression.kind === 'CallExpression' &&
        expression.callee.kind === 'Identifier'
    ) {
        const spec = lookupFreeCallSpec(
            TRIT_CALLABLES,
            expression.callee.name,
            expression.arguments.length,
        )
        if (spec) {
            validateLabeledCall(expression.arguments, spec)
            const left = lowerTritfieldExpression(
                expression.arguments[0].value,
                variableKinds,
                tritfieldLengths,
                nextTemp,
            )
            const right = lowerTritfieldExpression(
                expression.arguments[1].value,
                variableKinds,
                tritfieldLengths,
                nextTemp,
            )
            ensureSameLength(left.length, right.length)

            if (spec.baseName === 'rotate') {
                return lowerRotateTritfield(left, right, nextTemp)
            }

            return lowerAdjustTritfield(left, right, nextTemp)
        }
    }

    throw new Error('Unsupported tritfield expression in this vertical slice')
}

function isTritfieldOperatorCall(
    expression: CallExpression,
    variableKinds: Map<string, VariableKind>,
): boolean {
    if (expression.callee.kind !== 'Identifier') return false

    const spec = lookupFreeCallSpec(
        TRIT_CALLABLES,
        expression.callee.name,
        expression.arguments.length,
    )
    if (!spec) return false

    return (
        isTritfieldExpression(expression.arguments[0].value, variableKinds) &&
        isTritfieldExpression(expression.arguments[1].value, variableKinds)
    )
}

function lowerRotateTritfield(
    x: LoweredTritfieldExpression,
    y: LoweredTritfieldExpression,
    nextTemp: () => string,
): LoweredTritfieldExpression {
    const mask = maskLiteral(x.length)
    const x0 = emitExpr(x.x0)
    const x1 = emitExpr(x.x1)
    const y0 = emitExpr(y.x0)
    const y1 = emitExpr(y.x1)
    const r0Temp = nextTemp()
    const r1Temp = nextTemp()

    const yTrue = `((${y1}) & (${y0}))`
    const yFalse = `((~(${y1}) & ~(${y0})) & ${mask})`
    const yAmbiguous = `((~(${y1}) & (${y0})) & ${mask})`

    const up0 = `((~(${x1})) & ${mask})`
    const up1 = `(((${x0}) & ~(${x1})) & ${mask})`
    const down0 = `(((~(${x0}) | (${x1})) & ${mask}))`
    const down1 = `((~(${x1}) & ~(${x0})) & ${mask})`

    const r0 = `(((${yTrue} & ${up0}) | (${yFalse} & ${down0}) | (${yAmbiguous} & (${x0}))) & ${mask})`
    const r1 = `(((${yTrue} & ${up1}) | (${yFalse} & ${down1}) | (${yAmbiguous} & (${x1}))) & ${mask})`

    return {
        setup: [
            ...x.setup,
            ...y.setup,
            {
                kind: 'CVariableDeclaration',
                type: 'unsigned long long',
                name: r0Temp,
                initializer: { kind: 'CRawExpression', code: r0 },
            },
            {
                kind: 'CVariableDeclaration',
                type: 'unsigned long long',
                name: r1Temp,
                initializer: { kind: 'CRawExpression', code: r1 },
            },
        ],
        x0: { kind: 'CIdentifier', name: r0Temp },
        x1: { kind: 'CIdentifier', name: r1Temp },
        length: x.length,
    }
}

function lowerAdjustTritfield(
    x: LoweredTritfieldExpression,
    y: LoweredTritfieldExpression,
    nextTemp: () => string,
): LoweredTritfieldExpression {
    const mask = maskLiteral(x.length)
    const x0 = emitExpr(x.x0)
    const x1 = emitExpr(x.x1)
    const y0 = emitExpr(y.x0)
    const y1 = emitExpr(y.x1)
    const r0Temp = nextTemp()
    const r1Temp = nextTemp()

    const yTrue = `((${y1}) & (${y0}))`
    const yFalse = `((~(${y1}) & ~(${y0})) & ${mask})`
    const yAmbiguous = `((~(${y1}) & (${y0})) & ${mask})`

    const up0 = `(((${x0}) | ~(${x1})) & ${mask})`
    const up1 = `((${x0}) & ${mask})`
    const down0 = `((${x1}) & ${mask})`
    const down1 = `0ULL`

    const r0 = `(((${yTrue} & ${up0}) | (${yFalse} & ${down0}) | (${yAmbiguous} & (${x0}))) & ${mask})`
    const r1 = `(((${yTrue} & ${up1}) | (${yFalse} & ${down1}) | (${yAmbiguous} & (${x1}))) & ${mask})`

    return {
        setup: [
            ...x.setup,
            ...y.setup,
            {
                kind: 'CVariableDeclaration',
                type: 'unsigned long long',
                name: r0Temp,
                initializer: { kind: 'CRawExpression', code: r0 },
            },
            {
                kind: 'CVariableDeclaration',
                type: 'unsigned long long',
                name: r1Temp,
                initializer: { kind: 'CRawExpression', code: r1 },
            },
        ],
        x0: { kind: 'CIdentifier', name: r0Temp },
        x1: { kind: 'CIdentifier', name: r1Temp },
        length: x.length,
    }
}

function ensureSameLength(left: number, right: number) {
    if (left !== right) {
        throw new Error(
            'tritfield operands must have matching lengths in this vertical slice',
        )
    }
}

function maskLiteral(length: number): string {
    if (length < 1 || length > 64) {
        throw new Error('tritfield length must be between 1 and 64')
    }
    if (length === 64) return '~0ULL'

    return `${((1n << BigInt(length)) - 1n).toString()}ULL`
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

function emitExpr(expression: CExpression): string {
    switch (expression.kind) {
        case 'CIdentifier':
            return expression.name
        case 'CIntegerLiteral':
            return expression.value
        case 'CRawExpression':
            return expression.code
        default:
            throw new Error(
                'Unsupported tritfield C expression shape in this vertical slice',
            )
    }
}
