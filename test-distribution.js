/**
 * consistent-hash -- key distribution probe (dev tool)
 *
 * Copyright (C) 2015-2016,2021,2023 Andras Radics
 * Licensed under the Apache License, Version 2.0
 *
 * Run with:  node test-distribution.js
 * Prints how evenly a set of generated keys spreads across N nodes.
 */

import ConsistentHash from './consistenthash.js'

var NBINS = [4, 10, 100]

function distribute( data, nbins ) {
    var i, hr = new ConsistentHash()

    // add nbins nodes distributed uniformly around the ring
    // note: random control points will badly skew the distribution
    for (i=0; i<nbins; i++) hr.add(i)

    // create bins to count the number of times each node showed up
    var bins = new Array(nbins).fill(0)

    // hash the data to nodes, track distribution in the bins
    for (i=0; i<data.length; i++) bins[hr.get(data[i])] += 1

    return bins
}

function testDistribution( name, fn ) {
    var i, data = []
    for (i=0; i<10000; i++) data[i] = fn(i)

    console.log(name)
    for (var j=0; j<NBINS.length; j++) {
        var bins = distribute(data, NBINS[j])
        bins.sort(function(a, b) { return a - b })
        var empty = 0
        for (var k=0; k<bins.length; k++) if (!bins[k]) empty += 1
        empty = (empty / bins.length * 100) >>> 0
        console.log("  %d nodes  %d%% empty  min=%d max=%d",
            bins.length, empty, bins[0], bins[bins.length - 1])
    }
}

function strRepeat( s, n ) {
    var ret = ""
    for (var i=0; i<n; i++) ret += s
    return ret
}

testDistribution('numbers: random', function() { return Math.random() * 1000000 >>> 0 })
testDistribution('numbers: decimal', function(i) { return "" + i })
testDistribution('numbers: repeated', function(i) { return "" + i + i + i + i })
testDistribution('numbers: prefix', function(i) { return "12345678" + i })
testDistribution('numeric suffixes: a+i', function(i) { return 'a' + i })
testDistribution('numeric suffixes: long prefix', function(i) { return 'someLongishPrefix' + i })
testDistribution('numeric suffixes: repeated', function(i) { return 'someLongishPrefix' + i + i + i + i })
testDistribution('various length: single char', function(i) { return strRepeat(String.fromCharCode(0x65 + i%26), 1 + i/26) })
testDistribution('various length: repeated block', function(i) { return strRepeat('abcdefghij', 1 + i/20) })
testDistribution('random strings: short', function() { var x = (Math.random() * 100000).toString(36).replace(/[0-9]/, ''); return x })
testDistribution('random strings: long', function() { var x = (Math.random() * 100000).toString(36).replace(/[0-9]/, ''); return x + x + x + x })
