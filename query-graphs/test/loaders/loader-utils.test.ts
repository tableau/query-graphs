import assert from "node:assert/strict";
import test from "node:test";
import {toPropertyEntry} from "../../src/loaders/loader-utils";

test("non-finite numbers are preserved as strings and receive no number format", () => {
    assert.deepEqual(toPropertyEntry(Number.POSITIVE_INFINITY, "count"), {value: "Infinity"});
    assert.deepEqual(toPropertyEntry(Number.NaN, "memory-bytes"), {value: "NaN"});
    assert.deepEqual(toPropertyEntry(42), {value: 42, numberFormat: "exact"});
});

test("numeric conversion defaults to exact and preserves source values for explicit formats", () => {
    assert.deepEqual(toPropertyEntry(1234), {value: 1234, numberFormat: "exact"});
    assert.deepEqual(toPropertyEntry(1234, "count"), {value: 1234, numberFormat: "count"});
    assert.deepEqual(toPropertyEntry(20.9, "time-milliseconds"), {value: 20.9, numberFormat: "time-milliseconds"});
    assert.deepEqual(toPropertyEntry("1234", "count"), {value: "1234"});
    assert.deepEqual(toPropertyEntry({rows: [1, 2]}), {value: '{"rows":[1,2]}'});
});
