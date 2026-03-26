#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "lanes.h"

typedef struct {
    BinaryLaneField x0;
    BinaryLaneField x1;
    size_t length;
} TritField;

static BinaryLaneField maskForLength(size_t length) {
    if (length >= 64) {
        return ~0ULL;
    }
    return (1ULL << length) - 1ULL;
}

static TritField tritfieldFromString(const char *text) {
    const size_t length = strlen(text);
    BinaryLaneField x0 = 0ULL;
    BinaryLaneField x1 = 0ULL;

    for (size_t i = 0; i < length; i++) {
        const char ch = text[i];
        const size_t shift = length - 1 - i;

        if (ch == '?') {
            x0 |= 1ULL << shift;
        } else if (ch == '1') {
            x0 |= 1ULL << shift;
            x1 |= 1ULL << shift;
        } else if (ch != '0') {
            fprintf(stderr, "Unexpected trit character: %c\n", ch);
            exit(2);
        }
    }

    return (TritField){.x0 = x0, .x1 = x1, .length = length};
}

static char tritAt(const TritField value, const size_t shift) {
    const bool b0 = ((value.x0 >> shift) & 1ULL) != 0;
    const bool b1 = ((value.x1 >> shift) & 1ULL) != 0;

    if (!b0 && !b1) return '0';
    if (b0 && !b1) return '?';
    return '1';
}

static void printTritField(const TritField value) {
    for (size_t i = 0; i < value.length; i++) {
        const size_t shift = value.length - 1 - i;
        putchar(tritAt(value, shift));
    }
    putchar('\n');
}

static bool isCanonical(const TritField value) {
    return (value.x1 & ~value.x0) == 0ULL;
}

static TritField andField(const TritField a, const TritField b) {
    return (TritField){
        .x0 = a.x0 & b.x0,
        .x1 = a.x1 & b.x1,
        .length = a.length,
    };
}

static TritField orField(const TritField a, const TritField b) {
    return (TritField){
        .x0 = a.x0 | b.x0,
        .x1 = a.x1 | b.x1,
        .length = a.length,
    };
}

static TritField notField(const TritField a) {
    const BinaryLaneField mask = maskForLength(a.length);
    const BinaryLaneField y0 = (~a.x1) & mask;
    const BinaryLaneField y1 = (~a.x1 & ~a.x0) & mask;

    return (TritField){
        .x0 = y0,
        .x1 = y1,
        .length = a.length,
    };
}

int main() {
    const TritField a = tritfieldFromString("0?1");
    const TritField b = tritfieldFromString("1?0");

    const TritField cAnd = andField(a, b);
    const TritField cOr = orField(a, b);
    const TritField cNot = notField(a);

    if (!isCanonical(cAnd) || !isCanonical(cOr) || !isCanonical(cNot)) {
        fprintf(stderr, "Non-canonical ternary result\n");
        return 1;
    }

    printTritField(cAnd);
    printTritField(cOr);
    printTritField(cNot);

    return 0;
}
