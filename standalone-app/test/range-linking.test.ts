import assert from "node:assert/strict";
import test from "node:test";
import {codeFolding, foldEffect} from "@codemirror/language";
import {EditorSelection, EditorState, type Extension} from "@codemirror/state";
import {EditorView} from "@codemirror/view";
import {JSDOM} from "jsdom";
import {rangeLinking} from "../src/RangeLinking";

function createTestEditor(doc: string, extensions: Extension[]) {
    const dom = new JSDOM("<main></main>", {pretendToBeVisual: true});
    const globalNames = [
        "window",
        "Window",
        "document",
        "Node",
        "HTMLElement",
        "MutationObserver",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "getComputedStyle",
        "Event",
        "FocusEvent",
    ] as const;
    const previousGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    for (const name of globalNames)
        Object.defineProperty(globalThis, name, {configurable: true, writable: true, value: dom.window[name]});

    const view = new EditorView({
        parent: dom.window.document.querySelector("main") ?? undefined,
        state: EditorState.create({doc, extensions}),
    });
    return {
        dom,
        view,
        destroy() {
            view.destroy();
            dom.window.close();
            for (const [name, descriptor] of previousGlobals) {
                if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
                else Object.defineProperty(globalThis, name, descriptor);
            }
        },
    };
}

// Each range category owns a distinct mark, and malformed or cleared ranges must not leave stale DOM decorations.
test("linked and highlighted ranges create their respective decorations", () => {
    const editor = createTestEditor("SELECT value", [rangeLinking.extension()]);
    const {view} = editor;
    try {
        view.dispatch({
            effects: [
                rangeLinking.setLinkedRanges.of([
                    {documentId: "query", from: 0, to: 6},
                    {documentId: "query", from: -1, to: 3},
                    {documentId: "query", from: 7, to: 20},
                ]),
                rangeLinking.setHighlightedRanges.of([{documentId: "query", from: 7, to: 12}]),
            ],
        });

        assert.deepEqual(
            [...view.dom.querySelectorAll(".cm-linked-range")].map((element) => element.textContent),
            ["SELECT"],
        );
        assert.deepEqual(
            [...view.dom.querySelectorAll(".cm-highlighted-range")].map((element) => element.textContent),
            ["value"],
        );

        view.dispatch({effects: [rangeLinking.setLinkedRanges.of([]), rangeLinking.setHighlightedRanges.of([])]});
        assert.equal(view.dom.querySelector(".cm-linked-range"), null);
        assert.equal(view.dom.querySelector(".cm-highlighted-range"), null);
    } finally {
        editor.destroy();
    }
});

// Caret linking prefers all equally narrow exact matches, respects half-open ends, and clears when focus leaves.
test("focused caret activates the shortest linked ranges at its offset", () => {
    const updates: {documentId: string; from: number; to: number}[][] = [];
    const editor = createTestEditor("0123456789", [rangeLinking.extension((activeRanges) => updates.push([...activeRanges]))]);
    const {view} = editor;
    const outer = {documentId: "query", from: 0, to: 10};
    const firstInner = {documentId: "query", from: 2, to: 6};
    const secondInner = {documentId: "query", from: 3, to: 7};
    try {
        view.dispatch({effects: rangeLinking.setLinkedRanges.of([outer, firstInner, secondInner])});
        view.focus();
        assert.deepEqual(updates.at(-1), [outer]);

        view.dispatch({selection: EditorSelection.cursor(3)});
        assert.deepEqual(updates.at(-1), [firstInner, secondInner]);

        view.dispatch({selection: EditorSelection.cursor(7)});
        assert.deepEqual(updates.at(-1), [outer], "ranges are half-open at their end offset");

        view.dispatch({selection: EditorSelection.cursor(10)});
        assert.deepEqual(updates.at(-1), []);

        view.dispatch({selection: EditorSelection.cursor(3)});
        view.contentDOM.blur();
        assert.deepEqual(updates.at(-1), []);
    } finally {
        editor.destroy();
    }
});

// Only the fold that fully contains a highlighted range should pulse; partial overlap and neighboring folds stay inactive.
test("fold placeholders identify highlighted ranges hidden by their fold", async () => {
    const editor = createTestEditor("a hidden b hidden c", [codeFolding(), rangeLinking.extension()]);
    const {view} = editor;
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

        view.dispatch({effects: rangeLinking.setHighlightedRanges.of([{documentId: "query", from: 1, to: 18}])});
        await new Promise((resolve) => requestAnimationFrame(resolve));
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
        editor.destroy();
    }
});
