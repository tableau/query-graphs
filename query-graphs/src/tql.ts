// -----------------------------------------------------------------------------
// d3/tql.js
// -----------------------------------------------------------------------------

import * as common from "./common";

///////////////////////////////////////////////////////////////////////////

/*-----------------------------------------------------------------------
  fail

  ---------------------------------------------------------------------------*/
function fail(msg, loc) {
    const error = new Error(msg) as any;
    error.start = loc.start;
    error.end = loc.end;

    throw error;
}

/*-----------------------------------------------------------------------
  token

  ---------------------------------------------------------------------------*/

const types = {
    punctuation: /^[,\(\)\.]/,
    operator: /^[-+*\/%&!|\^<>=:]+/,
    keyword: /^\w[\w\d-]*/,
    field: /^\[[^\]\\]*(?:\\.[^\]\\]*)*\]/,
    integer: /^\d+/,
    real: /^\d+\.\d*(e[-+]?\d+)?/,
    date: /^\#\d{4}-\d{2}-\d{2}\#/,
    datetime: /^\#\d{4}-\d{2}-\d{2}.\d{2}(:\d{2}(:\d{2}(\.\d*)?)?)?\#/,
    duration: /^\#\d+(:\d{2}(:\d{2}(:\d{2}(\.\d*)?)?)?)?\#/,
    string: /^"([^"]*"")*([^"]*)"/,
};

const whitespace = /^\s+|^;[^\n]*\n/;

export function token(string, pos) {
    //  Default arguments...
    pos = pos || 0;

    var sub = string.substr(pos);
    for (; ; sub = string.substr(pos)) {
        const ws = sub.match(whitespace);
        if (!ws) {
            break;
        }

        pos += ws[0].length;
    }

    var token: any = Object.keys(types).reduce(function(token, type) {
        const match = sub.match(types[type]);
        if (!match) {
            return token;
        }

        return {
            type: type,
            value: match[0],
            start: pos,
            end: pos + match[0].length,
        };
    }, {});

    if (!("type" in token)) {
        if (pos < string.length) {
            fail('Invalid token starting at: "' + string.substr(pos, pos + 10) + '"...', {start: pos, end: pos});
        }
        return token;
    }

    switch (token.type) {
        case "keyword":
            //  Keywords are case-insensitive
            token.value = token.value.toLowerCase();
            break;
        default:
            break;
    }

    return token;
}

/*------------------------------------------------------------------------
  tokenise

  ---------------------------------------------------------------------------*/
export function tokenise(string: string, pos = 0) {
    var tokens: any[] = [];
    while (pos < string.length) {
        const tok = token(string, pos);
        if (!("end" in tok)) {
            break;
        }

        tokens.push(tok);
        pos = tok.end;
    }

    return tokens;
}

///////////////////////////////////////////////////////////////////////////

/*------------------------------------------------------------------------
  Parser

  ---------------------------------------------------------------------------*/
function Parser(tokens) {
    this._tokens = tokens;
    this._index = 0;
}

/*------------------------------------------------------------------------
  _done

  ---------------------------------------------------------------------------*/
Parser.prototype._done = function() {
    return this._index >= this._tokens.length;
};

/*------------------------------------------------------------------------
  _peek

  ---------------------------------------------------------------------------*/
Parser.prototype._peek = function() {
    if (this._done()) {
        fail("Unexpected end of the query", this._tokens[this._tokens.length - 1]);
    }

    return this._tokens[this._index];
};

/*------------------------------------------------------------------------
  _next

  ---------------------------------------------------------------------------*/
Parser.prototype._next = function() {
    const next = this._peek();
    this._index++;

    return next;
};

/*------------------------------------------------------------------------
  _expect

  ---------------------------------------------------------------------------*/
Parser.prototype._expect = function(value) {
    const next = this._next();

    if (value !== next.value) {
        fail('Expected "' + value + '" but got "' + next.value + '"', next);
    }

    return next;
};

/*------------------------------------------------------------------------
  _field

  ---------------------------------------------------------------------------*/
Parser.prototype._field = function() {
    const part = this._next();
    if ("field" !== part.type) {
        fail('Expected field but got "' + part.value + '"', part);
    }

    return {name: part.value, class: "field"};
};

/*------------------------------------------------------------------------
  _fields

  ---------------------------------------------------------------------------*/
Parser.prototype._fields = function(name) {
    const result = {
        name: name || "fields",
        class: "fields",
        children: [] as any[],
    };

    this._expect("(");
    while (")" !== this._peek().value) {
        result.children.push(this._field());
    }
    this._expect(")");

    return result;
};

/*------------------------------------------------------------------------
  _tags

  ---------------------------------------------------------------------------*/
Parser.prototype._tags = function() {
    this._expect("(");

    const name = this._field().name;
    const result = this._fields(name);

    this._expect(")");

    return result;
};

/*------------------------------------------------------------------------
  _groups

  ---------------------------------------------------------------------------*/
Parser.prototype._groups = function(name) {
    const result = {
        name: name || "groups",
        class: "groups",
        children: [] as any[],
    };

    this._expect("(");

    while (")" !== this._peek().value) {
        result.children.push(this._tags());
    }

    this._expect(")");

    return result;
};

/*------------------------------------------------------------------------
  _identifier

  ---------------------------------------------------------------------------*/
Parser.prototype._identifier = function() {
    //  Really an array of dot-separated values
    const result: any[] = [];

    for (;;) {
        const field = this._field();

        result.push(field.name);
        if ("." !== this._peek().value) {
            break;
        }

        this._expect(".");
    }

    return result;
};

/*------------------------------------------------------------------------
  _integer

  ---------------------------------------------------------------------------*/
Parser.prototype._integer = function() {
    const token = this._next();
    if ("integer" !== token.type) {
        fail('Expected integer but got "' + token.value + '"', token);
    }

    return parseInt(token.value, 10);
};

/*------------------------------------------------------------------------
  _boolean

  ---------------------------------------------------------------------------*/
Parser.prototype._boolean = function() {
    const booleans = {true: true, false: false};

    const token = this._next();
    if ("keyword" !== token.type || !(token.value in booleans)) {
        fail('Expected Boolean but got "' + token.value + '"', token);
    }

    return booleans[token.value];
};

/*------------------------------------------------------------------------
  _string

  ---------------------------------------------------------------------------*/
Parser.prototype._string = function() {
    const token = this._next();
    if ("string" !== token.type) {
        fail('Expected string but got "' + token.value + '"', token);
    }

    return token.value.slice(1, -1).replace(/""/g, '"');
};

/*------------------------------------------------------------------------
  _keyword

  ---------------------------------------------------------------------------*/
Parser.prototype._keyword = function() {
    const token = this._next();
    if ("keyword" !== token.type) {
        fail('Expected keyword but got "' + token.value + '"', token);
    }

    return token.value;
};

/*------------------------------------------------------------------------
  _call

  ---------------------------------------------------------------------------*/
Parser.prototype._call = function() {
    const name = this._next().value;

    const children: any[] = [];
    while (")" !== this._peek().value) {
        children.push(this._expr());
    }

    this._next(")");

    return {class: "function", name: name, children: children};
};

/*------------------------------------------------------------------------
  _expr

  ---------------------------------------------------------------------------*/
Parser.prototype._expr = function() {
    var result: any = null;

    const token = this._next();
    switch (token.type) {
        case "field":
        case "integer":
        case "real":
        case "date":
        case "datetime":
        case "duration":
        case "string":
            result = {class: token.type, name: token.value};
            break;

        case "keyword":
            switch (token.value) {
                case "true":
                case "false":
                    result = {class: "boolean", name: token.value};
                    break;
                case "null":
                    result = {class: "null", name: token.value};
                    break;
                default:
                    result = this._call(token.value);
                    break;
            }
            break;

        default:
            switch (token.value) {
                case "(":
                    result = this._call();
                    break;
                default:
                    throw new Error("Invalid punctuation: " + token.value);
            }
    }

    return result;
};

/*------------------------------------------------------------------------
  _exprs

  ---------------------------------------------------------------------------*/
Parser.prototype._exprs = function(name) {
    const result = {
        name: name || "expressions",
        class: "expressions",
        children: [] as any[],
    };

    this._expect("(");

    while (")" !== this._peek().value) {
        result.children.push(this._expr());
    }

    this._expect(")");

    return result;
};

/*------------------------------------------------------------------------
  _binding

  ---------------------------------------------------------------------------*/
Parser.prototype._binding = function() {
    this._expect("(");

    const name = this._field();
    const expr = this._expr();

    this._expect(")");

    return {name: name.name, class: "binding", children: [expr]};
};

/*------------------------------------------------------------------------
  _bindings

  ---------------------------------------------------------------------------*/
Parser.prototype._bindings = function(name) {
    const result = {
        name: name || "expressions",
        class: "bindings",
        children: [] as any[],
    };

    this._expect("(");

    while (")" !== this._peek().value) {
        result.children.push(this._binding());
    }

    this._expect(")");

    return result;
};

/*------------------------------------------------------------------------
  _rename

  ---------------------------------------------------------------------------*/
Parser.prototype._rename = function() {
    this._expect("(");

    const inner = this._field();
    const outer = this._field();

    this._expect(")");

    return {name: outer.name, source: inner.name, class: "rename"};
};

/*------------------------------------------------------------------------
  _renames

  ---------------------------------------------------------------------------*/
Parser.prototype._renames = function(name) {
    const result = {
        name: name || "renames",
        class: "renames",
        children: [] as any[],
    };

    this._expect("(");

    while (")" !== this._peek().value) {
        result.children.push(this._rename());
    }

    this._expect(")");

    return result;
};

/*------------------------------------------------------------------------
  _orderby

  ---------------------------------------------------------------------------*/
Parser.prototype._orderby = function() {
    const result: any = {class: "orderby"};

    this._expect("(");

    result.name = this._field().name;
    result.sense = this._keyword();
    if ("field" === this._peek().type) {
        result.rank = this._field().name;
    }

    this._expect(")");

    return result;
};

/*------------------------------------------------------------------------
  _orderbys

  ---------------------------------------------------------------------------*/
Parser.prototype._orderbys = function(name) {
    const result = {
        name: name || "orderbys",
        class: "orderbys",
        children: [] as any[],
    };

    this._expect("(");

    while (")" !== this._peek().value) {
        result.children.push(this._orderby());
    }

    this._expect(")");

    return result;
};

/*------------------------------------------------------------------------
  _property

  ---------------------------------------------------------------------------*/
Parser.prototype._property = function() {
    this._expect("(");

    const name = this._string();
    const value = this._string();

    this._expect(")");

    const result = {};
    result[name] = value;

    return result;
};

/*------------------------------------------------------------------------
  _properties

  ---------------------------------------------------------------------------*/
Parser.prototype._properties = function(name) {
    const result = {
        name: name || "properties",
        class: "properties",
        properties: {},
    };

    this._expect("(");

    while (")" !== this._peek().value) {
        Object.assign(result.properties, this._property());
    }

    this._expect(")");

    return result;
};

/*------------------------------------------------------------------------
  _schema

  ---------------------------------------------------------------------------*/
Parser.prototype._schema = function(name) {
    const result = {
        name: name || "schema",
        class: "schema",
        children: [] as any,
    };

    this._expect("(");

    while (")" !== this._peek().value) {
        const column = this._properties();
        column.name = "[" + column.properties.name.replace(/\]/g, "]]") + "]";
        delete column.properties.name;
        result.children.push(column);
    }

    this._expect(")");

    return result;
};

/*------------------------------------------------------------------------
  conditions

  ---------------------------------------------------------------------------*/
function conditions(renames, op) {
    const children = renames.children.map(function(rename) {
        return {
            name: op,
            class: "function",
            children: [
                {name: rename.name, class: "field"},
                {name: rename.source, class: "field"},
            ],
        };
    });

    return {name: renames.name, children: children, class: "expressions"};
}

/*------------------------------------------------------------------------
  _operator

  ---------------------------------------------------------------------------*/
Parser.prototype._operator = function() {
    this._expect("(");

    //  op
    const token = this._next();
    if ("keyword" !== token.type) {
        fail("Expected operator name but got " + token.value + '"', token);
    }

    //  operator structure
    const result = {
        name: token.value, //  e.g. join
        class: "reference",
        children: [] as any[],
        properties: {} as any,
    };

    switch (result.name) {
        case "aggregate":
        case "ordaggr":
            result.children.push(this._operator());
            result.children.push(this._fields("groupbys"));
            result.children.push(this._bindings("measures"));
            break;

        case "append":
            result.children.push(this._operator());
            result.properties.imports = [];
            while (")" !== this._peek().value) {
                result.children.push(this._operator());
                result.properties.imports.push(this._renames());
            }
            break;

        case "cartprod":
            result.class = "join";
            result.children.push(this._operator());
            result.children.push(this._operator());
            result.children.push(this._renames("imports"));
            break;

        case "database":
            result.class = "command";
            result.children.push({name: this._string(), class: "string"});
            break;

        case "dict":
            result.properties.name = this._field().name;
            result.children.push(this._operator());
            break;

        case "exchange":
            result.children.push(this._operator());
            result.properties.concurrency = this._integer();
            result.properties.affinity = this._field().name;
            result.properties.thread = 0;
            result.properties.ordered = false;
            switch (this._peek().type) {
                case "integer":
                    result.properties.thread = this._integer();
                    break;
                case "keyword":
                    result.properties.ordered = this._boolean();
                    break;
                default:
                    break;
            }
            break;

        case "flowtable":
            result.children.push(this._operator());
            result.properties.encodings = "keyword" === this._peek().type ? this._keyword() : "none";
            break;

        case "fraction":
            result.children.push(this._operator());
            result.properties.concurrency = this._integer();
            result.properties.thread = this._integer();
            result.children.push(this._fields("clustering"));
            break;

        case "groupjoin":
            result.class = "join";
            result.children.push(this._operator());
            result.children.push(this._operator());
            result.children.push(this._renames("conditions"));
            result.children.push(this._renames("imports"));
            result.children.push(this._bindings("measures"));
            //  Turn the joins into conditions
            result.children[2] = conditions(result.children[2], "isnotdistinct");
            break;

        case "indextable":
            result.properties.name = this._field().name;
            result.children.push(this._operator());
            break;

        case "indexjoin":
            result.class = "join";
            result.children.push(this._operator());
            result.children.push(this._operator());
            result.children.push(this._fields("restrictions"));
            result.children.push(this._renames("imports"));
            result.properties.index = this._rename();
            result.properties.join = "inner";
            break;

        case "iejoin":
            result.class = "join";
            result.children.push(this._operator());
            result.children.push(this._operator());
            result.children.push(this._exprs("conditions"));
            result.children.push(this._renames("imports"));
            result.properties.join = this._keyword();
            result.properties.concurrency = this._integer();
            break;

        case "iterate":
            result.children.push(this._operator());
            result.children.push(this._operator());
            result.properties.name = this._field().name;
            break;

        case "join":
        case "lookup":
            result.class = "join";
            result.children.push(this._operator());
            result.children.push(this._operator());
            result.children.push(this._renames("conditions"));
            result.children.push(this._renames("imports"));
            result.properties.join = this._keyword();
            //  Turn the renames into conditions
            result.children[2] = conditions(result.children[2], "keyword" === this._peek().type ? this._keyword() : "=");
            break;

        case "order":
            result.children.push(this._operator());
            result.children.push(this._orderbys());
            break;

        case "partition-restart":
            result.children.push(this._operator());
            break;

        case "partition-split":
            result.properties.name = this._field().name;
            result.children.push(this._operator());
            break;

        case "pivot":
            result.children.push(this._operator());
            result.children.push(this._tags());
            result.children.push(this._groups());
            break;

        case "positionaljoin":
            result.class = "join";
            while (")" !== this._peek().value) {
                result.children.push(this._operator());
            }
            result.properties.join = "inner";
            break;

        case "project":
            result.children.push(this._operator());
            result.children.push(this._bindings("expressions"));
            break;

        case "radix-sort":
            result.children.push(this._operator());
            result.children.push(this._orderbys());
            break;

        case "remote":
            result.class = "remote";
            result.children.push(this._operator());
            //  servers
            //  database
            break;

        case "restrict":
        case "scan":
            result.children.push(this._operator());
            result.children.push(this._fields("restrictions"));
            break;

        case "select":
            result.children.push(this._operator());
            result.children.push({
                name: "predicate",
                class: "expressions",
                children: [this._expr()],
            });
            break;

        case "shared":
            result.children.push(this._operator());
            result.properties.reference = parseInt(this._string(), 10);
            break;

        case "table": {
            result.class = "table";
            const qname = this._identifier();
            result.properties.schema = qname[0];
            result.name = result.properties.table = qname[1];
            break;
        }

        case "text":
            result.class = "table";
            result.name = this._string();

            if ("(" !== this._peek().value) {
                break;
            }
            result.children.push(this._schema());

            if ("(" !== this._peek().value) {
                break;
            }
            result.properties = this._properties().properties;
            break;

        case "transform": {
            this._expect("(");
            result.children.push(null);
            while (")" !== this._peek().value) {
                const transform = this._transform();
                transform.children.push(result.children[0]);
                result.children[0] = transform;
            }
            this._expect(")");
            result.properties.concurrency = this._integer();
            break;
        }

        case "top":
            result.children.push(this._operator());
            result.children.push(this._orderbys());
            result.properties.top = this._integer();
            break;

        case "update":
            result.children.push(this._operator());
            result.children.push(this._renames("updates"));
            break;

        case "window":
            result.children.push(this._operator());
            result.children.push(this._fields("partitionbys"));
            result.children.push(this._orderbys());
            result.children.push(this._bindings());
            break;

        default:
            fail("Unknown operator: " + result.name, token);
            break;
    }

    this._expect(")");

    return result;
};

/*------------------------------------------------------------------------
  parse

  ---------------------------------------------------------------------------*/
Parser.prototype.parse = function() {
    const result: any[] = [];

    while (!this._done()) {
        result.push(this._operator());
    }

    return result;
};

///////////////////////////////////////////////////////////////////////////

/*------------------------------------------------------------------------
  parse

  ---------------------------------------------------------------------------*/
export function parse(text: string, pos = 0) {
    const parser = new Parser(tokenise(text, pos));

    return parser.parse();
}

/*------------------------------------------------------------------------
  assignSymbols

  ---------------------------------------------------------------------------*/
function assignSymbols(root) {
    common.visit(
        root,

        function(n) {
            switch (n.class) {
                case "join":
                    if (n.properties && n.properties.join) {
                        n.symbol = n.properties.join + "-join-symbol";
                    }
                    break;

                case "table":
                    if ("TEMP" === n.properties.schema) {
                        n.symbol = "temp-table-symbol";
                    } else {
                        n.symbol = "table-symbol";
                    }
                    break;

                case "remote":
                    n.symbol = "run-query-symbol";
                    break;

                case "bindings":
                case "expressions":
                case "fields":
                case "orderbys":
                case "renames":
                case "schema":
                    n.children.forEach(function(c) {
                        c.edgeClass = "qg-link-and-arrow";
                    });
                    break;

                default:
                    break;
            }
        },

        function(d) {
            return d.children && d.children.length > 0 ? d.children : [];
        },
    );
}

/*------------------------------------------------------------------------
  collapseNodes

  ---------------------------------------------------------------------------*/
function collapseNodes(treeData, graphCollapse) {
    if (graphCollapse === "n") {
        return;
    }

    const streamline = "s" === graphCollapse ? common.streamline : common.collapseAllChildren;
    common.visit(
        treeData,

        function(d) {
            switch (d.class) {
                case "bindings":
                case "expressions":
                case "fields":
                case "orderbys":
                case "renames":
                case "schema":
                    streamline(d);
                    return;
                default:
                    break;
            }
        },

        function(d) {
            return d.children && d.children.length > 0 ? d.children.slice(0) : [];
        },
    );
}

/*------------------------------------------------------------------------
  loadTQLPlan

  ---------------------------------------------------------------------------*/
export function loadTQLPlan(text, collapse) {
    //  Default arguments...
    collapse = collapse || "n";

    try {
        const parser = new Parser(tokenise(text));
        const root = {name: "plans", class: "forest", children: parser.parse()};

        assignSymbols(root);
        common.createParentLinks(root);
        collapseNodes(root, collapse);

        return {root: root, crosslinks: [], properties: {}};
    } catch (e) {
        console.log(e);
        return {
            error: "TQL parse failed with '" + e + "' at (" + e.start + ", " + e.end + ").",
        };
    }
}
