import type {TextDocument} from "@tableau/query-graphs/lib/tree-description";
import {CodeMirrorDocument} from "./CodeMirrorDocument";
import {JsonDocument} from "./JsonDocument";
import {SqlDocument} from "./SqlDocument";

export function DocumentPane({document}: {document: TextDocument}) {
    switch (document.language?.toLowerCase()) {
        case "json":
            return <JsonDocument document={document} />;
        case "sql":
            return <SqlDocument document={document} />;
        default:
            return <CodeMirrorDocument document={document} />;
    }
}
