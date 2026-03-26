#include "truthvalue.h"
#include <stdio.h>

static void print_tv(const char* label, int value) {
    printf("%s: %s\n", label, truthvalue·toCString(value));
}

int main() {
    // rotate__by: rotate CW (by=true=2) and CCW (by=false=0)
    print_tv("rotate(false, by: true)",     rotate__by(0, 2));  // false→ambiguous
    print_tv("rotate(ambiguous, by: true)", rotate__by(1, 2));  // ambiguous→true
    print_tv("rotate(true, by: true)",      rotate__by(2, 2));  // true→false
    print_tv("rotate(false, by: false)",    rotate__by(0, 0));  // false→true
    print_tv("rotate(ambiguous, by: false)",rotate__by(1, 0));  // ambiguous→false
    print_tv("rotate(true, by: false)",     rotate__by(2, 0));  // true→ambiguous

    // adjust__towards
    print_tv("adjust(false, towards: true)",     adjust__towards(0, 2));  // ambiguous
    print_tv("adjust(true, towards: true)",      adjust__towards(2, 2));  // true
    print_tv("adjust(true, towards: false)",     adjust__towards(2, 0));  // ambiguous
    print_tv("adjust(ambiguous, towards: false)",adjust__towards(1, 0));  // false

    // modulate__by: balanced ternary MUL
    print_tv("modulate(false, by: false)",    modulate__by(0, 0));  // true  (-1*-1=1)
    print_tv("modulate(false, by: ambiguous)",modulate__by(0, 1));  // ambiguous
    print_tv("modulate(false, by: true)",     modulate__by(0, 2));  // false (-1*1=-1)
    print_tv("modulate(ambiguous, by: true)", modulate__by(1, 2));  // ambiguous
    print_tv("modulate(true, by: true)",      modulate__by(2, 2));  // true  (1*1=1)
    print_tv("modulate(true, by: false)",     modulate__by(2, 0));  // false (1*-1=-1)

    return 0;
}
