/**
 * Copyright (C) 2015-2016,2021,2023 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */

import { describe, it, before, beforeEach } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import ConsistentHash from './hashwheel.js'

// format numbers in base 26 with digits 'a' .. 'z'
function numBase26(n) {
    var d, ret = ""
    while (n > 0) {
        d = n % 26
        ret = String.fromCharCode(0x61 + d) + ret
        n = (n / 26) >>> 0
    }
    return ret
}

// assert that haystack contains every key/value pair of needle (qnit t.contains equivalent)
function contains(haystack, needle) {
    for (var key of Object.keys(needle)) {
        assert.ok(key in haystack && haystack[key] === needle[key], 'expected map to contain ' + key)
    }
}

var cut = null

beforeEach(function() {
    cut = new ConsistentHash()
})

describe('package', function() {
    it('should be valid json', function() {
        var json = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
        assert.ok(json)
    })

    it('should export the class', async function() {
        var index = await import('./hashwheel.js')
        assert.equal(index.default, ConsistentHash)
    })
})

describe('class', function() {
    it('constructor should add initial points', function() {
        var hr = new ConsistentHash({ nodes: ['a', 'b', 'c', 'd'] })
        hr.add('e')
        assert.deepEqual(hr.getNodes(), ['a', 'b', 'c', 'd', 'e'])
    })

    it('add should associate control points with the node', function() {
        cut.add("a")
        assert.ok(cut._nodeKeys[0].length > 0)
    })

    it('add should add n control points', function() {
        cut.add("a", 7)
        assert.equal(cut._nodeKeys[0].length, 7)
    })

    it('repeated adds should add more control points', function() {
        cut.add("a")
        cut.add("a", 7)
        cut.get("x")
        assert.equal(cut._keys.length, cut._weightDefault + 7)
    })

    it('add should clear _keys', function() {
        cut.add("a")
        assert.ok(!cut._keys)
    })

    it('add should create n control points', function() {
        cut.add('a')
        cut.add('b', 4)
        cut.get('foo')
        assert.equal(cut.getPoints('a').length, cut._weightDefault)
        assert.equal(cut.getPoints('b').length, 4)
    })

    it('add should create n uniformly distributed control points', function() {
        var hr = new ConsistentHash({ distribution: 'uniform' })
        hr.add('a')
        hr.add('b', 4)
        hr.get('foo')
        assert.equal(hr.getPoints('a').length, hr._weightDefault)
        // uniform distribution ignores the requested weight, and uses the default
        assert.equal(hr.getPoints('b').length, hr._weightDefault)
    })

    it('get should build _keys array', function() {
        cut.add("a")
        cut.get("a")
        assert.ok(Array.isArray(cut._keys))
    })

    it('get should return a node', function() {
        cut.add("n1")
        var node = cut.get(0)
        assert.equal(node, "n1")
    })

    it('get should return a specific node for each string', function() {
        cut.add("a")
        cut.add("b")
        var node1 = cut.get("abc")
        var node2 = cut.get("abc")
        assert.equal(node1, node2)
    })

    it('get should return the same node when node is added after', function() {
        cut.add("C", 1, [0x43])
        var node1 = cut.get("A")
        cut.add("F", 1, [0x46])
        var node2 = cut.get("A")
        assert.ok(node1 == node2)
    })

    it('get should return new node when node is added before', function() {
        cut.add("F", 1, [0x46])
        var node1 = cut.get("A")
        cut.add("C", 1, [0x43])
        var node2 = cut.get("A")
        assert.ok(node1 != node2)
    })

    it('get should return the same node after deleting node after', function() {
        cut.add("C", 1, [0x43])
        cut.add("F", 1, [0x46])
        var node1 = cut.get("A")
        cut.remove("F")
        var node2 = cut.get("A")
        assert.ok(node1 == node2)
    })

    it('get should reassign resource after removing node', function() {
        cut.add("C", 1, [0x43])
        cut.add("F", 1, [0x46])
        var node1 = cut.get("A")
        cut.remove("C")
        var node2 = cut.get("A")
        assert.ok(node1 != node2)
    })

    it('get should distribute items among nodes fairly uniformly', function() {
        var i, j, points = new Array(10)
        for (i=0; i<points.length; i++) {
            points[i] = i * cut._range / points.length
        }
        var node, nbins = points.length, bins = new Array(nbins)
        for (i=0; i<nbins; i++) bins[i] = 0
        for (i=0; i<nbins; i++) cut.add('' + i, 1, [points[i]])
        for (i=0; i<10000; i++) {
            // note: base 10 numbers in ascii are not very uniform, and can skew the distribution
            // base 26 number expressed with with letters a-z work, as do base-32 numbers 0-9a-v
            node = cut.get('a' + i)
            bins[node] += 1
        }
        for (i=0; i<nbins; i++) {
            for (j=0; j<nbins; j++) {
                if (i === j) continue
                assert.ok(bins[i] * 10 > bins[j])
                assert.ok(bins[j] * 10 > bins[i])
            }
        }
    })

    it('get should return count distinct nodes', function() {
        cut.add("a", 1, [10])
        cut.add("b", 1, [7, 20, 30])
        cut._absearch = function() { return 2 }
        assert.deepEqual(cut.get("test", 3), ["b", "a"])

        cut.add("c", 1, [15])
        assert.deepEqual(cut.get("test", 3), ["c", "b", "a"])
    })

    it('remove should unmap the node', function() {
        cut.add("a")
        assert.ok(cut._nodeKeys[0])
        cut.remove("a")
        assert.ok(!cut._nodeKeys[0])
    })

    it('remove should clear the _keys array', function() {
        cut.add("a")
        cut.get("a")
        cut.remove("a")
        assert.ok(!cut._nodeKeys[0])
        assert.ok(!cut.get("a"))
    })

    it('remove should be idempotent', function() {
        cut.add('node-a')
        cut.add('node-a')
        cut.add('node-b')
        cut.get('resourceName')
        for (var i = 0; i < 2; i++) {
            cut.remove('node-a')
            assert.equal(cut._nodes.length, 1)
            assert.equal(cut._nodes[0], 'node-b')
        }
    })

    it('getNodes should return the nodes', function() {
        cut.add('a')
        cut.add('b')
        cut.add('a')
        assert.deepEqual(cut.getNodes(), ['a', 'b', 'a'])
    })

    it('getPoints should return the control points of the node', function() {
        var hr = new ConsistentHash({ distribution: 'uniform' })
        hr.add('a')
        assert.ok(!hr._keyMap['a'])
        assert.equal(hr.getPoints('a').length, hr._weightDefault)
        assert.equal(hr._keyMap[hr.getPoints('a')[0]], 'a')
        assert.strictEqual(hr.getPoints('nonesuch'), undefined)
    })

    it('two uniform-distribution hash rings with same node order should return same mappings', function() {
        var hr1 = new ConsistentHash({ distribution: 'uniform' })
        var hr2 = new ConsistentHash({ distribution: 'uniform' })
        for (var i = 0; i < 10; i++) hr1.add('node-' + i)
        for (var i = 0; i < 10; i++) hr2.add('node-' + i)
        assert.equal(hr1.get('foo'), hr2.get('foo'))
    })

    it('multiple uniform-distribution hash rings should return the same node', function() {
        var first
        var ring = ['aaaa', 'bbbb', 'cccc']
        for (var i = 0; i < 100; i++) {
            var hr = new ConsistentHash({ distribution: 'uniform' })
            for (var n = 0; n < ring.length; n++) hr.add(ring[n])
            first = first || hr.get('123123123')
            assert.strictEqual(hr.get('123123123'), first)
        }
        assert.ok(first)
    })

    describe('edge cases', function() {
        it('throws if unable to make control points', function() {
            var uut = new ConsistentHash({ range: 10 })
            assert.throws(function() { uut.add('node1', 11) }, /unable to .* control point/)
        })

        it('get returns null if no nodes', function() {
            var uut = new ConsistentHash()
            assert.strictEqual(uut.get('foo'), null)
        })

        it('get with count returns null if no nodes', function() {
            var uut = new ConsistentHash()
            assert.strictEqual(uut.get('foo', 3), null)
        })
    })
})

describe('_hash', function() {
    it('should compute different hashes for similar strings', function() {
        var h1 = cut._hash("a1")
        var h2 = cut._hash("b1")
        assert.ok(h1 != h2)
    })

    it('should distribute hashes fairly uniformly', function() {
        // note: 16 bins sync up with ascii [0-9] suffix and break distribution
        var h, i, bins = []
        for (i=0; i<20; i++) bins[i] = 0
        for (i=0; i<10000; i++) {
            // non-uniform input eg /a[0-9]+/ is a better test
            h = cut._hash('a' + i + i + i + i)
            // note: be sure to mod with a relative prime, else will not be uniform
            bins[h % bins.length] += 1
        }
        bins.sort(function(a,b){ return a - b })
        // hash distribution should be within 2x across all bins
        assert.ok(bins[0] * 2 >= bins[bins.length - 1])
    })
})

describe('_absearch', function() {
    it('should return -1 on empty array', function() {
        assert.equal(cut._absearch([], 1), -1)
    })

    it('should return 0 if smaller than first in array', function() {
        assert.equal(cut._absearch([10, 20], 9), 0)
    })

    it('should return 0 if larger than last in array', function() {
        assert.equal(cut._absearch([10, 20], 21), 0)
    })

    it('should return index of smallest value not less than n', function() {
        assert.equal(cut._absearch([10, 20], 9), 0)
        assert.equal(cut._absearch([10, 20], 10), 0)
        assert.equal(cut._absearch([10, 20], 11), 1)
        assert.equal(cut._absearch([10, 20], 19), 1)
        assert.equal(cut._absearch([10, 20], 20), 1)
    })
})

describe('_buildKeys', function() {
    it('should assemble sorted array of the node control points', function() {
        cut._nodeKeys = [
            [ 20, 10, 30 ],
            [ 11, 21, 31 ],
            [ 12, 32, 22 ],
        ]
        cut._buildKeys()
        assert.deepEqual(cut._keys, [10, 11, 12, 20, 21, 22, 30, 31, 32])
    })
})

describe('_buildKeyMap', function() {
    it('should distribute points uniformly', function() {
        var uut = new ConsistentHash({ range: 24, weight: 4, distribution: 'uniform' })
        uut.add('node1')
        uut.add('node2')
        uut.add('node3')
        uut.get('foo')
        assert.deepEqual(uut._nodes, ['node1', 'node2', 'node3'])
        assert.deepEqual(uut._nodeKeys, [[1, 7, 13, 19], [3, 9, 15, 21], [5, 11, 17, 23]])
        assert.deepEqual(uut._keys, [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23])
    })

    it('should distribute lookups uniformly', { skip: 'not implemented' }, function() {
        var uut = new ConsistentHash({ distribution: 'uniform' })
        uut.add('node1')
        uut.add('node2')
        uut.add('node3')
        uut.get('foo')
    })

    it('should rebuild map after remove', function() {
        var uut = new ConsistentHash({ range: 24, weight: 4, distribution: 'uniform' })
        uut.add('node1')
        uut.add('node2')
        uut.add('node3')
        uut.get('foo')
        assert.equal(Object.keys(uut._keyMap).length, 12, '3-node map has 12 keys')
        var map1 = uut._keyMap
        uut.remove('node2')
        // the _keyMap should be updated with node2 gone
        for (var point in uut._keyMap) {
            var node = uut._keyMap[point]
            assert.ok(node === 'node1' || node === 'node3' || node === undefined)
        }
        // rebuild the points map from scratch, then map should completely omit node2
        uut._needKeyMap = true
        uut.get('foo')
        assert.equal(Object.keys(uut._keyMap).length, 8, 'rebuilt map has 8 keys')
        contains(map1, uut._keyMap)
        for (var k in uut._keyMap) assert.notEqual(uut._keyMap[k], 'node2', 'node2 was deleted')
    })

    it('should assign uniformly distributed points in node-add order', function() {
        var hr = new ConsistentHash({ distribution: 'uniform', weight: 100 })
        hr.add('a')
        hr.add('b')
        hr.get('foo')
        assert.deepEqual(hr.getNodes(), ['a', 'b'])

        // points assigned in node order
        assert.ok(hr.getPoints('a')[0] < hr.getPoints('b')[0])

        // points distributed so no two points have the same node adjacent
        // _keys are already in sorted numeric order
        var allPoints = hr._keys
        for (var i = 1; i < allPoints.length; i++) assert.notEqual(hr._keyMap[allPoints[i]], hr._keyMap[allPoints[i - 1]])
    })

    it('should optionally assign points in sorted order', function() {
        var hr = new ConsistentHash({
            distribution: 'uniform', weight: 4,
            orderNodes: function(nodes) { return nodes.sort() } })
        hr.add('c')
        hr.add('b')
        hr.add('a')
        hr.get('foo')
        assert.deepEqual(hr.getNodes(), ['a', 'b', 'c'])
        assert.ok(hr.getPoints('a')[0] < hr.getPoints('b')[0])
        assert.ok(hr.getPoints('a')[1] < hr.getPoints('b')[1])
        assert.ok(hr.getPoints('b')[0] < hr.getPoints('c')[0])
        assert.ok(hr.getPoints('b')[1] < hr.getPoints('c')[1])
    })
})

describe('regressions', function() {
    it('add after remove should not crash', function() {
        var uut = new ConsistentHash()
        uut.add('a')
        uut.add('b')
        uut.get('resourceName')
        uut.remove('a')
        // remove() invalidates the control point map; the next add must rebuild it
        uut.add('c')
        assert.equal(uut.nodeCount, 2)
        assert.ok(uut.get('resourceName'))
    })

    it('remove then add should only return live nodes', function() {
        var uut = new ConsistentHash()
        uut.add('a')
        uut.add('b')
        uut.add('c')
        uut.get('prime')
        uut.remove('b')
        uut.add('d')
        for (var i = 0; i < 500; i++) {
            var node = uut.get('resource-' + i)
            assert.ok(node === 'a' || node === 'c' || node === 'd', 'returned a live node')
        }
    })

    it('should fill most of the default 100003-point ring', function() {
        // 2000 nodes * 40 control points = 80% ring fill.  The old retry
        // counter, shared across a whole add() batch, gave up near 64% fill.
        var uut = new ConsistentHash()
        var n = 2000
        for (var i = 0; i < n; i++) uut.add('node-' + i)
        assert.equal(uut.nodeCount, n)
        assert.equal(uut.keyCount, n * uut._weightDefault)
        assert.ok(uut.get('resourceName'))
    })
})

describe('cache', function() {
    it('should return the same node with and without the cache', function() {
        // uniform distribution so both rings get identical control points
        var plain = new ConsistentHash({ distribution: 'uniform' })
        var cached = new ConsistentHash({ distribution: 'uniform', cache: 100 })
        for (var i = 0; i < 50; i++) { plain.add('node-' + i); cached.add('node-' + i) }
        for (var i = 0; i < 500; i++) assert.equal(cached.get('key-' + i), plain.get('key-' + i))
    })

    it('should invalidate the cache when nodes are added or removed', function() {
        var hr = new ConsistentHash({ cache: 10 })
        hr.add('a')
        hr.add('b')
        hr.get('foo')
        hr.remove('a')
        hr.add('c')
        // the cache must not serve a mapping that no longer exists
        for (var i = 0; i < 200; i++) {
            var n = hr.get('key-' + i)
            assert.ok(n === 'b' || n === 'c', 'only live nodes')
        }
    })

    it('should stay correct after the cache overflows', function() {
        var hr = new ConsistentHash({ cache: 4 })
        hr.add('a')
        hr.add('b')
        hr.add('c')
        var first = []
        for (var i = 0; i < 100; i++) first[i] = hr.get('k' + i)
        for (var i = 0; i < 100; i++) assert.equal(hr.get('k' + i), first[i])
    })

    it('should not cache multi-node get', function() {
        var hr = new ConsistentHash({ cache: 10 })
        hr.add('a')
        hr.add('b')
        assert.equal(hr.get('foo', 2).length, 2)
    })
})

describe('timings', function() {
    var timedCut, data

    before(function() {
        timedCut = new ConsistentHash({ range: 1000003 })
        data = new Array()
    })

    it('generate 10k control points', function() {
        for (var i = 0; i < 10000; i++) data[i] = Math.random() * 0x10000 >>> 0
        data.sort(function(a,b) { return a < b ? -1 : a > b ? 1 : 0 })
    })

    it('add 10k nodes and prime', function() {
        var i, nodes = []
        for (i = 0; i < data.length; i++) nodes.push("abc" + data[i].toString(16))
        for (i = 0; i < data.length; i++) timedCut.add(nodes[i])
        timedCut.get("a")
    })

    it('time 100k _hash', function() {
        for (var i=0; i<100000; i++) timedCut._hash("abc")
    })

    it('time 100k _absearch', function() {
        var i, j
        for (j=0; j<10; j++) for (i=0; i<data.length; i++) timedCut._absearch(data, data[i])
    })

    it('time 100k get', function() {
        var i, j, node
        for (j=0; j<10; j++) for (i=0; i<data.length; i++) node = timedCut.get(data[i])
    })
})
