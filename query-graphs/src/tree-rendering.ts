// Import local modules
import * as treeDescription from "./tree-description";

// Third-party dependencies
import * as d3selection from "d3-selection";
import * as d3hierarchy from "d3-hierarchy";
import * as d3shape from "d3-shape";
import * as d3zoom from "d3-zoom";
import * as d3interpolate from "d3-interpolate";
import d3tip from "d3-tip";
import {TreeDescription, Crosslink} from "./tree-description";

const MAX_DISPLAY_LENGTH = 15;

//
// Create the symbols
//
function defineSymbols(baseSvg, ooo) {
    baseSvg.append("svg:defs");
    const defs = baseSvg.select("defs");
    // Build the arrow
    defs.append("svg:marker")
        .attr("id", "arrow")
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 18)
        .attr("refY", 0)
        .attr("markerWidth", 5)
        .attr("markerHeight", 5)
        .attr("orient", ooo.arrowRotation)
        .append("svg:path")
        .attr("d", "M0,-5L10,0L0,5");

    // Build the default symbol. Use this symbol if there is not a better fit
    defs.append("circle")
        .attr("id", "default-symbol")
        .attr("class", "qg-node-circle")
        .attr("r", 5);

    // Build the run query symbol
    const runQueryGroup = defs.append("g").attr("id", "run-query-symbol");
    runQueryGroup
        .append("circle")
        .attr("class", "qg-node-circle")
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

    // Build the temp table symbol, very similar to the regular table symbol
    const tempTableGroup = defs.append("g").attr("id", "temp-table-symbol");
    tempTableGroup
        .append("rect")
        .attr("class", "qg-table-background")
        .attr("x", tableStartLeft)
        .attr("width", tableWidth)
        .attr("y", tableStartTop)
        .attr("height", tableHeight);
    tempTableGroup
        .append("rect")
        .attr("class", "qg-table-header")
        .attr("x", tableStartLeft)
        .attr("width", tableWidth)
        .attr("y", tableStartTop)
        .attr("height", tableRowHeight);
    tempTableGroup
        .append("text")
        .attr("class", "qg-table-text")
        .attr("y", tableRowHeight + 0.8 /* stroke-width */ / 2)
        .text("tmp");
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
        return descendants.find(function(h) {
            return h.data === d;
        });
    }
    const linked: any[] = [];
    crosslinks.forEach(function(l) {
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

    // Call visit function to establish maxLabelLength
    let totalNodes = 0;
    let maxLabelLength = 0;
    treeDescription.visitTreeNodes(
        treeData.root,
        function(d) {
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
    let svgGroup = null as any;
    let nextId = 0;
    const duration = 750;

    // Size of the diagram
    let viewerWidth = target.clientWidth;
    let viewerHeight = target.clientHeight;

    // Crosslink spacing to preserve source and target directionality
    const crosslinkRawSpacing = {direction: 11.2 * 2, offset: 11.2 * 2};

    // Orientation mapping
    const orientations = {
        "top-to-bottom": {
            link: d3shape.linkVertical,
            x: function(d) {
                return d.x;
            },
            y: function(d) {
                return d.y;
            },
            textdimension: function() {
                return "y";
            },
            textdimensionoffset: function(d) {
                return d.children || d._children ? -13 : 13;
            },
            textanchor: function(d) {
                return d.children || d._children ? "middle" : "middle";
            },
            nodesize: function() {
                return [maxLabelLength * 6, (maxLabelLength * 6) / 2];
            },
            nodesep: function(a, b) {
                return a.parent === b.parent ? 1 : 1;
            },
            rootx: function(_scale) {
                return root.x0;
            },
            rooty: function(scale) {
                return root.y0 + (viewerHeight / 2 - 100) / scale;
            },
            sourcecrosslink: function(d) {
                return {
                    x: d.source.x - crosslinkRawSpacing.offset,
                    y: d.source.y + crosslinkRawSpacing.direction,
                };
            },
            targetcrosslink: function(d) {
                return {
                    x: d.target.x + crosslinkRawSpacing.offset,
                    y: d.target.y - crosslinkRawSpacing.direction,
                };
            },
            arrowRotation: "270deg",
        },
        "right-to-left": {
            link: d3shape.linkHorizontal,
            x: function(d) {
                return viewerWidth - d.y;
            },
            y: function(d) {
                return d.x;
            },
            textdimension: function() {
                return "x";
            },
            textdimensionoffset: function(d) {
                return d.children || d._children ? 10 : -10;
            },
            textanchor: function(d) {
                return d.children || d._children ? "start" : "end";
            },
            nodesize: function() {
                return [11.2 /* table node diameter */ + 2, maxLabelLength * 6 + 10 /* textdimensionoffset */];
            },
            nodesep: function(a, b) {
                return a.parent === b.parent ? 1 : 1.5;
            },
            rootx: function(scale) {
                return root.x0 - (viewerWidth / 2 - maxLabelLength * 6) / scale;
            },
            rooty: function(_scale) {
                return root.y0;
            },
            sourcecrosslink: function(d) {
                return {
                    x: d.source.x - crosslinkRawSpacing.direction,
                    y: d.source.y - crosslinkRawSpacing.offset,
                };
            },
            targetcrosslink: function(d) {
                return {
                    x: d.target.x + crosslinkRawSpacing.direction,
                    y: d.target.y + crosslinkRawSpacing.offset,
                };
            },
            arrowRotation: "0deg",
        },
        "bottom-to-top": {
            link: d3shape.linkVertical,
            x: function(d) {
                return d.x;
            },
            y: function(d) {
                return viewerHeight - d.y;
            },
            textdimension: function() {
                return "y";
            },
            textdimensionoffset: function(d) {
                return d.children || d._children ? 13 : -13;
            },
            textanchor: function(d) {
                return d.children || d._children ? "middle" : "middle";
            },
            nodesize: function() {
                return [maxLabelLength * 6, (maxLabelLength * 6) / 2];
            },
            nodesep: function(a, b) {
                return a.parent === b.parent ? 1 : 1;
            },
            rootx: function(_scale) {
                return root.x0;
            },
            rooty: function(scale) {
                return root.y0 - (viewerHeight / 2 - 50) / scale;
            },
            sourcecrosslink: function(d) {
                return {
                    x: d.source.x - crosslinkRawSpacing.offset,
                    y: d.source.y - crosslinkRawSpacing.direction,
                };
            },
            targetcrosslink: function(d) {
                return {
                    x: d.target.x + crosslinkRawSpacing.offset,
                    y: d.target.y + crosslinkRawSpacing.direction,
                };
            },
            arrowRotation: "90deg",
        },
        "left-to-right": {
            link: d3shape.linkHorizontal,
            x: function(d) {
                return d.y;
            },
            y: function(d) {
                return d.x;
            },
            textdimension: function() {
                return "x";
            },
            textdimensionoffset: function(d) {
                return d.children || d._children ? -10 : 10;
            },
            textanchor: function(d) {
                return d.children || d._children ? "end" : "start";
            },
            nodesize: function() {
                return [11.2 /* table node diameter */ + 2, maxLabelLength * 6 + 10 /* textdimensionoffset */];
            },
            nodesep: function(a, b) {
                return a.parent === b.parent ? 1 : 2;
            },
            rootx: function(scale) {
                return root.y0 + (viewerWidth / 2 - maxLabelLength * 6) / scale;
            },
            rooty: function(_scale) {
                return root.y0;
            },
            sourcecrosslink: function(d) {
                return {
                    x: d.source.x + crosslinkRawSpacing.direction,
                    y: d.source.y - crosslinkRawSpacing.offset,
                };
            },
            targetcrosslink: function(d) {
                return {
                    x: d.target.x - crosslinkRawSpacing.direction,
                    y: d.target.y + crosslinkRawSpacing.offset,
                };
            },
            arrowRotation: "180deg",
        },
    };

    const ooo = orientations[graphOrientation];

    const treelayout = d3hierarchy
        .tree()
        .nodeSize(ooo.nodesize())
        .separation(ooo.nodesep);

    // Define a d3 diagonal projection for use by the node paths later on.
    const diagonal = ooo
        .link()
        .x(function(d) {
            return ooo.x(d);
        })
        .y(function(d) {
            return ooo.y(d);
        });
    const diagonalRaw = ooo
        .link()
        .x(function(d) {
            return d.x;
        })
        .y(function(d) {
            return d.y;
        });

    // Build a HTML list of properties to be displayed in a tooltip
    function buildPropertyList(properties, cssClass = "qg-prop-name") {
        let html = "";
        Object.getOwnPropertyNames(properties).forEach(function(key) {
            html += "<span class='" + cssClass + "'>" + escapeHtml(key) + ": </span>";
            html += "<span style='prop-value'>" + escapeHtml(properties[key]) + "</span><br />";
        });
        return html;
    }

    // Helper function to retrieve all properties of the node object which should be rendered in the tooltip
    const debugTooltipKeys = ["height", "depth", "id", "x", "x0", "y", "y0"];
    function getDebugProperties(d) {
        const props = {};
        debugTooltipKeys.forEach(function(key) {
            if (d[key]) {
                // only show non-empty data
                props[key] = d[key];
            }
        });
        return props;
    }
    const alwaysSuppressedKeys = [
        "_children",
        "children",
        "name",
        "properties",
        "parent",
        "properties",
        "symbol",
        "nodeClass",
        "edgeClass",
        "edgeLabel",
    ];
    function getDirectProperties(d) {
        const props = {};
        Object.getOwnPropertyNames(d).forEach(function(key) {
            if (alwaysSuppressedKeys.indexOf(key) >= 0) {
                // suppress some of the d3 data
                return;
            } else if (d[key]) {
                // only show non-empty data
                props[key] = d[key];
            }
        });
        return props;
    }

    // Initialize tooltip
    const tip = d3tip()
        .attr("class", "qg-tooltip")
        .offset([-10, 0])
        .html(function(d) {
            const nameText = "<span style='text-decoration: underline'>" + escapeHtml(d.data.name) + "</span><br />";
            const debugPropsText = DEBUG ? buildPropertyList(getDebugProperties(d), "qg-prop-name2") : "";
            const directPropsText = buildPropertyList(getDirectProperties(d.data), "qg-prop-name2");
            const propertiesText = d.data.hasOwnProperty("properties") ? buildPropertyList(d.data.properties) : "";
            return nameText + debugPropsText + directPropsText + propertiesText;
        });

    // Define the zoom function for the zoomable tree
    function zoom() {
        svgGroup.attr("transform", d3selection.event.transform);
    }

    // Define the zoomBehavior which calls the zoom function on the "zoom" event constrained within the scaleExtents
    const zoomBehavior = d3zoom
        .zoom()
        .extent(function() {
            return [
                [0, 0],
                [viewerWidth, viewerHeight],
            ];
        })
        .scaleExtent([0.1, 5])
        .on("zoom", zoom);

    // Define the baseSvg, attaching a class for styling and the zoomBehavior
    const baseSvg = d3selection
        .select(target)
        .append("svg")
        .attr("viewBox", "0 0 " + viewerWidth + " " + viewerHeight)
        .attr("height", viewerHeight)
        .attr("class", "qg-overlay")
        .call(zoomBehavior);

    defineSymbols(baseSvg, ooo);

    function collapseDefault(r) {
        treeDescription.visitTreeNodes(
            r,
            function(n) {
                if (!n.data._children) {
                    return;
                }
                const allChildren = treeDescription.allChildren(n);
                if (!allChildren) {
                    return;
                }
                n._children = [];
                n.children = [];
                allChildren.forEach(function(c) {
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
        return d;
    }

    // Toggle children on click.
    function click(d) {
        d = toggleChildren(d);
        update(d);
    }

    // Dash tween to make the highlighted edges animate from start node to end node
    const tweenDash = function() {
        const l = this.getTotalLength();
        const i = d3interpolate.interpolateString("0," + l, l + "," + l);
        return function(t) {
            return i(t);
        };
    };

    // Curve crosslink path appropriate for source and target node directionality
    const diagonalRawCrosslink = function(d) {
        const points: any[] = [];
        points.push({x: d.source.x, y: d.source.y});
        points.push(ooo.sourcecrosslink(d));
        points.push(ooo.targetcrosslink(d));
        points.push({x: d.target.x, y: d.target.y});
        let path = "M" + points[0].x + "," + points[0].y;
        let i;
        for (i = 1; i < points.length - 2; i++) {
            const xc = (points[i].x + points[i + 1].x) / 2;
            const yc = (points[i].y + points[i + 1].y) / 2;
            path += "Q" + points[i].x + "," + points[i].y + " " + xc + "," + yc;
        }
        path += "Q" + points[i].x + "," + points[i].y + " " + points[i + 1].x + "," + points[i + 1].y;
        return path;
    };

    // Transition used to highlight edges on mouseover
    const edgeTransitionIn = function(path) {
        path.transition()
            .duration(DEBUG ? duration : 0)
            .attr("opacity", 1)
            .attrTween("stroke-dasharray", tweenDash)
            .attr("d", function(d) {
                return diagonalRawCrosslink({
                    source: {x: d.source.x0, y: d.source.y0},
                    target: {x: d.target.x0, y: d.target.y0},
                });
            });
    };

    // Transition to unhighlight edges on mouseout
    const edgeTransitionOut = function(path) {
        path.transition()
            .duration(DEBUG ? duration : 0)
            .attr("opacity", 0)
            .attr("d", function(d) {
                return diagonalRawCrosslink({
                    source: {x: d.source.x0, y: d.source.y0},
                    target: {x: d.target.x0, y: d.target.y0},
                });
            });
    };

    // Handler builder for crosslink highlighting
    const crosslinkHighlightHandler = function(transition) {
        return function(d) {
            const crosslinks = svgGroup.selectAll("path.qg-crosslink-highlighted");

            // Filter the edges to those connected to the current node
            crosslinks
                .filter(function(dd) {
                    return d === dd.source || d === dd.target;
                })
                .call(transition);
        };
    };

    //
    // Update graph at the given source location, which may be the root or a subtree
    //
    function update(source) {
        // Compute the new tree layout.
        const layout = treelayout(root);
        const nodes = layout.descendants().reverse();
        const links = layout.links();

        // Update the nodes…
        const node = svgGroup.selectAll("g.qg-node").data(nodes, function(d) {
            return d.id || (d.id = ++nextId);
        });

        // Enter any new nodes at the parent's previous position.
        const nodeEnter = node
            .enter()
            .append("g")
            .attr("class", function(d) {
                return d.data.hasOwnProperty("nodeClass") ? d.data.nodeClass + " qg-node" : "qg-node";
            })
            .attr("transform", function(_d) {
                return "translate(" + source.x0 + "," + source.y0 + ")";
            })
            .on("click", click);

        nodeEnter.append("use").attr("xlink:href", function(d) {
            if (d.data.symbol) {
                return "#" + d.data.symbol;
            }
            return "#default-symbol";
        });

        nodeEnter
            .append("text")
            .attr(ooo.textdimension(), function(d) {
                return ooo.textdimensionoffset(d);
            })
            .attr("dy", ".35em")
            .attr("text-anchor", function(d) {
                return ooo.textanchor(d);
            })
            .text(function(d) {
                return abbreviateName(d.data.name);
            })
            .style("fill-opacity", 0);

        const nodeUpdate = node.merge(nodeEnter);
        const nodeTransition = nodeUpdate.transition().duration(duration);

        // Update the text position to reflect whether node has children or not.
        nodeUpdate
            .select("text")
            .attr(ooo.textdimension(), function(d) {
                return ooo.textdimensionoffset(d);
            })
            .attr("text-anchor", function(d) {
                return ooo.textanchor(d);
            });

        // Change the symbol style class depending on whether it has children and is collapsed
        nodeUpdate.select("use").attr("class", function(d) {
            return collapsed(d) ? "qg-collapsed" : "qg-expanded";
        });

        // Add tooltips
        nodeUpdate
            .filter(function(d) {
                return (
                    Object.getOwnPropertyNames(getDirectProperties(d.data)).length || // eslint-disable-line indent
                    (d.data.hasOwnProperty("properties") && Object.getOwnPropertyNames(d.data.properties).length)
                );
            }) // eslint-disable-line indent
            .call(tip) // invoke tooltip
            .select("use")
            .on("mouseover.tooltip", tip.show)
            .on("mouseout.tooltip", tip.hide)
            .on("mouseover.crosslinks", crosslinkHighlightHandler(edgeTransitionIn))
            .on("mouseout.crosslinks", crosslinkHighlightHandler(edgeTransitionOut));

        // Transition nodes to their new position.
        nodeTransition.attr("transform", function(d) {
            return "translate(" + ooo.x(d) + "," + ooo.y(d) + ")";
        });

        // Fade the text in
        nodeTransition.select("text").style("fill-opacity", 1);

        // Transition exiting nodes to the parent's new position.
        const nodeExit = node
            .exit()
            .transition()
            .duration(duration)
            .attr("transform", function(_d) {
                return "translate(" + ooo.x(source) + "," + ooo.y(source) + ")";
            })
            .remove();

        nodeExit.select("circle").attr("r", 0);

        nodeExit.select("text").style("fill-opacity", 0);

        // Update the links…
        const link = svgGroup.selectAll("path.qg-link").data(links, function(d) {
            return d.target.id;
        });

        // Enter any new links at the parent's previous position.
        const linkEnter = link
            .enter()
            .insert("path", "g")
            .attr("class", function(d) {
                if (d.target.data.hasOwnProperty("edgeClass")) {
                    return "qg-link " + d.target.data.edgeClass;
                }
                return "qg-link";
            })
            .attr("d", function(_d) {
                const o = {
                    x: source.x0,
                    y: source.y0,
                };
                return diagonalRaw({
                    source: o,
                    target: o,
                });
            });

        // Transition links to their new position.
        link.merge(linkEnter)
            .transition()
            .duration(duration)
            .attr("d", diagonal);

        // Transition exiting nodes to the parent's new position.
        link.exit()
            .transition()
            .duration(duration)
            .attr("d", function(_d) {
                const o = {
                    x: source.x,
                    y: source.y,
                };
                return diagonal({
                    source: o,
                    target: o,
                });
            })
            .remove();

        // Stash the old positions for transition.
        nodes.forEach(function(d) {
            d.x0 = ooo.x(d);
            d.y0 = ooo.y(d);
        });

        // Select the link labels
        const linksWithLabels = links.filter(function(d) {
            return d.target.data.edgeLabel !== undefined && d.target.data.edgeLabel.length;
        });
        const linkLabel = svgGroup.selectAll("text.qg-link-label").data(linksWithLabels, function(d) {
            return d.target.id;
        });

        // Enter new link labels
        const linkLabelEnter = linkLabel
            .enter()
            .insert("text")
            .classed("qg-link-label", true)
            .attr("text-anchor", "middle")
            .text(function(d) {
                return d.target.data.edgeLabel;
            })
            .attr("x", source.x0)
            .attr("y", source.y0)
            .style("fill-opacity", 0);

        const linkLabelUpdate = linkLabel.merge(linkLabelEnter);
        const linkLabelTransition = linkLabelUpdate.transition().duration(duration);

        // Update position for existing & new labels
        linkLabelTransition
            .style("fill-opacity", 1)
            .attr("x", function(d) {
                return (d.source.x0 + d.target.x0) / 2;
            })
            .attr("y", function(d) {
                return (d.source.y0 + d.target.y0) / 2;
            });

        // Remove labels
        linkLabel
            .exit()
            .transition()
            .duration(duration)
            .attr("x", source.x0)
            .attr("y", source.y0)
            .style("fill-opacity", 0)
            .remove();

        // Update crosslinks
        const visibleCrosslinks = crosslinks.filter(function(d) {
            return nodes.indexOf(d.source) !== -1 && nodes.indexOf(d.target) !== -1;
        });

        // Helper function to update crosslink paths
        const updateCrosslinkPaths = function(cssClass, opacity) {
            const crossLink = svgGroup.selectAll("path." + cssClass).data(visibleCrosslinks);
            const crossLinkEnter = crossLink
                .enter()
                .insert("path", "g")
                .attr("class", cssClass)
                .attr("opacity", opacity)
                .attr("d", function(_d) {
                    const o = {
                        x: source.x0,
                        y: source.y0,
                    };
                    return diagonalRawCrosslink({
                        source: o,
                        target: o,
                    });
                });
            crossLink
                .merge(crossLinkEnter)
                .transition()
                .duration(duration)
                .attr("d", function(d) {
                    return diagonalRawCrosslink({
                        source: {x: d.source.x0, y: d.source.y0},
                        target: {x: d.target.x0, y: d.target.y0},
                    });
                });
            crossLink
                .exit()
                .transition()
                .duration(duration)
                .attr("d", function(_d) {
                    const o = {
                        x: source.x0,
                        y: source.y0,
                    };
                    return diagonalRawCrosslink({
                        source: o,
                        target: o,
                    });
                })
                .remove();
        };

        updateCrosslinkPaths("qg-crosslink", 1 /* opacity */);
        updateCrosslinkPaths("qg-crosslink-highlighted", 0 /* opacity */);
    }

    // Append a group which holds all nodes and which the zoom Listener can act upon.
    svgGroup = baseSvg.append("g");
    // Define the root
    const origin = {x: 0, y: 0};
    root.x0 = ooo.x(origin);
    root.y0 = ooo.y(origin);

    // Layout the tree initially and center on the root node.
    collapseDefault(root);
    update(root);

    // Place root node into quandrant appropriate to orientation
    function orientRoot() {
        const scale = d3zoom.zoomTransform(baseSvg.node()).k;
        const x = ooo.rootx(scale);
        const y = ooo.rooty(scale);
        zoomBehavior.translateTo(baseSvg, x, y);
    }

    // Scale for readability by a fixed amount due to problematic .getBBox() above
    zoomBehavior.scaleBy(baseSvg, 1.5);

    orientRoot();

    // Add metrics card
    let treeText = "";
    const properties = treeData.properties ?? {};
    treeText += buildPropertyList(properties);
    treeText += buildPropertyList({nodes: totalNodes});
    if (crosslinks !== undefined && crosslinks.length) {
        treeText += buildPropertyList({crosslinks: crosslinks.length});
    }
    d3selection
        .select(target)
        .append("div")
        .classed("qg-tree-label", true)
        .html(treeText);

    function expandOneLevel() {
        svgGroup.selectAll("g.qg-node").each(function(d) {
            if (collapsed(d)) {
                toggleChildren(d);
            }
        });
        update(root);
        orientRoot();
    }

    function resize(newWidth, newHeight) {
        viewerWidth = newWidth === undefined ? target.clientWidth : newWidth;
        viewerHeight = newHeight === undefined ? target.clientHeight : newHeight;
        // Adjust the view box
        baseSvg.attr("viewBox", "0 0 " + viewerWidth + " " + viewerHeight);
        // Adjust the height (necessary in Internet Explorer)
        baseSvg.attr("height", viewerHeight);
    }

    return {
        expandOneLevel: expandOneLevel,
        resize: resize,
        orientRoot: orientRoot,
    };
}
