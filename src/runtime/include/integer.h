#ifndef BIG_INTEGER_H
#define BIG_INTEGER_H

#include "refc.h"
#include "array.h"
#include <stdlib.h>

#define DIGIT_MAX INT64_MAX
#define DIGIT_MIN -INT64_MAX
#define BASE UINT64_MAX
typedef int64_t digit_t;

/**
 * Integer: A structure for representing arbitrarily large integers.
 *
 * Digits are stored in an array of int64_t. The least significant digit is at
 * index 0 (little-endian order).
 *
 * Uses base 18,446,744,073,709,551,615 (balanced) -- 2^64 - 1. Digits range
 * from -9,223,372,036,854,775,807 to 9,223,372,036,854,775,807. The int64_t
 * value -9,223,372,036,854,775,808 -- INT64_MIN == -2^63 -- is not used.
 * This must be compensated for when detecting overflow/underflow during
 * arithmetic operations.
 */
typedef struct Integer {
    __rc_header header;
    Array* digits;
} Integer;
extern const __type_info Integerˇtype;

/// @brief The value 0
extern Integer Integer¸zero;

// namespace Integer { func withDigits(digit_t ... digits) -> Integer }
/// @brief Factory method with varargs digits
/// @param count the number of digits
/// @param digits balanced digits in big-endian order
/// @return
Integer* Integer¸withDigits(Array* const digits);

// mutating: func increment(Integer addend)
/// @brief Increment a Integer by another Integer
/// @param self The Integer to be incremented
/// @param addend The Integer to add to the first
void Integer·increment(Integer* const self, Integer* const addend);

// mutating: func decrement(Integer subtrahend)
/// @brief Decrement a Integer by another Integer
/// @param self The Integer to be decremented
/// @param subtrahend The Integer to add to the first
void Integer·decrement(Integer* const self, Integer* const subtrahend);

/// @brief Convert Integer to its decimal representation
/// @param self the integer to convert
/// @return the decimal representation
const char* Integer·toString(Integer* self);

// mutating: func toggleSign()
void Integer·toggleSign(Integer* const self);

void printDigits(Integer* integer);

digit_t Integer·divide(Integer *dividend, digit_t divisor);

#endif // BIG_INTEGER_H
