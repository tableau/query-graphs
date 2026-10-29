import assert from "node:assert/strict";
import test from "node:test";
import {formatBytes, formatCount, formatExact, formatNumber, formatSeconds, inferNumberFormat} from "../src/number-formats";
import {getNumericProperty, getScalarProperty} from "../src/tree-description";
import {toPropertyEntry} from "../src/loaders/loader-utils";

test("infers number formats from scalar property names", () => {
    assert.equal(inferNumberFormat("output-rows"), "rounded");
    assert.equal(inferNumberFormat("Plan Rows"), "rounded");
    assert.equal(inferNumberFormat("actualCycles"), "rounded");
    assert.equal(inferNumberFormat("PeakMemory"), "memory-bytes");
    assert.equal(inferNumberFormat("totalBytes"), "memory-bytes");
    assert.equal(inferNumberFormat("ExecutionTime"), "time-seconds");
    assert.equal(inferNumberFormat("cpu_time"), "time-seconds");
    assert.equal(inferNumberFormat("wall-clock"), "time-seconds");
    assert.equal(inferNumberFormat("min-rows"), "rounded");
});

test("does not reinterpret numbers whose names already state another unit", () => {
    for (const name of ["total_time_ms", "elapsedUs", "cache_ns", "memory_mb", "bufferKb", "peakGiB"]) {
        assert.equal(inferNumberFormat(name), undefined, name);
    }
    for (const name of ["workerId", "joinCode", "ratio", "rowCount"]) {
        assert.equal(inferNumberFormat(name), undefined, name);
    }
});

test("formats deferred scalar numbers", () => {
    const roundedCounts: [number, string][] = [
        [0, "0"],
        [57.5016, "57.5"],
        [0.4761234, "0.476"],
        [999.95, "1K"],
        [999, "999"],
        [1000, "1K"],
        [1234, "1.2K"],
        [123_456, "123K"],
        [999_950, "1M"],
        [5_000_000, "5M"],
        [2_345_678_901, "2.3B"],
        [7e12, "7T"],
        [-57.5016, "-57.5"],
        [-999.95, "-1K"],
        [-1000, "-1K"],
        [-1234, "-1.2K"],
        [-999_950, "-1M"],
    ];
    for (const [value, expected] of roundedCounts) {
        assert.equal(formatCount(value), expected, String(value));
        assert.equal(formatNumber(value, "rounded"), expected, String(value));
    }

    for (const [value, expected] of [
        [512, "512 B"],
        [1536, "1.5 KiB"],
        [3 * 1024 ** 3, "3.0 GiB"],
        [1_048_575, "1.0 MiB"],
        [-512, "-512 B"],
        [-1536, "-1.5 KiB"],
        [-1_048_575, "-1.0 MiB"],
    ] as [number, string][]) {
        assert.equal(formatBytes(value), expected, String(value));
        assert.equal(formatNumber(value, "memory-bytes"), expected, String(value));
    }

    for (const [value, expected] of [
        [0, "0µs"],
        [0.00000851, "8.51µs"],
        [0.0209, "20.9ms"],
        [0.9996, "1s"],
        [1.5, "1.5s"],
        [150, "2.5min"],
        [4320, "1.2h"],
        [59.96, "1min"],
        [3599.9, "1h"],
        [-0.0209, "-20.9ms"],
        [-0.9996, "-1s"],
        [-59.96, "-1min"],
    ] as [number, string][]) {
        assert.equal(formatSeconds(value), expected, String(value));
        assert.equal(formatNumber(value, "time-seconds"), expected, String(value));
    }

    assert.equal(formatExact(1_234_567), "1,234,567");
    assert.equal(formatExact(0.4761234), "0.4761234");
    assert.equal(formatNumber(1_234.5, "exact"), "1,234.5");
    assert.equal(formatNumber(1250, undefined), "1250");
});

test("scalar accessors only return stored scalar values", () => {
    const properties = new Map([
        ["id", {value: 42}],
        ["numericString", {value: "42"}],
        ["infinite", {value: Number.POSITIVE_INFINITY}],
    ]);
    assert.equal(getScalarProperty(properties, "id"), "42");
    assert.equal(getNumericProperty(properties, "id"), 42);
    assert.equal(getNumericProperty(properties, "numericString"), undefined);
    assert.equal(getNumericProperty(properties, "infinite"), undefined);
});

test("non-finite numbers are preserved as strings and receive no number format", () => {
    assert.deepEqual(toPropertyEntry(Number.POSITIVE_INFINITY, "totalRows"), {value: "Infinity"});
    assert.deepEqual(toPropertyEntry(Number.NaN, "peakMemory"), {value: "NaN"});
    assert.deepEqual(toPropertyEntry(42, "id"), {value: 42});
});

test("number inference is enabled only for formats accepted by the loader", () => {
    assert.deepEqual(toPropertyEntry(1234, "totalRows"), {value: 1234});
    assert.deepEqual(toPropertyEntry(1234, "totalRows", ["rounded"]), {value: 1234, numberFormat: "rounded"});
});
