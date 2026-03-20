#include <stdio.h>
#include <stdlib.h>

static inline void panic(const char* const message) {
    fprintf(stderr, "PANIC: %s\n", message);
    exit(EXIT_FAILURE);
}

#ifdef NDEBUG
#define assert(...) NULL
#else
#define assert(condition, message) if (!(condition)) panic(message);
#endif
