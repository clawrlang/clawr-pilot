import Decimal from 'decimal.js'
import type {
    AssignmentStatement,
    BinaryExpression,
    CallExpression,
    DataDeclaration,
    Expression,
    FunctionDeclaration,
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
    dataValueSet,
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

export interface ReturnNormalization {
    functionName: string
    position: SourcePosition
}

export interface DataTypeField {
    name: string
    valueSet: ValueSet
}

export interface DataTypeInfo {
    name: string
    fields: Map<string, DataTypeField>
}

export interface SemanticProgram {
    // Legacy map kept for compatibility with existing tests and callers.
    bindings: Map<string, ValueSet>
    bindingStates: Map<string, SemanticBinding>
    dataTypes: Map<string, DataTypeInfo>
    diagnostics: SemanticDiagnostic[]
    returnsRequiringNormalization: ReturnNormalization[]
}

interface FunctionSignature {
    name: string
    position: SourcePosition
    parameters: Array<{
        name: string
        mode: 'in' | 'const' | 'mut' | 'ref'
        typeName: string | null
    }>
    returnSemantics: 'unique' | 'const' | 'ref' | null
    returnTypeName: string | null
}

interface FunctionAnalysisContext {
    signature: FunctionSignature
}

export class SemanticAnalyzer {
    private readonly bindings: Map<string, ValueSet>
    private readonly bindingStates: Map<string, SemanticBinding>
    private readonly subsetAliases: Map<string, ValueSet>
    private readonly dataTypes: Map<string, DataTypeInfo>
    private readonly diagnostics: SemanticDiagnostic[]
    private readonly returnsRequiringNormalization: ReturnNormalization[]

    constructor(options?: {
        bindings?: Map<string, ValueSet>
        bindingStates?: Map<string, SemanticBinding>
        subsetAliases?: Map<string, ValueSet>
        dataTypes?: Map<string, DataTypeInfo>
        diagnostics?: SemanticDiagnostic[]
        returnsRequiringNormalization?: ReturnNormalization[]
    }) {
        this.bindings = options?.bindings ?? new Map<string, ValueSet>()
        this.bindingStates =
            options?.bindingStates ?? new Map<string, SemanticBinding>()
        this.subsetAliases =
            options?.subsetAliases ?? new Map<string, ValueSet>()
        this.dataTypes = options?.dataTypes ?? new Map<string, DataTypeInfo>()
        this.diagnostics = options?.diagnostics ?? []
        this.returnsRequiringNormalization =
            options?.returnsRequiringNormalization ?? []
    }

    analyzeProgram(program: Program): SemanticProgram {
        for (const statement of program.statements) {
            this.analyzeStatement(
                statement,
                this.collectFunctionSignatures(program),
                null,
            )
        }

        return {
            bindings: this.bindings,
            bindingStates: this.bindingStates,
            dataTypes: this.dataTypes,
            diagnostics: this.diagnostics,
            returnsRequiringNormalization: this.returnsRequiringNormalization,
        }
    }

    private collectFunctionSignatures(
        program: Program,
    ): Map<string, FunctionSignature> {
        const signatures = new Map<string, FunctionSignature>()

        for (const statement of program.statements) {
            if (statement.kind !== 'FunctionDeclaration') continue

            const signature: FunctionSignature = {
                name: statement.identifier.name,
                position: statement.position,
                parameters: statement.parameters.map((parameter) => ({
                    name: parameter.name,
                    mode: parameter.mode,
                    typeName: parameter.typeName,
                })),
                returnSemantics: statement.returnSlot.semantics,
                returnTypeName: statement.returnSlot.typeName,
            }

            const key = functionSignatureKey(
                statement.identifier.name,
                statement.parameters.length,
            )
            const existing = signatures.get(key)
            if (existing) {
                this.diagnostics.push({
                    position: statement.position,
                    message: `duplicate function signature '${statement.identifier.name}/${statement.parameters.length}'`,
                })
                continue
            }

            signatures.set(key, signature)
        }

        return signatures
    }

    analyzeStatement(
        statement: Statement,
        functionSignatures: Map<string, FunctionSignature>,
        functionContext: FunctionAnalysisContext | null,
    ) {
        switch (statement.kind) {
            case 'SubsetDeclaration': {
                this.analyzeSubsetDeclaration(statement)
                return
            }
            case 'DataDeclaration': {
                this.analyzeDataDeclaration(statement)
                return
            }
            case 'VariableDeclaration': {
                const inferred = this.inferDeclarationBinding(
                    statement,
                    functionSignatures,
                )
                if (inferred) {
                    this.bindingStates.set(statement.identifier.name, inferred)
                    this.bindings.set(
                        statement.identifier.name,
                        inferred.current,
                    )
                }
                return
            }
            case 'AssignmentStatement': {
                this.analyzeAssignmentStatement(statement, functionSignatures)
                return
            }
            case 'ExpressionStatement': {
                this.inferExpressionValueSet(
                    statement.expression,
                    functionSignatures,
                )
                return
            }
            case 'FunctionDeclaration': {
                const localScope = new SemanticAnalyzer({
                    ...this,
                    bindings: new Map<string, ValueSet>(),
                    bindingStates: new Map<string, SemanticBinding>(),
                })
                localScope.analyzeFunctionDeclaration(
                    statement,
                    functionSignatures,
                )
                return
            }
            case 'ReturnStatement': {
                this.analyzeReturnStatement(
                    statement,
                    functionSignatures,
                    functionContext,
                )
                return
            }
            case 'IfStatement': {
                this.analyzeIfStatement(
                    statement,
                    functionSignatures,
                    functionContext,
                )
                return
            }
        }
    }

    private analyzeSubsetDeclaration(statement: SubsetDeclaration) {
        let valueSet: ValueSet

        switch (statement.family) {
            case 'integer': {
                if (
                    statement.constraint &&
                    statement.constraint.kind !== 'integer-range'
                ) {
                    this.diagnostics.push({
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
                    this.diagnostics.push({
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
                    this.diagnostics.push({
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
                    this.diagnostics.push({
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
            this.diagnostics.push({
                position: statement.position,
                message: `subset '${statement.identifier.name}' resolves to an empty set`,
            })
            return
        }

        this.subsetAliases.set(statement.identifier.name, valueSet)
    }

    private analyzeDataDeclaration(statement: DataDeclaration) {
        const name = statement.identifier.name
        if (this.dataTypes.has(name)) {
            this.diagnostics.push({
                position: statement.position,
                message: `duplicate data type '${name}'`,
            })
            return
        }

        const fields = new Map<string, DataTypeField>()
        for (const field of statement.fields) {
            if (fields.has(field.name)) {
                this.diagnostics.push({
                    position: field.position,
                    message: `duplicate field '${field.name}' in data type '${name}'`,
                })
                continue
            }
            const valueSet = allowedValueSetFromTypeAnnotation(
                field.typeAnnotation,
                this.subsetAliases,
                this.dataTypes,
                field.position,
                this.diagnostics,
            )
            fields.set(field.name, { name: field.name, valueSet })
        }

        this.dataTypes.set(name, { name, fields })
    }

    private inferDeclarationBinding(
        statement: VariableDeclaration,
        functionSignatures: Map<string, FunctionSignature>,
    ): SemanticBinding | null {
        // DATA-ANALYZE-002/003/004:
        // Data literals are context-typed in V1. When an annotation names a registered
        // data type, validate fields before materializing the nominal data value-set.
        if (
            statement.initializer.kind === 'DataLiteral' &&
            statement.typeAnnotation !== null &&
            statement.typeAnnotation.kind === 'subset-alias'
        ) {
            const typeName = statement.typeAnnotation.name
            const dataType = this.dataTypes.get(typeName)
            if (dataType) {
                const fieldValidationDiagnosticsStart = this.diagnostics.length
                const providedFieldNames = new Set<string>()

                for (const field of statement.initializer.fields) {
                    providedFieldNames.add(field.name)

                    const targetField = dataType.fields.get(field.name)
                    if (!targetField) {
                        this.diagnostics.push({
                            position: field.position,
                            message: `unknown field '${field.name}' for data type '${typeName}'`,
                        })
                        continue
                    }

                    const inferredFieldValue = this.inferExpressionValueSet(
                        field.value,
                        functionSignatures,
                    )
                    if (!inferredFieldValue) continue

                    if (
                        !isSubsetValueSet(
                            inferredFieldValue,
                            targetField.valueSet,
                        )
                    ) {
                        this.diagnostics.push({
                            position: field.position,
                            message: `field '${field.name}' value ${describeValueSet(inferredFieldValue)} is not assignable to ${describeValueSet(targetField.valueSet)}`,
                        })
                    }
                }

                for (const requiredField of dataType.fields.values()) {
                    if (!providedFieldNames.has(requiredField.name)) {
                        this.diagnostics.push({
                            position: statement.initializer.position,
                            message: `missing required field '${requiredField.name}' for data type '${typeName}'`,
                        })
                    }
                }

                if (this.diagnostics.length > fieldValidationDiagnosticsStart) {
                    return null
                }

                const vs = dataValueSet(typeName)
                return {
                    semantics: statement.semantics,
                    current: vs,
                    allowed: vs,
                }
            }
        }

        const initializer = this.inferExpressionValueSet(
            statement.initializer,
            functionSignatures,
        )

        if (!initializer) return null

        const annotatedAllowed =
            statement.typeAnnotation === null
                ? null
                : allowedValueSetFromTypeAnnotation(
                      statement.typeAnnotation,
                      this.subsetAliases,
                      this.dataTypes,
                      statement.position,
                      this.diagnostics,
                  )

        let isAnnotationCompatible = true
        if (annotatedAllowed) {
            isAnnotationCompatible = validateTypeAnnotationCompatibility(
                annotatedAllowed,
                initializer,
                statement.position,
                this.diagnostics,
            )
        }

        if (statement.semantics === 'ref') {
            if (initializer.family !== 'data') {
                this.diagnostics.push({
                    position: statement.position,
                    message: `ref is only supported for shared structures (data/object/service), got ${describeValueSet(initializer)}`,
                })
                return null
            }
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
            this.diagnostics.push({
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

    private analyzeAssignmentStatement(
        statement: AssignmentStatement,
        functionSignatures: Map<string, FunctionSignature>,
    ) {
        const binding = this.bindingStates.get(statement.target.name)
        if (!binding) {
            this.diagnostics.push({
                position: statement.target.position,
                message: `unknown identifier '${statement.target.name}'`,
            })
            return
        }

        if (binding.semantics === 'const') {
            this.diagnostics.push({
                position: statement.position,
                message: `cannot assign to const variable '${statement.target.name}'`,
            })
            return
        }

        const assigned = this.inferExpressionValueSet(
            statement.value,
            functionSignatures,
        )
        if (!assigned) return

        if (!isSubsetValueSet(assigned, binding.allowed)) {
            this.diagnostics.push({
                position: statement.position,
                message: `assigned value ${describeValueSet(assigned)} is not assignable to allowed set ${describeValueSet(binding.allowed)}`,
            })
            return
        }

        const updated: SemanticBinding = {
            ...binding,
            current: assigned,
        }
        this.bindingStates.set(statement.target.name, updated)
        this.bindings.set(statement.target.name, assigned)
    }

    private inferExpressionValueSet(
        expression: Expression,
        functionSignatures: Map<string, FunctionSignature>,
    ): ValueSet | null {
        switch (expression.kind) {
            case 'Identifier': {
                const bound = this.bindings.get(expression.name)
                if (bound) return bound
                this.diagnostics.push({
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
                return this.inferUnaryValueSet(expression, functionSignatures)
            case 'BinaryExpression':
                return this.inferBinaryValueSet(expression, functionSignatures)
            case 'CallExpression':
                return this.inferCallValueSet(expression, functionSignatures)
            case 'MemberExpression':
                return null
            case 'DataLiteral':
                this.diagnostics.push({
                    position: expression.position,
                    message:
                        'data literal requires a known target type in V1; add a type annotation',
                })
                return null
        }
    }

    private analyzeFunctionDeclaration(
        statement: FunctionDeclaration,
        functionSignatures: Map<string, FunctionSignature>,
    ) {
        for (const parameter of statement.parameters) {
            const allowed = topValueSetForTypeName(parameter.typeName)
            const semantics: VariableSemantics =
                parameter.mode === 'ref'
                    ? 'ref'
                    : parameter.mode === 'mut'
                      ? 'mut'
                      : 'const'

            const binding: SemanticBinding = {
                semantics,
                current: allowed,
                allowed,
            }
            this.bindingStates.set(parameter.name, binding)
            this.bindings.set(parameter.name, binding.current)
        }

        const signature = functionSignatures.get(
            functionSignatureKey(
                statement.identifier.name,
                statement.parameters.length,
            ),
        )
        if (!signature) return

        const context: FunctionAnalysisContext = { signature }
        for (const bodyStatement of statement.body) {
            this.analyzeStatement(bodyStatement, functionSignatures, context)
        }

        if (
            signature.returnTypeName &&
            !statementsDefinitelyReturn(statement.body)
        ) {
            this.diagnostics.push({
                position: statement.position,
                message: `function '${signature.name}' may exit without returning a value`,
            })
        }
    }

    private analyzeReturnStatement(
        statement: Extract<Statement, { kind: 'ReturnStatement' }>,
        functionSignatures: Map<string, FunctionSignature>,
        functionContext: FunctionAnalysisContext | null,
    ) {
        if (!functionContext) {
            this.diagnostics.push({
                position: statement.position,
                message: 'return is only valid inside function bodies',
            })
            return
        }

        const { signature } = functionContext
        if (!statement.value) {
            if (signature.returnTypeName) {
                this.diagnostics.push({
                    position: statement.position,
                    message: `missing return value for function '${signature.name}'`,
                })
            }
            return
        }

        if (!signature.returnTypeName) {
            this.diagnostics.push({
                position: statement.position,
                message: `function '${signature.name}' does not declare a return value`,
            })
            return
        }

        const inferred = this.inferExpressionValueSet(
            statement.value,
            functionSignatures,
        )

        if (!inferred) return

        const declaredReturnValueSet = valueSetFromFunctionReturn(signature)
        if (
            declaredReturnValueSet &&
            inferred.family !== 'never' &&
            !isSubsetValueSet(inferred, declaredReturnValueSet)
        ) {
            this.diagnostics.push({
                position: statement.position,
                message: `returned value ${describeValueSet(inferred)} is not assignable to declared return type ${describeValueSet(declaredReturnValueSet)}`,
            })
            return
        }

        const expressionSemantics = inferExpressionSemanticsClass(
            statement.value,
            this.bindingStates,
            functionSignatures,
        )

        if (
            signature.returnSemantics === 'ref' &&
            expressionSemantics !== 'shared'
        ) {
            this.diagnostics.push({
                position: statement.position,
                message: `return in function '${signature.name}' requires shared semantics for '-> ref', got ${expressionSemantics}`,
            })
            return
        }

        if (
            signature.returnSemantics === 'const' &&
            expressionSemantics === 'shared'
        ) {
            this.diagnostics.push({
                position: statement.position,
                message: `return in function '${signature.name}' requires isolated semantics for '-> const', got shared`,
            })
            return
        }

        if (
            signature.returnSemantics === 'unique' &&
            expressionSemantics !== 'unique-return'
        ) {
            if (expressionSemantics === 'isolated') {
                // Mark for conservative normalization: the return value is isolated but
                // not provably unique. At codegen time, it will be normalized via mutateRC()
                // to ensure the unique-return contract is satisfied.
                this.returnsRequiringNormalization.push({
                    functionName: signature.name,
                    position: statement.position,
                })
            } else {
                // Shared expression cannot be returned as -> T even with normalization
                this.diagnostics.push({
                    position: statement.position,
                    message: `return in function '${signature.name}' requires unique-return semantics for '-> T', got shared`,
                })
            }
        }
    }

    private analyzeIfStatement(
        statement: IfStatement,
        functionSignatures: Map<string, FunctionSignature>,
        functionContext: FunctionAnalysisContext | null,
    ) {
        const predicate = this.inferExpressionValueSet(
            statement.predicate,
            functionSignatures,
        )

        if (predicate && predicate.family !== 'truthvalue') {
            this.diagnostics.push({
                position: statement.predicate.position,
                message: `if predicate must be truthvalue, got ${describeValueSet(predicate)}`,
            })
        }

        const thenBindings = new Map(this.bindings)
        const thenBindingStates = new Map(this.bindingStates)
        const elseBindings = new Map(this.bindings)
        const elseBindingStates = new Map(this.bindingStates)

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
                new SemanticAnalyzer({
                    bindings: thenBindings,
                    bindingStates: thenBindingStates,
                    subsetAliases: this.subsetAliases,
                    dataTypes: this.dataTypes,
                    diagnostics: this.diagnostics,
                    returnsRequiringNormalization:
                        this.returnsRequiringNormalization,
                }).analyzeStatement(child, functionSignatures, functionContext)
            }
        }

        if (elseReachable) {
            for (const child of statement.elseStatements) {
                new SemanticAnalyzer({
                    bindings: elseBindings,
                    bindingStates: elseBindingStates,
                    subsetAliases: this.subsetAliases,
                    dataTypes: this.dataTypes,
                    diagnostics: this.diagnostics,
                    returnsRequiringNormalization:
                        this.returnsRequiringNormalization,
                }).analyzeStatement(child, functionSignatures, functionContext)
            }
        }

        // Merge branch-local updates back into the parent scope conservatively.
        // Only pre-existing bindings are merged; declarations inside branches stay local.
        for (const [name, original] of this.bindingStates.entries()) {
            const thenState = thenBindingStates.get(name) ?? original
            const elseState = elseBindingStates.get(name) ?? original

            let mergedCurrent = original.current
            if (thenReachable && elseReachable) {
                mergedCurrent = joinValueSets(
                    thenState.current,
                    elseState.current,
                )
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
            this.bindingStates.set(name, merged)
            this.bindings.set(name, mergedCurrent)
        }
    }

    private inferUnaryValueSet(
        expression: UnaryExpression,
        functionSignatures: Map<string, FunctionSignature>,
    ): ValueSet | null {
        const operand = this.inferExpressionValueSet(
            expression.operand,
            functionSignatures,
        )
        if (!operand) return null

        switch (expression.operator) {
            case '!':
                if (operand.family !== 'truthvalue') {
                    this.diagnostics.push({
                        position: expression.position,
                        message: `operator '!' requires truthvalue operand, got ${describeValueSet(operand)}`,
                    })
                    return null
                }
                return truthvalueSet(...operand.values.map(invertTruthValue))
            case '~':
                if (operand.family !== 'bitfield') {
                    this.diagnostics.push({
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

                this.diagnostics.push({
                    position: expression.position,
                    message: `operator '-' requires integer or real operand, got ${describeValueSet(operand)}`,
                })
                return null
        }
    }

    private inferBinaryValueSet(
        expression: BinaryExpression,
        functionSignatures: Map<string, FunctionSignature>,
    ): ValueSet | null {
        const left = this.inferExpressionValueSet(
            expression.left,
            functionSignatures,
        )
        const right = this.inferExpressionValueSet(
            expression.right,
            functionSignatures,
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
                this.diagnostics.push({
                    position: expression.position,
                    message: `operator '${expression.operator}' requires matching numeric operands${
                        expression.operator === '^'
                            ? ' or bitfield operands'
                            : ''
                    }, got ${describeValueSet(left)} and ${describeValueSet(right)}`,
                })
                return null
            case '&':
            case '|':
                if (left.family === 'bitfield' && right.family === 'bitfield') {
                    return meetValueSets(left, right)
                }
                if (
                    left.family === 'tritfield' &&
                    right.family === 'tritfield'
                ) {
                    return meetValueSets(left, right)
                }
                this.diagnostics.push({
                    position: expression.position,
                    message: `operator '${expression.operator}' requires matching binarylane or ternarylane operands, got ${describeValueSet(left)} and ${describeValueSet(right)}`,
                })
                return null
            case '&&':
                if (
                    left.family === 'truthvalue' &&
                    right.family === 'truthvalue'
                ) {
                    return combineTruthvalueSets(
                        left.values,
                        right.values,
                        truthAnd,
                    )
                }
                this.diagnostics.push({
                    position: expression.position,
                    message: `operator '&&' requires truthvalue operands, got ${describeValueSet(left)} and ${describeValueSet(right)}`,
                })
                return null
            case '||':
                if (
                    left.family === 'truthvalue' &&
                    right.family === 'truthvalue'
                ) {
                    return combineTruthvalueSets(
                        left.values,
                        right.values,
                        truthOr,
                    )
                }
                this.diagnostics.push({
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
                this.diagnostics.push({
                    position: expression.position,
                    message: `operator '${expression.operator}' requires matching integer or real operands, got ${describeValueSet(left)} and ${describeValueSet(right)}`,
                })
                return null
        }
    }

    private inferCallValueSet(
        expression: CallExpression,
        functionSignatures: Map<string, FunctionSignature>,
    ): ValueSet | null {
        if (expression.callee.kind !== 'Identifier') return null

        const userFunction = functionSignatures.get(
            functionSignatureKey(
                expression.callee.name,
                expression.arguments.length,
            ),
        )
        if (userFunction) {
            validateFunctionCallSemantics(
                expression,
                userFunction,
                this.bindingStates,
                functionSignatures,
                this.diagnostics,
            )
            return valueSetFromFunctionReturn(userFunction)
        }

        if (
            expression.callee.name !== 'bitfield' &&
            expression.callee.name !== 'tritfield'
        ) {
            return this.inferTruthCallableValueSet(
                expression,
                functionSignatures,
            )
        }

        if (expression.arguments.length !== 1) {
            this.diagnostics.push({
                position: expression.position,
                message: `${expression.callee.name}(...) requires exactly one argument`,
            })
            return null
        }

        const [argument] = expression.arguments
        if (argument.label !== null) {
            this.diagnostics.push({
                position: expression.position,
                message: `${expression.callee.name}(...) does not accept labeled arguments`,
            })
            return null
        }

        if (argument.value.kind !== 'StringLiteral') {
            this.diagnostics.push({
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

    private inferTruthCallableValueSet(
        expression: CallExpression,
        functionSignatures: Map<string, FunctionSignature>,
    ): ValueSet | null {
        if (expression.callee.kind !== 'Identifier') return null
        const name = expression.callee.name
        const args = expression.arguments

        const bindThis = this
        // Resolve a single argument to a truthvalue value-set, or return null.
        function resolveTruth(argIndex: number): Array<TruthValueAtom> | null {
            const vs = bindThis.inferExpressionValueSet(
                args[argIndex].value,
                functionSignatures,
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
}

function functionSignatureKey(name: string, arity: number): string {
    return `${name}/${arity}`
}

function inferCallArgumentSemanticsClass(
    expression: Expression,
    bindingStates: Map<string, SemanticBinding>,
    functionSignatures: Map<string, FunctionSignature>,
): 'isolated' | 'shared' | 'unknown' {
    if (expression.kind === 'Identifier') {
        const binding = bindingStates.get(expression.name)
        if (!binding) return 'unknown'
        return binding.semantics === 'ref' ? 'shared' : 'isolated'
    }

    if (
        expression.kind === 'CallExpression' &&
        expression.callee.kind === 'Identifier'
    ) {
        const signature = functionSignatures.get(
            functionSignatureKey(
                expression.callee.name,
                expression.arguments.length,
            ),
        )
        if (!signature) return 'unknown'
        if (signature.returnSemantics === 'ref') return 'shared'
        return 'isolated'
    }

    // Literals and computed values are treated as isolated by default in V1.
    return 'isolated'
}

function inferExpressionSemanticsClass(
    expression: Expression,
    bindingStates: Map<string, SemanticBinding>,
    functionSignatures: Map<string, FunctionSignature>,
): 'isolated' | 'shared' | 'unique-return' | 'unknown' {
    if (expression.kind === 'Identifier') {
        const binding = bindingStates.get(expression.name)
        if (!binding) return 'unknown'
        return binding.semantics === 'ref' ? 'shared' : 'isolated'
    }

    if (
        expression.kind === 'CallExpression' &&
        expression.callee.kind === 'Identifier'
    ) {
        const signature = functionSignatures.get(
            functionSignatureKey(
                expression.callee.name,
                expression.arguments.length,
            ),
        )
        if (!signature) return 'unknown'
        if (signature.returnSemantics === 'ref') return 'shared'
        if (signature.returnSemantics === 'unique') return 'unique-return'
        return 'isolated'
    }

    return 'isolated'
}

function isAcceptedRefArgumentExpression(
    expression: Expression,
    bindingStates: Map<string, SemanticBinding>,
    functionSignatures: Map<string, FunctionSignature>,
): boolean {
    if (expression.kind === 'Identifier') {
        return bindingStates.get(expression.name)?.semantics === 'ref'
    }

    if (
        expression.kind === 'CallExpression' &&
        expression.callee.kind === 'Identifier'
    ) {
        const signature = functionSignatures.get(
            functionSignatureKey(
                expression.callee.name,
                expression.arguments.length,
            ),
        )
        return signature?.returnSemantics === 'ref'
    }

    return false
}

function validateFunctionCallSemantics(
    call: CallExpression,
    signature: FunctionSignature,
    bindingStates: Map<string, SemanticBinding>,
    functionSignatures: Map<string, FunctionSignature>,
    diagnostics: SemanticDiagnostic[],
) {
    for (let i = 0; i < signature.parameters.length; i += 1) {
        const parameter = signature.parameters[i]
        const argument = call.arguments[i]
        const semantics = inferCallArgumentSemanticsClass(
            argument.value,
            bindingStates,
            functionSignatures,
        )

        if (parameter.mode === 'in') continue

        if (
            (parameter.mode === 'const' || parameter.mode === 'mut') &&
            semantics === 'shared'
        ) {
            diagnostics.push({
                position: call.position,
                message: `argument ${i + 1} for parameter '${parameter.name}' requires isolated semantics (${parameter.mode}), got shared`,
            })
            continue
        }

        if (parameter.mode === 'ref') {
            if (
                isAcceptedRefArgumentExpression(
                    argument.value,
                    bindingStates,
                    functionSignatures,
                )
            ) {
                continue
            }

            if (semantics === 'isolated') {
                diagnostics.push({
                    position: call.position,
                    message: `argument ${i + 1} for parameter '${parameter.name}' must be a ref variable or a function returning ref`,
                })
            } else {
                diagnostics.push({
                    position: call.position,
                    message: `argument ${i + 1} for parameter '${parameter.name}' requires shared ref semantics, got ${semantics}`,
                })
            }
        }
    }
}

function valueSetFromFunctionReturn(
    signature: FunctionSignature,
): ValueSet | null {
    if (!signature.returnTypeName) return null

    switch (signature.returnTypeName) {
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
        default:
            return null
    }
}

function topValueSetForTypeName(typeName: string | null): ValueSet {
    switch (typeName) {
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
        default:
            return neverValueSet
    }
}

function statementsDefinitelyReturn(statements: Statement[]): boolean {
    for (const statement of statements) {
        if (statementDefinitelyReturns(statement)) {
            return true
        }
    }

    return false
}

function statementDefinitelyReturns(statement: Statement): boolean {
    switch (statement.kind) {
        case 'ReturnStatement':
            return true
        case 'IfStatement':
            return (
                statementsDefinitelyReturn(statement.thenStatements) &&
                statementsDefinitelyReturn(statement.elseStatements)
            )
        default:
            return false
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

type TruthValueAtom = 'false' | 'ambiguous' | 'true'

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
                message: `type annotation binarylane[${annotated.length}] is incompatible with binarylane[${inferred.length}] initializer`,
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
                message: `type annotation ternarylane[${annotated.length}] is incompatible with ternarylane[${inferred.length}] initializer`,
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
            ? 'binarylane'
            : `binarylane[${valueSet.length}]`
    }
    if (valueSet.family === 'tritfield') {
        return valueSet.length === null
            ? 'ternarylane'
            : `ternarylane[${valueSet.length}]`
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
    if (valueSet.family === 'data') return `data[${valueSet.typeName}]`
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
        case 'data':
            // Data types are nominal; the "top" for a data value is the type itself.
            return valueSet
    }
}

function allowedValueSetFromTypeAnnotation(
    typeAnnotation: TypeAnnotation,
    subsetAliases: Map<string, ValueSet>,
    dataTypes: Map<string, DataTypeInfo>,
    position: SourcePosition,
    diagnostics: SemanticDiagnostic[],
): ValueSet {
    if (typeAnnotation.kind === 'lane') {
        if (typeAnnotation.baseName === 'binarylane') {
            return bitfieldSet(typeAnnotation.length)
        }
        return tritfieldSet(typeAnnotation.length)
    }

    if (typeAnnotation.kind === 'subset-alias') {
        const dataType = dataTypes.get(typeAnnotation.name)
        if (dataType) {
            return dataValueSet(typeAnnotation.name)
        }
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
