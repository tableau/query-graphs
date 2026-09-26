import {lazy, Suspense, type ReactElement, useCallback, useEffect, useMemo, useState} from "react";
import {CollapsiblePanel} from "@tableau/query-graphs/lib/ui/CollapsiblePanel";
import {CopyButton} from "@tableau/query-graphs/lib/ui/CopyButton";
import {IconButton} from "@tableau/query-graphs/lib/ui/IconButton";
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
    const [open, setOpen] = useState(false);
    const [searchRequest, setSearchRequest] = useState<number>();
    const [followLinkedHighlights, setFollowLinkedHighlights] = useState(false);
    const linkedRanges = useGraphRenderingStore((state) => state.getLinkedSourceRanges(document.id));
    const highlightedNodeIds = useGraphRenderingStore((state) => state.highlightedNodeIds);
    const getSourceRangesForNodes = useGraphRenderingStore((state) => state.getSourceRangesForNodes);
    const highlightedRanges = useMemo(
        () => getSourceRangesForNodes(document.id, highlightedNodeIds),
        [document.id, getSourceRangesForNodes, highlightedNodeIds],
    );
    const setActiveSourceLocations = useGraphRenderingStore((state) => state.setActiveSourceLocations);
    const setFollowSourceDocument = useGraphRenderingStore((state) => state.setFollowSourceDocument);
    const onActiveLinkedRangesChange = useCallback(
        (activeLinkedRanges: readonly SourceLocation[]) => setActiveSourceLocations(document.id, activeLinkedRanges),
        [document.id, setActiveSourceLocations],
    );
    useEffect(() => () => setFollowSourceDocument(document.id, false), [document.id, setFollowSourceDocument]);
    useEffect(() => {
        setFollowSourceDocument(document.id, followLinkedHighlights);
    }, [document.id, followLinkedHighlights, setFollowSourceDocument]);
    const panelTitle = (
        <>
            {document.title}
            <span
                className={`graph-panel-highlight-indicator${highlightedRanges.length > 0 ? " graph-panel-highlight-indicator-active" : ""}`}
                aria-hidden="true"
            />
        </>
    );

    return (
        <CollapsiblePanel
            title={panelTitle}
            className="graph-text-document-panel"
            open={open}
            onOpenChange={setOpen}
            headerActions={
                <>
                    {linkedRanges.length > 0 ? (
                        <IconButton
                            label={`Follow linked highlights in ${document.title}`}
                            tooltip="Follow linked highlights"
                            aria-pressed={followLinkedHighlights}
                            onClick={() => setFollowLinkedHighlights((follow) => !follow)}
                        >
                            <svg viewBox="0 0 16 16" aria-hidden="true">
                                <circle cx="8" cy="8" r="3.25" />
                                <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2" />
                            </svg>
                        </IconButton>
                    ) : null}
                    <IconButton
                        label={`Search ${document.title}`}
                        tooltip="Search"
                        onClick={() => {
                            setOpen(true);
                            setSearchRequest((request) => (request ?? 0) + 1);
                        }}
                    >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                            <circle cx="7" cy="7" r="4.25" />
                            <path d="m10.25 10.25 3.25 3.25" />
                        </svg>
                    </IconButton>
                    <CopyButton text={document.text} contentName={document.title} />
                </>
            }
            mountContentOnFirstIntent
        >
            <div className="graph-text-document-frame">
                <Suspense fallback={<LoadingDocument title={document.title} />}>
                    <DocumentPane
                        document={document}
                        linkedRanges={linkedRanges}
                        highlightedRanges={highlightedRanges}
                        onActiveLinkedRangesChange={onActiveLinkedRangesChange}
                        autoRevealHighlightedRanges={followLinkedHighlights && open}
                        searchRequest={searchRequest}
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
        <div className="react-flow__panel graph-sidebar qg-viewport-obstacle nowheel nopan">
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
