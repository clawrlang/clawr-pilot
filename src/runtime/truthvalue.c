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

int adjust(int value, int toward) {
    return adjust_impl(value, toward);
}

int adjust__towards(int value, int towards) {
    return adjust_impl(value, towards);
}

int rotate(int value, int by) {
    return rotate_impl(value, by);
}

int rotate__by(int value, int by) {
    return rotate_impl(value, by);
}

int TruthValue·adjust(int self, int toward) {
    return adjust_impl(self, toward);
}

int TruthValue·adjust__towards(int self, int towards) {
    return adjust_impl(self, towards);
}

int TruthValue·rotate(int self, int by) {
    return rotate_impl(self, by);
}

int TruthValue·rotate__by(int self, int by) {
    return rotate_impl(self, by);
}

int TruthValue·rotateUp(int self) {
    return rotate_impl(self, 2);
}

int TruthValue·rotateDown(int self) {
    return rotate_impl(self, 0);
}
