import Decimal from 'decimal.js'
import type { TruthLiteralExpression } from '../ast'

export type TruthValueAtom = TruthLiteralExpression['value']

export type ValueSet =
    | NeverValueSet
    | IntegerValueSet
    | RealValueSet
    | TruthValueSet
    | StringValueSet
    | BitfieldValueSet
    | TritfieldValueSet

export interface NeverValueSet {
    family: 'never'
}

export type IntegerValueSet =
    | { family: 'integer'; form: 'top' }
    | { family: 'integer'; form: 'singleton'; value: bigint }
    | {
          family: 'integer'
          form: 'range'
          min: bigint | null
          max: bigint | null
          minInclusive: boolean
          maxInclusive: boolean
      }

export type RealValueSet =
    | { family: 'real'; form: 'top' }
    | { family: 'real'; form: 'singleton'; value: string }
    | {
          family: 'real'
          form: 'range'
          min: string | null
          max: string | null
          minInclusive: boolean
          maxInclusive: boolean
      }

export interface TruthValueSet {
    family: 'truthvalue'
    values: TruthValueAtom[]
}

export type StringValueSet =
    | { family: 'string'; form: 'top' }
    | { family: 'string'; form: 'singleton'; value: string }
    | {
          family: 'string'
          form: 'length'
          min: bigint | null
          max: bigint | null
          minInclusive: boolean
          maxInclusive: boolean
      }
    | {
          family: 'string'
          form: 'pattern'
          pattern: string
          modifiers: string
      }

export interface BitfieldValueSet {
    family: 'bitfield'
    length: number | null
}

export interface TritfieldValueSet {
    family: 'tritfield'
    length: number | null
}

type IntegerBounds = {
    min: bigint | null
    max: bigint | null
    minInclusive: boolean
    maxInclusive: boolean
}

type RealBounds = {
    min: string | null
    max: string | null
    minInclusive: boolean
    maxInclusive: boolean
}

export const neverValueSet: NeverValueSet = { family: 'never' }

export function integerTop(): IntegerValueSet {
    return { family: 'integer', form: 'top' }
}

export function integerSingleton(value: bigint): IntegerValueSet {
    return { family: 'integer', form: 'singleton', value }
}

export function integerRange(options: {
    min?: bigint
    max?: bigint
    minInclusive?: boolean
    maxInclusive?: boolean
}): ValueSet {
    const min = options.min ?? null
    const max = options.max ?? null
    const minInclusive = options.minInclusive ?? true
    const maxInclusive = options.maxInclusive ?? true

    if (min !== null && max !== null) {
        if (min > max) return neverValueSet
        if (min === max) {
            if (minInclusive && maxInclusive) {
                return integerSingleton(min)
            }
            return neverValueSet
        }
    }

    return {
        family: 'integer',
        form: 'range',
        min,
        max,
        minInclusive,
        maxInclusive,
    }
}

export function realTop(): RealValueSet {
    return { family: 'real', form: 'top' }
}

export function realSingleton(value: string): RealValueSet {
    return {
        family: 'real',
        form: 'singleton',
        value: canonicalReal(value),
    }
}

export function realRange(options: {
    min?: string
    max?: string
    minInclusive?: boolean
    maxInclusive?: boolean
}): ValueSet {
    const min = options.min === undefined ? null : canonicalReal(options.min)
    const max = options.max === undefined ? null : canonicalReal(options.max)
    const minInclusive = options.minInclusive ?? true
    const maxInclusive = options.maxInclusive ?? true

    if (min !== null && max !== null) {
        const cmp = compareRealStrings(min, max)
        if (cmp > 0) return neverValueSet
        if (cmp === 0) {
            if (minInclusive && maxInclusive) {
                return realSingleton(min)
            }
            return neverValueSet
        }
    }

    return {
        family: 'real',
        form: 'range',
        min,
        max,
        minInclusive,
        maxInclusive,
    }
}

export function truthvalueSet(...values: TruthValueAtom[]): TruthValueSet {
    const unique = [...new Set(values)]
    const ordered = ['false', 'ambiguous', 'true'].filter((value) =>
        unique.includes(value as TruthValueAtom),
    ) as TruthValueAtom[]
    return { family: 'truthvalue', values: ordered }
}

export function truthvalueTop(): TruthValueSet {
    return truthvalueSet('false', 'ambiguous', 'true')
}

export function stringTop(): StringValueSet {
    return { family: 'string', form: 'top' }
}

export function stringSingleton(value: string): StringValueSet {
    return { family: 'string', form: 'singleton', value }
}

export function stringLengthRange(options: {
    min?: bigint
    max?: bigint
    minInclusive?: boolean
    maxInclusive?: boolean
}): ValueSet {
    const min = options.min ?? null
    const max = options.max ?? null
    const minInclusive = options.minInclusive ?? true
    const maxInclusive = options.maxInclusive ?? true

    if (min !== null && min < 0n) return neverValueSet
    if (max !== null && max < 0n) return neverValueSet
    if (min !== null && max !== null) {
        if (min > max) return neverValueSet
        if (min === max && !(minInclusive && maxInclusive)) {
            return neverValueSet
        }
    }

    return {
        family: 'string',
        form: 'length',
        min,
        max,
        minInclusive,
        maxInclusive,
    }
}

export function stringPattern(
    pattern: string,
    modifiers?: string,
): StringValueSet {
    return {
        family: 'string',
        form: 'pattern',
        pattern,
        modifiers: [...new Set((modifiers ?? '').split(''))].sort().join(''),
    }
}

export function bitfieldSet(length?: number): BitfieldValueSet {
    return { family: 'bitfield', length: length ?? null }
}

export function tritfieldSet(length?: number): TritfieldValueSet {
    return { family: 'tritfield', length: length ?? null }
}

export function joinValueSets(left: ValueSet, right: ValueSet): ValueSet {
    if (left.family === 'never') return right
    if (right.family === 'never') return left
    ensureSameFamily(left, right)

    switch (left.family) {
        case 'integer':
            return joinIntegerValueSets(left, right as IntegerValueSet)
        case 'real':
            return joinRealValueSets(left, right as RealValueSet)
        case 'truthvalue':
            return truthvalueSet(
                ...left.values,
                ...(right as TruthValueSet).values,
            )
        case 'string':
            return joinStringValueSets(left, right as StringValueSet)
        case 'bitfield':
            return left.length === (right as BitfieldValueSet).length
                ? left
                : bitfieldSet()
        case 'tritfield':
            return left.length === (right as TritfieldValueSet).length
                ? left
                : tritfieldSet()
    }
}

export function meetValueSets(left: ValueSet, right: ValueSet): ValueSet {
    if (left.family === 'never' || right.family === 'never')
        return neverValueSet
    ensureSameFamily(left, right)

    switch (left.family) {
        case 'integer':
            return meetIntegerValueSets(left, right as IntegerValueSet)
        case 'real':
            return meetRealValueSets(left, right as RealValueSet)
        case 'truthvalue': {
            const rightTruth = right as TruthValueSet
            const intersection = left.values.filter((value) =>
                rightTruth.values.includes(value),
            )
            return intersection.length === 0
                ? neverValueSet
                : truthvalueSet(...intersection)
        }
        case 'string':
            return meetStringValueSets(left, right as StringValueSet)
        case 'bitfield':
            const rightBitfield = right as BitfieldValueSet
            if (left.length === null) return right as BitfieldValueSet
            if (rightBitfield.length === null) return left
            return left.length === rightBitfield.length ? left : neverValueSet
        case 'tritfield':
            const rightTritfield = right as TritfieldValueSet
            if (left.length === null) return right as TritfieldValueSet
            if (rightTritfield.length === null) return left
            return left.length === rightTritfield.length ? left : neverValueSet
    }
}

export function isSubsetValueSet(
    candidate: ValueSet,
    target: ValueSet,
): boolean {
    if (candidate.family === 'never') return true
    if (target.family === 'never') return false
    if (candidate.family !== target.family) return false
    return equalValueSets(meetValueSets(candidate, target), candidate)
}

export function equalValueSets(left: ValueSet, right: ValueSet): boolean {
    if (left.family !== right.family) return false
    if (left.family === 'never') return true

    switch (left.family) {
        case 'integer':
            return equalIntegerValueSets(left, right as IntegerValueSet)
        case 'real':
            return equalRealValueSets(left, right as RealValueSet)
        case 'string':
            return equalStringValueSets(left, right as StringValueSet)
        case 'truthvalue':
            return (
                JSON.stringify(left.values) ===
                JSON.stringify((right as TruthValueSet).values)
            )
        case 'bitfield':
            return left.length === (right as BitfieldValueSet).length
        case 'tritfield':
            return left.length === (right as TritfieldValueSet).length
    }
}

function equalIntegerValueSets(
    left: IntegerValueSet,
    right: IntegerValueSet,
): boolean {
    if (left.form !== right.form) return false
    if (left.form === 'top') return true
    if (left.form === 'singleton' && right.form === 'singleton') {
        return left.value === right.value
    }
    if (left.form === 'range' && right.form === 'range') {
        return (
            left.min === right.min &&
            left.max === right.max &&
            left.minInclusive === right.minInclusive &&
            left.maxInclusive === right.maxInclusive
        )
    }
    return false
}

function equalRealValueSets(left: RealValueSet, right: RealValueSet): boolean {
    if (left.form !== right.form) return false
    if (left.form === 'top') return true
    if (left.form === 'singleton' && right.form === 'singleton') {
        return left.value === right.value
    }
    if (left.form === 'range' && right.form === 'range') {
        return (
            left.min === right.min &&
            left.max === right.max &&
            left.minInclusive === right.minInclusive &&
            left.maxInclusive === right.maxInclusive
        )
    }
    return false
}

function equalStringValueSets(
    left: StringValueSet,
    right: StringValueSet,
): boolean {
    if (left.form !== right.form) return false
    if (left.form === 'top') return true
    if (left.form === 'singleton' && right.form === 'singleton') {
        return left.value === right.value
    }
    if (left.form === 'length' && right.form === 'length') {
        return (
            left.min === right.min &&
            left.max === right.max &&
            left.minInclusive === right.minInclusive &&
            left.maxInclusive === right.maxInclusive
        )
    }
    if (left.form === 'pattern' && right.form === 'pattern') {
        return (
            left.pattern === right.pattern && left.modifiers === right.modifiers
        )
    }
    return false
}

function joinStringValueSets(
    left: StringValueSet,
    right: StringValueSet,
): StringValueSet {
    if (left.form === 'top' || right.form === 'top') return stringTop()
    if (left.form === 'singleton' && right.form === 'singleton') {
        return left.value === right.value ? left : stringTop()
    }

    if (left.form === 'pattern' && right.form === 'pattern') {
        return left.pattern === right.pattern &&
            left.modifiers === right.modifiers
            ? left
            : stringTop()
    }

    if (left.form === 'pattern' && right.form === 'singleton') {
        return matchesStringPattern(right.value, left) ? left : stringTop()
    }
    if (left.form === 'singleton' && right.form === 'pattern') {
        return matchesStringPattern(left.value, right) ? right : stringTop()
    }

    const leftLength = asStringLengthRange(left)
    const rightLength = asStringLengthRange(right)
    if (leftLength && rightLength) {
        return stringLengthRange({
            min: undefinedIfNull(
                chooseIntegerLowerBound(leftLength, rightLength),
            ),
            minInclusive: chooseIntegerLowerInclusive(leftLength, rightLength),
            max: undefinedIfNull(
                chooseIntegerUpperBound(leftLength, rightLength),
            ),
            maxInclusive: chooseIntegerUpperInclusive(leftLength, rightLength),
        }) as StringValueSet
    }

    return stringTop()
}

function meetStringValueSets(
    left: StringValueSet,
    right: StringValueSet,
): ValueSet {
    if (left.form === 'top') return right
    if (right.form === 'top') return left

    if (left.form === 'singleton' && right.form === 'singleton') {
        return left.value === right.value ? left : neverValueSet
    }

    if (left.form === 'singleton') {
        if (right.form === 'singleton') {
            return left.value === right.value ? left : neverValueSet
        }
        return isStringSingletonInConstraint(left.value, right)
            ? left
            : neverValueSet
    }
    if (right.form === 'singleton') {
        return isStringSingletonInConstraint(right.value, left)
            ? right
            : neverValueSet
    }

    if (left.form === 'pattern' && right.form === 'pattern') {
        return left.pattern === right.pattern &&
            left.modifiers === right.modifiers
            ? left
            : neverValueSet
    }

    if (left.form === 'length' && right.form === 'length') {
        return stringLengthRange({
            min: undefinedIfNull(intersectIntegerLowerBound(left, right)),
            minInclusive: intersectIntegerLowerInclusive(left, right),
            max: undefinedIfNull(intersectIntegerUpperBound(left, right)),
            maxInclusive: intersectIntegerUpperInclusive(left, right),
        })
    }

    return neverValueSet
}

function joinIntegerValueSets(
    left: IntegerValueSet,
    right: IntegerValueSet,
): IntegerValueSet {
    if (left.form === 'top' || right.form === 'top') return integerTop()
    const l = asIntegerRange(left)
    const r = asIntegerRange(right)
    return integerRange({
        min: undefinedIfNull(chooseIntegerLowerBound(l, r)),
        minInclusive: chooseIntegerLowerInclusive(l, r),
        max: undefinedIfNull(chooseIntegerUpperBound(l, r)),
        maxInclusive: chooseIntegerUpperInclusive(l, r),
    }) as IntegerValueSet
}

function meetIntegerValueSets(
    left: IntegerValueSet,
    right: IntegerValueSet,
): ValueSet {
    if (left.form === 'top') return right
    if (right.form === 'top') return left
    const l = asIntegerRange(left)
    const r = asIntegerRange(right)
    return integerRange({
        min: undefinedIfNull(intersectIntegerLowerBound(l, r)),
        minInclusive: intersectIntegerLowerInclusive(l, r),
        max: undefinedIfNull(intersectIntegerUpperBound(l, r)),
        maxInclusive: intersectIntegerUpperInclusive(l, r),
    })
}

function joinRealValueSets(
    left: RealValueSet,
    right: RealValueSet,
): RealValueSet {
    if (left.form === 'top' || right.form === 'top') return realTop()
    const l = asRealRange(left)
    const r = asRealRange(right)
    return realRange({
        min: undefinedIfNull(chooseRealLowerBound(l, r)),
        minInclusive: chooseRealLowerInclusive(l, r),
        max: undefinedIfNull(chooseRealUpperBound(l, r)),
        maxInclusive: chooseRealUpperInclusive(l, r),
    }) as RealValueSet
}

function meetRealValueSets(left: RealValueSet, right: RealValueSet): ValueSet {
    if (left.form === 'top') return right
    if (right.form === 'top') return left
    const l = asRealRange(left)
    const r = asRealRange(right)
    return realRange({
        min: undefinedIfNull(intersectRealLowerBound(l, r)),
        minInclusive: intersectRealLowerInclusive(l, r),
        max: undefinedIfNull(intersectRealUpperBound(l, r)),
        maxInclusive: intersectRealUpperInclusive(l, r),
    })
}

function asIntegerRange(
    valueSet: Exclude<IntegerValueSet, { form: 'top' }>,
): IntegerBounds {
    if (valueSet.form === 'singleton') {
        return {
            min: valueSet.value,
            max: valueSet.value,
            minInclusive: true,
            maxInclusive: true,
        }
    }
    return valueSet
}

function asRealRange(
    valueSet: Exclude<RealValueSet, { form: 'top' }>,
): RealBounds {
    if (valueSet.form === 'singleton') {
        return {
            min: valueSet.value,
            max: valueSet.value,
            minInclusive: true,
            maxInclusive: true,
        }
    }
    return valueSet
}

function asStringLengthRange(valueSet: StringValueSet): IntegerBounds | null {
    if (valueSet.form === 'top' || valueSet.form === 'pattern') {
        return null
    }
    if (valueSet.form === 'singleton') {
        const length = BigInt(valueSet.value.length)
        return {
            min: length,
            max: length,
            minInclusive: true,
            maxInclusive: true,
        }
    }
    if (valueSet.form === 'length') {
        return valueSet
    }
    return null
}

function isStringSingletonInConstraint(
    value: string,
    constraint: Exclude<StringValueSet, { form: 'top' | 'singleton' }>,
) {
    if (constraint.form === 'length') {
        return isLengthWithinBounds(BigInt(value.length), constraint)
    }
    return matchesStringPattern(value, constraint)
}

function isLengthWithinBounds(length: bigint, bounds: IntegerBounds) {
    if (bounds.min !== null) {
        if (length < bounds.min) return false
        if (length === bounds.min && !bounds.minInclusive) return false
    }
    if (bounds.max !== null) {
        if (length > bounds.max) return false
        if (length === bounds.max && !bounds.maxInclusive) return false
    }
    return true
}

function matchesStringPattern(
    value: string,
    patternValueSet: Extract<StringValueSet, { form: 'pattern' }>,
) {
    return new RegExp(patternValueSet.pattern, patternValueSet.modifiers).test(
        value,
    )
}

function ensureSameFamily(
    left: Exclude<ValueSet, NeverValueSet>,
    right: Exclude<ValueSet, NeverValueSet>,
) {
    if (left.family !== right.family) {
        throw new Error(
            `Cannot combine value-sets from different families: ${left.family} and ${right.family}`,
        )
    }
}

function chooseIntegerLowerBound(left: IntegerBounds, right: IntegerBounds) {
    if (left.min === null || right.min === null) return null
    return left.min < right.min ? left.min : right.min
}

function chooseIntegerLowerInclusive(
    left: IntegerBounds,
    right: IntegerBounds,
) {
    const min = chooseIntegerLowerBound(left, right)
    if (min === null) return false
    if (left.min === right.min) return left.minInclusive || right.minInclusive
    return left.min === min ? left.minInclusive : right.minInclusive
}

function chooseIntegerUpperBound(left: IntegerBounds, right: IntegerBounds) {
    if (left.max === null || right.max === null) return null
    return left.max > right.max ? left.max : right.max
}

function chooseIntegerUpperInclusive(
    left: IntegerBounds,
    right: IntegerBounds,
) {
    const max = chooseIntegerUpperBound(left, right)
    if (max === null) return false
    if (left.max === right.max) return left.maxInclusive || right.maxInclusive
    return left.max === max ? left.maxInclusive : right.maxInclusive
}

function intersectIntegerLowerBound(left: IntegerBounds, right: IntegerBounds) {
    if (left.min === null) return right.min
    if (right.min === null) return left.min
    return left.min > right.min ? left.min : right.min
}

function intersectIntegerLowerInclusive(
    left: IntegerBounds,
    right: IntegerBounds,
) {
    const min = intersectIntegerLowerBound(left, right)
    if (min === null) return false
    if (left.min === right.min) return left.minInclusive && right.minInclusive
    return left.min === min ? left.minInclusive : right.minInclusive
}

function intersectIntegerUpperBound(left: IntegerBounds, right: IntegerBounds) {
    if (left.max === null) return right.max
    if (right.max === null) return left.max
    return left.max < right.max ? left.max : right.max
}

function intersectIntegerUpperInclusive(
    left: IntegerBounds,
    right: IntegerBounds,
) {
    const max = intersectIntegerUpperBound(left, right)
    if (max === null) return false
    if (left.max === right.max) return left.maxInclusive && right.maxInclusive
    return left.max === max ? left.maxInclusive : right.maxInclusive
}

function chooseRealLowerBound(left: RealBounds, right: RealBounds) {
    if (left.min === null || right.min === null) return null
    return compareRealStrings(left.min, right.min) < 0 ? left.min : right.min
}

function chooseRealLowerInclusive(left: RealBounds, right: RealBounds) {
    const min = chooseRealLowerBound(left, right)
    if (min === null) return false
    if (left.min === right.min) return left.minInclusive || right.minInclusive
    return left.min === min ? left.minInclusive : right.minInclusive
}

function chooseRealUpperBound(left: RealBounds, right: RealBounds) {
    if (left.max === null || right.max === null) return null
    return compareRealStrings(left.max, right.max) > 0 ? left.max : right.max
}

function chooseRealUpperInclusive(left: RealBounds, right: RealBounds) {
    const max = chooseRealUpperBound(left, right)
    if (max === null) return false
    if (left.max === right.max) return left.maxInclusive || right.maxInclusive
    return left.max === max ? left.maxInclusive : right.maxInclusive
}

function intersectRealLowerBound(left: RealBounds, right: RealBounds) {
    if (left.min === null) return right.min
    if (right.min === null) return left.min
    return compareRealStrings(left.min, right.min) > 0 ? left.min : right.min
}

function intersectRealLowerInclusive(left: RealBounds, right: RealBounds) {
    const min = intersectRealLowerBound(left, right)
    if (min === null) return false
    if (left.min === right.min) return left.minInclusive && right.minInclusive
    return left.min === min ? left.minInclusive : right.minInclusive
}

function intersectRealUpperBound(left: RealBounds, right: RealBounds) {
    if (left.max === null) return right.max
    if (right.max === null) return left.max
    return compareRealStrings(left.max, right.max) < 0 ? left.max : right.max
}

function intersectRealUpperInclusive(left: RealBounds, right: RealBounds) {
    const max = intersectRealUpperBound(left, right)
    if (max === null) return false
    if (left.max === right.max) return left.maxInclusive && right.maxInclusive
    return left.max === max ? left.maxInclusive : right.maxInclusive
}

function canonicalReal(value: string): string {
    return new Decimal(value).toString()
}

function compareRealStrings(left: string, right: string): number {
    return new Decimal(left).comparedTo(new Decimal(right))
}

function undefinedIfNull<T>(value: T | null): T | undefined {
    return value === null ? undefined : value
}
