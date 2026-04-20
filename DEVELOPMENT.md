## Building & Local deployment

1. Install yarn (not npm!)
2. Run the following commands

```shell
git clone https://github.com/tableau/query-graphs.git
cd query-graphs/standalone-app
yarn install
yarn run --cwd=../query-graphs build
yarn run build
yarn run prod-server
```

and open `localhost:8080`.

## Project Structure

This repository is a monorepo currently consisting of the following submodules:

* `query-graphs`: core functionality, i.e. the loading and rendering of query plans.
* `standalone-app`: a stand-alone app containing the "shell" around the rendering functionality provided by the `query-graphs` library. Provides, e.g., the UI to open a file or copy-paste a query plan.
* `upload-server`: a file-server which can be used to create shareable links for query plans
* `plan-dumper`: utility scripts to refresh the demo query plans committed insides this repository

You probably care most about `query-graphs` and `standalone-app` which provide the main functionality for query plan visualization.

## Modifying `standalone-app`

The stand-alone app contains all the auxiliary functionality (file opening, sharing, ...) around the actual `query-graphs` core library. It is written in TypeScript on top of the React framework.

After your initial build following the instructions above, you use `yarn dev-server` inside the `standalone-app` folder to start a development server on `localhost:8080`. This server will automatically re-compile and reload the app, as you save your to the TypeScript files.

## Modifying `query-graphs`

The `query-graphs` library contains all logic around parsing and rendering of query plans.
If you want to add, e.g., support for a new query plan format, tweak some color highlighting or add other new visualization features, this is the code which you want to modify.

The `query-graphs` folder does not provide an UI on its own.
To see your changes in action, you will have to use the interface provided by `standalone-app`.
To do so, run `yarn dev-server` inside the `standalone-app` folder and connect to the UI on `localhost:8080`.
Changes inside the `query-graphs` directory are not immediately picked up by the `standalone-app`. 
For your changes to take effect, you will have to re-run `yarn build` inside the `query-graphs` folder.

## Testing with Hyper Query Plans

When making changes to the query plan visualization (e.g., supporting a new plan format), follow these steps to verify everything works end-to-end.

### 1. Dump fresh plans from Hyper

The `plan-dumper/dump-plans.py` script runs SQL queries against a Hyper instance and writes the resulting `EXPLAIN` output as JSON files into `standalone-app/examples/`.

**Prerequisites:**

```shell
pip3 install tableauhyperapi
```

**Running with the default (pip-installed) Hyper:**

```shell
cd plan-dumper
python3 dump-plans.py
```

**Running with a custom Hyper build:**

```shell
cd plan-dumper
python3 dump-plans.py --hyper-path ~/workspace/hyper-db/bazel-bin/hyper/tools/hyperd
```

The `--hyper-path` argument should point to the directory containing the `hyperd` binary.
When omitted, the script uses the `hyperd` bundled with the pip-installed `tableauhyperapi` package.

If you also have a Postgres instance running on port 5433, install `psycopg2` to dump Postgres plans as well. Otherwise, the Postgres section is skipped automatically.

### 2. Visually verify plans in the local server

Build and start the app (if not already running):

```shell
cd standalone-app
yarn install
yarn run --cwd=../query-graphs build
yarn run build
yarn run prod-server
```

Then open [localhost:8080/examples.html](http://localhost:8080/examples.html) in your browser. This page lists all example plans. Click through the Hyper plans to verify they render correctly.

## Linting

We use eslint as our code linter.
To run eslint, use `yarn run lint` inside the top-level directory of the repository.