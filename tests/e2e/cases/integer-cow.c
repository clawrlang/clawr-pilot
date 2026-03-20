#include "integer-va.h"
#include <stdio.h>

int main() {
    Integer* mutable;
    Integer* immutable;

    mutable = integerWithDigits(2, 1, 0);
    immutable = retainRC(mutable);
    mutateRC(mutable);
    Integer·toggleSign(mutable);
    printDigits(immutable);

    mutable = integerWithDigits(2, 1, 0);
    immutable = retainRC(mutable);
    mutateRC(mutable);
    Integer·divide(mutable, 2);
    printDigits(immutable);

    releaseRC(mutable);
    releaseRC(immutable);

    mutable = integerWithDigits(2, 1, 0);
    immutable = retainRC(mutable);
    mutateRC(mutable);
    Integer·increment(mutable, immutable);
    printDigits(immutable);

    releaseRC(mutable);
    releaseRC(immutable);

    mutable = integerWithDigits(2, 1, 0);
    immutable = retainRC(mutable);
    mutateRC(mutable);
    Integer·decrement(mutable, immutable);
    printDigits(immutable);

    releaseRC(mutable);
    releaseRC(immutable);
}
