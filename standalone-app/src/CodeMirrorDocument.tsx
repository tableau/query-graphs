import {useEffect, useRef} from "react";
import {defaultKeymap} from "@codemirror/commands";
import {bracketMatching, defaultHighlightStyle, foldGutter, foldKeymap, syntaxHighlighting} from "@codemirror/language";
import {openSearchPanel, searchKeymap} from "@codemirror/search";
import {EditorState, type Extension} from "@codemirror/state";
import {EditorView, highlightSpecialChars, keymap, lineNumbers, scrollPastEnd} from "@codemirror/view";
import type {SourceLocation, TextDocument} from "@tableau/query-graphs/lib/tree-description";
import {compactSearch} from "./CodeMirrorSearch";
import {rangeLinking} from "./RangeLinking";
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
// CodeMirror injects scoped base styles at runtime. A theme extension gives these
// overrides predictable precedence without specificity hacks or `!important`.
const documentTheme = EditorView.theme({
    "&": {
        height: "100%",
        border: "1px solid hsl(0, 0%, 85%)",
    },
    "&.cm-focused": {
        outline: "none",
    },
    ".cm-gutters": {
        userSelect: "none",
    },
    ".cm-scroller": {
        overflow: "auto",
    },
});
const noLanguageExtension: Extension = [];

export interface DocumentViewerProps {
    document: TextDocument;
    linkedRanges?: readonly SourceLocation[];
    highlightedRanges?: readonly SourceLocation[];
    /** Reports the narrowest linked ranges under the pointer, falling back to the focused caret. */
    onActiveLinkedRangesChange?: (activeLinkedRanges: readonly SourceLocation[]) => void;
    /** Automatically reveals highlighted ranges that remain outside the rendered viewport. */
    autoRevealHighlightedRanges?: boolean;
    /** Opens and focuses search whenever this value changes to a defined request token. */
    searchRequest?: number;
}

export interface CodeMirrorDocumentProps extends DocumentViewerProps {
    languageExtension?: Extension;
}

export function CodeMirrorDocument({
    document: textDocument,
    languageExtension = noLanguageExtension,
    linkedRanges = [],
    highlightedRanges = [],
    onActiveLinkedRangesChange,
    autoRevealHighlightedRanges = false,
    searchRequest,
}: CodeMirrorDocumentProps) {
    const editorHost = useRef<HTMLDivElement>(null);
    const editorView = useRef<EditorView | undefined>(undefined);
    const linkedRangesRef = useRef(linkedRanges);
    const highlightedRangesRef = useRef(highlightedRanges);

    useEffect(() => {
        linkedRangesRef.current = linkedRanges;
        highlightedRangesRef.current = highlightedRanges;
    }, [linkedRanges, highlightedRanges]);

    useEffect(() => {
        if (editorHost.current === null) return;
        const view = new EditorView({
            parent: editorHost.current,
            state: EditorState.create({
                doc: textDocument.text,
                extensions: [
                    languageExtension,
                    syntaxHighlighting(defaultHighlightStyle, {fallback: true}),
                    lineNumbers(),
                    highlightSpecialChars(),
                    scrollPastEnd(),
                    bracketMatching(),
                    compactSearch,
                    folding,
                    foldMarkerTheme,
                    documentTheme,
                    rangeLinking.extension(onActiveLinkedRangesChange),
                    keymap.of([...defaultKeymap, ...searchKeymap, ...foldKeymap]),
                    EditorState.readOnly.of(true),
                    EditorView.contentAttributes.of({"aria-label": textDocument.title}),
                ],
            }),
        });
        view.dispatch({
            effects: [
                rangeLinking.setLinkedRanges.of(linkedRangesRef.current),
                rangeLinking.setHighlightedRanges.of(highlightedRangesRef.current),
            ],
        });
        editorView.current = view;
        return () => {
            editorView.current = undefined;
            view.destroy();
        };
    }, [textDocument, languageExtension, onActiveLinkedRangesChange]);

    useEffect(() => {
        editorView.current?.dispatch({effects: rangeLinking.setLinkedRanges.of(linkedRanges)});
    }, [linkedRanges]);

    useEffect(() => {
        const view = editorView.current;
        if (view === undefined) return;
        view.dispatch({effects: rangeLinking.setHighlightedRanges.of(highlightedRanges)});
        if (!autoRevealHighlightedRanges) return;
        const followTimer = window.setTimeout(() => rangeLinking.revealNearestHighlightedRange(view), 150);
        return () => window.clearTimeout(followTimer);
    }, [textDocument, highlightedRanges, autoRevealHighlightedRanges]);

    useEffect(() => {
        if (searchRequest !== undefined && editorView.current !== undefined) openSearchPanel(editorView.current);
    }, [searchRequest]);

    return <div ref={editorHost} className="graph-text-document" />;
}
