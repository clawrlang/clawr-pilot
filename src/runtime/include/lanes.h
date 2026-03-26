#ifndef CLAWR_LANES_H
#define CLAWR_LANES_H

#include "clawr_string.h"
#include <stdint.h>

String* binarylane__toStringRC(uint64_t value, uint32_t length);
String* ternarylane__toStringRC(uint64_t x0, uint64_t x1, uint32_t length);

#endif // CLAWR_LANES_H
