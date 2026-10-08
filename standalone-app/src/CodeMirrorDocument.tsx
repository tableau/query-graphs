import {useEffect, useRef, useSyncExternalStore} from "react";
import {defaultKeymap} from "@codemirror/commands";
import {bracketMatching, defaultHighlightStyle, foldGutter, foldKeymap, syntaxHighlighting} from "@codemirror/language";
import {openSearchPanel, searchKeymap} from "@codemirror/search";
import {Compartment, EditorState, type Extension} from "@codemirror/state";
import {color as oneDarkColor, oneDark} from "@codemirror/theme-one-dark";
import {EditorView, drawSelection, highlightSpecialChars, keymap, lineNumbers, scrollPastEnd} from "@codemirror/view";
import {emacs} from "@replit/codemirror-emacs";
import {vim} from "@replit/codemirror-vim";
import type {SourceLocation, TextDocument} from "@tableau/query-graphs/lib/tree-description";
import {useSettings} from "./settings";
import type {EditorKeybindings, Theme} from "./settings";
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
const emptyExtension: Extension = [];

interface EditorThemeColors {
    hoverBackground: string;
    activeBackground: string;
    activeBorder: string;
    linkedRange: string;
    highlightedRangeBackground: string;
}

/** Exposes a theme's palette through semantic colors shared by editor extensions. */
function withEditorThemeColors(theme: Extension, colors: EditorThemeColors): Extension {
    return [
        theme,
        EditorView.theme({
            "&": {
                "--qg-control-hover-background": colors.hoverBackground,
                "--qg-control-active-background": colors.activeBackground,
                "--qg-control-active-border": colors.activeBorder,
                "--qg-linked-range-color": colors.linkedRange,
                "--qg-highlighted-range-background": colors.highlightedRangeBackground,
            },
        }),
    ];
}

const oneDarkWithEditorThemeColors = withEditorThemeColors(oneDark, {
    hoverBackground: oneDarkColor.highlightBackground,
    activeBackground: oneDarkColor.selection,
    activeBorder: oneDarkColor.cursor,
    linkedRange: oneDarkColor.malibu,
    highlightedRangeBackground: oneDarkColor.selection,
});
const darkThemeQuery = "(prefers-color-scheme: dark)";
const themeConfiguration = new Compartment();
const keybindingsConfiguration = new Compartment();
const standardKeybindings = keymap.of([...defaultKeymap, ...searchKeymap, ...foldKeymap]);
const keybindings: Record<EditorKeybindings, Extension> = {
    standard: standardKeybindings,
    // Alternative keybindings must precede the fallback keymap so they can handle
    // overlapping shortcuts first.
    vim: [vim(), standardKeybindings],
    emacs: [emacs(), standardKeybindings],
};
// Third-party keymaps do not consistently honor CodeMirror's read-only facet.
const preventDocumentChanges = EditorState.changeFilter.of((transaction) => !transaction.docChanged);

function useResolvedTheme(theme: Theme): Exclude<Theme, "system"> {
    const currentSystemTheme = useSyncExternalStore(
        (onStoreChange) => {
            const mediaQuery = window.matchMedia(darkThemeQuery);
            mediaQuery.addEventListener("change", onStoreChange);
            return () => mediaQuery.removeEventListener("change", onStoreChange);
        },
        () => (window.matchMedia(darkThemeQuery).matches ? "dark" : "light"),
        () => "light" as const,
    );
    return theme === "system" ? currentSystemTheme : theme;
}

export interface DocumentViewerProps {
    document: TextDocument;
    linkedRanges?: readonly SourceLocation[];
    highlightedRanges?: readonly SourceLocation[];
    /** Reports the narrowest linked ranges under the pointer, falling back to the focused caret. */
    onActiveLinkedRangesChange?: (activeLinkedRanges: readonly SourceLocation[]) => void;
    /** Opens and focuses search whenever this value changes to a defined request token. */
    searchRequest?: number;
}

export interface CodeMirrorDocumentProps extends DocumentViewerProps {
    languageExtension?: Extension;
}

export function CodeMirrorDocument({
    document: textDocument,
    languageExtension = emptyExtension,
    linkedRanges = [],
    highlightedRanges = [],
    onActiveLinkedRangesChange,
    searchRequest,
}: CodeMirrorDocumentProps) {
    const editorHost = useRef<HTMLDivElement>(null);
    const editorView = useRef<EditorView | undefined>(undefined);
    const linkedRangesRef = useRef(linkedRanges);
    const highlightedRangesRef = useRef(highlightedRanges);
    const theme = useSettings((settings) => settings.values.theme);
    const editorKeybindings = useSettings((settings) => settings.values.editorKeybindings);
    const themeExtension = useResolvedTheme(theme) === "dark" ? oneDarkWithEditorThemeColors : emptyExtension;
    const themeExtensionRef = useRef(themeExtension);
    const keybindingsExtensionRef = useRef(keybindings[editorKeybindings]);

    // Reconfigure the current editor in place and initialize replacement
    // documents from the same latest preferences.
    useEffect(() => {
        themeExtensionRef.current = themeExtension;
        keybindingsExtensionRef.current = keybindings[editorKeybindings];
        editorView.current?.dispatch({
            effects: [
                themeConfiguration.reconfigure(themeExtension),
                keybindingsConfiguration.reconfigure(keybindings[editorKeybindings]),
            ],
        });
    }, [themeExtension, editorKeybindings]);

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
                    themeConfiguration.of(themeExtensionRef.current),
                    lineNumbers(),
                    highlightSpecialChars(),
                    drawSelection(),
                    scrollPastEnd(),
                    bracketMatching(),
                    compactSearch,
                    folding,
                    foldMarkerTheme,
                    documentTheme,
                    rangeLinking.extension(onActiveLinkedRangesChange),
                    keybindingsConfiguration.of(keybindingsExtensionRef.current),
                    EditorState.readOnly.of(true),
                    preventDocumentChanges,
                    EditorView.editable.of(false),
                    EditorView.contentAttributes.of({"aria-label": textDocument.title, tabindex: "0"}),
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
        editorView.current?.dispatch({effects: rangeLinking.setHighlightedRanges.of(highlightedRanges)});
    }, [highlightedRanges]);

    useEffect(() => {
        if (searchRequest !== undefined && editorView.current !== undefined) openSearchPanel(editorView.current);
    }, [searchRequest]);

    return <div ref={editorHost} className="graph-text-document" />;
}
