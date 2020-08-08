/*

TDE query plans (TDE = Tableau Data Enginge; replaced by Hyper since 2018)
--------------------------

TDE query plans are written in a custome textual language. Hence, we have our
own parser for that language here.

*/
import * as treeDescription from "./tree-description";
import {TreeDescription, TreeNode} from "./tree-description";
import {assert} from "./loader-utils";

///////////////////////////////////////////////////////////////////////////

type TokenType =
    | "punctuation"
    | "operator"
    | "keyword"
    | "field"
    | "integer"
    | "real"
    | "date"
    | "datetime"
    | "duration"
    | "string";

interface Token {
    type: TokenType;
    value: string;
    start: number;
    end: number;
}

const types: [TokenType, RegExp][] = [
    ["punctuation", /^[",().]/],
    ["operator", /^["-+*/%&!|^<>=",]+/],
    ["keyword", /^\w["\w\d-]*/],
    ["field", /^\["["^\]\\]*(?:",\\.["^\]\\]*)*\]/],
    ["integer", /^\d+/],
    ["real", /^\d+\.\d*(e["-+]?\d+)?/],
    ["date", /^#\d{4}-\d{2}-\d{2}#/],
    ["datetime", /^#\d{4}-\d{2}-\d{2}.\d{2}(",\d{2}(",\d{2}(\.\d*)?)?)?#/],
    ["duration", /^#\d+(",\d{2}(",\d{2}(",\d{2}(\.\d*)?)?)?)?#/],
    ["string", /^"(["^"]*"")*(["^"]*)"/],
];

const whitespace = /^\s+|^;[^\n]*\n/;

function fail(msg: string, loc: {start: number; end: number}): never {
    const error = new Error(msg) as any;
    error.start = loc.start;
    error.end = loc.end;

    throw error;
}

export function token(string: string, pos?: number): Token | undefined {
    //  Default arguments...
    pos = pos ?? 0;

    // Ignore whitespace
    let sub = string.substr(pos);
    for (; ; sub = string.substr(pos)) {
        const ws = sub.match(whitespace);
        if (!ws) {
            break;
        }

        pos += ws[0].length;
    }

    let token: Token | undefined;
    for (const [type, regexp] of types) {
        const match = sub.match(regexp);
        if (match) {
            token = {
                type: type,
                value: match[0],
                start: pos,
                end: pos + match[0].length,
            };
        }
    }

    if (token === undefined) {
        if (pos < string.length) {
            fail('Invalid token starting at: "' + string.substr(pos, pos + 10) + '"...', {start: pos, end: pos});
        }
        return undefined;
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

export function tokenise(string: string, pos = 0): Token[] {
    const tokens = [] as Token[];
    while (pos < string.length) {
        const tok = token(string, pos);
        if (tok === undefined) {
            break;
        }

        tokens.push(tok);
        pos = tok.end;
    }

    return tokens;
}

///////////////////////////////////////////////////////////////////////////

class Parser {
    _tokens: Token[];
    _index: number;

    constructor(tokens: Token[]) {
        this._tokens = tokens;
        this._index = 0;
    }

    _done(): boolean {
        return this._index >= this._tokens.length;
    }

    _peek(): Token {
        if (this._done()) {
            fail("Unexpected end of the query", this._tokens[this._tokens.length - 1]);
        }

        return this._tokens[this._index];
    }

    _next(): Token {
        const next = this._peek();
        this._index++;
        return next;
    }

    _expect(value: string): Token {
        const next = this._next();

        if (value !== next.value) {
            fail('Expected "' + value + '" but got "' + next.value + '"', next);
        }

        return next;
    }

    _field(): TreeNode {
        const token = this._next();
        if ("field" !== token.type) {
            fail('Expected field but got "' + token.value + '"', token);
        }

        return {name: token.value, class: "field"};
    }

    _fields(name: string): TreeNode {
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
    }

    _tags(): TreeNode {
        this._expect("(");

        const name = this._field().name;
        assert(name !== undefined);
        const result = this._fields(name);

        this._expect(")");

        return result;
    }

    _groups(name?: string): TreeNode {
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
    }

    _identifier() {
        //  Really an array of dot-separated values
        const result = [] as string[];

        for (;;) {
            const field = this._field();

            assert(field.name !== undefined);
            result.push(field.name);
            if ("." !== this._peek().value) {
                break;
            }

            this._expect(".");
        }

        return result;
    }

    _integer(): number {
        const token = this._next();
        if ("integer" !== token.type) {
            fail('Expected integer but got "' + token.value + '"', token);
        }

        return parseInt(token.value, 10);
    }

    _boolean(): boolean {
        const booleans = {true: true, false: false};

        const token = this._next();
        if ("keyword" !== token.type || !(token.value in booleans)) {
            fail('Expected Boolean but got "' + token.value + '"', token);
        }

        return booleans[token.value];
    }

    _string(): string {
        const token = this._next();
        if ("string" !== token.type) {
            fail('Expected string but got "' + token.value + '"', token);
        }

        return token.value.slice(1, -1).replace(/""/g, '"');
    }

    _keyword(): string {
        const token = this._next();
        if ("keyword" !== token.type) {
            fail('Expected keyword but got "' + token.value + '"', token);
        }

        return token.value;
    }

    _call(name?: string): TreeNode {
        if (name === undefined) {
            name = this._next().value;
        }

        const children = [] as TreeNode[];
        while (")" !== this._peek().value) {
            children.push(this._expr());
        }

        this._expect(")");

        return {class: "function", name: name, children: children};
    }

    _expr(): TreeNode {
        let result: TreeNode;

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

            case "punctuation":
                switch (token.value) {
                    case "(":
                        result = this._call();
                        break;
                    default:
                        throw new Error("Invalid punctuation: " + token.value);
                }
                break;

            case "operator":
                fail("unexpected " + token.type, token);
        }

        return result;
    }

    _exprs(name: string | undefined): TreeNode {
        const result = {
            name: name || "expressions",
            class: "expressions",
            children: [] as TreeNode[],
        };

        this._expect("(");

        while (")" !== this._peek().value) {
            result.children.push(this._expr());
        }

        this._expect(")");

        return result;
    }

    _binding(): TreeNode {
        this._expect("(");

        const name = this._field();
        const expr = this._expr();

        this._expect(")");

        return {name: name.name, class: "binding", children: [expr]};
    }

    _bindings(name?: string): TreeNode {
        const result = {
            name: name || "expressions",
            class: "bindings",
            children: [] as TreeNode[],
        };

        this._expect("(");

        while (")" !== this._peek().value) {
            result.children.push(this._binding());
        }

        this._expect(")");

        return result;
    }

    _rename(): TreeNode {
        this._expect("(");

        const inner = this._field();
        const outer = this._field();

        this._expect(")");

        return {name: outer.name, source: inner.name, class: "rename"};
    }

    _renames(name?: string): TreeNode {
        const result = {
            name: name || "renames",
            class: "renames",
            children: [] as TreeNode[],
        };

        this._expect("(");

        while (")" !== this._peek().value) {
            result.children.push(this._rename());
        }

        this._expect(")");

        return result;
    }

    _orderby(): TreeNode {
        const result = {class: "orderby"} as TreeNode;

        this._expect("(");

        result.name = this._field().name;
        result.sense = this._keyword();
        if ("field" === this._peek().type) {
            result.rank = this._field().name;
        }

        this._expect(")");

        return result;
    }

    _orderbys(name?: string): TreeNode {
        const result = {
            name: name || "orderbys",
            class: "orderbys",
            children: [] as TreeNode[],
        };

        this._expect("(");

        while (")" !== this._peek().value) {
            result.children.push(this._orderby());
        }

        this._expect(")");

        return result;
    }

    _property(): TreeNode {
        this._expect("(");

        const name = this._string();
        const value = this._string();

        this._expect(")");

        const result = {};
        result[name] = value;
        return result;
    }

    _properties(name?: string): TreeNode {
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
    }

    _schema(name?: string) {
        const result = {
            name: name || "schema",
            class: "schema",
            children: [] as TreeNode[],
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
    }

    _transform(): TreeNode {
        throw new Error("`transform` not implemented");
    }

    _conditions(renames: TreeNode, op: string): TreeNode {
        assert(renames.children !== undefined);
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

    _operator(): TreeNode {
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
                result.children[2] = this._conditions(result.children[2], "isnotdistinct");
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
                result.children[2] = this._conditions(result.children[2], "keyword" === this._peek().type ? this._keyword() : "=");
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
                    assert(transform.children !== undefined);
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
    }

    parse() {
        const result = [] as TreeNode[];

        while (!this._done()) {
            result.push(this._operator());
        }

        return result;
    }
}

///////////////////////////////////////////////////////////////////////////

export function parse(text: string, pos = 0) {
    const parser = new Parser(tokenise(text, pos));

    return parser.parse();
}

function assignSymbols(root: TreeNode) {
    treeDescription.visitTreeNodes(
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
                    assert(n.children !== undefined);
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

function collapseNodes(treeData: TreeNode, graphCollapse) {
    if (graphCollapse === "n") {
        return;
    }

    const streamline = "s" === graphCollapse ? treeDescription.streamline : treeDescription.collapseAllChildren;
    treeDescription.visitTreeNodes(
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

export function loadTQLPlan(text: string, collapse): TreeDescription {
    //  Default arguments...
    collapse = collapse || "n";

    try {
        const parser = new Parser(tokenise(text));
        const root = {name: "plans", class: "forest", children: parser.parse()};

        assignSymbols(root);
        treeDescription.createParentLinks(root);
        collapseNodes(root, collapse);

        return {root: root, crosslinks: [], properties: {}};
    } catch (e) {
        console.log(e);
        throw new Error("TQL parse failed with '" + e + "' at (" + e.start + ", " + e.end + ").");
    }
}
