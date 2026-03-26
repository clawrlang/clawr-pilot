#include "data_structure.h"
#include <stdio.h>

int main() {
    // Clawr: `mut original = DataStructure { x: 47, y: 42 }`
    DataStructure* original = allocRC(DataStructure, __rc_ISOLATED);
    original->x = 47;
    original->y = 42;

    // Clawr: `const isolated = original`
    DataStructure* isolated = retainRC(original);

    // Clawr: `original.x = 2`
    mutateRC(original);
    original->x = 2;

    printf("modified: %d, %d\n", original->x, original->y);
    printf("isolated: %d, %d\n", isolated->x, isolated->y);

    releaseRC(original);
    releaseRC(isolated);
}
