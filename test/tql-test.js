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
                ],
                properties: {
                    groupbys: [ [ 'cs_ship_date_sk', ], [ 'cs_sold_date_sk', ], ],
                    expressions: {
                        count: { class: 'function', op: 'total', args: [ { class: 'identifier', value: 'count' } ] },
                    },
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
                    affinity:    [ "" ],
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
                ],
                properties: {
                    concurrency: 4,
                    thread:     0,
                    clustering: [],
                },
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
               ],
                properties: {
                    join:       'inner',
                    concurrency: 4,
                    imports: [ { d_date_sk: "d_date_sk" }, ],
                    conditions: [
                        { class: 'function', op: '<=', args: [
                            { class: 'identifier', value: 'cs_sold_date_sk' },
                            { class: 'identifier', value: 'd_date_sk' },
                            ]
                        },
                        { class: 'function', op: '>=', args: [
                            { class: 'identifier', value: 'cs_ship_date_sk' },
                            { class: 'identifier', value: 'd_date_sk' },
                            ]
                        },
                   ],
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
                ],
                properties: {
                    orderbys: [ [ "d_date_sk", "asc", ], ],
                },
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
                ],
                properties: {
                    expressions: {
                        count: { class: 'function', op: 'abs', args: [ { class: 'identifier', value: 'count' } ] },
                    },
                },
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
                ],
                properties: {
                    restrictions: [ [ 'cs_ship_date_sk', ], [ 'cs_sold_date_sk', ], ],
                },
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
                ],
                properties: {
                    restrictions: [ [ 'cs_ship_date_sk', ], [ 'cs_sold_date_sk', ], ],
                },
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
});
