export function assert(value: boolean, errorMsg = "Assertion violated"): asserts value {
    if (!value) {
        // eslint-disable-next-line no-debugger
        debugger;
        throw new Error(errorMsg);
    }
}

export function assertNotNull<T>(v: T | null | undefined): asserts v is T {
    assert(v !== null, "Unexpected null value");
    assert(v !== undefined, "Unexpected undefined value");
}
