#include "integer-va.h"
#include <stdio.h>
#include <stdlib.h>

static Integer* integerFromDecimal(const char* decimal) {
    int negative = 0;
    const char* cursor = decimal;
    if (*cursor == '-') {
        negative = 1;
        cursor++;
    }

    Integer* value = retainRC(&Integer¸zero);
    Integer* ten = integerWithDigits(1, 10);

    for (size_t i = 0; cursor[i] != '\0'; i++) {
        Integer* scaled = Integer¸multiply(value, ten);
        releaseRC(value);

        Integer* digit = integerWithDigits(1, (digit_t)(cursor[i] - '0'));
        value = Integer¸add(scaled, digit);
        releaseRC(scaled);
        releaseRC(digit);
    }

    if (negative) Integer·toggleSign(value);
    releaseRC(ten);
    return value;
}

static void printQuotient(const char* label, Integer* dividend, Integer* divisor) {
    Integer* quotient = Integer¸divide(dividend, divisor);
    const char* text = Integer·toString(quotient);
    printf("%s%s\n", label, text);
    free((void*)text);
    releaseRC(quotient);
}

int main() {
    Integer* a = integerFromDecimal("1000000000000000000000000000000");
    Integer* b = integerFromDecimal("1000000000000000");
    printQuotient("q1::", a, b);

    Integer* c = integerFromDecimal("-1000000000000000000000000000000");
    Integer* d = integerFromDecimal("100000000000000000000");
    printQuotient("q2::", c, d);

    Integer* e = integerFromDecimal("1000000000000000000000000000001");
    Integer* f = integerFromDecimal("1000000000000000");
    printQuotient("q3::", e, f);

    releaseRC(a);
    releaseRC(b);
    releaseRC(c);
    releaseRC(d);
    releaseRC(e);
    releaseRC(f);
}
