#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    unsigned long long x0;
    unsigned long long x1;
    size_t length;
} TritField;

static unsigned long long maskForLength(const size_t length) {
    if (length >= 64) {
        return ~0ULL;
    }
    return (1ULL << length) - 1ULL;
}

static TritField tritfieldFromString(const char* text) {
    const size_t length = strlen(text);
    unsigned long long x0 = 0ULL;
    unsigned long long x1 = 0ULL;

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

static bool isCanonical(const TritField value) {
    return (value.x1 & ~value.x0) == 0ULL;
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

static TritField modulateField(const TritField x, const TritField y) {
    const unsigned long long mask = maskForLength(x.length);

    const unsigned long long yTrue = (y.x1 & y.x0) & mask;
    const unsigned long long yFalse = (~y.x1 & ~y.x0) & mask;
    const unsigned long long yAmbiguous = (~y.x1 & y.x0) & mask;

    const unsigned long long flip0 = (~x.x1) & mask;
    const unsigned long long flip1 = (~x.x0) & mask;
    const unsigned long long clear0 = mask;
    const unsigned long long clear1 = 0ULL;

    const unsigned long long r0 =
        ((yTrue & x.x0) | (yFalse & flip0) | (yAmbiguous & clear0)) & mask;
    const unsigned long long r1 =
        ((yTrue & x.x1) | (yFalse & flip1) | (yAmbiguous & clear1)) & mask;

    return (TritField){.x0 = r0, .x1 = r1, .length = x.length};
}

static char modulateScalar(const char x, const char y) {
    if (y == '1') return x;
    if (y == '?') return '?';

    if (x == '0') return '1';
    if (x == '1') return '0';
    return '?';
}

static void toString(const TritField value, char* buffer) {
    for (size_t i = 0; i < value.length; i++) {
        const size_t shift = value.length - 1 - i;
        buffer[i] = tritAt(value, shift);
    }
    buffer[value.length] = '\0';
}

static bool matchesModulateScalar(const char* x, const char* y, const TritField got) {
    char expected[65];
    const size_t length = strlen(x);
    for (size_t i = 0; i < length; i++) {
        expected[i] = modulateScalar(x[i], y[i]);
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

    const TritField keep = modulateField(x, yTrue);
    const TritField flip = modulateField(x, yFalse);
    const TritField clear = modulateField(x, yAmbiguous);
    const TritField mixed = modulateField(x, yMixed);

    const TritField all[] = {keep, flip, clear, mixed};
    for (size_t i = 0; i < sizeof(all) / sizeof(all[0]); i++) {
        if (!isCanonical(all[i])) {
            fprintf(stderr, "Non-canonical ternary result\n");
            return 1;
        }
    }

    if (!matchesModulateScalar("0?1", "111", keep)) return 1;
    if (!matchesModulateScalar("0?1", "000", flip)) return 1;
    if (!matchesModulateScalar("0?1", "???", clear)) return 1;
    if (!matchesModulateScalar("0?1", "1?0", mixed)) return 1;

    printTritField(keep);
    printTritField(flip);
    printTritField(clear);
    printTritField(mixed);

    return 0;
}
