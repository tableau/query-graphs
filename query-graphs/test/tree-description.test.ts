import assert from "node:assert/strict";
import test from "node:test";
import {getNumericProperty, getScalarProperty, getStringProperty} from "../src/tree-description";

test("scalar accessors only return stored scalar values", () => {
    const properties = new Map([
        ["id", {value: 42}],
        ["numericString", {value: "42"}],
        ["infinite", {value: Number.POSITIVE_INFINITY}],
    ]);
    assert.equal(getScalarProperty(properties, "id"), "42");
    assert.equal(getStringProperty(properties, "id"), undefined);
    assert.equal(getStringProperty(properties, "numericString"), "42");
    assert.equal(getNumericProperty(properties, "id"), 42);
    assert.equal(getNumericProperty(properties, "numericString"), undefined);
    assert.equal(getNumericProperty(properties, "infinite"), undefined);
});
