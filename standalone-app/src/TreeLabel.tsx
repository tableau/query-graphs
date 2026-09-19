import {lazy, Suspense, useState, type ReactElement} from "react";
import {CollapsiblePanel} from "@tableau/query-graphs/lib/ui/CollapsiblePanel";
import {CopyButton} from "@tableau/query-graphs/lib/ui/CopyButton";
import type {TextDocument} from "@tableau/query-graphs/lib/tree-description";
import "./TreeLabel.css";

const JsonDocument = lazy(() => import("./JsonDocument").then((module) => ({default: module.JsonDocument})));

export interface TreeLabelProps {
    title: string;
    setTitle?: (v: string) => void;
    metadata?: Map<string, string>;
    metadataHighlighted?: boolean;
    textDocuments?: TextDocument[];
}

function PlainTextDocument({document}: {document: TextDocument}) {
    return (
        <textarea
            className="graph-text-document"
            value={document.text}
            readOnly
            spellCheck={false}
            aria-label={document.title}
            rows={12}
        />
    );
}

function TextDocumentPanel({document}: {document: TextDocument}) {
    const [opened, setOpened] = useState(false);
    return (
        <CollapsiblePanel
            title={document.title}
            headerActions={<CopyButton text={document.text} contentName={document.title} />}
            onToggle={(open) => setOpened((wasOpened) => wasOpened || open)}
        >
            {opened ? (
                document.language === "json" ? (
                    <Suspense
                        fallback={
                            <div className="graph-text-document graph-text-document-loading" role="status">
                                Loading document…
                            </div>
                        }
                    >
                        <JsonDocument document={document} />
                    </Suspense>
                ) : (
                    <PlainTextDocument document={document} />
                )
            ) : null}
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
        <div className="react-flow__panel graph-sidebar">
            <input
                type="text"
                className="graph-title"
                placeholder="Untitled"
                value={title}
                onChange={(e) => (setTitle ? setTitle(e.target.value) : undefined)}
            />
            {metadataChildren.length > 0 ? (
                <CollapsiblePanel title="Plan Metadata" highlighted={metadataHighlighted}>
                    <div className="graph-metadata">{metadataChildren}</div>
                </CollapsiblePanel>
            ) : null}
            {textDocuments?.map((document) => (
                <TextDocumentPanel key={document.id} document={document} />
            ))}
        </div>
    );
}
