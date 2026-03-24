import Decimal from 'decimal.js'
import type {
    BinaryExpression,
    CallExpression,
    Expression,
    Program,
    UnaryExpression,
    VariableDeclaration,
} from '../ast'
import {
    bitfieldSet,
    integerRange,
    integerSingleton,
    integerTop,
    meetValueSets,
    realSingleton,
    realTop,
    truthvalueTop,
    stringSingleton,
    tritfieldSet,
    truthvalueSet,
    type ValueSet,
} from './lattice'

export interface SemanticProgram {
    bindings: Map<string, ValueSet>
}

export function analyzeProgram(program: Program): SemanticProgram {
    const bindings = new Map<string, ValueSet>()

    for (const statement of program.statements) {
        if (statement.kind !== 'VariableDeclaration') continue

        const inferred = inferDeclarationValueSet(statement, bindings)
        if (inferred) {
            bindings.set(statement.identifier.name, inferred)
        }
    }

    return { bindings }
}

function inferDeclarationValueSet(
    statement: VariableDeclaration,
    bindings: Map<string, ValueSet>,
): ValueSet | null {
    if (statement.typeAnnotation?.baseName === 'bitfield') {
        return bitfieldSet(statement.typeAnnotation.length)
    }

    if (statement.typeAnnotation?.baseName === 'tritfield') {
        return tritfieldSet(statement.typeAnnotation.length)
    }

    return inferExpressionValueSet(statement.initializer, bindings)
}

function inferExpressionValueSet(
    expression: Expression,
    bindings: Map<string, ValueSet>,
): ValueSet | null {
    switch (expression.kind) {
        case 'Identifier':
            return bindings.get(expression.name) ?? null
        case 'IntegerLiteral':
            return integerSingleton(expression.value)
        case 'RealLiteral':
            return realSingleton(expression.value)
        case 'TruthLiteral':
            return truthvalueSet(expression.value)
        case 'StringLiteral':
            return stringSingleton(expression.value)
        case 'UnaryExpression':
            return inferUnaryValueSet(expression, bindings)
        case 'BinaryExpression':
            return inferBinaryValueSet(expression, bindings)
        case 'CallExpression':
            return inferCallValueSet(expression)
        default:
            return null
    }
}

function inferUnaryValueSet(
    expression: UnaryExpression,
    bindings: Map<string, ValueSet>,
): ValueSet | null {
    const operand = inferExpressionValueSet(expression.operand, bindings)
    if (!operand) return null

    switch (expression.operator) {
        case '!':
            if (operand.family !== 'truthvalue') return null
            return truthvalueSet(...operand.values.map(invertTruthValue))
        case '~':
            return operand.family === 'bitfield' ? operand : null
        case '-':
            if (operand.family === 'integer') {
                if (operand.form === 'top') return integerTop()
                if (operand.form === 'singleton') {
                    return integerSingleton(-operand.value)
                }
                return integerRange({
                    min: operand.max === null ? undefined : -operand.max,
                    minInclusive: operand.maxInclusive,
                    max: operand.min === null ? undefined : -operand.min,
                    maxInclusive: operand.minInclusive,
                })
            }

            if (operand.family === 'real') {
                if (operand.form === 'top') return realTop()
                if (operand.form === 'singleton') {
                    return realSingleton(negateRealString(operand.value))
                }
                return realRangeFromNegation(operand)
            }

            return null
    }
}

function inferBinaryValueSet(
    expression: BinaryExpression,
    bindings: Map<string, ValueSet>,
): ValueSet | null {
    const left = inferExpressionValueSet(expression.left, bindings)
    const right = inferExpressionValueSet(expression.right, bindings)
    if (!left || !right) return null

    switch (expression.operator) {
        case '+':
        case '-':
        case '*':
        case '/':
        case '^':
            if (left.family === 'integer' && right.family === 'integer') {
                return integerTop()
            }
            if (left.family === 'real' && right.family === 'real') {
                return realTop()
            }
            if (left.family === 'bitfield' && right.family === 'bitfield') {
                return meetValueSets(left, right)
            }
            return null
        case '&':
        case '|':
            if (left.family !== 'bitfield' || right.family !== 'bitfield') {
                return null
            }
            return meetValueSets(left, right)
        case '&&':
            if (left.family !== 'truthvalue' || right.family !== 'truthvalue') {
                return null
            }
            return combineTruthvalueSets(left.values, right.values, truthAnd)
        case '||':
            if (left.family !== 'truthvalue' || right.family !== 'truthvalue') {
                return null
            }
            return combineTruthvalueSets(left.values, right.values, truthOr)
        case '==':
        case '!=':
        case '<':
        case '<=':
        case '>':
        case '>=':
            if (
                (left.family === 'integer' && right.family === 'integer') ||
                (left.family === 'real' && right.family === 'real')
            ) {
                return truthvalueSet('false', 'true')
            }
            return null
    }
}

function inferCallValueSet(expression: CallExpression): ValueSet | null {
    if (expression.callee.kind !== 'Identifier') return null
    if (expression.arguments.length !== 1) return null

    const [argument] = expression.arguments
    if (argument.label !== null || argument.value.kind !== 'StringLiteral') {
        return null
    }

    if (expression.callee.name === 'bitfield') {
        return bitfieldSet(argument.value.value.length)
    }

    if (expression.callee.name === 'tritfield') {
        return tritfieldSet(argument.value.value.length)
    }

    return null
}

function invertTruthValue(value: 'false' | 'ambiguous' | 'true') {
    if (value === 'false') return 'true'
    if (value === 'true') return 'false'
    return 'ambiguous'
}

function combineTruthvalueSets(
    leftValues: Array<'false' | 'ambiguous' | 'true'>,
    rightValues: Array<'false' | 'ambiguous' | 'true'>,
    combine: (
        left: 'false' | 'ambiguous' | 'true',
        right: 'false' | 'ambiguous' | 'true',
    ) => 'false' | 'ambiguous' | 'true',
) {
    const values = new Set<'false' | 'ambiguous' | 'true'>()
    for (const left of leftValues) {
        for (const right of rightValues) {
            values.add(combine(left, right))
        }
    }
    return truthvalueSet(...values)
}

function truthAnd(
    left: 'false' | 'ambiguous' | 'true',
    right: 'false' | 'ambiguous' | 'true',
): 'false' | 'ambiguous' | 'true' {
    if (left === 'false' || right === 'false') return 'false'
    if (left === 'true' && right === 'true') return 'true'
    return 'ambiguous'
}

function truthOr(
    left: 'false' | 'ambiguous' | 'true',
    right: 'false' | 'ambiguous' | 'true',
): 'false' | 'ambiguous' | 'true' {
    if (left === 'true' || right === 'true') return 'true'
    if (left === 'false' && right === 'false') return 'false'
    return 'ambiguous'
}

function realRangeFromNegation(
    valueSet: Extract<ValueSet, { family: 'real'; form: 'range' }>,
): ValueSet {
    return {
        family: 'real',
        form: 'range',
        min:
            valueSet.max === null
                ? null
                : canonicalizeReal(negateRealString(valueSet.max)),
        minInclusive: valueSet.maxInclusive,
        max:
            valueSet.min === null
                ? null
                : canonicalizeReal(negateRealString(valueSet.min)),
        maxInclusive: valueSet.minInclusive,
    }
}

function negateRealString(value: string): string {
    if (value.startsWith('-')) return value.slice(1)
    return `-${value}`
}

function canonicalizeReal(value: string): string {
    return new Decimal(value).toString()
}
