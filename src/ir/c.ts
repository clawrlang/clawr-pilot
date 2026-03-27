export interface CTranslationUnit {
    kind: 'CTranslationUnit'
    includes: string[]
    functions: CFunction[]
}

export interface CFunction {
    kind: 'CFunction'
    returnType: string
    name: string
    params: CParameter[]
    statements: CStatement[]
    isStatic?: boolean
}

export interface CParameter {
    type: string
    name: string
}

export type CStatement =
    | CVariableDeclaration
    | CExpressionStatement
    | CAssignmentStatement
    | CIfStatement
    | CReturnStatement

export interface CVariableDeclaration {
    kind: 'CVariableDeclaration'
    type: string
    name: string
    initializer?: CExpression
}

export interface CExpressionStatement {
    kind: 'CExpressionStatement'
    expression: CExpression
}

export interface CAssignmentStatement {
    kind: 'CAssignmentStatement'
    target: CExpression
    value: CExpression
}

export interface CIfStatement {
    kind: 'CIfStatement'
    condition: CExpression
    thenStatements: CStatement[]
    elseStatements: CStatement[]
}

export interface CReturnStatement {
    kind: 'CReturnStatement'
    value?: CExpression
}

export type CExpression =
    | CIdentifier
    | CIntegerLiteral
    | CStringLiteral
    | CCallExpression
    | CCastExpression
    | CSizeofExpression
    | CRawExpression

export interface CIdentifier {
    kind: 'CIdentifier'
    name: string
}

export interface CIntegerLiteral {
    kind: 'CIntegerLiteral'
    value: string
}

export interface CStringLiteral {
    kind: 'CStringLiteral'
    value: string
}

export interface CCallExpression {
    kind: 'CCallExpression'
    callee: string
    args: CExpression[]
}

export interface CCastExpression {
    kind: 'CCastExpression'
    typeName: string
    expression: CExpression
}

export interface CSizeofExpression {
    kind: 'CSizeofExpression'
    typeName: string
}

export interface CRawExpression {
    kind: 'CRawExpression'
    code: string
}

export function emitC(unit: CTranslationUnit): string {
    const lines: string[] = []

    // Emit includes first
    for (const include of unit.includes) {
        lines.push(`#include ${include}`)
    }
    if (unit.includes.length > 0) lines.push('')

    // Emit raw preamble (structs/typeinfo) after includes
    if ((unit as any).raw && typeof (unit as any).raw === 'string') {
        lines.push((unit as any).raw)
        lines.push('')
    }

    for (let i = 0; i < unit.functions.length; i++) {
        lines.push(...emitFunction(unit.functions[i]))
        if (i < unit.functions.length - 1) lines.push('')
    }

    return lines.join('\n') + '\n'
}

function emitFunction(fn: CFunction): string[] {
    const lines: string[] = []
    const staticPrefix = fn.isStatic ? 'static ' : ''
    const params = fn.params.map((p) => `${p.type} ${p.name}`).join(', ')

    lines.push(`${staticPrefix}${fn.returnType} ${fn.name}(${params}) {`)
    for (const statement of fn.statements) {
        lines.push(...emitStatementLines(statement, 1))
    }
    lines.push('}')

    return lines
}

function emitStatementLines(
    statement: CStatement,
    indentLevel: number,
): string[] {
    const indent = '    '.repeat(indentLevel)

    switch (statement.kind) {
        case 'CVariableDeclaration':
            if (!statement.initializer) {
                return [`${indent}${statement.type} ${statement.name};`]
            }
            return [
                `${indent}${statement.type} ${statement.name} = ${emitExpression(statement.initializer)};`,
            ]
        case 'CExpressionStatement':
            return [`${indent}${emitExpression(statement.expression)};`]
        case 'CAssignmentStatement':
            return [
                `${indent}${emitExpression(statement.target)} = ${emitExpression(statement.value)};`,
            ]
        case 'CIfStatement': {
            const lines = [
                `${indent}if (${emitExpression(statement.condition)}) {`,
            ]
            for (const nested of statement.thenStatements) {
                lines.push(...emitStatementLines(nested, indentLevel + 1))
            }
            lines.push(`${indent}}`)
            if (statement.elseStatements.length > 0) {
                lines[lines.length - 1] += ' else {'
                for (const nested of statement.elseStatements) {
                    lines.push(...emitStatementLines(nested, indentLevel + 1))
                }
                lines.push(`${indent}}`)
            }
            return lines
        }
        case 'CReturnStatement':
            return [
                statement.value
                    ? `${indent}return ${emitExpression(statement.value)};`
                    : `${indent}return;`,
            ]
    }
}

function emitExpression(expression: CExpression): string {
    switch (expression.kind) {
        case 'CIdentifier':
            return expression.name
        case 'CIntegerLiteral':
            return expression.value
        case 'CStringLiteral':
            return `"${escapeCString(expression.value)}"`
        case 'CCallExpression':
            return `${expression.callee}(${expression.args.map(emitExpression).join(', ')})`
        case 'CCastExpression':
            return `(${expression.typeName})${emitExpression(expression.expression)}`
        case 'CSizeofExpression':
            return `sizeof(${expression.typeName})`
        case 'CRawExpression':
            return expression.code
    }
}

function escapeCString(value: string): string {
    return value
        .replaceAll('\\', '\\\\')
        .replaceAll('"', '\\"')
        .replaceAll('\n', '\\n')
        .replaceAll('\r', '\\r')
}
