import type {ReactElement} from "react";
import {CollapsiblePanel} from "@tableau/query-graphs/lib/ui/CollapsiblePanel";
import "./TreeLabel.css";

export interface TreeLabelProps {
    title: string;
    setTitle?: (v: string) => void;
    metadata?: Map<string, string>;
    metadataHighlighted?: boolean;
}

export function TreeLabel({title, setTitle, metadata, metadataHighlighted}: TreeLabelProps) {
    const metadataChildren = [] as ReactElement[];
    for (const [key, value] of (metadata || []).entries()) {
        metadataChildren.push(
            <div key={key}>
                <span className="qg-prop-name">{key}:</span> <span className="qg-prop-value">{value}</span>
            </div>,
        );
    }

    return (
        <div className="react-flow__panel graph-label">
            <input
                type="text"
                className="graph-title"
                placeholder="Untitled"
                value={title}
                onChange={(e) => (setTitle ? setTitle(e.target.value) : undefined)}
            />
            {metadataChildren.length > 0 ? (
                <CollapsiblePanel title="Plan Metadata" highlighted={metadataHighlighted} className="graph-metadata-panel">
                    <div className="graph-metadata">{metadataChildren}</div>
                </CollapsiblePanel>
            ) : null}
        </div>
    );
}
