Query Graphs stand-alone server
============
[![Community Supported](https://img.shields.io/badge/Support%20Level-Community%20Supported-457387.svg)](https://www.tableau.com/support-levels-it-and-developer-tools)

Helping people see and understand queries.

![Query Visualization](https://tableau.github.io/query-graphs/media/sample_graph.png "Sample Graph")

Description
-----------

This package provides a simple stand-alone web-server.
Users can upload query plans to this server to visualize them.

The server stores the uploaded query plans for some time, so that the resulting links can be shared with team members through email/Slack.

Installation
------------

1. Install NodeJS and yarn (not npm!)
2. Run the following commands

```shell
git clone https://github.com/tableau/query-graphs.git
cd query-graphs/standalone-server
yarn install
yarn run --cwd=../query-graphs build
yarn run build
node upload-server.js
```

After local installation and server start, you should be able to open the example
for logical query visualization at <http://localhost:3000/query-graphs.html?file=tableau/joins.xml>, and example for
aql table query visualization at <http://localhost:3000/query-graphs.html?file=tableau/aql-table-query-example.xml>.

You can get a complete list of all example visualizations on <http://localhost:3000/favorites>.
Feel free to explore them.

You can open the upload form at <http://localhost:3000/> and upload query plans by choosing a
local file or by copy-pasting the query plan.

You can find a side-by-side query comparison at
<http://localhost:3000/compare-layout.html>.

Query String Parameters
-----------------------

The following URL parameters are supported for query visualization:

```
Parameter       | Description
---------       | -----------
collapse        | node collapse style: n - no/none, y - yes/some, s - streamline all secondary nodes (default)
debug           | debug mode: any setting will enable (disabled by default)
file            | name of file to display
format          | format of the file: 'tableau', 'hyper', 'xml', 'postgres', 'json' (default: file format will be inferred)
orientation     | graph orientation: top-to-bottom (default), right-to-left, bottom-to-top, left-to-right
properties      | JSON object with additional properties to be displayed in the tree label
```

The following URL parameters are supported for side-by-side comparisons:

```
Parameter       | Description
---------       | -----------
left            | name of file to render in the left iframe
left-label      | label of the left iframe
right           | name of file to render in the right iframe
right-label     | label of the right iframe
```

Development
-----------

To get a debug build instead of a production build, use `yarn run build:dev` instead of `yarn run build` .
For automatically rebuilding the project as soon as you save modifications to the TypeScript files, run `yarn run build::watch` in the background.
Note that this will only work for modifications inside the `standalone-server` package, though, you still need to rebuild the `query-graphs` package manually if you change it.

We use eslint to lint our TypeScript code.
To run eslint on the appropriate files, you can use `yarn run lint` inside the root directory of this git repository.

There are only very few test cases, yet.
For now, we manually verify that all example query plans render as expected.

Integration into Table Log Viewer
-----------

To create an archive containing the bundle and associated files for the Tableau Log Viewer, use `yarn run bundle-tlv`.
Extract the archive in tlv-qt/query-graphs, a subdirectory in the tlv-qt project.
