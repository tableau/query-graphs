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
  _field

  ---------------------------------------------------------------------------*/
Parser.prototype._field = function()
{
    const part = this._next();
    if ( 'identifier' != part.type )
        fail( 'Expected field but got "'+ part.value + '"', part );

    return { name: part.value.slice( 1, -1 ).replace( ']]', ']' ), class: 'field' };
}

/*------------------------------------------------------------------------
  _fields

  ---------------------------------------------------------------------------*/
Parser.prototype._fields = function(

    name = 'fields' )
{
    const   result = { name: name, class: 'fields', children: [] };

    this._expect( '(' );
    while ( ')' != this._peek().value )
        result.children.push( this._field() );
    this._expect( ')' );

    return result;
}

/*------------------------------------------------------------------------
  _tags

  ---------------------------------------------------------------------------*/
Parser.prototype._tags = function()
{
    this._expect( '(' );

    const   name = this._field().name;
    const   result = this._fields( name );

    this._expect( ')' );

    return result;
}

/*------------------------------------------------------------------------
  _groups

  ---------------------------------------------------------------------------*/
Parser.prototype._groups = function(

    name = 'groups' )
{
    const   result = { name: name, class: 'groups', children: [] };

    this._expect( '(' );

    while ( ')' != this._peek().value )
        result.children.push( this._tags() );

    this._expect( ')' );

    return result;
}

/*------------------------------------------------------------------------
  _identifier

  ---------------------------------------------------------------------------*/
Parser.prototype._identifier = function()
{
    //  Really an array of dot-separated values
    const   result = [];

    while ( true ) {
        const   field = this._field();

        result.push( field.name );
        if ( '.' != this._peek().value ) break;

        this._expect( '.' );
    }

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
    const name = this._next().value;

    const children = [];
    while ( this._peek().value != ')' )
       children.push( this._expr() );

    this._next( ')' );

    return { class: 'function', name: name, children: children };
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
        result = { class: 'field', name: token.value.slice( 1, -1 ).replace( ']]', ']' ) };
        break;

      case 'integer':
        result = { class: token.type, name: parseInt( token.value ) };
        break;

      case 'real':
        result = { class: token.type, name: parseFloat( token.value ) };
        break;

      case 'date':
        result = { class: token.type, name: token.value };
        break;

      case 'datetime':
        result = { class: token.type, name: token.value };
        break;

      case 'duration':
        result = { class: token.type, name: token.value };
        break;

      case 'string':
        result = { class: token.type, name: token.value.slice( 1, -1 ).replace( /""/g, '"' ) };
        break;

      case 'keyword':
        switch ( token.value ) {
          case 'true':
            result = { class: 'boolean', name: true };
            break;
          case 'false':
            result = { class: 'boolean', name: false };
            break;
          case 'null':
            result = { class: 'null', name: 'null' };
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
Parser.prototype._exprs = function(

    name = 'expressions' )
{
    const   result = { name: name, class: 'expressions', children: [] };

    this._expect( '(' );

    while ( ')' != this._peek().value )
        result.children.push( this._expr() );

    this._expect( ')' );

    return result;
}

/*------------------------------------------------------------------------
  _binding

  ---------------------------------------------------------------------------*/
Parser.prototype._binding = function()
{
    this._expect( '(' );

    const   name = this._field();
    const   expr = this._expr();

    this._expect( ')' );

    return { name: name.name, class: 'binding', children: [ expr ] };
}

/*------------------------------------------------------------------------
  _bindings

  ---------------------------------------------------------------------------*/
Parser.prototype._bindings = function(

    name = 'expressions' )
{
    const   result = { name: name, class: 'bindings', children: [] };

    this._expect( '(' );

    while ( ')' != this._peek().value )
        result.children.push( this._binding() );

    this._expect( ')' );

    return result;
}

/*------------------------------------------------------------------------
  _rename

  ---------------------------------------------------------------------------*/
Parser.prototype._rename = function()
{
    this._expect( '(' );

    const   inner = this._field();
    const   outer = this._field();

    this._expect( ')' );

    return { name: outer.name, source: inner.name, class: 'rename' };
}

/*------------------------------------------------------------------------
  _renames

  ---------------------------------------------------------------------------*/
Parser.prototype._renames = function(

    name = 'renames' )
{
    const   result = { name: name, class: 'renames', children: [], };

    this._expect( '(' );

    while ( ')' != this._peek().value )
        result.children.push( this._rename() );

    this._expect( ')' );

    return result;
}

/*------------------------------------------------------------------------
  _orderby

  ---------------------------------------------------------------------------*/
Parser.prototype._orderby = function()
{
    const   result = { class: 'orderby' };

    this._expect( '(' );

    result.name = this._field().name;
    result.sense = this._keyword();
    if ( 'field' === this._peek().type )
        result.rank = this._field().name;

    this._expect( ')' );

    return result;
}

/*------------------------------------------------------------------------
  _orderbys

  ---------------------------------------------------------------------------*/
Parser.prototype._orderbys = function(

    name = 'orderbys' )
{
    const   result = { name: name, class: 'orderbys', children: [] };

    this._expect( '(' );

    while ( ')' != this._peek().value )
        result.children.push( this._orderby() );

    this._expect( ')' );

    return result;
}

/*------------------------------------------------------------------------
  _property

  ---------------------------------------------------------------------------*/
Parser.prototype._property = function()
{
    this._expect( '(' );

    const   name = this._string();
    const   value = this._string();

    this._expect( ')' );

    const   result = {};
    result[ name ] = value;

    return result;
}

/*------------------------------------------------------------------------
  _properties

  ---------------------------------------------------------------------------*/
Parser.prototype._properties = function(

    name = 'properties' )
{
    const   result = { name: name, class: 'properties', properties: {} };

    this._expect( '(' );

    while ( ')' != this._peek().value )
        Object.assign( result.properties, this._property() );

    this._expect( ')' );

    return result;
}

/*------------------------------------------------------------------------
  _schema

  ---------------------------------------------------------------------------*/
Parser.prototype._schema = function(

    name = 'schema' )
{
    const   result = { name: name, class: 'schema', children: [] };

    this._expect( '(' );

    while ( ')' != this._peek().value ) {
        const   column = this._properties();
        column.name = column.properties.name;
        delete column.properties.name;
        result.children.push( column );
    }

    this._expect( ')' );

    return result;
}

/*------------------------------------------------------------------------
  conditions

  ---------------------------------------------------------------------------*/
function conditions(

    renames,
    op )

{
    const   children = renames.children.map( rename => {
        return {
            name: op,
            class: 'function',
            children: [
                { name: rename.name,   class: 'field' },
                { name: rename.source, class: 'field' },
            ]
        };
    });

    return { name: renames.name, children: children, class: 'expressions' };
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
        result.children.push( this._fields( 'groupbys' ) )
        result.children.push( this._bindings( 'measures' ) )
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
        result.children.push( this._renames( 'imports' ) );
        break;

      case 'database':
        result.class = 'command';
        result.children.push( { name: this._string(), class: 'string' } );
        break;

      case 'dict':
        result.properties.name = this._field().name;
        result.children.push( this._operator() );
        break;

      case 'exchange':
        result.children.push( this._operator() );
        result.properties.concurrency = this._integer();
        result.properties.affinity = this._field().name;
        result.properties.ordered = this._expr().name;  //  true/false
        break;

      case 'flowtable':
        result.children.push( this._operator() );
        result.properties.encodings = ( 'keyword' == this._peek().type ) ? this._keyword() : 'none';
        break;

      case 'fraction':
        result.children.push( this._operator() );
        result.properties.concurrency = this._integer();
        result.properties.thread = this._integer();
        result.children.push( this._fields( 'clustering' ) );
        break;

      case 'groupjoin':
        result.class = 'join';
        result.children.push( this._operator() );
        result.children.push( this._operator() );
        result.children.push( this._renames( 'conditions' ) );
        result.children.push( this._renames( 'imports' ) );
        result.children.push( this._bindings( 'measures' ) );
        //  Turn the joins into conditions
        result.children[2] = conditions( result.children[2], 'isnotdistinct' );
        break;

      case 'indextable':
        result.properties.name = this._field().name;
        result.children.push( this._operator() );
        break;

      case 'indexjoin':
        result.class = 'join';
        result.children.push( this._operator() );
        result.children.push( this._operator() );
        result.children.push( this._fields( 'restrictions' ) );
        result.children.push( this._renames( 'imports' ) );
        result.properties.index = this._rename();
        result.properties.join = 'inner';
        break;

      case 'iejoin':
        result.class = 'join';
        result.children.push( this._operator() );
        result.children.push( this._operator() );
        result.children.push( this._exprs( 'conditions' ) );
        result.children.push( this._renames( 'imports' ) );
        result.properties.join = this._keyword();
        result.properties.concurrency = this._integer();
        break;

      case 'iterate':
        result.children.push( this._operator() );
        result.children.push( this._operator() );
        result.properties.name = this._field().name;
        break;

      case 'join':
      case 'lookup':
        result.class = 'join';
        result.children.push( this._operator() );
        result.children.push( this._operator() );
        result.children.push( this._renames( 'conditions' ) );
        result.children.push( this._renames( 'imports' ) );
        result.properties.join = this._keyword();
        //  Turn the renames into conditions
        result.children[2] = conditions(
            result.children[2],
            ( 'keyword' == this._peek().type ) ? this._keyword() : '='
        );
        break;

      case 'order':
        result.children.push( this._operator() );
        result.children.push( this._orderbys() );
        break;

      case 'partition-restart':
        result.children.push( this._operator() );
        break;

      case 'partition-split':
        result.properties.name = this._field().name;
        result.children.push( this._operator() );
        break;

      case 'pivot':
        result.children.push( this._operator() );
        result.children.push( this._tags() );
        result.children.push( this._groups() );
        break;

      case 'positionaljoin':
        result.class = 'join';
        while ( this._peek().value != ')' )
            result.children.push( this._operator() );
        result.properties.join = 'inner';
        break;

      case 'project':
        result.children.push( this._operator() );
        result.children.push( this._bindings( 'expressions' ) );
        break;

      case 'radix-sort':
        result.children.push( this._operator() );
        result.children.push( this._orderbys() );
        break;

      case 'remote':
        result.class = 'remote';
        result.children.push( this._operator() );
        //  servers
        //  database
        break;

      case 'restrict':
      case 'scan':
        result.children.push( this._operator() );
        result.children.push( this._fields( 'restrictions' ) );
        break;

      case 'select':
        result.children.push( this._operator() );
        result.children.push( { name: 'predicate', class: 'expressions', children: [ this._expr(), ] }  );
        break;

      case 'shared':
        result.children.push( this._operator() );
        result.properties.reference = parseInt( this._string() );
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

      case 'text':
        result.class = 'table';
        result.name = this._string();

        if ( '(' !== this._peek().value ) break;
        result.children.push( this._schema() );

        if ( '(' !== this._peek().value ) break;
        result.properties = this._properties().properties;
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
        result.children.push( this._orderbys() );
        result.properties.top = this._integer();
        break;

      case 'update':
        result.children.push( this._operator() );
        result.children.push( this._renames( 'updates' ) );
        break;

      case 'window':
        result.children.push( this._operator() );
        result.children.push( this._fields( 'partitionbys' ) );
        result.children.push( this._orderbys() );
        result.children.push( this._bindings() );
        break;

      default:
        fail( 'Unknown operator: ' + result.name, token );
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
            switch ( n.class ) {
              case 'join':
                if ( n.properties && n.properties.join )
                    n.symbol = n.properties.join + "-join-symbol";
                break;

              case 'table':
                if ( 'TEMP' === n.properties.schema )
                    n.symbol = "temp-table-symbol";
                else n.symbol = "table-symbol";
                break;

              case 'remote':
                 n.symbol = "run-query-symbol";
                 break;

              case 'bindings':
              case 'expressions':
              case 'fields':
              case 'orderbys':
              case 'renames':
              case 'schema':
                n.children.forEach( c => { c.edgeClass = "link-and-arrow"; } );
                break;
            }
        },

        function( d ) {
            return d.children && d.children.length > 0 ? d.children : null;
        }
    );
}

/*------------------------------------------------------------------------
  collapseNodes

  ---------------------------------------------------------------------------*/
function collapseNodes(

    treeData,
    graphCollapse )

{
    if (graphCollapse === 'n') return;

    const streamline = ( "s" === graphCollapse ) ? common.streamline : common.collapseAllChildren;
        common.visit( treeData,

            function(d) {
                switch ( d.class ) {
                  case 'bindings':
                  case 'expressions':
                  case 'fields':
                  case 'orderbys':
                  case 'renames':
                  case 'schema':
                    streamline(d);
                    return;
                  default:
                    break;
                }
            },

            function(d) {
                return d.children && d.children.length > 0 ? d.children.slice(0) : null;
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
        const   parser = new Parser( module.exports.tokenise( text ) );
        const   root = { name: 'plans', class: 'forest', children: parser.parse() };

        assignSymbols( root );
        common.createParentLinks( root );
        collapseNodes( root, collapse );

        return { root: root, crosslinks: {}, properties: {}, };
    }

    catch ( e ) {
        console.log( e );
        return { error: "TQL parse failed with '" + e + "' at (" + e.start + ", " + e.end + ")." };
    }
}
