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

test("FileOpener keeps its input mounted and disabled while loading", async () => {
    const {FileOpener, useLoadStateController} = await import("../src/FileOpener");
    const fixture = createUiFixture({additionalGlobals: ["FileReader"]});
    Object.assign(fixture.dom.window.HTMLTextAreaElement.prototype, {attachEvent() {}, detachEvent() {}});
    try {
        let controller!: ReturnType<typeof useLoadStateController>;
        function Harness() {
            controller = useLoadStateController();
            return React.createElement(FileOpener, {
                setData: async () => undefined,
                validate: validatePlan,
                loadStateController: controller,
            });
        }
        await fixture.render(React.createElement(Harness));
        assert.ok(fixture.document.querySelector("textarea"));
        await React.act(async () => controller.setProgress("Fetching plan..."));
        const textarea = fixture.document.querySelector("textarea");
        assert.ok(textarea);
        assert.equal(textarea.disabled, true);
        assert.ok(fixture.document.querySelector(".file-opener"));
        assert.equal(fixture.document.querySelector(".qg-spinner"), null);
        assert.equal(fixture.document.querySelector(".caption"), null);
        assert.equal(fixture.document.querySelector(".landing-footer"), null);
    } finally {
        await fixture.cleanup();
    }
});
