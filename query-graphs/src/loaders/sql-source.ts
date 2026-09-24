import type {SourceLocation, TextDocument} from "../tree-description";

export interface SqlSourceLocator {
    readonly document: TextDocument;
    fromUtf8Bytes(from: number, to: number): SourceLocation | undefined;
    fromUtf8LineColumns(startLine: number, startColumn: number, endLine: number, endColumn: number): SourceLocation | undefined;
}

const queryDocumentId = "query";

function isValidPosition(value: number): boolean {
    return Number.isSafeInteger(value) && value >= 0;
}

function utf8SequenceLength(leadingByte: number): number {
    if (leadingByte < 0x80) return 1;
    if (leadingByte < 0xe0) return 2;
    if (leadingByte < 0xf0) return 3;
    return 4;
}

interface NormalizedUtf16Index {
    utf16OffsetsByUtf8Byte: Uint32Array;
    lineByteStarts: number[];
}

function createNormalizedUtf16Index(text: string): NormalizedUtf16Index {
    const bytes = new TextEncoder().encode(text);
    const utf16OffsetsByUtf8Byte = new Uint32Array(bytes.length + 1);
    const lineByteStarts = [0];
    utf16OffsetsByUtf8Byte[0] = 1;
    let byteOffset = 0;
    let utf16Offset = 0;
    while (byteOffset < bytes.length) {
        const leadingByte = bytes[byteOffset];
        if (leadingByte === 0x0d) {
            byteOffset += bytes[byteOffset + 1] === 0x0a ? 2 : 1;
            utf16Offset++;
            lineByteStarts.push(byteOffset);
        } else {
            const width = utf8SequenceLength(leadingByte);
            byteOffset += width;
            utf16Offset += width === 4 ? 2 : 1;
            if (leadingByte === 0x0a) lineByteStarts.push(byteOffset);
        }
        utf16OffsetsByUtf8Byte[byteOffset] = utf16Offset + 1;
    }
    return {utf16OffsetsByUtf8Byte, lineByteStarts};
}

function utf16Offset(offsets: Uint32Array, byteOffset: number): number | undefined {
    if (!isValidPosition(byteOffset) || byteOffset >= offsets.length) return undefined;
    const encodedOffset = offsets[byteOffset];
    return encodedOffset === 0 ? undefined : encodedOffset - 1;
}

export function createSqlSourceLocator(rawText: string): SqlSourceLocator {
    const text = rawText.replace(/\r\n?/g, "\n");
    // Hyper positions refer to UTF-8 bytes in the raw SQL, while Umbra positions refer to
    // UTF-8 byte columns in the normalized SQL. Both indexes produce UTF-16 offsets into `text`.
    let rawUtf8Index: NormalizedUtf16Index | undefined;
    let normalizedUtf8Index: NormalizedUtf16Index | undefined;

    const getRawUtf8Index = (): NormalizedUtf16Index => {
        rawUtf8Index ??= createNormalizedUtf16Index(rawText);
        return rawUtf8Index;
    };

    const getNormalizedUtf8Index = (): NormalizedUtf16Index => {
        normalizedUtf8Index ??= createNormalizedUtf16Index(text);
        return normalizedUtf8Index;
    };

    const utf8LineColumnOffset = (line: number, column: number): number | undefined => {
        if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column) || line < 1 || column < 1) return undefined;
        const {utf16OffsetsByUtf8Byte, lineByteStarts} = getNormalizedUtf8Index();
        const lineStart = lineByteStarts[line - 1];
        if (lineStart === undefined) return undefined;
        const nextLineStart = lineByteStarts[line];
        const lineEnd = nextLineStart === undefined ? utf16OffsetsByUtf8Byte.length - 1 : nextLineStart - 1;
        if (lineStart + column - 1 > lineEnd) return undefined;
        return utf16Offset(utf16OffsetsByUtf8Byte, lineStart + column - 1);
    };

    const location = (from: number | undefined, to: number | undefined): SourceLocation | undefined => {
        if (from === undefined || to === undefined || from >= to) return undefined;
        return {documentId: queryDocumentId, from, to};
    };

    return {
        document: {id: queryDocumentId, title: "Original SQL Query", text, language: "sql"},
        fromUtf8Bytes(from, to) {
            if (!isValidPosition(from) || !isValidPosition(to)) return undefined;
            const {utf16OffsetsByUtf8Byte} = getRawUtf8Index();
            return location(utf16Offset(utf16OffsetsByUtf8Byte, from), utf16Offset(utf16OffsetsByUtf8Byte, to));
        },
        fromUtf8LineColumns(startLine, startColumn, endLine, endColumn) {
            return location(utf8LineColumnOffset(startLine, startColumn), utf8LineColumnOffset(endLine, endColumn));
        },
    };
}
