# Data Keyword in Clawr

This document defines the V1 implementation plan for `data` declarations.

## V1 Normative Spec

This section is implementation-facing. If exploratory notes elsewhere disagree, this section wins.

### Core Model

- `data` defines a nominal, heap-allocated, reference-counted structure.
- `data` has fields only; instance methods are not part of `data` in V1.
- Each `data` declaration is a distinct type, even if field sets are identical.
- Generics are deferred.
- Recursive `data` fields are deferred.

### Field Model

- Fields are mutable (`mut`) by default.
- `ref` fields are allowed.
- `const` fields are deferred (not required in V1).
- A `const` variable of a `data` type with no `ref` fields is structurally immutable.
- A `ref` variable referencing `data` with mutable fields uses shared semantics.
- A `mut` variable referencing `data` uses isolated semantics with copy-on-write on mutation.

### Declaration and Literal Syntax

- Declaration syntax:
  - `data Name { field: ValueSet, otherField: OtherValueSet }`
- Literal syntax:
  - `{ field: Expression, otherField: Expression }`
- Field separators:
  - Fields may be separated by newline and/or comma in declarations and literals.

### Initialization Rules

- Data literals are context-typed only in V1.
- A concrete `data` type must be known by context or annotation before literal checking.
- Literal initialization is the only initializer in V1.
- Function-like constructors for `data` are out of scope for V1.

### Type Checking Rules

- Literals must provide all required fields.
- Extra/unknown fields are rejected.
- Each field expression must be assignment-compatible with the field ValueSet.
- Literal-to-target checking is nominal and target-driven (no anonymous structural type creation).
- Field-level semantics compatibility applies (including `ref` fields).

### Mutation Rules

- Direct field mutation is allowed through `mut` variables.
- Direct field mutation through `const` variables is rejected.
- Direct field mutation through `ref` variables is allowed (shared mutation semantics).
- For isolated mutation sites, lowering must ensure copy-on-write with `mutateRC()` before in-place writes.

### Runtime and Lowering Model

- Each `data` declaration lowers to a dedicated C struct.
- Each lowered `data` type has a corresponding `__type_info Nameˇtype` instance.
- Allocation uses `allocRC(Name, semantics)` with the generated type metadata.
- Retain/release hooks must retain/release nested reference-counted fields.
- Explicit copy uses runtime copy path (`copyRC`) and returns a uniquely referenced allocation.

### Companion and Static API Notes

- `data` has no instance methods in V1.
- If static helper APIs are needed, the intended mechanism is a same-name `companion` declaration (future work).
- Trait conformance and retroactive modeling are deferred.

### V1 Conservatism

- Prefer explicitness over inference.
- Do not introduce anonymous structural data types in V1.
- Keep diagnostics precise, naming missing/extra fields and incompatible field assignments.

## Compiler Implementation Checklist (V1)

1. Parse and AST
   - Parse `data` declarations with named fields.
   - Parse field annotations as ValueSet types.
   - Parse data literals with named fields.
   - Preserve source positions for field-level diagnostics.

2. Type Registry
   - Register each `data` declaration as a nominal type.
   - Store field maps and field ValueSet constraints in semantic context.

3. Literal Type Checking
   - Require target/context type for data literals.
   - Validate required-field completeness and unknown-field rejection.
   - Validate field expression compatibility against field ValueSet.

4. Assignment and Variable Compatibility
   - Reuse variable semantics matrix (`const`/`mut`/`ref`) with `data` as an entity family.
   - Enforce explicit conversion boundaries where semantics crossing requires copy.

5. Field Access and Mutation
   - Lower field reads for typed `data` values.
   - Lower field writes for `mut` and `ref` according to semantics rules.
   - Emit `mutateRC()` for isolated mutation paths.

6. Runtime Integration
   - Generate metadata hooks for nested retain/release.
   - Ensure generated C compiles and links with runtime headers.

7. Diagnostics
   - Missing field: name missing keys.
   - Unknown field: name extra keys.
   - Incompatible field value: name field and expected ValueSet.

8. Testing
   - Parser tests for declaration and literal forms.
   - Semantic tests for field completeness and compatibility.
   - Codegen tests for allocation, field read/write, and mutation strategy.
   - E2E tests for copy-on-write behavior with field mutation.

## Implementation Tickets (V1)

This section turns the V1 spec into concrete tickets ordered by dependency.

### Parser and AST ✅

1. `DATA-PARSE-001` Data declaration parsing ✅
   - Scope: Parse `data Name { ... }` declarations and field lists.

2. `DATA-PARSE-002` Data literal parsing ✅
   - Scope: Parse `{ field: expr, ... }` literal syntax with newline/comma separators.

3. `DATA-PARSE-003` Field separator normalization ✅
   - Scope: Support mixed newline/comma separators in declarations and literals.

### Semantic Analysis

4. `DATA-ANALYZE-001` Nominal data type registration ✅
   - Scope: Register each `data` declaration as a distinct nominal type with field map.

5. `DATA-ANALYZE-002` Context-typed literal enforcement ✅
   - Scope: Require known target type for data literals in V1.

6. `DATA-ANALYZE-003` Field completeness and unknown-field checks ✅
   - Scope: Validate missing/extra fields in literals.

7. `DATA-ANALYZE-004` Field value compatibility checks ✅
   - Scope: Validate each literal field expression against declared ValueSet.

8. `DATA-ANALYZE-005` Field mutation eligibility checks
   - Scope: Enforce `const`/`mut`/`ref` rules for field write operations.
   - Blocked: needs parsing of dot operator and field assignment

### Codegen and Runtime Integration

9. `DATA-CODEGEN-001` Data type lowering and metadata emission
   - Scope: Lower each `data` declaration to C struct + `__type_info`.

10. `DATA-CODEGEN-002` Data literal allocation lowering
    - Scope: Lower context-typed literals to `allocRC` + field initialization.

11. `DATA-CODEGEN-003` Field access and field mutation lowering
    - Scope: Lower reads/writes; emit `mutateRC()` for isolated writes.

12. `DATA-RUNTIME-001` Nested retain/release hook integration
    - Scope: Ensure generated hooks retain/release nested RC-managed fields correctly.

### Test Plan Tickets

13. `DATA-TEST-001` Parser coverage for data declarations and literals

14. `DATA-TEST-002` Semantic matrix for literal field validation

15. `DATA-TEST-003` Codegen ownership and COW tests for field mutation

16. `DATA-TEST-004` E2E behavioral tests for nominal typing and field mutation

## Execution Order

Recommended dependency order:

1. `DATA-PARSE-001..003`
2. `DATA-ANALYZE-001..005`
3. `DATA-CODEGEN-001..003`
4. `DATA-RUNTIME-001`
5. `DATA-TEST-001..004`

## Definition of Done (V1)

DATA V1 is complete when:

- `data` declarations and literals parse with documented syntax.
- Data literals are context-typed and validated field-by-field.
- `data` is enforced as nominal.
- Field reads and writes lower correctly with semantics-safe mutation behavior.
- Runtime retain/release behavior is correct for nested reference-counted fields.
- Parser, unit, and e2e tests cover success and diagnostic paths.
