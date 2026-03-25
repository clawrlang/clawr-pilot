#ifndef CLAWR_REFC_H
#define CLAWR_REFC_H

#include <stdatomic.h>

typedef uint32_t refs_t;

enum RC_REFS_FIELDS {
    __rc_SEMANTICS_FLAG = (refs_t)1 << (sizeof(refs_t) * 8 - 1),
    __rc_COPYING_FLAG   = (refs_t)1 << (sizeof(refs_t) * 8 - 2),
    __rc_ISOLATED       = __rc_SEMANTICS_FLAG & 0,
    __rc_SHARED         = __rc_SEMANTICS_FLAG & ~0,
    __rc_REFC_BITMASK   = ~(__rc_COPYING_FLAG | __rc_SEMANTICS_FLAG),
};

/// @brief Information about an entity’s (`data` or `object`) type
typedef const struct __data_type_info {
    /// @brief The size of the memory payload for allocations of this type including __rc_header
    const size_t size;

    /// @brief Abstract method that is called by copy-on-write.
    /// Implementation should call retainRC() on all nested structures.
    void (*retain_nested_fields)(void* self);
    /// @brief Abstract method that is called by copy-on-write.
    /// Implementation should call releaseRC() on all nested structures.
    void (*release_nested_fields)(void* self);

} __data_type_info;

struct __polymorphic_type_info;
typedef const struct __polymorphic_type_info {

    /// @brief Duplicate layout of __data_type_info
    __data_type_info data;

    /// @brief Pointer to the super type info
    const struct __polymorphic_type_info* const super;
    /// @brief Pointer to the vtable for this type
    void* vtable;

} __polymorphic_type_info;

typedef union __type_info {
    __data_type_info data_type;
    __polymorphic_type_info polymorphic_type;
} __type_info;

/// @brief Platform for `weak` references to an entity
typedef struct __rc_proxy {
    /// @brief The weakly referenced structure. Set to NULL when descoped.
    void* target;
    /// @brief Counter of `weak` references to the entity
    _Atomic refs_t refs;
} __rc_proxy;

/// A header that is prefixed on all reference-counted memory allocations
typedef struct __rc_header {
    /// @brief Reference counter and semantics flag (FLAGS | refcounter)
    _Atomic refs_t refs;
    const __type_info* const is_a;
    const size_t allocation_size;
    _Atomic(__rc_proxy*) proxy;
} __rc_header;

void* _alloc_rc_structure(const __type_info* const type, size_t extendedSize, refs_t const semantics);

/// @brief Allocate a new reference-counted structure in memory
/// @param __structure__ an RC_DATA type
/// @param __semantics__ either __rc_ISOLATED or __rc_SHARED
#define allocRC(__structure__, __semantics__) _alloc_rc_structure(&__structure__##ˇtype, 0, __semantics__)


/// @brief Retain a memory allocation (assign to a new variable)
/// @param structure the memory structure
/// @return the retained structure
void* retainRC(void* const structure);

void* _release_rc_structure(void* const structure);

/// @brief Release a memory allocation and reassign referencing variable to NULL
/// @param structure the memory structure
#define releaseRC(__var__) _release_rc_structure(__var__); __var__ = NULL

void* _mutateRC(void* const structure);

/// @brief Prepare a variable for mutation
/// If there are multiple references to the variable's memory,
/// and the variable requires isolation, the memory is copied.
#define mutateRC(__var__) __var__ = _mutateRC(__var__)

/// @brief Explicit semantic-conversion copy
/// Creates a new uniquely referenced allocation with specified semantics.
/// Used when crossing between isolated and shared memory models.
/// @param structure the variable to copy
/// @param semantics either __rc_ISOLATED or __rc_SHARED
/// @return a new uniquely referenced allocation
void* copyRC(void* const structure, refs_t const semantics);

/// @brief Add a weak reference to an entity
/// The pointer will be NULL if the entity is descoped
/// @param entity the entity to reference
/// @return a proxy object that references the actual entity
__rc_proxy* retainWeakly(void* const structure);

void _release_proxy(__rc_proxy* const proxy);

/// @brief Release a weak reference to an entity
/// @param proxy the proxy returned from az_acquireWeakRef
#define releaseProxy(__var__) _release_proxy(__var__); __var__ = NULL

#define RC_HEADER(structure) \
    ((__rc_header*) structure)

#define VTABLE(structure, base_type) \
    ((base_type##ˇvtable*) RC_HEADER(structure)->is_a->polymorphic_type.vtable)

#endif // CLAWR_REFC_H
