import assert from "node:assert/strict";
import test from "node:test";
import {setupDisplayControls} from "../src/display.mjs";

class Button {
    hidden = false;
    disabled = false;
    #click;

    addEventListener(name, handler) {
        assert.equal(name, "click");
        this.#click = handler;
    }

    click() {
        this.#click();
    }
}

test("display control follows host modes and reports an inline fallback", async () => {
    const button = new Button();
    const feedback = {hidden: true, textContent: ""};
    let context = {availableDisplayModes: ["inline", "fullscreen"], displayMode: "inline"};
    const responses = [{mode: "fullscreen"}, {mode: "inline"}];
    const requestedModes = [];
    const app = {
        getHostContext: () => context,
        requestDisplayMode: async ({mode}) => {
            requestedModes.push(mode);
            return responses.shift();
        },
    };
    const display = setupDisplayControls(app, button, feedback);

    await display.ready();
    assert.deepEqual(requestedModes, ["fullscreen"]);
    assert.equal(button.hidden, true);

    context = {availableDisplayModes: ["inline", "fullscreen"], displayMode: "inline"};
    app.onhostcontextchanged(context);
    assert.equal(button.hidden, false);
    button.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(requestedModes, ["fullscreen", "fullscreen"]);
    assert.equal(button.hidden, false);
    assert.equal(feedback.hidden, false);
    assert.match(feedback.textContent, /kept the viewer inline/);

    context = {availableDisplayModes: ["inline"], displayMode: "inline"};
    app.onhostcontextchanged(context);
    assert.equal(button.hidden, true);

    context = {availableDisplayModes: ["inline", "fullscreen"], displayMode: "fullscreen"};
    app.onhostcontextchanged(context);
    assert.equal(feedback.hidden, true);
});
