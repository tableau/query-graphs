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
    assert.deepEqual(parsed.source.propertyLocation(object, "emoji"), {
        documentId: "plan",
        from: emojiKeyFrom,
        to: emojiFrom + emoji.length,
    });
    assert.deepEqual(parsed.source.propertyLocation(object, "__proto__"), {
        documentId: "plan",
        from: text.indexOf('"__proto__"'),
        to: text.indexOf('{"value"') + '{"value": 1}'.length,
    });
});

test("positioned JSON parsing remains strict", () => {
    for (const text of ["", "{/* comment */}", '{"trailing": true,}', "{} {}"]) {
        assert.throws(() => parsePositionedJson(text, "plan", new Set()), SyntaxError, text);
    }
});

test("duplicate scalar and container properties retain the last value and its location", () => {
    const text = '{"name":"first","item":{"child":"first"},"name":"last","item":[{"child":"last"}]}';
    const parsed = parsePositionedJson(text, "plan", new Set(["name", "item"]));
    const root = parsed.value as JsonObject;

    assert.equal(root["name"], "last");
    assert.deepEqual(parsed.source.propertyLocation(root, "name"), {
        documentId: "plan",
        from: text.lastIndexOf('"name"'),
        to: text.indexOf('"last"', text.lastIndexOf('"name"')) + '"last"'.length,
    });
    const item = root["item"] as JsonObject[];
    assert.equal(item[0]?.["child"], "last");
    assert.deepEqual(parsed.source.propertyLocation(root, "item"), {
        documentId: "plan",
        from: text.lastIndexOf('"item"'),
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
    assert.deepEqual(parsed.source.propertyLocation(root, "name"), {
        documentId: "plan",
        from: text.indexOf('"na\\u006de"'),
        to: text.indexOf('"scan"') + '"scan"'.length,
    });
    assert.equal(parsed.source.propertyLocation(root, "statistics"), undefined);
    assert.equal(parsed.source.propertyLocation(statistics, "metric"), undefined);
});

test("positioned JSON preserves nested values and prototype-sensitive keys", () => {
    const text = '{"__proto__":{"value":1},"items":[true,null]}';
    const parsed = parsePositionedJson(text, "plan", new Set());
    const root = parsed.value as JsonObject;

    assert.equal(Object.getPrototypeOf(root), Object.prototype);
    assert.equal(Object.hasOwn(root, "__proto__"), true);
    assert.deepEqual(root, JSON.parse(text));
    assert.equal(parsed.source.propertyLocation(root, "__proto__"), undefined);
});
