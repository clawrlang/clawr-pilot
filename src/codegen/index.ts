import type {
    AssignmentStatement,
    CallExpression,
    Expression,
    ExpressionStatement,
    IfStatement,
    Program,
    VariableDeclaration,
} from '../ast'
import {
    type CExpression,
    type CStatement,
    type CTranslationUnit,
} from '../ir/c'
import type { RuntimeType } from './lowering-types'
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

export function lowerToCIr(program: Program): CTranslationUnit {
    const mainStatements: CStatement[] = []
    const heapLocals: string[] = []
    const variableKinds = new Map<string, RuntimeType>()
    const tritfieldLengths = new Map<string, number>()
    const bitfieldLengths = new Map<string, number>()
    let tempCounter = 0

    for (const statement of program.statements) {
        lowerStatement(
            statement,
            mainStatements,
            heapLocals,
            variableKinds,
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
    variableKinds: Map<string, RuntimeType>,
    tritfieldLengths: Map<string, number>,
    bitfieldLengths: Map<string, number>,
    nextTemp: () => string,
) {
    if (statement.kind === 'IfStatement') {
        lowerIfStatement(
            statement,
            statements,
            variableKinds,
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
            tritfieldLengths,
            bitfieldLengths,
            nextTemp,
        )
        return
    }

    lowerExpressionStatement(
        statement,
        statements,
        variableKinds,
        tritfieldLengths,
        bitfieldLengths,
        nextTemp,
    )
}

function lowerAssignmentStatement(
    statement: AssignmentStatement,
    statements: CStatement[],
    variableKinds: Map<string, RuntimeType>,
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
        const releaseTemps = detachOwnedValue(lowered.value, lowered.heapTemps)
        for (const temp of releaseTemps) {
            statements.push({
                kind: 'CExpressionStatement',
                expression: {
                    kind: 'CCallExpression',
                    callee: 'releaseRC',
                    args: [{ kind: 'CIdentifier', name: temp }],
                },
            })
        }
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
        const releaseTemps = detachOwnedValue(lowered.value, lowered.heapTemps)
        for (const temp of releaseTemps) {
            statements.push({
                kind: 'CExpressionStatement',
                expression: {
                    kind: 'CCallExpression',
                    callee: 'releaseRC',
                    args: [{ kind: 'CIdentifier', name: temp }],
                },
            })
        }
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
    const thenTritfieldLengths = new Map(tritfieldLengths)
    const thenBitfieldLengths = new Map(bitfieldLengths)
    for (const nested of statement.thenStatements) {
        lowerStatement(
            nested,
            thenStatements,
            thenHeapLocals,
            thenKinds,
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
    const elseTritfieldLengths = new Map(tritfieldLengths)
    const elseBitfieldLengths = new Map(bitfieldLengths)
    for (const nested of statement.elseStatements) {
        lowerStatement(
            nested,
            elseStatements,
            elseHeapLocals,
            elseKinds,
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
    tritfieldLengths: Map<string, number>,
    bitfieldLengths: Map<string, number>,
    nextTemp: () => string,
) {
    const fieldAnnotation =
        statement.typeAnnotation && statement.typeAnnotation.kind === 'field'
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
            bitfieldLengths,
            nextTemp,
        )
        if (fieldAnnotation && fieldAnnotation.baseName !== 'bitfield') {
            throw new Error(
                `Variable ${statement.identifier.name} is declared as tritfield[${fieldAnnotation.length}] but initialized with a bitfield expression`,
            )
        }
        if (fieldAnnotation && fieldAnnotation.length !== lowered.length) {
            throw new Error(
                `bitfield length mismatch for ${statement.identifier.name}: declared ${fieldAnnotation.length}, got ${lowered.length}`,
            )
        }
        statements.push(...lowered.setup)
        statements.push({
            kind: 'CVariableDeclaration',
            type: 'unsigned long long',
            name: statement.identifier.name,
            initializer: lowered.value,
        })
        variableKinds.set(statement.identifier.name, 'bitfield')
        bitfieldLengths.set(
            statement.identifier.name,
            fieldAnnotation?.length ?? lowered.length,
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
        if (fieldAnnotation && fieldAnnotation.baseName !== 'tritfield') {
            throw new Error(
                `Variable ${statement.identifier.name} is declared as bitfield[${fieldAnnotation.length}] but initialized with a tritfield expression`,
            )
        }
        if (fieldAnnotation && fieldAnnotation.length !== lowered.length) {
            throw new Error(
                `tritfield length mismatch for ${statement.identifier.name}: declared ${fieldAnnotation.length}, got ${lowered.length}`,
            )
        }
        statements.push(...lowered.setup)
        statements.push({
            kind: 'CVariableDeclaration',
            type: 'unsigned long long',
            name: tritfieldPlaneName(statement.identifier.name, 0),
            initializer: lowered.x0,
        })
        statements.push({
            kind: 'CVariableDeclaration',
            type: 'unsigned long long',
            name: tritfieldPlaneName(statement.identifier.name, 1),
            initializer: lowered.x1,
        })
        variableKinds.set(statement.identifier.name, 'tritfield')
        tritfieldLengths.set(
            statement.identifier.name,
            fieldAnnotation?.length ?? lowered.length,
        )
        return
    }

    if (fieldAnnotation) {
        throw new Error(
            `Type annotation ${fieldAnnotation.baseName}[${fieldAnnotation.length}] requires a matching field initializer in this vertical slice`,
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
    if (expr.kind !== 'CallExpression') {
        throw new Error(
            'Only call expressions are supported as statement expressions',
        )
    }

    lowerPrintCall(
        expr,
        statements,
        variableKinds,
        tritfieldLengths,
        bitfieldLengths,
        nextTemp,
    )
}

function detachOwnedValue(value: CExpression, heapTemps: string[]) {
    if (value.kind !== 'CIdentifier') return heapTemps
    return heapTemps.filter((name) => name !== value.name)
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
