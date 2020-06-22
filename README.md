Query Graphs
============
[![Community Supported](https://img.shields.io/badge/Support%20Level-Community%20Supported-457387.svg)](https://www.tableau.com/support-levels-it-and-developer-tools)

Helping people see and understand queries.

![Query Visualization](https://tableau.github.io/query-graphs/media/sample_graph.png "Sample Graph")

Description
-----------

Query Graphs is an investigation into graph visualization for query processing, such as for logical queries and their physical
query evaluation plans.
Current visualizations are tailored for artifacts from Tableau's query ecosystem:
LogicalQuery XML, QueryFunction XML, and Hyper query-plan JSON.

You can view example query visualizations online:
* <https://tableau.github.io/query-graphs/query-graphs.html?file=favorites/tableau/joins.xml>,
* <https://tableau.github.io/query-graphs/query-graphs.html?file=favorites/tableau/query-function.xml&collapse=n>,
* <https://tableau.github.io/query-graphs/query-graphs.html?file=favorites/tableau/dint4.xml>,
* <https://tableau.github.io/query-graphs/query-graphs.html?file=favorites/hyper/query2.plan.json>,
* <https://tableau.github.io/query-graphs/webroot/query-graphs.html?file=favorites/hyper/steps2.plan.json&orientation=left-to-right>, or
* <https://tableau.github.io/query-graphs/query-graphs.html?file=favorites/tql/iejoin.tql>

Installation
------------

As an end-user, you probably want to use QueryGraphs through one of the following applications:
* The [standalone server](standalone-server/) allows you to upload & visualize query plans
* The [JupyterLab extension](jupyterlab-extension/) integrates query plan visualization into [JupyterLab](https://github.com/jupyterlab/jupyterlab/)
* The [Tableau Log Viewer](https://github.com/tableau/tableau-log-viewer) can visualize query plans embeded into Tableau & Hyper log files

Project Structure
-------------------

This repository is a monorepo currently consisting of the following projects:

* `query-graphs`: core functionality, i.e. the loading and rendering of query plans.
* `standalone-server`: a stand-alone server which provides an easy way to upload and visualize query plans
* `jupyterlab-plugin`: a JupyterLab extension integrating query plan visualization into JupyterLab

Furthermore, Query Graphs is also used by the
[Tableau Log Viewer](https://github.com/tableau/tableau-log-viewer)
to visualize query artifacts in Tableau's log files.
This integration is also done through the `standalone-server` subproject.

See the READMEs in the individual sub-folders for more information on installation, development, etc.

Acknowledgements
----------------

The dragging, zooming, panning, collapsing functionality originated from
“D3.js Drag and Drop, Zoomable, Panning, Collapsible Tree with Auto-Sizing” (Rob Schmuecker’s block #7880033).
