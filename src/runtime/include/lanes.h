#ifndef CLAWR_LANES_H
#define CLAWR_LANES_H

#include "clawr_string.h"
#include <stdint.h>

typedef unsigned long long BinaryLaneField;

String* binarylane__toStringRC(BinaryLaneField value, uint32_t length);
String* ternarylane__toStringRC(BinaryLaneField x0, BinaryLaneField x1, uint32_t length);

#endif // CLAWR_LANES_H
