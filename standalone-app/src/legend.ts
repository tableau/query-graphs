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
    {name: "Zoom In", symbol: "zoom-in-symbol"},
    {name: "Zoom Out", symbol: "zoom-out-symbol"},
    {name: "Rotate Left", symbol: "rotate-left-symbol"},
    {name: "Rotate Right", symbol: "rotate-right-symbol"},
    {name: "Recenter", symbol: "recenter-symbol"},
    {name: "Fit to screen", symbol: "fit-screen-symbol"},
];

window.addEventListener("DOMContentLoaded", () => {
    const svgRoot = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    document.body.appendChild(svgRoot);
    console.log(svgRoot);
    defineSymbols(svgRoot);

    symbols.forEach((s, idx) => {
        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        group.setAttribute("class", "qg-expanded");
        group.setAttribute("transform", `translate(0, ${idx * 32})`);

        const use1 = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use1.setAttribute("href", "#" + s.symbol);
        use1.setAttribute("transform", "translate(16, 16) scale(1)");
        group.append(use1);

        const use2 = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use2.setAttribute("href", "#" + s.symbol);
        use2.setAttribute("transform", "translate(48, 16) scale(1.5)");
        group.append(use2);

        const use3 = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use3.setAttribute("href", "#" + s.symbol);
        use3.setAttribute("transform", "translate(96, 16) scale(2)");
        group.append(use3);

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", "128");
        text.setAttribute("y", "22");
        text.setAttribute("style", "font-size: 14px");
        text.append(document.createTextNode(s.name));
        group.append(text);

        svgRoot.append(group);
    });

    svgRoot.setAttribute("viewBox", `0,0,200,${symbols.length * 32}`);
    svgRoot.setAttribute("width", "200");
});
