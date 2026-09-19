import {useEffect, useRef} from "react";
import {defaultKeymap} from "@codemirror/commands";
import {bracketMatching, defaultHighlightStyle, foldGutter, foldKeymap, syntaxHighlighting} from "@codemirror/language";
import {EditorState, type Extension} from "@codemirror/state";
import {EditorView, highlightSpecialChars, keymap, lineNumbers, scrollPastEnd} from "@codemirror/view";
import type {TextDocument} from "@tableau/query-graphs/lib/tree-description";
import "./CodeMirrorDocument.css";

function createFoldMarker(open: boolean): HTMLElement {
    const marker = document.createElement("span");
    marker.className = `graph-fold-marker${open ? " graph-fold-marker-open" : ""}`;
    marker.title = open ? "Fold line" : "Unfold line";

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M5 3.5 10 8l-5 4.5");
    svg.append(path);
    marker.append(svg);
    return marker;
}

const folding = foldGutter({markerDOM: createFoldMarker});
const noLanguageExtension: Extension = [];
const foldMarkerTheme = EditorView.baseTheme({
    ".graph-fold-marker": {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "1em",
        height: "1em",
        lineHeight: "1",
    },
    ".graph-fold-marker svg": {
        width: "0.8em",
        height: "0.8em",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "1.75",
        strokeLinecap: "round",
        strokeLinejoin: "round",
    },
    ".graph-fold-marker-open svg": {
        transform: "rotate(90deg)",
    },
});
const documentTheme = EditorView.theme({
    "&": {
        width: "100%",
        height: "100%",
        border: "1px solid hsl(0, 0%, 85%)",
    },
    "&.cm-focused": {
        outline: "2px solid hsl(210, 90%, 65%)",
        outlineOffset: "-1px",
    },
    ".cm-scroller": {
        overflow: "auto",
        fontFamily: "monospace",
    },
});

export interface CodeMirrorDocumentProps {
    document: TextDocument;
    languageExtension?: Extension;
}

export function CodeMirrorDocument({document, languageExtension = noLanguageExtension}: CodeMirrorDocumentProps) {
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
                    scrollPastEnd(),
                    bracketMatching(),
                    folding,
                    foldMarkerTheme,
                    documentTheme,
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
