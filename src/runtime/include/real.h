#ifndef CLAWR_REAL_H
#define CLAWR_REAL_H

#include "refc.h"

// Temporary representation layer for real values.
// Uses long double for now while preserving source decimal strings.
typedef struct Real {
    __rc_header header;
    long double value;
    char* canonical;
} Real;
extern const __type_info Realˇtype;

Real* Real¸fromString(const char* value);
const char* Real·toString(Real* self);
Real* Real¸add(Real* left, Real* right);
Real* Real¸subtract(Real* left, Real* right);
Real* Real¸multiply(Real* left, Real* right);
Real* Real¸divide(Real* dividend, Real* divisor);
Real* Real¸power(Real* base, Real* exponent);

#endif // CLAWR_REAL_H
