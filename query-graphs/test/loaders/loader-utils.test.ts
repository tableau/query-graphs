import assert from "node:assert/strict";
import test from "node:test";
import {toPropertyEntry} from "../../src/loaders/loader-utils";

test("non-finite numbers retain their numeric values and number formats", () => {
    assert.deepEqual(toPropertyEntry(Number.POSITIVE_INFINITY, "count"), {value: Number.POSITIVE_INFINITY, numberFormat: "count"});
    assert.deepEqual(toPropertyEntry(Number.NEGATIVE_INFINITY, "time-seconds"), {
        value: Number.NEGATIVE_INFINITY,
        numberFormat: "time-seconds",
    });
    assert.deepEqual(toPropertyEntry(Number.NaN, "memory-bytes"), {value: Number.NaN, numberFormat: "memory-bytes"});
});
