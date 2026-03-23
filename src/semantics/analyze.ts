import type { Expression, Program, VariableDeclaration } from '../ast'
import {
    bitfieldSet,
    integerSingleton,
    realSingleton,
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

        const inferred = inferDeclarationValueSet(statement)
        if (inferred) {
            bindings.set(statement.identifier.name, inferred)
        }
    }

    return { bindings }
}

function inferDeclarationValueSet(
    statement: VariableDeclaration,
): ValueSet | null {
    if (statement.typeAnnotation?.baseName === 'bitfield') {
        return bitfieldSet(statement.typeAnnotation.length)
    }

    if (statement.typeAnnotation?.baseName === 'tritfield') {
        return tritfieldSet(statement.typeAnnotation.length)
    }

    return inferExpressionValueSet(statement.initializer)
}

function inferExpressionValueSet(expression: Expression): ValueSet | null {
    switch (expression.kind) {
        case 'IntegerLiteral':
            return integerSingleton(expression.value)
        case 'RealLiteral':
            return realSingleton(expression.value)
        case 'TruthLiteral':
            return truthvalueSet(expression.value)
        case 'StringLiteral':
            return stringSingleton(expression.value)
        default:
            return null
    }
}
