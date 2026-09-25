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
    const render = async (props: {open?: boolean} = {}) => {
        await React.act(async () =>
            root.render(
                React.createElement(
                    CollapsiblePanel,
                    {title: "Details", onOpenChange: (nextOpen) => requestedStates.push(nextOpen), ...props},
                    "Content",
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
