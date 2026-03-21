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

#endif // CLAWR_REAL_H
