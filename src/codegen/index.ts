import type {
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

function lowerToCIr(program: Program): CTranslationUnit {
    const mainStatements: CStatement[] = []
    const locals: string[] = []
    let tempCounter = 0

    for (const statement of program.statements) {
        lowerStatement(
            statement,
            mainStatements,
            locals,
            () => `__clawr_tmp${tempCounter++}`,
        )
    }

    for (const local of [...locals].reverse()) {
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
    locals: string[],
    nextTemp: () => string,
) {
    if (statement.kind === 'VariableDeclaration') {
        lowerVariableDeclaration(statement, statements, locals)
        return
    }

    lowerExpressionStatement(statement, statements, nextTemp)
}

function lowerVariableDeclaration(
    statement: VariableDeclaration,
    statements: CStatement[],
    locals: string[],
) {
    if (statement.initializer.kind !== 'IntegerLiteral') {
        throw new Error(
            'Only integer literal variable initializers are supported in this vertical slice',
        )
    }

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
    locals.push(statement.identifier.name)
}

function lowerExpressionStatement(
    statement: ExpressionStatement,
    statements: CStatement[],
    nextTemp: () => string,
) {
    const expr = statement.expression
    if (expr.kind !== 'CallExpression') {
        throw new Error(
            'Only call expressions are supported as statement expressions',
        )
    }

    lowerPrintCall(expr, statements, nextTemp)
}

function lowerPrintCall(
    call: CallExpression,
    statements: CStatement[],
    nextTemp: () => string,
) {
    if (call.callee.kind !== 'Identifier' || call.callee.name !== 'print') {
        throw new Error('Only print(...) is supported in this vertical slice')
    }

    if (call.arguments.length !== 1) {
        throw new Error('print(...) must have exactly one argument')
    }

    const render = lowerStringExpression(call.arguments[0], nextTemp)
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
    nextTemp: () => string,
): { setup: CStatement[]; value: CExpression; freeAfterUse: boolean } {
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

            const temp = nextTemp()
            return {
                setup: [
                    {
                        kind: 'CVariableDeclaration',
                        type: 'const char*',
                        name: temp,
                        initializer: {
                            kind: 'CCallExpression',
                            callee: 'Integer·toString',
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
        'Only <identifier>.toString() is supported as print argument',
    )
}
