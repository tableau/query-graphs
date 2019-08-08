# @tableau/query-graphs-jupyterlab-extension

A JupyterLab extension for rendering hyper_queryplan files.

## Prerequisites

* JupyterLab

## Installation

```bash
jupyter labextension install @tableau/query-graphs-jupyterlab-extension
```

## Development

For a development install (requires npm version 4 or later), do the following in the repository directory:

```bash
npm install
jupyter labextension link .
```

To rebuild the package and the JupyterLab app:

```bash
npm run build
jupyter lab build
```

