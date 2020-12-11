// Import local modules
import * as treeDescription from "./tree-description";
import {TreeNode, TreeDescription, Crosslink, GraphOrientation} from "./tree-description";
import {assertNotNull, hasOwnProperty} from "./loader-utils";
import {defineSymbols} from "./symbols";

// Third-party dependencies
import * as d3selection from "d3-selection";
import * as d3hierarchy from "d3-hierarchy";
import * as d3shape from "d3-shape";
import * as d3zoom from "d3-zoom";
import * as d3interpolate from "d3-interpolate";
import d3tip from "d3-tip";

const MAX_DISPLAY_LENGTH = 15;

type d3point = [number, number];

interface xyPos {
    x: number;
    y: number;
}

interface xyLink {
    source: xyPos;
    target: xyPos;
}

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
function escapeHtml(unsafe) {
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Link cross-links against a d3 hierarchy
function linkCrossLinks(root, crosslinks: Crosslink[]) {
    const descendants = root.descendants();
    function map(d) {
        return descendants.find(h => h.data === d);
    }
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
    maxLabelLength = Math.min(maxLabelLength, MAX_DISPLAY_LENGTH);

    // Misc. variables
    const duration = 750;

    // Size of the diagram
    let viewerWidth = target.clientWidth;
    let viewerHeight = target.clientHeight;

    // Orientation mapping
    const orientations = {
        "top-to-bottom": {
            link: d3shape.linkVertical,
            x: d => d.x,
            y: d => d.y,
            textdimension: () => "y",
            textdimensionoffset: d => (d.children || d._children ? -13 : 13),
            textanchor: d => (d.children || d._children ? "middle" : "middle"),
            nodesize: () => [maxLabelLength * 6, (maxLabelLength * 6) / 2] as d3point,
            nodesep: (a, b) => (a.parent === b.parent ? 1 : 1),
            rootx: _scale => 0,
            rooty: scale => (viewerHeight / 2 - 100) / scale,
        },
        "right-to-left": {
            link: d3shape.linkHorizontal,
            x: d => viewerWidth - d.y,
            y: d => d.x,
            textdimension: () => "x",
            textdimensionoffset: d => (d.children || d._children ? 10 : -10),
            textanchor: d => (d.children || d._children ? "start" : "end"),
            nodesize: () => [11.2 /* table node diameter */ + 2, maxLabelLength * 6 + 10 /* textdimensionoffset */] as d3point,
            nodesep: (a, b) => (a.parent === b.parent ? 1 : 1.5),
            rootx: scale => viewerWidth - (viewerWidth / 2 - maxLabelLength * 6) / scale,
            rooty: _scale => 0,
        },
        "bottom-to-top": {
            link: d3shape.linkVertical,
            x: d => d.x,
            y: d => viewerHeight - d.y,
            textdimension: () => "y",
            textdimensionoffset: d => (d.children || d._children ? 13 : -13),
            textanchor: d => (d.children || d._children ? "middle" : "middle"),
            nodesize: () => [maxLabelLength * 6, (maxLabelLength * 6) / 2] as d3point,
            nodesep: (a, b) => (a.parent === b.parent ? 1 : 1),
            rootx: _scale => 0,
            rooty: scale => viewerHeight - (viewerHeight / 2 - 50) / scale,
        },
        "left-to-right": {
            link: d3shape.linkHorizontal,
            x: d => d.y,
            y: d => d.x,
            textdimension: () => "x",
            textdimensionoffset: d => (d.children || d._children ? -10 : 10),
            textanchor: d => (d.children || d._children ? "end" : "start"),
            nodesize: () => [11.2 /* table node diameter */ + 2, maxLabelLength * 6 + 10 /* textdimensionoffset */] as d3point,
            nodesep: (a, b) => (a.parent === b.parent ? 1 : 2),
            rootx: scale => (viewerWidth / 2 - maxLabelLength * 6) / scale,
            rooty: _scale => 0,
        },
    };

    const ooo = orientations[graphOrientation];

    const treelayout = d3hierarchy
        .tree<treeDescription.TreeNode>()
        .nodeSize(ooo.nodesize())
        .separation(ooo.nodesep);

    // Define a d3 diagonal projection for use by the node paths later on.
    const diagonal = ooo
        .link<xyLink, xyPos>()
        .x(d => ooo.x(d))
        .y(d => ooo.y(d));

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
    function getDebugProperties(d): Map<string, string> {
        const debugTooltipKeys = ["height", "depth", "id", "x", "y"];
        const props = new Map<string, string>();
        for (const key of debugTooltipKeys) {
            if (hasOwnProperty(d, key)) {
                // only show non-empty data
                props.set(key, d[key].toString());
            }
        }
        return props;
    }

    // Initialize tooltip
    const tip = d3tip()
        .attr("class", "qg-tooltip")
        .offset([-10, 0])
        .html((_e: unknown, d: d3hierarchy.HierarchyNode<TreeNode>) => {
            let text = "<span style='text-decoration: underline'>" + escapeHtml(d.data.name) + "</span><br />";
            if (DEBUG) {
                text += buildPropertyList(getDebugProperties(d), "qg-prop-name2");
            }
            text += buildPropertyList(getTooltipProperties(d.data), "qg-prop-name2");
            if (d.data.properties !== undefined) {
                text += buildPropertyList(d.data.properties);
            }
            return text;
        });

    // Define the baseSvg, attaching a class for styling and the zoomBehavior
    const baseSvg = d3selection
        .select(target)
        .append("svg")
        .attr("viewBox", `0 0 ${viewerWidth} ${viewerHeight}`)
        .attr("height", viewerHeight)
        .attr("class", "qg-overlay");
    const baseSvgElem = baseSvg.node() as SVGSVGElement;
    defineSymbols(baseSvgElem);

    // Append a group which holds all nodes and which the zoom Listener can act upon.
    const svgGroup = baseSvg.append("g");

    // Define the zoomBehavior which calls the zoom function on the "zoom" event constrained within the scaleExtents
    const zoomBehavior = d3zoom
        .zoom<SVGSVGElement, unknown>()
        .extent([
            [0, 0],
            [viewerWidth, viewerHeight],
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

    // Dash tween to make the highlighted edges animate from start node to end node
    const tweenDash = function() {
        const l = this.getTotalLength();
        const i = d3interpolate.interpolateString("0," + l, l + "," + l);
        return t => i(t);
    };

    // Curve crosslink path appropriate for source and target node directionality
    const diagonalCrosslink = (d: xyLink) => {
        const crosslinkSpacing = {direction: 11.2 * 2, offset: 11.2 * 2};
        let points: xyPos[] = [];
        points.push({x: d.source.x, y: d.source.y});
        points.push({x: d.source.x - crosslinkSpacing.offset, y: d.source.y + crosslinkSpacing.direction});
        points.push({x: d.target.x + crosslinkSpacing.offset, y: d.target.y - crosslinkSpacing.direction});
        points.push({x: d.target.x, y: d.target.y});
        points = points.map(d => ({x: ooo.x(d), y: ooo.y(d)}));
        let path = `M${points[0].x},${points[0].y}`;
        let i;
        for (i = 1; i < points.length - 2; i++) {
            const xc = (points[i].x + points[i + 1].x) / 2;
            const yc = (points[i].y + points[i + 1].y) / 2;
            path += `Q${points[i].x},${points[i].y} ${xc},${yc}`;
        }
        path += `Q${points[i].x},${points[i].y} ${points[i + 1].x},${points[i + 1].y}`;
        return path;
    };

    // Transition used to highlight edges on mouseover
    const edgeTransitionIn = path => {
        path.transition()
            .duration(DEBUG ? duration : 0)
            .attr("opacity", 1)
            .attrTween("stroke-dasharray", tweenDash);
    };

    // Transition to unhighlight edges on mouseout
    const edgeTransitionOut = path => {
        path.transition()
            .duration(DEBUG ? duration : 0)
            .attr("opacity", 0);
    };

    // Handler builder for crosslink highlighting
    const crosslinkHighlightHandler = transition => {
        return (_e, d) => {
            svgGroup
                .selectAll<SVGPathElement, d3hierarchy.HierarchyPointLink<TreeNode>>("path.qg-crosslink-highlighted")
                .filter(dd => d === dd.source || d === dd.target)
                .call(transition);
        };
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
            .attr("transform", `translate(${ooo.x(prevSourcePos)},${ooo.y(prevSourcePos)})`)
            .on("click", (_e, d) => {
                // Toggle children on click.
                toggleChildren(d);
                update(d.data);
            });

        nodeEnter.append("use").attr("xlink:href", d => "#" + (d.data.symbol ?? "default-symbol"));
        nodeEnter
            .append("text")
            .attr(ooo.textdimension(), d => ooo.textdimensionoffset(d))
            .attr("dy", ".35em")
            .attr("text-anchor", d => ooo.textanchor(d))
            .text(d => abbreviateName(d.data.name ?? ""))
            .style("fill-opacity", 0);

        const nodeUpdate = node.merge(nodeEnter);
        const nodeTransition = nodeUpdate.transition().duration(duration);

        // Update the text position to reflect whether node has children or not.
        nodeUpdate
            .select("text")
            .attr(ooo.textdimension(), d => ooo.textdimensionoffset(d))
            .attr("text-anchor", d => ooo.textanchor(d));

        // Change the symbol style class depending on whether it has children and is collapsed
        nodeUpdate.select("use").attr("class", d => (collapsed(d) ? "qg-collapsed" : "qg-expanded"));

        // Add tooltips
        nodeUpdate
            .filter(d => d.data.properties?.size != 0 || getTooltipProperties(d.data).size != 0)
            .call(tip) // invoke tooltip
            .select("use")
            .on("mouseover.tooltip", tip.show)
            .on("mouseout.tooltip", tip.hide)
            .on("mouseover.crosslinks", crosslinkHighlightHandler(edgeTransitionIn))
            .on("mouseout.crosslinks", crosslinkHighlightHandler(edgeTransitionOut));

        // Transition nodes to their new position.
        nodeTransition.attr("transform", d => `translate(${ooo.x(d)},${ooo.y(d)})`);

        // Fade the text in
        nodeTransition.select("text").style("fill-opacity", 1);

        // Transition exiting nodes to the parent's new position.
        const nodeExit = node
            .exit()
            .transition()
            .duration(duration)
            .attr("transform", `translate(${ooo.x(newSourcePos)},${ooo.y(newSourcePos)})`)
            .remove();

        nodeExit.select("circle").attr("r", 0);

        nodeExit.select("text").style("fill-opacity", 0);

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

        // Enter new link labels
        const linkLabelEnter = linkLabel
            .enter()
            .insert("text")
            .attr("class", d => "qg-link-label " + (d.target.data.edgeLabelClass ?? ""))
            .attr("text-anchor", "middle")
            .text(d => d.target.data.edgeLabel ?? "")
            .attr("x", ooo.x(prevSourcePos))
            .attr("y", ooo.y(prevSourcePos))
            .style("fill-opacity", 0);

        const linkLabelUpdate = linkLabel.merge(linkLabelEnter);
        const linkLabelTransition = linkLabelUpdate.transition().duration(duration);

        // Update position for existing & new labels
        linkLabelTransition
            .style("fill-opacity", 1)
            .attr("x", d => (ooo.x(d.source) + ooo.x(d.target)) / 2)
            .attr("y", d => (ooo.y(d.source) + ooo.y(d.target)) / 2);

        // Remove labels
        linkLabel
            .exit()
            .transition()
            .duration(duration)
            .attr("x", ooo.x(newSourcePos))
            .attr("y", ooo.y(newSourcePos))
            .style("fill-opacity", 0)
            .remove();

        // Update crosslinks
        const visibleCrosslinks = crosslinks.filter(d => {
            return nodes.indexOf(d.source) !== -1 && nodes.indexOf(d.target) !== -1;
        });

        // Helper function to update crosslink paths
        const updateCrosslinkPaths = (cssClass, opacity) => {
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
                .transition()
                .duration(duration)
                .attr("d", d => diagonalCrosslink({source: d.source, target: d.target}));
            crossLink
                .exit()
                .transition()
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
        const x = ooo.rootx(scale);
        const y = ooo.rooty(scale);
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
        target.innerHTML = "";
        // Clear the tooltip element (which is not under the main tree DOM)
        d3selection.select("#tooltip").remove();
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

    function expandOneLevel() {
        svgGroup.selectAll("g.qg-node").each(d => {
            if (collapsed(d)) {
                toggleChildren(d);
            }
        });
        update(root.data);
        orientRoot();
    }

    function resize(newWidth, newHeight) {
        viewerWidth = newWidth === undefined ? target.clientWidth : newWidth;
        viewerHeight = newHeight === undefined ? target.clientHeight : newHeight;
        // Adjust the view box
        baseSvg.attr("viewBox", `0 0 ${viewerWidth} ${viewerHeight}`);
        // Adjust the height (necessary in Internet Explorer)
        baseSvg.attr("height", viewerHeight);
    }

    return {
        expandOneLevel: expandOneLevel,
        resize: resize,
        orientRoot: orientRoot,
    };
}
