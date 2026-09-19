import {sql, StandardSQL} from "@codemirror/lang-sql";
import {foldNodeProp, foldService} from "@codemirror/language";
import type {EditorState} from "@codemirror/state";
import type {TextDocument} from "@tableau/query-graphs/lib/tree-description";
import {CodeDocument} from "./CodeDocument";

interface FoldRange {
    from: number;
    to: number;
}

const parenthesisFolds = new WeakMap<object, ReadonlyMap<number, FoldRange>>();

// Match parentheses without relying on the SQL syntax tree, while avoiding delimiters in common quoted and commented text.
function findSqlParenthesisFolds(text: string): ReadonlyMap<number, FoldRange> {
    const openParentheses: {position: number; lineStart: number}[] = [];
    const folds = new Map<number, FoldRange>();
    let quote: "'" | '"' | "`" | "]" | undefined;
    let lineComment = false;
    let blockComment = false;
    let lineStart = 0;

    for (let position = 0; position < text.length; position++) {
        const character = text[position];
        const nextCharacter = text[position + 1];
        if (character === "\n") lineStart = position + 1;

        if (lineComment) {
            if (character === "\n") lineComment = false;
            continue;
        }
        if (blockComment) {
            if (character === "*" && nextCharacter === "/") {
                blockComment = false;
                position++;
            }
            continue;
        }
        if (quote !== undefined) {
            if (character === quote) {
                if (nextCharacter === quote) position++;
                else quote = undefined;
            } else if (character === "\\") {
                position++;
            }
            continue;
        }

        if (character === "-" && nextCharacter === "-") {
            lineComment = true;
            position++;
        } else if (character === "/" && nextCharacter === "*") {
            blockComment = true;
            position++;
        } else if (character === "'" || character === '"' || character === "`") {
            quote = character;
        } else if (character === "[") {
            quote = "]";
        } else if (character === "(") {
            openParentheses.push({position, lineStart});
        } else if (character === ")") {
            const open = openParentheses.pop();
            if (open === undefined) continue;
            if (lineStart > open.lineStart) folds.set(open.lineStart, {from: open.position + 1, to: position});
        }
    }

    return folds;
}

function getParenthesisFolds(state: EditorState): ReadonlyMap<number, FoldRange> {
    const cached = parenthesisFolds.get(state.doc);
    if (cached !== undefined) return cached;
    const folds = findSqlParenthesisFolds(state.doc.toString());
    parenthesisFolds.set(state.doc, folds);
    return folds;
}

// The SQL parser otherwise advertises whole statements and block comments as foldable ranges.
const noSyntaxFolding = foldNodeProp.add(() => () => null);
const sqlDialect = StandardSQL.configureLanguage({props: [noSyntaxFolding]});
const sqlLanguage = sql({dialect: sqlDialect});
const sqlParenthesisFolding = foldService.of((state, lineStart) => getParenthesisFolds(state).get(lineStart) ?? null);
const sqlExtensions = [sqlLanguage, sqlParenthesisFolding];

export function SqlDocument({document}: {document: TextDocument}) {
    return <CodeDocument document={document} languageExtension={sqlExtensions} />;
}
