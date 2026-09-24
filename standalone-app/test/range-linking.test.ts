import assert from "node:assert/strict";
import test from "node:test";
import {codeFolding, foldEffect} from "@codemirror/language";
import {EditorState} from "@codemirror/state";
import {EditorView} from "@codemirror/view";
import {JSDOM} from "jsdom";
import {rangeLinking} from "../src/RangeLinking";

test("fold placeholders identify highlighted ranges hidden by their fold", async () => {
    const dom = new JSDOM("<main></main>", {pretendToBeVisual: true});
    const globalNames = [
        "window",
        "Window",
        "document",
        "Node",
        "MutationObserver",
        "requestAnimationFrame",
        "cancelAnimationFrame",
    ] as const;
    const previousGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    for (const name of globalNames)
        Object.defineProperty(globalThis, name, {configurable: true, writable: true, value: dom.window[name]});

    const view = new EditorView({
        parent: dom.window.document.querySelector("main") ?? undefined,
        state: EditorState.create({
            doc: "a hidden b hidden c",
            extensions: [codeFolding(), rangeLinking.extension()],
        }),
    });
    try {
        view.dispatch({effects: [foldEffect.of({from: 2, to: 8}), foldEffect.of({from: 11, to: 17})]});
        view.dispatch({effects: rangeLinking.setHighlightedRanges.of([{documentId: "query", from: 8, to: 9}])});
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const placeholders = [...view.dom.querySelectorAll<HTMLElement>(".cm-foldPlaceholder")];
        assert.equal(placeholders.length, 2);
        assert.deepEqual(
            placeholders.map((placeholder) => view.posAtDOM(placeholder)),
            [2, 11],
        );
        assert.ok(placeholders.every((placeholder) => !placeholder.classList.contains("cm-fold-hides-highlighted-range")));

        view.dispatch({effects: rangeLinking.setHighlightedRanges.of([{documentId: "query", from: 12, to: 13}])});
        await new Promise((resolve) => requestAnimationFrame(resolve));
        assert.deepEqual(
            placeholders.map((placeholder) => placeholder.classList.contains("cm-fold-hides-highlighted-range")),
            [false, true],
        );

        view.dispatch({effects: rangeLinking.setHighlightedRanges.of([])});
        await new Promise((resolve) => requestAnimationFrame(resolve));
        assert.ok(placeholders.every((placeholder) => !placeholder.classList.contains("cm-fold-hides-highlighted-range")));
    } finally {
        view.destroy();
        dom.window.close();
        for (const [name, descriptor] of previousGlobals) {
            if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
            else Object.defineProperty(globalThis, name, descriptor);
        }
    }
});
