import assert from "node:assert/strict";
import test from "node:test";
import {formatBytes, formatCount, formatExact, formatNumber, formatSeconds} from "../src/number-formats";

test("formats exact numbers", () => {
    assert.equal(formatExact(1_234_567), "1,234,567");
    assert.equal(formatExact(0.4761234), "0.4761234");
    assert.equal(formatNumber(1_234.5, "exact"), "1,234.5");
    assert.equal(formatNumber(1250, "exact"), "1,250");
    assert.equal(formatExact(1e-25), "0.0000000000000000000000001");
    assert.equal(formatExact(Number.MIN_VALUE).endsWith("5"), true);
});

test("formats counts", () => {
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
        assert.equal(formatNumber(value, "count"), expected, String(value));
    }
});

test("formats byte sizes", () => {
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
});

test("formats durations in seconds", () => {
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
});

test("formats sizes in 1024-byte kilobytes", () => {
    assert.equal(formatNumber(1536, "memory-kilobytes"), "1.5 MiB");
});

test("formats durations in milliseconds", () => {
    assert.equal(formatNumber(20.9, "time-milliseconds"), "20.9ms");
});

test("formats durations in microseconds", () => {
    assert.equal(formatNumber(20_900, "time-microseconds"), "20.9ms");
});
