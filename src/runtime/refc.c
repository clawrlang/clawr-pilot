#include "refc.h"
#include "panic.h"
#include <string.h>
#include <unistd.h>

// --------
// ALLOCATE
// --------

void* _alloc_rc_structure(const __type_info* const type, size_t extendedSize, refs_t const semantics) {
    __rc_header* const structure = malloc(type->data_type.size + extendedSize);
    if (!structure) panic("Error: Out Of Memory");

    memcpy(structure, &(__rc_header){
        .is_a = type, // const pointer assignment
        .allocation_size = type->data_type.size + extendedSize,
        .refs = semantics | 1,
        .proxy = NULL,
    }, sizeof(__rc_header));
    return structure;
}

// ------
// RETAIN
// ------

void* retainRC(void* const structure) {
    if (!structure) return NULL;

    atomic_fetch_add_explicit(&RC_HEADER(structure)->refs, 1, memory_order_relaxed);
    return structure;
}

// -------
// RELEASE
// -------

void* _release_rc_structure(void* const structure) {
    if (!structure) return NULL;
    __rc_header* const header = RC_HEADER(structure);

    const refs_t prevRefs = atomic_fetch_sub_explicit(&header->refs, 1, memory_order_acq_rel) & __rc_REFC_BITMASK;
    if (prevRefs == 1) {
        __rc_proxy* const proxy = atomic_load_explicit(&header->proxy, memory_order_acquire);
        if (proxy) {
            // Publish entity teardown to weak readers
            proxy->target = NULL;
            _release_proxy(proxy);
        }
        void (*releaseNested)(void* self) = header->is_a->data_type.release_nested_fields;
        if (releaseNested) releaseNested(structure);
        free(structure);
    }
    return NULL;
}

// ---------------
// MUTATE AND COPY
// ---------------

void* _performCopying(void* const structure) {
    __rc_header* const header = RC_HEADER(structure);

    // Clone structure to new allocation
    __rc_header* const clone = malloc(header->allocation_size);
    memcpy(clone, structure, header->allocation_size);
    // New allocation has one reference regardless of the original.
    atomic_init(&clone->refs, __rc_ISOLATED | 1);

    void (*retainNested)(void* self) = header->is_a->data_type.retain_nested_fields;
    if (retainNested) retainNested(structure);

    // Finished copying; unset the flag.
    atomic_fetch_and_explicit(&header->refs, ~__rc_COPYING_FLAG, memory_order_acquire);
    // Release reference to original.
    _release_rc_structure(structure);
    return clone;
}

void* _mutateRC(void* const structure) {
    __rc_header* const header = RC_HEADER(structure);
    // No copying needed if SHARED
    // But what if it is being copied (explicit copy)? It should not be possible to change then, should it?
    if ((header->refs & __rc_SEMANTICS_FLAG) == __rc_SHARED) return structure;

    // Flag that copying is in progress.
    const refs_t refs = atomic_fetch_or_explicit(&header->refs, __rc_COPYING_FLAG, memory_order_acquire);

    if (refs & __rc_COPYING_FLAG) {
        // Copy is in progress elsewhere. Wait and try later.
        usleep(10);
        return _mutateRC(structure);
    } else if ((refs & __rc_REFC_BITMASK) == 1) {
        // Unique reference. No copy needed. Restore flag.
        atomic_fetch_and_explicit(&header->refs, ~__rc_COPYING_FLAG, memory_order_acquire);
        return structure;
    }

    return _performCopying(structure);
}

void* copyRC(void* const structure, refs_t const semantics) {
    __rc_header* const header = RC_HEADER(structure);
    // Flag that copying is in progress.
    const refs_t refs = atomic_fetch_or_explicit(&header->refs, __rc_COPYING_FLAG, memory_order_acquire);

    if (refs & __rc_COPYING_FLAG) {
        // Copy is in progress elsewhere. Wait and try later.
        usleep(10);
        return copyRC(structure, semantics);
    }

    return _performCopying(structure);
}

// ---------------
// WEAK REFERENCES
// ---------------

__rc_proxy* retainWeakly(void* const structure) {
    if (!structure) return NULL;
    __rc_header* const header = RC_HEADER(structure);

    // Acquire temporary strong reference to prevent deallocation race
    if (atomic_fetch_add_explicit(&header->refs, 1, memory_order_acquire) == 0) {
        // Structure is already being deallocated - roll back our increment
        atomic_fetch_sub_explicit(&header->refs, 1, memory_order_relaxed);
        return NULL;
    }

    // Structure is guaranteed to remain alive during weak ref creation
    __rc_proxy* const proxy = atomic_load_explicit(&header->proxy, memory_order_acquire);
    if (proxy) {
        atomic_fetch_add_explicit(&proxy->refs, 1, memory_order_relaxed);
        // Release temporary strong reference using proper API
        _release_rc_structure(structure);
        return proxy;
    }

    // Slow path: create a new proxy candidate
    __rc_proxy* const newProxy = malloc(sizeof(__rc_proxy));
    if (!newProxy) {
        panic("Reference counting: Memory allocation failed in retainWeakly");
    }

    atomic_init(&newProxy->refs, 1); // Start with our reference
    newProxy->target = structure;

    // Update header->proxy if its value is still NULL (the initial value of raceProxy).
    __rc_proxy* raceProxy = NULL;
    if (atomic_compare_exchange_strong_explicit(&header->proxy, &raceProxy, newProxy,
                                                memory_order_acq_rel, memory_order_acquire)) {
        // Optimistic concurrency race won. This proxy is now installed.
        // It is safe to use by the referent.
        atomic_fetch_add_explicit(&newProxy->refs, 1, memory_order_relaxed);
        _release_rc_structure(structure);
        return newProxy;
    } else {
        // Optimistic concurrency race lost. Another thread installed a proxy.
        // Discard this one.
        free(newProxy);

        // The installed proxy is returned in &raceProxy.
        // Increment its reference counter for this reference.
        atomic_fetch_add_explicit(&raceProxy->refs, 1, memory_order_relaxed);
        _release_rc_structure(structure);
        return raceProxy;
    }
}

void _release_proxy(__rc_proxy* const proxy) {
    if (atomic_fetch_sub_explicit(&proxy->refs, 1, memory_order_acq_rel) == 1) {
        free(proxy);
    }
}
