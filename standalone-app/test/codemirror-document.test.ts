import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import test from "node:test";
import * as React from "react";
import {createRoot} from "react-dom/client";
import {JSDOM} from "jsdom";
import {color as oneDarkColor} from "@codemirror/theme-one-dark";
import {settingsStore} from "../src/settings";
import type {CodeMirrorDocumentProps} from "../src/CodeMirrorDocument";
import type {SettingsValues} from "../src/settings";

// Node does not load CSS, so replace stylesheet imports with empty modules.
registerHooks({
    load(url, context, nextLoad) {
        if (url.endsWith(".css")) return {format: "module", source: "", shortCircuit: true};
        return nextLoad(url, context);
    },
});

const textDocument = {id: "query", title: "SQL", text: "SELECT value", language: "sql"};
const innerRange = {documentId: "query", from: 0, to: 6};
const tiedRange = {documentId: "query", from: 1, to: 7};
const outerRange = {documentId: "query", from: 0, to: 12};
const linkedRanges = [innerRange, tiedRange, outerRange];
const highlightedRanges = [{documentId: "query", from: 7, to: 12}];

async function createFixture() {
    // Import after registering the CSS hook because the component imports its stylesheet eagerly.
    const {CodeMirrorDocument} = await import("../src/CodeMirrorDocument");
    const {ThemeContext, useResolvedThemeSetting} = await import("../src/theme");
    function TestThemeHost({children}: {children: React.ReactNode}) {
        const theme = useResolvedThemeSetting();
        return React.createElement(ThemeContext.Provider, {value: theme}, children);
    }
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
    let darkSystemTheme = false;
    const colorSchemeQuery = "(prefers-color-scheme: dark)";
    const colorSchemeListeners = new Set<(event: MediaQueryListEvent) => void>();
    Object.defineProperty(dom.window, "matchMedia", {
        configurable: true,
        value: (query: string) => ({
            get matches() {
                return query === colorSchemeQuery && darkSystemTheme;
            },
            addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
                if (query === colorSchemeQuery) colorSchemeListeners.add(listener);
            },
            removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
                if (query === colorSchemeQuery) colorSchemeListeners.delete(listener);
            },
        }),
    });
    // jsdom has no layout; an empty rectangle list is sufficient for these editor interactions.
    Object.defineProperty(dom.window.Range.prototype, "getClientRects", {configurable: true, value: () => []});
    const previousActEnvironment = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    const previousReact = Object.getOwnPropertyDescriptor(globalThis, "React");
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {configurable: true, writable: true, value: true});
    Object.defineProperty(globalThis, "React", {configurable: true, writable: true, value: React});
    settingsStore.getState().resetSettings();

    // Record callbacks so caret movement can be checked independently of rendered decorations.
    const activeLinkedRangeUpdates: {documentId: string; from: number; to: number}[][] = [];
    const root = createRoot(dom.window.document.querySelector("main")!);
    const onActiveLinkedRangesChange = (activeLinkedRanges: readonly {documentId: string; from: number; to: number}[]) =>
        activeLinkedRangeUpdates.push([...activeLinkedRanges]);
    const render = async (props: Partial<CodeMirrorDocumentProps> = {}) => {
        await React.act(async () =>
            root.render(
                React.createElement(
                    TestThemeHost,
                    null,
                    React.createElement(CodeMirrorDocument, {
                        document: textDocument,
                        linkedRanges,
                        highlightedRanges: [],
                        onActiveLinkedRangesChange,
                        ...props,
                    }),
                ),
            ),
        );
    };
    const cleanup = async () => {
        // Restore process-wide globals so later tests receive their original environment.
        await React.act(async () => root.unmount());
        settingsStore.getState().resetSettings();
        dom.window.close();
        if (previousActEnvironment === undefined) Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
        else Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
        if (previousReact === undefined) Reflect.deleteProperty(globalThis, "React");
        else Object.defineProperty(globalThis, "React", previousReact);
        for (const [name, descriptor] of previousGlobals) {
            if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
            else Object.defineProperty(globalThis, name, descriptor);
        }
    };

    return {
        activeLinkedRangeUpdates,
        cleanup,
        dom,
        render,
        setSettings: async (settings: Partial<SettingsValues>) => {
            await React.act(async () => settingsStore.getState().setSettings(settings));
        },
        setSystemTheme: async (theme: "light" | "dark") => {
            await React.act(async () => {
                darkSystemTheme = theme === "dark";
                for (const listener of colorSchemeListeners)
                    listener({matches: darkSystemTheme, media: colorSchemeQuery} as MediaQueryListEvent);
            });
        },
    };
}

test("the document editor synchronizes range decorations across prop and document changes", async () => {
    const fixture = await createFixture();
    try {
        // Initial linked ranges render without an active graph highlight.
        await fixture.render();
        assert.ok(fixture.dom.window.document.querySelector(".cm-linked-range"));
        assert.equal(fixture.dom.window.document.querySelectorAll(".cm-highlighted-range").length, 0);

        // Updating only the highlight prop must update decorations in the existing editor.
        await fixture.render({highlightedRanges});
        assert.equal(fixture.dom.window.document.querySelectorAll(".cm-highlighted-range").length, 1);

        // A new document object recreates CodeMirror and reapplies the latest ranges.
        await fixture.render({document: {...textDocument}, highlightedRanges});
        assert.ok(fixture.dom.window.document.querySelector(".cm-linked-range"));
        assert.equal(fixture.dom.window.document.querySelectorAll(".cm-highlighted-range").length, 1);
    } finally {
        await fixture.cleanup();
    }
});

test("the document editor reports linked ranges at the focused caret", async () => {
    const fixture = await createFixture();
    try {
        await fixture.render();

        // The caret reports every shortest linked range at its offset and clears them on blur.
        const content = fixture.dom.window.document.querySelector<HTMLElement>(".cm-content");
        assert.ok(content);
        content.focus();
        assert.deepEqual(fixture.activeLinkedRangeUpdates.at(-1), [innerRange]);
        content.dispatchEvent(
            new fixture.dom.window.KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true, cancelable: true}),
        );
        assert.deepEqual(fixture.activeLinkedRangeUpdates.at(-1), [innerRange, tiedRange]);
        content.blur();
        assert.deepEqual(fixture.activeLinkedRangeUpdates.at(-1), []);
    } finally {
        await fixture.cleanup();
    }
});

test("a search request opens and refocuses the search panel", async () => {
    const fixture = await createFixture();
    try {
        await fixture.render();
        const content = fixture.dom.window.document.querySelector<HTMLElement>(".cm-content");
        assert.ok(content);
        assert.equal(fixture.dom.window.document.querySelector(".cm-search"), null);

        // A request token opens search and transfers focus to its primary field.
        await fixture.render({searchRequest: 1});
        const searchField = fixture.dom.window.document.querySelector<HTMLInputElement>("input[name=search]");
        assert.ok(searchField);
        assert.equal(fixture.dom.window.document.activeElement, searchField);

        // A later token must refocus an already-open search panel.
        content.focus();
        await fixture.render({searchRequest: 2});
        assert.equal(fixture.dom.window.document.activeElement, searchField);
    } finally {
        await fixture.cleanup();
    }
});

test("the standard keyboard shortcut opens the search panel", async () => {
    const fixture = await createFixture();
    try {
        await fixture.render();
        const content = fixture.dom.window.document.querySelector<HTMLElement>(".cm-content");
        assert.ok(content);

        // Programmatic search must not displace CodeMirror's standard search keymap.
        content.dispatchEvent(new fixture.dom.window.KeyboardEvent("keydown", {key: "f", ctrlKey: true, bubbles: true}));
        assert.ok(fixture.dom.window.document.querySelector(".cm-search"));
    } finally {
        await fixture.cleanup();
    }
});

test("editor settings reconfigure the existing document editor", async () => {
    const fixture = await createFixture();
    try {
        await fixture.render();
        const editor = fixture.dom.window.document.querySelector<HTMLElement>(".cm-editor");
        const content = fixture.dom.window.document.querySelector<HTMLElement>(".cm-content");
        assert.ok(editor);
        assert.ok(content);
        const lightThemeClasses = editor.className;

        await fixture.setSystemTheme("dark");
        assert.equal(fixture.dom.window.document.querySelector(".cm-editor"), editor);
        assert.notEqual(editor.className, lightThemeClasses);
        const darkThemeStyle = fixture.dom.window.getComputedStyle(editor);
        assert.equal(darkThemeStyle.getPropertyValue("--qg-control-hover-background"), oneDarkColor.highlightBackground);
        assert.equal(darkThemeStyle.getPropertyValue("--qg-control-active-background"), oneDarkColor.selection);
        assert.equal(darkThemeStyle.getPropertyValue("--qg-control-active-border"), oneDarkColor.cursor);
        assert.equal(darkThemeStyle.getPropertyValue("--qg-linked-range-color"), oneDarkColor.malibu);
        assert.equal(darkThemeStyle.getPropertyValue("--qg-highlighted-range-background"), oneDarkColor.selection);

        content.focus();
        await fixture.setSettings({editorKeybindings: "vim"});
        const documentText = content.textContent;
        content.dispatchEvent(new fixture.dom.window.KeyboardEvent("keydown", {key: "x", bubbles: true}));
        assert.equal(content.textContent, documentText);
        content.dispatchEvent(new fixture.dom.window.KeyboardEvent("keydown", {key: "l", bubbles: true}));
        assert.deepEqual(fixture.activeLinkedRangeUpdates.at(-1), [innerRange, tiedRange]);

        content.dispatchEvent(new fixture.dom.window.KeyboardEvent("keydown", {key: "h", bubbles: true}));
        await fixture.setSettings({editorKeybindings: "emacs"});
        content.dispatchEvent(
            new fixture.dom.window.KeyboardEvent("keydown", {key: "f", code: "KeyF", ctrlKey: true, bubbles: true}),
        );
        assert.deepEqual(fixture.activeLinkedRangeUpdates.at(-1), [innerRange, tiedRange]);
        content.dispatchEvent(
            new fixture.dom.window.KeyboardEvent("keydown", {key: "k", code: "KeyK", ctrlKey: true, bubbles: true}),
        );
        assert.equal(content.textContent, documentText);
    } finally {
        await fixture.cleanup();
    }
});
