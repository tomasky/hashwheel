/**
 * hashwheel -- simple, quick, efficient hash ring (consistent hashing)
 *
 * Copyright (C) 2014-2015,2021,2023 Andras Radics
 * Licensed under the Apache License, Version 2.0
 *
 * - O(n log n) insert for any number of nodes, not O(n^2)
 * - fast js string hash computation
 * - fairly uniform hash distribution
 *
 * Based on my PHP version, see lib/Quick/Data/ConsistentHash.php
 * in https://github.com/andrasq/quicklib/
 */

function ConsistentHash( options ) {
    this._nodes = new Array()
    this._nodeKeys = new Array()
    this._keyMap = {}
    this._keys = null
    this._nodesSorted = null
    this._needKeyMap = false
    this._cache = null
    this._cacheMax = 0
    this.nodeCount = 0
    this.keyCount = 0

    options = options || {}
    if (options.range) this._range = options.range
    if (options.controlPoints || options.weight) this._weightDefault = options.controlPoints || options.weight
    if (options.distribution === 'uniform') this._uniform = true
    if (options.orderNodes) this._orderNodes = options.orderNodes
    if (options.cache > 0) { this._cacheMax = options.cache >>> 0; this._cache = new LruCache(this._cacheMax) }
    // nb: calling methods on `this` from inside the constructor might not be supported in some browsers
    if (Array.isArray(options.nodes)) addNodesArray(this, options.nodes);
}

ConsistentHash.prototype = {
    _nodes: null,               // list of node objects
    _nodeKeys: null,            // list of control points for each node, in nodes order
    _keyMap: null,              // control point to node map
    // sorted keys array will be regenerated whenever set to falsy
    _keys: null,                // array of sorted control points
    _nodesSorted: null,         // node owning each entry of _keys, parallel array for the hot lookup
    _cache: null,               // optional bounded lookup cache, enabled with options.cache
    _cacheMax: 0,               // max entries held in the lookup cache
    _range: 100003,             // hash ring capacity.  Smaller values (1k) distribute better (100k)
                                // ok values: 1009:1, 5003, 9127, 1000003:97
    _weightDefault: 40,         // number of control points to create per node
    _uniform: false,            // distribute nodes uniformly around the ring
    _needKeyMap: false,         // whether need to initialize on first use

    /**
     * add n instances of the node at random positions around the hash ring
     */
    add:
    function add( node, n, points ) {
        // copy a caller-supplied points array so it stays private to the ring
        if (Array.isArray(points)) points = points.slice()
        else if (this._uniform) { this._needKeyMap = true; points = new Array(n || this._weightDefault) }
        else points = this._makeControlPoints(n || this._weightDefault)
        this._nodes.push(node)
        this._nodeKeys.push(points)
        n = points.length
        if (points[0] !== undefined) this._mapNodePoints(node, points)
        this._keys = null
        this._nodesSorted = null
        if (this._cache) this._cache.clear()
        this.keyCount += n
        this.nodeCount += 1
        return this
    },

    _makeControlPoints:
    function _makeControlPoints( n ) {
        // a prior remove() invalidated the keyMap; rebuild it before probing for free points
        if (this._needKeyMap) this._buildKeyMap(this._weightDefault)
        var i, key, points = new Array(n)
        for (i=0; i<n; i++) {
            // use probabilistic collision detection: ok for up to millions
            // bound the retries per point, not across the whole batch
            var attemptCount = 0
            do {
                key = Math.random() * this._range >>> 0
            } while (this._keyMap[key] !== undefined && ++attemptCount < 100)
            if (attemptCount >= 100) throw new Error("unable to find an unused control point, tried 100")
            points[i] = key
            // reserve the point to not reuse, not even for this node
            this._keyMap[key] = true
        }
        return points
    },

    /*
     * distribute n control points around the ring for each node that needs it, and update the keyMap
     */
    _buildKeyMap:
    function _buildKeyMap( n ) {
        var nodeCount = 0

        // count how many new nodes need uniformly distributed control points assigned
        var newNodes = {}
        for (var i = 0; i < this._nodes.length; i++) if (this._nodeKeys[i][0] === undefined) newNodes[i] = this._nodes[i]
        var newNodePos = Object.keys(newNodes)
        var newNodeCount = newNodePos.length

        // optionally reorder the new nodes to make control point assignment deterministic
        // For best results duplicate nodes should be merged, with proportionately more control points
        if (this._orderNodes) {
            var newNodesSorted = this._orderNodes(newNodePos.map(function(ix) { return newNodes[ix] }))
            for (var i = 0; i < newNodePos.length; i++) this._nodes[newNodePos[i]] = newNodesSorted[i]
        }

        // determine how many points we need and their spacing and position
        // Currently we ignore the per-node weight, and use the instance weight
        var pointCount = newNodeCount * this._weightDefault
        var step = this._range / pointCount

        // uniformly distribute control points among the new nodes
        // NOTE: the new points might overlap existing control points, not checked
        for (var i = 0; i < newNodePos.length; i++) {
            var keys = this._nodeKeys[newNodePos[i]]
            keys.length = this._weightDefault
            var offset = step * i + step / 2
            for (var j = 0; j < this._weightDefault; j++) keys[j] = Math.round(offset + (step * newNodeCount) * j)
        }

        // rebuild the control points to nodes mapping
        // TODO: do not manually rebuild the _keyMap, punt to _buildKeys that will be needed anyway
        this._keyMap = {}
        for (var i = 0; i < this._nodeKeys.length; i++) this._mapNodePoints(this._nodes[i], this._nodeKeys[i]);

        this._needKeyMap = false;
    },

    /**
     * remove all instances of the node from the hash ring
     */
    remove:
    function remove( node ) {
        var ix
        // note: indexOf() is a very fast O(n) linear search by pointer
        // loop to get duplicate entries too
        while ((ix = this._nodes.indexOf(node)) >= 0) {
            var keys = this._nodeKeys[ix]
            this._nodes[ix] = this._nodes[this._nodes.length - 1]
            this._nodes.length -= 1
            this._nodeKeys[ix] = this._nodeKeys[this._nodeKeys.length - 1]
            this._nodeKeys.length -= 1
            this._keys = null
            this._nodesSorted = null
            if (this._cache) this._cache.clear()
            this._needKeyMap = true
            this._keyMap = null
            this.nodeCount -= 1
            this.keyCount -= keys.length
            ix -= 1
        }
        return this
    },

    /**
     * return the first node in the hash ring after name
     */
    get:
    function get( name, count ) {
        if (count) return this._getMany(name, count);
        if (!this.keyCount) return null
        if (typeof name !== 'string') name = "" + name
        var cache = this._cache
        if (cache) {
            // cache.get() also refreshes recency
            var hit = cache.get(name)
            if (hit !== undefined) return hit
        }
        // inline of _locate, this is the hot path
        if (this._needKeyMap) this._buildKeyMap(this._weightDefault)
        if (!this._keys) this._buildKeys()
        var node = this._nodesSorted[this._absearch(this._keys, this._hash(name) % this._range)]
        if (cache) cache.set(name, node)
        return node
    },

    // return the first n distinct nodes in the hash ring after name
    _getMany:
    function _getMany( name, n ) {
        if (!this.keyCount) return null
        var index = this._locate(name)
        var node, nodes = [];
        for (var i=index; i<this.keyCount && nodes.length < n; i++) {
            node = this._nodesSorted[i];
            if (nodes.indexOf(node) < 0) nodes.push(node);
        }
        for (var i=0; i<index && nodes.length < n; i++) {
            node = this._nodesSorted[i];
            if (nodes.indexOf(node) < 0) nodes.push(node);
        }
        return nodes;
    },

    /**
     * Return the list of currently known nodes.
     */
    getNodes:
    function getNodes( ) {
        return this._nodes;
    },

    /**
     * Return the list of control points assigned to the node.
     */
    getPoints:
    function getPoints( node ) {
        if (this._needKeyMap) this._buildKeyMap(this._weightDefault);

        var ix = this._nodes.indexOf(node);
        return ix < 0 ? undefined : this._nodeKeys[ix];
    },

    // return the index of the node that handles resource name
    _locate:
    function _locate( name ) {
        if (this._needKeyMap) this._buildKeyMap(this._weightDefault);

        if (typeof name !== 'string') name = "" + name
        if (!this._keys) this._buildKeys()
        // murmur3 returns a uint32; the (prime) range modulus spreads it around the ring
        return this._absearch(this._keys, this._hash(name) % this._range)
    },

    // MurmurHash3 (x86 32-bit) variant.  Math.imul makes the 32-bit multiplies
    // cheap, and consuming two UTF-16 code units per round makes it much faster
    // than the old byte-at-a-time PJW hash on long keys.  The hash does not have
    // to be perfect, just well distributed; the ring takes it mod a prime range.
    _hash:
    function _murmur3(s) {
        var c1 = 0xcc9e2d51, c2 = 0x1b873593
        var len = s.length
        var i = 0, k, h = 0
        // main loop: 4 bytes (two code units) at a time
        for ( ; i + 1 < len; i += 2) {
            k = s.charCodeAt(i) | (s.charCodeAt(i + 1) << 16)
            k = Math.imul(k, c1)
            k = (k << 15) | (k >>> 17)
            k = Math.imul(k, c2)
            h ^= k
            h = (h << 13) | (h >>> 19)
            h = (Math.imul(h, 5) + 0xe6546b64) | 0
        }
        // tail: one leftover code unit
        if (i < len) {
            k = s.charCodeAt(i)
            k = Math.imul(k, c1)
            k = (k << 15) | (k >>> 17)
            k = Math.imul(k, c2)
            h ^= k
        }
        // finalization mix
        h ^= len
        h ^= h >>> 16
        h = Math.imul(h, 0x85ebca6b)
        h ^= h >>> 13
        h = Math.imul(h, 0xc2b2ae35)
        h ^= h >>> 16
        return h >>> 0
    },

/**
    // 24-bit CRC hash variant, see https://www.cs.hmc.edu/~geoff/classes/hmc.cs070.200101/homework10/hashfuncs.html
    _hash2:
    function _crcHash( s ) {
        // rotate left 5 bits, xor in each new byte
        // http://www.cs.hmc.edu/~geoff/classes/hmc.cs070.200101/homework10/hashfuncs.html
        var len = s.length
        var g, h = 0
        for (var i=0; i<len; i++) {
            // 24-bit hash
            g = h & 0xf80000
            h = (((h & ~0xf80000) << 5) | (g >>> 19)) ^ s.charCodeAt(i)
        }
        return h
    },
**/

/**
    // djb2: good string hash: http://www.cse.yorku.ca/~oz/hash.html
    //   hash(i) = hash(i - 1) * 33 ^ str[i];
    // (adapted from qpubs)
    _hash3:
    function _djb2( s ) {
        for (var h=0, len=s.length, i=0; i<len; i++) h = ((h * 33) ^ s.charCodeAt(i)) & 0xffffff;
        return h
    },
**/

    // binary search the sorted array for the location of the key
    // returns the index of the first value >= key, or 0 if key > max(array)
    _absearch:
    function _absearch( array, key ) {
        var i, j, mid, gap = 25, len = array.length
        for (i=0, j=len-1; j - i > gap; ) {
            mid = (i + j) >>> 1
            if (array[mid] < key) i = mid + 1
            else j = mid
        }
        // faster to linear search once the location is narrowed to gap items
        // this is the `approximate binary` in the `_absearch`
        for ( ; i<len; i++) if (array[i] >= key) return i
        return array.length === 0 ? -1 : 0
    },

    // regenerate the sorted keys array
    // TODO: also rebuild the _keyMap points-to-nodes lookup
    _buildKeys:
    function _buildKeys( ) {
        var i, j, k = 0, nodeKeys, keys = new Array(this.keyCount)
        for (i=0; i<this._nodeKeys.length; i++) {
            nodeKeys = this._nodeKeys[i]
            for (j=0; j<nodeKeys.length; j++) {
                keys[k++] = nodeKeys[j]
            }
        }
        // keyCount can be out of sync if the arrays were edited directly
        if (k !== keys.length) keys.length = k
        // note: duplicate keys are not filtered out, but should work ok
        keys.sort(comparePoints)
        this._keys = keys
        // parallel array of the node owning each sorted control point, so the hot
        // lookup path can index by position instead of a _keyMap object lookup
        var nodes = new Array(keys.length), map = this._keyMap
        for (i=0; i<keys.length; i++) nodes[i] = map[keys[i]]
        this._nodesSorted = nodes
        return keys
    },

    // map the control points to point to the node
    _mapNodePoints:
    function _mapNodePoints( node, points ) {
        var len = points.length, map = this._keyMap
        for (var i = 0; i < len; i++) map[points[i]] = node
    },

/**
    // remove the array element at position ix and close the gap (adapted from qibl)
    _removeByIndex( array, ix ) {
        if (ix < 0 || ix >= array.lenth) return
        for ( ; ix < array.length - 1; ix++) array[ix] = array[ix + 1]
        array.pop()
    }
**/
}

// Minimal O(1) LRU cache.  A doubly linked list keeps the recency order, so a
// hit only relinks a couple of pointers instead of deleting and re-inserting
// the key in a Map (which costs more than the hash lookup it saves).
function LruCache( max ) {
    this.max = max
    this.map = new Map()
    this.head = null            // most recently used entry
    this.tail = null            // least recently used entry
}

LruCache.prototype = {
    get:
    function get( key ) {
        var entry = this.map.get(key)
        if (entry === undefined) return undefined
        if (entry !== this.head) this._moveToHead(entry)
        return entry.value
    },

    set:
    function set( key, value ) {
        var entry = this.map.get(key)
        if (entry !== undefined) {
            entry.value = value
            if (entry !== this.head) this._moveToHead(entry)
            return
        }
        entry = { key: key, value: value, prev: null, next: this.head }
        if (this.head) this.head.prev = entry
        this.head = entry
        if (!this.tail) this.tail = entry
        this.map.set(key, entry)
        if (this.map.size > this.max) this._evictTail()
    },

    clear:
    function clear( ) {
        this.map.clear()
        this.head = null
        this.tail = null
    },

    _moveToHead:
    function _moveToHead( entry ) {
        var prev = entry.prev, next = entry.next
        if (prev) prev.next = next
        else this.head = next
        if (next) next.prev = prev
        else this.tail = prev
        entry.prev = null
        entry.next = this.head
        if (this.head) this.head.prev = entry
        this.head = entry
    },

    _evictTail:
    function _evictTail( ) {
        var tail = this.tail
        if (!tail) return
        this.map.delete(tail.key)
        this.tail = tail.prev
        if (this.tail) this.tail.next = null
        else this.head = null
    },
}

function addNodesArray( hashRing, nodes ) {
    for (var i = 0; i < nodes.length; i++) hashRing.add(nodes[i]);
}

// numeric ascending order; hoisted so the sort does not allocate a closure per rebuild
function comparePoints( a, b ) {
    return a - b
}

export default ConsistentHash
