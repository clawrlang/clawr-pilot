#include "integer.h"
#include "array.h"
#include "panic.h"
#include <stdarg.h>

#define INVALID_DIGIT (DIGIT_MIN - 1)

void retainNestedFields(void* self) {
    retainRC(((Integer*) self)->digits);
}

void releaseNestedFields(void* self) {
    releaseRC(((Integer*) self)->digits);
}

const __type_info Integerˇtype = {
    .data_type = {
        .size = sizeof(Integer),
        .retain_nested_fields = retainNestedFields,
        .release_nested_fields = releaseNestedFields,
    }
};

/// @brief A ternary digit is one of {-1, 0, +1}
typedef int8_t ternary_digit_t;
/// @brief Structure for maintaining 2-digit sum of two single-digit values
typedef struct AdditionResult {
    /// @brief the carry digit passed to the next digit position
    ternary_digit_t carry;
    /// @brief the current-position digit
    digit_t digit;
} AdditionResult;

Integer Integer¸zero = {
    .digits = &Array¸empty,
    .header = {
        .is_a = &Integerˇtype,
        .refs = 1,
        .allocation_size = sizeof(Integer),
    }
};

/// @brief Add or subtract a Integer to/from another.
/// @param self the Integer to modify
/// @param addend the number to add or substract
/// @param sign +1 if adding, -1 if subtracting
void _add_in_place(Integer* const self, Integer* const addend, ternary_digit_t sign);

void Integer·increment(Integer* const self, Integer* const addend) {
    _add_in_place(self, addend, 1);
}

void Integer·decrement(Integer* const self, Integer* const subtrahend) {
    _add_in_place(self, subtrahend, -1);
}

/// @brief Pads a big integer number with zeros to a minimum size.
/// If there are already minCount or more digits, no change is performed.
/// @param self the `Integer` to modify
/// @param minCount // the digit count to expand to
void expandWithZeros(Integer* const self, const int minCount) {
    if (minCount <= self->digits->count) return;

    Array* newDigitArray = Array¸new(minCount, sizeof(digit_t));
    for (int i = 0; i < self->digits->count; i++) {
        ARRAY_ELEMENT_AT(i, newDigitArray, digit_t) = ARRAY_ELEMENT_AT(i, self->digits, digit_t);
    }

    releaseRC(self->digits);
    self->digits = newDigitArray;
}

/// @brief Full adder. Add two digits and a carry from previous adder.
/// Return the sum digit and a ternary carry (-1, 0 or 1).
/// @param a First digit
/// @param b Second digit
/// @param carry Overflow from previous adder
/// @return The two-digit sum
AdditionResult add(const digit_t a, const digit_t b, ternary_digit_t carry);

void _add_in_place(Integer* const self, Integer* const subtrahend, ternary_digit_t sign) {
    mutateRC(self->digits);
    expandWithZeros(self, subtrahend->digits->count);

    ternary_digit_t carry = 0;
    for (int i = 0; i < subtrahend->digits->count; i++) {
        AdditionResult addition_result = add(ARRAY_ELEMENT_AT(i, self->digits, digit_t), sign * ARRAY_ELEMENT_AT(i, subtrahend->digits, digit_t), carry);
        carry = addition_result.carry;
        ARRAY_ELEMENT_AT(i, self->digits, digit_t) = addition_result.digit;
    }

    for (int i = subtrahend->digits->count; carry != 0 && i < self->digits->count; i++) {
        digit_t sum = ARRAY_ELEMENT_AT(i, self->digits, digit_t) + carry;
        if (sum == INVALID_DIGIT) {
            sum += carry;
        } else {
            carry = 0;
        }
        ARRAY_ELEMENT_AT(i, self->digits, digit_t) = sum;
    }

    if (carry != 0) {
        expandWithZeros(self, self->digits->count + 1);
        ARRAY_ELEMENT_AT(self->digits->count -1, self->digits, digit_t) = carry;
    }
}

AdditionResult add(const digit_t a, const digit_t b, const ternary_digit_t carry) {
    const digit_t sum = a + b + carry;

    // Over-/underflow occurs when adding two digits of the same sign. If
    // the sum has the same sign, all is well. If there is overflow,
    // the sign is flipped.
    // If the carry is non-zero, it may tip the sum over the edge. This
    // results in the invalid digit (DIGIT_MIN - 1).
    // Because of the invalid digit, operations that land on it or pass
    // through must move one additional step.

    if (a > 0 && b > 0 && sum < 0) { // overflow
        return (AdditionResult) {
            .carry = 1,
            .digit = sum + 1, // Compensate for passing over INVALID_DIGIT
        };
    } else if (a < 0 && b < 0 && sum > 0) { // underflow
        return (AdditionResult) {
            .carry = -1,
            .digit = sum - 1, // Compensate for passing over INVALID_DIGIT
        };
    } else if (sum == INVALID_DIGIT) { // overflow/underflow by exactly one
        return (AdditionResult) {
            .carry = carry,
            .digit = sum + carry, // Move one extra step in the direction of the carry
        };
    } else {
        return (AdditionResult) {
            .carry = 0,
            .digit = sum,
        };
    }
}

// A “trill” is a digit with base one (long scale) trillion (10^18)
typedef struct TrillList {
    digit_t digit;
    struct TrillList* next;
} TrillList;

const char* Integer·toString(Integer* self) {
    Integer* rem = retainRC(self);
    mutateRC(rem);

    TrillList *trillStack = NULL;
    size_t limbs = 0;
    while (rem->digits->count) {
        TrillList* newLimb = malloc(sizeof(TrillList));
        newLimb->next = trillStack;
        newLimb->digit = Integer·divide(rem, 1000000000000000000LL);
        trillStack = newLimb;
        limbs++;
    }

    releaseRC(rem);

    if (!trillStack) {
        // Input was zero
        char* result = malloc(2);
        result[0] = '0';
        result[1] = '\0';
        return result;
    }

    int8_t sign = trillStack->digit < 0 ? -1 : 1;
    size_t length = 18 * limbs + (sign == 1 ? 1 : 2);
    char* result = malloc(sizeof(char*) * length);
    result[length - 1] = 0;

    char* offset = result;
    if (sign == -1) {
        result[0] = '-';
        offset++;
    }

    // Most significant trill might be less than 18 digits. Do not pad with zeros.
    offset += sprintf(offset, "%lld", trillStack->digit * sign);
    TrillList* nextLimb = trillStack->next;
    free(trillStack);
    trillStack = nextLimb;

    while (trillStack) {
        // Pad with zeroes to ensure 18 digits are rendered for each trill.
        offset += sprintf(offset, "%018lld", trillStack->digit * sign);
        TrillList* nextLimb = trillStack->next;
        free(trillStack);
        trillStack = nextLimb;
    }

    return result;
}

void Integer·toggleSign(Integer* const self) {
    mutateRC(self->digits);
    for (size_t i = 0; i < self->digits->count; i++) {
        ARRAY_ELEMENT_AT(i, self->digits, digit_t) = -ARRAY_ELEMENT_AT(i, self->digits, digit_t);
    }
}

Integer* Integer¸withDigits(Array* const digits) {
    Integer* integer = allocRC(Integer, __rc_ISOLATED);
    integer->digits = Array¸new(digits->count, sizeof(digit_t));

    for (size_t i = 0; i < digits->count; i++) {
        ARRAY_ELEMENT_AT(digits->count - 1 - i, integer->digits, digit_t) = ARRAY_ELEMENT_AT(i, digits, digit_t);
    }

    return integer;
}

Array* Array¸repeat(digit_t digit, size_t count) {
    Array* array = Array¸new(count, sizeof(digit_t));
    for (size_t i = 0; i < count; i++)
        ARRAY_ELEMENT_AT(i, array, digit_t) = 0;
    return array;
}

void printDigits(Integer* integer) {
    printf("Digits: [ ");
    for (int i = integer->digits->count - 1; i >= 0; i--) {
        printf("%lld ", ARRAY_ELEMENT_AT(i, integer->digits, digit_t));
    }
    printf("]\n");
}

digit_t Integer·divide(Integer* self, digit_t divisor) {

    /*
    This is the normal division algorithm, except the digits are balanced (half
    are negative) and much bigger than 0-9.

    For each digit in the dividend, we check how many times the divisor fits.
    That becomes our next quotient digit. Then we subtract the quotient times
    the divisor as normal before moving on with the next digit.

    This time, however, we need to maintain a remainder around ±divisor / 2.
    Because some digits are negative, if we allow a too high or too low
    (negative) remainder, when the next digit (or future digits) is brought in,
    the division will result in a two-digit quotient which is problematic to
    add in a single position of the result.
    */

    if (divisor == 0) panic("Division by zero!");
    if (self->digits->count == 0) return 0;

    mutateRC(self->digits);

    if (divisor < 0) {
        for (size_t i = 0; i < self->digits->count; i++) {
            ARRAY_ELEMENT_AT(i, self->digits, digit_t) = -ARRAY_ELEMENT_AT(i, self->digits, digit_t);
        }
        return Integer·divide(self, -divisor);
    }

    // The maximum (positive) remainder allowed.
    const __int128_t D_h = ((__int128_t) divisor + 1) / 2;
    __int128_t remainder = 0;

    // Process each digit from most significant down (but wait to handle the
    // least significant digit, as it follows different rules).
    for (size_t i = self->digits->count - 1; i > 0; i--) {

        // “Shift” remainder left and bring in next dividend digit
        remainder = remainder * BASE + (__int128_t)ARRAY_ELEMENT_AT(i, self->digits, digit_t);

        // the next quotient digit. Adjusted if the remainder is too far from zero.
        __int128_t q = remainder / divisor;
        remainder -= q * divisor;

        // Remainder must be in the range [-D_h, D_h]. Add or remove the
        // divisor if the value is too large. Add or remove 1 from q to
        // compensate.
        if (remainder > D_h) {
            q += 1;
            remainder -= divisor;
        } else if (remainder < -D_h) {
            q -= 1;
            remainder += divisor;
        } else if (remainder == D_h || remainder == -D_h) {
            for (size_t j = i - 1; j < SIZE_MAX; j--) {
                digit_t d = ARRAY_ELEMENT_AT(j, self->digits, digit_t);
                if (d == 0) continue;

                if (remainder == D_h && d > 0) {
                    q += 1;
                    remainder -= divisor;
                }
                if (remainder == -D_h && d < 0) {
                    q -= 1;
                    remainder += divisor;
                }
                break;
            }
        }

        // Add the quotient digit to the result.
        ARRAY_ELEMENT_AT(i, self->digits, digit_t) = q;
    }

    // “Shift” remainder left and bring in the least significant digit
    remainder = remainder * BASE + (__int128_t)ARRAY_ELEMENT_AT(0, self->digits, digit_t);
    ARRAY_ELEMENT_AT(0, self->digits, digit_t) = remainder / divisor;
    remainder -= divisor * ARRAY_ELEMENT_AT(0, self->digits, digit_t);

    if (ARRAY_ELEMENT_AT(self->digits->count - 1, self->digits, digit_t) == 0) {
        Array* truncatedDigits = Array¸new(self->digits->count - 1, sizeof(digit_t));
        for (size_t i = 0; i < truncatedDigits->count; i++) {
            ARRAY_ELEMENT_AT(i, truncatedDigits, digit_t) = ARRAY_ELEMENT_AT(i, self->digits, digit_t);
        }

        releaseRC(self->digits);
        self->digits = truncatedDigits;
    }
    return (digit_t)remainder;
};

// ---------------------------------------------------------------------------
// Static helpers for new arithmetic operations
// ---------------------------------------------------------------------------

static size_t effectiveLength(Integer* self) {
    size_t n = self->digits->count;
    while (n > 0 && ARRAY_ELEMENT_AT(n - 1, self->digits, digit_t) == 0)
        n--;
    return n;
}

static int8_t integerSign(Integer* self) {
    for (size_t i = self->digits->count; i-- > 0; ) {
        digit_t d = ARRAY_ELEMENT_AT(i, self->digits, digit_t);
        if (d > 0) return 1;
        if (d < 0) return -1;
    }
    return 0;
}

static Integer* copyInteger(Integer* src) {
    Integer* copy = allocRC(Integer, __rc_ISOLATED);
    size_t n = src->digits->count;
    copy->digits = Array¸new(n, sizeof(digit_t));   // zero-initialised by Array¸new
    for (size_t i = 0; i < n; i++)
        ARRAY_ELEMENT_AT(i, copy->digits, digit_t) = ARRAY_ELEMENT_AT(i, src->digits, digit_t);
    return copy;
}

static Integer* zeroOfSize(size_t count) {
    Integer* result = allocRC(Integer, __rc_ISOLATED);
    result->digits = Array¸new(count, sizeof(digit_t));  // zero-initialised
    return result;
}

static void trimLeadingZeros(Integer* self) {
    size_t n = self->digits->count;
    while (n > 0 && ARRAY_ELEMENT_AT(n - 1, self->digits, digit_t) == 0)
        n--;
    if (n == self->digits->count) return;
    if (n == 0) {
        releaseRC(self->digits);
        self->digits = retainRC(&Array¸empty);
        return;
    }
    Array* trimmed = Array¸new(n, sizeof(digit_t));
    for (size_t i = 0; i < n; i++)
        ARRAY_ELEMENT_AT(i, trimmed, digit_t) = ARRAY_ELEMENT_AT(i, self->digits, digit_t);
    releaseRC(self->digits);
    self->digits = trimmed;
}

/// In-place balanced decompose of a 128-bit value into a digit and carry.
/// After the call: value == *carry_out * BASE + *digit_out,
/// with |*digit_out| <= DIGIT_MAX.
static void balancedDecompose(__int128_t value, digit_t* digit_out, __int128_t* carry_out) {
    static const __int128_t BASE_128 = ((__int128_t)1 << 64) - 1;
    __int128_t q = value / BASE_128;
    __int128_t r = value - q * BASE_128;
    if (r > (digit_t)DIGIT_MAX) { r -= BASE_128; q++; }
    else if (r < -(digit_t)DIGIT_MAX) { r += BASE_128; q--; }
    *digit_out = (digit_t)r;
    *carry_out = q;
}

// ---------------------------------------------------------------------------
// Non-mutating binary operations
// ---------------------------------------------------------------------------

Integer* Integer·add(Integer* left, Integer* right) {
    Integer* result = copyInteger(left);
    Integer·increment(result, right);
    trimLeadingZeros(result);
    return result;
}

Integer* Integer·subtract(Integer* left, Integer* right) {
    Integer* result = copyInteger(left);
    Integer·decrement(result, right);
    trimLeadingZeros(result);
    return result;
}

Integer* Integer·multiply(Integer* left, Integer* right) {
    size_t n = effectiveLength(left);
    size_t m = effectiveLength(right);
    if (n == 0 || m == 0) return retainRC(&Integer¸zero);

    Integer* result = zeroOfSize(n + m);

    for (size_t i = 0; i < n; i++) {
        digit_t a = ARRAY_ELEMENT_AT(i, left->digits, digit_t);
        if (a == 0) continue;

        __int128_t carry = 0;
        for (size_t j = 0; j < m; j++) {
            digit_t b   = ARRAY_ELEMENT_AT(j, right->digits, digit_t);
            digit_t cur = ARRAY_ELEMENT_AT(i + j, result->digits, digit_t);
            __int128_t prod = (__int128_t)a * b + cur + carry;
            digit_t digit;
            balancedDecompose(prod, &digit, &carry);
            ARRAY_ELEMENT_AT(i + j, result->digits, digit_t) = digit;
        }

        // Propagate any remaining carry into the higher positions.
        for (size_t k = i + m; carry != 0 && k < n + m; k++) {
            __int128_t sum = (__int128_t)ARRAY_ELEMENT_AT(k, result->digits, digit_t) + carry;
            digit_t digit;
            balancedDecompose(sum, &digit, &carry);
            ARRAY_ELEMENT_AT(k, result->digits, digit_t) = digit;
        }
    }

    trimLeadingZeros(result);
    return result;
}

Integer* Integer·divideIntegers(Integer* dividend, Integer* divisor) {
    size_t m = effectiveLength(divisor);
    if (m == 0) panic("Division by zero!");
    if (effectiveLength(dividend) == 0) return retainRC(&Integer¸zero);

    if (m > 1) {
        panic("Integer division by values whose magnitude exceeds a single digit "
              "(> 9223372036854775807) is not yet implemented");
    }

    digit_t d = ARRAY_ELEMENT_AT(0, divisor->digits, digit_t);
    Integer* result = copyInteger(dividend);
    Integer·divide(result, d);
    trimLeadingZeros(result);
    return result;
}

Integer* Integer·power(Integer* base, Integer* exponent) {
    if (integerSign(exponent) < 0)
        panic("Integer exponentiation requires a non-negative exponent");

    // result = 1
    Integer* result = zeroOfSize(1);
    ARRAY_ELEMENT_AT(0, result->digits, digit_t) = 1;

    if (effectiveLength(exponent) == 0)
        return result;   // base^0 = 1

    Integer* b       = copyInteger(base);
    Integer* exp_rem = copyInteger(exponent);

    while (effectiveLength(exp_rem) > 0) {
        digit_t bit = Integer·divide(exp_rem, 2);
        trimLeadingZeros(exp_rem);

        if (bit != 0) {
            Integer* new_result = Integer·multiply(result, b);
            releaseRC(result);
            result = new_result;
        }

        if (effectiveLength(exp_rem) > 0) {
            Integer* new_b = Integer·multiply(b, b);
            releaseRC(b);
            b = new_b;
        }
    }

    releaseRC(b);
    releaseRC(exp_rem);
    return result;
}
