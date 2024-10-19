import "./TreeLabel.css";

export interface TreeLabelProps {
    title: string;
    setTitle?: (v: string) => void;
}

export function TreeLabel({title, setTitle}: TreeLabelProps) {
    return (
        <div className="react-flow__panel">
            <input
                type="text"
                className="graph-title"
                placeholder="Untitled"
                value={title}
                onChange={(e) => (setTitle ? setTitle(e.target.value) : undefined)}
            />
        </div>
    );
}
