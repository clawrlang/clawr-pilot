import Decimal from 'decimal.js'
import type {
    BinaryExpression,
    CallExpression,
    Expression,
    IfStatement,
    Program,
    SourcePosition,
    Statement,
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
    truthvalueSet,
    type ValueSet,
} from './lattice'

export interface SemanticDiagnostic {
    position: SourcePosition
    message: string
}

export interface SemanticProgram {
    bindings: Map<string, ValueSet>
    diagnostics: SemanticDiagnostic[]
}

export function analyzeProgram(program: Program): SemanticProgram {
    const bindings = new Map<string, ValueSet>()
    const diagnostics: SemanticDiagnostic[] = []

    for (const statement of program.statements) {
        analyzeStatement(statement, bindings, diagnostics)
    }

    return { bindings, diagnostics }
}

function analyzeStatement(
    statement: Statement,
    bindings: Map<string, ValueSet>,
    diagnostics: SemanticDiagnostic[],
) {
    switch (statement.kind) {
        case 'VariableDeclaration': {
            const inferred = inferDeclarationValueSet(
                statement,
                bindings,
                diagnostics,
            )
            if (inferred) {
                bindings.set(statement.identifier.name, inferred)
            }
            return
        }
        case 'ExpressionStatement': {
            inferExpressionValueSet(statement.expression, bindings, diagnostics)
            return
        }
        case 'IfStatement': {
            analyzeIfStatement(statement, bindings, diagnostics)
            return
        }
    }
}

function analyzeIfStatement(
    statement: IfStatement,
    bindings: Map<string, ValueSet>,
    diagnostics: SemanticDiagnostic[],
) {
    const predicate = inferExpressionValueSet(
        statement.predicate,
        bindings,
        diagnostics,
    )

    if (predicate && predicate.family !== 'truthvalue') {
        diagnostics.push({
            position: statement.predicate.position,
            message: `if predicate must be truthvalue, got ${describeValueSet(predicate)}`,
        })
    }

    const thenBindings = new Map(bindings)
    for (const child of statement.thenStatements) {
        analyzeStatement(child, thenBindings, diagnostics)
    }

    const elseBindings = new Map(bindings)
    for (const child of statement.elseStatements) {
        analyzeStatement(child, elseBindings, diagnostics)
    }
}

function inferDeclarationValueSet(
    statement: VariableDeclaration,
    bindings: Map<string, ValueSet>,
    diagnostics: SemanticDiagnostic[],
): ValueSet | null {
    const initializer = inferExpressionValueSet(
        statement.initializer,
        bindings,
        diagnostics,
    )

    if (statement.typeAnnotation?.baseName === 'bitfield') {
        const annotated = bitfieldSet(statement.typeAnnotation.length)
        if (initializer) {
            validateTypeAnnotationCompatibility(
                annotated,
                initializer,
                statement.position,
                diagnostics,
            )
        }
        return annotated
    }

    if (statement.typeAnnotation?.baseName === 'tritfield') {
        const annotated = tritfieldSet(statement.typeAnnotation.length)
        if (initializer) {
            validateTypeAnnotationCompatibility(
                annotated,
                initializer,
                statement.position,
                diagnostics,
            )
        }
        return annotated
    }

    return initializer
}

function inferExpressionValueSet(
    expression: Expression,
    bindings: Map<string, ValueSet>,
    diagnostics: SemanticDiagnostic[],
): ValueSet | null {
    switch (expression.kind) {
        case 'Identifier': {
            const bound = bindings.get(expression.name)
            if (bound) return bound
            diagnostics.push({
                position: expression.position,
                message: `unknown identifier '${expression.name}'`,
            })
            return null
        }
        case 'IntegerLiteral':
            return integerSingleton(expression.value)
        case 'RealLiteral':
            return realSingleton(expression.value)
        case 'TruthLiteral':
            return truthvalueSet(expression.value)
        case 'StringLiteral':
            return stringSingleton(expression.value)
        case 'UnaryExpression':
            return inferUnaryValueSet(expression, bindings, diagnostics)
        case 'BinaryExpression':
            return inferBinaryValueSet(expression, bindings, diagnostics)
        case 'CallExpression':
            return inferCallValueSet(expression, diagnostics)
        case 'MemberExpression':
            return null
    }
}

function inferUnaryValueSet(
    expression: UnaryExpression,
    bindings: Map<string, ValueSet>,
    diagnostics: SemanticDiagnostic[],
): ValueSet | null {
    const operand = inferExpressionValueSet(
        expression.operand,
        bindings,
        diagnostics,
    )
    if (!operand) return null

    switch (expression.operator) {
        case '!':
            if (operand.family !== 'truthvalue') {
                diagnostics.push({
                    position: expression.position,
                    message: `operator '!' requires truthvalue operand, got ${describeValueSet(operand)}`,
                })
                return null
            }
            return truthvalueSet(...operand.values.map(invertTruthValue))
        case '~':
            if (operand.family !== 'bitfield') {
                diagnostics.push({
                    position: expression.position,
                    message: `operator '~' requires bitfield operand, got ${describeValueSet(operand)}`,
                })
                return null
            }
            return operand
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

            diagnostics.push({
                position: expression.position,
                message: `operator '-' requires integer or real operand, got ${describeValueSet(operand)}`,
            })
            return null
    }
}

function inferBinaryValueSet(
    expression: BinaryExpression,
    bindings: Map<string, ValueSet>,
    diagnostics: SemanticDiagnostic[],
): ValueSet | null {
    const left = inferExpressionValueSet(expression.left, bindings, diagnostics)
    const right = inferExpressionValueSet(
        expression.right,
        bindings,
        diagnostics,
    )
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
            if (
                expression.operator === '^' &&
                left.family === 'bitfield' &&
                right.family === 'bitfield'
            ) {
                return meetValueSets(left, right)
            }
            diagnostics.push({
                position: expression.position,
                message: `operator '${expression.operator}' requires matching numeric operands${
                    expression.operator === '^' ? ' or bitfield operands' : ''
                }, got ${describeValueSet(left)} and ${describeValueSet(right)}`,
            })
            return null
        case '&':
        case '|':
            if (left.family === 'bitfield' && right.family === 'bitfield') {
                return meetValueSets(left, right)
            }
            if (left.family === 'tritfield' && right.family === 'tritfield') {
                return meetValueSets(left, right)
            }
            diagnostics.push({
                position: expression.position,
                message: `operator '${expression.operator}' requires matching bitfield or tritfield operands, got ${describeValueSet(left)} and ${describeValueSet(right)}`,
            })
            return null
        case '&&':
            if (left.family === 'truthvalue' && right.family === 'truthvalue') {
                return combineTruthvalueSets(
                    left.values,
                    right.values,
                    truthAnd,
                )
            }
            diagnostics.push({
                position: expression.position,
                message: `operator '&&' requires truthvalue operands, got ${describeValueSet(left)} and ${describeValueSet(right)}`,
            })
            return null
        case '||':
            if (left.family === 'truthvalue' && right.family === 'truthvalue') {
                return combineTruthvalueSets(left.values, right.values, truthOr)
            }
            diagnostics.push({
                position: expression.position,
                message: `operator '||' requires truthvalue operands, got ${describeValueSet(left)} and ${describeValueSet(right)}`,
            })
            return null
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
            diagnostics.push({
                position: expression.position,
                message: `operator '${expression.operator}' requires matching integer or real operands, got ${describeValueSet(left)} and ${describeValueSet(right)}`,
            })
            return null
    }
}

function inferCallValueSet(
    expression: CallExpression,
    diagnostics: SemanticDiagnostic[],
): ValueSet | null {
    if (expression.callee.kind !== 'Identifier') return null

    if (
        expression.callee.name !== 'bitfield' &&
        expression.callee.name !== 'tritfield'
    ) {
        return null
    }

    if (expression.arguments.length !== 1) {
        diagnostics.push({
            position: expression.position,
            message: `${expression.callee.name}(...) requires exactly one argument`,
        })
        return null
    }

    const [argument] = expression.arguments
    if (argument.label !== null) {
        diagnostics.push({
            position: expression.position,
            message: `${expression.callee.name}(...) does not accept labeled arguments`,
        })
        return null
    }

    if (argument.value.kind !== 'StringLiteral') {
        diagnostics.push({
            position: expression.position,
            message: `${expression.callee.name}(...) requires a string literal argument`,
        })
        return null
    }

    if (expression.callee.name === 'bitfield') {
        return bitfieldSet(argument.value.value.length)
    }

    return tritfieldSet(argument.value.value.length)
}

function validateTypeAnnotationCompatibility(
    annotated: ValueSet,
    inferred: ValueSet,
    position: SourcePosition,
    diagnostics: SemanticDiagnostic[],
) {
    if (annotated.family !== inferred.family) {
        diagnostics.push({
            position,
            message: `type annotation ${describeValueSet(annotated)} is incompatible with initializer ${describeValueSet(inferred)}`,
        })
        return
    }

    if (annotated.family === 'bitfield' && inferred.family === 'bitfield') {
        if (
            inferred.length !== null &&
            annotated.length !== null &&
            inferred.length !== annotated.length
        ) {
            diagnostics.push({
                position,
                message: `type annotation bitfield[${annotated.length}] is incompatible with bitfield[${inferred.length}] initializer`,
            })
        }
    }

    if (annotated.family === 'tritfield' && inferred.family === 'tritfield') {
        if (
            inferred.length !== null &&
            annotated.length !== null &&
            inferred.length !== annotated.length
        ) {
            diagnostics.push({
                position,
                message: `type annotation tritfield[${annotated.length}] is incompatible with tritfield[${inferred.length}] initializer`,
            })
        }
    }
}

function describeValueSet(valueSet: ValueSet): string {
    if (valueSet.family === 'never') return 'never'
    if (valueSet.family === 'bitfield') {
        return valueSet.length === null
            ? 'bitfield'
            : `bitfield[${valueSet.length}]`
    }
    if (valueSet.family === 'tritfield') {
        return valueSet.length === null
            ? 'tritfield'
            : `tritfield[${valueSet.length}]`
    }
    return valueSet.family
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

function stringSingleton(value: string): ValueSet {
    return {
        family: 'string',
        form: 'singleton',
        value,
    }
}

function tritfieldSet(length?: number): ValueSet {
    return {
        family: 'tritfield',
        length: length ?? null,
    }
}
