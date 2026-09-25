import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import test from "node:test";
import * as React from "react";
import {createRoot} from "react-dom/client";
import {JSDOM} from "jsdom";

// Node does not load CSS, so replace stylesheet imports with empty modules.
registerHooks({
    load(url, context, nextLoad) {
        if (url.endsWith(".css")) return {format: "module", source: "", shortCircuit: true};
        return nextLoad(url, context);
    },
});

// Exercise prop synchronization, editor recreation, linked ranges, and both search entry points.
test("the document editor synchronizes and activates linked ranges", async () => {
    // Import after registering the CSS hook because the component imports its stylesheet eagerly.
    const {CodeMirrorDocument} = await import("../src/CodeMirrorDocument");
    const dom = new JSDOM("<main></main>", {pretendToBeVisual: true});
    // CodeMirror reads these browser globals directly rather than through the jsdom window.
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
        "KeyboardEvent",
    ] as const;
    const previousGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    for (const name of globalNames)
        Object.defineProperty(globalThis, name, {configurable: true, writable: true, value: dom.window[name]});
    // jsdom has no layout; an empty rectangle list is sufficient for these editor interactions.
    Object.defineProperty(dom.window.Range.prototype, "getClientRects", {configurable: true, value: () => []});
    const previousActEnvironment = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    const previousReact = Object.getOwnPropertyDescriptor(globalThis, "React");
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {configurable: true, writable: true, value: true});
    Object.defineProperty(globalThis, "React", {configurable: true, writable: true, value: React});

    // Record callbacks so caret movement can be checked independently of rendered decorations.
    const activeLinkedRangeUpdates: {documentId: string; from: number; to: number}[][] = [];
    const root = createRoot(dom.window.document.querySelector("main")!);
    const textDocument = {id: "query", title: "SQL", text: "SELECT value", language: "sql"};
    const onActiveLinkedRangesChange = (activeLinkedRanges: readonly {documentId: string; from: number; to: number}[]) =>
        activeLinkedRangeUpdates.push([...activeLinkedRanges]);
    const innerRange = {documentId: "query", from: 0, to: 6};
    const tiedRange = {documentId: "query", from: 1, to: 7};
    const outerRange = {documentId: "query", from: 0, to: 12};
    const linkedRanges = [innerRange, tiedRange, outerRange];
    const highlightedRanges = [{documentId: "query", from: 7, to: 12}];
    try {
        // Initial linked ranges render without an active graph highlight.
        await React.act(async () =>
            root.render(
                React.createElement(CodeMirrorDocument, {
                    document: textDocument,
                    linkedRanges,
                    highlightedRanges: [],
                    onActiveLinkedRangesChange,
                }),
            ),
        );
        assert.ok(dom.window.document.querySelector(".cm-linked-range"));
        assert.equal(dom.window.document.querySelectorAll(".cm-highlighted-range").length, 0);

        // Updating only the highlight prop must update decorations in the existing editor.
        await React.act(async () =>
            root.render(
                React.createElement(CodeMirrorDocument, {
                    document: textDocument,
                    linkedRanges,
                    highlightedRanges,
                    onActiveLinkedRangesChange,
                }),
            ),
        );
        assert.equal(dom.window.document.querySelectorAll(".cm-highlighted-range").length, 1);

        // A new document object recreates CodeMirror and reapplies the latest ranges.
        const replacementDocument = {...textDocument};
        await React.act(async () =>
            root.render(
                React.createElement(CodeMirrorDocument, {
                    document: replacementDocument,
                    linkedRanges,
                    highlightedRanges,
                    onActiveLinkedRangesChange,
                }),
            ),
        );
        assert.ok(dom.window.document.querySelector(".cm-linked-range"));
        assert.equal(dom.window.document.querySelectorAll(".cm-highlighted-range").length, 1);

        // The caret reports every shortest linked range at its offset and clears them on blur.
        const content = dom.window.document.querySelector<HTMLElement>(".cm-content");
        assert.ok(content);
        content.focus();
        assert.deepEqual(activeLinkedRangeUpdates.at(-1), [innerRange]);
        content.dispatchEvent(new dom.window.KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true, cancelable: true}));
        assert.deepEqual(activeLinkedRangeUpdates.at(-1), [innerRange, tiedRange]);
        content.blur();
        assert.deepEqual(activeLinkedRangeUpdates.at(-1), []);
        assert.equal(dom.window.document.querySelector(".cm-search"), null);

        // A request token opens search and transfers focus to its primary field.
        await React.act(async () =>
            root.render(
                React.createElement(CodeMirrorDocument, {
                    document: replacementDocument,
                    linkedRanges,
                    highlightedRanges,
                    onActiveLinkedRangesChange,
                    searchRequest: 1,
                }),
            ),
        );
        const searchField = dom.window.document.querySelector<HTMLInputElement>("input[name=search]");
        assert.ok(searchField);
        assert.equal(dom.window.document.activeElement, searchField);

        // A later token must refocus an already-open search panel.
        content.focus();
        await React.act(async () =>
            root.render(
                React.createElement(CodeMirrorDocument, {
                    document: replacementDocument,
                    linkedRanges,
                    highlightedRanges,
                    onActiveLinkedRangesChange,
                    searchRequest: 2,
                }),
            ),
        );
        assert.equal(dom.window.document.activeElement, searchField);

        // The standard keyboard shortcut remains installed alongside programmatic search.
        content.dispatchEvent(new dom.window.KeyboardEvent("keydown", {key: "f", ctrlKey: true, bubbles: true}));
        assert.ok(dom.window.document.querySelector(".cm-search"));
    } finally {
        // Restore process-wide globals so later tests receive their original environment.
        await React.act(async () => root.unmount());
        dom.window.close();
        if (previousActEnvironment === undefined) Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
        else Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
        if (previousReact === undefined) Reflect.deleteProperty(globalThis, "React");
        else Object.defineProperty(globalThis, "React", previousReact);
        for (const [name, descriptor] of previousGlobals) {
            if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
            else Object.defineProperty(globalThis, name, descriptor);
        }
    }
});
