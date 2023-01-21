// Import local modules
import * as treeDescription from "./tree-description";
import {TreeNode, TreeDescription, Crosslink, GraphOrientation} from "./tree-description";
import {assertNotNull} from "./loader-utils";
import {defineSymbols} from "./symbols";

// Third-party dependencies
import * as d3selection from "d3-selection";
import * as d3flextree from "d3-flextree";
import * as d3hierarchy from "d3-hierarchy";
import * as d3shape from "d3-shape";
import * as d3zoom from "d3-zoom";
import * as d3interpolate from "d3-interpolate";
import d3tip from "d3-tip";

const MAX_DISPLAY_LENGTH = 15;
const FLEX_NODE_SIZE = 220;
const FOREIGN_OBJECT_SIZE = FLEX_NODE_SIZE * 0.85;
const ALT_CLICK_TOGGLE_NODE = true;

type d3point = [number, number];

interface xyPos {
    x: number;
    y: number;
}

interface xyLink {
    source: xyPos;
    target: xyPos;
}

interface Orientation {
    link: typeof d3shape.linkVertical;
    x: (d: xyPos, viewSize: xyPos) => number;
    y: (d: xyPos, viewSize: xyPos) => number;
    textdimension: "y" | "x";
    textdimensionoffset: (d: d3hierarchy.HierarchyNode<unknown>, maxLabelLength: number) => number;
    textanchor: (d: d3hierarchy.HierarchyNode<unknown>) => string;
    rectoffsetx: (d: d3hierarchy.HierarchyNode<unknown>, maxLabelLength: number) => number;
    rectoffsety: (d: d3hierarchy.HierarchyNode<unknown>, maxLabelLength: number) => number;
    foreignoffsetx: (d: d3hierarchy.HierarchyNode<unknown>, maxLabelLength: number) => number;
    nudgeoffsety: number;
    nodesize: (maxLabelLength: number) => d3point;
    nodesep: (a: d3hierarchy.HierarchyNode<unknown>, b: d3hierarchy.HierarchyNode<unknown>) => number;
    nodespacing: (a: d3hierarchy.HierarchyNode<TreeNode>, b: d3hierarchy.HierarchyNode<TreeNode>) => number;
    rootx: (viewSize: xyPos, scale: number, maxLabelLength: number) => number;
    rooty: (viewSize: xyPos, scale: number, maxLabelLength: number) => number;
}

interface LabelOrientation {
    toggledx: (d: d3hierarchy.HierarchyPointLink<TreeNode>) => number;
    toggledy: (d: d3hierarchy.HierarchyPointLink<TreeNode>) => number;
}

// Orientation mapping
const orientations: {[k in GraphOrientation]: Orientation} = {
    "top-to-bottom": {
        link: d3shape.linkVertical,
        x: (d, _viewSize) => d.x,
        y: (d, _viewSize) => d.y,
        textdimension: "y",
        textdimensionoffset: d => (d.children ? -13 : 13),
        textanchor: d => (d.children ? "middle" : "middle"),
        rectoffsetx: (d, maxLabelLength) => (-(maxLabelLength - 2) * 6) / 2,
        rectoffsety: (d, _maxLabelLength) => (d.children ? -13 - 13 / 2 : 13 - 13 / 2),
        foreignoffsetx: (_d, _maxLabelLength) => -FOREIGN_OBJECT_SIZE / 2,
        nudgeoffsety: -0.2,
        nodesize: maxLabelLength => [maxLabelLength * 6, 45] as d3point,
        nodesep: (a, b) => (a.parent === b.parent ? 1 : 1),
        nodespacing: (a, b) => (a.parent === b.parent ? 0 : 0),
        rootx: (_viewSize, _scale, _maxLabelLength) => 0,
        rooty: (viewSize, scale, _maxLabelLength) => viewSize.y / 2 / scale - 100,
    },
    "right-to-left": {
        link: d3shape.linkHorizontal,
        x: (d, viewSize) => viewSize.y - d.y,
        y: (d, _viewSize) => d.x,
        textdimension: "x",
        textdimensionoffset: d => (d.children ? 10 : -10),
        textanchor: d => (d.children ? "start" : "end"),
        rectoffsetx: (d, maxLabelLength) => (d.children ? 10 - 1.5 : -(maxLabelLength - 2) * 6 - (10 - 1.5)),
        rectoffsety: (_d, _maxLabelLength) => -13 / 2,
        foreignoffsetx: (_d, _maxLabelLength) => -FOREIGN_OBJECT_SIZE / 2,
        nudgeoffsety: -0.2,
        nodesize: maxLabelLength =>
            [11.2 /* table node diameter */ + 2, Math.max(90, maxLabelLength * 6 + 10 /* textdimensionoffset */)] as d3point,
        nodesep: (a, b) => (a.parent === b.parent ? 1 : 1.5),
        nodespacing: (a, b) => (a.parent === b.parent ? (a.data.nodeToggled && b.data.nodeToggled ? 0 : FLEX_NODE_SIZE / 3) : 0),
        rootx: (viewSize, scale, _maxLabelLength) => viewSize.x / 2 / scale + FOREIGN_OBJECT_SIZE,
        rooty: (_viewSize, _scale, _maxLabelLength) => 0,
    },
    "bottom-to-top": {
        link: d3shape.linkVertical,
        x: (d, _viewSize) => d.x,
        y: (d, viewSize) => viewSize.y - d.y,
        textdimension: "y",
        textdimensionoffset: d => (d.children ? 13 : -13),
        textanchor: d => (d.children ? "middle" : "middle"),
        rectoffsetx: (d, maxLabelLength) => (-(maxLabelLength - 2) * 6) / 2,
        rectoffsety: (d, _maxLabelLength) => (d.children ? 13 - 13 / 2 : -13 - 13 / 2),
        foreignoffsetx: (_d, _maxLabelLength) => -FOREIGN_OBJECT_SIZE / 2,
        nudgeoffsety: -0.2,
        nodesize: maxLabelLength => [maxLabelLength * 6, 45] as d3point,
        nodesep: (a, b) => (a.parent === b.parent ? 1 : 1),
        nodespacing: (a, b) => (a.parent === b.parent ? 0 : 0),
        rootx: (_viewSize, _scale, _maxLabelLength) => 0,
        rooty: (viewSize, scale, _maxLabelLength) => viewSize.y - viewSize.y / 2 / scale + FOREIGN_OBJECT_SIZE + 10 - 1.5,
    },
    "left-to-right": {
        link: d3shape.linkHorizontal,
        x: (d, _viewSize) => d.y,
        y: (d, _viewSize) => d.x,
        textdimension: "x",
        textdimensionoffset: d => (d.children ? -10 : 10),
        textanchor: d => (d.children ? "end" : "start"),
        rectoffsetx: (d, maxLabelLength) => (d.children ? -(maxLabelLength - 2) * 6 - (10 - 1.5) : 10 - 1.5),
        rectoffsety: (_d, _maxLabelLength) => -13 / 2,
        foreignoffsetx: (_d, _maxLabelLength) => -FOREIGN_OBJECT_SIZE / 2,
        nudgeoffsety: -0.2,
        nodesize: maxLabelLength =>
            [11.2 /* table node diameter */ + 2, Math.max(90, maxLabelLength * 6 + 10 /* textdimensionoffset */)] as d3point,
        nodesep: (a, b) => (a.parent === b.parent ? 1 : 2),
        nodespacing: (a, b) => (a.parent === b.parent ? (a.data.nodeToggled && b.data.nodeToggled ? 0 : FLEX_NODE_SIZE / 3) : 0),
        rootx: (viewSize, scale, _maxLabelLength) => viewSize.x / 2 / scale - FOREIGN_OBJECT_SIZE,
        rooty: (_viewSize, _scale, _maxLabelLength) => 0,
    },
};

//
// Abbreviate all names if they are too long
//
function abbreviateName(name: string) {
    if (name && name.length > MAX_DISPLAY_LENGTH) {
        return name.substring(0, MAX_DISPLAY_LENGTH) + "…";
    }
    return name;
}

//
// Escapes a string for HTML
//
function escapeHtml(unsafe: string) {
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Link cross-links against a d3 hierarchy
function linkCrossLinks(root: d3hierarchy.HierarchyNode<treeDescription.TreeNode>, crosslinks: Crosslink[]) {
    const descendants = root.descendants();
    const map = (d: treeDescription.TreeNode) => descendants.find(h => h.data === d);
    const linked: any[] = [];
    crosslinks.forEach(l => {
        linked.push({source: map(l.source), target: map(l.target)});
    });
    return linked;
}

//
// Draw query tree
//
// Creates an `svg` element below the `target` DOM node and draws the query
// tree within it.
export function drawQueryTree(target: HTMLElement, treeData: TreeDescription) {
    const root = d3hierarchy.hierarchy(treeData.root, treeDescription.allChildren);
    const crosslinks = linkCrossLinks(root, treeData.crosslinks ?? []);
    const graphOrientation = treeData.graphOrientation ?? "top-to-bottom";
    const DEBUG = treeData.DEBUG ?? false;
    const prevPos = new Map<TreeNode, xyPos>();

    // Establish maxLabelLength and set ids
    let nextId = 0;
    const nodeIds = new Map<TreeNode, string>();
    let totalNodes = 0;
    let maxLabelLength = 0;
    treeDescription.visitTreeNodes(
        treeData.root,
        d => {
            nodeIds.set(d, "" + nextId++);
            totalNodes++;
            if (d.name) {
                maxLabelLength = Math.max(d.name.length, maxLabelLength);
            }
        },
        treeDescription.allChildren,
    );

    // Limit maximum label length and keep layout tight for short names
    maxLabelLength = Math.min(maxLabelLength, MAX_DISPLAY_LENGTH + 2 /* include ellipsis */);

    // Misc. variables
    const duration = 750;

    // Size of the diagram
    const viewSize = {x: target.clientWidth, y: target.clientHeight};
    const ooo = orientations[graphOrientation];

    // Orient labels according to node expansion
    const labelOrientations: {[k in GraphOrientation]: LabelOrientation} = {
        "top-to-bottom": {
            toggledx: d =>
                d.source.data.nodeToggled && d.source.data.nodeToggled
                    ? ooo.x(d.target, viewSize)
                    : (ooo.x(d.source, viewSize) + ooo.x(d.target, viewSize)) / 2,
            toggledy: d =>
                (ooo.y(d.source, viewSize) +
                    (d.source.data.nodeToggled !== undefined && d.source.data.nodeToggled
                        ? FOREIGN_OBJECT_SIZE + (ooo.rectoffsety(d.source, maxLabelLength) + ooo.nudgeoffsety)
                        : 0) +
                    ooo.y(d.target, viewSize)) /
                2,
        },
        "left-to-right": {
            toggledx: d => (ooo.x(d.source, viewSize) + ooo.x(d.target, viewSize)) / 2,
            toggledy: d => (ooo.y(d.source, viewSize) + ooo.y(d.target, viewSize)) / 2,
        },
        "bottom-to-top": {
            toggledx: d => (ooo.x(d.source, viewSize) + ooo.x(d.target, viewSize)) / 2,
            toggledy: d =>
                (ooo.y(d.source, viewSize) +
                    (d.source.data.nodeToggled !== undefined && d.source.data.nodeToggled
                        ? FOREIGN_OBJECT_SIZE + (ooo.rectoffsety(d.source, maxLabelLength) + ooo.nudgeoffsety)
                        : 0) +
                    ooo.y(d.target, viewSize)) /
                2,
        },
        "right-to-left": {
            toggledx: d => (ooo.x(d.source, viewSize) + ooo.x(d.target, viewSize)) / 2,
            toggledy: d => (ooo.y(d.source, viewSize) + ooo.y(d.target, viewSize)) / 2,
        },
    };
    const labelOrientation = labelOrientations[graphOrientation];

    function foreignObjectToggled(d) {
        return (
            d.data.nodeToggled &&
            !d.data.collapsedByDefault &&
            (d.data.properties?.size != 0 || getTooltipProperties(d.data).size != 0)
        );
    }

    const treelayout = d3flextree
        .flextree<treeDescription.TreeNode>()
        .nodeSize(d => {
            if (foreignObjectToggled(d)) {
                return [FLEX_NODE_SIZE, FLEX_NODE_SIZE];
            } else {
                return ooo.nodesize(maxLabelLength);
            }
        })
        .spacing((a, b) => ooo.nodespacing(a, b));

    // Define a d3 diagonal projection for use by the node paths later on.
    const diagonal = ooo
        .link<xyLink, xyPos>()
        .x(d => ooo.x(d, viewSize))
        .y(d => ooo.y(d, viewSize));

    // Build a HTML list of properties to be displayed in a tooltip
    function buildPropertyList(properties: Map<string, string>, cssClass = "qg-prop-name") {
        let html = "";
        for (const [key, value] of properties.entries()) {
            html += "<span class='" + cssClass + "'>" + escapeHtml(key) + ": </span>";
            html += "<span style='prop-value'>" + escapeHtml(value) + "</span><br />";
        }
        return html;
    }

    // Get additional properties which should be rendered in the tooltip
    function getTooltipProperties(d: TreeNode) {
        const properties = new Map<string, string>();
        if (d.text) {
            properties.set("text", d.text);
        }
        if (d.tag) {
            properties.set("tag", d.tag);
        }
        if (d.class) {
            properties.set("class", d.class);
        }
        return properties;
    }

    // Retrieve all properties of the node object which should be rendered in the tooltip for debugging
    function getDebugProperties(d: d3hierarchy.HierarchyPointNode<TreeNode>): Map<string, string> {
        const props = new Map<string, string>();
        props.set("height", d.height.toString());
        props.set("depth", d.depth.toString());
        props.set("x", d.x.toString());
        props.set("y", d.y.toString());
        props.set("rectFill", d.data.rectFill ?? "undefined");
        props.set("rectFillOpacity", (d.data.rectFillOpacity ?? "undefined").toString());
        props.set("nodeToggled", (d.data.nodeToggled ?? "undefined").toString());
        props.set("collapsedByDefault", (d.data.collapsedByDefault ?? "undefined").toString());
        return props;
    }

    // Initialize tooltip
    const tip = d3tip()
        .attr("class", "qg-tooltip")
        .offset([-10, 0])
        .html((_e: unknown, d: d3hierarchy.HierarchyPointNode<TreeNode>) => {
            let text = "<span style='text-decoration: underline'>" + escapeHtml(d.data.name ?? "") + "</span><br />";
            if (DEBUG) {
                text += buildPropertyList(getDebugProperties(d), "qg-prop-name2");
                text += buildPropertyList(getTooltipProperties(d.data), "qg-prop-name2");
            }
            if (d.data.properties !== undefined) {
                text += buildPropertyList(d.data.properties);
            }
            return text;
        });

    // Define the baseSvg, attaching a class for styling and the zoomBehavior
    const baseSvg = d3selection
        .select(target)
        .append("svg")
        .attr("viewBox", `0 0 ${viewSize.x} ${viewSize.y}`)
        .attr("height", viewSize.y)
        .attr("class", "qg-overlay");
    const baseSvgElem = baseSvg.node() as SVGSVGElement;
    defineSymbols(baseSvgElem);

    // Append a group which holds all nodes and which the zoom Listener can act upon.
    const svgGroup = baseSvg.append("g");

    // Compute path for browsers not supporting Event.Path such as Safari and Firefox
    function computePath(e) {
        const path: SVGPathElement[] = [];
        let currentElem = e.target;
        while (currentElem) {
            path.push(currentElem);
            currentElem = currentElem.parentElement;
        }
        return path;
    }

    // Define the zoomBehavior which calls the zoom function on the "zoom" event constrained within the scaleExtents
    const zoomBehavior = d3zoom
        .zoom<SVGSVGElement, unknown>()
        .filter(function(e) {
            if (e.path) {
                return !e.path.some(object => object.tagName === "foreignObject");
            } else {
                return !computePath(e).some(object => object.tagName === "foreignObject");
            }
        })
        .extent([
            [0, 0],
            [viewSize.x, viewSize.y],
        ] as [d3point, d3point])
        .scaleExtent([0.1, 5])
        .on("zoom", e => svgGroup.attr("transform", e.transform));
    baseSvg.call(zoomBehavior);

    function collapseDefault(r) {
        treeDescription.visitTreeNodes(
            r,
            n => {
                if (!n.data._children) {
                    return;
                }
                const allChildren = treeDescription.allChildren(n);
                if (!allChildren) {
                    return;
                }
                n._children = [];
                n.children = [];
                allChildren.forEach(c => {
                    if (n.data.children.indexOf(c.data) !== -1) {
                        n.children.push(c);
                    }
                    if (n.data._children.indexOf(c.data) !== -1) {
                        n._children.push(c);
                    }
                });
                if (!n.children.length) {
                    n.children = null;
                }
                if (!n._children.length) {
                    n._children = null;
                }
            },
            treeDescription.allChildren,
        );

        function initializeCollapsedByDefault(d) {
            d.data.collapsedByDefault = true;
            for (const child of treeDescription.allChildren(d)) {
                initializeCollapsedByDefault(child);
            }
        }
        function assignCollapsedByDefault(d) {
            d.data.collapsedByDefault = false;
            if (d.children != null) {
                for (const child of d.children) {
                    assignCollapsedByDefault(child);
                }
            }
        }
        initializeCollapsedByDefault(r);
        assignCollapsedByDefault(r);
    }

    // Return true if node is collapsed
    function collapsed(d) {
        if (d.children && d._children) {
            // Nodes will have fewer children than _children if collapsed by streamline
            if (d.children.length < d._children.length) {
                return true;
            }
            return false;
        }
        if (d._children) {
            return true;
        }
        return false;
    }

    // Toggle children function, streamlined nodes are partially collapsed
    function toggleChildren(d) {
        const children = d.children ? d.children : null;
        const _children = d._children ? d._children : null;
        d._children = children;
        d.children = _children;
    }
    function toggleNode(d) {
        if (d.data.nodeToggled === undefined) {
            d.data.nodeToggled = true;
        } else {
            d.data.nodeToggled = !d.data.nodeToggled;
        }
    }

    // Dash tween to make the highlighted edges animate from start node to end node
    const tweenDash = function() {
        const l = this.getTotalLength();
        return d3interpolate.interpolateString("0," + l, l + "," + l);
    };

    // Curve crosslink path appropriate for source and target node directionality
    const diagonalCrosslink = (d: xyLink) => {
        const crosslinkSpacing = {direction: 11.2 * 2, offset: 11.2 * 2};
        let points: xyPos[] = [];
        points.push({x: d.source.x, y: d.source.y});
        points.push({x: d.source.x - crosslinkSpacing.offset, y: d.source.y + crosslinkSpacing.direction});
        points.push({x: d.target.x + crosslinkSpacing.offset, y: d.target.y - crosslinkSpacing.direction});
        points.push({x: d.target.x, y: d.target.y});
        points = points.map(d => ({x: ooo.x(d, viewSize), y: ooo.y(d, viewSize)}));
        let path = `M${points[0].x},${points[0].y}`;
        let i: number;
        for (i = 1; i < points.length - 2; i++) {
            const xc = (points[i].x + points[i + 1].x) / 2;
            const yc = (points[i].y + points[i + 1].y) / 2;
            path += `Q${points[i].x},${points[i].y} ${xc},${yc}`;
        }
        path += `Q${points[i].x},${points[i].y} ${points[i + 1].x},${points[i + 1].y}`;
        return path;
    };

    const selectCrosslink = (d: d3hierarchy.HierarchyPointNode<unknown>) => {
        return svgGroup
            .selectAll<SVGPathElement, d3hierarchy.HierarchyPointLink<TreeNode>>("path.qg-crosslink-highlighted")
            .filter(dd => d === dd.source || d === dd.target);
    };

    // Transition used to highlight edges on mouseover
    const edgeTransitionIn = (_e: unknown, d: d3hierarchy.HierarchyPointNode<unknown>) => {
        selectCrosslink(d)
            .transition()
            .duration(DEBUG ? duration : 0)
            .attr("opacity", 1)
            .attrTween("stroke-dasharray", tweenDash);
    };

    // Transition to unhighlight edges on mouseout
    const edgeTransitionOut = (_e: unknown, d: d3hierarchy.HierarchyPointNode<unknown>) => {
        selectCrosslink(d)
            .transition()
            .duration(DEBUG ? duration : 0)
            .attr("opacity", 0);
    };

    //
    // Update graph at the given source location, which may be the root or a subtree
    //
    function update(source: TreeNode) {
        // Compute the new tree layout.
        const layout = treelayout(root);
        const nodes = layout.descendants().reverse();
        const links = layout.links();
        const prevSourcePos = assertNotNull(prevPos.get(source));
        const newSourcePos = assertNotNull(nodes.find(e => e.data == source));

        // Update the nodes…
        const node = svgGroup
            .selectAll<SVGGElement, d3hierarchy.HierarchyNode<TreeNode>>("g.qg-node")
            .data(nodes, d => assertNotNull(nodeIds.get(d.data)));

        // Enter any new nodes at the parent's previous position.
        const nodeEnter = node
            .enter()
            .append("g")
            .attr("class", d => "qg-node " + (d.data.nodeClass ?? ""))
            .attr("transform", `translate(${ooo.x(prevSourcePos, viewSize)},${ooo.y(prevSourcePos, viewSize)})`)
            .on("click", (e, d) => {
                // Toggle node/children/subtree on (alt/shift) click
                if (ALT_CLICK_TOGGLE_NODE) {
                    if (e.altKey) {
                        if (e.shiftKey) {
                            toggleNodeSubtree(d);
                        } else {
                            toggleNode(d);
                        }
                    } else {
                        if (e.shiftKey) {
                            toggleChildrenSubtree(d);
                        } else {
                            toggleChildren(d);
                        }
                    }
                } else {
                    if (e.altKey) {
                        if (e.shiftKey) {
                            toggleChildrenSubtree(d);
                        } else {
                            toggleChildren(d);
                        }
                    } else {
                        if (e.shiftKey) {
                            toggleNodeSubtree(d);
                        } else {
                            toggleNode(d);
                        }
                    }
                }
                update(d.data);
            });

        nodeEnter.append("use").attr("xlink:href", d => "#" + (d.data.symbol ?? "default-symbol"));
        nodeEnter
            .append("rect")
            .attr("x", d => ooo.rectoffsetx(d, maxLabelLength))
            .attr("y", d => ooo.rectoffsety(d, maxLabelLength))
            .attr("width", (maxLabelLength - 2) * 6)
            .attr("rx", maxLabelLength / 2.5)
            .attr("ry", maxLabelLength / 2.5)
            .attr("height", "13")
            .style("fill", d => {
                return d.data.rectFill ?? "hsl(104, 100%, 100%)";
            })
            .style("fill-opacity", 0);
        nodeEnter
            .append("text")
            .attr(ooo.textdimension, d => ooo.textdimensionoffset(d, maxLabelLength))
            .attr("dy", ".35em")
            .attr("text-anchor", d => ooo.textanchor(d))
            .text(d => abbreviateName(d.data.name ?? ""))
            .style("fill-opacity", 0);

        // Insert hidden foreign object before rect to hold node properties upon expansion
        nodeEnter
            .insert("foreignObject", "rect")
            .attr("class", "foreign-object")
            .attr("x", d => ooo.foreignoffsetx(d, maxLabelLength))
            .attr("y", d => ooo.rectoffsety(d, maxLabelLength) + ooo.nudgeoffsety)
            .attr("width", FOREIGN_OBJECT_SIZE)
            .attr("height", FOREIGN_OBJECT_SIZE)
            .html(d => {
                let text = "<br />";
                if (DEBUG) {
                    text += buildPropertyList(getDebugProperties(d), "qg-prop-name2");
                }
                if (d.data.properties !== undefined) {
                    text += buildPropertyList(d.data.properties, "qg-prop-name");
                }
                return text;
            })
            .style("visibility", "hidden")
            .style("opacity", 0);

        const nodeUpdate = node.merge(nodeEnter);
        const nodeTransition = nodeUpdate.transition().duration(duration);

        // Update the rect and text position to reflect whether node has children or not.
        nodeUpdate
            .select("rect")
            .attr("x", d => ooo.rectoffsetx(d, maxLabelLength))
            .attr("y", d => ooo.rectoffsety(d, maxLabelLength));
        nodeUpdate
            .select("text")
            .attr(ooo.textdimension, d => ooo.textdimensionoffset(d, maxLabelLength))
            .attr("text-anchor", d => ooo.textanchor(d));

        // Update foreign object position
        nodeUpdate
            .select("foreignObject")
            .attr("x", d => ooo.foreignoffsetx(d, maxLabelLength))
            .attr("y", d => ooo.rectoffsety(d, maxLabelLength) + ooo.nudgeoffsety);

        // Change the symbol style class depending on whether it has children and is collapsed
        nodeUpdate.select("use").attr("class", d => (collapsed(d) ? "qg-collapsed" : "qg-expanded"));

        // Add tooltips and crosslinks
        nodeUpdate
            .filter(d => d.data.properties?.size != 0 || getTooltipProperties(d.data).size != 0)
            .call(tip) // invoke tooltip
            .select("use")
            .on("mouseover.tooltip", tip.show)
            .on("mouseout.tooltip", tip.hide)
            .on("mouseover.crosslinks", edgeTransitionIn)
            .on("mouseout.crosslinks", edgeTransitionOut);
        nodeUpdate
            .filter(d => d.data.properties?.size != 0 || getTooltipProperties(d.data).size != 0)
            .select("text")
            .on("mouseover.crosslinks", edgeTransitionIn)
            .on("mouseout.crosslinks", edgeTransitionOut);

        // Transition nodes to their new position.
        nodeTransition.attr("transform", d => `translate(${ooo.x(d, viewSize)},${ooo.y(d, viewSize)})`);

        // Fade the rect in
        nodeTransition.select("rect").style("fill-opacity", function(d) {
            return d.data.rectFillOpacity ?? 0.0;
        });

        // Fade the text in
        nodeTransition.select("text").style("fill-opacity", 1);

        // Fade the visible/hidden foreign object in/out
        nodeTransition
            .select("foreignObject")
            .filter(d => foreignObjectToggled(d))
            .style("visibility", "visible")
            .style("opacity", 1);
        // Delay visibility hidden until opacity duration completes
        nodeUpdate
            .transition()
            .duration(0)
            .delay(duration)
            .select("foreignObject")
            .filter(d => !foreignObjectToggled(d))
            .style("visibility", "hidden");
        nodeTransition
            .select("foreignObject")
            .filter(d => !foreignObjectToggled(d))
            .style("opacity", 0);

        // Transition exiting nodes to the parent's new position.
        const nodeExit = node
            .exit()
            .transition()
            .duration(duration)
            .attr("transform", `translate(${ooo.x(newSourcePos, viewSize)},${ooo.y(newSourcePos, viewSize)})`)
            .remove();
        nodeExit.select("circle").attr("r", 0);
        nodeExit.select("rect").style("fill-opacity", 0);
        nodeExit.select("text").style("fill-opacity", 0);
        nodeExit.select("foreignObject").style("opacity", 0);

        // Update the links…
        const link = svgGroup
            .selectAll<SVGPathElement, d3hierarchy.HierarchyPointLink<TreeNode>>("path.qg-link")
            .data(links, d => assertNotNull(nodeIds.get(d.target.data)));

        // Enter any new links at the parent's previous position.
        const linkEnter = link
            .enter()
            .insert("path", "g")
            .attr("class", d => "qg-link " + (d.target.data.edgeClass ?? ""))
            .attr("d", _d => diagonal({source: prevSourcePos, target: prevSourcePos}));

        // Transition links to their new position.
        link.merge(linkEnter)
            .transition()
            .duration(duration)
            .attr("d", diagonal);

        // Transition exiting nodes to the parent's new position.
        link.exit()
            .transition()
            .duration(duration)
            .attr("d", _d => diagonal({source: newSourcePos, target: newSourcePos}))
            .remove();

        // Select the link labels
        const linksWithLabels = links.filter(d => d.target.data.edgeLabel?.length);
        const linkLabel = svgGroup
            .selectAll<SVGTextElement, d3hierarchy.HierarchyPointLink<treeDescription.TreeNode>>("text.qg-link-label")
            .data(linksWithLabels, d => assertNotNull(nodeIds.get(d.target.data)));

        // Enter new link labels before node containers
        const linkLabelEnter = linkLabel
            .enter()
            .insert("text", "g")
            .attr("class", d => "qg-link-label " + (d.target.data.edgeLabelClass ?? ""))
            .attr("text-anchor", "middle")
            .text(d => d.target.data.edgeLabel ?? "")
            .attr("x", ooo.x(prevSourcePos, viewSize))
            .attr("y", ooo.y(prevSourcePos, viewSize))
            .style("fill-opacity", 0);

        const linkLabelUpdate = linkLabel.merge(linkLabelEnter);
        const linkLabelTransition = linkLabelUpdate.transition().duration(duration);

        // Update position for existing & new labels
        linkLabelTransition
            .style("fill-opacity", 1)
            .attr("x", d => labelOrientation.toggledx(d))
            .attr("y", d => labelOrientation.toggledy(d));

        // Remove labels
        linkLabel
            .exit()
            .transition()
            .duration(duration)
            .attr("x", ooo.x(newSourcePos, viewSize))
            .attr("y", ooo.y(newSourcePos, viewSize))
            .style("fill-opacity", 0)
            .remove();

        // Update crosslinks
        const visibleCrosslinks = crosslinks.filter(d => {
            return nodes.indexOf(d.source) !== -1 && nodes.indexOf(d.target) !== -1;
        });

        // Helper function to update crosslink paths
        const updateCrosslinkPaths = (cssClass: string, opacity: number) => {
            const crossLink = svgGroup
                .selectAll<SVGPathElement, d3hierarchy.HierarchyNode<TreeNode>>("path." + cssClass)
                .data(visibleCrosslinks, d => nodeIds.get(d.source) + ":" + nodeIds.get(d.target));

            const crossLinkEnter = crossLink
                .enter()
                .insert("path", "g")
                .attr("class", cssClass)
                .attr("opacity", opacity)
                .attr("d", _d => diagonalCrosslink({source: prevSourcePos, target: prevSourcePos}));
            crossLink
                .merge(crossLinkEnter)
                .transition("crossLinkTransition") // separate transition avoids untimely update
                .duration(duration)
                .attr("d", d => diagonalCrosslink({source: d.source, target: d.target}));
            crossLink
                .exit()
                .transition("crossLinkTransition") // separate transition avoids untimely update
                .duration(duration)
                .attr("d", _d => diagonalCrosslink({source: newSourcePos, target: newSourcePos}))
                .remove();
        };

        updateCrosslinkPaths("qg-crosslink", 1 /* opacity */);
        updateCrosslinkPaths("qg-crosslink-highlighted", 0 /* opacity */);

        // Stash the old positions for transition.
        nodes.forEach(d => {
            prevPos.set(d.data, {x: d.x, y: d.y});
        });
    }

    // Layout the tree initially and center on the root node.
    prevPos.set(root.data, {x: 0, y: 0});
    collapseDefault(root);
    update(root.data);

    // Place root node into quandrant appropriate to orientation
    function orientRoot() {
        const scale = d3zoom.zoomTransform(baseSvgElem).k;
        const x = ooo.rootx(viewSize, scale, maxLabelLength);
        const y = ooo.rooty(viewSize, scale, maxLabelLength);
        zoomBehavior.translateTo(baseSvg, x, y);
    }

    // Scale the graph so that it can fit nicely on the screen
    function fitGraphScale() {
        // Get the bounding box of the main SVG element, we are interested in the width and height
        const bounds = baseSvgElem.getBBox();
        // Get the size of the container of the main SVG element
        const parent = assertNotNull(baseSvgElem.parentElement);
        const fullWidth = parent.clientWidth;
        const fullHeight = parent.clientHeight;
        // Let's find the scale factor
        // Thinking of only the X dimension, we need to make the width match the fullWidth, Equation:
        //   width * xfactor = fullWidth
        // Solving for `xfactor` we have: xfactor = fullWidth/width
        const xfactor: number = fullWidth / bounds.width;
        // Similarly, we would find out that: yfactor = fullHeight/height;
        const yfactor: number = fullHeight / bounds.height;
        // Most likely, the X and Y factor are different. We use the minimum of them to avoid cropping
        let scaleFactor: number = Math.min(xfactor, yfactor);
        // Add some padding so that the graph is not touching the edges
        const paddingPercent = 0.9;
        scaleFactor = scaleFactor * paddingPercent;
        zoomBehavior.scaleBy(baseSvg, scaleFactor);
    }

    // Center the graph (without scaling)
    function centerGraph() {
        // Find the Bounding box center, then translate to it
        // In other words, put the bbox center in the center of the screen
        const bbox = (svgGroup.node() as SVGGElement).getBBox();
        const cx = bbox.x + bbox.width / 2;
        const cy = bbox.y + bbox.height / 2;
        zoomBehavior.translateTo(baseSvg, cx, cy);
    }

    // Scale for readability by a fixed amount due to problematic .getBBox() above
    zoomBehavior.scaleBy(baseSvg, 1.5);

    orientRoot();

    // Add help card
    const helpCard = d3selection
        .select(target)
        .append("div")
        .attr("class", "qg-help-card");
    // Add help properties
    const helpProps = new Map();
    helpProps.set("(alt+)click", "toggle " + (ALT_CLICK_TOGGLE_NODE ? "(node)children" : "(children)node"));
    helpProps.set("(alt+)shift+click", "toggle subtree");
    helpProps.set("(alt+)space", "toggle tree");
    const helpText = buildPropertyList(helpProps, "qg-prop-name-help");
    helpCard
        .append("div")
        .classed("qg-tree-label", true)
        .html(helpText);

    const infoCard = d3selection
        .select(target)
        .append("div")
        .attr("class", "qg-info-card");
    // Add metrics card
    let treeText = "";
    if (treeData.properties) {
        treeText += buildPropertyList(treeData.properties);
    }

    if (DEBUG) {
        const debugProps = new Map();
        debugProps.set("nodes", totalNodes.toString());
        if (crosslinks !== undefined && crosslinks.length) {
            debugProps.set("crosslinks", crosslinks.length.toString());
        }
        treeText += buildPropertyList(debugProps);
    }
    infoCard
        .append("div")
        .classed("qg-tree-label", true)
        .html(treeText);

    // Add toolbar
    const toolbar = infoCard.append("div").classed("qg-toolbar", true);
    function addToolbarButton(id: string, description: string, action: () => void) {
        toolbar
            .append("div")
            .classed("qg-toolbar-button", true)
            .on("click", action).html(`<span class="qg-toolbar-icon">
    <svg viewbox='-8 -8 16 16' width='20px' height='20px'>
      <use href='#${id}-symbol' class="qg-collapsed" />
    </svg>
  </span>
  <span class="qg-toolbar-tooltip">${description}</span>`);
    }
    // Zoom toolbar buttons
    const zoomFactor = 1.4;
    addToolbarButton("zoom-in", "Zoom In", () => {
        zoomBehavior.scaleBy(baseSvg.transition().duration(200), zoomFactor);
    });
    addToolbarButton("zoom-out", "Zoom Out", () => {
        zoomBehavior.scaleBy(baseSvg.transition().duration(200), 1.0 / zoomFactor);
    });

    // Rotate toolbar buttons
    function getNewOrientation(orientation: GraphOrientation, shift: number): GraphOrientation {
        // Gets a new orientation from a given one. 1 unit = 90 degrees
        // Positive number: clockwise rotation
        // Negative number: counter-clockwise rotation
        const orientationList: GraphOrientation[] = ["top-to-bottom", "left-to-right", "bottom-to-top", "right-to-left"];
        const index: number = orientationList.indexOf(orientation);
        let newIndex: number = (index + shift) % 4;
        newIndex = newIndex < 0 ? newIndex + 4 : newIndex;
        return orientationList[newIndex];
    }
    function clearQueryGraph() {
        // Removes the QueryGraph elements. This function is useful if we want to call `drawQueryTree` again
        // Clear the main tree
        d3selection.select(".qg-overlay").remove();
        d3selection.select(".qg-info-card").remove();
        d3selection.select(".qg-help-card").remove();
        // Clear the tooltip element (which is not under the main tree DOM)
        d3selection.select(".qg-tooltip").remove();
    }
    addToolbarButton("rotate-left", "Rotate 90° Left", () => {
        clearQueryGraph();
        treeData.graphOrientation = getNewOrientation(graphOrientation, 1);
        drawQueryTree(target, treeData);
    });
    addToolbarButton("rotate-right", "Rotate 90° Right", () => {
        clearQueryGraph();
        treeData.graphOrientation = getNewOrientation(graphOrientation, -1);
        drawQueryTree(target, treeData);
    });

    // Recenter toolbar button
    addToolbarButton("recenter", "Center root", () => {
        orientRoot();
    });
    // Fit to screen toolbar button
    addToolbarButton("fit-screen", "Fit to screen", () => {
        fitGraphScale();
        centerGraph();
    });

    function toggleNodeSubtree(d) {
        if (!d.data.collapsedByDefault) {
            toggleNode(d);
        }
        for (const child of treeDescription.allChildren(d)) {
            toggleNodeSubtree(child);
        }
    }
    function toggleChildrenSubtree(d) {
        if (!d.data.collapsedByDefault) {
            toggleChildren(d);
        }
        for (const child of treeDescription.allChildren(d)) {
            toggleChildrenSubtree(child);
        }
    }

    function toggleNodeTree() {
        svgGroup.selectAll<SVGGElement, d3hierarchy.HierarchyNode<TreeNode>>("g.qg-node").each(d => {
            if (!d.data.collapsedByDefault) {
                toggleNode(d);
            }
        });
        // Redraw rather than update to workaround issue with node expansion after graph rotation
        clearQueryGraph();
        drawQueryTree(target, treeData);
    }
    function toggleChildrenTree() {
        svgGroup.selectAll<SVGGElement, d3hierarchy.HierarchyNode<TreeNode>>("g.qg-node").each(d => {
            if (!d.data.collapsedByDefault) {
                toggleChildren(d);
            }
        });
        // TODO: Can't redraw here as in toggleNodeTree because children are re-collapsed during redraw
        // TODO: Therefore this function is ineffective after graph rotation or toggleNodeTree
        update(root.data);
        orientRoot();
    }

    function resize(newWidth?: number, newHeight?: number) {
        viewSize.x = newWidth ?? target.clientWidth;
        viewSize.y = newHeight ?? target.clientHeight;
        // Adjust the view box
        baseSvg.attr("viewBox", `0 0 ${viewSize.x} ${viewSize.y}`);
        // Adjust the height (necessary in Internet Explorer)
        baseSvg.attr("height", viewSize.y);
    }

    return {
        toggleTree: ALT_CLICK_TOGGLE_NODE ? toggleChildrenTree : toggleNodeTree,
        toggleAltTree: ALT_CLICK_TOGGLE_NODE ? toggleNodeTree : toggleChildrenTree,
        resize: resize,
        orientRoot: orientRoot,
    };
}
