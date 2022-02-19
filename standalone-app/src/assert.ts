export function assert(value: unknown): asserts value {
    if (!value) {
        debugger; // eslint-disable-line no-debugger
        throw new Error(
            "Assertion violated. This is a programming error. Please file a bug at https://github.com/tableau/query-graphs/issues",
        );
    }
}

export function assertUnreachable(_: never): never {
    debugger; // eslint-disable-line no-debugger
    throw new Error(
        "Didn't expect to get here. This is a programming error. Please file a bug at https://github.com/tableau/query-graphs/issues",
    );
}
