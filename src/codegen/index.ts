import type {
    BinaryExpression,
    CallExpression,
    Expression,
    ExpressionStatement,
    Program,
    VariableDeclaration,
} from '../ast'
import {
    emitC,
    type CExpression,
    type CStatement,
    type CTranslationUnit,
} from '../ir/c'

export function generateC(program: Program): string {
    return emitC(lowerToCIr(program))
}

export function lowerToCIr(program: Program): CTranslationUnit {
    const mainStatements: CStatement[] = []
    const heapLocals: string[] = []
    const variableKinds = new Map<string, 'integer' | 'truthvalue' | 'real'>()
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
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real'>,
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
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real'>,
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

    throw new Error(
        'Only integer, truthvalue, and real literal variable initializers are supported in this vertical slice',
    )
}

function lowerExpressionStatement(
    statement: ExpressionStatement,
    statements: CStatement[],
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real'>,
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

function lowerPrintCall(
    call: CallExpression,
    statements: CStatement[],
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real'>,
    nextTemp: () => string,
) {
    if (call.callee.kind !== 'Identifier' || call.callee.name !== 'print') {
        throw new Error('Only print(...) is supported in this vertical slice')
    }

    if (call.arguments.length !== 1) {
        throw new Error('print(...) must have exactly one argument')
    }

    const render = lowerStringExpression(
        call.arguments[0],
        variableKinds,
        nextTemp,
    )
    statements.push(...render.setup)
    statements.push({
        kind: 'CExpressionStatement',
        expression: {
            kind: 'CCallExpression',
            callee: 'printf',
            args: [{ kind: 'CStringLiteral', value: '%s\n' }, render.value],
        },
    })
    if (render.freeAfterUse) {
        statements.push({
            kind: 'CExpressionStatement',
            expression: {
                kind: 'CCallExpression',
                callee: 'free',
                args: [
                    {
                        kind: 'CCastExpression',
                        typeName: 'void*',
                        expression: render.value,
                    },
                ],
            },
        })
    }
}

function lowerStringExpression(
    expression: Expression,
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real'>,
    nextTemp: () => string,
): { setup: CStatement[]; value: CExpression; freeAfterUse: boolean } {
    if (expression.kind === 'TruthLiteral') {
        return {
            setup: [],
            value: {
                kind: 'CStringLiteral',
                value: expression.value,
            },
            freeAfterUse: false,
        }
    }

    if (expression.kind === 'Identifier') {
        const variableKind = variableKinds.get(expression.name)
        if (variableKind === 'truthvalue') {
            return {
                setup: [],
                value: {
                    kind: 'CRawExpression',
                    code: `(${expression.name} == 0 ? "false" : (${expression.name} == 2 ? "true" : "ambiguous"))`,
                },
                freeAfterUse: false,
            }
        }
    }

    if (expression.kind === 'CallExpression') {
        if (
            expression.callee.kind === 'MemberExpression' &&
            expression.callee.property === 'toString' &&
            expression.arguments.length === 0
        ) {
            const object = expression.callee.object
            if (object.kind !== 'Identifier') {
                throw new Error(
                    'toString() receiver must currently be a variable',
                )
            }

            const variableKind = variableKinds.get(object.name)
            let toStringCallee: 'Integer·toString' | 'Real·toString'
            if (variableKind === 'integer') {
                toStringCallee = 'Integer·toString'
            } else if (variableKind === 'real') {
                toStringCallee = 'Real·toString'
            } else {
                throw new Error(
                    'toString() is currently supported only for integer and real variables',
                )
            }

            const temp = nextTemp()
            return {
                setup: [
                    {
                        kind: 'CVariableDeclaration',
                        type: 'const char*',
                        name: temp,
                        initializer: {
                            kind: 'CCallExpression',
                            callee: toStringCallee,
                            args: [{ kind: 'CIdentifier', name: object.name }],
                        },
                    },
                ],
                value: { kind: 'CIdentifier', name: temp },
                freeAfterUse: true,
            }
        }
    }

    throw new Error(
        'Only truthvalue expressions and <identifier>.toString() are supported as print arguments',
    )
}

function isIntegerExpression(
    expression: Expression,
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real'>,
): boolean {
    switch (expression.kind) {
        case 'IntegerLiteral':
            return true
        case 'Identifier':
            return variableKinds.get(expression.name) === 'integer'
        case 'BinaryExpression':
            return (
                isIntegerExpression(expression.left, variableKinds) &&
                isIntegerExpression(expression.right, variableKinds)
            )
        default:
            return false
    }
}

function lowerIntegerExpression(
    expression: Expression,
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real'>,
    nextTemp: () => string,
): { setup: CStatement[]; value: CExpression; heapTemps: string[] } {
    if (expression.kind === 'IntegerLiteral') {
        const temp = nextTemp()
        return {
            setup: [
                {
                    kind: 'CVariableDeclaration',
                    type: 'Integer*',
                    name: temp,
                    initializer: {
                        kind: 'CCallExpression',
                        callee: 'clawr_int_from_i64',
                        args: [
                            {
                                kind: 'CIntegerLiteral',
                                value: `${expression.value.toString()}LL`,
                            },
                        ],
                    },
                },
            ],
            value: { kind: 'CIdentifier', name: temp },
            heapTemps: [temp],
        }
    }

    if (
        expression.kind === 'Identifier' &&
        variableKinds.get(expression.name) === 'integer'
    ) {
        return {
            setup: [],
            value: { kind: 'CIdentifier', name: expression.name },
            heapTemps: [],
        }
    }

    if (expression.kind === 'BinaryExpression') {
        return lowerIntegerBinaryExpression(expression, variableKinds, nextTemp)
    }

    throw new Error('Unsupported integer expression in this vertical slice')
}

function lowerIntegerBinaryExpression(
    expression: BinaryExpression,
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real'>,
    nextTemp: () => string,
): { setup: CStatement[]; value: CExpression; heapTemps: string[] } {
    const left = lowerIntegerExpression(
        expression.left,
        variableKinds,
        nextTemp,
    )
    const right = lowerIntegerExpression(
        expression.right,
        variableKinds,
        nextTemp,
    )
    const calleeMap: Record<string, string> = {
        '+': 'Integer¸add',
        '-': 'Integer¸subtract',
        '*': 'Integer¸multiply',
        '/': 'Integer¸divide',
        '^': 'Integer¸power',
    }
    const callee = calleeMap[expression.operator]
    const temp = nextTemp()

    return {
        setup: [
            ...left.setup,
            ...right.setup,
            {
                kind: 'CVariableDeclaration',
                type: 'Integer*',
                name: temp,
                initializer: {
                    kind: 'CCallExpression',
                    callee,
                    args: [left.value, right.value],
                },
            },
        ],
        value: { kind: 'CIdentifier', name: temp },
        heapTemps: [...left.heapTemps, ...right.heapTemps, temp],
    }
}

function isRealExpression(
    expression: Expression,
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real'>,
): boolean {
    switch (expression.kind) {
        case 'RealLiteral':
            return true
        case 'Identifier':
            return variableKinds.get(expression.name) === 'real'
        case 'BinaryExpression':
            return (
                isRealExpression(expression.left, variableKinds) &&
                isRealExpression(expression.right, variableKinds)
            )
        default:
            return false
    }
}

function lowerRealExpression(
    expression: Expression,
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real'>,
    nextTemp: () => string,
): { setup: CStatement[]; value: CExpression; heapTemps: string[] } {
    if (expression.kind === 'RealLiteral') {
        const temp = nextTemp()
        return {
            setup: [
                {
                    kind: 'CVariableDeclaration',
                    type: 'Real*',
                    name: temp,
                    initializer: {
                        kind: 'CCallExpression',
                        callee: 'Real¸fromString',
                        args: [
                            { kind: 'CStringLiteral', value: expression.value },
                        ],
                    },
                },
            ],
            value: { kind: 'CIdentifier', name: temp },
            heapTemps: [temp],
        }
    }

    if (
        expression.kind === 'Identifier' &&
        variableKinds.get(expression.name) === 'real'
    ) {
        return {
            setup: [],
            value: { kind: 'CIdentifier', name: expression.name },
            heapTemps: [],
        }
    }

    if (expression.kind === 'BinaryExpression') {
        return lowerRealBinaryExpression(expression, variableKinds, nextTemp)
    }

    throw new Error('Unsupported real expression in this vertical slice')
}

function lowerRealBinaryExpression(
    expression: BinaryExpression,
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real'>,
    nextTemp: () => string,
): { setup: CStatement[]; value: CExpression; heapTemps: string[] } {
    const left = lowerRealExpression(expression.left, variableKinds, nextTemp)
    const right = lowerRealExpression(expression.right, variableKinds, nextTemp)
    const calleeMap: Record<string, string> = {
        '+': 'Real¸add',
        '-': 'Real¸subtract',
        '*': 'Real¸multiply',
        '/': 'Real¸divide',
        '^': 'Real¸power',
    }
    const callee = calleeMap[expression.operator]
    const temp = nextTemp()

    return {
        setup: [
            ...left.setup,
            ...right.setup,
            {
                kind: 'CVariableDeclaration',
                type: 'Real*',
                name: temp,
                initializer: {
                    kind: 'CCallExpression',
                    callee,
                    args: [left.value, right.value],
                },
            },
        ],
        value: { kind: 'CIdentifier', name: temp },
        heapTemps: [...left.heapTemps, ...right.heapTemps, temp],
    }
}

function detachOwnedValue(value: CExpression, heapTemps: string[]) {
    if (value.kind !== 'CIdentifier') return heapTemps
    return heapTemps.filter((name) => name !== value.name)
}

function cTruthValue(value: 'false' | 'ambiguous' | 'true'): string {
    switch (value) {
        case 'false':
            return '0'
        case 'ambiguous':
            return '1'
        case 'true':
            return '2'
    }
}
