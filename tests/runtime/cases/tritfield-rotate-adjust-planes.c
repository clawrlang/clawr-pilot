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

static BinaryLaneField maskForLength(const size_t length) {
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

static TritField rotateField(const TritField x, const TritField y) {
    const BinaryLaneField mask = maskForLength(x.length);

    const BinaryLaneField yTrue = (y.x1 & y.x0) & mask;
    const BinaryLaneField yFalse = (~y.x1 & ~y.x0) & mask;
    const BinaryLaneField yAmbiguous = (~y.x1 & y.x0) & mask;

    const BinaryLaneField up0 = (~x.x1) & mask;
    const BinaryLaneField up1 = (x.x0 & ~x.x1) & mask;

    const BinaryLaneField down0 = ((~x.x0) | x.x1) & mask;
    const BinaryLaneField down1 = (~x.x1 & ~x.x0) & mask;

    const BinaryLaneField r0 =
        ((yTrue & up0) | (yFalse & down0) | (yAmbiguous & x.x0)) & mask;
    const BinaryLaneField r1 =
        ((yTrue & up1) | (yFalse & down1) | (yAmbiguous & x.x1)) & mask;

    return (TritField){.x0 = r0, .x1 = r1, .length = x.length};
}

static TritField adjustField(const TritField x, const TritField y) {
    const BinaryLaneField mask = maskForLength(x.length);

    const BinaryLaneField yTrue = (y.x1 & y.x0) & mask;
    const BinaryLaneField yFalse = (~y.x1 & ~y.x0) & mask;
    const BinaryLaneField yAmbiguous = (~y.x1 & y.x0) & mask;

    const BinaryLaneField up0 = (x.x0 | ~x.x1) & mask;
    const BinaryLaneField up1 = x.x0 & mask;

    const BinaryLaneField down0 = x.x1 & mask;
    const BinaryLaneField down1 = 0ULL;

    const BinaryLaneField r0 =
        ((yTrue & up0) | (yFalse & down0) | (yAmbiguous & x.x0)) & mask;
    const BinaryLaneField r1 =
        ((yTrue & up1) | (yFalse & down1) | (yAmbiguous & x.x1)) & mask;

    return (TritField){.x0 = r0, .x1 = r1, .length = x.length};
}

static char rotateScalar(const char x, const char y) {
    if (y == '1') {
        if (x == '0') return '?';
        if (x == '?') return '1';
        return '0';
    }
    if (y == '0') {
        if (x == '0') return '1';
        if (x == '?') return '0';
        return '?';
    }
    return x;
}

static char adjustScalar(const char x, const char y) {
    if (y == '1') {
        if (x == '0') return '?';
        if (x == '?') return '1';
        return '1';
    }
    if (y == '0') {
        if (x == '0') return '0';
        if (x == '?') return '0';
        return '?';
    }
    return x;
}

static void toString(const TritField value, char *buffer) {
    for (size_t i = 0; i < value.length; i++) {
        const size_t shift = value.length - 1 - i;
        buffer[i] = tritAt(value, shift);
    }
    buffer[value.length] = '\0';
}

static bool matchesRotateScalar(const char *x, const char *y, const TritField got) {
    char expected[65];
    const size_t length = strlen(x);
    for (size_t i = 0; i < length; i++) {
        expected[i] = rotateScalar(x[i], y[i]);
    }
    expected[length] = '\0';

    char gotText[65];
    toString(got, gotText);
    return strcmp(expected, gotText) == 0;
}

static bool matchesAdjustScalar(const char *x, const char *y, const TritField got) {
    char expected[65];
    const size_t length = strlen(x);
    for (size_t i = 0; i < length; i++) {
        expected[i] = adjustScalar(x[i], y[i]);
    }
    expected[length] = '\0';

    char gotText[65];
    toString(got, gotText);
    return strcmp(expected, gotText) == 0;
}

int main() {
    const TritField x = tritfieldFromString("0?1");
    const TritField yTrue = tritfieldFromString("111");
    const TritField yFalse = tritfieldFromString("000");
    const TritField yAmbiguous = tritfieldFromString("???");
    const TritField yMixed = tritfieldFromString("1?0");

    const TritField rotUp = rotateField(x, yTrue);
    const TritField rotDown = rotateField(x, yFalse);
    const TritField rotIdentity = rotateField(x, yAmbiguous);
    const TritField rotMixed = rotateField(x, yMixed);

    const TritField adjUp = adjustField(x, yTrue);
    const TritField adjDown = adjustField(x, yFalse);
    const TritField adjIdentity = adjustField(x, yAmbiguous);
    const TritField adjMixed = adjustField(x, yMixed);

    const TritField all[] = {
        rotUp,
        rotDown,
        rotIdentity,
        adjUp,
        adjDown,
        adjIdentity,
        rotMixed,
        adjMixed,
    };

    for (size_t i = 0; i < sizeof(all) / sizeof(all[0]); i++) {
        if (!isCanonical(all[i])) {
            fprintf(stderr, "Non-canonical ternary result\n");
            return 1;
        }
    }

    if (!matchesRotateScalar("0?1", "111", rotUp)) return 1;
    if (!matchesRotateScalar("0?1", "000", rotDown)) return 1;
    if (!matchesRotateScalar("0?1", "???", rotIdentity)) return 1;
    if (!matchesRotateScalar("0?1", "1?0", rotMixed)) return 1;

    if (!matchesAdjustScalar("0?1", "111", adjUp)) return 1;
    if (!matchesAdjustScalar("0?1", "000", adjDown)) return 1;
    if (!matchesAdjustScalar("0?1", "???", adjIdentity)) return 1;
    if (!matchesAdjustScalar("0?1", "1?0", adjMixed)) return 1;

    printTritField(rotUp);
    printTritField(rotDown);
    printTritField(rotIdentity);
    printTritField(adjUp);
    printTritField(adjDown);
    printTritField(adjIdentity);
    printTritField(rotMixed);
    printTritField(adjMixed);

    return 0;
}
