#include "lanes.h"
#include "panic.h"

#include <stdlib.h>

String* binarylane¸toStringRC(BinaryLaneField value, uint32_t length) {
    if (length == 0 || length > 64) {
        panic("binarylane¸toStringRC expects length in [1, 64]");
    }

    char* buffer = malloc((size_t) length + 1);
    if (!buffer) panic("Out of memory in binarylane¸toStringRC");

    for (uint32_t i = 0; i < length; i++) {
        BinaryLaneField bit = 1ULL << (length - 1 - i);
        buffer[i] = (value & bit) ? '1' : '0';
    }
    buffer[length] = '\0';

    String* result = String¸fromCString(buffer);
    free(buffer);
    return result;
}

String* ternarylane¸toStringRC(BinaryLaneField x0, BinaryLaneField x1, uint32_t length) {
    if (length == 0 || length > 64) {
        panic("ternarylane¸toStringRC expects length in [1, 64]");
    }

    char* buffer = malloc((size_t) length + 1);
    if (!buffer) panic("Out of memory in ternarylane¸toStringRC");

    for (uint32_t i = 0; i < length; i++) {
        BinaryLaneField bit = 1ULL << (length - 1 - i);
        BinaryLaneField b0 = (x0 & bit) ? 1ULL : 0ULL;
        BinaryLaneField b1 = (x1 & bit) ? 1ULL : 0ULL;

        if (b0 == 0ULL && b1 == 0ULL) {
            buffer[i] = '0';
        } else if (b0 == 1ULL && b1 == 0ULL) {
            buffer[i] = '?';
        } else if (b0 == 1ULL && b1 == 1ULL) {
            buffer[i] = '1';
        } else {
            panic("Invalid non-canonical ternary lane in ternarylane¸toStringRC");
        }
    }

    buffer[length] = '\0';

    String* result = String¸fromCString(buffer);
    free(buffer);
    return result;
}
