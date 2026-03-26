import type {
    AssignmentStatement,
    CallExpression,
    Expression,
    ExpressionStatement,
    FunctionDeclaration,
    IfStatement,
    Program,
    SourcePosition,
    VariableDeclaration,
} from '../ast'
import {
    type CExpression,
    type CFunction,
    type CStatement,
    type CTranslationUnit,
} from '../ir/c'
import type { MutationStrategy, RuntimeType } from './lowering-types'
import { cExprCode, cTruthValue } from './lowering-utils'
import { isTruthExpression, lowerTruthExpression } from './truthvalue-lowering'
import { isIntegerExpression, lowerIntegerExpression } from './integer-lowering'
import { isRealExpression, lowerRealExpression } from './real-lowering'
import { lowerPrintCall } from './string-lowering'
import {
    isBitfieldExpression,
    lowerBitfieldExpression,
} from './bitfield-lowering'
import {
    isTritfieldExpression,
    lowerTritfieldExpression,
    tritfieldPlaneName,
} from './tritfield-lowering'

interface ReturnNormalizationMarker {
    functionName: string
    position: SourcePosition
}

interface LowerToCIrOptions {
    returnsRequiringNormalization?: ReturnNormalizationMarker[]
}

export function lowerToCIr(
    program: Program,
    options: LowerToCIrOptions = {},
): CTranslationUnit {
    const mainStatements: CStatement[] = []
    const loweredFunctions: CFunction[] = []
    const heapLocals: string[] = []
    const variableKinds = new Map<string, RuntimeType>()
    const mutationStrategies = new Map<string, MutationStrategy>()
    const tritfieldLengths = new Map<string, number>()
    const bitfieldLengths = new Map<string, number>()
    const returnsRequiringNormalization =
        options.returnsRequiringNormalization ?? []
    let tempCounter = 0

    for (const statement of program.statements) {
        if (statement.kind === 'FunctionDeclaration') {
            loweredFunctions.push(
                lowerFunctionDeclaration(
                    statement,
                    returnsRequiringNormalization,
                    () => `__clawr_tmp${tempCounter++}`,
                ),
            )
            continue
        }

        lowerStatement(
            statement,
            mainStatements,
            heapLocals,
            variableKinds,
            mutationStrategies,
            tritfieldLengths,
            bitfieldLengths,
            () => `__clawr_tmp${tempCounter++}`,
        )
    }

    for (const local of [...heapLocals].reverse()) {
        mainStatements.push({
            kind: 'CExpressionStatement',
            expression: {
                kind: 'CCallExpression',
                callee: 'releaseRC',
                args: [{ kind: 'CIdentifier', name: local }],
            },
        })
    }

    mainStatements.push({
        kind: 'CReturnStatement',
        value: { kind: 'CIntegerLiteral', value: '0' },
    })

    return {
        kind: 'CTranslationUnit',
        includes: ['"runtime.h"', '<stdio.h>', '<stdlib.h>'],
        functions: [
            {
                kind: 'CFunction',
                isStatic: true,
                returnType: 'Integer*',
                name: 'clawr_int_from_i64',
                params: [{ type: 'long long', name: 'value' }],
                statements: [
                    {
                        kind: 'CVariableDeclaration',
                        type: 'Array*',
                        name: 'digits',
                        initializer: {
                            kind: 'CCallExpression',
                            callee: 'Array¸new',
                            args: [
                                { kind: 'CIntegerLiteral', value: '1' },
                                {
                                    kind: 'CSizeofExpression',
                                    typeName: 'digit_t',
                                },
                            ],
                        },
                    },
                    {
                        kind: 'CAssignmentStatement',
                        target: {
                            kind: 'CRawExpression',
                            code: 'ARRAY_ELEMENT_AT(0, digits, digit_t)',
                        },
                        value: {
                            kind: 'CCastExpression',
                            typeName: 'digit_t',
                            expression: {
                                kind: 'CIdentifier',
                                name: 'value',
                            },
                        },
                    },
                    {
                        kind: 'CVariableDeclaration',
                        type: 'Integer*',
                        name: 'result',
                        initializer: {
                            kind: 'CCallExpression',
                            callee: 'Integer¸withDigits',
                            args: [{ kind: 'CIdentifier', name: 'digits' }],
                        },
                    },
                    {
                        kind: 'CExpressionStatement',
                        expression: {
                            kind: 'CCallExpression',
                            callee: 'releaseRC',
                            args: [{ kind: 'CIdentifier', name: 'digits' }],
                        },
                    },
                    {
                        kind: 'CReturnStatement',
                        value: {
                            kind: 'CIdentifier',
                            name: 'result',
                        },
                    },
                ],
            },
            ...loweredFunctions,
            {
                kind: 'CFunction',
                returnType: 'int',
                name: 'main',
                params: [],
                statements: mainStatements,
            },
        ],
    }
}

function lowerFunctionDeclaration(
    statement: FunctionDeclaration,
    returnsRequiringNormalization: ReturnNormalizationMarker[],
    nextTemp: () => string,
): CFunction {
    const returnType = cTypeForFunctionReturn(statement)
    const variableKinds = new Map<string, RuntimeType>()
    for (const parameter of statement.parameters) {
        const kind = runtimeKindFromTypeName(parameter.typeName)
        if (!kind) {
            throw new Error(
                `Function parameter '${parameter.name}' in '${statement.identifier.name}' requires a concrete supported type in this vertical slice`,
            )
        }
        variableKinds.set(parameter.name, kind)
    }

    const statements: CStatement[] = []
    const heapLocals: string[] = []
    const mutationStrategies = new Map<string, MutationStrategy>()
    const tritfieldLengths = new Map<string, number>()
    const bitfieldLengths = new Map<string, number>()

    for (const bodyStatement of statement.body) {
        lowerStatementInFunctionBody(
            bodyStatement,
            statement,
            statements,
            heapLocals,
            variableKinds,
            mutationStrategies,
            tritfieldLengths,
            bitfieldLengths,
            returnsRequiringNormalization,
            nextTemp,
        )
    }

    // Cleanup function-scope heap locals before function exit
    for (const local of [...heapLocals].reverse()) {
        statements.push({
            kind: 'CExpressionStatement',
            expression: {
                kind: 'CCallExpression',
                callee: 'releaseRC',
                args: [{ kind: 'CIdentifier', name: local }],
            },
        })
    }

    if (
        statements.length === 0 ||
        statements[statements.length - 1].kind !== 'CReturnStatement'
    ) {
        statements.push({ kind: 'CReturnStatement' })
    }

    return {
        kind: 'CFunction',
        returnType,
        name: statement.identifier.name,
        params: statement.parameters.map((parameter) => ({
            type: cTypeForParameter(parameter.typeName),
            name: parameter.name,
        })),
        statements,
    }
}

function cTypeForFunctionReturn(statement: FunctionDeclaration): string {
    if (!statement.returnSlot.typeName) return 'void'
    return cTypeForParameter(statement.returnSlot.typeName)
}

function cTypeForParameter(typeName: string | null): string {
    const runtimeKind = runtimeKindFromTypeName(typeName)
    if (runtimeKind === 'integer') return 'Integer*'
    if (runtimeKind === 'real') return 'Real*'
    if (runtimeKind === 'truthvalue') return 'int'
    if (runtimeKind === 'string') return 'String*'
    throw new Error(
        `Unsupported function type '${typeName ?? 'unknown'}' in this vertical slice`,
    )
}

function runtimeKindFromTypeName(typeName: string | null): RuntimeType | null {
    switch (typeName) {
        case 'integer':
            return 'integer'
        case 'real':
            return 'real'
        case 'truthvalue':
            return 'truthvalue'
        case 'string':
            return 'string'
        default:
            return null
    }
}

function lowerStatementInFunctionBody(
    statement: Program['statements'][number],
    fn: FunctionDeclaration,
    statements: CStatement[],
    heapLocals: string[],
    variableKinds: Map<string, RuntimeType>,
    mutationStrategies: Map<string, MutationStrategy>,
    tritfieldLengths: Map<string, number>,
    bitfieldLengths: Map<string, number>,
    returnsRequiringNormalization: ReturnNormalizationMarker[],
    nextTemp: () => string,
) {
    if (statement.kind === 'SubsetDeclaration') {
        return
    }

    if (statement.kind === 'FunctionDeclaration') {
        return
    }

    if (statement.kind === 'ReturnStatement') {
        lowerReturnStatementInFunction(
            statement,
            fn,
            statements,
            heapLocals,
            variableKinds,
            returnsRequiringNormalization,
            nextTemp,
        )
        return
    }

    if (statement.kind === 'IfStatement') {
        lowerIfStatementInFunctionBody(
            statement,
            fn,
            statements,
            heapLocals,
            variableKinds,
            mutationStrategies,
            tritfieldLengths,
            bitfieldLengths,
            returnsRequiringNormalization,
            nextTemp,
        )
        return
    }

    if (statement.kind === 'VariableDeclaration') {
        lowerVariableDeclaration(
            statement,
            statements,
            heapLocals,
            variableKinds,
            mutationStrategies,
            tritfieldLengths,
            bitfieldLengths,
            nextTemp,
        )
        return
    }

    if (statement.kind === 'AssignmentStatement') {
        lowerAssignmentStatement(
            statement,
            statements,
            variableKinds,
            mutationStrategies,
            tritfieldLengths,
            bitfieldLengths,
            nextTemp,
        )
        return
    }

    if (statement.kind === 'ExpressionStatement') {
        lowerExpressionStatement(
            statement,
            statements,
            variableKinds,
            tritfieldLengths,
            bitfieldLengths,
            nextTemp,
        )
        return
    }
}

function lowerIfStatementInFunctionBody(
    statement: IfStatement,
    fn: FunctionDeclaration,
    statements: CStatement[],
    heapLocals: string[],
    variableKinds: Map<string, RuntimeType>,
    mutationStrategies: Map<string, MutationStrategy>,
    tritfieldLengths: Map<string, number>,
    bitfieldLengths: Map<string, number>,
    returnsRequiringNormalization: ReturnNormalizationMarker[],
    nextTemp: () => string,
) {
    const loweredPredicate = lowerTruthExpression(
        statement.predicate,
        variableKinds,
        nextTemp,
    )

    const thenStatements: CStatement[] = []
    const thenHeapLocals: string[] = []
    const thenKinds = new Map(variableKinds)
    const thenMutationStrategies = new Map(mutationStrategies)
    const thenTritfieldLengths = new Map(tritfieldLengths)
    const thenBitfieldLengths = new Map(bitfieldLengths)
    for (const nested of statement.thenStatements) {
        lowerStatementInFunctionBody(
            nested,
            fn,
            thenStatements,
            thenHeapLocals,
            thenKinds,
            thenMutationStrategies,
            thenTritfieldLengths,
            thenBitfieldLengths,
            returnsRequiringNormalization,
            nextTemp,
        )
    }
    for (const local of [...thenHeapLocals].reverse()) {
        thenStatements.push({
            kind: 'CExpressionStatement',
            expression: {
                kind: 'CCallExpression',
                callee: 'releaseRC',
                args: [{ kind: 'CIdentifier', name: local }],
            },
        })
    }

    const elseStatements: CStatement[] = []
    const elseHeapLocals: string[] = []
    const elseKinds = new Map(variableKinds)
    const elseMutationStrategies = new Map(mutationStrategies)
    const elseTritfieldLengths = new Map(tritfieldLengths)
    const elseBitfieldLengths = new Map(bitfieldLengths)
    for (const nested of statement.elseStatements) {
        lowerStatementInFunctionBody(
            nested,
            fn,
            elseStatements,
            elseHeapLocals,
            elseKinds,
            elseMutationStrategies,
            elseTritfieldLengths,
            elseBitfieldLengths,
            returnsRequiringNormalization,
            nextTemp,
        )
    }
    for (const local of [...elseHeapLocals].reverse()) {
        elseStatements.push({
            kind: 'CExpressionStatement',
            expression: {
                kind: 'CCallExpression',
                callee: 'releaseRC',
                args: [{ kind: 'CIdentifier', name: local }],
            },
        })
    }

    statements.push(...loweredPredicate.setup)
    statements.push({
        kind: 'CIfStatement',
        condition: {
            kind: 'CRawExpression',
            code: `(${cTruthValue('true')} == ${cExprCode(loweredPredicate.value)})`,
        },
        thenStatements,
        elseStatements,
    })
}

function lowerReturnStatementInFunction(
    statement: Extract<
        Program['statements'][number],
        { kind: 'ReturnStatement' }
    >,
    fn: FunctionDeclaration,
    out: CStatement[],
    heapLocals: string[],
    variableKinds: Map<string, RuntimeType>,
    returnsRequiringNormalization: ReturnNormalizationMarker[],
    nextTemp: () => string,
) {
    // Cleanup local heap variables before return
    for (const local of [...heapLocals].reverse()) {
        out.push({
            kind: 'CExpressionStatement',
            expression: {
                kind: 'CCallExpression',
                callee: 'releaseRC',
                args: [{ kind: 'CIdentifier', name: local }],
            },
        })
    }

    if (!statement.value) {
        out.push({ kind: 'CReturnStatement' })
        return
    }

    if (isIntegerExpression(statement.value, variableKinds)) {
        const lowered = lowerIntegerExpression(
            statement.value,
            variableKinds,
            nextTemp,
        )
        out.push(...lowered.setup)

        const borrowedSource = borrowedIdentifierValue(
            lowered.value,
            lowered.heapTemps,
        )
        if (borrowedSource) {
            out.push({
                kind: 'CExpressionStatement',
                expression: {
                    kind: 'CCallExpression',
                    callee: 'retainRC',
                    args: [{ kind: 'CIdentifier', name: borrowedSource }],
                },
            })
        }

        const needsNormalization = returnsRequiringNormalization.some(
            (marker) =>
                marker.functionName === fn.identifier.name &&
                isSamePosition(marker.position, statement.position),
        )
        if (needsNormalization && lowered.value.kind === 'CIdentifier') {
            out.push({
                kind: 'CExpressionStatement',
                expression: {
                    kind: 'CCallExpression',
                    callee: 'mutateRC',
                    args: [{ kind: 'CIdentifier', name: lowered.value.name }],
                },
            })
        }

        const releaseTemps = detachOwnedValue(lowered.value, lowered.heapTemps)
        releaseOwnedTemps(out, releaseTemps)
        out.push({ kind: 'CReturnStatement', value: lowered.value })
        return
    }

    if (isRealExpression(statement.value, variableKinds)) {
        const lowered = lowerRealExpression(
            statement.value,
            variableKinds,
            nextTemp,
        )
        out.push(...lowered.setup)
        const borrowedSource = borrowedIdentifierValue(
            lowered.value,
            lowered.heapTemps,
        )
        if (borrowedSource) {
            out.push({
                kind: 'CExpressionStatement',
                expression: {
                    kind: 'CCallExpression',
                    callee: 'retainRC',
                    args: [{ kind: 'CIdentifier', name: borrowedSource }],
                },
            })
        }
        const releaseTemps = detachOwnedValue(lowered.value, lowered.heapTemps)
        releaseOwnedTemps(out, releaseTemps)
        out.push({ kind: 'CReturnStatement', value: lowered.value })
        return
    }

    if (isTruthExpression(statement.value, variableKinds)) {
        const lowered = lowerTruthExpression(
            statement.value,
            variableKinds,
            nextTemp,
        )
        out.push(...lowered.setup)
        out.push({ kind: 'CReturnStatement', value: lowered.value })
        return
    }

    throw new Error(
        `Function return lowering supports only integer/real/truthvalue expressions in this vertical slice (function '${fn.identifier.name}')`,
    )
}

function isSamePosition(a: SourcePosition, b: SourcePosition): boolean {
    return (
        a.file === b.file &&
        a.line === b.line &&
        a.column === b.column &&
        a.endLine === b.endLine &&
        a.endColumn === b.endColumn
    )
}

function lowerStatement(
    statement: Program['statements'][number],
    statements: CStatement[],
    heapLocals: string[],
    variableKinds: Map<string, RuntimeType>,
    mutationStrategies: Map<string, MutationStrategy>,
    tritfieldLengths: Map<string, number>,
    bitfieldLengths: Map<string, number>,
    nextTemp: () => string,
) {
    if (statement.kind === 'SubsetDeclaration') {
        return
    }

    if (statement.kind === 'FunctionDeclaration') {
        // Declarations are parsed but not lowered in this vertical slice.
        return
    }

    if (statement.kind === 'ReturnStatement') {
        // Return statements only participate in function-body semantic checks in this slice.
        return
    }

    if (statement.kind === 'IfStatement') {
        lowerIfStatement(
            statement,
            statements,
            variableKinds,
            mutationStrategies,
            tritfieldLengths,
            bitfieldLengths,
            nextTemp,
        )
        return
    }

    if (statement.kind === 'VariableDeclaration') {
        lowerVariableDeclaration(
            statement,
            statements,
            heapLocals,
            variableKinds,
            mutationStrategies,
            tritfieldLengths,
            bitfieldLengths,
            nextTemp,
        )
        return
    }

    if (statement.kind === 'AssignmentStatement') {
        lowerAssignmentStatement(
            statement,
            statements,
            variableKinds,
            mutationStrategies,
            tritfieldLengths,
            bitfieldLengths,
            nextTemp,
        )
        return
    }

    if (statement.kind === 'ExpressionStatement') {
        lowerExpressionStatement(
            statement,
            statements,
            variableKinds,
            tritfieldLengths,
            bitfieldLengths,
            nextTemp,
        )
        return
    }
}

function lowerAssignmentStatement(
    statement: AssignmentStatement,
    statements: CStatement[],
    variableKinds: Map<string, RuntimeType>,
    mutationStrategies: Map<string, MutationStrategy>,
    tritfieldLengths: Map<string, number>,
    bitfieldLengths: Map<string, number>,
    nextTemp: () => string,
) {
    const variableKind = variableKinds.get(statement.target.name)
    if (!variableKind) {
        throw new Error(
            `Unknown variable in assignment: ${statement.target.name}`,
        )
    }

    if (variableKind === 'truthvalue') {
        if (!isTruthExpression(statement.value, variableKinds)) {
            throw new Error(
                'Assignment to truthvalue requires truthvalue expression',
            )
        }
        const lowered = lowerTruthExpression(
            statement.value,
            variableKinds,
            nextTemp,
        )
        statements.push(...lowered.setup)
        statements.push({
            kind: 'CAssignmentStatement',
            target: { kind: 'CIdentifier', name: statement.target.name },
            value: lowered.value,
        })
        return
    }

    if (variableKind === 'integer') {
        if (!isIntegerExpression(statement.value, variableKinds)) {
            throw new Error('Assignment to integer requires integer expression')
        }
        const lowered = lowerIntegerExpression(
            statement.value,
            variableKinds,
            nextTemp,
        )
        statements.push(...lowered.setup)
        const releaseTemps = detachOwnedValue(lowered.value, lowered.heapTemps)
        const borrowedSource = borrowedIdentifierValue(
            lowered.value,
            lowered.heapTemps,
        )
        if (borrowedSource && borrowedSource === statement.target.name) {
            releaseOwnedTemps(statements, releaseTemps)
            return
        }
        if (borrowedSource) {
            statements.push({
                kind: 'CExpressionStatement',
                expression: {
                    kind: 'CCallExpression',
                    callee: 'retainRC',
                    args: [{ kind: 'CIdentifier', name: borrowedSource }],
                },
            })
        }
        lowerMutationPreparation(
            statement.target.name,
            statements,
            mutationStrategies,
        )
        statements.push({
            kind: 'CExpressionStatement',
            expression: {
                kind: 'CCallExpression',
                callee: 'releaseRC',
                args: [{ kind: 'CIdentifier', name: statement.target.name }],
            },
        })
        statements.push({
            kind: 'CAssignmentStatement',
            target: { kind: 'CIdentifier', name: statement.target.name },
            value: lowered.value,
        })
        releaseOwnedTemps(statements, releaseTemps)
        return
    }

    if (variableKind === 'real') {
        if (!isRealExpression(statement.value, variableKinds)) {
            throw new Error('Assignment to real requires real expression')
        }
        const lowered = lowerRealExpression(
            statement.value,
            variableKinds,
            nextTemp,
        )
        statements.push(...lowered.setup)
        const releaseTemps = detachOwnedValue(lowered.value, lowered.heapTemps)
        const borrowedSource = borrowedIdentifierValue(
            lowered.value,
            lowered.heapTemps,
        )
        if (borrowedSource && borrowedSource === statement.target.name) {
            releaseOwnedTemps(statements, releaseTemps)
            return
        }
        if (borrowedSource) {
            statements.push({
                kind: 'CExpressionStatement',
                expression: {
                    kind: 'CCallExpression',
                    callee: 'retainRC',
                    args: [{ kind: 'CIdentifier', name: borrowedSource }],
                },
            })
        }
        lowerMutationPreparation(
            statement.target.name,
            statements,
            mutationStrategies,
        )
        statements.push({
            kind: 'CExpressionStatement',
            expression: {
                kind: 'CCallExpression',
                callee: 'releaseRC',
                args: [{ kind: 'CIdentifier', name: statement.target.name }],
            },
        })
        statements.push({
            kind: 'CAssignmentStatement',
            target: { kind: 'CIdentifier', name: statement.target.name },
            value: lowered.value,
        })
        releaseOwnedTemps(statements, releaseTemps)
        return
    }

    if (variableKind === 'string') {
        if (statement.value.kind === 'StringLiteral') {
            const temp = nextTemp()
            statements.push({
                kind: 'CVariableDeclaration',
                type: 'String*',
                name: temp,
                initializer: {
                    kind: 'CCallExpression',
                    callee: 'String¸fromCString',
                    args: [
                        {
                            kind: 'CStringLiteral',
                            value: statement.value.value,
                        },
                    ],
                },
            })
            lowerMutationPreparation(
                statement.target.name,
                statements,
                mutationStrategies,
            )
            statements.push({
                kind: 'CExpressionStatement',
                expression: {
                    kind: 'CCallExpression',
                    callee: 'releaseRC',
                    args: [
                        { kind: 'CIdentifier', name: statement.target.name },
                    ],
                },
            })
            statements.push({
                kind: 'CAssignmentStatement',
                target: { kind: 'CIdentifier', name: statement.target.name },
                value: { kind: 'CIdentifier', name: temp },
            })
            return
        }

        if (
            statement.value.kind === 'Identifier' &&
            variableKinds.get(statement.value.name) === 'string'
        ) {
            if (statement.value.name !== statement.target.name) {
                statements.push({
                    kind: 'CExpressionStatement',
                    expression: {
                        kind: 'CCallExpression',
                        callee: 'retainRC',
                        args: [
                            { kind: 'CIdentifier', name: statement.value.name },
                        ],
                    },
                })
                lowerMutationPreparation(
                    statement.target.name,
                    statements,
                    mutationStrategies,
                )
                statements.push({
                    kind: 'CExpressionStatement',
                    expression: {
                        kind: 'CCallExpression',
                        callee: 'releaseRC',
                        args: [
                            {
                                kind: 'CIdentifier',
                                name: statement.target.name,
                            },
                        ],
                    },
                })
                statements.push({
                    kind: 'CAssignmentStatement',
                    target: {
                        kind: 'CIdentifier',
                        name: statement.target.name,
                    },
                    value: { kind: 'CIdentifier', name: statement.value.name },
                })
            }
            return
        }

        throw new Error(
            'Assignment to string requires a string literal or string identifier',
        )
    }

    if (variableKind === 'bitfield') {
        if (!isBitfieldExpression(statement.value, variableKinds)) {
            throw new Error(
                'Assignment to bitfield requires bitfield expression',
            )
        }
        const lowered = lowerBitfieldExpression(
            statement.value,
            variableKinds,
            bitfieldLengths,
            nextTemp,
        )
        statements.push(...lowered.setup)
        statements.push({
            kind: 'CAssignmentStatement',
            target: { kind: 'CIdentifier', name: statement.target.name },
            value: lowered.value,
        })
        return
    }

    if (variableKind === 'tritfield') {
        if (!isTritfieldExpression(statement.value, variableKinds)) {
            throw new Error(
                'Assignment to tritfield requires tritfield expression',
            )
        }
        const lowered = lowerTritfieldExpression(
            statement.value,
            variableKinds,
            tritfieldLengths,
            nextTemp,
        )
        statements.push(...lowered.setup)
        statements.push({
            kind: 'CAssignmentStatement',
            target: {
                kind: 'CIdentifier',
                name: tritfieldPlaneName(statement.target.name, 0),
            },
            value: lowered.x0,
        })
        statements.push({
            kind: 'CAssignmentStatement',
            target: {
                kind: 'CIdentifier',
                name: tritfieldPlaneName(statement.target.name, 1),
            },
            value: lowered.x1,
        })
        return
    }
}

function lowerIfStatement(
    statement: IfStatement,
    statements: CStatement[],
    variableKinds: Map<string, RuntimeType>,
    mutationStrategies: Map<string, MutationStrategy>,
    tritfieldLengths: Map<string, number>,
    bitfieldLengths: Map<string, number>,
    nextTemp: () => string,
) {
    if (!isTruthExpression(statement.predicate, variableKinds)) {
        throw new Error(
            'if predicate must be a truthvalue expression in this vertical slice',
        )
    }

    const loweredPredicate = lowerTruthExpression(
        statement.predicate,
        variableKinds,
        nextTemp,
    )

    const thenStatements: CStatement[] = []
    const thenHeapLocals: string[] = []
    const thenKinds = new Map(variableKinds)
    const thenMutationStrategies = new Map(mutationStrategies)
    const thenTritfieldLengths = new Map(tritfieldLengths)
    const thenBitfieldLengths = new Map(bitfieldLengths)
    for (const nested of statement.thenStatements) {
        lowerStatement(
            nested,
            thenStatements,
            thenHeapLocals,
            thenKinds,
            thenMutationStrategies,
            thenTritfieldLengths,
            thenBitfieldLengths,
            nextTemp,
        )
    }
    for (const local of [...thenHeapLocals].reverse()) {
        thenStatements.push({
            kind: 'CExpressionStatement',
            expression: {
                kind: 'CCallExpression',
                callee: 'releaseRC',
                args: [{ kind: 'CIdentifier', name: local }],
            },
        })
    }

    const elseStatements: CStatement[] = []
    const elseHeapLocals: string[] = []
    const elseKinds = new Map(variableKinds)
    const elseMutationStrategies = new Map(mutationStrategies)
    const elseTritfieldLengths = new Map(tritfieldLengths)
    const elseBitfieldLengths = new Map(bitfieldLengths)
    for (const nested of statement.elseStatements) {
        lowerStatement(
            nested,
            elseStatements,
            elseHeapLocals,
            elseKinds,
            elseMutationStrategies,
            elseTritfieldLengths,
            elseBitfieldLengths,
            nextTemp,
        )
    }
    for (const local of [...elseHeapLocals].reverse()) {
        elseStatements.push({
            kind: 'CExpressionStatement',
            expression: {
                kind: 'CCallExpression',
                callee: 'releaseRC',
                args: [{ kind: 'CIdentifier', name: local }],
            },
        })
    }

    statements.push(...loweredPredicate.setup)
    statements.push({
        kind: 'CIfStatement',
        condition: {
            kind: 'CRawExpression',
            code: `(${cTruthValue('true')} == ${cExprCode(loweredPredicate.value)})`,
        },
        thenStatements,
        elseStatements,
    })
}

function lowerVariableDeclaration(
    statement: VariableDeclaration,
    statements: CStatement[],
    heapLocals: string[],
    variableKinds: Map<string, RuntimeType>,
    mutationStrategies: Map<string, MutationStrategy>,
    tritfieldLengths: Map<string, number>,
    bitfieldLengths: Map<string, number>,
    nextTemp: () => string,
) {
    const laneAnnotation =
        statement.typeAnnotation && statement.typeAnnotation.kind === 'lane'
            ? statement.typeAnnotation
            : null

    if (statement.initializer.kind === 'IntegerLiteral') {
        statements.push({
            kind: 'CVariableDeclaration',
            type: 'Integer*',
            name: statement.identifier.name,
            initializer: {
                kind: 'CCallExpression',
                callee: 'clawr_int_from_i64',
                args: [
                    {
                        kind: 'CIntegerLiteral',
                        value: `${statement.initializer.value.toString()}LL`,
                    },
                ],
            },
        })
        heapLocals.push(statement.identifier.name)
        variableKinds.set(statement.identifier.name, 'integer')
        mutationStrategies.set(
            statement.identifier.name,
            statement.semantics === 'ref' ? 'shared-in-place' : 'isolated-cow',
        )
        return
    }

    if (isIntegerExpression(statement.initializer, variableKinds)) {
        const lowered = lowerIntegerExpression(
            statement.initializer,
            variableKinds,
            nextTemp,
        )
        statements.push(...lowered.setup)
        const detachedHeapTemps = detachOwnedValue(
            lowered.value,
            lowered.heapTemps,
        )
        const borrowedSource = borrowedIdentifierValue(
            lowered.value,
            lowered.heapTemps,
        )
        if (borrowedSource) {
            statements.push({
                kind: 'CExpressionStatement',
                expression: {
                    kind: 'CCallExpression',
                    callee: 'retainRC',
                    args: [{ kind: 'CIdentifier', name: borrowedSource }],
                },
            })
        }
        statements.push({
            kind: 'CVariableDeclaration',
            type: 'Integer*',
            name: statement.identifier.name,
            initializer: lowered.value,
        })
        releaseOwnedTemps(statements, detachedHeapTemps)
        heapLocals.push(statement.identifier.name)
        variableKinds.set(statement.identifier.name, 'integer')
        mutationStrategies.set(
            statement.identifier.name,
            statement.semantics === 'ref' ? 'shared-in-place' : 'isolated-cow',
        )
        return
    }

    if (statement.initializer.kind === 'TruthLiteral') {
        statements.push({
            kind: 'CVariableDeclaration',
            type: 'int',
            name: statement.identifier.name,
            initializer: {
                kind: 'CIntegerLiteral',
                value: cTruthValue(statement.initializer.value),
            },
        })
        variableKinds.set(statement.identifier.name, 'truthvalue')
        return
    }

    if (isTruthExpression(statement.initializer, variableKinds)) {
        const lowered = lowerTruthExpression(
            statement.initializer,
            variableKinds,
            nextTemp,
        )
        statements.push(...lowered.setup)
        statements.push({
            kind: 'CVariableDeclaration',
            type: 'int',
            name: statement.identifier.name,
            initializer: lowered.value,
        })
        variableKinds.set(statement.identifier.name, 'truthvalue')
        return
    }

    if (statement.initializer.kind === 'RealLiteral') {
        statements.push({
            kind: 'CVariableDeclaration',
            type: 'Real*',
            name: statement.identifier.name,
            initializer: {
                kind: 'CCallExpression',
                callee: 'Real¸fromString',
                args: [
                    {
                        kind: 'CStringLiteral',
                        value: statement.initializer.value,
                    },
                ],
            },
        })
        heapLocals.push(statement.identifier.name)
        variableKinds.set(statement.identifier.name, 'real')
        mutationStrategies.set(
            statement.identifier.name,
            statement.semantics === 'ref' ? 'shared-in-place' : 'isolated-cow',
        )
        return
    }

    if (isRealExpression(statement.initializer, variableKinds)) {
        const lowered = lowerRealExpression(
            statement.initializer,
            variableKinds,
            nextTemp,
        )
        statements.push(...lowered.setup)
        const detachedHeapTemps = detachOwnedValue(
            lowered.value,
            lowered.heapTemps,
        )
        const borrowedSource = borrowedIdentifierValue(
            lowered.value,
            lowered.heapTemps,
        )
        if (borrowedSource) {
            statements.push({
                kind: 'CExpressionStatement',
                expression: {
                    kind: 'CCallExpression',
                    callee: 'retainRC',
                    args: [{ kind: 'CIdentifier', name: borrowedSource }],
                },
            })
        }
        statements.push({
            kind: 'CVariableDeclaration',
            type: 'Real*',
            name: statement.identifier.name,
            initializer: lowered.value,
        })
        releaseOwnedTemps(statements, detachedHeapTemps)
        heapLocals.push(statement.identifier.name)
        variableKinds.set(statement.identifier.name, 'real')
        mutationStrategies.set(
            statement.identifier.name,
            statement.semantics === 'ref' ? 'shared-in-place' : 'isolated-cow',
        )
        return
    }

    if (statement.initializer.kind === 'StringLiteral') {
        statements.push({
            kind: 'CVariableDeclaration',
            type: 'String*',
            name: statement.identifier.name,
            initializer: {
                kind: 'CCallExpression',
                callee: 'String¸fromCString',
                args: [
                    {
                        kind: 'CStringLiteral',
                        value: statement.initializer.value,
                    },
                ],
            },
        })
        heapLocals.push(statement.identifier.name)
        variableKinds.set(statement.identifier.name, 'string')
        mutationStrategies.set(
            statement.identifier.name,
            statement.semantics === 'ref' ? 'shared-in-place' : 'isolated-cow',
        )
        return
    }

    if (isBitfieldExpression(statement.initializer, variableKinds)) {
        const lowered = lowerBitfieldExpression(
            statement.initializer,
            variableKinds,
            bitfieldLengths,
            nextTemp,
        )
        if (laneAnnotation && laneAnnotation.baseName !== 'binarylane') {
            throw new Error(
                `Variable ${statement.identifier.name} is declared as ternarylane[${laneAnnotation.length}] but initialized with a binarylane expression`,
            )
        }
        if (laneAnnotation && laneAnnotation.length !== lowered.length) {
            throw new Error(
                `binarylane length mismatch for ${statement.identifier.name}: declared ${laneAnnotation.length}, got ${lowered.length}`,
            )
        }
        statements.push(...lowered.setup)
        statements.push({
            kind: 'CVariableDeclaration',
            type: 'BinaryLaneField',
            name: statement.identifier.name,
            initializer: lowered.value,
        })
        variableKinds.set(statement.identifier.name, 'bitfield')
        bitfieldLengths.set(
            statement.identifier.name,
            laneAnnotation?.length ?? lowered.length,
        )
        return
    }

    if (isTritfieldExpression(statement.initializer, variableKinds)) {
        const lowered = lowerTritfieldExpression(
            statement.initializer,
            variableKinds,
            tritfieldLengths,
            nextTemp,
        )
        if (laneAnnotation && laneAnnotation.baseName !== 'ternarylane') {
            throw new Error(
                `Variable ${statement.identifier.name} is declared as binarylane[${laneAnnotation.length}] but initialized with a ternarylane expression`,
            )
        }
        if (laneAnnotation && laneAnnotation.length !== lowered.length) {
            throw new Error(
                `ternarylane length mismatch for ${statement.identifier.name}: declared ${laneAnnotation.length}, got ${lowered.length}`,
            )
        }
        statements.push(...lowered.setup)
        statements.push({
            kind: 'CVariableDeclaration',
            type: 'BinaryLaneField',
            name: tritfieldPlaneName(statement.identifier.name, 0),
            initializer: lowered.x0,
        })
        statements.push({
            kind: 'CVariableDeclaration',
            type: 'BinaryLaneField',
            name: tritfieldPlaneName(statement.identifier.name, 1),
            initializer: lowered.x1,
        })
        variableKinds.set(statement.identifier.name, 'tritfield')
        tritfieldLengths.set(
            statement.identifier.name,
            laneAnnotation?.length ?? lowered.length,
        )
        return
    }

    if (laneAnnotation) {
        throw new Error(
            `Type annotation ${laneAnnotation.baseName}[${laneAnnotation.length}] requires a matching lane initializer in this vertical slice`,
        )
    }

    if (mentionsBitfieldExpression(statement.initializer, variableKinds)) {
        throw new Error(
            'Bitfield expressions currently support only bitfield("...") constructors, identifiers, unary ~, and binary &, |, ^',
        )
    }

    if (mentionsTritfieldExpression(statement.initializer, variableKinds)) {
        throw new Error(
            'Tritfield expressions currently support only tritfield("...") constructors, identifiers, binary &, |, and calls rotate(..., by: ...), adjust(..., towards: ...), modulate(..., by: ...)',
        )
    }

    throw new Error(
        'Only integer, truthvalue, real, string, bitfield, and tritfield variable initializers are supported in this vertical slice',
    )
}

function lowerExpressionStatement(
    statement: ExpressionStatement,
    statements: CStatement[],
    variableKinds: Map<string, RuntimeType>,
    tritfieldLengths: Map<string, number>,
    bitfieldLengths: Map<string, number>,
    nextTemp: () => string,
) {
    const expr = statement.expression
    if (expr.kind === 'CallExpression') {
        if (expr.callee.kind === 'Identifier' && expr.callee.name === 'print') {
            lowerPrintCall(
                expr,
                statements,
                variableKinds,
                tritfieldLengths,
                bitfieldLengths,
                nextTemp,
            )
            return
        }
    }

    if (isIntegerExpression(expr, variableKinds)) {
        const lowered = lowerIntegerExpression(expr, variableKinds, nextTemp)
        statements.push(...lowered.setup)
        releaseOwnedTemps(statements, lowered.heapTemps)
        return
    }

    if (isRealExpression(expr, variableKinds)) {
        const lowered = lowerRealExpression(expr, variableKinds, nextTemp)
        statements.push(...lowered.setup)
        releaseOwnedTemps(statements, lowered.heapTemps)
        return
    }

    if (isTruthExpression(expr, variableKinds)) {
        const lowered = lowerTruthExpression(expr, variableKinds, nextTemp)
        statements.push(...lowered.setup)
        return
    }

    if (isBitfieldExpression(expr, variableKinds)) {
        const lowered = lowerBitfieldExpression(
            expr,
            variableKinds,
            bitfieldLengths,
            nextTemp,
        )
        statements.push(...lowered.setup)
        return
    }

    if (isTritfieldExpression(expr, variableKinds)) {
        const lowered = lowerTritfieldExpression(
            expr,
            variableKinds,
            tritfieldLengths,
            nextTemp,
        )
        statements.push(...lowered.setup)
        return
    }

    throw new Error(
        'Only print(...) calls and supported value expressions are allowed as statement expressions in this vertical slice',
    )
}

function detachOwnedValue(value: CExpression, heapTemps: string[]) {
    if (value.kind !== 'CIdentifier') return heapTemps
    return heapTemps.filter((name) => name !== value.name)
}

function borrowedIdentifierValue(
    value: CExpression,
    heapTemps: string[],
): string | null {
    if (value.kind !== 'CIdentifier') return null
    return heapTemps.includes(value.name) ? null : value.name
}

function releaseOwnedTemps(statements: CStatement[], temps: string[]) {
    for (const temp of temps) {
        statements.push({
            kind: 'CExpressionStatement',
            expression: {
                kind: 'CCallExpression',
                callee: 'releaseRC',
                args: [{ kind: 'CIdentifier', name: temp }],
            },
        })
    }
}

function lowerMutationPreparation(
    variableName: string,
    statements: CStatement[],
    mutationStrategies: Map<string, MutationStrategy>,
) {
    const strategy = mutationStrategies.get(variableName)
    if (strategy !== 'isolated-cow') return

    statements.push({
        kind: 'CExpressionStatement',
        expression: {
            kind: 'CCallExpression',
            callee: 'mutateRC',
            args: [{ kind: 'CIdentifier', name: variableName }],
        },
    })
}

function mentionsBitfieldExpression(
    expression: Expression,
    variableKinds: Map<string, RuntimeType>,
): boolean {
    switch (expression.kind) {
        case 'Identifier':
            return variableKinds.get(expression.name) === 'bitfield'
        case 'UnaryExpression':
            return mentionsBitfieldExpression(expression.operand, variableKinds)
        case 'BinaryExpression':
            return (
                mentionsBitfieldExpression(expression.left, variableKinds) ||
                mentionsBitfieldExpression(expression.right, variableKinds)
            )
        case 'CallExpression':
            return (
                (expression.callee.kind === 'Identifier' &&
                    expression.callee.name === 'bitfield') ||
                expression.arguments.some((argument) =>
                    mentionsBitfieldExpression(argument.value, variableKinds),
                )
            )
        case 'MemberExpression':
            return mentionsBitfieldExpression(expression.object, variableKinds)
        default:
            return false
    }
}

function mentionsTritfieldExpression(
    expression: Expression,
    variableKinds: Map<string, RuntimeType>,
): boolean {
    switch (expression.kind) {
        case 'Identifier':
            return variableKinds.get(expression.name) === 'tritfield'
        case 'UnaryExpression':
            return mentionsTritfieldExpression(
                expression.operand,
                variableKinds,
            )
        case 'BinaryExpression':
            return (
                mentionsTritfieldExpression(expression.left, variableKinds) ||
                mentionsTritfieldExpression(expression.right, variableKinds)
            )
        case 'CallExpression':
            return (
                (expression.callee.kind === 'Identifier' &&
                    (expression.callee.name === 'tritfield' ||
                        expression.callee.name === 'rotate' ||
                        expression.callee.name === 'adjust' ||
                        expression.callee.name === 'modulate')) ||
                expression.arguments.some((argument) =>
                    mentionsTritfieldExpression(argument.value, variableKinds),
                )
            )
        case 'MemberExpression':
            return mentionsTritfieldExpression(expression.object, variableKinds)
        default:
            return false
    }
}
