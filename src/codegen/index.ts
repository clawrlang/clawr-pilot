import type {
    CallExpression,
    ConstDeclaration,
    Expression,
    ExpressionStatement,
    IdentifierExpression,
    Program,
} from '../ast'

export function generateC(program: Program): string {
    const lines: string[] = []
    const locals: string[] = []
    let tempCounter = 0

    lines.push('#include "runtime.h"')
    lines.push('#include <stdio.h>')
    lines.push('#include <stdlib.h>')
    lines.push('')
    lines.push('static Integer* clawr_int_from_i64(long long value) {')
    lines.push('    Array* digits = Array¸new(1, sizeof(digit_t));')
    lines.push('    ARRAY_ELEMENT_AT(0, digits, digit_t) = (digit_t)value;')
    lines.push('    Integer* result = Integer¸withDigits(digits);')
    lines.push('    releaseRC(digits);')
    lines.push('    return result;')
    lines.push('}')
    lines.push('')
    lines.push('int main() {')

    for (const statement of program.statements) {
        emitStatement(
            statement,
            lines,
            locals,
            () => `__clawr_tmp${tempCounter++}`,
        )
    }

    for (const local of [...locals].reverse()) {
        lines.push(`    releaseRC(${local});`)
    }

    lines.push('    return 0;')
    lines.push('}')

    return lines.join('\n') + '\n'
}

function emitStatement(
    statement: Program['statements'][number],
    lines: string[],
    locals: string[],
    nextTemp: () => string,
) {
    if (statement.kind === 'ConstDeclaration') {
        emitConstDeclaration(statement, lines, locals)
        return
    }

    emitExpressionStatement(statement, lines, nextTemp)
}

function emitConstDeclaration(
    statement: ConstDeclaration,
    lines: string[],
    locals: string[],
) {
    if (statement.initializer.kind !== 'IntegerLiteral') {
        throw new Error(
            'Only integer literal const initializers are supported in this vertical slice',
        )
    }

    lines.push(
        `    Integer* ${statement.identifier.name} = clawr_int_from_i64(${statement.initializer.value.toString()}LL);`,
    )
    locals.push(statement.identifier.name)
}

function emitExpressionStatement(
    statement: ExpressionStatement,
    lines: string[],
    nextTemp: () => string,
) {
    const expr = statement.expression
    if (expr.kind !== 'CallExpression') {
        throw new Error(
            'Only call expressions are supported as statement expressions',
        )
    }

    emitPrintCall(expr, lines, nextTemp)
}

function emitPrintCall(
    call: CallExpression,
    lines: string[],
    nextTemp: () => string,
) {
    if (call.callee.kind !== 'Identifier' || call.callee.name !== 'print') {
        throw new Error('Only print(...) is supported in this vertical slice')
    }

    if (call.arguments.length !== 1) {
        throw new Error('print(...) must have exactly one argument')
    }

    const render = emitStringExpression(call.arguments[0], nextTemp)
    lines.push(...render.lines)
    lines.push(`    printf("%s\\n", ${render.value});`)
    if (render.freeAfterUse) {
        lines.push(`    free((void*)${render.value});`)
    }
}

function emitStringExpression(
    expression: Expression,
    nextTemp: () => string,
): { lines: string[]; value: string; freeAfterUse: boolean } {
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
                lines: [
                    `    const char* ${temp} = Integer·toString(${object.name});`,
                ],
                value: temp,
                freeAfterUse: true,
            }
        }
    }

    throw new Error(
        'Only <identifier>.toString() is supported as print argument',
    )
}
