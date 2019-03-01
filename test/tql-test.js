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
// test/tql-test.js
// -----------------------------------------------------------------------------

var chai = require('chai');
var expect = chai.expect;

var TQL = require('./../d3/tql')

///////////////////////////////////////////////////////////////////////////

describe('TQL parsing', function() {
    it('should parse aggregate', function() {
        const   setup =
            '(aggregate ' +
            '  (table [tpcds].[catalog_sales]) ' +
            '  ( [cs_ship_date_sk] [cs_sold_date_sk] ) ' +
            '  ( ( [count] (total [count] ) ) ) )';

        const   expected = [
            {
                name:   'aggregate',
                class:  'reference',
                children: [
                    {
                        name:   'catalog_sales',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'catalog_sales',
                        },
                    },
                    {
                        name:   'groupbys',
                        class:  'fields',
                        children: [
                            { name: 'cs_ship_date_sk', class: 'field' },
                            { name: 'cs_sold_date_sk', class: 'field' },
                        ],
                    },
                    {
                        name:   'measures',
                        class:  'bindings',
                        children: [
                            {
                                name: 'count',
                                class: 'binding',
                                children: [ { class: 'function', name: 'total', children: [ { class: 'field', name: 'count' } ] } ],
                            },
                        ],
                    },
                ],
                properties: {},
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse cartprod', function() {
        const   setup =
            '(cartprod ' +
            '  (table [tpcds].[catalog_sales]) ' +
            '  (table [tpcds].[date_dim]) ' +
            '  ( ([d_date_sk] [d_date_sk]) ) ' +
            '  ) '
            ;

        const   expected = [
            {
                name:   'cartprod',
                class:  'join',
                children: [
                    {
                        name:   'catalog_sales',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'catalog_sales',
                        },
                    },
                    {
                        name:   'date_dim',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'date_dim',
                        },
                    },
                    {
                        name:   'imports',
                        class:  'renames',
                        children: [
                            { name: 'd_date_sk', class: 'rename', source: 'd_date_sk', },
                        ],
                    },
                ],
                properties: {},
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse dict', function() {
        const   setup = '(dict [d_date_sk] (table [tpcds].[date_dim]) )';

        const   expected = [
            {
                name:   'dict',
                class:  'reference',
                children: [
                    {
                        name:   'date_dim',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'date_dim',
                        },
                    },
                ],
                properties: {
                    name: 'd_date_sk',
                },
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse exchange', function() {
        const   setup = '(exchange (table [tpcds].[catalog_sales]) 4 [] false )';
        const   expected = [
            {
                name:   'exchange',
                class:  'reference',
                children: [
                    {
                        name:   'catalog_sales',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'catalog_sales',
                        },
                    },
                ],
                properties: {
                    concurrency: 4,
                    ordered:     false,
                    affinity:    "",
                },
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse flowtable', function() {
        const   setup = '(flowtable (table [tpcds].[catalog_sales]) none )';
        const   expected = [
            {
                name:   'flowtable',
                class:  'reference',
                children: [
                    {
                        name:   'catalog_sales',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'catalog_sales',
                        },
                    },
                ],
                properties: {
                    encodings: "none",
                },
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse fraction', function() {
        const   setup = '(fraction (table [tpcds].[catalog_sales]) 4 0 () )';
        const   expected = [
            {
                name:   'fraction',
                class:  'reference',
                children: [
                    {
                        name:   'catalog_sales',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'catalog_sales',
                        },
                    },
                    {
                        name:       'clustering',
                        class:      'fields',
                        children:   [],
                    },
                ],
                properties: {
                    concurrency: 4,
                    thread:     0,
                },
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse groupjoin', function() {
        const   setup =
            '(groupjoin ' +
            '  (table [tpcds].[catalog_sales]) ' +
            '  (table [tpcds].[date_dim]) ' +
            '  ( ( [cs_ship_date_sk] [d_date_sk] ) ) ' +
            '  ( ( [sum] [sum] ) ) ' +
            '  ( ( [sum] (total [d_date_sk] ) ) ) )';

        const   expected = [
            {
                name:   'groupjoin',
                class:  'join',
                children: [
                    {
                        name:   'catalog_sales',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'catalog_sales',
                        },
                    },
                    {
                        name:   'date_dim',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'date_dim',
                        },
                    },
                    {
                        name:   'conditions',
                        class:  'expressions',
                        children: [
                            { class: 'function', name: 'isnotdistinct', children: [
                                { name: 'd_date_sk', class: 'field',  },
                                { name: 'cs_ship_date_sk', class: 'field',  },
                                ]
                            },
                        ],
                    },
                    {
                        name:   'imports',
                        class:  'renames',
                        children: [
                            { name: 'sum', class: 'rename', source: 'sum' },
                        ],
                    },
                    {
                        name:   'measures',
                        class:  'bindings',
                        children: [
                            {
                                name: 'sum',
                                class: 'binding',
                                children: [ { class: 'function', name: 'total', children: [ { class: 'field', name: 'd_date_sk' } ] } ],
                            },
                        ],
                    },
                ],
                properties: {},
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse iejoin', function() {
        const   setup =
            '(iejoin ' +
            '  (table [tpcds].[catalog_sales]) ' +
            '  (table [tpcds].[date_dim]) ' +
            '  ( ( <= [cs_sold_date_sk] [d_date_sk] ) ( >= [cs_ship_date_sk] [d_date_sk] ) ) ' +
            '  ( ([d_date_sk] [d_date_sk]) ) ' +
            '  inner 4 ) '
            ;

        const   expected = [
            {
                name:   'iejoin',
                class:  'join',
                children: [
                    {
                        name:   'catalog_sales',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'catalog_sales',
                        },
                    },
                    {
                        name:   'date_dim',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'date_dim',
                        },
                    },
                    {
                        name:   'conditions',
                        class:  'expressions',
                        children: [
                            { class: 'function', name: '<=', children: [
                                { class: 'field', name: 'cs_sold_date_sk' },
                                { class: 'field', name: 'd_date_sk' },
                                ]
                            },
                            { class: 'function', name: '>=', children: [
                                { class: 'field', name: 'cs_ship_date_sk' },
                                { class: 'field', name: 'd_date_sk' },
                                ]
                            },
                        ],
                    },
                    {
                        name:   'imports',
                        class:  'renames',
                        children: [
                            { name: 'd_date_sk', class: 'rename', source: 'd_date_sk', },
                        ],
                    },
                ],
                properties: {
                    join:       'inner',
                    concurrency: 4,
                },
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse indextable', function() {
        const   setup = '(indextable [d_date_sk] (table [tpcds].[date_dim]) )';

        const   expected = [
            {
                name:   'indextable',
                class:  'reference',
                children: [
                    {
                        name:   'date_dim',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'date_dim',
                        },
                    },
                ],
                properties: {
                    name: 'd_date_sk',
                },
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse indexjoin', function() {
        const   setup =
            '(indexjoin ' +
            '  (table [tpcds].[catalog_sales]) ' +
            '  (indextable [cs_sold_date_sk] (table [tpcds].[catalog_sales]) ) ' +
            '  ( [cs_ship_date_sk] [cs_sold_date_sk] ) ' +
            '  ( ([cs_sold_date_sk] [cs_sold_date_sk]) ) ' +
            '  ( [.RANK] [.COUNT]) ) '
            ;

        const   expected = [
            {
                name:   'indexjoin',
                class:  'join',
                children: [
                    {
                        name:   'catalog_sales',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'catalog_sales',
                        },
                    },
                    {
                        name:   'indextable',
                        class:  'reference',
                        children: [
                            {
                                name:   'catalog_sales',
                                class:  'table',
                                children: [],
                                properties: {
                                    schema: 'tpcds',
                                    table: 'catalog_sales',
                                },
                            }
                        ],
                        properties: {
                            name: 'cs_sold_date_sk',
                        },
                    },
                    {
                        name:   'restrictions',
                        class:  'fields',
                        children: [
                            { class: 'field', name: 'cs_ship_date_sk' },
                            { class: 'field', name: 'cs_sold_date_sk' },
                        ],
                    },
                    {
                        name:   'imports',
                        class:  'renames',
                        children: [
                            { name: 'cs_sold_date_sk', class: 'rename', source: 'cs_sold_date_sk', },
                        ],
                    },
                ],
                properties: {
                    index:  { name: ".COUNT", source: ".RANK", class: 'rename', },
                    join:   'inner',
                },
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse iterate', function() {
        const   setup =
            '(iterate ' +
            '  (table [tpcds].[catalog_sales]) ' +
            '  (table [tpcds].[date_dim]) ' +
            '  [Iterate] ) '
            ;

        const   expected = [
            {
                name:   'iterate',
                class:  'reference',
                children: [
                    {
                        name:   'catalog_sales',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'catalog_sales',
                        },
                    },
                    {
                        name:   'date_dim',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'date_dim',
                        },
                    },
                ],
                properties: {
                    name:  "Iterate",
                },
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse join', function() {
        const   setup =
            '(join ' +
            '  (table [tpcds].[catalog_sales]) ' +
            '  (table [tpcds].[date_dim]) ' +
            '  ( ( [cs_sold_date_sk] [d_date_sk] ) ) ' +
            '  ( ([d_date_sk] [d_date_sk]) ) ' +
            '  left ) '
            ;

        const   expected = [
            {
                name:   'join',
                class:  'join',
                children: [
                    {
                        name:   'catalog_sales',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'catalog_sales',
                        },
                    },
                    {
                        name:   'date_dim',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'date_dim',
                        },
                    },
                    {
                        name:   'conditions',
                        class:  'expressions',
                        children: [
                            { class: 'function', name: '=', children: [
                                { class: 'field', name: 'd_date_sk' },
                                { class: 'field', name: 'cs_sold_date_sk' },
                                ]
                            },
                        ],
                    },
                    {
                        name:   'imports',
                        class:  'renames',
                        children: [
                            { name: 'd_date_sk', class: 'rename', source: 'd_date_sk', },
                        ],
                    },
                ],
                properties: {
                    join:       'left',
                },
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse order', function() {
        const   setup = '(order (table [tpcds].[date_dim]) ( ( [d_date_sk] asc ) ) )';
        const   expected = [
            {
                name:   'order',
                class:  'reference',
                children: [
                    {
                        name:   'date_dim',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'date_dim',
                        },
                    },
                    {
                        name:   'orderbys',
                        class:  'orderbys',
                        children: [
                            {
                                name:   "d_date_sk",
                                class:  'orderby',
                                sense:  'asc',
                            },
                        ],
                    },
                ],
                properties: {},
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse partition-restart', function() {
        const   setup = '(partition-restart (table [tpcds].[date_dim]) )';
        const   expected = [
            {
                name:   'partition-restart',
                class:  'reference',
                children: [
                    {
                        name:   'date_dim',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'date_dim',
                        },
                    },
                ],
                properties: {},
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse partition-split', function() {
        const   setup = '(partition-split [d_date_sk] (table [tpcds].[date_dim]) )';
        const   expected = [
            {
                name:   'partition-split',
                class:  'reference',
                children: [
                    {
                        name:   'date_dim',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'date_dim',
                        },
                    },
                ],
                properties: {
                    name: 'd_date_sk',
                },
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse pivot', function() {
        const   setup =
            '(pivot (table [TestV1].[Calcs] ) ' +
            ' ( [index] ( [0] [1] [2] [3] ) ) ' +
            ' ( ( [bool] ( [bool0] [bool1] [bool2] [bool3] ) ) ' +
            '   ( [int]  ( [int0]  [int1]  [int2]  [int3]  ) ) ' +
            '   ( [num]  ( [num0]  [num1]  [num2]  [num3]  ) ) ' +
            '   ( [str]  ( [str0]  [str1]  [str2]  [str3]  ) ) ) )';
        const   expected = [
            {
                name:   'pivot',
                class:  'reference',
                children: [
                    {
                        name:   'Calcs',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'TestV1',
                            table: 'Calcs',
                        },
                    },
                    {
                        name:   'index',
                        class:  'fields',
                        children: [
                            { name: '0', class: 'field', },
                            { name: '1', class: 'field', },
                            { name: '2', class: 'field', },
                            { name: '3', class: 'field', },
                        ],
                    },
                    {
                        name:   'groups',
                        class:  'groups',
                        children: [
                            {
                                name:   'bool',
                                class:  'fields',
                                children: [
                                    { name: 'bool0', class: 'field', },
                                    { name: 'bool1', class: 'field', },
                                    { name: 'bool2', class: 'field', },
                                    { name: 'bool3', class: 'field', },
                                ],
                            },
                            {
                                name:   'int',
                                class:  'fields',
                                children: [
                                    { name: 'int0', class: 'field', },
                                    { name: 'int1', class: 'field', },
                                    { name: 'int2', class: 'field', },
                                    { name: 'int3', class: 'field', },
                                ],
                            },
                            {
                                name:   'num',
                                class:  'fields',
                                children: [
                                    { name: 'num0', class: 'field', },
                                    { name: 'num1', class: 'field', },
                                    { name: 'num2', class: 'field', },
                                    { name: 'num3', class: 'field', },
                                ],
                            },
                            {
                                name:   'str',
                                class:  'fields',
                                children: [
                                    { name: 'str0', class: 'field', },
                                    { name: 'str1', class: 'field', },
                                    { name: 'str2', class: 'field', },
                                    { name: 'str3', class: 'field', },
                                ],
                            },
                        ],
                    },
                ],
                properties: {},
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse positionaljoin', function() {
        const   setup =
            '(positionaljoin ' +
            '  (table [tpcds].[catalog_sales]) ' +
            '  (table [tpcds].[date_dim]) )'
            ;

        const   expected = [
            {
                name:   'positionaljoin',
                class:  'join',
                children: [
                    {
                        name:   'catalog_sales',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'catalog_sales',
                        },
                    },
                    {
                        name:   'date_dim',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'date_dim',
                        },
                    },
                ],
                properties: { join: 'inner' },
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse project', function() {
        const   setup =
            '(project ' +
            '  (table [tpcds].[catalog_sales]) ' +
            '  ( ( [count] (abs [count] ) ) ) )';

        const   expected = [
            {
                name:   'project',
                class:  'reference',
                children: [
                    {
                        name:   'catalog_sales',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'catalog_sales',
                        },
                    },
                    {
                        name:   'expressions',
                        class:  'bindings',
                        children: [
                            {
                                name:   'count',
                                class:  'binding',
                                children: [
                                    { name: 'abs', class: 'function',  children: [ { class: 'field', name: 'count' } ] },
                                ],
                            },
                        ],
                    },
                ],
                properties: {},
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse radix-sort', function() {
        const   setup = '(radix-sort (table [tpcds].[date_dim]) ( ( [d_date_sk] asc ) ) )';
        const   expected = [
            {
                name:   'radix-sort',
                class:  'reference',
                children: [
                    {
                        name:   'date_dim',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'date_dim',
                        },
                    },
                    {
                        name:   'orderbys',
                        class:  'orderbys',
                        children: [
                            {
                                name:   "d_date_sk",
                                class:  'orderby',
                                sense:  'asc',
                            },
                        ],
                    },
                ],
                properties: {},
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse restrict', function() {
        const   setup = '(restrict (table [tpcds].[catalog_sales]) ( [cs_ship_date_sk] [cs_sold_date_sk] ) )';
        const   expected = [
            {
                name:   'restrict',
                class:  'reference',
                children: [
                    {
                        name:   'catalog_sales',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'catalog_sales',
                        },
                    },
                    {
                        name:   'restrictions',
                        class:  'fields',
                        children: [
                            { name: 'cs_ship_date_sk', class: 'field', },
                            { name: 'cs_sold_date_sk', class: 'field', },
                        ],
                    },
                ],
                properties: {},
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse scan', function() {
        const   setup = '(scan (table [tpcds].[catalog_sales]) ( [cs_ship_date_sk] [cs_sold_date_sk] ) )';
        const   expected = [
            {
                name:   'scan',
                class:  'reference',
                children: [
                    {
                        name:   'catalog_sales',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'catalog_sales',
                        },
                    },
                    {
                        name:   'restrictions',
                        class:  'fields',
                        children: [
                            { name: 'cs_ship_date_sk', class: 'field', },
                            { name: 'cs_sold_date_sk', class: 'field', },
                        ],
                    },
                ],
                properties: {},
           },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse select', function() {
        const   setup = '(select (table [tpcds].[date_dim]) (>= [d_date_sk] 2450815 ) )';
        const   expected = [
            {
                name:   'select',
                class:  'reference',
                children: [
                    {
                        name:   'date_dim',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'date_dim',
                        },
                    },
                    {
                        name:   'predicate',
                        class:  'expressions',
                        children: [
                            {
                                name:   ">=",
                                class:  'function',
                                children: [
                                    { name: 'd_date_sk', class: 'field' },
                                    { name: 2450815,     class: 'integer' },
                                ],
                            },
                        ],
                    },
                ],
                properties: {},
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse shared', function() {
        const   setup = '(shared (table [tpcds].[catalog_sales]) "0")';
        const   expected = [
            {
                name:   'shared',
                class:  'reference',
                children: [
                    {
                        name:   'catalog_sales',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'catalog_sales',
                        },
                    },
                ],
                properties: {
                    reference: 0,
                },
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse table', function() {
        const   setup = '(table [tpcds].[catalog_sales])';
        const   expected = [
            {
                name:   'catalog_sales',
                class:  'table',
                children: [],
                properties: {
                    schema: 'tpcds',
                    table: 'catalog_sales',
                },
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse text', function() {
        const   setup =
            '(text "DebugBlackBox/tpcds/cs_date_sk.csv" ( ' +
            '  ( ( "name" "cs_sold_date_sk" ) ( "factory" "builtin" ) ("builtin" "long" ) ) ' +
            '  ( ( "name" "cs_ship_date_sk" ) ( "factory" "builtin" ) ("builtin" "long" ) ) ) ' +
            '  ( ( "field-separator" "|" ) ( "header-row" "false" ) ) )';
        const   expected = [
            {
                name:   'DebugBlackBox/tpcds/cs_date_sk.csv',
                class:  'table',
                children: [
                    {
                        name:  'schema',
                        class: 'schema',
                        children: [
                            { name: 'cs_sold_date_sk', class: 'properties', properties: { factory: 'builtin', builtin: 'long' } },
                            { name: 'cs_ship_date_sk', class: 'properties', properties: { factory: 'builtin', builtin: 'long' } },
                        ],
                    },
                ],
                properties: {
                    'field-separator': '|',
                    'header-row': 'false',
                },
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse top', function() {
        const   setup = '(top (table [tpcds].[date_dim]) ( ( [d_date_sk] asc ) ) 10 )';
        const   expected = [
            {
                name:   'top',
                class:  'reference',
                children: [
                    {
                        name:   'date_dim',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'date_dim',
                        },
                    },
                    {
                        name:   'orderbys',
                        class:  'orderbys',
                        children: [
                            {
                                name:   "d_date_sk",
                                class:  'orderby',
                                sense:  'asc',
                            },
                        ],
                    },
                ],
                properties: {
                    top: 10,
                },
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse update', function() {
        const   setup =
            '(update ' +
            '  (table [tpcds].[catalog_sales]) ' +
            '  ( ([cs_ship_date_sk] [cs_sold_date_sk]) ) ' +
            '  ) '
            ;

        const   expected = [
            {
                name:   'update',
                class:  'reference',
                children: [
                    {
                        name:   'catalog_sales',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'catalog_sales',
                        },
                    },
                    {
                        name:   'updates',
                        class:  'renames',
                        children: [
                            { name: 'cs_sold_date_sk', class: 'rename', source: 'cs_ship_date_sk', },
                        ],
                    },
                ],
                properties: {},
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });

    it('should parse window', function() {
        const   setup =
            '(window ' +
            '  (table [tpcds].[catalog_sales]) ' +
            '  ( [cs_ship_date_sk] ) ' +
            '  ( ( [cs_sold_date_sk] asc ) ) ' +
            '  ( ([Length] (rowno) ) ) ) '
            ;

        const   expected = [
            {
                name:   'window',
                class:  'reference',
                children: [
                    {
                        name:   'catalog_sales',
                        class:  'table',
                        children: [],
                        properties: {
                            schema: 'tpcds',
                            table: 'catalog_sales',
                        },
                    },
                    {
                        name:   'partitionbys',
                        class:  'fields',
                        children: [
                            { name: 'cs_ship_date_sk', class: 'field' },
                        ],
                    },
                    {
                        name:   'orderbys',
                        class:  'orderbys',
                        children: [
                            { name: 'cs_sold_date_sk', class: 'orderby', sense: 'asc' },
                        ],
                    },
                    {
                        name:   'expressions',
                        class:  'bindings',
                        children: [
                            {
                                name: 'Length',
                                class: 'binding',
                                children: [ { class: 'function', name: 'rowno', children: [] } ],
                            },
                        ],
                    },
                ],
                properties: {},
            },
        ];

        const   actual = TQL.parse( setup );
        expect( actual ).to.deep.equal( expected );
    });
});
