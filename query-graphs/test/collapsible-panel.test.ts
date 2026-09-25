import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import test from "node:test";
import * as React from "react";
import {createRoot} from "react-dom/client";
import {JSDOM} from "jsdom";
import type {CollapsiblePanelProps} from "../src/ui/CollapsiblePanel";

// Node does not load CSS, so replace stylesheet imports with empty modules.
registerHooks({
    load(url, context, nextLoad) {
        if (url.endsWith(".css")) return {format: "module", source: "", shortCircuit: true};
        return nextLoad(url, context);
    },
});

const controllednessError = "CollapsiblePanel must not switch between controlled and uncontrolled state.";

async function createFixture() {
    // Import after registering the CSS hook because the component imports its stylesheet eagerly.
    const {CollapsiblePanel} = await import("../src/ui/CollapsiblePanel");
    const dom = new JSDOM("<main></main>", {pretendToBeVisual: true});
    const globalNames = ["window", "document", "Node", "HTMLElement", "Event"] as const;
    const previousGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    for (const name of globalNames)
        Object.defineProperty(globalThis, name, {configurable: true, writable: true, value: dom.window[name]});
    const previousActEnvironment = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    const previousReact = Object.getOwnPropertyDescriptor(globalThis, "React");
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {configurable: true, writable: true, value: true});
    Object.defineProperty(globalThis, "React", {configurable: true, writable: true, value: React});

    const root = createRoot(dom.window.document.querySelector("main")!);
    const requestedStates: boolean[] = [];
    const render = async (props: Partial<CollapsiblePanelProps> = {}) => {
        const {children = "Content", ...renderProps} = props;
        await React.act(async () =>
            root.render(
                React.createElement(
                    CollapsiblePanel,
                    {
                        title: "Details",
                        onOpenChange: (nextOpen) => requestedStates.push(nextOpen),
                        ...renderProps,
                    },
                    children,
                ),
            ),
        );
    };
    const cleanup = async () => {
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
    };

    return {cleanup, dom, render, requestedStates};
}

test("an uncontrolled panel exposes and toggles its disclosure state", async () => {
    const fixture = await createFixture();
    try {
        await fixture.render({className: "custom-panel", highlighted: true});
        const panel = fixture.dom.window.document.querySelector<HTMLElement>(".qg-collapsible-panel");
        const toggle = fixture.dom.window.document.querySelector<HTMLButtonElement>(".qg-collapsible-panel-toggle");
        const content = fixture.dom.window.document.querySelector<HTMLElement>(".qg-collapsible-panel-content");
        assert.ok(panel);
        assert.ok(toggle);
        assert.ok(content);

        // The collapsed body remains mounted and is associated with the disclosure button.
        assert.ok(panel.classList.contains("custom-panel"));
        assert.ok(panel.classList.contains("qg-highlighted"));
        assert.equal(toggle.querySelector(".qg-collapsible-panel-title")?.textContent, "Details");
        assert.equal(toggle.querySelector("[aria-label='Needs attention']")?.textContent?.trim(), "!");
        assert.equal(toggle.type, "button");
        assert.equal(toggle.ariaExpanded, "false");
        assert.equal(toggle.getAttribute("aria-controls"), content.id);
        assert.ok(content.hidden);
        assert.equal(content.textContent, "Content");

        // Uncontrolled interaction updates both the rendered state and the change callback.
        await React.act(async () => toggle.click());
        assert.equal(toggle.ariaExpanded, "true");
        assert.ok(panel.hasAttribute("data-expanded"));
        assert.equal(content.hidden, false);
        await React.act(async () => toggle.click());
        assert.equal(toggle.ariaExpanded, "false");
        assert.equal(panel.hasAttribute("data-expanded"), false);
        assert.ok(content.hidden);
        assert.deepEqual(fixture.requestedStates, [true, false]);
    } finally {
        await fixture.cleanup();
    }
});

test("a controlled panel reports changes without changing itself", async () => {
    const fixture = await createFixture();
    try {
        await fixture.render({open: false});
        const toggle = fixture.dom.window.document.querySelector<HTMLButtonElement>(".qg-collapsible-panel-toggle");
        const content = fixture.dom.window.document.querySelector<HTMLElement>(".qg-collapsible-panel-content");
        assert.ok(toggle);
        assert.ok(content);

        // Interaction proposes a new value, while the controlling prop remains authoritative.
        await React.act(async () => toggle.click());
        assert.deepEqual(fixture.requestedStates, [true]);
        assert.equal(toggle.ariaExpanded, "false");
        assert.ok(content.hidden);

        await fixture.render({open: true});
        assert.equal(toggle.ariaExpanded, "true");
        assert.equal(content.hidden, false);
        await React.act(async () => toggle.click());
        assert.deepEqual(fixture.requestedStates, [true, false]);
        assert.equal(toggle.ariaExpanded, "true");

        await fixture.render({open: false});
        assert.equal(toggle.ariaExpanded, "false");
        assert.ok(content.hidden);
    } finally {
        await fixture.cleanup();
    }
});

test("header actions remain available without toggling the panel", async () => {
    const fixture = await createFixture();
    let actionClicks = 0;
    try {
        await fixture.render({
            headerActions: React.createElement("button", {onClick: () => actionClicks++}, "Copy"),
        });
        const toggle = fixture.dom.window.document.querySelector<HTMLButtonElement>(".qg-collapsible-panel-toggle");
        const actionGroup = fixture.dom.window.document.querySelector<HTMLElement>(".qg-collapsible-panel-actions");
        const action = actionGroup?.querySelector<HTMLButtonElement>("button");
        assert.ok(toggle);
        assert.ok(actionGroup);
        assert.ok(action);
        assert.equal(actionGroup.getAttribute("role"), "group");
        assert.equal(actionGroup.getAttribute("aria-label"), "Panel actions");

        // Activating a sibling header action must not activate the disclosure button.
        await React.act(async () => action.click());
        assert.equal(actionClicks, 1);
        assert.equal(toggle.ariaExpanded, "false");
        assert.deepEqual(fixture.requestedStates, []);
    } finally {
        await fixture.cleanup();
    }
});

test("lazy content mounts on first intent and remains mounted", async () => {
    const fixture = await createFixture();
    try {
        const child = React.createElement("span", {className: "lazy-child"}, "Lazy content");
        await fixture.render({children: child, mountContentOnFirstIntent: true});
        const toggle = fixture.dom.window.document.querySelector<HTMLButtonElement>(".qg-collapsible-panel-toggle");
        const content = fixture.dom.window.document.querySelector<HTMLElement>(".qg-collapsible-panel-content");
        assert.ok(toggle);
        assert.ok(content);
        assert.equal(content.querySelector(".lazy-child"), null);

        // Keyboard focus signals intent without expanding the panel.
        await React.act(async () => toggle.focus());
        assert.ok(content.querySelector(".lazy-child"));
        assert.equal(toggle.ariaExpanded, "false");

        // Once mounted, the child survives an open/close cycle.
        await React.act(async () => toggle.click());
        await React.act(async () => toggle.click());
        assert.ok(content.querySelector(".lazy-child"));
        assert.ok(content.hidden);
    } finally {
        await fixture.cleanup();
    }
});

test("a controlled panel does not become uncontrolled when the open prop is removed", async (context) => {
    const fixture = await createFixture();
    const error = context.mock.method(console, "error", () => undefined);
    try {
        await fixture.render({open: true});
        const toggle = fixture.dom.window.document.querySelector<HTMLButtonElement>(".qg-collapsible-panel-toggle");
        assert.ok(toggle);
        assert.equal(toggle.ariaExpanded, "true");

        // The missing prop closes the controlled panel, but does not activate its dormant internal state.
        await fixture.render();
        assert.equal(toggle.ariaExpanded, "false");
        assert.equal(error.mock.callCount(), 1);
        assert.deepEqual(error.mock.calls[0]?.arguments, [controllednessError]);
        await React.act(async () => toggle.click());
        assert.deepEqual(fixture.requestedStates, [true]);
        assert.equal(toggle.ariaExpanded, "false");
    } finally {
        await fixture.cleanup();
    }
});

test("an uncontrolled panel does not become controlled when the open prop is added", async (context) => {
    const fixture = await createFixture();
    const error = context.mock.method(console, "error", () => undefined);
    try {
        await fixture.render();
        const toggle = fixture.dom.window.document.querySelector<HTMLButtonElement>(".qg-collapsible-panel-toggle");
        assert.ok(toggle);
        assert.equal(toggle.ariaExpanded, "false");

        // The new prop is diagnosed and ignored, leaving interaction backed by internal state.
        await fixture.render({open: true});
        assert.equal(toggle.ariaExpanded, "false");
        assert.equal(error.mock.callCount(), 1);
        assert.deepEqual(error.mock.calls[0]?.arguments, [controllednessError]);
        await React.act(async () => toggle.click());
        assert.deepEqual(fixture.requestedStates, [true]);
        assert.equal(toggle.ariaExpanded, "true");
    } finally {
        await fixture.cleanup();
    }
});
