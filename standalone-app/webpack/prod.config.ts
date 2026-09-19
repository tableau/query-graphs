import {merge} from "webpack-merge";
import commonConfig from "./common.config";
import {GenerateSW} from "workbox-webpack-plugin";

const prodConfig = merge(commonConfig, {
    mode: "production",
    devtool: "source-map",
    output: {
        chunkFilename: "chunks/[name].[contenthash].js",
    },
    optimization: {
        splitChunks: {
            cacheGroups: {
                default: false,
                defaultVendors: false,
                editorCore: {
                    chunks: "async",
                    minChunks: 2,
                    name: "editor-core",
                    priority: 10,
                    enforce: true,
                },
                editorParser: {
                    test: /[\\/]node_modules[\\/]@lezer[\\/]lr[\\/]/,
                    chunks: "async",
                    name: "editor-parser",
                    priority: 20,
                    enforce: true,
                },
            },
        },
    },
    plugins: [
        new GenerateSW({
            sourcemap: false,
            skipWaiting: true,
            clientsClaim: true,
            ignoreURLParametersMatching: [/./],
            include: [/^bundle\.js$/, /^chunks\/.*\.js$/, /^index.html$/],
        }),
    ],
});

export default prodConfig;
