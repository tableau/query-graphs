import * as React from "react";
import {createRoot} from "react-dom/client";
import {JSDOM} from "jsdom";
import type {DOMWindow} from "jsdom";

export function createUiFixture(options: {url?: string; additionalGlobals?: readonly (keyof DOMWindow)[]} = {}) {
    const dom = new JSDOM("<main></main>", {pretendToBeVisual: true, url: options.url});
    const globalNames: (keyof DOMWindow)[] = [
        "window",
        "document",
        "Node",
        "HTMLElement",
        "Event",
        ...(options.additionalGlobals ?? []),
    ];
    const savedGlobals = new Map<PropertyKey, PropertyDescriptor | undefined>(
        [...globalNames, "IS_REACT_ACT_ENVIRONMENT", "React"].map((name) => [
            name,
            Object.getOwnPropertyDescriptor(globalThis, name),
        ]),
    );
    for (const name of globalNames)
        Object.defineProperty(globalThis, name, {configurable: true, writable: true, value: dom.window[name]});
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {configurable: true, writable: true, value: true});
    Object.defineProperty(globalThis, "React", {configurable: true, writable: true, value: React});

    const root = createRoot(dom.window.document.querySelector("main")!);
    return {
        dom,
        document: dom.window.document,
        async render(element: React.ReactNode): Promise<void> {
            await React.act(async () => root.render(element));
        },
        async key(element: HTMLElement, key: string): Promise<void> {
            await React.act(async () => element.dispatchEvent(new dom.window.KeyboardEvent("keydown", {key, bubbles: true})));
        },
        async cleanup(): Promise<void> {
            try {
                await React.act(async () => root.unmount());
            } finally {
                dom.window.close();
                for (const [name, descriptor] of savedGlobals) {
                    if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
                    else Object.defineProperty(globalThis, name, descriptor);
                }
            }
        },
    };
}
