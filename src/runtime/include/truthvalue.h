#ifndef CLAWR_TRUTHVALUE_H
#define CLAWR_TRUTHVALUE_H

int adjust__towards(int value, int towards);
int rotate__by(int value, int by);
int modulate__by(int value, int by);
const char* truthvalue·toCString(int value);

#endif // CLAWR_TRUTHVALUE_H
