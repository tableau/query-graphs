
// Require local modules
var common = require('./common');

// Color graph per federated connections
var colorFederated = function(treeData) {
    common.visit(treeData, function(d) {
        if (d.tag && d.tag === 'fed-op') {
            if (d.properties && d.properties.connection) {
                d.federated = d.properties.connection.split(".")[0];
                d.nodeClass = d.properties.connection.split(".")[0];
            }
        } else if (d.parent && d.parent.federated) {
            d.federated = d.parent.federated;
            d.nodeClass = d.parent.federated;
        }
    }, common.allChildren);
};

exports.colorFederated = colorFederated;
