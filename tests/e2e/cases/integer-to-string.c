#include "integer-va.h"
#include <stdio.h>

int main() {
    Integer* bigInt;

    bigInt = integerWithDigits(2, 1, 2);
    printf("%s\n", Integer·toString(bigInt));
    releaseRC(bigInt);

    bigInt = integerWithDigits(3, 1, 0, 0);
    printf("%s\n", Integer·toString(bigInt));
    releaseRC(bigInt);

    bigInt = integerWithDigits(3, -1, 0, 0);
    printf("%s\n", Integer·toString(bigInt));
    releaseRC(bigInt);

    bigInt = integerWithDigits(0);
    printf("%s\n", Integer·toString(bigInt));
    releaseRC(bigInt);
}
