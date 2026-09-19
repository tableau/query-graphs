import {useEffect, useRef} from "react";
import {defaultKeymap} from "@codemirror/commands";
import {defaultHighlightStyle, foldGutter, foldKeymap, syntaxHighlighting} from "@codemirror/language";
import {EditorState, type Extension} from "@codemirror/state";
import {EditorView, highlightSpecialChars, keymap, lineNumbers} from "@codemirror/view";
import type {TextDocument} from "@tableau/query-graphs/lib/tree-description";

export interface CodeDocumentProps {
    document: TextDocument;
    languageExtension?: Extension;
}

export function CodeDocument({document, languageExtension = []}: CodeDocumentProps) {
    const parent = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (parent.current === null) return;
        const view = new EditorView({
            parent: parent.current,
            state: EditorState.create({
                doc: document.text,
                extensions: [
                    languageExtension,
                    syntaxHighlighting(defaultHighlightStyle, {fallback: true}),
                    lineNumbers(),
                    highlightSpecialChars(),
                    foldGutter(),
                    keymap.of([...defaultKeymap, ...foldKeymap]),
                    EditorState.readOnly.of(true),
                    EditorView.contentAttributes.of({"aria-label": document.title}),
                ],
            }),
        });
        return () => view.destroy();
    }, [document, languageExtension]);

    return <div ref={parent} className="graph-text-document nowheel nodrag nopan" />;
}
