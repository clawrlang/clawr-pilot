#include "integer-va.h"

int main() {
    Integer *bigInt = integerWithDigits(2, DIGIT_MIN, DIGIT_MIN);
    Integer *large = integerWithDigits(3, DIGIT_MAX, DIGIT_MAX, DIGIT_MAX);

    Integer·decrement(bigInt, large);
    printDigits(bigInt);

    releaseRC(bigInt);
    releaseRC(large);
}
