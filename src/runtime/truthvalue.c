#include "truthvalue.h"

static int clamp_truthvalue(int value) {
    if (value < 0) return 0;
    if (value > 2) return 2;
    return value;
}

static int adjust_impl(int value, int towards) {
    return clamp_truthvalue(value + towards - 1);
}

static int rotate_impl(int value, int by) {
    return ((value + (by - 1) + 3) % 3);
}

int adjust__towards(int value, int towards) {
    return adjust_impl(value, towards);
}

int rotate__by(int value, int by) {
    return rotate_impl(value, by);
}

const char* truthvalue__toCString(int value) {
    int clamped = clamp_truthvalue(value);
    if (clamped == 0) return "false";
    if (clamped == 2) return "true";
    return "ambiguous";
}
