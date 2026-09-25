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
    // CodeMirror measures text ranges while processing requestMeasure callbacks; jsdom does not implement this geometry.
    Object.defineProperty(dom.window.Range.prototype, "getClientRects", {configurable: true, value: () => []});

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

const viewportRectangle = {top: 0, right: 100, bottom: 100, left: 0, width: 100, height: 100, x: 0, y: 0};

function setClientRectangles(
    element: HTMLElement,
    rectangles: readonly {top: number; right: number; bottom: number; left: number}[],
) {
    Object.defineProperty(element, "getClientRects", {configurable: true, value: () => rectangles});
}

function highlightedMark(view: EditorView, from: number, to: number): HTMLElement {
    const mark = view.dom.querySelector<HTMLElement>(
        `.cm-highlighted-range[data-highlight-from="${from}"][data-highlight-to="${to}"]`,
    );
    assert.ok(mark);
    return mark;
}

async function updateOffscreenIndicators() {
    await new Promise((resolve) => requestAnimationFrame(resolve));
}

function captureHighlightReveal(view: EditorView): {from: number; to: number} | undefined {
    const originalDispatch = view.dispatch;
    let revealedRange: {from: number; to: number} | undefined;
    Object.defineProperty(view, "dispatch", {
        configurable: true,
        value: (spec: {effects?: unknown | readonly unknown[]}) => {
            const effect = Array.isArray(spec.effects) ? spec.effects[0] : spec.effects;
            const range = (effect as {value?: {range?: {from: number; to: number}}} | undefined)?.value?.range;
            if (range !== undefined) revealedRange = {from: range.from, to: range.to};
        },
    });
    try {
        rangeLinking.revealHighlightedRange(view);
    } finally {
        Object.defineProperty(view, "dispatch", {configurable: true, value: originalDispatch});
    }
    return revealedRange;
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

// Follow navigation uses native smooth scrolling and honors the user's reduced-motion preference.
test("range linking smoothly scrolls highlighted ranges into view", () => {
    const editor = createTestEditor("0123456789", [rangeLinking.extension()]);
    const {dom, view} = editor;
    try {
        Object.defineProperty(view.scrollDOM, "getBoundingClientRect", {configurable: true, value: () => viewportRectangle});
        // The client box excludes the horizontal scrollbar and is the actual vertically visible text area.
        Object.defineProperty(view.scrollDOM, "clientHeight", {configurable: true, value: 80});
        view.dispatch({effects: rangeLinking.setHighlightedRanges.of([{documentId: "query", from: 2, to: 5}])});
        setClientRectangles(highlightedMark(view, 2, 5), [{top: 150, right: 40, bottom: 170, left: 20}]);
        const scrollRequests: ScrollToOptions[] = [];
        Object.defineProperty(view.scrollDOM, "scrollTo", {
            configurable: true,
            value: (options: ScrollToOptions) => scrollRequests.push(options),
        });

        rangeLinking.revealHighlightedRange(view);
        const smoothScrollHandler = view.state.facet(EditorView.scrollHandler)[0];
        assert.ok(smoothScrollHandler);
        assert.equal(
            smoothScrollHandler(view, EditorSelection.range(2, 5), {
                x: "nearest",
                y: "center",
                xMargin: 5,
                yMargin: 5,
            }),
            true,
        );
        assert.deepEqual(scrollRequests, [{top: 120, left: 0, behavior: "smooth"}]);

        Object.defineProperty(dom.window, "matchMedia", {
            configurable: true,
            value: () => ({matches: true}),
        });
        rangeLinking.revealHighlightedRange(view);
        smoothScrollHandler(view, EditorSelection.range(2, 5), {x: "nearest", y: "center", xMargin: 5, yMargin: 5});
        assert.equal(scrollRequests.at(-1)?.behavior, "auto");
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

// Following chooses the geometrically nearest highlight rather than CodeMirror's first rendered offscreen range.
test("highlight navigation targets the nearest entirely offscreen range", () => {
    const editor = createTestEditor("012345678901234567890123456789", [rangeLinking.extension()]);
    const {view} = editor;
    try {
        Object.defineProperty(view.scrollDOM, "getBoundingClientRect", {configurable: true, value: () => viewportRectangle});
        view.dispatch({
            effects: rangeLinking.setHighlightedRanges.of([
                {documentId: "query", from: 2, to: 4},
                {documentId: "query", from: 20, to: 22},
            ]),
        });
        setClientRectangles(highlightedMark(view, 2, 4), [{top: -220, right: 60, bottom: -200, left: 40}]);
        setClientRectangles(highlightedMark(view, 20, 22), [{top: 110, right: 60, bottom: 130, left: 40}]);

        assert.deepEqual(captureHighlightReveal(view), {from: 20, to: 22});
    } finally {
        editor.destroy();
    }
});

// A highlight hidden by folding navigates to its rendered placeholder instead of unfolding or targeting invisible text.
test("highlight navigation targets the containing fold placeholder", () => {
    const editor = createTestEditor("a hidden value", [codeFolding(), rangeLinking.extension()]);
    const {view} = editor;
    try {
        Object.defineProperty(view.scrollDOM, "getBoundingClientRect", {configurable: true, value: () => viewportRectangle});
        view.dispatch({effects: foldEffect.of({from: 2, to: 8})});
        view.dispatch({effects: rangeLinking.setHighlightedRanges.of([{documentId: "query", from: 3, to: 6}])});
        const placeholder = view.dom.querySelector<HTMLElement>(".cm-foldPlaceholder");
        assert.ok(placeholder);
        setClientRectangles(placeholder, [{top: 110, right: 60, bottom: 130, left: 40}]);

        assert.deepEqual(captureHighlightReveal(view), {from: 2, to: 2});
    } finally {
        editor.destroy();
    }
});

// Actual screen geometry overrides CodeMirror's larger rendered range, which includes offscreen margins.
test("highlight navigation does not mistake rendered offscreen text for visible text", () => {
    const editor = createTestEditor("0123456789", [rangeLinking.extension()]);
    const {view} = editor;
    try {
        view.dispatch({effects: rangeLinking.setHighlightedRanges.of([{documentId: "query", from: 5, to: 8}])});
        Object.defineProperty(view, "visibleRanges", {configurable: true, value: [{from: 0, to: 10}]});
        Object.defineProperty(view.scrollDOM, "getBoundingClientRect", {
            configurable: true,
            value: () => ({top: 0, right: 100, bottom: 100, left: 0, width: 100, height: 100, x: 0, y: 0}),
        });
        const highlightedMark = view.dom.querySelector<HTMLElement>(".cm-highlighted-range");
        assert.ok(highlightedMark);
        Object.defineProperty(highlightedMark, "getClientRects", {
            configurable: true,
            value: () => [{top: 150, right: 220, bottom: 170, left: 200}],
        });
        let navigationRequests = 0;
        Object.defineProperty(view, "dispatch", {
            configurable: true,
            value: () => navigationRequests++,
        });

        rangeLinking.revealHighlightedRange(view);
        assert.equal(navigationRequests, 1);
    } finally {
        editor.destroy();
    }
});

// A rendered fragment in the viewport suppresses navigation even when a larger range's endpoints are not rendered.
test("highlight navigation recognizes the visible middle of a larger range", () => {
    const editor = createTestEditor("0123456789", [rangeLinking.extension()]);
    const {view} = editor;
    try {
        view.dispatch({effects: rangeLinking.setHighlightedRanges.of([{documentId: "query", from: 1, to: 9}])});
        Object.defineProperty(view.scrollDOM, "getBoundingClientRect", {
            configurable: true,
            value: () => ({top: 0, right: 100, bottom: 100, left: 0, width: 100, height: 100, x: 0, y: 0}),
        });
        const highlightedMark = view.dom.querySelector<HTMLElement>(".cm-highlighted-range");
        assert.ok(highlightedMark);
        Object.defineProperty(highlightedMark, "getClientRects", {
            configurable: true,
            value: () => [{top: 20, right: 80, bottom: 40, left: 20}],
        });
        Object.defineProperty(view, "coordsAtPos", {configurable: true, value: () => null});
        let navigationRequests = 0;
        Object.defineProperty(view, "dispatch", {
            configurable: true,
            value: () => navigationRequests++,
        });

        rangeLinking.revealHighlightedRange(view);
        assert.equal(navigationRequests, 0);
    } finally {
        editor.destroy();
    }
});

// A tiny edge sliver remains offscreen for following purposes, while a substantial fragment suppresses navigation.
test("highlight navigation requires a meaningful visible fragment", () => {
    const editor = createTestEditor("0123456789", [rangeLinking.extension()]);
    const {view} = editor;
    try {
        Object.defineProperty(view.scrollDOM, "getBoundingClientRect", {configurable: true, value: () => viewportRectangle});
        view.dispatch({effects: rangeLinking.setHighlightedRanges.of([{documentId: "query", from: 2, to: 5}])});
        const mark = highlightedMark(view, 2, 5);
        let navigationRequests = 0;
        const originalDispatch = view.dispatch;
        Object.defineProperty(view, "dispatch", {configurable: true, value: () => navigationRequests++});

        setClientRectangles(mark, [{top: -18, right: 40, bottom: 2, left: 20}]);
        rangeLinking.revealHighlightedRange(view);
        assert.equal(navigationRequests, 1);

        setClientRectangles(mark, [{top: -4, right: 40, bottom: 12, left: 20}]);
        rangeLinking.revealHighlightedRange(view);
        assert.equal(navigationRequests, 1);
        Object.defineProperty(view, "dispatch", {configurable: true, value: originalDispatch});
    } finally {
        editor.destroy();
    }
});

// Every offscreen member gets a directional cue even when another member in the same highlight group is visible.
test("offscreen highlight indicators aggregate independent directions", async () => {
    const editor = createTestEditor("0123456789012345678901234567890123456789", [rangeLinking.extension()]);
    const {dom, view} = editor;
    try {
        Object.defineProperty(view.dom, "getBoundingClientRect", {configurable: true, value: () => viewportRectangle});
        Object.defineProperty(view.scrollDOM, "getBoundingClientRect", {configurable: true, value: () => viewportRectangle});
        const gutter = dom.window.document.createElement("div");
        gutter.className = "cm-gutters";
        Object.defineProperty(gutter, "getBoundingClientRect", {
            configurable: true,
            value: () => ({...viewportRectangle, right: 18, width: 18}),
        });
        view.dom.append(gutter);
        view.dispatch({
            effects: rangeLinking.setHighlightedRanges.of([
                {documentId: "query", from: 0, to: 2},
                {documentId: "query", from: 4, to: 6},
                {documentId: "query", from: 8, to: 10},
                {documentId: "query", from: 12, to: 14},
                {documentId: "query", from: 16, to: 18},
                {documentId: "query", from: 20, to: 22},
            ]),
        });
        setClientRectangles(highlightedMark(view, 0, 2), [{top: 20, right: 40, bottom: 40, left: 20}]);
        setClientRectangles(highlightedMark(view, 4, 6), [{top: -30, right: 60, bottom: -10, left: 40}]);
        setClientRectangles(highlightedMark(view, 8, 10), [{top: 110, right: 60, bottom: 130, left: 40}]);
        setClientRectangles(highlightedMark(view, 12, 14), [{top: 140, right: 60, bottom: 160, left: 40}]);
        setClientRectangles(highlightedMark(view, 16, 18), [{top: 40, right: -10, bottom: 60, left: -30}]);
        setClientRectangles(highlightedMark(view, 20, 22), [{top: 40, right: 130, bottom: 60, left: 110}]);
        await updateOffscreenIndicators();

        const indicator = (direction: string) =>
            view.dom.querySelector<HTMLElement>(`.cm-offscreen-highlight-indicator[data-direction="${direction}"]`);
        assert.equal(indicator("above")?.textContent, "↑ 1");
        assert.equal(indicator("below")?.textContent, "↓ 2");
        assert.equal(indicator("left")?.textContent, "← 1");
        assert.equal(indicator("right")?.textContent, "→ 1");
        assert.ok(["above", "right", "below", "left"].every((direction) => indicator(direction)?.hidden === false));
        const indicatorOverlay = view.dom.querySelector<HTMLElement>(".cm-offscreen-highlight-indicators");
        assert.equal(indicatorOverlay?.style.left, "18px");
        assert.equal(indicatorOverlay?.style.width, "82px");
        assert.equal(
            indicatorOverlay?.getAttribute("aria-label"),
            "Offscreen highlights: 1 highlighted range above, 1 highlighted range right, 2 highlighted ranges below, 1 highlighted range left",
        );

        // Scrolling must refresh the cues even when neither the document nor its highlighted ranges change.
        setClientRectangles(highlightedMark(view, 4, 6), [{top: 20, right: 60, bottom: 40, left: 40}]);
        view.scrollDOM.dispatchEvent(new dom.window.Event("scroll"));
        await updateOffscreenIndicators();
        assert.equal(indicator("above")?.hidden, true);
    } finally {
        editor.destroy();
    }
});

// A diagonally offscreen range gets one vertical cue; horizontal cues are reserved for vertically visible ranges.
test("offscreen highlight indicators prioritize the vertical direction", async () => {
    const editor = createTestEditor("0123456789", [rangeLinking.extension()]);
    const {view} = editor;
    try {
        Object.defineProperty(view.dom, "getBoundingClientRect", {configurable: true, value: () => viewportRectangle});
        Object.defineProperty(view.scrollDOM, "getBoundingClientRect", {configurable: true, value: () => viewportRectangle});
        view.dispatch({effects: rangeLinking.setHighlightedRanges.of([{documentId: "query", from: 2, to: 5}])});
        setClientRectangles(highlightedMark(view, 2, 5), [{top: 120, right: 140, bottom: 140, left: 120}]);
        await updateOffscreenIndicators();

        const indicator = (direction: string) =>
            view.dom.querySelector<HTMLElement>(`.cm-offscreen-highlight-indicator[data-direction="${direction}"]`);
        assert.equal(indicator("below")?.textContent, "↓ 1");
        assert.equal(indicator("above")?.hidden, true);
        assert.equal(indicator("left")?.hidden, true);
        assert.equal(indicator("right")?.hidden, true);
    } finally {
        editor.destroy();
    }
});

// Multiple source ranges hidden by one fold produce one cue for their shared visual placeholder.
test("offscreen highlight indicators deduplicate folded ranges", async () => {
    const editor = createTestEditor("a hidden value", [codeFolding(), rangeLinking.extension()]);
    const {view} = editor;
    try {
        Object.defineProperty(view.dom, "getBoundingClientRect", {configurable: true, value: () => viewportRectangle});
        Object.defineProperty(view.scrollDOM, "getBoundingClientRect", {configurable: true, value: () => viewportRectangle});
        view.dispatch({effects: foldEffect.of({from: 2, to: 8})});
        view.dispatch({
            effects: rangeLinking.setHighlightedRanges.of([
                {documentId: "query", from: 3, to: 4},
                {documentId: "query", from: 5, to: 7},
            ]),
        });
        const placeholder = view.dom.querySelector<HTMLElement>(".cm-foldPlaceholder");
        assert.ok(placeholder);
        setClientRectangles(placeholder, [{top: -30, right: 60, bottom: -10, left: 40}]);
        await updateOffscreenIndicators();

        const above = view.dom.querySelector<HTMLElement>('.cm-offscreen-highlight-indicator[data-direction="above"]');
        assert.equal(above?.textContent, "↑ 1");
    } finally {
        editor.destroy();
    }
});
