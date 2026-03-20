#include "runtime.h"
#include <stdio.h>

// ```clawr
// object Prism {
//     abstract func area() -> integer
//     func volume() -> integer
// inheritance:
//     func new(height: integer @range(0..20))
// data:
//     height: integer
// }
// ```
typedef struct Prism {
    __rc_header header;
    int height;
} Prism;
static const __type_info Prismˇtype = {
    .polymorphic_type = {
        .data = { .size = sizeof(Prism) },
        .super = NULL,
    }
};
typedef struct Prismˇvtable {
    int (*area)(void* self);
} Prismˇvtable;

// Clawr: `inheritance: func new(height: integer @range(0..20))`
void Prism˛new_height(Prism* self, int height) {
    // Clawr: `self = { height }`
    self->height = height;
}

// Clawr: `func volume() -> integer`
int Prism·volume(Prism* self) {
    return VTABLE(self, Prism)->area(self) * self->height;
}

// ```clawr
// object RectBlock: Prism {
//     func area() => self.width * self.depth
// data:
//     width: integer
//     depth: integer
// }
// ```
int RectBlock·area(void* self);
typedef struct RectBlock {
    Prism super;
    int width;
    int depth;
} RectBlock;
static __type_info RectBlockˇtype = {
    .polymorphic_type = {
        .data = { .size = sizeof(RectBlock) },
        .super = &Prismˇtype.polymorphic_type,
        .vtable = &(Prismˇvtable) {
            .area = RectBlock·area,
        },
    }
};

// Clawr: `func area() => self.width * self.depth`
int RectBlock·area(void* self) {
    RectBlock* rect = (RectBlock*) self;
    return rect->width * rect->depth;
}


// Clawr: `func new(width: integer, depth: integer, height: integer) -> RectBlock`
RectBlock* RectBlock¸new_width_depth_height(int width, int depth, int height) {
    // Clawr: `const self = RectBlock { Prism.new(height: height), width, depth }`
    RectBlock* self = allocRC(RectBlock, __rc_ISOLATED);
    self->width = width;
    self->depth = depth;
    Prism˛new_height((Prism*)self, height);
    return self;
}

int main() {
    // Clawr: `const x = RectBlock.new(width: 3, depth: 4, height: 5)`
    RectBlock *x = RectBlock¸new_width_depth_height(3, 4, 5);

    printf("%d\n", VTABLE(x, Prism)->area(x));
    printf("%d\n", Prism·volume((Prism*) x));
}
