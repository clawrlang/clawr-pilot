# Data-streams and Operations

## V1 Spec

### 1. Conceptual Layers

1. Stream: transport over time at I/O boundaries.
2. Field: fixed-size lane container for whole-value operations.
3. Lane: the atomic logical value (`bit` or `trit`).

No first-class chunk type in v1.

### 2. Core Types

1. `bitfield[N]`: N binary lanes (`false | true`).
2. `tritfield[N]`: N ternary lanes (`false | ambiguous | true`).

`N` is a compile-time constant positive integer.

### 3. Type Relations

1. `bitfield[N]` can widen to `tritfield[N]`.
2. `tritfield[N]` to `bitfield[N]` is explicit and checked.
3. Conversions require same length unless an explicit reshape API is used.

### 4. Operators

Primary lane operators for both field types:

1. `~` lane-wise negation.
2. `&` lane-wise conjunction.
3. `|` lane-wise disjunction.
4. `==` reductive equality producing one `boolean` (`true` only when the whole field is exactly equal).
5. `!=` reductive inequality producing one `boolean`.

Additional operators:

1. `bitfield`: `^`
2. `tritfield`: `rotate(x, by: y)` and `adjust(x, towards: y)`.
3. `tritfield`: aliases `rotateUp`, `rotateDown`, `adjustUp`, `adjustDown`.
4. `tritfield`: `modulate(x, by: m)` where each lane of `m` applies one of three actions: keep, flip, or clear-to-ambiguous.

No arithmetic operators on either field type.

#### Selectors vs Modulators

`bitfield` is the canonical selector-mask type in V1.

1. Selector masks are binary and answer one question per lane: include or exclude.
2. Excluded lanes become `false` when masking `bitfield`.
3. Excluded lanes become `ambiguous` when masking `tritfield`.

`tritfield` can also act as a modulation control field (not a selector mask) via `modulate(by:)`.

1. `true` lane in the modulator keeps the source lane.
2. `false` lane in the modulator flips the source lane.
3. `ambiguous` lane in the modulator clears the source lane to `ambiguous`.

This keeps ordinary masking simple and predictable, while still supporting ternary signed-gating behavior when explicitly requested.

> [!note]
> Clawr does not presume the runtime/hardware implementation, but if you imagine truth values as balanced ternary (false = -1, ambiguous = 0, true = +1), the operators function as arithmetics-inspired gates:
>
> - `adjust(a, by: b)` is clamped ADD
> - `adjust(a, by: !b)` is clamped SUB
> - `rotate(a, by: b)` is GF(3) ADD
> - `rotate(a, by: !b)` is GF(3) SUB
> - `modulate(a, by: b)` is MUL

### 5. Length Rules

1. Binary/ternary lane operators require equal lengths.
2. No broadcasting in v1.
3. Mismatched lengths are compile-time errors when known, runtime errors otherwise.

### 6. Indexing and Slicing

1. `field[i]` returns one lane (`boolean` for bitfield, `truthvalue` for tritfield).
2. `field[a..<b]` returns same field family with length `b-a`.
3. Concatenation is supported: `concat(a, b)`.

### 7. Construction

1. Literal or constructor from lane text.
2. Constructor from lane arrays.
3. Conversion constructors between field families.

Suggested textual alphabets:

1. bitfield: `0/1`.
2. tritfield: `0/?/1` (clear and compact).

### 8. I/O Model

Streams exist only as interfaces, not primary compute values:

1. `readBits(n) -> bitfield[n]`
2. `readTrits(n) -> tritfield[n]`
3. `writeBits(bitfield[n])`
4. `writeTrits(tritfield[n])`

File, socket, and device APIs are stream-oriented.
Transforms and crypto primitives are field-oriented.

#### Canonical Ternary Interchange

Clawr-level `tritfield` lanes are canonical truth-values (`false`, `ambiguous`, `true`) independent of physical encoding.

1. Conversion to/from external ternary data must use an explicit encoding profile.
2. No implicit assumptions are made about balanced vs positive source ternary.
3. Profile metadata should travel with payloads where possible.

Recommended baseline profiles:

1. `ternary-balanced`: `-1 -> false`, `0 -> ambiguous`, `+1 -> true`.
2. `ternary-positive`: `0 -> false`, `1 -> ambiguous`, `2 -> true`.

For data that is semantically numeric (for example, external ternary integers), conversion is two-step:

1. Decode source digits according to the declared source numeric profile.
2. Map resulting digit values into canonical `tritfield` lanes via an explicit lane-mapping profile.

This keeps field semantics stable even when external architectures use different ternary conventions.

### 9. Runtime Requirements

1. `bitfield`: packed binary representation.
2. `tritfield`: canonical two-plane representation.
3. Canonical ternary invariant must be preserved after every operation.
4. Runtime may choose internal chunk width automatically.

### 10. Diagnostics

Required error classes:

1. Unsupported arithmetic on field types.
2. Length mismatch for lane operators.
3. Invalid narrowing from tritfield to bitfield due to ambiguous lanes.
4. Unsupported operator for field family.

### 11. Security/Crypto Guidance

1. Keep lane operators deterministic and side-effect free.
2. Keep key expansion separate from lane combination.
3. Never imply repeating-key behaviour as a default.
4. Provide explicit keystream APIs at library level.

### 12. Minimum Standard Library Surface

1. `length`
2. `slice`
3. `concat`
4. `repeat`
5. `reverse`
6. `countTrue` and `countAmbiguous` (for tritfield)
7. `all` and `any`
8. conversions to and from byte/trit encodings

## V2 Extension Path (Optional)

1. Add chunk hints as optional performance annotations, not type identity.
2. Add stream buffering policies for protocol parsing.
3. Add broadcasting rules if needed.
4. Add hardware-accelerated profiles for target backends.
