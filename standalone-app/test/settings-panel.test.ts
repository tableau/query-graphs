import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import test from "node:test";
import {JSDOM} from "jsdom";
import * as React from "react";
import {createRoot} from "react-dom/client";

registerHooks({
    load(url, context, nextLoad) {
        if (url.endsWith(".css")) return {format: "module", source: "", shortCircuit: true};
        return nextLoad(url, context);
    },
});

async function renderSettingsPanel() {
    const dom = new JSDOM("<main></main>", {pretendToBeVisual: true});
    const globalNames = ["window", "document", "Node", "HTMLElement", "Event"] as const;
    const previousGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    for (const name of globalNames)
        Object.defineProperty(globalThis, name, {configurable: true, writable: true, value: dom.window[name]});
    let reducedMotion = false;
    const motionListeners = new Set<() => void>();
    Object.defineProperty(dom.window, "matchMedia", {
        configurable: true,
        value: () => ({
            get matches() {
                return reducedMotion;
            },
            addEventListener: (_type: string, listener: () => void) => motionListeners.add(listener),
            removeEventListener: (_type: string, listener: () => void) => motionListeners.delete(listener),
        }),
    });
    const previousActEnvironment = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    const previousReact = Object.getOwnPropertyDescriptor(globalThis, "React");
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {configurable: true, writable: true, value: true});
    Object.defineProperty(globalThis, "React", {configurable: true, writable: true, value: React});
    const root = createRoot(dom.window.document.querySelector("main")!);
    const popoverId = "settings-test";
    const {SettingsButton, SettingsPanel} = await import("../src/SettingsPanel");
    await React.act(async () =>
        root.render(
            React.createElement(
                React.Fragment,
                null,
                React.createElement(SettingsButton, {popoverId}),
                React.createElement(SettingsPanel, {popoverId}),
            ),
        ),
    );
    return {
        document: dom.window.document,
        popoverId,
        setReducedMotion: async (value: boolean) => {
            await React.act(async () => {
                reducedMotion = value;
                for (const listener of motionListeners) listener();
            });
        },
        cleanup: async () => {
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
        },
    };
}

test("settings button and panel form a labelled automatic popover", async () => {
    const rendered = await renderSettingsPanel();
    try {
        const openButton = rendered.document.querySelector<HTMLButtonElement>(`.qg-settings-button`);
        const panel = rendered.document.getElementById(rendered.popoverId);
        const closeButton = panel?.querySelector<HTMLButtonElement>(`.qg-settings-close`);
        assert.equal(openButton?.getAttribute("popovertarget"), rendered.popoverId);
        assert.equal(openButton?.getAttribute("aria-label"), "Settings");
        assert.equal(openButton?.hasAttribute("title"), false);
        assert.equal(openButton?.getAttribute("aria-haspopup"), "dialog");
        assert.equal(openButton?.nextElementSibling?.getAttribute("role"), "tooltip");
        assert.equal(openButton?.nextElementSibling?.textContent, "Settings");
        assert.equal(panel?.getAttribute("popover"), "auto");
        assert.equal(panel?.getAttribute("role"), "dialog");
        assert.equal(panel?.getAttribute("aria-labelledby"), panel?.querySelector("h2")?.id);
        assert.equal(closeButton?.getAttribute("popovertarget"), rendered.popoverId);
        assert.equal(closeButton?.getAttribute("popovertargetaction"), "hide");
        assert.equal(panel?.querySelector(".qg-settings-body")?.lastElementChild?.tagName, "FOOTER");
    } finally {
        await rendered.cleanup();
    }
});

test("settings panel offers every application setting and a reset action", async () => {
    const rendered = await renderSettingsPanel();
    try {
        const panel = rendered.document.getElementById(rendered.popoverId);
        const optionsByLabel = new Map(
            [...(panel?.querySelectorAll<HTMLLabelElement>("label") ?? [])].map((label) => [
                label.querySelector("span")?.textContent,
                [...(label.querySelector("select")?.options ?? [])].map(({value, text}) => [value, text]),
            ]),
        );
        assert.deepEqual(optionsByLabel.get("Graph animation speed"), [
            ["off", "Off"],
            ["fast", "Fast"],
            ["medium", "Medium"],
            ["slow", "Slow"],
            ["debug", "Debug"],
        ]);
        assert.deepEqual(optionsByLabel.get("CodeMirror theme"), [
            ["system", "System"],
            ["light", "Light"],
            ["dark", "Dark"],
        ]);
        assert.deepEqual(optionsByLabel.get("CodeMirror keybindings"), [
            ["standard", "Standard"],
            ["vim", "Vim"],
            ["emacs", "Emacs"],
        ]);
        assert.equal(panel?.querySelector("footer button")?.textContent, "Reset to defaults");
    } finally {
        await rendered.cleanup();
    }
});

test("settings panel reactively explains the system reduced-motion override", async () => {
    const rendered = await renderSettingsPanel();
    try {
        const panel = rendered.document.getElementById(rendered.popoverId);
        const select = panel?.querySelector<HTMLSelectElement>(`select`);
        assert.equal(panel?.querySelector(".qg-settings-note"), null);
        assert.equal(select?.hasAttribute("aria-describedby"), false);

        await rendered.setReducedMotion(true);
        const note = panel?.querySelector<HTMLElement>(".qg-settings-note");
        assert.equal(note?.textContent?.trim(), "Animations are disabled by your system’s reduced-motion setting.");
        assert.equal(select?.getAttribute("aria-describedby"), note?.id);
    } finally {
        await rendered.cleanup();
    }
});
