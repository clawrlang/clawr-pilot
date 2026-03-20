#include "integer-va.h"
#include <stdio.h>

int main() {
    Integer* dividend;
    digit_t remainder;

    // Single digit dividend
    dividend = integerWithDigits(1, DIGIT_MAX);
    remainder = Integer·divide(dividend, 1e18);
    printf("quotient::"); printDigits(dividend);
    printf("remainder::%lld\n", remainder);
    releaseRC(dividend);

    // Two digits dividend
    dividend = integerWithDigits(2, 1, 0); // = 18,446,744,073,709,551,615
    remainder = Integer·divide(dividend, 1e18);
    printf("quotient::"); printDigits(dividend);
    printf("remainder::%lld\n", remainder);
    releaseRC(dividend);

    // Three digits dividend
    dividend = integerWithDigits(3, 1, 0, 0); // = 340,282,366,920,938,463,426,481,119,284,349,108,225
    remainder = Integer·divide(dividend, 1e18);
    printf("quotient::"); printDigits(dividend);
    printf("remainder::%lld\n", remainder);
    releaseRC(dividend);

    // Negative divisor
    dividend = integerWithDigits(3, 1, 0, 0); // = 340,282,366,920,938,463,426,481,119,284,349,108,225
    remainder = Integer·divide(dividend, -1000000000000000000LL);
    printf("quotient::"); printDigits(dividend);
    printf("remainder::%lld\n", remainder);
    releaseRC(dividend);

    // Complex dividend
    dividend = integerWithDigits(2, -1, (DIGIT_MAX - 1) / 2); // = -13,835,058,055,282,163,712
    remainder = Integer·divide(dividend, -1e18);
    printf("quotient::"); printDigits(dividend);
    printf("remainder::%lld\n", remainder);
    releaseRC(dividend);
}
