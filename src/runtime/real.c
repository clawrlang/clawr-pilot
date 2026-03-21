#include "real.h"
#include "panic.h"

#include <errno.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

static void releaseNestedFields(void* self) {
    Real* real = (Real*) self;
    if (real->canonical) {
        free(real->canonical);
        real->canonical = NULL;
    }
}

const __type_info Realˇtype = {
    .data_type = {
        .size = sizeof(Real),
        .retain_nested_fields = NULL,
        .release_nested_fields = releaseNestedFields,
    },
};

static char* cloneString(const char* input) {
    size_t len = strlen(input);
    char* out = malloc(len + 1);
    if (!out) panic("Out of memory in Real string clone");
    memcpy(out, input, len + 1);
    return out;
}

static char* formatLongDouble(long double value) {
    int length = snprintf(NULL, 0, "%.21Lg", value);
    if (length < 0) panic("Failed to format real value");

    // +3 for potential ".0" suffix and null terminator
    char* out = malloc((size_t)length + 3);
    if (!out) panic("Out of memory in Real formatter");

    snprintf(out, (size_t)length + 1, "%.21Lg", value);

    // Ensure the result is visibly a real, not an integer (e.g. 4 -> 4.0)
    int has_marker = 0;
    for (char* p = out; *p; p++) {
        if (*p == '.' || *p == 'e' || *p == 'E') { has_marker = 1; break; }
    }
    if (!has_marker) strcat(out, ".0");

    return out;
}

// Remove readability separators while preserving decimal/exponent semantics.
static char* normalizeRealLiteral(const char* input) {
    size_t len = strlen(input);
    char* normalized = malloc(len + 1);
    if (!normalized) panic("Out of memory in Real literal normalization");

    size_t j = 0;
    for (size_t i = 0; i < len; i++) {
        if (input[i] == '_') continue;
        normalized[j++] = input[i];
    }
    normalized[j] = 0;
    return normalized;
}

Real* Real¸fromString(const char* value) {
    char* normalized = normalizeRealLiteral(value);

    errno = 0;
    char* end = NULL;
    long double parsed = strtold(normalized, &end);
    if (errno != 0 || end == normalized || *end != 0) {
        free(normalized);
        panic("Invalid real literal");
    }

    Real* real = allocRC(Real, __rc_ISOLATED);
    real->value = parsed;
    real->canonical = normalized;
    return real;
}

const char* Real·toString(Real* self) {
    return cloneString(self->canonical);
}

static Real* createFromLongDouble(long double value) {
    Real* real = allocRC(Real, __rc_ISOLATED);
    real->value = value;
    real->canonical = formatLongDouble(value);
    return real;
}

Real* Real¸add_left_right(Real* left, Real* right) {
    return createFromLongDouble(left->value + right->value);
}

Real* Real¸subtract_left_right(Real* left, Real* right) {
    return createFromLongDouble(left->value - right->value);
}

Real* Real¸multiply_left_right(Real* left, Real* right) {
    return createFromLongDouble(left->value * right->value);
}

Real* Real¸divide_dividend_by(Real* dividend, Real* divisor) {
    if (divisor->value == 0.0L) panic("Division by zero!");
    return createFromLongDouble(dividend->value / divisor->value);
}

Real* Real¸power_base_exponent(Real* base, Real* exponent) {
    return createFromLongDouble(powl(base->value, exponent->value));
}
