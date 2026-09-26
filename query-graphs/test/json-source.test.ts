import assert from "node:assert/strict";
import test from "node:test";
import {parsePositionedJson} from "../src/loaders/json-source";
import type {JsonObject} from "../src/loaders/loader-utils";

test("positioned JSON parsing preserves JSON semantics and UTF-16 source offsets", () => {
    const text = '{\r\n  "emoji": "😀",\r\n  "__proto__": {"value": 1}\r\n}';
    const parsed = parsePositionedJson(text, "plan", new Set(["emoji", "__proto__"]));
    assert.equal(Object.getPrototypeOf(parsed.value), Object.prototype);
    assert.equal(Object.hasOwn(parsed.value as object, "__proto__"), true);

    const object = parsed.value as JsonObject;
    const emoji = '"😀"';
    const emojiFrom = text.indexOf(emoji);
    const emojiKey = '"emoji"';
    const emojiKeyFrom = text.indexOf(emojiKey);
    assert.deepEqual(parsed.source.propertyKeyLocation(object, "emoji"), {
        documentId: "plan",
        from: emojiKeyFrom,
        to: emojiKeyFrom + emojiKey.length,
    });
    assert.deepEqual(parsed.source.propertyValueLocation(object, "emoji"), {
        documentId: "plan",
        from: emojiFrom,
        to: emojiFrom + emoji.length,
    });
    assert.deepEqual(parsed.source.propertyValueLocation(object, "__proto__"), {
        documentId: "plan",
        from: text.indexOf('{"value"'),
        to: text.indexOf('{"value"') + '{"value": 1}'.length,
    });
});

test("positioned JSON parsing remains strict", () => {
    for (const text of ["", "{/* comment */}", '{"trailing": true,}', "{} {}"]) {
        assert.throws(() => parsePositionedJson(text, "plan", new Set()), SyntaxError, text);
    }
});

test("duplicate properties retain the last value and its location", () => {
    const text = '{"name": "first", "name": "last"}';
    const parsed = parsePositionedJson(text, "plan", new Set(["name"]));
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
    const parsed = parsePositionedJson(text, "plan", new Set(["item"]));
    const root = parsed.value as JsonObject;
    const item = root["item"] as JsonObject[];
    const arrayFrom = text.lastIndexOf("[");

    assert.equal(item[0]?.["name"], "last");
    assert.deepEqual(parsed.source.propertyValueLocation(root, "item"), {
        documentId: "plan",
        from: arrayFrom,
        to: text.lastIndexOf("]") + 1,
    });
});

test("positioned JSON accepts scalar roots and rejects partial visitor results", () => {
    assert.equal(parsePositionedJson("null", "plan", new Set()).value, null);
    assert.equal(parsePositionedJson('"value"', "plan", new Set()).value, "value");
    assert.throws(() => parsePositionedJson('{"name": "partial"', "plan", new Set()), SyntaxError);
});

test("positioned JSON indexes only requested property keys", () => {
    const text = '{"na\\u006de":"scan","statistics":{"metric":1}}';
    const parsed = parsePositionedJson(text, "plan", new Set(["name"]));
    const root = parsed.value as JsonObject;
    const statistics = root["statistics"] as JsonObject;

    assert.deepEqual(parsed.value, {name: "scan", statistics: {metric: 1}});
    assert.deepEqual(parsed.source.propertyKeyLocation(root, "name"), {
        documentId: "plan",
        from: text.indexOf('"na\\u006de"'),
        to: text.indexOf('"na\\u006de"') + '"na\\u006de"'.length,
    });
    assert.equal(parsed.source.propertyKeyLocation(root, "statistics"), undefined);
    assert.equal(parsed.source.propertyValueLocation(statistics, "metric"), undefined);
});

test("an empty positioned-key set still preserves nested values and prototype-sensitive keys", () => {
    const text = '{"__proto__":{"value":1},"items":[true,null]}';
    const parsed = parsePositionedJson(text, "plan", new Set());
    const root = parsed.value as JsonObject;

    assert.equal(Object.getPrototypeOf(root), Object.prototype);
    assert.equal(Object.hasOwn(root, "__proto__"), true);
    assert.deepEqual(root, JSON.parse(text));
    assert.equal(parsed.source.propertyKeyLocation(root, "__proto__"), undefined);
});
