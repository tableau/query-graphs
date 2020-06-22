Query Graphs
============
[![Community Supported](https://img.shields.io/badge/Support%20Level-Community%20Supported-457387.svg)](https://www.tableau.com/support-levels-it-and-developer-tools)

Helping people see and understand queries.

![Query Visualization](https://tableau.github.io/query-graphs/standalone-server/webroot/media/sample_graph.png "Sample Graph")

Description
-----------

Query Graphs is an investigation into graph visualization for query processing, such as for logical queries and their physical
query evaluation plans.
Current visualizations are tailored for artifacts from Tableau's query ecosystem:
LogicalQuery XML, QueryFunction XML, and Hyper query-plan JSON.

This package provides the reusable core functionality, i.e. the loading and rendering of query plans.
As an end-user, you probably want to use QueryGraphs through one of the following applications:
* The [standalone server](standalone-server/) allows you to upload & visualize query plans
* The [JupyterLab extension](jupyterlab-extension/) integrates query plan visualization into [JupyterLab](https://github.com/jupyterlab/jupyterlab/)
* The [Tableau Log Viewer](https://github.com/tableau/tableau-log-viewer) can visualize query plans embeded into Tableau & Hyper log files

Development
-----------

Since this package only contains the core logic, it doesn't contain any
concrete way to actually trigger the visualization of a query plan.
For iterating on plan visualizations, we recommend to use the
[standalone server](../standalone-server) for testing and debugging the
visualization of query plans.

We do have some automated test coverage which can be tested through
`npm run test`. However, this test coverage is still spotty. Hence,
you should manually check if all examples included in the standalone-server
still work as expected.

We use eslint to lint our JavaScript code.
To run eslint on the appropriate files, you can use `npm run lint` inside this directory.
