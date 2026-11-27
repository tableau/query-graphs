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

const validatePlan = (_text: string): string | undefined => undefined;

async function createFixture() {
    const dom = new JSDOM("<main></main>", {pretendToBeVisual: true});
    Object.assign(dom.window.HTMLTextAreaElement.prototype, {attachEvent() {}, detachEvent() {}});
    const globalNames = ["window", "document", "Node", "HTMLElement", "Event", "FileReader"] as const;
    const previousGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    for (const name of globalNames)
        Object.defineProperty(globalThis, name, {configurable: true, writable: true, value: dom.window[name]});

    const globalDescriptors = new Map(
        ["IS_REACT_ACT_ENVIRONMENT", "React", "BUILD_COMMIT_HASH", "BUILD_TIMESTAMP"].map((name) => [
            name,
            Object.getOwnPropertyDescriptor(globalThis, name),
        ]),
    );
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {configurable: true, writable: true, value: true});
    Object.defineProperty(globalThis, "React", {configurable: true, value: React});
    Object.defineProperty(globalThis, "BUILD_COMMIT_HASH", {configurable: true, value: "test-commit"});
    Object.defineProperty(globalThis, "BUILD_TIMESTAMP", {configurable: true, value: "test-time"});

    const {FileOpener, useLoadStateController} = await import("../src/FileOpener");
    let controller!: ReturnType<typeof useLoadStateController>;
    let showOpener = false;
    const root = createRoot(dom.window.document.querySelector("main")!);
    function Harness() {
        controller = useLoadStateController();
        return showOpener
            ? React.createElement(FileOpener, {
                  setData: async () => undefined,
                  validate: validatePlan,
                  loadStateController: controller,
              })
            : null;
    }
    const render = async (visible: boolean) => {
        showOpener = visible;
        await React.act(async () => root.render(React.createElement(Harness)));
    };

    await render(false);
    return {
        dom,
        controller: () => controller,
        render,
        cleanup: async () => {
            await React.act(async () => root.unmount());
            dom.window.close();
            for (const [name, descriptor] of previousGlobals) {
                if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
                else Object.defineProperty(globalThis, name, descriptor);
            }
            for (const [name, descriptor] of globalDescriptors) {
                if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
                else Object.defineProperty(globalThis, name, descriptor);
            }
        },
    };
}

test("mounting an empty FileOpener preserves parent loading and error states", async () => {
    for (const state of ["error", "loading"] as const) {
        const fixture = await createFixture();
        try {
            await React.act(async () => {
                if (state === "error") fixture.controller().setError("Duplicate file name: a.sql");
                else fixture.controller().setProgress("Fetching plan...");
            });
            await fixture.render(true);

            if (state === "error") {
                assert.equal(fixture.dom.window.document.querySelector(".load-error")?.textContent, "Duplicate file name: a.sql");
            } else {
                assert.match(fixture.dom.window.document.querySelector(".file-selection-page")?.textContent ?? "", /Fetching plan/);
            }
        } finally {
            await fixture.cleanup();
        }
    }
});
