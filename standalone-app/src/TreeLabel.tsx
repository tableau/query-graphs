import {lazy, Suspense, type ReactElement, useCallback, useMemo} from "react";
import {CollapsiblePanel} from "@tableau/query-graphs/lib/ui/CollapsiblePanel";
import {CopyButton} from "@tableau/query-graphs/lib/ui/CopyButton";
import {useGraphRenderingStore} from "@tableau/query-graphs/lib/ui/store";
import type {SourceLocation, TextDocument} from "@tableau/query-graphs/lib/tree-description";
import "./TreeLabel.css";

const DocumentPane = lazy(() =>
    import(/* webpackChunkName: "editor" */ "./DocumentPane").then((module) => ({default: module.DocumentPane})),
);

export interface TreeLabelProps {
    title: string;
    setTitle?: (v: string) => void;
    metadata?: Map<string, string>;
    metadataHighlighted?: boolean;
    textDocuments?: TextDocument[];
}

function LoadingDocument({title}: {title: string}) {
    return (
        <div className="graph-text-document-loading" role="status" aria-label={`Loading ${title}`}>
            <span />
            <span />
            <span />
            <span />
            <span />
        </div>
    );
}

function TextDocumentPanel({document}: {document: TextDocument}) {
    const linkedRanges = useGraphRenderingStore((state) => state.getLinkedSourceRanges(document.id));
    const activeNodeIds = useGraphRenderingStore((state) => state.activeNodeIds);
    const getSourceRangesForNodes = useGraphRenderingStore((state) => state.getSourceRangesForNodes);
    const highlightedRanges = useMemo(
        () => getSourceRangesForNodes(document.id, activeNodeIds),
        [activeNodeIds, document.id, getSourceRangesForNodes],
    );
    const setActiveSourceLocations = useGraphRenderingStore((state) => state.setActiveSourceLocations);
    const onActiveLinkedRangesChange = useCallback(
        (activeLinkedRanges: readonly SourceLocation[]) => setActiveSourceLocations(document.id, activeLinkedRanges),
        [document.id, setActiveSourceLocations],
    );

    return (
        <CollapsiblePanel
            title={document.title}
            className="graph-text-document-panel"
            headerActions={<CopyButton text={document.text} contentName={document.title} />}
            mountContentOnFirstIntent
        >
            <div className="graph-text-document-frame">
                <Suspense fallback={<LoadingDocument title={document.title} />}>
                    <DocumentPane
                        document={document}
                        linkedRanges={linkedRanges}
                        highlightedRanges={highlightedRanges}
                        onActiveLinkedRangesChange={onActiveLinkedRangesChange}
                    />
                </Suspense>
            </div>
        </CollapsiblePanel>
    );
}

export function TreeLabel({title, setTitle, metadata, metadataHighlighted, textDocuments}: TreeLabelProps) {
    const metadataChildren = [] as ReactElement[];
    for (const [key, value] of (metadata || []).entries()) {
        metadataChildren.push(
            <div key={key}>
                <span className="qg-prop-name">{key}:</span> <span className="qg-prop-value">{value}</span>
            </div>,
        );
    }

    // React Flow recognizes these interaction guards on ancestors: `nowheel` lets
    // documents scroll without zooming the canvas, and `nopan` lets users select
    // text or operate controls without dragging the canvas.
    return (
        <div className="react-flow__panel graph-sidebar nowheel nopan">
            <input
                type="text"
                className="graph-title"
                placeholder="Untitled"
                value={title}
                onChange={(e) => (setTitle ? setTitle(e.target.value) : undefined)}
            />
            <div className="graph-sidebar-panels">
                <div className="graph-sidebar-panel-stack">
                    {metadataChildren.length > 0 ? (
                        <CollapsiblePanel title="Plan Metadata" highlighted={metadataHighlighted}>
                            <div className="graph-metadata">{metadataChildren}</div>
                        </CollapsiblePanel>
                    ) : null}
                    {textDocuments?.map((document) => (
                        <TextDocumentPanel key={document.id} document={document} />
                    ))}
                </div>
            </div>
        </div>
    );
}
