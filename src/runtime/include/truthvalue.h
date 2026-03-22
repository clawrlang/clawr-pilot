#ifndef CLAWR_TRUTHVALUE_H
#define CLAWR_TRUTHVALUE_H

int adjust(int value, int toward);
int adjust__towards(int value, int towards);

int rotate(int value, int by);
int rotate__by(int value, int by);

int TruthValue·adjust(int self, int toward);
int TruthValue·adjust__towards(int self, int towards);

int TruthValue·rotate(int self, int by);
int TruthValue·rotate__by(int self, int by);
int TruthValue·rotateUp(int self);
int TruthValue·rotateDown(int self);

#endif // CLAWR_TRUTHVALUE_H
