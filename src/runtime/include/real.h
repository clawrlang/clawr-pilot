#ifndef CLAWR_REAL_H
#define CLAWR_REAL_H

#include "refc.h"
#include "integer.h"
#include "clawr_string.h"
#include <stdbool.h>
#include <stdint.h>

// Arbitrary-precision decimal real.
// value = significand × 10^exponent10
// Strings are only materialized on demand (toString / fromString boundaries).
typedef struct Real {
    __rc_header header;
    Integer* significand;
    int32_t  exponent10;
    uint32_t context_precision;
    String*  string_cache;  // nullable; lazy-built by toStringRC
    bool     cache_valid;
} Real;
extern const __type_info Realˇtype;

/// Default number of significant decimal digits for division results.
#define CLAWR_REAL_DEFAULT_PRECISION 50

Real* Real¸fromString(const char* value);
String* Real·toStringRC(Real* self);
const char* Real·toString(Real* self);
Real* Real¸add(Real* left, Real* right);
Real* Real¸subtract(Real* left, Real* right);
Real* Real¸multiply(Real* left, Real* right);
Real* Real¸divide(Real* dividend, Real* divisor);
Real* Real¸power(Real* base, Real* exponent);

#endif // CLAWR_REAL_H
