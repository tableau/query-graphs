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

test("duplicate container properties retain the winning container range", () => {
    const text = '{"item": {"name": "first"}, "item": [{"name": "last"}]}';
    const parsed = parsePositionedJson(text, "plan");
    const root = parsed.value as JsonObject;
    const item = root["item"] as JsonObject[];
    const arrayFrom = text.lastIndexOf("[");
    const childFrom = text.indexOf("{", arrayFrom);

    assert.equal((item[0] as JsonObject)["name"], "last");
    assert.deepEqual(parsed.source.propertyValueLocation(root, "item"), {
        documentId: "plan",
        from: arrayFrom,
        to: text.lastIndexOf("]") + 1,
    });
    assert.deepEqual(parsed.source.valueLocation(item[0]), {
        documentId: "plan",
        from: childFrom,
        to: text.indexOf("}", childFrom) + 1,
    });
});

test("positioned JSON locates keys and nested container values", () => {
    const text = '{"items": [{"name": "scan"}]}';
    const parsed = parsePositionedJson(text, "plan");
    const root = parsed.value as JsonObject;
    const items = root["items"] as JsonObject[];
    const nestedFrom = text.indexOf("{", 1);

    assert.deepEqual(parsed.source.valueLocation(root), {documentId: "plan", from: 0, to: text.length});
    assert.deepEqual(parsed.source.propertyKeyLocation(root, "items"), {
        documentId: "plan",
        from: text.indexOf('"items"'),
        to: text.indexOf('"items"') + '"items"'.length,
    });
    assert.deepEqual(parsed.source.propertyValueLocation(root, "items"), {
        documentId: "plan",
        from: text.indexOf("["),
        to: text.lastIndexOf("]") + 1,
    });
    assert.deepEqual(parsed.source.valueLocation(items[0]), {
        documentId: "plan",
        from: nestedFrom,
        to: text.indexOf("}", nestedFrom) + 1,
    });
});

test("positioned JSON accepts scalar roots and rejects partial visitor results", () => {
    assert.equal(parsePositionedJson("null", "plan").value, null);
    assert.equal(parsePositionedJson('"value"', "plan").value, "value");
    assert.throws(() => parsePositionedJson('{"name": "partial"', "plan"), SyntaxError);
});
