#include "runtime.h"
#include <stdarg.h>

Integer* integerWithDigits(const size_t count, ...) {
    Array* digits = Array¸new(count, sizeof(digit_t));

    va_list ap;
    va_start(ap, count);
    for (size_t i = 0; i < count; i++)
        ARRAY_ELEMENT_AT(i, digits, digit_t) = va_arg(ap, digit_t);
    va_end(ap);

    Integer* integer = Integer¸withDigits(digits);
    releaseRC(digits);
    return integer;
}
