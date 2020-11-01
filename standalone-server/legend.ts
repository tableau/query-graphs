import "@tableau/query-graphs/style/query-graphs.css";
import {defineSymbols} from "@tableau/query-graphs/lib/symbols";

const symbols = [
    {name: "Default", symbol: "default-symbol"},
    {name: "Table", symbol: "table-symbol"},
    {name: "Run Query", symbol: "run-query-symbol"},
    {name: "Filter", symbol: "filter-symbol"},
    {name: "Sort", symbol: "sort-symbol"},
    {name: "Inner Join", symbol: "inner-join-symbol"},
    {name: "Left Join", symbol: "left-join-symbol"},
    {name: "Right Join", symbol: "right-join-symbol"},
    {name: "Full Join", symbol: "full-join-symbol"},
    {name: "Const Table", symbol: "const-table-symbol"},
    {name: "Virtual Table", symbol: "virtual-table-symbol"},
    {name: "Temp Table", symbol: "temp-table-symbol"},
];

window.addEventListener("DOMContentLoaded", () => {
    const svgRoot = document.getElementsByTagName("svg")[0];
    console.log(svgRoot);
    defineSymbols(svgRoot);

    symbols.forEach((s, idx) => {
        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        group.setAttribute("class", "qg-expanded");
        group.setAttribute("transform", `translate(0, ${idx * 32})`);

        const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttribute("href", "#" + s.symbol);
        use.setAttribute("transform", "scale(2) translate(12, 8)");
        group.append(use);

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", "56");
        text.setAttribute("y", "22");
        text.setAttribute("style", "font-size: 14px");
        text.append(document.createTextNode(s.name));
        group.append(text);

        svgRoot.append(group);
    });

    svgRoot.setAttribute("viewBox", `0,0,200,${symbols.length * 32}`);
    svgRoot.setAttribute("width", "200");
});
