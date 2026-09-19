import {json} from "@codemirror/lang-json";
import type {TextDocument} from "@tableau/query-graphs/lib/tree-description";
import {CodeDocument} from "./CodeDocument";

const jsonLanguage = json();

export function JsonDocument({document}: {document: TextDocument}) {
    return <CodeDocument document={document} languageExtension={jsonLanguage} />;
}
