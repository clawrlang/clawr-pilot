#include "integer-va.h"

int main() {
    Integer *bigInt = integerWithDigits(2, DIGIT_MAX, DIGIT_MAX);
    Integer *small = integerWithDigits(1, DIGIT_MAX);

    Integer·increment(bigInt, small);
    printDigits(bigInt);

    releaseRC(bigInt);
    releaseRC(small);
}
