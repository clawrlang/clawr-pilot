#include "bitfield.h"
#include "panic.h"

#include <stdlib.h>

String* bitfield__toStringRC(uint64_t value, uint32_t length) {
    if (length == 0 || length > 64) {
        panic("bitfield__toStringRC expects length in [1, 64]");
    }

    char* buffer = malloc((size_t) length + 1);
    if (!buffer) panic("Out of memory in bitfield__toStringRC");

    for (uint32_t i = 0; i < length; i++) {
        uint64_t bit = 1ULL << (length - 1 - i);
        buffer[i] = (value & bit) ? '1' : '0';
    }
    buffer[length] = '\0';

    String* result = String¸fromCString(buffer);
    free(buffer);
    return result;
}
