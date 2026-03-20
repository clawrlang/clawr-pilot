#include "integer-va.h"
#include <stdio.h>

int main() {
    Integer* integer;

    integer = integerWithDigits(1, DIGIT_MIN);
    Integer·toggleSign(integer);
    printDigits(integer);
    releaseRC(integer);

    integer = integerWithDigits(2, -1LL, 1LL);
    Integer·toggleSign(integer);
    printDigits(integer);
    releaseRC(integer);

    integer = integerWithDigits(3, -1LL, 1LL, DIGIT_MAX);
    Integer·toggleSign(integer);
    printDigits(integer);
    releaseRC(integer);
}
