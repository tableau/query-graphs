import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import type {PropertyEntry} from "../../src/tree-description";
import {createUiFixture} from "./ui-test-utils";

test("property values are formatted during rendering", async () => {
    const {PropertyList} = await import("../../src/ui/PropertyList");
    const fixture = createUiFixture();
    const properties = new Map<string, PropertyEntry>([
        ["name", {value: "scan"}],
        ["rows", {value: 5_000_000, numberFormat: "count"}],
        ["id", {value: 5_000_000}],
        ["exact", {value: 5_000_000, numberFormat: "exact"}],
        ["memory", {value: 1536, numberFormat: "memory-bytes"}],
        ["time", {value: 0.0209, numberFormat: "time-seconds"}],
        ["infinite", {value: Number.POSITIVE_INFINITY, numberFormat: "count"}],
        ["negativeInfinite", {value: Number.NEGATIVE_INFINITY, numberFormat: "time-seconds"}],
        ["nan", {value: Number.NaN, numberFormat: "memory-bytes"}],
    ]);
    try {
        await fixture.render(React.createElement(PropertyList, {properties}));
        assert.deepEqual(
            [...fixture.document.querySelectorAll(".qg-prop-value")].map((element) => element.textContent),
            ["scan", "5M", "5,000,000", "5,000,000", "1.5 KiB", "20.9ms", "Infinity", "-Infinity", "NaN"],
        );
        assert.equal(properties.get("rows")?.value, 5_000_000);
        assert.equal(properties.get("infinite")?.value, Number.POSITIVE_INFINITY);
        assert.ok(Number.isNaN(properties.get("nan")?.value));
    } finally {
        await fixture.cleanup();
    }
});
