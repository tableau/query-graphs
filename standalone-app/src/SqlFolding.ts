/** Character offsets that CodeMirror replaces with a folded-range marker. */
export interface FoldRange {
    from: number;
    to: number;
}

/**
 * CodeMirror displays one fold control per line. When multiple constructs start
 * on that line, retain the widest one so the control hides the most useful range.
 */
function addFold(folds: Map<number, FoldRange>, lineStart: number, fold: FoldRange) {
    const existing = folds.get(lineStart);
    if (existing === undefined || fold.to - fold.from > existing.to - existing.from) folds.set(lineStart, fold);
}

/** A full-line `--` comment and the offset at which its following line starts. */
interface LineComment {
    lineStart: number;
    lineEnd: number;
    nextLineStart?: number;
}

/**
 * Turn adjacent runs of at least three full-line comments into folds. The first
 * comment stays visible and acts as the summary for the hidden following lines.
 */
function addLineCommentFolds(lineComments: readonly LineComment[], folds: Map<number, FoldRange>) {
    for (let runStart = 0; runStart < lineComments.length;) {
        let runEnd = runStart + 1;
        // `nextLineStart` makes adjacency independent of whether the document uses LF or CRLF.
        while (runEnd < lineComments.length && lineComments[runEnd].lineStart === lineComments[runEnd - 1].nextLineStart) {
            runEnd++;
        }
        if (runEnd - runStart >= 3) {
            const first = lineComments[runStart];
            const last = lineComments[runEnd - 1];
            addFold(folds, first.lineStart, {from: first.lineEnd, to: last.lineEnd});
        }
        runStart = runEnd;
    }
}

/**
 * Find useful structural folds without exposing the SQL parser's whole-statement
 * folds. This deliberately lightweight lexical scan recognizes multiline
 * parentheses and comments while ignoring delimiter-like text inside single-,
 * double-, backtick-, and bracket-delimited quoted text.
 */
export function findSqlFolds(text: string): ReadonlyMap<number, FoldRange> {
    const openParentheses: {position: number; lineStart: number}[] = [];
    const lineComments: LineComment[] = [];
    const folds = new Map<number, FoldRange>();

    // At most one of these lexical modes is active. While active, parentheses and
    // comment markers are treated as ordinary text until that mode is closed.
    let quote: "'" | '"' | "`" | "]" | undefined;
    let lineComment: {foldLineStart?: number} | undefined;
    let blockComment: {position: number; lineStart: number} | undefined;
    let lineStart = 0;

    for (let position = 0; position < text.length; position++) {
        const character = text[position];
        const nextCharacter = text[position + 1];
        if (character === "\n") lineStart = position + 1;

        if (lineComment !== undefined) {
            if (character === "\n") {
                if (lineComment.foldLineStart !== undefined) {
                    lineComments.push({
                        lineStart: lineComment.foldLineStart,
                        lineEnd: text[position - 1] === "\r" ? position - 1 : position,
                        nextLineStart: position + 1,
                    });
                }
                lineComment = undefined;
            }
            continue;
        }
        if (blockComment !== undefined) {
            if (character === "*" && nextCharacter === "/") {
                if (lineStart > blockComment.lineStart) {
                    addFold(folds, blockComment.lineStart, {from: blockComment.position + 2, to: position});
                }
                blockComment = undefined;
                position++;
            }
            continue;
        }
        if (quote !== undefined) {
            if (character === quote) {
                // SQL escapes quote delimiters by doubling them. A single delimiter closes the quote.
                if (nextCharacter === quote) position++;
                else quote = undefined;
            } else if (character === "\\") {
                // Also tolerate dialects that use backslash escapes.
                position++;
            }
            continue;
        }

        if (character === "-" && nextCharacter === "-") {
            // Only comments that are the first non-whitespace content on their line may join a foldable run.
            lineComment = {foldLineStart: text.slice(lineStart, position).trim() === "" ? lineStart : undefined};
            position++;
        } else if (character === "/" && nextCharacter === "*") {
            blockComment = {position, lineStart};
            position++;
        } else if (character === "'" || character === '"' || character === "`") {
            quote = character;
        } else if (character === "[") {
            quote = "]";
        } else if (character === "(") {
            // The stack pairs nested parentheses without needing a full SQL parse.
            openParentheses.push({position, lineStart});
        } else if (character === ")") {
            const open = openParentheses.pop();
            if (open !== undefined && lineStart > open.lineStart) {
                addFold(folds, open.lineStart, {from: open.position + 1, to: position});
            }
        }
    }

    // A final `--` comment has no newline at which the main loop could record it.
    if (lineComment?.foldLineStart !== undefined) {
        lineComments.push({lineStart: lineComment.foldLineStart, lineEnd: text.length});
    }
    addLineCommentFolds(lineComments, folds);
    return folds;
}
