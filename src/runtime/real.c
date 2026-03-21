#include "real.h"
#include "panic.h"

#include <errno.h>
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
