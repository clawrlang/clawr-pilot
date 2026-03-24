# Variable Scope & Semantics

> What if you want the same type in different parts of your code, but sometimes you need it to be a `struct` and at other times a `class`?

This is the thought that sparked the need for a new programming language.

In the languages I know, such a need would require duplicating code—which violates DRY—or wrapping one type inside another—a `class` that contains a `struct`—which is awkward.

In Clawr, I want to be able to define a type once and then specify its "kind" (i.e., `struct`-like vs `class`-like) based on the context in which it is used. This would allow for more flexible and reusable code without duplication.

## The Problem: Shared Mutable State

“What is the difference between a `struct` and a `class`,” I hear you ask? Well, in programming, there is a big problem called _shared mutable state_.

Shared mutable state occurs when multiple parts of a program can access and modify the same data. This can lead to unexpected behaviour and bugs, it makes reasoning about code more difficult, and it adds complex synchronisation requirements in parallel execution.

It is caused by assigning one variable to another (`x = y`). Here are some concrete situations that can lead to shared mutable state:

- A variable is assigned to a field of an object or data structure
- A variable is passed as an argument to a function
- A field is returned from a function
- Multiple threads are started with access to the same variable
- A variable is captured in a closure
- A variable is stored in a global context
- A variable is stored in a collection that is shared across different parts of the program
- etc

### How Languages Address This

Different programming languages take different approaches:

- **Functional languages** (Haskell, Clojure): Disallow mutation altogether
- **Modern system languages** (Rust): Use ownership and borrowing systems
- **Hybrid languages** (C#, Swift): Introduce types with isolated mutation
  - `struct`: Value semantics (copied, isolated)
  - `class`: Reference semantics (shared, mutable state)

The problem with the hybrid approach: **You must decide at type definition whether it will be a struct or class**, limiting reusability.

The problem with ownership and borrowing is that it can be confusing. While Rust's ownership system prevents entire classes of bugs, it comes at a cost: programmers must explicitly manage lifetimes and borrowing relationships through complex syntax. This shifts cognitive effort from domain problems to memory management details, making the code's intent less immediately clear.

## Clawr’s Paradigm

Here is a proposal for Clawr. Instead of defining semantics per type, let’s make each variable individually declare its isolation level.

Rust uses ownership and borrowing to manage memory safety. While this is powerful, it requires explicit lifetime annotations that add syntactic overhead. With the proposed strategy, we can provide similar safety guarantees with clearer, more readable code.

## V1 Normative Spec

This section defines the implementation-facing rules for variable semantics in Clawr V1. If examples or exploratory notes elsewhere in this document disagree with this section, this section takes precedence.

### Core Model

Clawr has three source-level variable semantics:

- `const`: immutable, isolated
- `mut`: mutable, isolated
- `ref`: mutable, shared

The runtime has two memory semantics:

- `ISOLATED`
- `SHARED`

In addition, function returns may temporarily carry a uniquely referenced value before assignment. A uniquely referenced value is an `ISOLATED` allocation with a reference count of exactly one. It is not yet committed to either isolated or shared variable usage until the receiver assigns it.

### Assignment Rules

Assignments must not cross semantic models implicitly.

- `const` and `mut` variables require `ISOLATED` memory
- `ref` variables require `SHARED` memory
- Assigning `const`/`mut` to `const`/`mut` is allowed
- Assigning `ref` to `ref` is allowed
- Assigning `ref` to `const` or `mut` is a compile-time error unless an explicit copy is requested
- Assigning `const` or `mut` to `ref` is a compile-time error unless an explicit copy is requested
- Assigning a uniquely referenced return value to `const` or `mut` commits it to `ISOLATED`
- Assigning a uniquely referenced return value to `ref` commits it to `SHARED`

### Copy and Copy-on-Write

`copy()` and copy-on-write solve different problems and must remain distinct.

- `copy()` is an explicit semantic conversion boundary
- `copy()` always returns a uniquely referenced allocation
- The receiver determines the semantics of the copied value at assignment time
- `copy()` may be used even when the source and destination semantics are the same
- `mutateRC()` never changes semantics
- `mutateRC()` only preserves the isolated contract by ensuring uniqueness before mutation when an `ISOLATED` allocation has multiple references
- `SHARED` memory must never be implicitly converted to `ISOLATED` by copy-on-write

### Parameter Modes

Parameters have four modes:

- default (`in`): read-only, accepts `const`, `mut`, or `ref`
- `const`: read-only isolated access, accepts `const`, `mut`, or unassigned unique values, but not `ref`
- `mut`: mutable isolated access, accepts `const`, `mut`, or unassigned unique values, but not `ref`
- `ref`: shared mutable access, accepts `ref` only

Additional rules:

- Passing between these models must not trigger implicit copies
- Passing a `ref` argument to a `const` or `mut` parameter is a compile-time error
- Passing an isolated value to a `ref` parameter is a compile-time error
- The default parameter mode is intentionally permissive and is not concurrency-safe against external shared mutation

### Return Modes

Clawr V1 uses three return categories:

- `-> T`: returns a uniquely referenced value
- `-> const T`: returns `ISOLATED` memory whose uniqueness is not guaranteed
- `-> ref T`: returns `SHARED` memory

Additional rules:

- A uniquely referenced return value is moved to the receiver
- The receiver must not retain it again on assignment
- If a uniquely referenced return value is discarded, forwarded, or used as a temporary, the generated code must preserve move semantics and release it exactly once when appropriate
- A function may only return `-> ref T` when the returned memory is already `SHARED`
- If uniqueness cannot be trivially proven in V1, the compiler should conservatively normalize before returning instead of attempting deeper proof

### V1 Conservatism

Clawr V1 should prefer obvious correctness over aggressive optimization.

- Fresh allocations may be returned as unique directly
- Already-unique locals may be returned as unique directly when trivial to prove
- Non-trivially unique isolated values should be normalized conservatively before `-> T` return
- Advanced uniqueness proofs are out of scope for V1

### Runtime Responsibilities

- `retainRC()` increments references without changing semantics
- `releaseRC()` decrements references and deallocates at zero
- `mutateRC()` performs copy-on-write for `ISOLATED` memory when needed
- `copy()` creates a new uniquely referenced allocation
- The runtime must preserve the `ISOLATED`/`SHARED` flag on existing allocations unless an explicit copy creates a new allocation for a different receiver context

### Compiler Implementation Checklist (V1)

Use this checklist when implementing semantics in parser, semantic analysis, and codegen.

1. Parse and AST

- Keep variable semantics as exactly `const`, `mut`, `ref`.
- Parse parameter modes as `in` (implicit default), `const`, `mut`, `ref`.
- Parse return categories as `-> T`, `-> const T`, `-> ref T`.

2. Type Families and Eligibility

- Mark which types are reference-counted entities (`data`, `object`, `service`).
- Reject `ref` declarations for non-entity families.

3. Assignment Checking

- Allow isolated-to-isolated (`const`/`mut` to `const`/`mut`).
- Allow shared-to-shared (`ref` to `ref`).
- Reject isolated-to-shared and shared-to-isolated unless explicit `copy()` appears.
- Treat assignment from `-> T` as commit to receiver semantics.

4. Parameter Checking

- `in`: accept all three variable semantics, read-only body access.
- `const`: accept isolated values only, read-only body access.
- `mut`: accept isolated values only, mutable body access with CoW.
- `ref`: accept shared values only, mutable shared access.
- Never insert implicit semantic-conversion copies at call sites.

5. Return Checking

- `-> ref T`: only allow returning shared memory.
- `-> const T`: only allow returning isolated memory.
- `-> T`: require unique return transport; if proof is non-trivial in V1, conservatively normalize.
- Note: `-> const T` might be redundant and replaceable with `-> T` in all cases.

6. Mutation Lowering

- For isolated mutation sites, call `mutateRC()` before in-place mutation.
- For shared mutation sites, never call `mutateRC()` to force isolation.
- Note: Calling `mutateRC()` is not harmful. Pruning calls can be viewed as a form of optimisation.

7. Temporary Ownership

- Model `-> T` as move-style transport for temporaries.
- Ensure each temporary unique value is released exactly once if not stored.

8. Diagnostics

- Provide semantic mismatch errors that explicitly name source and target semantics.
- For conversion requirements, suggest explicit `copy()` in diagnostics.

9. Testing

- Add matrix tests for assignment and parameter compatibility.
- Add return tests for all three categories (`-> T`, `-> const T`, `-> ref T`).
- Add temporary-expression tests (`consume(factory())`, chained calls, discarded returns) for leaks/double-release behavior.

### Semantic Analyzer Rule Sketch (V1)

This sketch is intentionally conservative and maps directly to checker logic.

1. Each expression should carry two pieces of information in analysis:

- Value/type domain information.
- Memory semantics class: `isolated`, `shared`, or `unique-return`.

2. For variable reads:

- `const` and `mut` bindings evaluate as `isolated`.
- `ref` bindings evaluate as `shared`.

3. For calls:

- Validate each argument against parameter mode compatibility.
- If parameter is `mut`, mark body-local binding mutable and isolated.

4. For assignment:

- Check compatibility from expression semantics class to receiver semantics.
- Allow `unique-return` to commit to either isolated or shared depending on receiver.

5. For `copy()`:

- Always emit expression semantics class as `unique-return`.

6. For returns:

- `-> ref T`: require returned expression class `shared`.
- `-> const T`: require returned expression class `isolated`.
- `-> T`: require `unique-return`; if expression class is only `isolated` and non-trivially unique, require conservative normalization before codegen.

7. For mutation expressions:

- Permit only through mutable bindings (`mut` or `ref`, plus mutable parameter rules).
- Attach mutation strategy tag for codegen: `isolated-cow` or `shared-in-place`.

### Surface Syntax Recommendation for Copy

Use both forms, with distinct purpose:

- Keep explicit `.copy()` as the canonical semantic-conversion operation for all entity families (`data`, `object`, `service`).
- Support spread (`{ ...x }`, `[...x]`) as sugar for data/array structural copy only.

Rationale:

- `.copy()` works uniformly for all entity families, including encapsulated `object` values.
- Spread is ergonomic for data literals and aligns with existing developer intuition.
- Keeping `.copy()` canonical avoids ambiguity in parameter/assignment diagnostics and keeps conversion intent obvious.

### Implementation Tickets (V1)

This section turns the V1 spec into concrete implementation tickets, grouped by subsystem and ordered by dependency.

#### Parser and AST

0. `SEM-PARSE-000` Function and method declaration parsing foundation
  - Scope: Implement parser and AST support for function declarations and/or method declarations as a prerequisite for parameter and return semantics parsing.
  - Targets: `src/parser/index.ts`, `src/ast/index.ts`.
  - Acceptance criteria:
    - Parser recognizes function declarations.
    - Parser recognizes method declarations, or documents method parsing as an explicitly deferred follow-up.
    - AST nodes exist for parsed function/method declarations with parameter and return slots ready for semantics extensions.

1. `SEM-PARSE-001` Variable semantics syntax stabilization
   - Scope: Ensure variable declarations are parsed with semantics exactly `const | mut | ref`.
   - Targets: `src/parser/index.ts`, `src/ast/index.ts`.
   - Acceptance criteria:
     - Parser accepts all three semantics in declarations.
     - AST carries semantics without fallback aliases.
     - Parser rejects unknown semantics keywords with clear diagnostics.

2. `SEM-PARSE-002` Parameter mode parsing
   - Scope: Parse function parameters with implicit `in` and explicit `in|const|mut|ref` modes.
   - Prerequisite: `SEM-PARSE-000`.
   - Targets: `src/parser/index.ts`, `src/ast/index.ts`.
   - Acceptance criteria:
     - `SEM-PARSE-000` is completed before parameter-mode parsing is enabled.
     - Omitted mode is represented as `in` in AST.
     - Explicit `in`, `const`, `mut`, `ref` parse correctly.
     - Ambiguous parameter syntax is rejected deterministically.

3. `SEM-PARSE-003` Return mode parsing
   - Scope: Parse and represent return categories: `-> T`, `-> const T`, `-> ref T`.
   - Targets: `src/parser/index.ts`, `src/ast/index.ts`.
   - Acceptance criteria:
     - AST distinguishes unique-return (`-> T`) from fixed-semantics returns.
     - `-> const T` and `-> ref T` are preserved through AST.
     - Invalid return semantic modifiers produce diagnostics.

#### Semantic Analysis

4. `SEM-ANALYZE-001` Entity-family eligibility for `ref`
   - Scope: Permit `ref` only for `data|object|service` families.
   - Targets: `src/semantics/analyze.ts`, `src/semantics/index.ts`.
   - Acceptance criteria:
     - `ref` binding of non-entity values is rejected.
     - Diagnostic explicitly names allowed families.
     - Existing scalar value-set analysis remains unchanged.

4b. `SEM-ANALYZE-001B` Service family semantics restriction
   - Scope: Enforce the converse rule for `service`: service values are only valid with `ref` semantics.
   - Targets: `src/semantics/analyze.ts`, `src/semantics/index.ts`.
   - Acceptance criteria:
     - Binding a `service` value to `const` or `mut` is rejected.
     - Binding a `service` value to `ref` is accepted.
     - Diagnostic explicitly states that `service` requires `ref` semantics.

5. `SEM-ANALYZE-002` Expression semantics-class tracking
   - Scope: Add checker-level tracking for `isolated | shared | unique-return` alongside value-set inference.
   - Targets: `src/semantics/analyze.ts`.
   - Acceptance criteria:
     - Variable reads map to `isolated` (`const|mut`) and `shared` (`ref`).
     - `copy()` expressions map to `unique-return`.
     - Assignment logic can read semantics class and value-set simultaneously.

6. `SEM-ANALYZE-003` Assignment compatibility matrix
   - Scope: Enforce semantic model compatibility for all assignments.
   - Targets: `src/semantics/analyze.ts`.
   - Acceptance criteria:
     - isolated->isolated and shared->shared allowed.
     - isolated<->shared rejected unless explicit `copy()` at expression level.
     - `unique-return` commits to receiver semantics (`const|mut` => isolated, `ref` => shared).

7. `SEM-ANALYZE-004` Parameter compatibility matrix
   - Scope: Enforce call-site compatibility for `in|const|mut|ref` parameters.
   - Targets: `src/semantics/analyze.ts`.
   - Acceptance criteria:
     - `in` accepts all three binding semantics.
     - `const|mut` reject shared arguments.
     - `ref` rejects isolated arguments.
     - No implicit semantic-conversion copy is inserted by analyzer.

8. `SEM-ANALYZE-005` Return mode checking
   - Scope: Validate return expressions against `-> T | -> const T | -> ref T`.
   - Targets: `src/semantics/analyze.ts`.
   - Acceptance criteria:
     - `-> ref T` requires `shared` expression class.
     - `-> const T` requires `isolated` expression class.
     - `-> T` requires `unique-return` or marks return as requiring conservative normalization.

#### Codegen and Runtime Integration

9. `SEM-CODEGEN-001` Mutation strategy tagging and lowering
   - Scope: Lower mutations with explicit strategy: `isolated-cow` or `shared-in-place`.
   - Targets: `src/codegen/index.ts`, `src/codegen/lowering-types.ts`.
   - Acceptance criteria:
     - Isolated mutations emit `mutateRC(var)` before mutation.
  - Shared mutations may emit `mutateRC(var)` without semantic harm; eliding such calls is an optimization, not a correctness requirement.
     - Existing scalar/runtime lowering behavior remains intact.

10. `SEM-CODEGEN-002` Unique-return transport in expressions
    - Scope: Encode move-style transport for `-> T` temporaries.
    - Targets: `src/codegen/index.ts`.
    - Acceptance criteria:
      - Assignment from unique-return does not retain.
      - Discarded unique-return values are released exactly once.
      - Forwarded temporaries preserve single-owner transfer semantics.

11. `SEM-CODEGEN-003` Conservative return normalization path
    - Scope: Add conservative normalization for uncertain `-> T` returns in V1.
    - Targets: `src/codegen/index.ts`, `src/runtime/refc.c`, `src/runtime/include/refc.h`.
    - Acceptance criteria:
      - Non-trivially unique isolated return paths are normalized before returning.
      - Normalization preserves semantics rules and does not silently convert shared to isolated.
      - Generated C compiles and passes runtime tests.

12. `SEM-RUNTIME-001` Canonical explicit-copy primitive
    - Scope: Ensure runtime has a canonical helper path for explicit semantic conversion copy.
    - Targets: `src/runtime/refc.c`, `src/runtime/include/refc.h`, `src/codegen/index.ts`.
    - Acceptance criteria:
      - Codegen can emit explicit copy operation for cross-semantics assignment.
      - Resulting allocation is uniquely referenced.
      - Nested retained fields are handled correctly via type metadata hooks.

#### Test Plan Tickets

13. `SEM-TEST-001` Semantic compatibility matrix tests
    - Scope: Add unit tests for assignment and parameter compatibility combinations.
    - Targets: `tests/unit/**/*.test.ts` (primarily semantics tests).
    - Acceptance criteria:
      - Full matrix coverage for source semantics vs destination semantics.
      - Diagnostics assert explicit-copy requirement wording.

14. `SEM-TEST-002` Return semantics tests
    - Scope: Add unit tests for `-> T`, `-> const T`, `-> ref T` behavior.
    - Targets: `tests/unit/**/*.test.ts`.
    - Acceptance criteria:
      - Positive and negative coverage for each return category.
      - Non-trivial `-> T` paths verify conservative behavior.

15. `SEM-TEST-003` E2E ownership and temporary tests
    - Scope: Add end-to-end tests for temporary forwarding, chaining, and discarded unique returns.
    - Targets: `tests/e2e/**/*.test.ts`, `tests/e2e/cases/*`.
    - Acceptance criteria:
      - No leaks or double-release behavior in tested flows.
      - Chained expressions preserve move semantics.
      - Runtime behavior matches semantic contracts for isolated vs shared mutation.

#### Execution Order

Recommended dependency order for implementation:

1. `SEM-PARSE-000..003`
2. `SEM-ANALYZE-001`, `SEM-ANALYZE-001B`, `SEM-ANALYZE-002..005`
3. `SEM-CODEGEN-001..003`
4. `SEM-RUNTIME-001`
5. `SEM-TEST-001..003`

#### Definition of Done (V1)

V1 is done when:

- Parser/AST can represent all declared semantics modes.
- Analyzer enforces assignment, parameter, and return compatibility without implicit conversions.
- Codegen and runtime preserve separation between explicit `copy()` and CoW via `mutateRC()`.
- Unique-return temporary ownership is handled without leaks or double-free behavior in e2e tests.

| Keyword | Mutability | Semantics              | Use Case             |
| ------- | ---------- | ---------------------- | -------------------- |
| `const` | Immutable  | Isolated/Copy on Write | Constants, pure data |
| `mut`   | Mutable    | Isolated/Copy on Write | Isolated mutation    |
| `ref`   | Mutable    | Shared Reference       | Shared state         |

Mental Model:

- `const` variable: A constant value (even if structurally complex)
- `mut` variable: A container for data. The data can be copied to another container, but the containers remain independent.
- `ref` variable: A pointer to an entity. Multiple variables can reference and modify the same entity.

> [!note]
> We might want to consider additional keywords. For example, we might want to disallow structural mutation on `ref` variables (i.e., only allow calling mutating methods, but not changing fields directly). This would enforce better encapsulation. (Though an explicit `copy()` into an isolated variable might be sufficient in that case.)

With this approach, types can be defined without inherent semantics.

Let's explore an example to see why this flexibility is powerful. Consider a bowling game score calculator that needs to track rolls:

```clawr
type RollResult = integer @range(0..<10)

object BowlingGame {

    score() -> integer {
        // Calculate total score
        // See the Bowling Game Kata (http://www.butunclebob.com/ArticleS.UncleBob.TheBowlingGameKata) for an example algorithm.
    }

mutating:
    func roll(droppingPins count: RollResult) {
        rolls.append(count)
    }

data:
    rolls: [integer RollResult]
}
```

> [!note]
> This `BowlingGame` type is defined as an `object`, meaning it hides its data structure behind an encapsulation. This will be discussed in a [different document](../types/object-data.md).

Now, when using `BowlingGame`, we can choose the appropriate semantics based on our needs:

### Copy Semantics with `mut`

When using `mut` variables, changes are isolated:

```clawr
mut game1 = BowlingGame()
game1.roll(droppingPins: 9)
print(game1.score) // 9

mut game2 = game1                    // Shares memory (temporarily)
game2.roll(droppingPins: 1)          // Triggers copy-on-write
print(game1.score) // 9  ← unchanged
print(game2.score) // 10 ← includes second roll
```

### What happened?

1. `game1` and `game2` initially reference the same memory
2. When `game2.roll()` is called (a mutating method), the runtime detects multiple references
3. A copy is made before modification, ensuring `game1` remains unchanged
4. Each variable now has its own independent game state

### Reference Semantics with `ref`

When using `ref` variables, changes are shared:

```clawr
ref game1 = BowlingGame()
game1.roll(droppingPins: 9)
print(game1.score) // 9

ref game2 = game1                    // Shares the same game
game2.roll(droppingPins: 1)          // Modifies shared state
print(game1.score) // 10 ← changed!
print(game2.score) // 10 ← same game
```

### What happened?

1. Both variables reference the same game entity
2. Modifications through either variable affect the shared state
3. No copying occurs—this is true reference semantics

### When to Use Each

```clawr
// Local calculations - use mut for isolation
mut tempScore = game.calculateFrame(3)
tempScore.adjust(bonus: 10)  // Only affects tempScore

// Shared game state - use ref for coordination
ref activeGame = gameManager.currentGame
player1Thread.update(activeGame)
player2Thread.update(activeGame)  // Single game instance

// Immutable snapshots - use const for safety
const finalScore = game.score
archiveToDatabase(finalScore)  // Safe to share
```

## Notes on Implementation

### Memory Structure

To enforce isolation semantics, the runtime will need to manage memory with metadata indicating whether a memory block is `ISOLATED` or `SHARED`.

- **Semantics flag**: `ISOLATED` (for `const`/`mut` variables) or `SHARED` (for `ref` variables)
- **Reference Counter**: To track how many variables reference each memory block
- **Type Information**: To enable polymorphic behaviour and method dispatch, and to support runtime type-checking if needed

### Copy-on-Write Optimisation

The implementation should use automatic reference counting (ARC) with copy-on-write:

1. No copying at assignment: When x = y, both variables initially reference the same memory
2. Copy only when needed: A copy is made only when a mutating operation is about to be performed and…
   - Memory is flagged ISOLATED, AND
   - Reference count > 1
3. Never copy SHARED memory: This would violate the shared-state contract

This provides the safety of value semantics with the performance of reference semantics.

### Type Safety Rules

The compiler enforces the following rules:

- Cannot assign `ref` to `mut` or `const` without explicit copy:

  ```clawr
  ref r = BowlingGame()
  mut m = r              // Compile error
  mut m = r.copy()       // Explicit copy - OK
  ```

- Cannot assign `mut`/`const` to `ref` (would create isolated entity when shared expected):

  ```clawr
  mut m = BowlingGame()
  ref r = m              // Compile error
  ref r = m.copy()       // Explicit copy - OK
  ```

Different semantics cannot be mixed without explicit intent. There is no way to maintain two different sets of semantic guarantees for the same memory block. Therefore, a copy with different semantics must be created immediately at assignment. If this is done implicitly, it can lead to confusion and bugs.

### Function Parameters and Return Values

Function parameters and return values should also respect semantics:

- Parameters default to read-only `in` semantics, which can accept either isolated or shared values.
- Each function can specify whether it returns a unique value, `const`, or `ref` semantics.

Idea/exploration: What if parameters had their own semantics? They could be something like:

1. require immutable, isolated values; does not mutate or share state and reqiures that no other thread can change it while it’s working.
2. allow reference, but promise not to mutate: safe to pass isolated or `ref` variables without copying.
3. explicitly mutates received structure: requires `ref` variables; allows mutation of shared state.
4. temporarily borrows value for mutation: accepts `mut` or `ref` variables; might be dangerous to allow if the value can “escape.”
5. and other options?

## Proof of Concept

There is a [proof of concept repository](https://github.com/clawrlang/clawr-poc) that implements a compiler and runtime for Clawr, demonstrating the variable scope and semantics model described above. Its main focus is showing how the runtime can manage memory with the proposed semantics while providing safety guarantees.

It also implements the other big language idea of Clawr: enforcing [encapsulation vs pure data segregation](../types/object-data.md).

---

---

# Function Parameter Semantics

## Parameter Semantics Rules

Note: `mut` does not mean move ownership as `&mut` in Rust. Instead it means that value semantics (copy-on-write) applies to the variable.

Parameters have one extra semantics mode that ordinary variables cannot use:

- (default): Read-only access
  - Accepts: any variables regardless semantics
  - No copy created
  - Cannot be modified by the function
  - Could be modified by other thread if parallel execution is enabled
- **`const`**: Immutable isolated access
  - Semantically similar to the default, but cannot be affected by parallel mutation
  - Accepts: `const` or `mut` variables (and unassigned return values) but not `ref`
  - No copy created
  - Cannot be modified by the function
  - Value is immutable within function scope
- **`mut`**: Mutable isolated access
  - Semantically equivalent to `const`, but allows mutation in the function body
  - Accepts: `const` or `mut` variables (and unassigned return values) but not `ref`
  - Copies if mutating and high ref-count (CoW)
  - Reference count incremented on call
  - Value is mutable within function scope
  - Changes not visible to caller (isolated)
- **`ref`**: Shared mutable access
  - Accepts: `ref` variables only
  - Shares reference (increments refs)
  - Value is mutable within function scope
  - Modifications visible to all references (shared)

### Tension

Not sure if the signature should only allow `const` and not `mut`. Maybe the developer should be allowed to shadow the variable instead:

```clawr
func foo(label varName: const Type) {
  mut varName = varName // Makes varName mutable but does not increment refcount
  // Now varName can be mutated
  varName.modify()
}
```

Or maybe `const` and `mut` are interchangeable?

```clawr
trait SomeTrait {
  func foo(label varName: const Type)
}

object SomeObject: SomeTrait {
  // This works as implementation of the trait requirement
  func foo(label varName: mut Type) {
    varName.modify()
    // ...
  }
}

object IncorrectObject: SomeTrait {
  // This does not match the trait requirement (wrong semantics)
  func foo(label varName: ref Type) {
    varName.modify()
    // ...
  }
}
```

## Examples

### Example 1: `mut` parameter with COW

```clawr
func transform(value: mut Data) -> const Data {
  value.modify()  // Triggers COW if refs > 1
  return value
}

mut original = Data.new()
const result = transform(original)
// original unchanged (was copied on write inside transform)
// result contains the modified version
```

**What happens:**

1. `original` created from factory (`refs` = 1)
2. `original` passed to function and assigned to `value` (`refs` = 2)
3. `value.modify()` triggers COW (`refs` > 1, so copy happens)
4. `original.refs` is decremented to 1, `value` is pointed to new memory with `refs` = 1
5. `result` is assigned the modified copy (moved—`refs` stays as 1)
6. `original` is unchanged

### Example 2: `mut` parameter without copy

```clawr
func transform(value: mut Data) -> const Data {
  value.modify()  // Triggers COW if refs > 1
  return value
}

const result = transform(Data.new())
// No copy needed - Data.new() was unique (refs == 1)
```

**What happens:**

1. `Data.new()` creates unique value (`refs` = 1)
2. Passed to function (moved—`refs` stays 1)
3. `value.modify()` works directly on the value (refs == 1, no copy)
4. Returns the modified value
5. Efficient - zero copies

### Example 3: `const` parameter

```clawr
func analyze(data: const Data) -> Report {
  // Cannot modify data
  return Report.from(data)
}

mut myData = Data.new()
const report = analyze(myData)
// myData still accessible and unchanged
```

**What happens:**

1. `myData` created from factory (`refs` = 1)
2. `myData` passed to function (`refs` stays 1 as COW cannot occur)
3. Function has immutable view (compiler prevents modification)
4. No copy occurs (just reference sharing)

### Example 4: `in` parameter (default)

```clawr
func size(data: Data) -> Int {  // Implicit: data: in Data
  return data.count()
}

mut data1 = Data.new()
ref data2 = Data.new()
const data3 = Data.new()

size(data1)  // OK
size(data2)  // OK
size(data3)  // OK
// All share reference temporarily, no copies
```

**What happens:**

1. All variables created with `refs` = 1
2. Passed to function (`refs` stays 1 as COW cannot occur)
3. Function has immutable view (compiler prevents modification)
4. No copy occurs (just reference sharing)

## The Key Insight: COW Handles Isolated Mutation

**Copy-on-write preserves isolated semantics, but it is not a semantic conversion tool**:

1. Parameters increment reference counts (cheap)
2. Read-only operations never trigger copies
3. Mutations trigger COW only when `refs` > 1
4. `mut` and `const` differ only in compile-time mutation permission
5. `ref` is the only one with shared mutation semantics
6. Crossing between isolated and shared models requires explicit `copy()`

## Return Type Interaction

```clawr
func process(data: mut Data) -> const Data {
  data.modify()
  return data  // Returns ISOLATED (cannot prove unique)
}

func create() -> Data {
  return Data.new()  // Returns unique
}

// Usage:
ref r1 = create()      // OK: unique can become SHARED
ref r2 = process(...)  // Error: ISOLATED needs copy

mut m1 = create()      // OK: unique can become ISOLATED
mut m2 = process(...)  // OK: ISOLATED → ISOLATED
```

## Complete Syntax Proposal

```clawr
func example(
    param1: Data,              // Implicit: in Data (read-only, any variable)
    param2: in Data,           // Explicit: read-only, any variable
    param3: const Data,        // Immutable isolated (const/mut variables)
    param4: mut Data,          // Mutable isolated (const/mut variables, COW)
    param5: ref Data           // Shared mutable (ref variables only)
) -> const Result {            // Returns ISOLATED
  // Function body
}

func factory() -> Widget {     // Returns unique (refs == 1 proven)
  return Widget.new()
}

func getter(obj: ref Container) -> ref Widget {  // Returns SHARED
  return obj.widget
}
```

---

---

# Variable Semantics for Function Return Values

Functions can return memory they just allocated, memory that they receive from somewhere else, or memory stored as a field. That memory could have `ISOLATED` or `SHARED` semantics. But functions should be reusable whether the caller assigns the result to a `const` or a `ref` variable. To resolve this, Clawr uses _uniquely referenced values_ where possible.

## Uniquely Referenced Values

Functions return “uniquely referenced” values by default. A uniquely referenced value is an `ISOLATED` memory block that has a reference count of exactly one. It is assumed that the value will be assigned to a variable, which is is already counted. If it is not, it must be released (and deallocated) by the caller.

A uniquely referenced value can be reassigned new semantics. If the caller assigns the value to a `const` or `mut` variable, the memory is awarded `ISOLATED` semantics. If it is assigned to a `ref` variable, it is given `SHARED` semantics. Once the value has been assigned, the semantics is locked until it is deallocated (unless it is returned again as a uniquely referenced value).

Uniquely referenced values will always be `ISOLATED`. This is a consequence of the fact that `SHARED` values will always have multiple references. If, for example, you return the value of a `ref` field, that field will hold one reference, and for the caller to be able to hold a reference, the count must be at least two.

## Uniquely Referenced Return Values are _Moved_

Reference-counted values will be deallocated as soon as the counter reaches zero. Therefore, it is impossible for the called function to count down _all_ its references and then return the value. It must leave a reference count of one (even though it technically holds zero references). That means that the caller must adjust _its_ behaviour accordingly. It just takes over the reference without counting up. If it does not store the value (for example if it just passes it to another function, or uses it for computation etc) it must call `releaseRC()` so that the memory does not leak.

When a function returns an `ISOLATED` value, that memory is “moved.” That means that if the function does `return x` it will not call `releaseRC(x)` (but it will call `releaseRC()` for all other variables in its scope). The receiving variable will not call `retainRC()` on the returned value, but will just take over the reference from the called function.

In other words, returned values must have a reference count of exactly one. We call this a “unique reference.” If it is unclear at compile-time whether the memory could have multiple references, the compiler should conservatively normalize the return in V1 rather than trying to prove more than it can safely prove.

Alternatively, we could make the return type `const Value`, meaning that the value har explicit `ISOLATED` semantics and can only be assigned to a `const` or `mut` variable.

## Semantics Rules

1. `ISOLATED` memory may not be assigned to `ref` variables. Explicit `copy()` is required.
2. `SHARED` memory may not be assigned to `const` / `mut` variables. Explicit `copy()` is required.
3. `SHARED` memory returned from a function modifies its return type, `-> ref Value`.
4. `ISOLATED` memory (returned from a function) can be reassigned `SHARED` if `refs == 1`.
5. `ISOLATED` memory with a (possible) high ref count makes the return type `const Value`.
6. If a function cannot prove that the value is always uniquely referenced, it must announce that its semantics are fixed.
7. Clawr V1 should conservatively normalize uncertain `-> Value` returns rather than depending on advanced uniqueness proofs.

```clawr
func returnsRef() -> ref Student // SHARED memory
func returnsCOW() -> const Student // ISOLATED memory with multiple refs
func returnsUnique() -> Student  // uniquely referenced, reassignable
```

## Constructors

Clawr does not have constructors like other OO languages, but does have `data` literals and factory functions.

A factory is just a free function (probably in a namespace with the same name as the type) that creates an `ISOLATED`, uniquely referenced, memory block. This is then assigned as needed to a `ref`, `mut` or `const` variable according to the rules above.

---

---

# Variable Semantics Example

There are two kinds of memory structures in Clawr: `ISOLATED` and `SHARED`.

When a variable is declared as `const` or `mut`, the corresponding data structure will be flagged as the `ISOLATED` variety. This means that if there are multiple references to that structure when it is edited, the editing must be performed on a copy of the structure, not the structure itself. Only the variable that is explicitly edited may be modified. No other variables that reference the original structure may be changed. Local reasoning is a really powerful concept for understanding the state of your program. That is the contract when using `const` and `mut`.

When using `ref`, the contract says that the main subject is the referenced object (the structure in memory), not the variable. A variable is but one of potentially myriad pointers _referencing_ this object. Modifying the object from one location, should instantly be reflected to all other references. Using `ref` can improve performance—as no (implicit) copying is performed—but it invalidates local reasoning. And it also adds complexity in parallel execution contexts; you will need locking or other mechanisms to ensure that two processes cannot modify the same information at the same time.

To illustrate the difference between copy and reference semantics, let’s consider a Bowling game score calculator as an example. The actual code to calculate the score is irrelevant here, but we can assume that it needs to log how many pins were knocked down (or “dropped”) by each roll of the bowling ball. Let’s imagine an encapsulated `BowlingGame` `object` type that calculates the score for a single player:

```mermaid
classDiagram
class BowlingGame {
  - rolls: integer[]
  + [mutating] roll(droppingPins: integer)
}
```

## Copy Semantics

Let’s start playing a game using a `mut` variable, and then assign the game to a different variable that we’ll continue the game through. Because we’re using `mut` variables, this will create two isolated games.

```clawr
mut game1 = BowlingGame() // Creates a new `ISOLATED` memory structure
game1.roll(droppingPins: 9)
print(game1.score) // 9

mut game2 = game1 // Temporarily references the same memory block
game2.roll(droppingPins: 1) // Mutating game2 implicitly creates a copy where the change is applied
print(game1.score) // 9 - the game1 variable has not been changed by the last roll
print(game2.score) // 10 - game2 includes the score for the second roll
```

Let’s follow the state of the memory for each line of code in the example. First a `BowlingGame` object is instantiated and assigned to the `game1` variable. We can illustrate that as follows:

```clawr
mut game1 = BowlingGame()
```

```mermaid
flowchart
game1([mut game1]) --> g1

g1["`semantics = ISOLATED
is_a → *BowlingGame*
refs = 1
rolls = []`"]

classDef new  fill:#ffd6d6,stroke:#333,stroke-width:1px,color:black;
class g1 new;
```

The memory holds the state of the game as defined by the `BowlingGame` object type. It also holds some data defined implicitly by the Clawr compiler. These include a `semantics` flag, an `is_a` pointer that identifies the object's type, and a reference counter (`refs`).

The `is_a` pointer is irrelevant to memory management and will be elided in the other charts on this page. It identifies the type of the object and can be used for runtime type checking. The assigned type defines the layout of the memory block. It is also used for polymorphism (looking up which function to execute for a given method call).

The `semantics` flag identifies the memory structure as belonging to a `mut` variable and hence requiring isolation, the behaviour expressed in this exchange.

The `refs` counter starts at one at allocation and is incremented with every new variable assignment. When a variable is reassigned or descoped, the counter is decremented so that it always counts exactly how many references the structure has. When the counter reaches zero the memory is released to the system for other uses.

For a local variable in a function, reference counting might be redundant, as the memory will certainly be reclaimed when the function returns. But the structure can also be referenced by another structure, and will then have to be kept around for as long as that structure maintains _its_ reference.

The second line logs a roll of the bowling ball, which knocks down 9 pins. Because the `refs` counter is 1, this change is written directly into the memory without creating a copy.

```clawr
game1.roll(droppingPins: 9)
```

```mermaid
flowchart
game1([mut game1]) --> g1

g1["`semantics = ISOLATED
refs = 1
rolls = [9]`"]
```

Then the new variable `game2` is assigned to the structure.

```clawr
mut game2 = game1
```

```mermaid
flowchart
game1([mut game1]) --> g1
game2([mut game2]) --> g1

g1["`semantics = ISOLATED
refs = 2
rolls = [9]`"]
```

This increments the `refs` counter as there are now two variables referencing the same structure. As long as no modification is made to the structure, there is no need to maintain isolation. Both variables can reference the same memory block.

But then `game2` is modified though the `game2.roll(droppingPins: 1)` call, The method is tagged as `mutating`, which indicates that calling it will cause changes to the memory. As the `ISOLATED` flag indicates that memory changes must be done in isolation, a copy is made, and then the method is invoked _on that copy_.

```clawr
game2.roll(droppingPins: 1) // mutating method call
```

```mermaid
flowchart
game1([mut game1]) --> g1
game2([mut game2]) --> g2

g1["`semantics = ISOLATED
refs = 1 (was 2)
rolls = [9]`"]

g2["`semantics = ISOLATED
refs = 1
rolls = [9, 1]`"]

classDef new  fill:#ffd6d6,stroke:#333,stroke-width:1px,color:black;
class g2 new;
```

In the image, the red background signals a newly claimed block of memory. The other block is the original, unchanged one.

The new block will only be referenced by the changing variable (`game2`) and receives a `refs` counter of 1. Because `game2` has been reassigned, the old structure’s `refs` counter is decremented by one.

And this is how we can play two isolated bowling games even though we only explicitly created one.

## Reference Semantics

When a structure is instantiated and assigned to a `ref` variable, on the other hand, it will be flagged as `SHARED`. This means that multiple `ref` variables may reference the same (shared) structure and no implicit copying will be made.

Here is an example of usage:

```clawr
ref game1 = BowlingGame() // Creates a new `SHARED` memory structure
game.roll(droppingPins: 9)
print(game1.score) // 9

ref game2 = game // References the same structure
game2.roll(droppingPins: 1) // Mutation does not cause a copy
print(game1.score) // 10
```

Let’s follow the state of the memory for each line of code in the example. First a `BowlingGame` object is instantiated and assigned to the `game1` variable. We can illustrate that as follows:

```mermaid
flowchart
game1([ref game1]) --> g1

g1["`semantics = SHARED
refs = 1
rolls = []`"]

classDef new  fill:#ffd6d6,stroke:#333,stroke-width:1px,color:black;
class g1 new;
```

The memory is structured exactly the same way as for a `ISOLATED` variable and the `is_a` (elided here) and `refs` properties have the same purposes. The only difference is the value of the `semantics` flag. In this case we use `SHARED` which has implications when we assign this block to multiple variables.

The second line logs a roll of the bowling ball, which knocks down 9 pins:

```mermaid
flowchart
game1([ref game1]) --> g1

g1["`semantics = SHARED
refs = 1
rolls = [9]`"]
```

When the other variable is assigned:

```mermaid
flowchart
game1([ref game1]) --> g1
game2([ref game2]) --> g1

g1["`semantics = SHARED
refs = 2
rolls = [9]`"]
```

And when the next roll is logged it updates the shared memory, affecting both variables:

```mermaid
flowchart
game1([ref game1]) --> g1
game2([ref game2]) --> g1

g1["`semantics = SHARED
refs = 2
rolls = [9, 1]`"]
```

This did not trigger a copy in this case. Because the variables are `ref`—and the memory is flagged as `SHARED`—the contract is different than that of `mut` variables.

A `mut` variable has to be isolated: it must not be changed by changing other variables, and no other variables may change when _it_ is changed. This is a powerful guarantee that makes local reasoning possible.

But the `ref` contract requires that a single entity can be referenced (and modified) from multiple locations. It must _not_ be copied (unless explicitly requested to) or the contract is broken.
