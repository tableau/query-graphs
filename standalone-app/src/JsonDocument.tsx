import {json} from "@codemirror/lang-json";
import type {TextDocument} from "@tableau/query-graphs/lib/tree-description";
import {CodeMirrorDocument} from "./CodeMirrorDocument";

const jsonLanguage = json();

export function JsonDocument({document}: {document: TextDocument}) {
    return <CodeMirrorDocument document={document} languageExtension={jsonLanguage} />;
}
