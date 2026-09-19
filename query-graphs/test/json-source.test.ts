import assert from "node:assert/strict";
import test from "node:test";
import {parsePositionedJson} from "../src/loaders/json-source";
import type {JsonObject} from "../src/loaders/loader-utils";

test("positioned JSON parsing preserves JSON semantics and UTF-16 source offsets", () => {
    const text = '{\r\n  "emoji": "😀",\r\n  "__proto__": {"value": 1}\r\n}';
    const parsed = parsePositionedJson(text, "plan");
    assert.equal(Object.getPrototypeOf(parsed.value), Object.prototype);
    assert.equal(Object.hasOwn(parsed.value as object, "__proto__"), true);

    const object = parsed.value as JsonObject;
    const emoji = '"😀"';
    const emojiFrom = text.indexOf(emoji);
    assert.deepEqual(parsed.source.propertyValueLocation(object, "emoji"), {
        documentId: "plan",
        from: emojiFrom,
        to: emojiFrom + emoji.length,
    });
    assert.deepEqual(parsed.source.valueLocation(object["__proto__"] as JsonObject), {
        documentId: "plan",
        from: text.indexOf('{"value"'),
        to: text.indexOf('{"value"') + '{"value": 1}'.length,
    });
});

test("positioned JSON parsing remains strict", () => {
    for (const text of ["", "{/* comment */}", '{"trailing": true,}', "{} {}"]) {
        assert.throws(() => parsePositionedJson(text, "plan"), SyntaxError, text);
    }
});

test("duplicate properties retain the last value and its location", () => {
    const text = '{"name": "first", "name": "last"}';
    const parsed = parsePositionedJson(text, "plan");
    const object = parsed.value as JsonObject;
    assert.equal(object["name"], "last");
    assert.deepEqual(parsed.source.propertyValueLocation(object, "name"), {
        documentId: "plan",
        from: text.lastIndexOf('"last"'),
        to: text.lastIndexOf('"last"') + '"last"'.length,
    });
});
