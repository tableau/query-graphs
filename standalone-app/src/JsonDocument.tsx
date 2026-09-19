import {useEffect, useRef} from "react";
import {json} from "@codemirror/lang-json";
import {defaultHighlightStyle, foldGutter, foldKeymap, syntaxHighlighting} from "@codemirror/language";
import {EditorState} from "@codemirror/state";
import {EditorView, highlightSpecialChars, keymap, lineNumbers} from "@codemirror/view";
import type {TextDocument} from "@tableau/query-graphs/lib/tree-description";

export function JsonDocument({document}: {document: TextDocument}) {
    const parent = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (parent.current === null) return;
        const view = new EditorView({
            parent: parent.current,
            state: EditorState.create({
                doc: document.text,
                extensions: [
                    json(),
                    syntaxHighlighting(defaultHighlightStyle, {fallback: true}),
                    lineNumbers(),
                    highlightSpecialChars(),
                    foldGutter(),
                    keymap.of(foldKeymap),
                    EditorState.readOnly.of(true),
                    EditorView.editable.of(false),
                    EditorView.contentAttributes.of({"aria-label": document.title, tabindex: "0"}),
                ],
            }),
        });
        return () => view.destroy();
    }, [document]);

    return <div ref={parent} className="graph-text-document nowheel nodrag nopan" />;
}
