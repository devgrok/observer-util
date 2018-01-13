'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var promise = Promise.resolve();

// schedule the given task as a microtask
// (this used to leak into after the next task when mixed with MutationObservers in Safari)
function nextTick(task) {
  return promise.then(task);
}

var proxyToRaw = new WeakMap();
var rawToProxy = new WeakMap();

var ITERATE = Symbol('iterate');
var getPrototypeOf = Object.getPrototypeOf;

function has(value) {
  var rawContext = proxyToRaw.get(this);
  var proto = getPrototypeOf(this);
  if (!rawContext) {
    return proto.has.apply(this, arguments);
  }
  registerRunningReactionForKey(rawContext, value);
  return proto.has.apply(rawContext, arguments);
}

function get$1(key) {
  var rawContext = proxyToRaw.get(this);
  var proto = getPrototypeOf(this);
  if (!rawContext) {
    return proto.get.apply(this, arguments);
  }
  registerRunningReactionForKey(rawContext, key);
  return proto.get.apply(rawContext, arguments);
}

function add(value) {
  var rawContext = proxyToRaw.get(this);
  var proto = getPrototypeOf(this);
  if (!rawContext) {
    return proto.add.apply(this, arguments);
  }
  if (!proto.has.call(rawContext, value)) {
    queueReactionsForKey(rawContext, value);
    queueReactionsForKey(rawContext, ITERATE);
  }
  return proto.add.apply(rawContext, arguments);
}

function set$1(key, value) {
  var rawContext = proxyToRaw.get(this);
  var proto = getPrototypeOf(this);
  if (!rawContext) {
    return proto.set.apply(this, arguments);
  }
  if (proto.get.call(rawContext, key) !== value) {
    queueReactionsForKey(rawContext, key);
    queueReactionsForKey(rawContext, ITERATE);
  }
  return proto.set.apply(rawContext, arguments);
}

function deleteFn(value) {
  var rawContext = proxyToRaw.get(this);
  var proto = getPrototypeOf(this);
  if (!rawContext) {
    return proto.delete.apply(this, arguments);
  }
  if (proto.has.call(rawContext, value)) {
    queueReactionsForKey(rawContext, value);
    queueReactionsForKey(rawContext, ITERATE);
  }
  return proto.delete.apply(rawContext, arguments);
}

function clear() {
  var rawContext = proxyToRaw.get(this);
  var proto = getPrototypeOf(this);
  if (!rawContext) {
    return proto.clear.apply(this, arguments);
  }
  if (rawContext.size) {
    queueReactionsForKey(rawContext, ITERATE);
  }
  return proto.clear.apply(rawContext, arguments);
}

function forEach() {
  var rawContext = proxyToRaw.get(this);
  var proto = getPrototypeOf(this);
  if (!rawContext) {
    return proto.forEach.apply(this, arguments);
  }
  registerRunningReactionForKey(rawContext, ITERATE);
  return proto.forEach.apply(rawContext, arguments);
}

function keys() {
  var rawContext = proxyToRaw.get(this);
  var proto = getPrototypeOf(this);
  if (!rawContext) {
    return proto.keys.apply(this, arguments);
  }
  registerRunningReactionForKey(rawContext, ITERATE);
  return proto.keys.apply(rawContext, arguments);
}

function values() {
  var rawContext = proxyToRaw.get(this);
  var proto = getPrototypeOf(this);
  if (!rawContext) {
    return proto.values.apply(this, arguments);
  }
  registerRunningReactionForKey(rawContext, ITERATE);
  return proto.values.apply(rawContext, arguments);
}

function entries() {
  var rawContext = proxyToRaw.get(this);
  var proto = getPrototypeOf(this);
  if (!rawContext) {
    return proto.entries.apply(this, arguments);
  }
  registerRunningReactionForKey(rawContext, ITERATE);
  return proto.entries.apply(rawContext, arguments);
}

function iterator() {
  var rawContext = proxyToRaw.get(this);
  var proto = getPrototypeOf(this);
  if (!rawContext) {
    return proto[Symbol.iterator].apply(this, arguments);
  }
  registerRunningReactionForKey(rawContext, ITERATE);
  return proto[Symbol.iterator].apply(rawContext, arguments);
}

function getSize() {
  var rawContext = proxyToRaw.get(this);
  var proto = getPrototypeOf(this);
  if (!rawContext) {
    return Reflect.get(proto, 'size', this);
  }
  registerRunningReactionForKey(rawContext, ITERATE);
  return Reflect.get(proto, 'size', rawContext);
}

function instrumentMap(map) {
  map.has = has;
  map.get = get$1;
  map.set = set$1;
  map.delete = deleteFn;
  map.clear = clear;
  map.forEach = forEach;
  map.keys = keys;
  map.values = values;
  map.entries = entries;
  map[Symbol.iterator] = iterator;
  Object.defineProperty(map, 'size', { get: getSize });
}

function instrumentSet(set) {
  set.has = has;
  set.add = add;
  set.delete = deleteFn;
  set.clear = clear;
  set.forEach = forEach;
  set.keys = keys;
  set.values = values;
  set.entries = entries;
  set[Symbol.iterator] = iterator;
  Object.defineProperty(set, 'size', { get: getSize });
}

function instrumentWeakMap(map) {
  map.has = has;
  map.get = get$1;
  map.set = set$1;
  map.delete = deleteFn;
}

function instrumentWeakSet(set) {
  set.has = has;
  set.add = add;
  set.delete = deleteFn;
}

// built-in object can not be wrapped by Proxies
// their methods expect the object instance as the 'this' and when a Proxy instance is passed instead they break
// simple objects are not wrapped by Proxies or instrumented
// complex objects are wrapped and their methods are monkey patched
// to switch the proxy to the raw object and to add reactive wiring
var instrumentations = new Map([[Map.prototype, instrumentMap], [Set.prototype, instrumentSet], [WeakMap.prototype, instrumentWeakMap], [WeakSet.prototype, instrumentWeakSet], [Date.prototype, false], [RegExp.prototype, false]]);

var connectionStore = new WeakMap();
var cleanupStore = new WeakMap();

function storeObservable(obj) {
  // this will be used to save (obj.key -> reaction) connections later
  connectionStore.set(obj, Object.create(null));
}

function storeReaction(reaction) {
  // this will be used to save data for cleaning up later
  cleanupStore.set(reaction, new Set());
}

function registerReactionForKey(obj, key, reaction) {
  var reactionsForObj = connectionStore.get(obj);
  var reactionsForKey = reactionsForObj[key];
  if (!reactionsForKey) {
    reactionsForObj[key] = reactionsForKey = new Set();
  }
  reactionsForKey.add(reaction);
  cleanupStore.get(reaction).add(reactionsForKey);
}

function iterateReactionsForKey(obj, key, fn) {
  var reactionsForKey = connectionStore.get(obj)[key];
  if (reactionsForKey) {
    reactionsForKey.forEach(fn);
  }
}

function releaseReaction(reaction) {
  cleanupStore.get(reaction).forEach(releaseReactionKeyConnections, reaction);
}

function releaseReactionKeyConnections(reactionsForKey) {
  reactionsForKey.delete(this);
}

var ENUMERATE = Symbol('enumerate');
var queuedReactions = new Set();
var runningReaction;
var handlers = { get: get, ownKeys: ownKeys, set: set, deleteProperty: deleteProperty };

function observe(reaction) {
  if (typeof reaction !== 'function') {
    throw new TypeError('Reactions must be functions.');
  }
  // init basic data structures to save and cleanup (observable.prop -> reaction) connections later
  storeReaction(reaction);
  // run the reaction once to discover what observable properties it uses
  runReaction(reaction);
  return reaction;
}

function unobserve(reaction) {
  // do not run this reaction anymore, even if it is already queued
  queuedReactions.delete(reaction);
  // release every (observable.prop -> reaction) connections
  releaseReaction(reaction);
}

function unqueue(reaction) {
  // do not run this reaction, if it is not queued again by a prop mutation
  queuedReactions.delete(reaction);
}

function exec(reaction) {
  runReaction(reaction);
}

function isObservable(obj) {
  if (typeof obj !== 'object') {
    throw new TypeError('First argument must be an object');
  }
  return proxyToRaw.has(obj);
}

function observable(obj) {
  obj = obj || {};
  if (typeof obj !== 'object') {
    throw new TypeError('First argument must be an object or undefined');
  }
  // if it is already an observable, return it
  if (proxyToRaw.has(obj)) {
    return obj;
  }
  return (
    // if it already has a cached observable wrapper, return it
    // if it is a special built-in object, instrument it then wrap it with an observable
    // otherwise simply wrap the object with an observable
    rawToProxy.get(obj) || instrumentObservable(obj) || createObservable(obj)
  );
}

function isDomNode(obj) {
  return typeof Node === 'function' && obj instanceof Node;
}

function instrumentObservable(obj) {
  var instrument = instrumentations.get(Object.getPrototypeOf(obj));
  // these objects break, when they are wrapped with proxies
  if (instrument === false || isDomNode(obj)) {
    return obj;
  }
  // these objects can be wrapped by Proxies, but require special instrumentation beforehand
  if (typeof instrument === 'function') {
    instrument(obj);
  }
}

// wrap the object in a Proxy and save the obj-proxy, proxy-obj pairs
function createObservable(obj) {
  var observable = new Proxy(obj, handlers);
  // init basic data structures to save and cleanup later (observable.prop -> reaction) connections
  storeObservable(obj);
  // save these to switch between the raw object and the wrapped object with ease later
  proxyToRaw.set(observable, obj);
  rawToProxy.set(obj, observable);
  return observable;
}

// intercept get operations on observables to know which reaction uses their properties
function get(obj, key, receiver) {
  // make sure to use the raw object here
  var rawObj = proxyToRaw.get(obj) || obj;
  // expose the raw object on observable.$raw
  if (key === '$raw') {
    return rawObj;
  }
  var result = Reflect.get(obj, key, receiver);
  // do not register (observable.prop -> reaction) pairs for these cases
  if (typeof key === 'symbol' || typeof result === 'function') {
    return result;
  }
  // register and save (observable.prop -> runningReaction)
  registerRunningReactionForKey(rawObj, key);
  // if we are inside a reaction and observable.prop is an object wrap it in an observable too
  // this is needed to intercept property access on that object too (dynamic observable tree)
  if (runningReaction && typeof result === 'object' && result !== null) {
    return observable(result);
  }
  // otherwise return the observable wrapper if it is already created and cached or the raw object
  return rawToProxy.get(result) || result;
}

function ownKeys(obj) {
  registerRunningReactionForKey(obj, ENUMERATE);
  return Reflect.ownKeys(obj);
}

// register the currently running reaction to be queued again on obj.key mutations
function registerRunningReactionForKey(obj, key) {
  if (runningReaction) {
    registerReactionForKey(obj, key, runningReaction);
  }
}

// intercept set operations on observables to know when to trigger reactions
function set(obj, key, value, receiver) {
  // make sure to do not pollute the raw object with observables
  if (typeof value === 'object' && value !== null) {
    value = proxyToRaw.get(value) || value;
  }
  // do not register reactions if it is a symbol keyed property
  // or if the target of the operation is not the raw object (possible because of prototypal inheritance)
  if (typeof key === 'symbol' || obj !== proxyToRaw.get(receiver)) {
    return Reflect.set(obj, key, value, receiver);
  }
  // only queue reactions if the set operation resulted in a value change
  // array 'length' property is an exception from this, because of it's exotic nature
  if (key === 'length' || value !== obj[key]) {
    queueReactionsForKey(obj, key);
    queueReactionsForKey(obj, ENUMERATE);
  }
  return Reflect.set(obj, key, value, receiver);
}

function deleteProperty(obj, key) {
  // only queue reactions for non symbol keyed property delete which resulted in an actual change
  if (typeof key !== 'symbol' && key in obj) {
    queueReactionsForKey(obj, key);
    queueReactionsForKey(obj, ENUMERATE);
  }
  return Reflect.deleteProperty(obj, key);
}

function queueReactionsForKey(obj, key) {
  // register a new reaction running task, if there are no reactions queued yet
  if (!queuedReactions.size) {
    nextTick(runQueuedReactions);
  }
  // iterate and queue every reaction, which is triggered by obj.key mutation
  iterateReactionsForKey(obj, key, queueReaction);
}

function queueReaction(reaction) {
  queuedReactions.add(reaction);
}

function runQueuedReactions() {
  queuedReactions.forEach(runReaction);
  queuedReactions.clear();
}

// set the reaction as the currently running one
// this is required so that we can create (observable.prop -> reaction) pairs in the get trap
function runReaction(reaction) {
  try {
    runningReaction = reaction;
    reaction();
  } finally {
    // always remove the currently running flag from the reaction when it stops execution
    runningReaction = undefined;
  }
}

exports.nextTick = nextTick;
exports.observable = observable;
exports.isObservable = isObservable;
exports.observe = observe;
exports.unobserve = unobserve;
exports.unqueue = unqueue;
exports.exec = exec;
