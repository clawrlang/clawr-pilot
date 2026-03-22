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
    const variableKinds = new Map<
        string,
        'integer' | 'truthvalue' | 'real' | 'string'
    >()
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
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real' | 'string'>,
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
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real' | 'string'>,
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

    throw new Error(
        'Only integer, truthvalue, real, and string literal variable initializers are supported in this vertical slice',
    )
}

function lowerExpressionStatement(
    statement: ExpressionStatement,
    statements: CStatement[],
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real' | 'string'>,
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
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real' | 'string'>,
    nextTemp: () => string,
) {
    if (call.callee.kind !== 'Identifier' || call.callee.name !== 'print') {
        throw new Error('Only print(...) is supported in this vertical slice')
    }

    if (call.arguments.length !== 1) {
        throw new Error('print(...) must have exactly one argument')
    }

    if (call.arguments[0].label !== null) {
        throw new Error(
            'print(...) does not currently support labeled arguments',
        )
    }

    const render = lowerStringExpression(
        call.arguments[0].value,
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
    if (render.releaseAfterUse) {
        statements.push({
            kind: 'CExpressionStatement',
            expression: {
                kind: 'CCallExpression',
                callee: 'releaseRC',
                args: [{ kind: 'CIdentifier', name: render.releaseAfterUse }],
            },
        })
    }
}

function lowerStringExpression(
    expression: Expression,
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real' | 'string'>,
    nextTemp: () => string,
): { setup: CStatement[]; value: CExpression; releaseAfterUse?: string } {
    if (expression.kind === 'TruthLiteral') {
        return {
            setup: [],
            value: {
                kind: 'CStringLiteral',
                value: expression.value,
            },
        }
    }

    if (expression.kind === 'StringLiteral') {
        const stringObjectTemp = nextTemp()
        const cStringTemp = nextTemp()
        return {
            setup: [
                {
                    kind: 'CVariableDeclaration',
                    type: 'String*',
                    name: stringObjectTemp,
                    initializer: {
                        kind: 'CCallExpression',
                        callee: 'String¸fromCString',
                        args: [
                            {
                                kind: 'CStringLiteral',
                                value: expression.value,
                            },
                        ],
                    },
                },
                {
                    kind: 'CVariableDeclaration',
                    type: 'const char*',
                    name: cStringTemp,
                    initializer: {
                        kind: 'CCallExpression',
                        callee: 'String·toCString',
                        args: [{ kind: 'CIdentifier', name: stringObjectTemp }],
                    },
                },
            ],
            value: { kind: 'CIdentifier', name: cStringTemp },
            releaseAfterUse: stringObjectTemp,
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
            }
        }
        if (variableKind === 'string') {
            const cStringTemp = nextTemp()
            return {
                setup: [
                    {
                        kind: 'CVariableDeclaration',
                        type: 'const char*',
                        name: cStringTemp,
                        initializer: {
                            kind: 'CCallExpression',
                            callee: 'String·toCString',
                            args: [
                                { kind: 'CIdentifier', name: expression.name },
                            ],
                        },
                    },
                ],
                value: { kind: 'CIdentifier', name: cStringTemp },
            }
        }
    }

    if (isTruthExpression(expression, variableKinds)) {
        const lowered = lowerTruthExpression(
            expression,
            variableKinds,
            nextTemp,
        )
        const code = cExprCode(lowered.value)
        return {
            setup: lowered.setup,
            value: {
                kind: 'CRawExpression',
                code: `(${code} == 0 ? "false" : (${code} == 2 ? "true" : "ambiguous"))`,
            },
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
            let toStringCallee: 'Integer·toStringRC' | 'Real·toStringRC'
            if (variableKind === 'integer') {
                toStringCallee = 'Integer·toStringRC'
            } else if (variableKind === 'real') {
                toStringCallee = 'Real·toStringRC'
            } else {
                throw new Error(
                    'toString() is currently supported only for integer and real variables',
                )
            }

            const stringObjectTemp = nextTemp()
            const cStringTemp = nextTemp()
            return {
                setup: [
                    {
                        kind: 'CVariableDeclaration',
                        type: 'String*',
                        name: stringObjectTemp,
                        initializer: {
                            kind: 'CCallExpression',
                            callee: toStringCallee,
                            args: [{ kind: 'CIdentifier', name: object.name }],
                        },
                    },
                    {
                        kind: 'CVariableDeclaration',
                        type: 'const char*',
                        name: cStringTemp,
                        initializer: {
                            kind: 'CCallExpression',
                            callee: 'String·toCString',
                            args: [
                                {
                                    kind: 'CIdentifier',
                                    name: stringObjectTemp,
                                },
                            ],
                        },
                    },
                ],
                value: { kind: 'CIdentifier', name: cStringTemp },
                releaseAfterUse: stringObjectTemp,
            }
        }
    }

    throw new Error(
        'Only truthvalue expressions and <identifier>.toString() are supported as print arguments',
    )
}

function isIntegerExpression(
    expression: Expression,
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real' | 'string'>,
): boolean {
    switch (expression.kind) {
        case 'IntegerLiteral':
            return true
        case 'Identifier':
            return variableKinds.get(expression.name) === 'integer'
        case 'BinaryExpression':
            return (
                ['+', '-', '*', '/', '^'].includes(expression.operator) &&
                isIntegerExpression(expression.left, variableKinds) &&
                isIntegerExpression(expression.right, variableKinds)
            )
        default:
            return false
    }
}

function lowerIntegerExpression(
    expression: Expression,
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real' | 'string'>,
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
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real' | 'string'>,
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
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real' | 'string'>,
): boolean {
    switch (expression.kind) {
        case 'RealLiteral':
            return true
        case 'Identifier':
            return variableKinds.get(expression.name) === 'real'
        case 'BinaryExpression':
            return (
                ['+', '-', '*', '/', '^'].includes(expression.operator) &&
                isRealExpression(expression.left, variableKinds) &&
                isRealExpression(expression.right, variableKinds)
            )
        default:
            return false
    }
}

function isTruthExpression(
    expression: Expression,
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real' | 'string'>,
): boolean {
    switch (expression.kind) {
        case 'TruthLiteral':
            return true
        case 'Identifier':
            return variableKinds.get(expression.name) === 'truthvalue'
        case 'UnaryExpression':
            return (
                expression.operator === '!' &&
                isTruthExpression(expression.operand, variableKinds)
            )
        case 'BinaryExpression':
            return (
                (expression.operator === '&&' ||
                    expression.operator === '||') &&
                isTruthExpression(expression.left, variableKinds) &&
                isTruthExpression(expression.right, variableKinds)
            )
        case 'CallExpression':
            return isTruthCallExpression(expression, variableKinds)
        default:
            return false
    }
}

function isTruthCallExpression(
    expression: CallExpression,
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real' | 'string'>,
): boolean {
    if (expression.callee.kind === 'Identifier') {
        if (
            (expression.callee.name === 'adjust' ||
                expression.callee.name === 'rotate') &&
            expression.arguments.length === 2
        ) {
            return (
                isTruthExpression(
                    expression.arguments[0].value,
                    variableKinds,
                ) &&
                isTruthExpression(expression.arguments[1].value, variableKinds)
            )
        }
        return false
    }

    if (expression.callee.kind !== 'MemberExpression') return false

    if (
        (expression.callee.property === 'adjust' ||
            expression.callee.property === 'rotate') &&
        expression.arguments.length === 1
    ) {
        return isTruthExpression(expression.arguments[0].value, variableKinds)
    }

    if (
        (expression.callee.property === 'rotateUp' ||
            expression.callee.property === 'rotateDown') &&
        expression.arguments.length === 0
    ) {
        return true
    }

    return false
}

function lowerTruthExpression(
    expression: Expression,
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real' | 'string'>,
    nextTemp: () => string,
): { setup: CStatement[]; value: CExpression } {
    if (expression.kind === 'TruthLiteral') {
        return {
            setup: [],
            value: {
                kind: 'CIntegerLiteral',
                value: cTruthValue(expression.value),
            },
        }
    }

    if (
        expression.kind === 'Identifier' &&
        variableKinds.get(expression.name) === 'truthvalue'
    ) {
        return {
            setup: [],
            value: { kind: 'CIdentifier', name: expression.name },
        }
    }

    if (expression.kind === 'UnaryExpression' && expression.operator === '!') {
        const operand = lowerTruthExpression(
            expression.operand,
            variableKinds,
            nextTemp,
        )
        const temp = nextTemp()
        return {
            setup: [
                ...operand.setup,
                {
                    kind: 'CVariableDeclaration',
                    type: 'int',
                    name: temp,
                    initializer: {
                        kind: 'CRawExpression',
                        code: `(2 - ${cExprCode(operand.value)})`,
                    },
                },
            ],
            value: { kind: 'CIdentifier', name: temp },
        }
    }

    if (expression.kind === 'BinaryExpression') {
        const left = lowerTruthExpression(
            expression.left,
            variableKinds,
            nextTemp,
        )
        const right = lowerTruthExpression(
            expression.right,
            variableKinds,
            nextTemp,
        )
        const temp = nextTemp()
        const leftCode = cExprCode(left.value)
        const rightCode = cExprCode(right.value)
        const code =
            expression.operator === '&&'
                ? `((${leftCode}) < (${rightCode}) ? (${leftCode}) : (${rightCode}))`
                : `((${leftCode}) > (${rightCode}) ? (${leftCode}) : (${rightCode}))`

        return {
            setup: [
                ...left.setup,
                ...right.setup,
                {
                    kind: 'CVariableDeclaration',
                    type: 'int',
                    name: temp,
                    initializer: {
                        kind: 'CRawExpression',
                        code,
                    },
                },
            ],
            value: { kind: 'CIdentifier', name: temp },
        }
    }

    if (expression.kind === 'CallExpression') {
        if (expression.callee.kind === 'Identifier') {
            if (
                expression.callee.name === 'adjust' &&
                expression.arguments.length === 2
            ) {
                return lowerValidatedTruthRuntimeCall(
                    expression,
                    truthCallSignature('adjust'),
                    'adjust',
                    variableKinds,
                    nextTemp,
                )
            }

            if (
                expression.callee.name === 'rotate' &&
                expression.arguments.length === 2
            ) {
                return lowerValidatedTruthRuntimeCall(
                    expression,
                    truthCallSignature('rotate'),
                    'rotate',
                    variableKinds,
                    nextTemp,
                )
            }
        }

        if (expression.callee.kind === 'MemberExpression') {
            if (
                expression.callee.property === 'adjust' &&
                expression.arguments.length === 1
            ) {
                return lowerValidatedTruthMethodCall(
                    expression,
                    truthMethodSignature('adjust'),
                    'adjust',
                    variableKinds,
                    nextTemp,
                )
            }

            if (
                expression.callee.property === 'rotate' &&
                expression.arguments.length === 1
            ) {
                return lowerValidatedTruthMethodCall(
                    expression,
                    truthMethodSignature('rotate'),
                    'rotate',
                    variableKinds,
                    nextTemp,
                )
            }

            if (
                expression.callee.property === 'rotateUp' &&
                expression.arguments.length === 0
            ) {
                return lowerExpandedTruthMethodCall(
                    expression,
                    'rotate',
                    'by',
                    { kind: 'TruthLiteral', value: 'true' },
                    variableKinds,
                    nextTemp,
                )
            }

            if (
                expression.callee.property === 'rotateDown' &&
                expression.arguments.length === 0
            ) {
                return lowerExpandedTruthMethodCall(
                    expression,
                    'rotate',
                    'by',
                    { kind: 'TruthLiteral', value: 'false' },
                    variableKinds,
                    nextTemp,
                )
            }
        }
    }

    throw new Error('Unsupported truthvalue expression in this vertical slice')
}

function lowerTruthRuntimeCall(
    callee: string,
    args: Array<{ setup: CStatement[]; value: CExpression }>,
    nextTemp: () => string,
): { setup: CStatement[]; value: CExpression } {
    const temp = nextTemp()

    return {
        setup: [
            ...args.flatMap((arg) => arg.setup),
            {
                kind: 'CVariableDeclaration',
                type: 'int',
                name: temp,
                initializer: {
                    kind: 'CCallExpression',
                    callee,
                    args: args.map((arg) => arg.value),
                },
            },
        ],
        value: { kind: 'CIdentifier', name: temp },
    }
}

function callArgumentLabelsMatch(
    arguments_: ReadonlyArray<CallExpression['arguments'][number]>,
    expected: ReadonlyArray<string | null>,
): boolean {
    return (
        arguments_.length === expected.length &&
        arguments_.every(
            (argument, index) => argument.label === expected[index],
        )
    )
}

function truthCallSignature(
    name: 'adjust' | 'rotate',
): ReadonlyArray<string | null> {
    return name === 'adjust' ? [null, 'towards'] : [null, 'by']
}

function truthMethodSignature(
    name: 'adjust' | 'rotate',
): ReadonlyArray<string | null> {
    return name === 'adjust' ? ['towards'] : ['by']
}

function lowerValidatedTruthRuntimeCall(
    expression: CallExpression,
    canonicalLabels: ReadonlyArray<string | null>,
    baseName: string,
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real' | 'string'>,
    nextTemp: () => string,
): { setup: CStatement[]; value: CExpression } {
    validateLabeledCall(expression, canonicalLabels, baseName)

    return lowerTruthRuntimeCall(
        mangleLabeledCallee(baseName, canonicalLabels),
        expression.arguments.map((argument) =>
            lowerTruthExpression(argument.value, variableKinds, nextTemp),
        ),
        nextTemp,
    )
}

function lowerValidatedTruthMethodCall(
    expression: CallExpression,
    canonicalLabels: ReadonlyArray<string | null>,
    baseName: string,
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real' | 'string'>,
    nextTemp: () => string,
): { setup: CStatement[]; value: CExpression } {
    if (expression.callee.kind !== 'MemberExpression') {
        throw new Error('Expected truthvalue method call')
    }

    validateLabeledCall(expression, canonicalLabels, baseName)

    const object = lowerTruthExpression(
        expression.callee.object,
        variableKinds,
        nextTemp,
    )

    return lowerTruthRuntimeCall(
        mangleLabeledCallee(baseName, [null, ...canonicalLabels]),
        [
            object,
            ...expression.arguments.map((argument) =>
                lowerTruthExpression(argument.value, variableKinds, nextTemp),
            ),
        ],
        nextTemp,
    )
}

function lowerExpandedTruthMethodCall(
    expression: CallExpression,
    baseName: 'rotate',
    label: 'by',
    value: Expression,
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real' | 'string'>,
    nextTemp: () => string,
): { setup: CStatement[]; value: CExpression } {
    if (expression.callee.kind !== 'MemberExpression') {
        throw new Error('Expected truthvalue method call')
    }

    const object = lowerTruthExpression(
        expression.callee.object,
        variableKinds,
        nextTemp,
    )
    const arg = lowerTruthExpression(value, variableKinds, nextTemp)

    return lowerTruthRuntimeCall(
        mangleLabeledCallee(baseName, [null, label]),
        [object, arg],
        nextTemp,
    )
}

function validateLabeledCall(
    expression: CallExpression,
    canonicalLabels: ReadonlyArray<string | null>,
    baseName: string,
) {
    if (callArgumentLabelsMatch(expression.arguments, canonicalLabels)) {
        return
    }

    const expected = canonicalLabels
        .map((label, index) => {
            if (label === null) {
                return `argument ${index + 1} must be unlabeled`
            }

            return `argument ${index + 1} must be labeled ${label}:`
        })
        .join(', ')

    throw new Error(`Invalid labels for ${baseName}(...): ${expected}`)
}

function mangleLabeledCallee(
    baseName: string,
    labels: ReadonlyArray<string | null>,
): string {
    if (labels.every((label) => label === null)) {
        return baseName
    }

    return `${baseName}_${labels.map((label) => label ?? '').join('_')}`
}

function cExprCode(expression: CExpression): string {
    if (expression.kind === 'CIdentifier') return expression.name
    if (expression.kind === 'CIntegerLiteral') return expression.value
    if (expression.kind === 'CRawExpression') return expression.code
    throw new Error('Unsupported C expression shape for truthvalue lowering')
}

function lowerRealExpression(
    expression: Expression,
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real' | 'string'>,
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
    variableKinds: Map<string, 'integer' | 'truthvalue' | 'real' | 'string'>,
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
