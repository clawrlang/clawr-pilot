#include "tritfield.h"
#include "panic.h"

#include <stdlib.h>

String* tritfield__toStringRC(uint64_t x0, uint64_t x1, uint32_t length) {
    if (length == 0 || length > 64) {
        panic("tritfield__toStringRC expects length in [1, 64]");
    }

    char* buffer = malloc((size_t) length + 1);
    if (!buffer) panic("Out of memory in tritfield__toStringRC");

    for (uint32_t i = 0; i < length; i++) {
        uint64_t bit = 1ULL << (length - 1 - i);
        uint64_t b0 = (x0 & bit) ? 1ULL : 0ULL;
        uint64_t b1 = (x1 & bit) ? 1ULL : 0ULL;

        if (b0 == 0ULL && b1 == 0ULL) {
            buffer[i] = '0';
        } else if (b0 == 1ULL && b1 == 0ULL) {
            buffer[i] = '?';
        } else if (b0 == 1ULL && b1 == 1ULL) {
            buffer[i] = '1';
        } else {
            panic("Invalid non-canonical tritfield lane in tritfield__toStringRC");
        }
    }

    buffer[length] = '\0';

    String* result = String¸fromCString(buffer);
    free(buffer);
    return result;
}
