var path = require("path");

module.exports = {
    entry: './app.js',
    output: {
        path: path.resolve(__dirname, 'webroot'),
        filename: 'query-graphs.min.js'
    },
    module: {
        rules: [
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader']
            }
        ]
    },
    devtool: "source-map"
};
