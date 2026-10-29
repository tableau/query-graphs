import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import type {PropertyEntry} from "../../src/tree-description";
import {createUiFixture} from "./ui-test-utils";

test("property values are formatted only while rendering", async () => {
    const {PropertyList} = await import("../../src/ui/PropertyList");
    const fixture = createUiFixture();
    const properties = new Map<string, PropertyEntry>([
        ["name", {value: "scan"}],
        ["rows", {value: 5_000_000, numberFormat: "rounded"}],
        ["id", {value: 5_000_000}],
        ["exact", {value: 5_000_000, numberFormat: "exact"}],
        ["memory", {value: 1536, numberFormat: "memory-bytes"}],
        ["time", {value: 0.0209, numberFormat: "time-seconds"}],
    ]);
    try {
        await fixture.render(React.createElement(PropertyList, {properties}));
        assert.deepEqual(
            [...fixture.document.querySelectorAll(".qg-prop-value")].map((element) => element.textContent),
            ["scan", "5M", "5000000", "5,000,000", "1.5 KiB", "20.9ms"],
        );
        assert.equal(properties.get("rows")?.value, 5_000_000);
    } finally {
        await fixture.cleanup();
    }
});
