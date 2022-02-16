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
PostgreSQL EXPLAIN (FORMAT JSON) is also supported.

You can view a few example query visualizations online:
* [Tableau Logical Query joining 3 tables](https://tableau.github.io/query-graphs/query-graphs.html?file=favorites/tableau/joins.xml&properties={"title":"Tableau%20Logical%20Query"}),
* [Federated query](https://tableau.github.io/query-graphs/query-graphs.html?file=favorites/tableau/dint4.xml&properties={"title":"Federated%20Query"}),
* [Hyper query plan for TPC-H Q1](https://tableau.github.io/query-graphs/query-graphs.html?file=favorites/hyper/tpch-q1.plan.json&properties={"title":"TPC-H%20Q1%20in%20Hyper"}),
* [Optimizer steps of Hyper for TPC-H Q2](https://tableau.github.io/query-graphs/query-graphs.html?file=favorites/hyper/tpch-q2-steps.plan.json&orientation=left-to-right&properties={"title":"Optimizer%20steps%20for%20TPC-H%20Q2"}),
* [PostgreSQL query plan](https://tableau.github.io/query-graphs/query-graphs.html?file=favorites/postgres/learning_to_optimize_federated_queries/job/federated/disable_nestloop/10a_ricole-lx.json&properties={"title":"PostgreSQL%20Query%20Plan"})

Installation
------------

As an end-user, you probably want to use QueryGraphs through one of the following applications:
* The [standalone server](standalone-server/) allows you to upload & visualize query plans
* The [Tableau Log Viewer](https://github.com/tableau/tableau-log-viewer) can visualize query plans embeded into Tableau & Hyper log files

Project Structure
-------------------

This repository is a monorepo currently consisting of the following projects:

* `query-graphs`: core functionality, i.e. the loading and rendering of query plans.
* `standalone-server`: a stand-alone server which provides an easy way to upload and visualize query plans
* `plan-dumper`: utility scripts to refresh the demo query plans committed insides this repository

Furthermore, Query Graphs is also used by the
[Tableau Log Viewer](https://github.com/tableau/tableau-log-viewer)
to visualize query artifacts in Tableau's log files.
This integration is also done through the `standalone-server` subproject.

See the READMEs in the individual sub-folders for more information on installation, development, etc.

Acknowledgements
----------------

The dragging, zooming, panning, collapsing functionality originated from
“D3.js Drag and Drop, Zoomable, Panning, Collapsible Tree with Auto-Sizing” (Rob Schmuecker’s block #7880033).
