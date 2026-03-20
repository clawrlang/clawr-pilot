#ifndef ARRAY_H
#define ARRAY_H

#include "refc.h"
#include <string.h>

typedef struct Array {
    __rc_header header;
    size_t count;
    size_t elem_size;
    unsigned char elements[];
} Array;
extern const __type_info Arrayˇtype;

/// @brief An array with zero elements
extern Array Array¸empty;

Array* Array¸new(size_t count, size_t elem_size);

#define ARRAY_ELEMENT_AT(index, array, type) \
    ((type*)((array)->elements))[index]

#endif // ARRAY_H
