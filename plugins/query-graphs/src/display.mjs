export function setupDisplayControls(app, button, feedback) {
    function update() {
        const context = app.getHostContext();
        if (context?.displayMode === "fullscreen") feedback.hidden = true;
        button.hidden = !context?.availableDisplayModes?.includes("fullscreen") || context.displayMode === "fullscreen";
    }

    async function expand() {
        button.disabled = true;
        feedback.hidden = true;
        try {
            const result = await app.requestDisplayMode({mode: "fullscreen"});
            button.hidden = result.mode === "fullscreen";
            if (result.mode !== "fullscreen") {
                feedback.textContent = "The host kept the viewer inline. Use its expand control for more space.";
                feedback.hidden = false;
            }
        } catch (error) {
            feedback.textContent = `Could not expand the viewer: ${error instanceof Error ? error.message : String(error)}`;
            feedback.hidden = false;
        } finally {
            button.disabled = false;
        }
    }

    app.onhostcontextchanged = update;
    button.addEventListener("click", () => void expand());
    return {
        async ready() {
            update();
            if (!button.hidden) await expand();
        },
    };
}
