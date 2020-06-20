var path = require("path");

module.exports = {
    entry: './app.ts',
    output: {
        path: path.resolve(__dirname, 'webroot'),
        filename: 'query-graphs.min.js'
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: "ts-loader",
                exclude: /node_modules/,
            },
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader']
            }
        ]
    },
    devtool: "source-map"
};
