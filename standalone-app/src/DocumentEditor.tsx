import type {TextDocument} from "@tableau/query-graphs/lib/tree-description";
import {CodeDocument} from "./CodeDocument";
import {JsonDocument} from "./JsonDocument";
import {SqlDocument} from "./SqlDocument";

export function DocumentEditor({document}: {document: TextDocument}) {
    switch (document.language?.toLowerCase()) {
        case "json":
            return <JsonDocument document={document} />;
        case "sql":
            return <SqlDocument document={document} />;
        default:
            return <CodeDocument document={document} />;
    }
}
