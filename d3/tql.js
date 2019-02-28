// -----------------------------------------------------------------------------
//
// This file is the copyrighted property of Tableau Software and is protected
// by registered patents and other applicable U.S. and international laws and
// regulations.
//
// Unlicensed use of the contents of this file is prohibited. Please refer to
// the NOTICES.txt file for further details.
//
// -----------------------------------------------------------------------------
// d3/tql.js
// -----------------------------------------------------------------------------
'use strict';

const common = require('./common');

///////////////////////////////////////////////////////////////////////////

/*------------------------------------------------------------------------
  fail

  ---------------------------------------------------------------------------*/
function fail(

    msg,
    loc )

{
    const   error = new Error( msg );
    error.start = loc.start;
    error.end = loc.end;

    throw error;
}

/*------------------------------------------------------------------------
  token

  ---------------------------------------------------------------------------*/

const types = {
    punctuation: /^[,\(\)\.]/,
    operator: /^[-+*\/%&!|\^<>=:]+/,
    keyword: /^\w[\w\d-]*/,
    identifier: /^\[[^\]\\]*(?:\\.[^\]\\]*)*\]/,
    integer: /^\d+/,
    real: /^\d+\.\d*(e[-+]?\d+)?/,
    date: /^\#\d{4}-\d{2}-\d{2}\#/,
    datetime: /^\#\d{4}-\d{2}-\d{2}.\d{2}(:\d{2}(:\d{2}(\.\d*)?)?)?\#/,
    duration: /^\#\d+(:\d{2}(:\d{2}(:\d{2}(\.\d*)?)?)?)?\#/,
    string: /^"([^"]*"")*([^"]*)"/,
};

module.exports.token = function(

   string,
   pos = 0 )

{
    var sub = string.substr( pos );
    let ws = sub.match ( /^\s*/ );
    if ( ws ) {
        pos += ws[0].length;
        sub = string.substr( pos );
    }

    var token = Object.keys( types )
        .reduce( function( token, type, index ) {
            let match = sub.match( types[ type ] );
            if ( !match ) return token;

            return { type: type, value: match[0], start: pos, end: pos + match[0].length };
        }, {} );

    if ( !( 'type' in token ) ) {
        if ( pos < string.length ) fail( 'Invalid token starting at: "' + string.substr( pos, pos + 10 ) + '"...', { start: pos, end: pos } );
        return token;
    }

    switch ( token.type ) {
      case 'keyword':
        //  Keywords are case-insensitive
        token.value = token.value.toLowerCase();
        break;
    }

    return token;
}

/*------------------------------------------------------------------------
  tokenise

  ---------------------------------------------------------------------------*/
module.exports.tokenise = function(

   string,
   pos = 0 )

{
    var tokens = [];
    while ( pos < string.length ) {
        let token = module.exports.token( string, pos );
        if ( !( 'end' in token ) ) break;

        tokens.push( token );
        pos = token.end;
    }

    return tokens;
}

///////////////////////////////////////////////////////////////////////////

/*------------------------------------------------------------------------
  Parser

  ---------------------------------------------------------------------------*/
function Parser (

    tokens )
{
    if ( !(this instanceof Parser ) )
        return new Parser( tokens );

    this._tokens = tokens;
    this._index = 0;
}

/*------------------------------------------------------------------------
  _done

  ---------------------------------------------------------------------------*/
Parser.prototype._done = function()
{
    return this._index >= this._tokens.length;
}

/*------------------------------------------------------------------------
  _peek

  ---------------------------------------------------------------------------*/
Parser.prototype._peek = function()
{
    if ( this._done() )
        fail( 'Unexpected end of the query', this._tokens[ this._tokens.length - 1 ] );

    return this._tokens[ this._index ];
}

/*------------------------------------------------------------------------
  _next

  ---------------------------------------------------------------------------*/
Parser.prototype._next = function()
{
    const next = this._peek();
    this._index++;

    return next;
}

/*------------------------------------------------------------------------
  _expect

  ---------------------------------------------------------------------------*/
Parser.prototype._expect = function(

   value )
{
    const next = this._next();

    if ( value != next.value )
        fail( 'Expected "'+value+'" but got "'+next.value+'"', next );

    return next;
}

/*------------------------------------------------------------------------
  _identifier

  ---------------------------------------------------------------------------*/
Parser.prototype._identifier = function()
{
    //  Really an array of dot-separated values
    const   result = [];

    while ( true ) {
        const part = this._next();
        if ( 'identifier' != part.type )
            fail( 'Expected identifier but got "'+ part.value + '"', part );

        result.push( part.value.slice( 1, -1 ).replace( ']]', ']' ) );
        if ( '.' != this._peek().value ) break;

        this._expect( '.' );
    }

    return result;
}

/*------------------------------------------------------------------------
  _identifiers

  ---------------------------------------------------------------------------*/
Parser.prototype._identifiers = function()
{
    const   result = [];

    this._expect( '(' );
    while ( ')' != this._peek().value )
        result.push( this._identifier() );
    this._expect( ')' );

    return result;
}

/*------------------------------------------------------------------------
  _integer

  ---------------------------------------------------------------------------*/
Parser.prototype._integer = function()
{
    const token = this._next();
    if ( 'integer' != token.type )
        fail( 'Expected integer but got "'+ token.value + '"', token );

    return parseInt( token.value );
}

/*------------------------------------------------------------------------
  _string

  ---------------------------------------------------------------------------*/
Parser.prototype._string = function()
{
    const token = this._next();
    if ( 'string' != token.type )
        fail( 'Expected string but got "'+ token.value + '"', token );

    return token.value.slice( 1, -1 ).replace( /""/g, '"' );
}

/*------------------------------------------------------------------------
  _keyword

  ---------------------------------------------------------------------------*/
Parser.prototype._keyword = function()
{
    const token = this._next();
    if ( 'keyword' != token.type )
        fail( 'Expected keyword but got "'+ token.value + '"', token );

    return token.value;
}

/*------------------------------------------------------------------------
  _call

  ---------------------------------------------------------------------------*/
Parser.prototype._call = function()
{
    const op = this._next().value;

    const args = [];
    while ( this._peek().value != ')' )
       args.push( this._expr() );

    this._next( ')' );

    return { class: 'function', op: op, args: args };
}

/*------------------------------------------------------------------------
  _expr

  ---------------------------------------------------------------------------*/
Parser.prototype._expr = function()
{
    var     result = null;

    const   token = this._next();
    switch ( token.type ) {
      case 'identifier':
        result = { class: token.type, value: token.value.slice( 1, -1 ).replace( ']]', ']' ) };
        break;

      case 'integer':
        result = { class: token.type, value: parseInt( token.value ) };
        break;

      case 'real':
        result = { class: token.type, value: parseFloat( token.value ) };
        break;

      case 'date':
        result = { class: token.type, value: token.value };
        break;

      case 'datetime':
        result = { class: token.type, value: token.value };
        break;

      case 'duration':
        result = { class: token.type, value: token.value };
        break;

      case 'string':
        result = { class: token.type, value: token.value.slice( 1, -1 ).replace( /""/g, '"' ) };
        break;

      case 'keyword':
        switch ( token.value ) {
          case 'true':
            result = true;
            break;
          case 'false':
            result = false;
            break;
          case 'null':
            result = null;
            break;
          default:
            result = this._call( token.value );
            break;
        }
        break;

      default:
        switch ( token.value ) {
          case '(':
            result = this._call();
            break;
         default:
            throw new Error( 'Invalid punctuation: ' + token.value );
        }
    }

    return result;
}

/*------------------------------------------------------------------------
  _exprs

  ---------------------------------------------------------------------------*/
Parser.prototype._exprs = function()
{
    let   result = [];

    this._expect( '(' );

    while ( ')' != this._peek().value )
        result.push( this._expr() );

    this._expect( ')' );

    return result;
}

/*------------------------------------------------------------------------
  _binding

  ---------------------------------------------------------------------------*/
Parser.prototype._binding = function()
{
    const   result = {};

    this._expect( '(' );

    const   name = this._identifier()[0];
    const   expr = this._expr();

    this._expect( ')' );

    result[ name ] = expr;

    return result;
}

/*------------------------------------------------------------------------
  _bindings

  ---------------------------------------------------------------------------*/
Parser.prototype._bindings = function()
{
    let   result = {};

    this._expect( '(' );

    while ( ')' != this._peek().value )
        result = Object.assign( result, this._binding() );

    this._expect( ')' );

    return result;
}

/*------------------------------------------------------------------------
  _rename

  ---------------------------------------------------------------------------*/
Parser.prototype._rename = function()
{
    const   result = {};

    this._expect( '(' );

    const   inner = this._identifier()[0];
    const   outer = this._identifier()[0];

    this._expect( ')' );

    result[ outer ] = inner;

    return result;
}

/*------------------------------------------------------------------------
  _renames

  ---------------------------------------------------------------------------*/
Parser.prototype._renames = function()
{
    let   result = {};

    this._expect( '(' );

    while ( ')' != this._peek().value )
        result = Object.assign( result, this._rename() );

    this._expect( ')' );

    return result;
}

/*------------------------------------------------------------------------
  _sort

  ---------------------------------------------------------------------------*/
Parser.prototype._sort = function()
{
    const   result = [];

    this._expect( '(' );

    result.push( this._identifier()[0] );
    result.push( this._keyword() );
    if ( 'identifier' === this._peek().type )
        result.push( this._identifier()[0] );

    this._expect( ')' );

    return result;
}

/*------------------------------------------------------------------------
  _sorts

  ---------------------------------------------------------------------------*/
Parser.prototype._sorts = function()
{
    let   result = [];

    this._expect( '(' );

    while ( ')' != this._peek().value )
        result.push( this._sort() );

    this._expect( ')' );

    return result;
}

/*------------------------------------------------------------------------
  _operator

  ---------------------------------------------------------------------------*/
Parser.prototype._operator = function()
{
    this._expect( '(' );

    //  op
    const   token = this._next();
    if ( 'keyword' != token.type )
        fail( 'Expected operator name but got '+ next.value + '"', next );

    //  operator structure
    const   result = {
        name:           token.value,    //  e.g. join
        class:          'reference',
        children:       [],
        properties:     {},
    };

    switch ( result.name ) {
      case 'aggregate':
      case 'ordaggr':
        result.children.push( this._operator() );
        result.properties.groupbys = this._identifiers();
        result.properties.expressions = this._bindings();
        break;

      case 'append':
        result.children.push( this._operator() );
        result.properties.imports = [];
        while ( this._peek().value != ')' ) {
            result.children.push( this._operator() );
            result.properties.imports.push( this._renames() );
        }
        break;

      case 'cartprod':
        result.class = 'join';
        result.children.push( this._operator() );
        result.children.push( this._operator() );
        result.properties.imports = [ this._renames() ];
        result.properties.conditions = [];
        break;

      case 'dict':
        result.properties.name = this._identifier();
        result.children.push( this._operator() );
        break;

      case 'exchange':
        result.children.push( this._operator() );
        result.properties.concurrency = this._integer();
        result.properties.affinity = this._identifier();
        result.properties.ordered = this._expr();  //  true/false
        break;

      case 'flowtable':
        result.children.push( this._operator() );
        result.properties.encodings = ( 'keyword' == this._peek().type ) ? this._keyword() : 'none';
        break;

      case 'fraction':
        result.children.push( this._operator() );
        result.properties.concurrency = this._integer();
        result.properties.thread = this._integer();
        result.properties.clustering = this._identifiers();
        break;

      case 'groupjoin':
        result.class = 'join';
        result.children.push( this._operator() );
        result.children.push( this._operator() );
        result.properties.conditions = this._renames();
        result.properties.imports = [ this._renames() ];
        result.properties.measures = this._bindings();
        //  Turn the joins into conditions
        result.properties.conditions = conditions( result.properties.conditions, 'isnotdistinct' );
        break;

      case 'indextable':
        result.properties.reference = this._identifier();
        result.children.push( this._operator() );
        break;

      case 'indexjoin':
        result.class = 'join';
        result.children.push( this._operator() );
        result.children.push( this._operator() );
        result.properties.columns = this._identifiers();
        result.properties.imports = [ this._renames() ];
        result.properties.indexes = this._rename();
        break;

      case 'iejoin':
        result.class = 'join';
        result.children.push( this._operator() );
        result.children.push( this._operator() );
        result.properties.conditions = this._exprs();
        result.properties.imports = [ this._renames() ];
        result.properties.join = this._keyword();
        result.properties.concurrency = this._integer();
        break;

      case 'iterate':
        result.children.push( this._operator() );
        result.children.push( this._operator() );
        result.properties.reference = this._identifier();
        break;

      case 'join':
      case 'lookup':
        result.class = 'join';
        result.children.push( this._operator() );
        result.children.push( this._operator() );
        result.properties.conditions = this._renames();
        result.properties.imports = [ this._renames() ];
        result.properties.join = this._keyword();
        //  Turn the joins into conditions
        result.properties.conditions = conditions(
            result.properties.conditions,
            ( 'keyword' == this._peek().type ) ? this._keyword() : '='
        );
        break;

      case 'table':
      {
        result.class = 'table';
        const   qname = this._identifier();
        result.properties.schema = qname[0];
        result.name =
        result.properties.table = qname[1];
        break;
      }

      case 'order':
        result.children.push( this._operator() );
        result.properties.orderbys = this._sorts();
        break;

      case 'partition-restart':
        result.children.push( this._operator() );
        break;

      case 'partition-split':
        result.properties.partitionbys = [ this._identifier(), ];
        result.children.push( this._operator() );
        break;

      case 'pivot':
        result.children.push( this._operator() );
        result.properties.tags = this._tags();
        result.properties.groups = this._groups();
        break;

      case 'positionaljoin':
        while ( this._peek().value != ')' )
            result.children.push( this._operator() );
        break;

      case 'project':
        result.children.push( this._operator() );
        result.properties.expressions = this._bindings();
        break;

      case 'radix-sort':
        result.children.push( this._operator() );
        result.properties.orderbys = this._sorts();
        break;

      case 'remote':
        result.children.push( this._operator() );
        //  servers
        //  database
        break;

      case 'restrict':
      case 'scan':
        result.children.push( this._operator() );
        result.properties.restrictions = this._identifiers();
        break;

      case 'select':
        result.children.push( this._operator() );
        result.properties.conditions = [ this._expr() ];
        break;

      case 'shared':
        result.children.push( this._operator() );
        result.properties.reference = parseInt( this._string() );
        break;

      case 'text':
        result.properties.path = this._string();
        result.properties.schema = [];
        this._expect( '(' );
        while ( ')' != this._peek().value )
            result.properties.schema.push( this._properties() );
        this._expect( ')' );
        result.properties.config = this._properties();
        break;

      case 'transform':
      {
        this._expect( '(' );
        result.children.push( null );
        while ( ')' != this._peek().value ) {
            let transform = this._transform();
            transform.children.push( result.children[0] );
            result.children[0] = transform;
        }
        this._expect( ')' );
        result.properties.concurrency = this._integer();
        break;
      }

      case 'top':
        result.children.push( this._operator() );
        result.properties.orderbys = this._sorts();
        result.properties.top = this._integer();
        break;

      case 'update':
        result.children.push( this._operator() );
        result.properties.imports = [ this._renames() ];
        break;

      case 'window':
        result.children.push( this._operator() );
        result.properties.partitionbys = this._identifiers();
        result.properties.orderbys = this._sorts();
        result.properties.expressions = this._bindings();
        break;
    }

    this._expect( ')' );

    return result;
}

/*------------------------------------------------------------------------
  parse

  ---------------------------------------------------------------------------*/
Parser.prototype.parse = function()
{
    const result = [];

    while ( !this._done() )
        result.push( this._operator() )

    return result;
}

///////////////////////////////////////////////////////////////////////////

/*------------------------------------------------------------------------
  parse

  ---------------------------------------------------------------------------*/
module.exports.parse = function(

    text,
    pos = 0 )

{
    const parser = new Parser( module.exports.tokenise( text, pos ) );

    return parser.parse();
}

/*------------------------------------------------------------------------
  assignSymbols

  ---------------------------------------------------------------------------*/
function assignSymbols(

    root )

{
    common.visit( root,

        function( n ) {
            // Assign symbols
            if (n.properties && n.properties.join && n.class && n.class === "join")
                n.symbol = n.properties.join + "-join-symbol";

            else if ( n.class && "table" == n.class ) {
                if ( 'TEMP' === n.properties.schema )
                    n.symbol = "temp-table-symbol";
                else n.symbol = "table-symbol";
            }

            else if ( n.name && "remote" === n.name )
                n.symbol = "run-query-symbol";
        },

        function( d ) {
            return d.children && d.children.length > 0 ? d.children : null;
        }
    );
}

/*------------------------------------------------------------------------
  loadTQLPlan

  ---------------------------------------------------------------------------*/
module.exports.loadTQLPlan = function(

    text,
    collapse = 'n' )

{
    try {
        console.log( 'loadTQLPlan' );
        const   parser = new Parser( module.exports.tokenise( text ) );
        const   root = parser.parse()[0];

        assignSymbols( root );

        return { root: root, crosslinks: {}, properties: {}, };
    }

    catch ( e ) {
        console.log( e );
        return { error: "TQL parse failed with '" + e + "' at (" + e.start + ", " + e.end + ")." };
    }
}
