import {CodeMirrorDocument} from "./CodeMirrorDocument";
import type {DocumentViewerProps} from "./CodeMirrorDocument";
import {JsonDocument} from "./JsonDocument";
import {SqlDocument} from "./SqlDocument";

export function DocumentPane(props: DocumentViewerProps) {
    const {document} = props;
    switch (document.language?.toLowerCase()) {
        case "json":
            return <JsonDocument {...props} />;
        case "sql":
            return <SqlDocument {...props} />;
        default:
            return <CodeMirrorDocument {...props} />;
    }
}
