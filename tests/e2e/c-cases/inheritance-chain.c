#include "runtime.h"
#include <stdio.h>

// ```clawr
// object Shape {
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

// Clawr: `inheritance: func new(height: integer @range(0..20)`
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
//     func area() => self.width * self.depth + self.offset()
//     virtual func offset() => 0
// data:
//     width: integer
//     depth: integer
// }
// ```
typedef struct RectBlock {
    Prism super;
    int width;
    int depth;
} RectBlock;
typedef struct RectBlockˇvtable {
    int (*area)(void* self);
    int (*offset)(void* self);
} RectBlockˇvtable;

// Clqwr: `virtual func offset() => 0`
int RectBlock·offset(void* self) { return 0; }

// Clawr: `func area() => self.width * self.depth`
int RectBlock·area(void* self) {
    // Clawr: `const offset = self.offset()`
    int offset = VTABLE(self, RectBlock)->offset(self);

    // Clawr: `return self.width * self.depth + offset`
    RectBlock* const rect = (RectBlock*) self;
    return (rect)->width * rect->depth + offset;
}

static __type_info RectBlockˇtype = {
    .polymorphic_type = {
        .data = { .size = sizeof(RectBlock) },
        .super = &Prismˇtype.polymorphic_type,
        .vtable = &(RectBlockˇvtable) {
            .area = RectBlock·area,
            .offset = RectBlock·offset,
        },
    }
};

// Clawr: `func new(width: integer, depth: integer, height: integer) -> RectBlock`
void RectBlock˛new_width_depth_height(RectBlock *self, int width, int depth, int height) {
    // Clawr: `const self = RectBlock { Prism.new(height: height), width, depth }`
    self->width = width;
    self->depth = depth;
    Prism˛new_height((Prism*)self, height);
}

// ```clawr
// object SquareBlock: Prism {
//     func area() => self.width * self.depth
// data:
//     width: integer
//     depth: integer
// }
// ```
typedef struct SquareBlock {
    RectBlock super;
} SquareBlock;

// Clawr: `func offset() => 1`
int SquareBlock·offset(void* self) {
    return 1;
}

static __type_info SquareBlockˇtype = {
    .polymorphic_type = {
        .data = { .size = sizeof(SquareBlock) },
        .super = &RectBlockˇtype.polymorphic_type,
        .vtable = &(RectBlockˇvtable) {
            .area = RectBlock·area,
            .offset = SquareBlock·offset,
        },
    }
};


// Clawr: `func new(side: integer, height: integer) -> SquareBlock`
SquareBlock* SquareBlock¸new_side_height(int side, int height) {
    // Clawr `const self = SquareBlock { RectBlock.new(width: side, depth: side, height: height) }`
    SquareBlock* self = allocRC(SquareBlock, __rc_ISOLATED);
    RectBlock˛new_width_depth_height((RectBlock*)self, side, side, height);
    return self;
}

int main() {
    // Clawr: `const x = RectBlock.new(side: 3, height: 5)`
    SquareBlock *x = SquareBlock¸new_side_height(3, 5);

    printf("%d\n", VTABLE(x, Prism)->area(x));
    printf("%d\n", Prism·volume((Prism*) x));
}
