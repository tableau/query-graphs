import {ReactElement} from "react";
import "./TreeLabel.css";

export interface TreeLabelProps {
    title: string;
    setTitle?: (v: string) => void;
    metadata?: Map<string, string>;
}

export function TreeLabel({title, setTitle, metadata}: TreeLabelProps) {
    const metadataChildren = [] as ReactElement[];
    for (const [key, value] of (metadata || []).entries()) {
        metadataChildren.push(
            <div key={key}>
                <span className="qg-prop-name">{key}:</span> <span className="qg-prop-value">{value}</span>
            </div>,
        );
    }

    return (
        <div className="react-flow__panel">
            <input
                type="text"
                className="graph-title"
                placeholder="Untitled"
                value={title}
                onChange={(e) => (setTitle ? setTitle(e.target.value) : undefined)}
            />
            <div className="graph-metadata">{metadataChildren}</div>
        </div>
    );
}
