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
    SubsetConstraint,
    SubsetDeclaration,
    StringAtomicSubsetConstraint,
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
    joinValueSets,
    meetValueSets,
    neverValueSet,
    realRange,
    realSingleton,
    realTop,
    stringLengthRange,
    stringPattern,
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
        case 'FunctionDeclaration': {
            // Function semantics are parsed but not analyzed in this vertical slice.
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
                        'integer subsets only support range constraints in this vertical slice',
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
            if (
                statement.constraint &&
                statement.constraint.kind !== 'real-range'
            ) {
                diagnostics.push({
                    position: statement.position,
                    message:
                        'real subsets only support range constraints in this vertical slice',
                })
                return
            }
            valueSet = statement.constraint
                ? realRange({
                      min: statement.constraint.min ?? undefined,
                      max: statement.constraint.max ?? undefined,
                      minInclusive: statement.constraint.minInclusive,
                      maxInclusive: statement.constraint.maxInclusive,
                  })
                : realTop()
            break
        }
        case 'string': {
            if (
                statement.constraint &&
                statement.constraint.kind !== 'string-length' &&
                statement.constraint.kind !== 'string-pattern' &&
                statement.constraint.kind !== 'string-composite'
            ) {
                diagnostics.push({
                    position: statement.position,
                    message:
                        'string subsets only support length ranges, regex constraints, and one and/or composition in this vertical slice',
                })
                return
            }
            valueSet = statement.constraint
                ? valueSetFromStringConstraint(statement.constraint)
                : stringTop()
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
                        'truthvalue subsets only support set constraints in this vertical slice',
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
    const elseBindings = new Map(bindings)
    const elseBindingStates = new Map(bindingStates)

    let thenReachable = true
    let elseReachable = true

    // In this vertical slice, if(...) enters then only when predicate == true.
    if (predicate && predicate.family === 'truthvalue') {
        const thenConstraints = collectTruthBranchConstraints(
            statement.predicate,
            ['true'],
        )
        const elseConstraints = collectTruthBranchConstraints(
            statement.predicate,
            ['false', 'ambiguous'],
        )

        thenReachable = applyTruthBranchConstraints(
            thenConstraints,
            thenBindings,
            thenBindingStates,
        )
        elseReachable = applyTruthBranchConstraints(
            elseConstraints,
            elseBindings,
            elseBindingStates,
        )
    }

    if (thenReachable) {
        for (const child of statement.thenStatements) {
            analyzeStatement(
                child,
                thenBindings,
                thenBindingStates,
                subsetAliases,
                diagnostics,
            )
        }
    }

    if (elseReachable) {
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

    // Merge branch-local updates back into the parent scope conservatively.
    // Only pre-existing bindings are merged; declarations inside branches stay local.
    for (const [name, original] of bindingStates.entries()) {
        const thenState = thenBindingStates.get(name) ?? original
        const elseState = elseBindingStates.get(name) ?? original

        let mergedCurrent = original.current
        if (thenReachable && elseReachable) {
            mergedCurrent = joinValueSets(thenState.current, elseState.current)
        } else if (thenReachable) {
            mergedCurrent = thenState.current
        } else if (elseReachable) {
            mergedCurrent = elseState.current
        }

        const merged: SemanticBinding = {
            semantics: original.semantics,
            allowed: original.allowed,
            current: mergedCurrent,
        }
        bindingStates.set(name, merged)
        bindings.set(name, mergedCurrent)
    }
}

function collectTruthBranchConstraints(
    expression: Expression,
    targetValues: TruthValueAtom[],
): Map<string, ValueSet> {
    const constraints = new Map<string, ValueSet>()

    function addConstraint(name: string, next: ValueSet) {
        const current = constraints.get(name)
        constraints.set(name, current ? meetValueSets(current, next) : next)
    }

    function walk(node: Expression, target: TruthValueAtom[]) {
        if (node.kind === 'Identifier') {
            addConstraint(node.name, truthvalueSet(...target))
            return
        }

        if (node.kind === 'UnaryExpression' && node.operator === '!') {
            const invertedTarget = truthvalueSet(
                ...target.map(invertTruthValue),
            ).values
            walk(node.operand, invertedTarget)
            return
        }

        if (node.kind === 'BinaryExpression' && node.operator === '&&') {
            // a && b can be true only if both operands are true.
            if (target.length === 1 && target[0] === 'true') {
                walk(node.left, ['true'])
                walk(node.right, ['true'])
            }
            return
        }

        if (node.kind === 'BinaryExpression' && node.operator === '||') {
            // a || b is non-true only if both operands are non-true.
            if (!target.includes('true')) {
                walk(node.left, ['false', 'ambiguous'])
                walk(node.right, ['false', 'ambiguous'])
            }
        }
    }

    walk(expression, targetValues)
    return constraints
}

function applyTruthBranchConstraints(
    constraints: Map<string, ValueSet>,
    bindings: Map<string, ValueSet>,
    bindingStates: Map<string, SemanticBinding>,
): boolean {
    for (const [name, constraint] of constraints.entries()) {
        const binding = bindingStates.get(name)
        if (!binding || binding.current.family !== 'truthvalue') continue

        const narrowed = meetValueSets(binding.current, constraint)
        if (narrowed.family === 'never') return false

        const updated: SemanticBinding = {
            ...binding,
            current: narrowed,
        }
        bindingStates.set(name, updated)
        bindings.set(name, narrowed)
    }

    return true
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
            return inferCallValueSet(expression, bindings, diagnostics)
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
    bindings: Map<string, ValueSet>,
    diagnostics: SemanticDiagnostic[],
): ValueSet | null {
    if (expression.callee.kind !== 'Identifier') return null

    if (
        expression.callee.name !== 'bitfield' &&
        expression.callee.name !== 'tritfield'
    ) {
        return inferTruthCallableValueSet(expression, bindings, diagnostics)
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

type TruthValueAtom = 'false' | 'ambiguous' | 'true'

function inferTruthCallableValueSet(
    expression: CallExpression,
    bindings: Map<string, ValueSet>,
    diagnostics: SemanticDiagnostic[],
): ValueSet | null {
    if (expression.callee.kind !== 'Identifier') return null
    const name = expression.callee.name
    const args = expression.arguments

    // Resolve a single argument to a truthvalue value-set, or return null.
    function resolveTruth(argIndex: number): Array<TruthValueAtom> | null {
        const vs = inferExpressionValueSet(
            args[argIndex].value,
            bindings,
            diagnostics,
        )
        if (!vs || vs.family !== 'truthvalue') return null
        return vs.values
    }

    // Binary callables: modulate(x, by: y), rotate(x, by: y), adjust(x, towards: y)
    if (args.length === 2) {
        let op:
            | ((a: TruthValueAtom, b: TruthValueAtom) => TruthValueAtom)
            | null = null
        if (name === 'modulate') op = truthModulate
        else if (name === 'rotate') op = truthRotateBy
        else if (name === 'adjust') op = truthAdjTowards
        if (op) {
            const a = resolveTruth(0)
            const b = resolveTruth(1)
            if (!a || !b) return null
            return combineTruthvalueSets(a, b, op)
        }
    }

    // Unary aliases with bound second argument
    if (args.length === 1) {
        const a = resolveTruth(0)
        if (!a) return null
        if (name === 'rotateUp')
            return combineTruthvalueSets(a, ['true'], truthRotateBy)
        if (name === 'rotateDown')
            return combineTruthvalueSets(a, ['false'], truthRotateBy)
        if (name === 'adjustUp')
            return combineTruthvalueSets(a, ['true'], truthAdjTowards)
        if (name === 'adjustDown')
            return combineTruthvalueSets(a, ['false'], truthAdjTowards)
    }

    return null
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
    if (valueSet.family === 'integer') {
        if (valueSet.form === 'top') return 'integer'
        if (valueSet.form === 'singleton') return `integer[${valueSet.value}]`
        return `integer[${describeRangeBounds(valueSet)}]`
    }
    if (valueSet.family === 'real') {
        if (valueSet.form === 'top') return 'real'
        if (valueSet.form === 'singleton') return `real[${valueSet.value}]`
        return `real[${describeRangeBounds(valueSet)}]`
    }
    if (valueSet.family === 'truthvalue') {
        if (valueSet.values.length === 3) return 'truthvalue'
        return `truthvalue[${valueSet.values.join('|')}]`
    }
    if (valueSet.family === 'string') {
        if (valueSet.form === 'top') return 'string'
        if (valueSet.form === 'singleton') {
            return `string[${JSON.stringify(valueSet.value)}]`
        }
        if (valueSet.form === 'length') {
            return `string[length ${describeRangeBounds(valueSet)}]`
        }
        if (valueSet.form === 'length-and-pattern') {
            return `string[length ${describeRangeBounds(valueSet)} and /${valueSet.pattern}/${valueSet.modifiers}]`
        }
        return `string[/${valueSet.pattern}/${valueSet.modifiers}]`
    }
    return 'unknown'
}

function describeRangeBounds(range: {
    min: bigint | string | null
    max: bigint | string | null
    minInclusive: boolean
    maxInclusive: boolean
}) {
    if (range.min === null && range.max === null) return '...'
    if (range.min === null) {
        return range.maxInclusive ? `...${range.max}` : `...<${range.max}`
    }
    if (range.max === null) return `${range.min}...`
    return `${range.min}${range.maxInclusive ? '..' : '..<'}${range.max}`
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

function truthRotateBy(
    value: TruthValueAtom,
    by: TruthValueAtom,
): TruthValueAtom {
    if (value === 'ambiguous') return by
    if (by === 'ambiguous') return value
    if (by === 'true') {
        // rotate up: false→ambiguous, ambiguous→true, true→false
        if (value === 'false') return 'ambiguous'
        return 'false' // value is 'true'
    }
    // rotate down (by=false): false→true, ambiguous→false, true→ambiguous
    return value === 'false' ? 'true' : 'ambiguous' // value is 'false' or 'true'
}

function truthAdjTowards(
    value: TruthValueAtom,
    towards: TruthValueAtom,
): TruthValueAtom {
    if (value === 'ambiguous') return towards
    if (towards === 'ambiguous') return value
    return value === towards ? value : 'ambiguous'
}

function truthModulate(a: TruthValueAtom, b: TruthValueAtom): TruthValueAtom {
    if (a === 'ambiguous' || b === 'ambiguous') return 'ambiguous'
    return a === b ? 'true' : 'false'
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
            return typeAnnotation.integerRange
                ? integerRange({
                      min: typeAnnotation.integerRange.min ?? undefined,
                      max: typeAnnotation.integerRange.max ?? undefined,
                      minInclusive: typeAnnotation.integerRange.minInclusive,
                      maxInclusive: typeAnnotation.integerRange.maxInclusive,
                  })
                : integerTop()
        case 'real':
            return typeAnnotation.realRange
                ? realRange({
                      min: typeAnnotation.realRange.min ?? undefined,
                      max: typeAnnotation.realRange.max ?? undefined,
                      minInclusive: typeAnnotation.realRange.minInclusive,
                      maxInclusive: typeAnnotation.realRange.maxInclusive,
                  })
                : realTop()
        case 'string':
            if (typeAnnotation.stringComposite) {
                return valueSetFromStringConstraint({
                    kind: 'string-composite',
                    ...typeAnnotation.stringComposite,
                })
            }
            if (typeAnnotation.stringLength) {
                return stringLengthRange({
                    min: typeAnnotation.stringLength.min ?? undefined,
                    max: typeAnnotation.stringLength.max ?? undefined,
                    minInclusive: typeAnnotation.stringLength.minInclusive,
                    maxInclusive: typeAnnotation.stringLength.maxInclusive,
                })
            }
            if (typeAnnotation.stringPattern) {
                return stringPattern(
                    typeAnnotation.stringPattern.pattern,
                    typeAnnotation.stringPattern.modifiers,
                )
            }
            return stringTop()
        case 'truthvalue':
            return typeAnnotation.truthValues
                ? truthvalueSet(...typeAnnotation.truthValues)
                : truthvalueTop()
    }
}

function valueSetFromStringConstraint(
    constraint: Extract<
        SubsetConstraint,
        { kind: 'string-length' | 'string-pattern' | 'string-composite' }
    >,
): ValueSet {
    if (constraint.kind === 'string-length') {
        return stringLengthRange({
            min: constraint.min ?? undefined,
            max: constraint.max ?? undefined,
            minInclusive: constraint.minInclusive,
            maxInclusive: constraint.maxInclusive,
        })
    }
    if (constraint.kind === 'string-pattern') {
        return stringPattern(constraint.pattern, constraint.modifiers)
    }

    const left = valueSetFromStringAtomicConstraint(constraint.left)
    const right = valueSetFromStringAtomicConstraint(constraint.right)
    return constraint.operator === 'and'
        ? meetValueSets(left, right)
        : joinValueSets(left, right)
}

function valueSetFromStringAtomicConstraint(
    constraint: StringAtomicSubsetConstraint,
): ValueSet {
    return constraint.kind === 'string-length'
        ? stringLengthRange({
              min: constraint.min ?? undefined,
              max: constraint.max ?? undefined,
              minInclusive: constraint.minInclusive,
              maxInclusive: constraint.maxInclusive,
          })
        : stringPattern(constraint.pattern, constraint.modifiers)
}
