import {lazy, Suspense, type ReactElement} from "react";
import {CollapsiblePanel} from "@tableau/query-graphs/lib/ui/CollapsiblePanel";
import {CopyButton} from "@tableau/query-graphs/lib/ui/CopyButton";
import type {TextDocument} from "@tableau/query-graphs/lib/tree-description";
import "./TreeLabel.css";

const loadDocumentPane = () =>
    import(/* webpackChunkName: "editor" */ "./DocumentPane").then((module) => ({default: module.DocumentPane}));
const DocumentPane = lazy(loadDocumentPane);
const preloadDocumentPane = () => void loadDocumentPane().catch(() => undefined);

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
    return (
        <CollapsiblePanel
            title={document.title}
            className="graph-text-document-panel"
            headerActions={<CopyButton text={document.text} contentName={document.title} />}
            mountContentOnFirstOpen
            onContentIntent={preloadDocumentPane}
        >
            <div className="graph-text-document-frame">
                <Suspense fallback={<LoadingDocument title={document.title} />}>
                    <DocumentPane document={document} />
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

    return (
        <div className="react-flow__panel graph-sidebar nowheel">
            <input
                type="text"
                className="graph-title"
                placeholder="Untitled"
                value={title}
                onChange={(e) => (setTitle ? setTitle(e.target.value) : undefined)}
            />
            <div className="graph-sidebar-panels">
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
    );
}
