import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import test from "node:test";
import * as React from "react";
import {createRoot} from "react-dom/client";
import {JSDOM} from "jsdom";

registerHooks({
    load(url, context, nextLoad) {
        if (url.endsWith(".css")) return {format: "module", source: "", shortCircuit: true};
        return nextLoad(url, context);
    },
});

test("the document editor synchronizes and activates linked ranges", async () => {
    const {CodeMirrorDocument} = await import("../src/CodeMirrorDocument");
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
        "KeyboardEvent",
    ] as const;
    const previousGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    for (const name of globalNames)
        Object.defineProperty(globalThis, name, {configurable: true, writable: true, value: dom.window[name]});
    const previousActEnvironment = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    const previousReact = Object.getOwnPropertyDescriptor(globalThis, "React");
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {configurable: true, writable: true, value: true});
    Object.defineProperty(globalThis, "React", {configurable: true, writable: true, value: React});

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

        await React.act(async () =>
            root.render(
                React.createElement(CodeMirrorDocument, {
                    document: {...textDocument},
                    linkedRanges,
                    highlightedRanges,
                    onActiveLinkedRangesChange,
                }),
            ),
        );
        assert.ok(dom.window.document.querySelector(".cm-linked-range"));
        assert.equal(dom.window.document.querySelectorAll(".cm-highlighted-range").length, 1);

        const content = dom.window.document.querySelector<HTMLElement>(".cm-content");
        assert.ok(content);
        content.focus();
        assert.deepEqual(activeLinkedRangeUpdates.at(-1), [innerRange]);
        content.dispatchEvent(new dom.window.KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true, cancelable: true}));
        assert.deepEqual(activeLinkedRangeUpdates.at(-1), [innerRange, tiedRange]);
        content.blur();
        assert.deepEqual(activeLinkedRangeUpdates.at(-1), []);

        content.dispatchEvent(new dom.window.KeyboardEvent("keydown", {key: "f", ctrlKey: true, bubbles: true}));
        assert.ok(dom.window.document.querySelector(".cm-search"));
    } finally {
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
