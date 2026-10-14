import type {App} from "@modelcontextprotocol/ext-apps";

export function setupDisplayControls(
    app: Pick<App, "getHostContext" | "requestDisplayMode" | "onhostcontextchanged">,
    button: HTMLButtonElement,
    feedback: HTMLElement,
): {ready(): Promise<void>};
