import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import test from "node:test";
import * as React from "react";
import {createUiFixture} from "../../query-graphs/test/ui-test-utils";

registerHooks({
    load(url, context, nextLoad) {
        if (url.endsWith(".css")) return {format: "module", source: "", shortCircuit: true};
        return nextLoad(url, context);
    },
});

const validatePlan = (_text: string): string | undefined => undefined;

test("mounting an empty FileOpener preserves parent loading and error states", async () => {
    const {FileOpener, useLoadStateController} = await import("../src/FileOpener");
    for (const state of ["error", "loading"] as const) {
        const fixture = createUiFixture({additionalGlobals: ["FileReader"]});
        Object.assign(fixture.dom.window.HTMLTextAreaElement.prototype, {attachEvent() {}, detachEvent() {}});
        const previousBuildGlobals = new Map(
            ["BUILD_COMMIT_HASH", "BUILD_TIMESTAMP"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
        );
        Object.defineProperty(globalThis, "BUILD_COMMIT_HASH", {configurable: true, value: "test-commit"});
        Object.defineProperty(globalThis, "BUILD_TIMESTAMP", {configurable: true, value: "test-time"});
        try {
            let controller!: ReturnType<typeof useLoadStateController>;
            let showOpener = false;
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
            await fixture.render(React.createElement(Harness));
            await React.act(async () => {
                if (state === "error") controller.setError("Duplicate file name: a.sql");
                else controller.setProgress("Fetching plan...");
            });
            showOpener = true;
            await fixture.render(React.createElement(Harness));

            if (state === "error") {
                assert.equal(fixture.document.querySelector(".load-error")?.textContent, "Duplicate file name: a.sql");
            } else {
                assert.match(fixture.document.querySelector(".file-selection-page")?.textContent ?? "", /Fetching plan/);
            }
        } finally {
            await fixture.cleanup();
            for (const [name, descriptor] of previousBuildGlobals) {
                if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
                else Object.defineProperty(globalThis, name, descriptor);
            }
        }
    }
});
