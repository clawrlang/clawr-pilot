import type { CExpression } from '../ir/c'

export function cExprCode(expression: CExpression): string {
    if (expression.kind === 'CIdentifier') return expression.name
    if (expression.kind === 'CIntegerLiteral') return expression.value
    if (expression.kind === 'CRawExpression') return expression.code
    throw new Error('Unsupported C expression shape for truthvalue lowering')
}

export function cTruthValue(value: 'false' | 'ambiguous' | 'true'): string {
    switch (value) {
        case 'false':
            return '0'
        case 'ambiguous':
            return '1'
        case 'true':
            return '2'
    }
}
