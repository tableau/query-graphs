import {foldedRanges} from "@codemirror/language";
import {findClusterBreak} from "@codemirror/state";
import {StateEffect, StateField, type EditorState, type Extension, type StateEffectType} from "@codemirror/state";
import {Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate} from "@codemirror/view";
import type {SourceLocation} from "@tableau/query-graphs/lib/tree-description";
import {equalSourceLocationLists} from "@tableau/query-graphs/lib/tree-description";

const setLinkedRanges = StateEffect.define<readonly SourceLocation[]>();
const setHighlightedRanges = StateEffect.define<readonly SourceLocation[]>();

function rangeDecorationField(effect: StateEffectType<readonly SourceLocation[]>, className: string): StateField<DecorationSet> {
    return StateField.define({
        create: () => Decoration.none,
        update: (current, transaction) => {
            for (const transactionEffect of transaction.effects) {
                if (!transactionEffect.is(effect)) continue;
                return Decoration.set(
                    transactionEffect.value
                        .filter(({from, to}) => from >= 0 && from < to && to <= transaction.state.doc.length)
                        .map((sourceLocation) =>
                            Decoration.mark({class: className, sourceLocation}).range(sourceLocation.from, sourceLocation.to),
                        ),
                    true,
                );
            }
            return current.map(transaction.changes);
        },
        provide: (field) => EditorView.decorations.from(field),
    });
}

const linkedRangeDecorations = rangeDecorationField(setLinkedRanges, "cm-linked-range");
const highlightedRangeDecorations = rangeDecorationField(setHighlightedRanges, "cm-highlighted-range");

const rangeLinkingTheme = EditorView.baseTheme({
    ".cm-linked-range": {
        textDecoration: "underline dotted hsl(210, 55%, 55%)",
        textUnderlineOffset: ".18em",
    },
    ".cm-linked-range:hover": {
        textDecorationStyle: "solid",
        textDecorationThickness: "2px",
    },
    ".cm-highlighted-range": {
        background: "hsl(210, 100%, 85%)",
        borderRadius: ".15em",
    },
    ".cm-foldPlaceholder.cm-fold-hides-highlighted-range": {
        animation: "cm-folded-range-highlight-pulse 0.8s ease-in-out infinite alternate",
    },
    "@keyframes cm-folded-range-highlight-pulse": {
        from: {
            backgroundColor: "hsl(210, 100%, 90%)",
            borderColor: "hsl(210, 80%, 55%)",
        },
        to: {
            backgroundColor: "hsl(210, 100%, 70%)",
            borderColor: "hsl(210, 90%, 40%)",
        },
    },
    "@media (prefers-reduced-motion: reduce)": {
        ".cm-foldPlaceholder.cm-fold-hides-highlighted-range": {
            animation: "none",
            backgroundColor: "hsl(210, 100%, 80%)",
            borderColor: "hsl(210, 80%, 45%)",
        },
    },
    "@media (forced-colors: active)": {
        ".cm-linked-range": {
            textDecorationColor: "LinkText",
        },
        ".cm-highlighted-range": {
            outline: "1px solid Highlight",
        },
        ".cm-foldPlaceholder.cm-fold-hides-highlighted-range": {
            animation: "none",
            backgroundColor: "Canvas",
            borderColor: "Highlight",
            color: "Highlight",
        },
    },
});

const foldedRangeHighlightClass = "cm-fold-hides-highlighted-range";

function foldContainsHighlightedRange(highlightedRanges: DecorationSet, foldFrom: number, foldTo: number): boolean {
    let containsHighlightedRange = false;
    highlightedRanges.between(foldFrom, foldTo, (highlightFrom, highlightTo) => {
        if (highlightFrom >= foldFrom && highlightTo <= foldTo) containsHighlightedRange = true;
    });
    return containsHighlightedRange;
}

const foldPlaceholderHighlighting = ViewPlugin.fromClass(
    class {
        constructor(private readonly view: EditorView) {
            this.scheduleUpdate(view);
        }

        update(update: ViewUpdate) {
            if (
                update.docChanged ||
                update.startState.field(highlightedRangeDecorations) !== update.state.field(highlightedRangeDecorations) ||
                foldedRanges(update.startState) !== foldedRanges(update.state)
            )
                this.scheduleUpdate(update.view);
        }

        docViewUpdate(view: EditorView) {
            this.scheduleUpdate(view);
        }

        destroy() {
            for (const placeholder of this.view.dom.querySelectorAll(`.${foldedRangeHighlightClass}`))
                placeholder.classList.remove(foldedRangeHighlightClass);
        }

        private scheduleUpdate(view: EditorView) {
            const highlightedRanges = view.state.field(highlightedRangeDecorations);
            const foldStartsHidingHighlightedRanges = new Set<number>();
            foldedRanges(view.state).between(0, view.state.doc.length, (foldFrom, foldTo) => {
                if (foldContainsHighlightedRange(highlightedRanges, foldFrom, foldTo))
                    foldStartsHidingHighlightedRanges.add(foldFrom);
            });
            view.requestMeasure({
                key: this,
                read: (measuredView) =>
                    Array.from(measuredView.dom.querySelectorAll<HTMLElement>(".cm-foldPlaceholder"), (placeholder) => ({
                        placeholder,
                        highlighted: foldStartsHidingHighlightedRanges.has(measuredView.posAtDOM(placeholder)),
                    })),
                write: (placeholders) => {
                    for (const {placeholder, highlighted} of placeholders)
                        placeholder.classList.toggle(foldedRangeHighlightClass, highlighted);
                },
            });
        }
    },
);

function activeLinkedRangesAtOffset(state: EditorState, documentOffset?: number): readonly SourceLocation[] {
    if (documentOffset === undefined) return [];
    let shortestRangeLength = Infinity;
    let activeLinkedRanges: SourceLocation[] = [];
    state.field(linkedRangeDecorations).between(documentOffset, documentOffset, (from, to, decoration) => {
        if (documentOffset < from || documentOffset >= to) return;
        const rangeLength = to - from;
        if (rangeLength < shortestRangeLength) {
            shortestRangeLength = rangeLength;
            activeLinkedRanges = [];
        }
        if (rangeLength === shortestRangeLength) activeLinkedRanges.push(decoration.spec.sourceLocation as SourceLocation);
    });
    return activeLinkedRanges;
}

function activeLinkedRangeTracking(onActiveLinkedRangesChange: (activeLinkedRanges: readonly SourceLocation[]) => void): Extension {
    interface PendingPointerSample {
        view: EditorView;
        x: number;
        y: number;
        isInsideContent: boolean;
    }

    return ViewPlugin.fromClass(
        class {
            private pointerUpdateFrame: number | undefined;
            private pendingPointerSample: PendingPointerSample | undefined;
            private activeLinkedRanges: readonly SourceLocation[] = [];

            update(update: ViewUpdate) {
                if (update.geometryChanged || update.viewportChanged) this.reportCaretPosition(update.view);
                else if (update.selectionSet && update.view.hasFocus)
                    this.reportDocumentOffset(update.view, update.state.selection.main.head);
            }

            destroy() {
                this.clearActiveLinkedRanges();
            }

            focus(view: EditorView) {
                this.reportCaretPosition(view);
            }

            blur() {
                this.clearActiveLinkedRanges();
            }

            mousemove(event: MouseEvent, view: EditorView) {
                this.pendingPointerSample = {
                    view,
                    x: event.clientX,
                    y: event.clientY,
                    isInsideContent: view.contentDOM.contains(event.target as Node),
                };
                this.pointerUpdateFrame ??= requestAnimationFrame(() => {
                    this.pointerUpdateFrame = undefined;
                    const pointerSample = this.pendingPointerSample;
                    this.pendingPointerSample = undefined;
                    if (pointerSample === undefined || !pointerSample.isInsideContent) return this.reportDocumentOffset(view);

                    const textHit = pointerSample.view.posAndSideAtCoords({x: pointerSample.x, y: pointerSample.y});
                    let documentOffset = textHit?.pos;
                    if (textHit?.assoc === -1) {
                        const line = pointerSample.view.state.doc.lineAt(textHit.pos);
                        documentOffset = line.from + findClusterBreak(line.text, textHit.pos - line.from, false);
                    }
                    const characterBounds = documentOffset === undefined ? null : pointerSample.view.coordsForChar(documentOffset);
                    const isOverCharacter =
                        characterBounds !== null &&
                        pointerSample.x >= characterBounds.left &&
                        pointerSample.x <= characterBounds.right &&
                        pointerSample.y >= characterBounds.top &&
                        pointerSample.y <= characterBounds.bottom;
                    this.reportDocumentOffset(pointerSample.view, isOverCharacter ? documentOffset : undefined);
                });
            }

            mouseleave(view: EditorView) {
                this.reportCaretPosition(view);
            }

            scroll(view: EditorView) {
                this.reportCaretPosition(view);
            }

            private cancelPendingPointerUpdate() {
                if (this.pointerUpdateFrame !== undefined) cancelAnimationFrame(this.pointerUpdateFrame);
                this.pointerUpdateFrame = undefined;
                this.pendingPointerSample = undefined;
            }

            private reportCaretPosition(view: EditorView) {
                this.cancelPendingPointerUpdate();
                this.reportDocumentOffset(view, view.hasFocus ? view.state.selection.main.head : undefined);
            }

            private reportDocumentOffset(view: EditorView, documentOffset?: number) {
                const activeLinkedRanges = activeLinkedRangesAtOffset(view.state, documentOffset);
                if (equalSourceLocationLists(this.activeLinkedRanges, activeLinkedRanges)) return;
                this.activeLinkedRanges = activeLinkedRanges;
                onActiveLinkedRangesChange(activeLinkedRanges);
            }

            private clearActiveLinkedRanges() {
                this.cancelPendingPointerUpdate();
                if (this.activeLinkedRanges.length === 0) return;
                this.activeLinkedRanges = [];
                onActiveLinkedRangesChange([]);
            }
        },
        {
            eventHandlers: {
                focus(_event, view) {
                    this.focus(view);
                },
                blur() {
                    this.blur();
                },
                mousemove(event, view) {
                    this.mousemove(event, view);
                },
                mouseleave(_event, view) {
                    this.mouseleave(view);
                },
            },
            eventObservers: {
                scroll(_event, view) {
                    this.scroll(view);
                },
            },
        },
    );
}

export const rangeLinking = {
    extension(onActiveLinkedRangesChange?: (activeLinkedRanges: readonly SourceLocation[]) => void): Extension {
        return [
            linkedRangeDecorations,
            highlightedRangeDecorations,
            foldPlaceholderHighlighting,
            rangeLinkingTheme,
            ...(onActiveLinkedRangesChange === undefined ? [] : [activeLinkedRangeTracking(onActiveLinkedRangesChange)]),
        ];
    },
    setLinkedRanges,
    setHighlightedRanges,
};
