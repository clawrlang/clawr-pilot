#include "integer-va.h"
#include <stdio.h>

int main() {
    Integer* dividend;
    digit_t remainder;

    // Rounding up
    dividend = integerWithDigits(2, 6, 0);
    remainder = Integer·divide(dividend, 10);
    printf("quotient::"); printDigits(dividend);
    printf("remainder::%lld\n", remainder);
    releaseRC(dividend);

    // Rounding up
    dividend = integerWithDigits(2, 5, 1);
    remainder = Integer·divide(dividend, 10);
    printf("quotient::"); printDigits(dividend);
    printf("remainder::%lld\n", remainder);
    releaseRC(dividend);

    // Rounding up
    dividend = integerWithDigits(2, 5, 0);
    remainder = Integer·divide(dividend, 10);
    printf("quotient::"); printDigits(dividend);
    printf("remainder::%lld\n", remainder);
    releaseRC(dividend);

    // Rounding down
    dividend = integerWithDigits(2, -6, 0);
    remainder = Integer·divide(dividend, 10);
    printf("quotient::"); printDigits(dividend);
    printf("remainder::%lld\n", remainder);
    releaseRC(dividend);

    // Rounding down
    dividend = integerWithDigits(2, -5, -1);
    remainder = Integer·divide(dividend, 10);
    printf("quotient::"); printDigits(dividend);
    printf("remainder::%lld\n", remainder);
    releaseRC(dividend);

    // Rounding down
    dividend = integerWithDigits(2, -5, 0);
    remainder = Integer·divide(dividend, 10);
    printf("quotient::"); printDigits(dividend);
    printf("remainder::%lld\n", remainder);
    releaseRC(dividend);
}
