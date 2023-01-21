// `prettier` does not yet support `import type`
// eslint-disable-next-line prettier/prettier
import type { Configuration } from "webpack";
import path from "path";
import CopyPlugin from "copy-webpack-plugin";
import { CreateExamplesListPlugin } from "./webpack-create-examples-list";
import FaviconsWebpackPlugin from 'favicons-webpack-plugin';
import HtmlWebpackPlugin from 'html-webpack-plugin';

const config: Configuration = {
    entry: {
        bundle: "./src/index.tsx",
    },
    plugins: [
        new HtmlWebpackPlugin({
            title: "Query Graphs",
            filename: 'index.html',
            chunks: ["bundle"],
        }),
        new FaviconsWebpackPlugin({
            "logo": "../media/query-graphs-logo.svg",
            "manifest": './src/manifest.json'
        }),
        new CopyPlugin({patterns: ["../media/query-graphs-logo.svg", "examples/**"]}),
        new CreateExamplesListPlugin(),
    ],
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: "ts-loader",
                exclude: /node_modules/,
            },
            {
                test: /\.css$/,
                use: ["style-loader", "css-loader"],
            },
        ],
    },
    resolve: {
        extensions: [".tsx", ".ts", ".js"],
        // TODO: get rid of this fallback; need to find a replacement for `xml2js`
        fallback: {
            timers: require.resolve("timers-browserify"),
            stream: require.resolve("stream-browserify"),
            buffer: require.resolve("buffer/"),
        },
        alias: {
            /* to enable tracing in a production build:
            'react-dom$': 'react-dom/profiling',
            'scheduler/tracing': 'scheduler/tracing-profiling',
            */
        },
    },
    output: {
        filename: "[name].js",
        path: path.resolve(__dirname, "..", "dist"),
        clean: true,
    },
};

export default config;