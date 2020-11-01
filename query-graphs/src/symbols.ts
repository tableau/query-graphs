import {select} from "d3-selection";

//
// Create the symbols
//
export function defineSymbols(baseSvg: SVGElement) {
    const defs = select(baseSvg).append("defs");
    // Build the arrow
    defs.append("svg:marker")
        .attr("id", "arrow")
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 18)
        .attr("refY", 0)
        .attr("markerWidth", 5)
        .attr("markerHeight", 5)
        .attr("orient", "auto-start-reverse")
        .append("svg:path")
        .attr("d", "M0,-5L10,0L0,5");

    // Build the default symbol. Use this symbol if there is not a better fit
    defs.append("circle")
        .attr("id", "default-symbol")
        .attr("class", "qg-symbol-filled")
        .attr("r", 5);

    // Build the run query symbol
    const runQueryGroup = defs.append("g").attr("id", "run-query-symbol");
    runQueryGroup
        .append("circle")
        .attr("class", "qg-symbol-filled")
        .attr("r", 6);
    runQueryGroup
        .append("path")
        .attr("class", "qg-run-query")
        .attr("d", "M-2.5,-3.5L4,0L-2.5,3.5 z");

    // Build the Join symbols. They are just 2 overlapped circles for the most part.
    const radius = 6.0;
    const leftOffset = -3.0;
    const rightOffset = 3.0;

    const leftJoinGroup = defs.append("g").attr("id", "left-join-symbol");
    leftJoinGroup
        .append("circle")
        .attr("class", "qg-empty-join")
        .attr("r", radius)
        .attr("cx", rightOffset);
    leftJoinGroup
        .append("circle")
        .attr("class", "qg-fill-join")
        .attr("r", radius)
        .attr("cx", leftOffset);
    leftJoinGroup
        .append("circle")
        .attr("class", "qg-only-stroke-join")
        .attr("r", radius)
        .attr("cx", rightOffset);

    const rightJoinGroup = defs.append("g").attr("id", "right-join-symbol");
    rightJoinGroup
        .append("circle")
        .attr("class", "qg-empty-join")
        .attr("r", radius)
        .attr("cx", leftOffset);
    rightJoinGroup
        .append("circle")
        .attr("class", "qg-fill-join")
        .attr("r", radius)
        .attr("cx", rightOffset);
    rightJoinGroup
        .append("circle")
        .attr("class", "qg-only-stroke-join")
        .attr("r", radius)
        .attr("cx", leftOffset);

    const fullJoinGroup = defs.append("g").attr("id", "full-join-symbol");
    fullJoinGroup
        .append("circle")
        .attr("class", "qg-fill-join qg-no-stroke")
        .attr("r", radius)
        .attr("cx", rightOffset);
    fullJoinGroup
        .append("circle")
        .attr("class", "qg-fill-join")
        .attr("r", radius)
        .attr("cx", leftOffset);
    fullJoinGroup
        .append("circle")
        .attr("class", "qg-only-stroke-join")
        .attr("r", radius)
        .attr("cx", rightOffset);

    // Drawing inner joins is more complex. We'll clip a circle (with another circle) to get the intersection shape
    defs.append("clipPath")
        .attr("id", "join-clip")
        .append("circle")
        .attr("class", "qg-empty-join")
        .attr("r", radius)
        .attr("cx", leftOffset);

    const innerJoinGroup = defs.append("g").attr("id", "inner-join-symbol");
    innerJoinGroup
        .append("circle")
        .attr("class", "qg-empty-join")
        .attr("r", radius)
        .attr("cx", leftOffset);
    innerJoinGroup
        .append("circle")
        .attr("class", "qg-empty-join")
        .attr("r", radius)
        .attr("cx", rightOffset);
    innerJoinGroup
        .append("circle")
        .attr("class", "qg-fill-join qg-no-stroke")
        .attr("clip-path", "url(#join-clip)")
        .attr("r", radius)
        .attr("cx", rightOffset);
    innerJoinGroup
        .append("circle")
        .attr("class", "qg-only-stroke-join")
        .attr("r", radius)
        .attr("cx", leftOffset);
    innerJoinGroup
        .append("circle")
        .attr("class", "qg-only-stroke-join")
        .attr("r", radius)
        .attr("cx", rightOffset);

    // Build the table symbol. Made out of several rectangles.
    const tableRowWidth = 5.2;
    const tableRowHeight = 2.8;
    const tableWidth = tableRowWidth * 3;
    const tableHeight = tableRowHeight * 4;
    const tableStartLeft = -tableWidth / 2;
    const tableStartTop = -tableHeight / 2;

    const tableGroup = defs.append("g").attr("id", "table-symbol");
    tableGroup
        .append("rect")
        .attr("class", "qg-table-background")
        .attr("x", tableStartLeft)
        .attr("width", tableWidth)
        .attr("y", tableStartTop)
        .attr("height", tableHeight);
    tableGroup
        .append("rect")
        .attr("class", "qg-table-header")
        .attr("x", tableStartLeft)
        .attr("width", tableWidth)
        .attr("y", tableStartTop)
        .attr("height", tableRowHeight);
    tableGroup
        .append("rect")
        .attr("class", "qg-table-border")
        .attr("x", tableStartLeft)
        .attr("width", tableWidth)
        .attr("y", 0)
        .attr("height", tableRowHeight);
    tableGroup
        .append("rect")
        .attr("class", "qg-table-border")
        .attr("x", -tableRowWidth / 2)
        .attr("width", tableRowWidth)
        .attr("y", tableStartTop + tableRowHeight)
        .attr("height", tableHeight - tableRowHeight);

    defs.append("path")
        .attr("id", "filter-symbol")
        .attr("class", "qg-symbol-filled")
        .attr("d", "M-6,-6 L6,-6 L0.8,0 L0.8,5 L-0.8,7 L-0.8,0 Z");

    // Build the additional table symbol, very similar to the regular table symbol
    function createLabeledTableSymbol(id: string, label: string) {
        const labeledTableGroup = defs.append("g").attr("id", id);
        labeledTableGroup
            .append("rect")
            .attr("class", "qg-table-background")
            .attr("x", tableStartLeft)
            .attr("width", tableWidth)
            .attr("y", tableStartTop)
            .attr("height", tableHeight);
        labeledTableGroup
            .append("rect")
            .attr("class", "qg-table-header")
            .attr("x", tableStartLeft)
            .attr("width", tableWidth)
            .attr("y", tableStartTop)
            .attr("height", tableRowHeight);
        labeledTableGroup
            .append("text")
            .attr("class", "qg-table-text")
            .attr("y", tableRowHeight + 0.8 /* stroke-width */ / 2)
            .text(label);
    }
    createLabeledTableSymbol("temp-table-symbol", "tmp");
    createLabeledTableSymbol("virtual-table-symbol", "dmv");
    createLabeledTableSymbol("const-table-symbol", "cnst");
}
