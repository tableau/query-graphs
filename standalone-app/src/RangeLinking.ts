import {foldedRanges} from "@codemirror/language";
import {findClusterBreak} from "@codemirror/state";
import {StateEffect, StateField, type Extension, type StateEffectType} from "@codemirror/state";
import {Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate} from "@codemirror/view";
import type {SourceLocation} from "@tableau/query-graphs/lib/tree-description";

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
                        .map(({from, to}) => Decoration.mark({class: className}).range(from, to)),
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

function foldIntersectsHighlightedRange(highlightedRanges: DecorationSet, foldFrom: number, foldTo: number): boolean {
    let intersectsHighlightedRange = false;
    highlightedRanges.between(foldFrom, foldTo, (highlightFrom, highlightTo) => {
        if (highlightFrom < foldTo && highlightTo > foldFrom) intersectsHighlightedRange = true;
    });
    return intersectsHighlightedRange;
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
                if (foldIntersectsHighlightedRange(highlightedRanges, foldFrom, foldTo))
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

interface PendingPointerSample {
    view: EditorView;
    x: number;
    y: number;
    isInsideContent: boolean;
}

function activeRangeOffsetTracking(onActiveRangeOffsetChange: (activeRangeOffset?: number) => void): Extension {
    return ViewPlugin.fromClass(
        class {
            private pointerUpdateFrame: number | undefined;
            private pendingPointerSample: PendingPointerSample | undefined;

            update(update: ViewUpdate) {
                if (update.geometryChanged || update.viewportChanged) this.reportCaretOffset(update.view);
                else if (update.selectionSet && update.view.hasFocus) onActiveRangeOffsetChange(update.state.selection.main.head);
            }

            destroy() {
                this.clearActiveRangeOffset();
            }

            focus(view: EditorView) {
                this.reportCaretOffset(view);
            }

            blur() {
                this.clearActiveRangeOffset();
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
                    if (pointerSample === undefined || !pointerSample.isInsideContent) return onActiveRangeOffsetChange(undefined);

                    const textHit = pointerSample.view.posAndSideAtCoords({x: pointerSample.x, y: pointerSample.y});
                    let activeRangeOffset = textHit?.pos;
                    if (textHit?.assoc === -1) {
                        const line = pointerSample.view.state.doc.lineAt(textHit.pos);
                        activeRangeOffset = line.from + findClusterBreak(line.text, textHit.pos - line.from, false);
                    }
                    const characterBounds =
                        activeRangeOffset === undefined ? null : pointerSample.view.coordsForChar(activeRangeOffset);
                    const isOverCharacter =
                        characterBounds !== null &&
                        pointerSample.x >= characterBounds.left &&
                        pointerSample.x <= characterBounds.right &&
                        pointerSample.y >= characterBounds.top &&
                        pointerSample.y <= characterBounds.bottom;
                    onActiveRangeOffsetChange(isOverCharacter ? activeRangeOffset : undefined);
                });
            }

            mouseleave(view: EditorView) {
                this.reportCaretOffset(view);
            }

            scroll(view: EditorView) {
                this.reportCaretOffset(view);
            }

            private cancelPendingPointerUpdate() {
                if (this.pointerUpdateFrame !== undefined) cancelAnimationFrame(this.pointerUpdateFrame);
                this.pointerUpdateFrame = undefined;
                this.pendingPointerSample = undefined;
            }

            private reportCaretOffset(view: EditorView) {
                this.cancelPendingPointerUpdate();
                onActiveRangeOffsetChange(view.hasFocus ? view.state.selection.main.head : undefined);
            }

            private clearActiveRangeOffset() {
                this.cancelPendingPointerUpdate();
                onActiveRangeOffsetChange(undefined);
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
    extension(onActiveRangeOffsetChange?: (activeRangeOffset?: number) => void): Extension {
        return [
            linkedRangeDecorations,
            highlightedRangeDecorations,
            foldPlaceholderHighlighting,
            rangeLinkingTheme,
            ...(onActiveRangeOffsetChange === undefined ? [] : [activeRangeOffsetTracking(onActiveRangeOffsetChange)]),
        ];
    },
    setLinkedRanges,
    setHighlightedRanges,
};
