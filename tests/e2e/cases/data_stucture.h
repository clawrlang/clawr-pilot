#include "runtime.h"

// ```clawr
// data DataStructure {
//     value: integer @range(0..255)
// }
// ```
typedef struct DataStructure {
    __rc_header header;
    u_int8_t x;
    u_int8_t y;
} DataStructure;
static const __type_info DataStructureˇtype = {
    .data_type = { .size = sizeof(DataStructure) }
};
