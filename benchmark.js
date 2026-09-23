/**
 * hashwheel -- throughput benchmark
 *
 * Copyright (C) 2014-2015,2021,2023 Andras Radics
 * Licensed under the Apache License, Version 2.0
 *
 * Measures add / get / remove throughput across a few ring sizes.
 * Run with:  node benchmark.js
 */

import ConsistentHash from './hashwheel.js'

var LOOKUPS = 1000000

function nowMs( ) {
    var t = process.hrtime()
    return t[0] * 1000 + t[1] / 1e6
}

function report( label, count, ms ) {
    console.log('  %s%s: %sms  %s ops/s',
        label,
        ' '.repeat(Math.max(1, 22 - label.length)),
        ms.toFixed(1),
        Math.round(count / ms * 1000).toLocaleString())
}

function bench( label, count, fn ) {
    // warm up the jit on a small slice so the timed loop reflects steady state
    for (var w = 0; w < Math.min(count, 10000); w++) fn(w)
    var start = nowMs()
    for (var i = 0; i < count; i++) fn(i)
    report(label, count, nowMs() - start)
}

function benchRing( nodeCount, ringRange ) {
    var i, start, ms
    var nodes = new Array(nodeCount)
    for (i = 0; i < nodeCount; i++) nodes[i] = 'node-' + i

    var hr = new ConsistentHash({ range: ringRange })

    console.log('\n%d nodes, range %d  (%d%% ring fill)',
        nodeCount, ringRange, Math.round(nodeCount * hr._weightDefault / ringRange * 100))

    start = nowMs()
    for (i = 0; i < nodeCount; i++) hr.add(nodes[i])
    report('add', nodeCount, nowMs() - start)

    // build the sorted control point array once, before timing the lookups
    hr.get('prime')

    bench('get', LOOKUPS, function(i) { hr.get('resource-' + i) })
    bench('get count=3', LOOKUPS, function(i) { hr.get('resource-' + i, 3) })

    start = nowMs()
    for (i = 0; i < nodeCount; i++) hr.remove(nodes[i])
    report('remove', nodeCount, nowMs() - start)
}

benchRing(100, 100003)
benchRing(1000, 100003)
benchRing(10000, 1000003)
