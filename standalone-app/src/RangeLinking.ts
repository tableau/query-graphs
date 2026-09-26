import {foldedRanges} from "@codemirror/language";
import {findClusterBreak} from "@codemirror/state";
import {EditorSelection, StateEffect, StateField, type EditorState, type Extension, type StateEffectType} from "@codemirror/state";
import {Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate} from "@codemirror/view";
import type {SourceLocation} from "@tableau/query-graphs/lib/tree-description";

const setLinkedRanges = StateEffect.define<readonly SourceLocation[]>();
const setHighlightedRanges = StateEffect.define<readonly SourceLocation[]>();

function rangeDecorationField(
    effect: StateEffectType<readonly SourceLocation[]>,
    className: string,
    attributes?: (sourceLocation: SourceLocation) => Record<string, string>,
): StateField<DecorationSet> {
    return StateField.define({
        create: () => Decoration.none,
        update: (current, transaction) => {
            for (const transactionEffect of transaction.effects) {
                if (!transactionEffect.is(effect)) continue;
                return Decoration.set(
                    transactionEffect.value
                        .filter(({from, to}) => from >= 0 && from < to && to <= transaction.state.doc.length)
                        .map((sourceLocation) =>
                            Decoration.mark({
                                class: className,
                                sourceLocation,
                                attributes: attributes?.(sourceLocation),
                            }).range(sourceLocation.from, sourceLocation.to),
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
const highlightedRangeDecorations = rangeDecorationField(setHighlightedRanges, "cm-highlighted-range", (sourceLocation) => ({
    "data-highlight-from": `${sourceLocation.from}`,
    "data-highlight-to": `${sourceLocation.to}`,
}));

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

interface OffsetRange {
    from: number;
    to: number;
}

interface ScreenRectangle {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

function visualHighlightRange(state: EditorState, from: number, to: number): OffsetRange {
    let containingFold: OffsetRange | undefined;
    foldedRanges(state).between(0, state.doc.length, (foldFrom, foldTo) => {
        if (from < foldFrom || to > foldTo) return;
        if (containingFold === undefined || foldTo - foldFrom > containingFold.to - containingFold.from)
            containingFold = {from: foldFrom, to: foldTo};
    });
    return containingFold === undefined ? {from, to} : {from: containingFold.from, to: containingFold.from};
}

function highlightedVisualRanges(state: EditorState): OffsetRange[] {
    const visualRanges: OffsetRange[] = [];
    state.field(highlightedRangeDecorations).between(0, state.doc.length, (from, to) => {
        const range = visualHighlightRange(state, from, to);
        if (!visualRanges.some((existing) => existing.from === range.from && existing.to === range.to)) visualRanges.push(range);
    });
    return visualRanges;
}

interface MeasuredHighlight {
    range: OffsetRange;
    meaningfullyVisible: boolean;
    distance: number;
}

function textViewportRectangle(view: EditorView): ScreenRectangle {
    const scrollBounds = view.scrollDOM.getBoundingClientRect();
    const clientLeft = scrollBounds.left + view.scrollDOM.clientLeft * view.scaleX;
    const clientTop = scrollBounds.top + view.scrollDOM.clientTop * view.scaleY;
    const clientWidth = view.scrollDOM.clientWidth * view.scaleX || scrollBounds.right - clientLeft;
    const clientHeight = view.scrollDOM.clientHeight * view.scaleY || scrollBounds.bottom - clientTop;
    const viewport = {
        top: clientTop,
        right: clientLeft + clientWidth,
        bottom: clientTop + clientHeight,
        left: clientLeft,
    };
    const gutter = view.dom.querySelector<HTMLElement>(".cm-gutters")?.getBoundingClientRect();
    if (gutter === undefined || gutter.bottom <= viewport.top || gutter.top >= viewport.bottom) return viewport;
    const viewportCenter = (viewport.left + viewport.right) / 2;
    const gutterCenter = (gutter.left + gutter.right) / 2;
    if (gutterCenter <= viewportCenter) viewport.left = Math.max(viewport.left, gutter.right);
    else viewport.right = Math.min(viewport.right, gutter.left);
    return viewport;
}

function rectangleDistance(viewport: ScreenRectangle, rectangle: ScreenRectangle): number {
    const horizontalDistance = Math.max(viewport.left - rectangle.right, rectangle.left - viewport.right, 0);
    const verticalDistance = Math.max(viewport.top - rectangle.bottom, rectangle.top - viewport.bottom, 0);
    return Math.hypot(horizontalDistance, verticalDistance);
}

function isMeaningfullyVisible(viewport: ScreenRectangle, rectangle: ScreenRectangle): boolean {
    const width = rectangle.right - rectangle.left;
    const height = rectangle.bottom - rectangle.top;
    if (width <= 0 || height <= 0) return false;
    const visibleWidth = Math.max(0, Math.min(viewport.right, rectangle.right) - Math.max(viewport.left, rectangle.left));
    const visibleHeight = Math.max(0, Math.min(viewport.bottom, rectangle.bottom) - Math.max(viewport.top, rectangle.top));
    return visibleWidth >= Math.min(width * 0.5, 24) && visibleHeight >= Math.min(height * 0.5, 8);
}

function fallbackRangeRectangle(view: EditorView, range: OffsetRange, viewport: ScreenRectangle): ScreenRectangle {
    const start = view.lineBlockAt(range.from);
    const end = view.lineBlockAt(range.to);
    return {
        // Block positions use the same scaled coordinate system as documentTop.
        top: view.documentTop + start.top,
        right: viewport.right,
        bottom: view.documentTop + end.top + end.height,
        left: viewport.left,
    };
}

function rangeRectangles(view: EditorView, range: OffsetRange, viewport: ScreenRectangle): ScreenRectangle[] {
    let rectangles: ScreenRectangle[];
    if (range.from === range.to) {
        const placeholder = [...view.dom.querySelectorAll<HTMLElement>(".cm-foldPlaceholder")].find(
            (candidate) => view.posAtDOM(candidate) === range.from,
        );
        rectangles = placeholder === undefined ? [] : [...placeholder.getClientRects()];
    } else {
        rectangles = [
            ...view.dom.querySelectorAll<HTMLElement>(
                `.cm-highlighted-range[data-highlight-from="${range.from}"][data-highlight-to="${range.to}"]`,
            ),
        ].flatMap((element) => [...element.getClientRects()]);
    }
    return rectangles.length === 0 ? [fallbackRangeRectangle(view, range, viewport)] : rectangles;
}

function measureHighlightedRanges(view: EditorView): MeasuredHighlight[] {
    const viewport = textViewportRectangle(view);
    return highlightedVisualRanges(view.state).map((range) => {
        const rectangles = rangeRectangles(view, range, viewport);
        const nearestRectangle = rectangles.reduce((nearest, rectangle) =>
            rectangleDistance(viewport, rectangle) < rectangleDistance(viewport, nearest) ? rectangle : nearest,
        );
        return {
            range,
            meaningfullyVisible: rectangles.some((rectangle) => isMeaningfullyVisible(viewport, rectangle)),
            distance: rectangleDistance(viewport, nearestRectangle),
        };
    });
}

function smoothlyScrollRangeIntoView(view: EditorView, range: OffsetRange): void {
    const viewport = textViewportRectangle(view);
    const target = rangeRectangles(view, range, viewport).reduce((nearest, rectangle) =>
        rectangleDistance(viewport, rectangle) < rectangleDistance(viewport, nearest) ? rectangle : nearest,
    );
    const verticalDelta = (target.top + target.bottom - viewport.top - viewport.bottom) / 2 / view.scaleY;
    const horizontalMargin = 12;
    let horizontalDelta = 0;
    if (target.left < viewport.left + horizontalMargin)
        horizontalDelta = (target.left - viewport.left - horizontalMargin) / view.scaleX;
    else if (target.right > viewport.right - horizontalMargin)
        horizontalDelta = (target.right - viewport.right + horizontalMargin) / view.scaleX;
    const editorWindow = view.dom.ownerDocument.defaultView;
    view.scrollDOM.scrollTo({
        top: view.scrollDOM.scrollTop + verticalDelta,
        left: view.scrollDOM.scrollLeft + horizontalDelta,
        behavior: editorWindow?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
}

const pendingSmoothHighlightScrolls = new WeakSet<EditorView>();
const smoothHighlightScrolling = EditorView.scrollHandler.of((view, range) => {
    if (!pendingSmoothHighlightScrolls.delete(view)) return false;
    smoothlyScrollRangeIntoView(view, {from: range.from, to: range.to});
    return true;
});

function revealNearestHighlightedRange(view: EditorView): void {
    const highlights = measureHighlightedRanges(view);
    if (highlights.some((highlight) => highlight.meaningfullyVisible)) return;
    const nearest = highlights.reduce<MeasuredHighlight | undefined>(
        (current, highlight) => (current === undefined || highlight.distance < current.distance ? highlight : current),
        undefined,
    );
    if (nearest === undefined) return;
    pendingSmoothHighlightScrolls.add(view);
    view.dispatch({effects: EditorView.scrollIntoView(EditorSelection.range(nearest.range.from, nearest.range.to), {y: "center"})});
}

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
                // Coalesce high-frequency mouse events so the layout-dependent hit test runs at most once per frame.
                this.pointerUpdateFrame ??= requestAnimationFrame(() => {
                    this.pointerUpdateFrame = undefined;
                    const pointerSample = this.pendingPointerSample;
                    this.pendingPointerSample = undefined;
                    if (pointerSample === undefined || !pointerSample.isInsideContent) return this.reportDocumentOffset(view);

                    const textHit = pointerSample.view.posAndSideAtCoords({x: pointerSample.x, y: pointerSample.y});
                    let documentOffset = textHit?.pos;
                    // On a character's trailing half, CodeMirror returns the caret position after its grapheme cluster.
                    if (textHit?.assoc === -1) {
                        const line = pointerSample.view.state.doc.lineAt(textHit.pos);
                        documentOffset = line.from + findClusterBreak(line.text, textHit.pos - line.from, false);
                    }
                    // The hit above is the nearest caret even in blank space; only activate links under actual text.
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
                if (
                    this.activeLinkedRanges.length === activeLinkedRanges.length &&
                    this.activeLinkedRanges.every((range, index) => range === activeLinkedRanges[index])
                )
                    return;
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
            smoothHighlightScrolling,
            ...(onActiveLinkedRangesChange === undefined ? [] : [activeLinkedRangeTracking(onActiveLinkedRangesChange)]),
        ];
    },
    setLinkedRanges,
    setHighlightedRanges,
    revealNearestHighlightedRange,
};
