#include "array.h"

const __type_info Arrayˇtype = {
    .data_type = { .size = sizeof(Array) }
};

Array Array¸empty = {
    .count = 0,
    .header = {
        .allocation_size = sizeof(Array),
        .is_a = &Arrayˇtype,
        .refs = 1 & __rc_ISOLATED,
    }
};

Array* Array¸new(size_t count, size_t elem_size) {
    Array* array = _alloc_rc_structure(&Arrayˇtype, count * elem_size, __rc_ISOLATED);

    array->count = count;
    array->elem_size = elem_size;
    memset(array->elements, 0, count * elem_size);

    return array;
}
