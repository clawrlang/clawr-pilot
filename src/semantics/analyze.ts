import Decimal from 'decimal.js'
import type {
    AssignmentStatement,
    BinaryExpression,
    CallExpression,
    Expression,
    IfStatement,
    Program,
    SourcePosition,
    Statement,
    SubsetDeclaration,
    TypeAnnotation,
    UnaryExpression,
    VariableDeclaration,
    VariableSemantics,
} from '../ast'
import {
    bitfieldSet,
    integerRange,
    integerSingleton,
    integerTop,
    isSubsetValueSet,
    meetValueSets,
    neverValueSet,
    realSingleton,
    realTop,
    stringSingleton,
    stringTop,
    tritfieldSet,
    truthvalueSet,
    truthvalueTop,
    type ValueSet,
} from './lattice'

export interface SemanticDiagnostic {
    position: SourcePosition
    message: string
}

export interface SemanticBinding {
    semantics: VariableSemantics
    current: ValueSet
    allowed: ValueSet
}

export interface SemanticProgram {
    // Legacy map kept for compatibility with existing tests and callers.
    bindings: Map<string, ValueSet>
    bindingStates: Map<string, SemanticBinding>
    diagnostics: SemanticDiagnostic[]
}

export function analyzeProgram(program: Program): SemanticProgram {
    const bindings = new Map<string, ValueSet>()
    const bindingStates = new Map<string, SemanticBinding>()
    const subsetAliases = new Map<string, ValueSet>()
    const diagnostics: SemanticDiagnostic[] = []

    for (const statement of program.statements) {
        analyzeStatement(
            statement,
            bindings,
            bindingStates,
            subsetAliases,
            diagnostics,
        )
    }

    return { bindings, bindingStates, diagnostics }
}

function analyzeStatement(
    statement: Statement,
    bindings: Map<string, ValueSet>,
    bindingStates: Map<string, SemanticBinding>,
    subsetAliases: Map<string, ValueSet>,
    diagnostics: SemanticDiagnostic[],
) {
    switch (statement.kind) {
        case 'SubsetDeclaration': {
            analyzeSubsetDeclaration(statement, subsetAliases, diagnostics)
            return
        }
        case 'VariableDeclaration': {
            const inferred = inferDeclarationBinding(
                statement,
                bindings,
                subsetAliases,
                diagnostics,
            )
            if (inferred) {
                bindingStates.set(statement.identifier.name, inferred)
                bindings.set(statement.identifier.name, inferred.current)
            }
            return
        }
        case 'AssignmentStatement': {
            analyzeAssignmentStatement(
                statement,
                bindings,
                bindingStates,
                diagnostics,
            )
            return
        }
        case 'ExpressionStatement': {
            inferExpressionValueSet(statement.expression, bindings, diagnostics)
            return
        }
        case 'IfStatement': {
            analyzeIfStatement(
                statement,
                bindings,
                bindingStates,
                subsetAliases,
                diagnostics,
            )
            return
        }
    }
}

function analyzeSubsetDeclaration(
    statement: SubsetDeclaration,
    subsetAliases: Map<string, ValueSet>,
    diagnostics: SemanticDiagnostic[],
) {
    let valueSet: ValueSet

    switch (statement.family) {
        case 'integer': {
            if (
                statement.constraint &&
                statement.constraint.kind !== 'integer-range'
            ) {
                diagnostics.push({
                    position: statement.position,
                    message:
                        'integer subsets only support @range in this vertical slice',
                })
                return
            }
            valueSet = statement.constraint
                ? integerRange({
                      min: statement.constraint.min ?? undefined,
                      max: statement.constraint.max ?? undefined,
                      minInclusive: statement.constraint.minInclusive,
                      maxInclusive: statement.constraint.maxInclusive,
                  })
                : integerTop()
            break
        }
        case 'real': {
            if (statement.constraint !== null) {
                diagnostics.push({
                    position: statement.position,
                    message:
                        'real subset directives are not supported in this vertical slice',
                })
                return
            }
            valueSet = realTop()
            break
        }
        case 'string': {
            if (statement.constraint !== null) {
                diagnostics.push({
                    position: statement.position,
                    message:
                        'string subset directives are not supported in this vertical slice',
                })
                return
            }
            valueSet = stringTop()
            break
        }
        case 'truthvalue': {
            if (
                statement.constraint &&
                statement.constraint.kind !== 'truthvalue-values'
            ) {
                diagnostics.push({
                    position: statement.position,
                    message:
                        'truthvalue subsets only support @values/@except in this vertical slice',
                })
                return
            }

            valueSet = statement.constraint
                ? truthvalueSet(...statement.constraint.values)
                : truthvalueTop()
            break
        }
    }

    if (valueSet.family === 'never') {
        diagnostics.push({
            position: statement.position,
            message: `subset '${statement.identifier.name}' resolves to an empty set`,
        })
        return
    }

    subsetAliases.set(statement.identifier.name, valueSet)
}

function analyzeAssignmentStatement(
    statement: AssignmentStatement,
    bindings: Map<string, ValueSet>,
    bindingStates: Map<string, SemanticBinding>,
    diagnostics: SemanticDiagnostic[],
) {
    const binding = bindingStates.get(statement.target.name)
    if (!binding) {
        diagnostics.push({
            position: statement.target.position,
            message: `unknown identifier '${statement.target.name}'`,
        })
        return
    }

    if (binding.semantics === 'const') {
        diagnostics.push({
            position: statement.position,
            message: `cannot assign to const variable '${statement.target.name}'`,
        })
        return
    }

    const assigned = inferExpressionValueSet(
        statement.value,
        bindings,
        diagnostics,
    )
    if (!assigned) return

    if (!isSubsetValueSet(assigned, binding.allowed)) {
        diagnostics.push({
            position: statement.position,
            message: `assigned value ${describeValueSet(assigned)} is not assignable to allowed set ${describeValueSet(binding.allowed)}`,
        })
        return
    }

    const updated: SemanticBinding = {
        ...binding,
        current: assigned,
    }
    bindingStates.set(statement.target.name, updated)
    bindings.set(statement.target.name, assigned)
}

function analyzeIfStatement(
    statement: IfStatement,
    bindings: Map<string, ValueSet>,
    bindingStates: Map<string, SemanticBinding>,
    subsetAliases: Map<string, ValueSet>,
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
    const thenBindingStates = new Map(bindingStates)
    for (const child of statement.thenStatements) {
        analyzeStatement(
            child,
            thenBindings,
            thenBindingStates,
            subsetAliases,
            diagnostics,
        )
    }

    const elseBindings = new Map(bindings)
    const elseBindingStates = new Map(bindingStates)
    for (const child of statement.elseStatements) {
        analyzeStatement(
            child,
            elseBindings,
            elseBindingStates,
            subsetAliases,
            diagnostics,
        )
    }
}

function inferDeclarationBinding(
    statement: VariableDeclaration,
    bindings: Map<string, ValueSet>,
    subsetAliases: Map<string, ValueSet>,
    diagnostics: SemanticDiagnostic[],
): SemanticBinding | null {
    const initializer = inferExpressionValueSet(
        statement.initializer,
        bindings,
        diagnostics,
    )

    if (!initializer) return null

    const annotatedAllowed =
        statement.typeAnnotation === null
            ? null
            : allowedValueSetFromTypeAnnotation(
                  statement.typeAnnotation,
                  subsetAliases,
                  statement.position,
                  diagnostics,
              )

    let isAnnotationCompatible = true
    if (annotatedAllowed) {
        isAnnotationCompatible = validateTypeAnnotationCompatibility(
            annotatedAllowed,
            initializer,
            statement.position,
            diagnostics,
        )
    }

    if (statement.semantics === 'ref') {
        diagnostics.push({
            position: statement.position,
            message: `ref is only supported for shared structures (data/object/service), got ${describeValueSet(initializer)}`,
        })
        return null
    }

    if (statement.semantics === 'const') {
        return {
            semantics: statement.semantics,
            current: initializer,
            allowed: initializer,
        }
    }

    const allowed = annotatedAllowed ?? topForValueSet(initializer)
    if (!annotatedAllowed && !isSubsetValueSet(initializer, allowed)) {
        diagnostics.push({
            position: statement.position,
            message: `initializer ${describeValueSet(initializer)} is not assignable to allowed set ${describeValueSet(allowed)}`,
        })
    }

    if (annotatedAllowed && !isAnnotationCompatible) {
        return null
    }

    return {
        semantics: statement.semantics,
        current: initializer,
        allowed,
    }
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
): boolean {
    if (annotated.family !== inferred.family) {
        diagnostics.push({
            position,
            message: `type annotation ${describeValueSet(annotated)} is incompatible with initializer ${describeValueSet(inferred)}`,
        })
        return false
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
            return false
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
            return false
        }
    }

    if (!isSubsetValueSet(inferred, annotated)) {
        diagnostics.push({
            position,
            message: `type annotation ${describeValueSet(annotated)} is incompatible with initializer ${describeValueSet(inferred)}`,
        })
        return false
    }

    return true
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
    if (valueSet.family === 'truthvalue') {
        if (valueSet.values.length === 3) return 'truthvalue'
        return `truthvalue[${valueSet.values.join('|')}]`
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

function topForValueSet(valueSet: ValueSet): ValueSet {
    switch (valueSet.family) {
        case 'never':
            return neverValueSet
        case 'integer':
            return integerTop()
        case 'real':
            return realTop()
        case 'truthvalue':
            return truthvalueTop()
        case 'string':
            return stringTop()
        case 'bitfield':
            return bitfieldSet()
        case 'tritfield':
            return tritfieldSet()
    }
}

function allowedValueSetFromTypeAnnotation(
    typeAnnotation: TypeAnnotation,
    subsetAliases: Map<string, ValueSet>,
    position: SourcePosition,
    diagnostics: SemanticDiagnostic[],
): ValueSet {
    if (typeAnnotation.kind === 'field') {
        if (typeAnnotation.baseName === 'bitfield') {
            return bitfieldSet(typeAnnotation.length)
        }
        return tritfieldSet(typeAnnotation.length)
    }

    if (typeAnnotation.kind === 'subset-alias') {
        const resolved = subsetAliases.get(typeAnnotation.name)
        if (!resolved) {
            diagnostics.push({
                position,
                message: `unknown subset alias '${typeAnnotation.name}'`,
            })
            return neverValueSet
        }
        return resolved
    }

    switch (typeAnnotation.family) {
        case 'integer':
            return integerTop()
        case 'real':
            return realTop()
        case 'string':
            return stringTop()
        case 'truthvalue':
            return typeAnnotation.truthValues
                ? truthvalueSet(...typeAnnotation.truthValues)
                : truthvalueTop()
    }
}
