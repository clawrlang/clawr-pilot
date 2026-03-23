import type {
    CallExpression,
    Expression,
    ExpressionStatement,
    Program,
    VariableDeclaration,
} from '../ast'
import {
    type CExpression,
    type CStatement,
    type CTranslationUnit,
} from '../ir/c'
import type { VariableKind } from './lowering-types'
import { cTruthValue } from './lowering-utils'
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
} from './tritfield-lowering'

export function lowerToCIr(program: Program): CTranslationUnit {
    const mainStatements: CStatement[] = []
    const heapLocals: string[] = []
    const variableKinds = new Map<string, VariableKind>()
    let tempCounter = 0

    for (const statement of program.statements) {
        lowerStatement(
            statement,
            mainStatements,
            heapLocals,
            variableKinds,
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

function lowerStatement(
    statement: Program['statements'][number],
    statements: CStatement[],
    heapLocals: string[],
    variableKinds: Map<string, VariableKind>,
    nextTemp: () => string,
) {
    if (statement.kind === 'VariableDeclaration') {
        lowerVariableDeclaration(
            statement,
            statements,
            heapLocals,
            variableKinds,
            nextTemp,
        )
        return
    }

    lowerExpressionStatement(statement, statements, variableKinds, nextTemp)
}

function lowerVariableDeclaration(
    statement: VariableDeclaration,
    statements: CStatement[],
    heapLocals: string[],
    variableKinds: Map<string, VariableKind>,
    nextTemp: () => string,
) {
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
        statements.push({
            kind: 'CVariableDeclaration',
            type: 'Integer*',
            name: statement.identifier.name,
            initializer: lowered.value,
        })
        heapLocals.push(...detachedHeapTemps)
        heapLocals.push(statement.identifier.name)
        variableKinds.set(statement.identifier.name, 'integer')
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
        statements.push({
            kind: 'CVariableDeclaration',
            type: 'Real*',
            name: statement.identifier.name,
            initializer: lowered.value,
        })
        heapLocals.push(...detachedHeapTemps)
        heapLocals.push(statement.identifier.name)
        variableKinds.set(statement.identifier.name, 'real')
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
        return
    }

    if (isBitfieldExpression(statement.initializer, variableKinds)) {
        const lowered = lowerBitfieldExpression(
            statement.initializer,
            variableKinds,
            nextTemp,
        )
        statements.push(...lowered.setup)
        statements.push({
            kind: 'CVariableDeclaration',
            type: 'unsigned long long',
            name: statement.identifier.name,
            initializer: lowered.value,
        })
        variableKinds.set(statement.identifier.name, 'bitfield')
        return
    }

    if (isTritfieldExpression(statement.initializer, variableKinds)) {
        const lowered = lowerTritfieldExpression(
            statement.initializer,
            variableKinds,
        )
        statements.push(...lowered.setup)
        statements.push({
            kind: 'CVariableDeclaration',
            type: 'unsigned long long',
            name: statement.identifier.name,
            initializer: lowered.value,
        })
        variableKinds.set(statement.identifier.name, 'tritfield')
        return
    }

    throw new Error(
        'Only integer, truthvalue, real, string, bitfield, and tritfield variable initializers are supported in this vertical slice',
    )
}

function lowerExpressionStatement(
    statement: ExpressionStatement,
    statements: CStatement[],
    variableKinds: Map<string, VariableKind>,
    nextTemp: () => string,
) {
    const expr = statement.expression
    if (expr.kind !== 'CallExpression') {
        throw new Error(
            'Only call expressions are supported as statement expressions',
        )
    }

    lowerPrintCall(expr, statements, variableKinds, nextTemp)
}

function detachOwnedValue(value: CExpression, heapTemps: string[]) {
    if (value.kind !== 'CIdentifier') return heapTemps
    return heapTemps.filter((name) => name !== value.name)
}
