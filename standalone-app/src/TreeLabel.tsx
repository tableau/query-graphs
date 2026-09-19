import type {ReactElement} from "react";
import {CollapsiblePanel} from "@tableau/query-graphs/lib/ui/CollapsiblePanel";
import {CopyButton} from "@tableau/query-graphs/lib/ui/CopyButton";
import type {TextDocument} from "@tableau/query-graphs/lib/tree-description";
import "./TreeLabel.css";

export interface TreeLabelProps {
    title: string;
    setTitle?: (v: string) => void;
    metadata?: Map<string, string>;
    metadataHighlighted?: boolean;
    textDocuments?: TextDocument[];
}

function TextDocumentPanel({document}: {document: TextDocument}) {
    return (
        <CollapsiblePanel title={document.title} headerActions={<CopyButton text={document.text} contentName={document.title} />}>
            <textarea
                className="graph-text-document"
                value={document.text}
                readOnly
                spellCheck={false}
                aria-label={document.title}
                rows={12}
            />
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
