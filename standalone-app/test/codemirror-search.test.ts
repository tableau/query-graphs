import assert from "node:assert/strict";
import test from "node:test";
import {searchKeymap, searchPanelOpen} from "@codemirror/search";
import {EditorState} from "@codemirror/state";
import {EditorView, keymap} from "@codemirror/view";
import {JSDOM} from "jsdom";
import {compactSearch} from "../src/CodeMirrorSearch";

test("the compact search panel exposes labeled, match-aware controls", () => {
    // CodeMirror reads browser APIs from the global scope. Install JSDOM's
    // implementations temporarily, preserving anything the test process had.
    const dom = new JSDOM("<main></main>", {pretendToBeVisual: true});
    const globalNames = ["window", "document", "MutationObserver", "requestAnimationFrame", "cancelAnimationFrame"] as const;
    const previousGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    for (const name of globalNames)
        Object.defineProperty(globalThis, name, {configurable: true, writable: true, value: dom.window[name]});

    // Exercise the same read-only editor extensions used by the application.
    const view = new EditorView({
        parent: dom.window.document.querySelector("main") ?? undefined,
        state: EditorState.create({
            doc: "select customer from customer_orders",
            extensions: [compactSearch, keymap.of(searchKeymap), EditorState.readOnly.of(true)],
        }),
    });
    try {
        // Open the panel through CodeMirror's real search keymap instead of
        // constructing CompactSearchPanel directly.
        view.focus();
        view.contentDOM.dispatchEvent(
            new dom.window.KeyboardEvent("keydown", {key: "f", ctrlKey: true, bubbles: true, cancelable: true}),
        );

        assert.equal(searchPanelOpen(view.state), true);
        // Icon-only controls and terse toggles need discoverable tooltips.
        const expectedTitles = new Map([
            ["button[name=prev]", "Previous match (Shift+Enter)"],
            ["button[name=next]", "Next match (Enter)"],
            ["label:has(input[name=case])", "Match case"],
            ["label:has(input[name=regexp])", "Use regular expression"],
            ["label:has(input[name=word])", "Match whole word"],
            ["button[name=close]", "Close search"],
        ]);
        for (const [selector, title] of expectedTitles) {
            const control = view.dom.querySelector<HTMLElement>(selector);
            assert.ok(control, `missing ${selector}`);
            assert.equal(control.title, title);
        }

        const searchField = view.dom.querySelector<HTMLInputElement>("input[name=search]");
        const resultButtons = [...view.dom.querySelectorAll<HTMLButtonElement>("button:not([name=close])")];
        assert.ok(searchField);
        // Navigation starts disabled because an empty query has no matches.
        assert.ok(resultButtons.every((button) => button.disabled));

        // Input events update CodeMirror's search state, enabling navigation
        // and letting its search extension render all matching ranges.
        searchField.value = "customer";
        searchField.dispatchEvent(new dom.window.Event("input", {bubbles: true}));
        assert.ok(resultButtons.every((button) => !button.disabled));
        assert.equal(view.dom.querySelectorAll(".cm-searchMatch").length, 2);

        // A valid query with no matches disables both navigation directions.
        searchField.value = "missing";
        searchField.dispatchEvent(new dom.window.Event("input", {bubbles: true}));
        assert.ok(resultButtons.every((button) => button.disabled));

        const regexpCheckbox = view.dom.querySelector<HTMLInputElement>("input[name=regexp]");
        const invalidStatus = view.dom.querySelector<HTMLElement>(".compact-search-status");
        assert.ok(regexpCheckbox);
        assert.ok(invalidStatus);
        // A malformed, non-empty regular expression is exposed visually and
        // to assistive technology.
        regexpCheckbox.checked = true;
        regexpCheckbox.dispatchEvent(new dom.window.Event("change", {bubbles: true}));
        searchField.value = "[";
        searchField.dispatchEvent(new dom.window.Event("input", {bubbles: true}));
        assert.equal(searchField.getAttribute("aria-invalid"), "true");
        assert.equal(searchField.title, "Invalid regular expression");
        assert.equal(invalidStatus.textContent, "Invalid regular expression");

        // Correcting the expression must remove every stale error indicator.
        searchField.value = "[a]";
        searchField.dispatchEvent(new dom.window.Event("input", {bubbles: true}));
        assert.equal(searchField.hasAttribute("aria-invalid"), false);
        assert.equal(searchField.hasAttribute("title"), false);
        assert.equal(invalidStatus.textContent, "");
    } finally {
        // Always release CodeMirror/JSDOM resources and avoid leaking mocked
        // browser globals into subsequent tests.
        view.destroy();
        dom.window.close();
        for (const [name, descriptor] of previousGlobals) {
            if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
            else Object.defineProperty(globalThis, name, descriptor);
        }
    }
});
