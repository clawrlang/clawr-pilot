export type RuntimeType =
    | 'integer'
    | 'truthvalue'
    | 'real'
    | 'string'
    | 'bitfield'
    | 'tritfield'

export type MutationStrategy = 'isolated-cow' | 'shared-in-place'
