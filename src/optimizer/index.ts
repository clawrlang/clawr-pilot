import type { CTranslationUnit } from '../ir/c'

export function optimizeCIr(ir: CTranslationUnit): CTranslationUnit {
    // Extension point: run optional IR optimization passes here.
    return ir
}
