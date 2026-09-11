var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/features.js
var features_exports = {};
__export(features_exports, {
  AxisBreak: () => installAxisBreak,
  LabelLayout: () => installLabelLayout,
  LegacyGridContainLabel: () => installLegacyGridContainLabel,
  ScatterJitter: () => installScatterJitter,
  UniversalTransition: () => installUniversalTransition
});

// ../../node_modules/.pnpm/tslib@2.3.0/node_modules/tslib/tslib.es6.js
var extendStatics = function(d, b) {
  extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
    d2.__proto__ = b2;
  } || function(d2, b2) {
    for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
  };
  return extendStatics(d, b);
};
function __extends(d, b) {
  if (typeof b !== "function" && b !== null)
    throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
  extendStatics(d, b);
  function __() {
    this.constructor = d;
  }
  d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/core/platform.js
var DEFAULT_FONT_SIZE = 12;
var DEFAULT_FONT_FAMILY = "sans-serif";
var DEFAULT_FONT = DEFAULT_FONT_SIZE + "px " + DEFAULT_FONT_FAMILY;
var OFFSET = 20;
var SCALE = 100;
var defaultWidthMapStr = "007LLmW'55;N0500LLLLLLLLLL00NNNLzWW\\\\WQb\\0FWLg\\bWb\\WQ\\WrWWQ000CL5LLFLL0LL**F*gLLLL5F0LF\\FFF5.5N";
function getTextWidthMap(mapStr) {
  var map2 = {};
  if (typeof JSON === "undefined") {
    return map2;
  }
  for (var i = 0; i < mapStr.length; i++) {
    var char = String.fromCharCode(i + 32);
    var size = (mapStr.charCodeAt(i) - OFFSET) / SCALE;
    map2[char] = size;
  }
  return map2;
}
var DEFAULT_TEXT_WIDTH_MAP = getTextWidthMap(defaultWidthMapStr);
var platformApi = {
  createCanvas: function() {
    return typeof document !== "undefined" && document.createElement("canvas");
  },
  measureText: /* @__PURE__ */ (function() {
    var _ctx;
    var _cachedFont;
    return function(text, font) {
      if (!_ctx) {
        var canvas = platformApi.createCanvas();
        _ctx = canvas && canvas.getContext("2d");
      }
      if (_ctx) {
        if (_cachedFont !== font) {
          _cachedFont = _ctx.font = font || DEFAULT_FONT;
        }
        return _ctx.measureText(text);
      } else {
        text = text || "";
        font = font || DEFAULT_FONT;
        var res = /((?:\d+)?\.?\d*)px/.exec(font);
        var fontSize = res && +res[1] || DEFAULT_FONT_SIZE;
        var width = 0;
        if (font.indexOf("mono") >= 0) {
          width = fontSize * text.length;
        } else {
          for (var i = 0; i < text.length; i++) {
            var preCalcWidth = DEFAULT_TEXT_WIDTH_MAP[text[i]];
            width += preCalcWidth == null ? fontSize : preCalcWidth * fontSize;
          }
        }
        return { width };
      }
    };
  })(),
  loadImage: function(src, onload, onerror) {
    var image = new Image();
    image.onload = onload;
    image.onerror = onerror;
    image.src = src;
    return image;
  },
  getTime: function() {
    return Date.now ? Date.now() : +/* @__PURE__ */ new Date();
  }
};

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/core/util.js
var BUILTIN_OBJECT = reduce([
  "Function",
  "RegExp",
  "Date",
  "Error",
  "CanvasGradient",
  "CanvasPattern",
  "Image",
  "Canvas"
], function(obj, val) {
  obj["[object " + val + "]"] = true;
  return obj;
}, {});
var TYPED_ARRAY = reduce([
  "Int8",
  "Uint8",
  "Uint8Clamped",
  "Int16",
  "Uint16",
  "Int32",
  "Uint32",
  "Float32",
  "Float64"
], function(obj, val) {
  obj["[object " + val + "Array]"] = true;
  return obj;
}, {});
var objToString = Object.prototype.toString;
var arrayProto = Array.prototype;
var nativeForEach = arrayProto.forEach;
var nativeFilter = arrayProto.filter;
var nativeSlice = arrayProto.slice;
var nativeMap = arrayProto.map;
var ctorFunction = function() {
}.constructor;
var protoFunction = ctorFunction ? ctorFunction.prototype : null;
var protoKey = "__proto__";
var idStart = 2311;
var MAX_SAFE_INTEGER = Math.pow(2, 53) - 1;
function guid() {
  if (idStart >= MAX_SAFE_INTEGER) {
    idStart = 0;
  }
  return idStart++;
}
function logError() {
  var args = [];
  for (var _i = 0; _i < arguments.length; _i++) {
    args[_i] = arguments[_i];
  }
  if (typeof console !== "undefined") {
    console.error.apply(console, args);
  }
}
function clone(source) {
  if (source == null || typeof source !== "object") {
    return source;
  }
  var result = source;
  var typeStr = objToString.call(source);
  if (typeStr === "[object Array]") {
    if (!isPrimitive(source)) {
      result = [];
      for (var i = 0, len2 = source.length; i < len2; i++) {
        result[i] = clone(source[i]);
      }
    }
  } else if (TYPED_ARRAY[typeStr]) {
    if (!isPrimitive(source)) {
      var Ctor = source.constructor;
      if (Ctor.from) {
        result = Ctor.from(source);
      } else {
        result = new Ctor(source.length);
        for (var i = 0, len2 = source.length; i < len2; i++) {
          result[i] = source[i];
        }
      }
    }
  } else if (!BUILTIN_OBJECT[typeStr] && !isPrimitive(source) && !isDom(source)) {
    result = {};
    for (var key2 in source) {
      if (source.hasOwnProperty(key2) && key2 !== protoKey) {
        result[key2] = clone(source[key2]);
      }
    }
  }
  return result;
}
function merge(target, source, overwrite) {
  if (!isObject(source) || !isObject(target)) {
    return overwrite ? clone(source) : target;
  }
  for (var key2 in source) {
    if (source.hasOwnProperty(key2) && key2 !== protoKey) {
      var targetProp = target[key2];
      var sourceProp = source[key2];
      if (isObject(sourceProp) && isObject(targetProp) && !isArray(sourceProp) && !isArray(targetProp) && !isDom(sourceProp) && !isDom(targetProp) && !isBuiltInObject(sourceProp) && !isBuiltInObject(targetProp) && !isPrimitive(sourceProp) && !isPrimitive(targetProp)) {
        merge(targetProp, sourceProp, overwrite);
      } else if (overwrite || !(key2 in target)) {
        target[key2] = clone(source[key2]);
      }
    }
  }
  return target;
}
function extend(target, source) {
  if (Object.assign) {
    Object.assign(target, source);
  } else {
    for (var key2 in source) {
      if (source.hasOwnProperty(key2) && key2 !== protoKey) {
        target[key2] = source[key2];
      }
    }
  }
  return target;
}
function assignProps(tar, src, props) {
  tar = tar || {};
  for (var idx = 0; idx < props.length; idx++) {
    var prop = props[idx];
    tar[prop] = src[prop];
  }
  return tar;
}
function defaults(target, source, overlay) {
  var keysArr = keys(source);
  for (var i = 0, len2 = keysArr.length; i < len2; i++) {
    var key2 = keysArr[i];
    if (overlay ? source[key2] != null : target[key2] == null) {
      target[key2] = source[key2];
    }
  }
  return target;
}
var createCanvas = platformApi.createCanvas;
function indexOf(array, value) {
  if (array) {
    if (array.indexOf) {
      return array.indexOf(value);
    }
    for (var i = 0, len2 = array.length; i < len2; i++) {
      if (array[i] === value) {
        return i;
      }
    }
  }
  return -1;
}
function inherits(clazz, baseClazz) {
  var clazzPrototype = clazz.prototype;
  function F() {
  }
  F.prototype = baseClazz.prototype;
  clazz.prototype = new F();
  for (var prop in clazzPrototype) {
    if (clazzPrototype.hasOwnProperty(prop)) {
      clazz.prototype[prop] = clazzPrototype[prop];
    }
  }
  clazz.prototype.constructor = clazz;
  clazz.superClass = baseClazz;
}
function mixin(target, source, override) {
  target = "prototype" in target ? target.prototype : target;
  source = "prototype" in source ? source.prototype : source;
  if (Object.getOwnPropertyNames) {
    var keyList = Object.getOwnPropertyNames(source);
    for (var i = 0; i < keyList.length; i++) {
      var key2 = keyList[i];
      if (key2 !== "constructor") {
        if (override ? source[key2] != null : target[key2] == null) {
          target[key2] = source[key2];
        }
      }
    }
  } else {
    defaults(target, source, override);
  }
}
function isArrayLike(data) {
  if (!data) {
    return false;
  }
  if (typeof data === "string") {
    return false;
  }
  return typeof data.length === "number";
}
function each(arr, cb, context) {
  if (!(arr && cb)) {
    return;
  }
  if (arr.forEach && arr.forEach === nativeForEach) {
    arr.forEach(cb, context);
  } else if (arr.length === +arr.length) {
    for (var i = 0, len2 = arr.length; i < len2; i++) {
      cb.call(context, arr[i], i, arr);
    }
  } else {
    for (var key2 in arr) {
      if (arr.hasOwnProperty(key2)) {
        cb.call(context, arr[key2], key2, arr);
      }
    }
  }
}
function map(arr, cb, context) {
  if (!arr) {
    return [];
  }
  if (!cb) {
    return slice(arr);
  }
  if (arr.map && arr.map === nativeMap) {
    return arr.map(cb, context);
  } else {
    var result = [];
    for (var i = 0, len2 = arr.length; i < len2; i++) {
      result.push(cb.call(context, arr[i], i, arr));
    }
    return result;
  }
}
function reduce(arr, cb, memo, context) {
  if (!(arr && cb)) {
    return;
  }
  for (var i = 0, len2 = arr.length; i < len2; i++) {
    memo = cb.call(context, memo, arr[i], i, arr);
  }
  return memo;
}
function filter(arr, cb, context) {
  if (!arr) {
    return [];
  }
  if (!cb) {
    return slice(arr);
  }
  if (arr.filter && arr.filter === nativeFilter) {
    return arr.filter(cb, context);
  } else {
    var result = [];
    for (var i = 0, len2 = arr.length; i < len2; i++) {
      if (cb.call(context, arr[i], i, arr)) {
        result.push(arr[i]);
      }
    }
    return result;
  }
}
function find(arr, cb, context) {
  if (!(arr && cb)) {
    return;
  }
  for (var i = 0, len2 = arr.length; i < len2; i++) {
    if (cb.call(context, arr[i], i, arr)) {
      return arr[i];
    }
  }
}
function keys(obj) {
  if (!obj) {
    return [];
  }
  if (Object.keys) {
    return Object.keys(obj);
  }
  var keyList = [];
  for (var key2 in obj) {
    if (obj.hasOwnProperty(key2)) {
      keyList.push(key2);
    }
  }
  return keyList;
}
function bindPolyfill(func, context) {
  var args = [];
  for (var _i = 2; _i < arguments.length; _i++) {
    args[_i - 2] = arguments[_i];
  }
  return function() {
    return func.apply(context, args.concat(nativeSlice.call(arguments)));
  };
}
var bind = protoFunction && isFunction(protoFunction.bind) ? protoFunction.call.bind(protoFunction.bind) : bindPolyfill;
function curry(func) {
  var args = [];
  for (var _i = 1; _i < arguments.length; _i++) {
    args[_i - 1] = arguments[_i];
  }
  return function() {
    return func.apply(this, args.concat(nativeSlice.call(arguments)));
  };
}
function isArray(value) {
  if (Array.isArray) {
    return Array.isArray(value);
  }
  return objToString.call(value) === "[object Array]";
}
function isFunction(value) {
  return typeof value === "function";
}
function isString(value) {
  return typeof value === "string";
}
function isNumber(value) {
  return typeof value === "number";
}
function isObject(value) {
  var type = typeof value;
  return type === "function" || !!value && type === "object";
}
function isBuiltInObject(value) {
  return !!BUILTIN_OBJECT[objToString.call(value)];
}
function isTypedArray(value) {
  return !!TYPED_ARRAY[objToString.call(value)];
}
function isDom(value) {
  return typeof value === "object" && typeof value.nodeType === "number" && typeof value.ownerDocument === "object";
}
function isGradientObject(value) {
  return value.colorStops != null;
}
function eqNaN(value) {
  return value !== value;
}
function retrieve() {
  var args = [];
  for (var _i = 0; _i < arguments.length; _i++) {
    args[_i] = arguments[_i];
  }
  for (var i = 0, len2 = args.length; i < len2; i++) {
    if (args[i] != null) {
      return args[i];
    }
  }
}
function retrieve2(value0, value1) {
  return value0 != null ? value0 : value1;
}
function retrieve3(value0, value1, value2) {
  return value0 != null ? value0 : value1 != null ? value1 : value2;
}
function slice(arr) {
  var args = [];
  for (var _i = 1; _i < arguments.length; _i++) {
    args[_i - 1] = arguments[_i];
  }
  return nativeSlice.apply(arr, args);
}
function normalizeCssArray(val) {
  if (typeof val === "number") {
    return [val, val, val, val];
  }
  var len2 = val.length;
  if (len2 === 2) {
    return [val[0], val[1], val[0], val[1]];
  } else if (len2 === 3) {
    return [val[0], val[1], val[2], val[1]];
  }
  return val;
}
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
function trim(str) {
  if (str == null) {
    return null;
  } else if (typeof str.trim === "function") {
    return str.trim();
  } else {
    return str.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, "");
  }
}
var primitiveKey = "__ec_primitive__";
function isPrimitive(obj) {
  return obj[primitiveKey];
}
var MapPolyfill = (function() {
  function MapPolyfill2() {
    this.data = {};
  }
  MapPolyfill2.prototype["delete"] = function(key2) {
    var existed = this.has(key2);
    if (existed) {
      delete this.data[key2];
    }
    return existed;
  };
  MapPolyfill2.prototype.has = function(key2) {
    return this.data.hasOwnProperty(key2);
  };
  MapPolyfill2.prototype.get = function(key2) {
    return this.data[key2];
  };
  MapPolyfill2.prototype.set = function(key2, value) {
    this.data[key2] = value;
    return this;
  };
  MapPolyfill2.prototype.keys = function() {
    return keys(this.data);
  };
  MapPolyfill2.prototype.forEach = function(callback) {
    var data = this.data;
    for (var key2 in data) {
      if (data.hasOwnProperty(key2)) {
        callback(data[key2], key2);
      }
    }
  };
  return MapPolyfill2;
})();
var isNativeMapSupported = typeof Map === "function";
function maybeNativeMap() {
  return isNativeMapSupported ? /* @__PURE__ */ new Map() : new MapPolyfill();
}
var HashMap = (function() {
  function HashMap2(obj) {
    var isArr = isArray(obj);
    this.data = maybeNativeMap();
    var thisMap = this;
    obj instanceof HashMap2 ? obj.each(visit) : obj && each(obj, visit);
    function visit(value, key2) {
      isArr ? thisMap.set(value, key2) : thisMap.set(key2, value);
    }
  }
  HashMap2.prototype.hasKey = function(key2) {
    return this.data.has(key2);
  };
  HashMap2.prototype.get = function(key2) {
    return this.data.get(key2);
  };
  HashMap2.prototype.set = function(key2, value) {
    this.data.set(key2, value);
    return value;
  };
  HashMap2.prototype.each = function(cb, context) {
    this.data.forEach(function(value, key2) {
      cb.call(context, value, key2);
    });
  };
  HashMap2.prototype.keys = function() {
    var keys2 = this.data.keys();
    return isNativeMapSupported ? Array.from(keys2) : keys2;
  };
  HashMap2.prototype.removeKey = function(key2) {
    this.data["delete"](key2);
  };
  return HashMap2;
})();
function createHashMap(obj) {
  return new HashMap(obj);
}
function concatArray(a, b) {
  var newArray = new a.constructor(a.length + b.length);
  for (var i = 0; i < a.length; i++) {
    newArray[i] = a[i];
  }
  var offset = a.length;
  for (var i = 0; i < b.length; i++) {
    newArray[i + offset] = b[i];
  }
  return newArray;
}
function createObject(proto, properties) {
  var obj;
  if (Object.create) {
    obj = Object.create(proto);
  } else {
    var StyleCtor = function() {
    };
    StyleCtor.prototype = proto;
    obj = new StyleCtor();
  }
  if (properties) {
    extend(obj, properties);
  }
  return obj;
}
function hasOwn(own, prop) {
  return own.hasOwnProperty(prop);
}
function noop() {
}
var RADIAN_TO_DEGREE = 180 / Math.PI;
var EPSILON = Number.EPSILON || Math.pow(2, -52);

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/core/env.js
var Browser = /* @__PURE__ */ (function() {
  function Browser2() {
    this.firefox = false;
    this.ie = false;
    this.edge = false;
    this.newEdge = false;
    this.weChat = false;
  }
  return Browser2;
})();
var Env = /* @__PURE__ */ (function() {
  function Env2() {
    this.browser = new Browser();
    this.node = false;
    this.wxa = false;
    this.worker = false;
    this.svgSupported = false;
    this.touchEventsSupported = false;
    this.pointerEventsSupported = false;
    this.domSupported = false;
    this.transformSupported = false;
    this.transform3dSupported = false;
    this.hasGlobalWindow = typeof window !== "undefined";
  }
  return Env2;
})();
var env = new Env();
if (typeof wx === "object" && typeof wx.getSystemInfoSync === "function") {
  env.wxa = true;
  env.touchEventsSupported = true;
} else if (typeof document === "undefined" && typeof self !== "undefined") {
  env.worker = true;
} else if (!env.hasGlobalWindow || "Deno" in window || typeof navigator !== "undefined" && typeof navigator.userAgent === "string" && navigator.userAgent.indexOf("Node.js") > -1) {
  env.node = true;
  env.svgSupported = true;
} else {
  detect(navigator.userAgent, env);
}
function detect(ua, env2) {
  var browser = env2.browser;
  var firefox = ua.match(/Firefox\/([\d.]+)/);
  var ie = ua.match(/MSIE\s([\d.]+)/) || ua.match(/Trident\/.+?rv:(([\d.]+))/);
  var edge = ua.match(/Edge?\/([\d.]+)/);
  var weChat = /micromessenger/i.test(ua);
  if (firefox) {
    browser.firefox = true;
    browser.version = firefox[1];
  }
  if (ie) {
    browser.ie = true;
    browser.version = ie[1];
  }
  if (edge) {
    browser.edge = true;
    browser.version = edge[1];
    browser.newEdge = +edge[1].split(".")[0] > 18;
  }
  if (weChat) {
    browser.weChat = true;
  }
  env2.svgSupported = typeof SVGRect !== "undefined";
  env2.touchEventsSupported = "ontouchstart" in window && !browser.ie && !browser.edge;
  env2.pointerEventsSupported = "onpointerdown" in window && (browser.edge || browser.ie && +browser.version >= 11);
  var domSupported = env2.domSupported = typeof document !== "undefined";
  if (domSupported) {
    var style = document.documentElement.style;
    env2.transform3dSupported = (browser.ie && "transition" in style || browser.edge || "WebKitCSSMatrix" in window && "m11" in new WebKitCSSMatrix() || "MozPerspective" in style) && !("OTransition" in style);
    env2.transformSupported = env2.transform3dSupported || browser.ie && +browser.version >= 9;
  }
}
var env_default = env;

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/util/number.js
var RADIAN_EPSILON = 1e-4;
var TO_FIXED_SUPPORTED_PRECISION_MAX = 20;
function _trim(str) {
  return str.replace(/^\s+|\s+$/g, "");
}
var mathMin = Math.min;
var mathMax = Math.max;
var mathAbs = Math.abs;
var mathRound = Math.round;
var mathFloor = Math.floor;
var mathCeil = Math.ceil;
var mathPow = Math.pow;
var mathLog = Math.log;
var mathLN10 = Math.LN10;
var mathPI = Math.PI;
var mathRandom = Math.random;
function linearMap(val, domain, range, clamp) {
  var d0 = domain[0];
  var d1 = domain[1];
  var r0 = range[0];
  var r1 = range[1];
  var subDomain = d1 - d0;
  var subRange = r1 - r0;
  if (subDomain === 0) {
    return subRange === 0 ? r0 : (r0 + r1) / 2;
  }
  if (clamp) {
    if (subDomain > 0) {
      if (val <= d0) {
        return r0;
      } else if (val >= d1) {
        return r1;
      }
    } else {
      if (val >= d0) {
        return r0;
      } else if (val <= d1) {
        return r1;
      }
    }
  } else {
    if (val === d0) {
      return r0;
    }
    if (val === d1) {
      return r1;
    }
  }
  return (val - d0) / subDomain * subRange + r0;
}
var parsePercent = parsePositionOption;
function parsePositionOption(option, percentBase, percentOffset) {
  switch (option) {
    case "center":
    case "middle":
      option = "50%";
      break;
    case "left":
    case "top":
      option = "0%";
      break;
    case "right":
    case "bottom":
      option = "100%";
      break;
  }
  return parsePositionSizeOption(option, percentBase, percentOffset);
}
function parsePositionSizeOption(option, percentBase, percentOffset) {
  if (isString(option)) {
    if (isOptionStringPercent(option)) {
      return parseFloat(option) / 100 * percentBase + (percentOffset || 0);
    }
    return parseFloat(option);
  }
  return option == null ? NaN : +option;
}
function isOptionStringPercent(option) {
  return !!_trim(option).match(/%$/);
}
function round(x, precision, returnStr) {
  if (false) {
    assert(precision != null);
  }
  if (isNaN(precision)) {
    return returnStr ? "" + x : +x;
  }
  precision = mathMin(mathMax(0, precision), TO_FIXED_SUPPORTED_PRECISION_MAX);
  x = (+x).toFixed(precision);
  return returnStr ? x : +x;
}
function asc(arr) {
  arr.sort(function(a, b) {
    return a - b;
  });
  return arr;
}
function getPrecision(val) {
  val = +val;
  if (isNaN(val)) {
    return 0;
  }
  if (val > 1e-14) {
    var e2 = 1;
    for (var i = 0; i < 15; i++, e2 *= 10) {
      if (mathRound(val * e2) / e2 === val) {
        return i;
      }
    }
  }
  return getPrecisionSafe(val);
}
function getPrecisionSafe(val) {
  var str = val.toString().toLowerCase();
  var eIndex = str.indexOf("e");
  var exp = eIndex > 0 ? +str.slice(eIndex + 1) : 0;
  var significandPartLen = eIndex > 0 ? eIndex : str.length;
  var dotIndex = str.indexOf(".");
  var decimalPartLen = dotIndex < 0 ? 0 : significandPartLen - 1 - dotIndex;
  return mathMax(0, decimalPartLen - exp);
}
function getAcceptableTickPrecision(dataExtent, pxSpan, pxDiffAcceptable) {
  var dataSpan = mathAbs(dataExtent[1] - dataExtent[0]);
  if (!isFinite(dataSpan) || dataSpan === 0) {
    return NaN;
  }
  var dataExp2 = mathLog(2 * mathAbs(pxDiffAcceptable || 1) * mathAbs(dataSpan)) / mathLN10;
  var pxExp = mathLog(mathAbs(pxSpan)) / mathLN10;
  var precision = mathMax(0, mathCeil(-dataExp2 + pxExp));
  if (!isFinite(precision)) {
    precision = NaN;
  }
  return precision;
}
var MAX_SAFE_INTEGER2 = mathPow(2, 53) - 1;
function remRadian(radian) {
  var pi2 = mathPI * 2;
  return (radian % pi2 + pi2) % pi2;
}
function isRadianAroundZero(val) {
  return val > -RADIAN_EPSILON && val < RADIAN_EPSILON;
}
var TIME_REG = /^(?:(\d{4})(?:[-\/](\d{1,2})(?:[-\/](\d{1,2})(?:[T ](\d{1,2})(?::(\d{1,2})(?::(\d{1,2})(?:[.,](\d+))?)?)?(Z|[\+\-]\d\d:?\d\d)?)?)?)?)?$/;
function parseDate(value) {
  if (value instanceof Date) {
    return value;
  } else if (isString(value)) {
    var match = TIME_REG.exec(value);
    if (!match) {
      return /* @__PURE__ */ new Date(NaN);
    }
    if (!match[8]) {
      return new Date(+match[1], +(match[2] || 1) - 1, +match[3] || 1, +match[4] || 0, +(match[5] || 0), +match[6] || 0, match[7] ? +match[7].substring(0, 3) : 0);
    } else {
      var hour = +match[4] || 0;
      if (match[8].toUpperCase() !== "Z") {
        hour -= +match[8].slice(0, 3);
      }
      return new Date(Date.UTC(+match[1], +(match[2] || 1) - 1, +match[3] || 1, hour, +(match[5] || 0), +match[6] || 0, match[7] ? +match[7].substring(0, 3) : 0));
    }
  } else if (value == null) {
    return /* @__PURE__ */ new Date(NaN);
  }
  return new Date(mathRound(value));
}
function quantity(val) {
  return mathPow(10, quantityExponent(val));
}
function quantityExponent(val) {
  if (val === 0) {
    return 0;
  }
  var exp = mathFloor(mathLog(val) / mathLN10);
  if (val / mathPow(10, exp) >= 10) {
    exp++;
  }
  return exp;
}
var NICE_MODE_MIN = 2;
function nice(val, mode) {
  var exponent = quantityExponent(val);
  var exp10 = mathPow(10, exponent);
  var f = val / exp10;
  var nf;
  if (mode === NICE_MODE_MIN) {
    nf = 1;
  } else if (mode) {
    if (f < 1.5) {
      nf = 1;
    } else if (f < 2.5) {
      nf = 2;
    } else if (f < 4) {
      nf = 3;
    } else if (f < 7) {
      nf = 5;
    } else {
      nf = 10;
    }
  } else {
    if (f < 1) {
      nf = 1;
    } else if (f < 2) {
      nf = 2;
    } else if (f < 3) {
      nf = 3;
    } else if (f < 5) {
      nf = 5;
    } else {
      nf = 10;
    }
  }
  val = nf * exp10;
  return round(val, -exponent);
}
function numericToNumber(val) {
  var valFloat = parseFloat(val);
  return valFloat == val && (valFloat !== 0 || !isString(val) || val.indexOf("x") <= 0) ? valFloat : NaN;
}
function isNumeric(val) {
  return !isNaN(numericToNumber(val));
}
function getRandomIdBase() {
  return mathRound(mathRandom() * 9);
}
function isNullableNumberFinite(val) {
  return val != null && isFinite(val);
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/util/log.js
var ECHARTS_PREFIX = "[ECharts] ";
var storedLogs = {};
var hasConsole = typeof console !== "undefined" && console.warn && console.log;
function outputLog(type, str, onlyOnce) {
  if (hasConsole) {
    if (onlyOnce) {
      if (storedLogs[str]) {
        return;
      }
      storedLogs[str] = true;
    }
    console[type](ECHARTS_PREFIX + str);
  }
}
function warn(str, onlyOnce) {
  outputLog("warn", str, onlyOnce);
}
function error(str, onlyOnce) {
  outputLog("error", str, onlyOnce);
}
function throwError(msg) {
  throw new Error(msg);
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/util/model.js
function interpolateNumber(p0, p1, percent) {
  return (p1 - p0) * percent + p0;
}
var DUMMY_COMPONENT_NAME_PREFIX = "series\0";
function normalizeToArray(value) {
  return value instanceof Array ? value : value == null ? [] : [value];
}
function defaultEmphasis(opt, key2, subOpts) {
  if (opt) {
    opt[key2] = opt[key2] || {};
    opt.emphasis = opt.emphasis || {};
    opt.emphasis[key2] = opt.emphasis[key2] || {};
    for (var i = 0, len2 = subOpts.length; i < len2; i++) {
      var subOptName = subOpts[i];
      if (!opt.emphasis[key2].hasOwnProperty(subOptName) && opt[key2].hasOwnProperty(subOptName)) {
        opt.emphasis[key2][subOptName] = opt[key2][subOptName];
      }
    }
  }
}
function getDataItemValue(dataItem) {
  return isObject(dataItem) && !isArray(dataItem) && !(dataItem instanceof Date) ? dataItem.value : dataItem;
}
function isNameSpecified(componentModel) {
  var name = componentModel.name;
  return !!(name && name.indexOf(DUMMY_COMPONENT_NAME_PREFIX));
}
function makeInner() {
  var key2 = "__ec_inner_" + innerUniqueIndex++;
  return function(hostObj) {
    return hostObj[key2] || (hostObj[key2] = {});
  };
}
var innerUniqueIndex = getRandomIdBase();
function parseFinder(ecModel, finderInput, opt) {
  var _a2 = preParseFinder(finderInput, opt), mainTypeSpecified = _a2.mainTypeSpecified, queryOptionMap = _a2.queryOptionMap, others = _a2.others;
  var result = others;
  var defaultMainType = opt ? opt.defaultMainType : null;
  if (!mainTypeSpecified && defaultMainType) {
    queryOptionMap.set(defaultMainType, {});
  }
  queryOptionMap.each(function(queryOption, mainType) {
    var queryResult = queryReferringComponents(ecModel, mainType, queryOption, {
      useDefault: defaultMainType === mainType,
      enableAll: opt && opt.enableAll != null ? opt.enableAll : true,
      enableNone: opt && opt.enableNone != null ? opt.enableNone : true
    });
    result[mainType + "Models"] = queryResult.models;
    result[mainType + "Model"] = queryResult.models[0];
  });
  return result;
}
function preParseFinder(finderInput, opt) {
  var finder;
  if (isString(finderInput)) {
    var obj = {};
    obj[finderInput + "Index"] = 0;
    finder = obj;
  } else {
    finder = finderInput;
  }
  var queryOptionMap = createHashMap();
  var others = {};
  var mainTypeSpecified = false;
  each(finder, function(value, key2) {
    if (key2 === "dataIndex" || key2 === "dataIndexInside") {
      others[key2] = value;
      return;
    }
    var parsedKey = key2.match(/^(\w+)(Index|Id|Name)$/) || [];
    var mainType = parsedKey[1];
    var queryType = (parsedKey[2] || "").toLowerCase();
    if (!mainType || !queryType || opt && opt.includeMainTypes && indexOf(opt.includeMainTypes, mainType) < 0) {
      return;
    }
    mainTypeSpecified = mainTypeSpecified || !!mainType;
    var queryOption = queryOptionMap.get(mainType) || queryOptionMap.set(mainType, {});
    queryOption[queryType] = value;
  });
  return {
    mainTypeSpecified,
    queryOptionMap,
    others
  };
}
var SINGLE_REFERRING = {
  useDefault: true,
  enableAll: false,
  enableNone: false
};
function queryReferringComponents(ecModel, mainType, userOption, opt) {
  opt = opt || SINGLE_REFERRING;
  var indexOption = userOption.index;
  var idOption = userOption.id;
  var nameOption = userOption.name;
  var result = {
    models: null,
    specified: indexOption != null || idOption != null || nameOption != null
  };
  if (!result.specified) {
    var firstCmpt = void 0;
    result.models = opt.useDefault && (firstCmpt = ecModel.getComponent(mainType)) ? [firstCmpt] : [];
    return result;
  }
  if (indexOption === "none" || indexOption === false) {
    if (opt.enableNone) {
      result.models = [];
      return result;
    } else {
      if (false) {
        error('`"none"` or `false` is not a valid value on index option.');
      }
      indexOption = -1;
    }
  }
  if (indexOption === "all") {
    if (opt.enableAll) {
      indexOption = idOption = nameOption = null;
    } else {
      if (false) {
        error('`"all"` is not a valid value on index option.');
      }
      indexOption = -1;
    }
  }
  result.models = ecModel.queryComponents({
    mainType,
    index: indexOption,
    id: idOption,
    name: nameOption
  });
  return result;
}
function interpolateRawValues(data, precision, sourceValue, targetValue, percent) {
  var isAutoPrecision = precision == null || precision === "auto";
  if (targetValue == null) {
    return targetValue;
  }
  if (isNumber(targetValue)) {
    var value = interpolateNumber(sourceValue || 0, targetValue, percent);
    return round(value, isAutoPrecision ? Math.max(getPrecision(sourceValue || 0), getPrecision(targetValue)) : precision);
  } else if (isString(targetValue)) {
    return percent < 1 ? sourceValue : targetValue;
  } else {
    var interpolated = [];
    var leftArr = sourceValue;
    var rightArr = targetValue;
    var length_1 = Math.max(leftArr ? leftArr.length : 0, rightArr.length);
    for (var i = 0; i < length_1; ++i) {
      var info = data.getDimensionInfo(i);
      if (info && info.type === "ordinal") {
        interpolated[i] = (percent < 1 && leftArr ? leftArr : rightArr)[i];
      } else {
        var leftVal = leftArr && leftArr[i] ? leftArr[i] : 0;
        var rightVal = rightArr[i];
        var value = interpolateNumber(leftVal, rightVal, percent);
        interpolated[i] = round(value, isAutoPrecision ? Math.max(getPrecision(leftVal), getPrecision(rightVal)) : precision);
      }
    }
    return interpolated;
  }
}
var ListIterator = (
  /** @class */
  (function() {
    function ListIterator2() {
    }
    ListIterator2.prototype.reset = function(list, start2, end2, step) {
      this._list = list;
      this._step = step = step || 1;
      this._idx = start2;
      this._end = end2 != null ? end2 : step > 0 ? list.length : 0;
      this.item = null;
      this.key = NaN;
      return this;
    };
    ListIterator2.prototype.next = function() {
      if (this._step > 0 ? this._idx < this._end : this._idx >= this._end) {
        this.item = this._list[this._idx];
        this.key = this._idx = this._idx + this._step;
        return true;
      }
      return false;
    };
    return ListIterator2;
  })()
);
function initExtentForUnion() {
  return [Infinity, -Infinity];
}
function unionExtentFromNumber(extent, val) {
  if (isValidNumberForExtent(val)) {
    val < extent[0] && (extent[0] = val);
    val > extent[1] && (extent[1] = val);
  }
}
function unionExtentStartFromNumber(extent, val) {
  if (isValidNumberForExtent(val) && val < extent[0]) {
    extent[0] = val;
  }
}
function unionExtentEndFromNumber(extent, val) {
  if (isValidNumberForExtent(val) && val > extent[1]) {
    extent[1] = val;
  }
}
function unionExtentFromExtent(tarExtent, srcExtent) {
  if (isValidBoundsForExtent(srcExtent[0], srcExtent[1])) {
    srcExtent[0] < tarExtent[0] && (tarExtent[0] = srcExtent[0]);
    srcExtent[1] > tarExtent[1] && (tarExtent[1] = srcExtent[1]);
  }
}
function isValidNumberForExtent(val) {
  return val != null && isFinite(val);
}
function isValidBoundsForExtent(start2, end2) {
  return isValidNumberForExtent(start2) && isValidNumberForExtent(end2) && start2 <= end2;
}
function extentHasValue(extent) {
  var span = extent[1] - extent[0];
  return isFinite(span) && span >= 0;
}
function ensureExtentAscSimply(extent) {
  if (isValidBoundsForExtent(extent[0], extent[1]) && extent[0] > extent[1]) {
    extent[0] = extent[1];
  }
}
function makeCallOnlyOnce() {
  var hiddenKey = "__ec_once_" + onceUniqueIndex++;
  return function(hostObj, cb) {
    if (false) {
      assert(hostObj);
    }
    if (!hasOwn(hostObj, hiddenKey)) {
      hostObj[hiddenKey] = 1;
      cb();
    }
  };
}
var onceUniqueIndex = getRandomIdBase();
function removeDuplicates(arr, getKey, resolve) {
  var dupMap = createHashMap();
  var writeIdx = 0;
  each(arr, function(item) {
    var key2 = getKey(item);
    if (false) {
      assert(isString(key2));
    }
    var count = dupMap.get(key2) || 0;
    if (resolve) {
      resolve(item, count);
    }
    if (!count && !resolve) {
      arr[writeIdx++] = item;
    }
    dupMap.set(key2, count + 1);
  });
  if (!resolve) {
    arr.length = writeIdx;
  }
}
function removeDuplicatesGetKeyFromValueProp(item) {
  if (false) {
    assert(item.value != null);
  }
  return item.value + "";
}
function removeDuplicatesGetKeyFromItemItself(item) {
  if (false) {
    assert(item != null);
  }
  return item + "";
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/util/clazz.js
var TYPE_DELIMITER = ".";
var IS_CONTAINER = "___EC__COMPONENT__CONTAINER___";
var IS_EXTENDED_CLASS = "___EC__EXTENDED_CLASS___";
function parseClassType(componentType) {
  var ret = {
    main: "",
    sub: ""
  };
  if (componentType) {
    var typeArr = componentType.split(TYPE_DELIMITER);
    ret.main = typeArr[0] || "";
    ret.sub = typeArr[1] || "";
  }
  return ret;
}
function checkClassType(componentType) {
  assert(/^[a-zA-Z0-9_]+([.][a-zA-Z0-9_]+)?$/.test(componentType), 'componentType "' + componentType + '" illegal');
}
function isExtendedClass(clz) {
  return !!(clz && clz[IS_EXTENDED_CLASS]);
}
function enableClassExtend(rootClz, mandatoryMethods) {
  rootClz.$constructor = rootClz;
  rootClz.extend = function(proto) {
    if (false) {
      each(mandatoryMethods, function(method) {
        if (!proto[method]) {
          console.warn("Method `" + method + "` should be implemented" + (proto.type ? " in " + proto.type : "") + ".");
        }
      });
    }
    var superClass = this;
    var ExtendedClass;
    if (isESClass(superClass)) {
      ExtendedClass = /** @class */
      (function(_super) {
        __extends(class_1, _super);
        function class_1() {
          return _super.apply(this, arguments) || this;
        }
        return class_1;
      })(superClass);
    } else {
      ExtendedClass = function() {
        (proto.$constructor || superClass).apply(this, arguments);
      };
      inherits(ExtendedClass, this);
    }
    extend(ExtendedClass.prototype, proto);
    ExtendedClass[IS_EXTENDED_CLASS] = true;
    ExtendedClass.extend = this.extend;
    ExtendedClass.superCall = superCall;
    ExtendedClass.superApply = superApply;
    ExtendedClass.superClass = superClass;
    return ExtendedClass;
  };
}
function isESClass(fn) {
  return isFunction(fn) && /^class\s/.test(Function.prototype.toString.call(fn));
}
function mountExtend(SubClz, SupperClz) {
  SubClz.extend = SupperClz.extend;
}
var classBase = Math.round(Math.random() * 10);
function enableClassCheck(target) {
  var classAttr = ["__\0is_clz", classBase++].join("_");
  target.prototype[classAttr] = true;
  if (false) {
    assert(!target.isInstance, 'The method "is" can not be defined.');
  }
  target.isInstance = function(obj) {
    return !!(obj && obj[classAttr]);
  };
}
function superCall(context, methodName) {
  var args = [];
  for (var _i = 2; _i < arguments.length; _i++) {
    args[_i - 2] = arguments[_i];
  }
  return this.superClass.prototype[methodName].apply(context, args);
}
function superApply(context, methodName, args) {
  return this.superClass.prototype[methodName].apply(context, args);
}
function enableClassManagement(target) {
  var storage = {};
  target.registerClass = function(clz) {
    var componentFullType = clz.type || clz.prototype.type;
    if (componentFullType) {
      checkClassType(componentFullType);
      clz.prototype.type = componentFullType;
      var componentTypeInfo = parseClassType(componentFullType);
      if (!componentTypeInfo.sub) {
        if (false) {
          if (storage[componentTypeInfo.main]) {
            console.warn(componentTypeInfo.main + " exists.");
          }
        }
        storage[componentTypeInfo.main] = clz;
      } else if (componentTypeInfo.sub !== IS_CONTAINER) {
        var container = makeContainer(componentTypeInfo);
        container[componentTypeInfo.sub] = clz;
      }
    }
    return clz;
  };
  target.getClass = function(mainType, subType, throwWhenNotFound) {
    var clz = storage[mainType];
    if (clz && clz[IS_CONTAINER]) {
      clz = subType ? clz[subType] : null;
    }
    if (throwWhenNotFound && !clz) {
      throw new Error(!subType ? mainType + ".type should be specified." : "Component " + mainType + "." + (subType || "") + " is used but not imported.");
    }
    return clz;
  };
  target.getClassesByMainType = function(componentType) {
    var componentTypeInfo = parseClassType(componentType);
    var result = [];
    var obj = storage[componentTypeInfo.main];
    if (obj && obj[IS_CONTAINER]) {
      each(obj, function(o, type) {
        type !== IS_CONTAINER && result.push(o);
      });
    } else {
      result.push(obj);
    }
    return result;
  };
  target.hasClass = function(componentType) {
    var componentTypeInfo = parseClassType(componentType);
    return !!storage[componentTypeInfo.main];
  };
  target.getAllClassMainTypes = function() {
    var types = [];
    each(storage, function(obj, type) {
      types.push(type);
    });
    return types;
  };
  target.hasSubTypes = function(componentType) {
    var componentTypeInfo = parseClassType(componentType);
    var obj = storage[componentTypeInfo.main];
    return obj && obj[IS_CONTAINER];
  };
  function makeContainer(componentTypeInfo) {
    var container = storage[componentTypeInfo.main];
    if (!container || !container[IS_CONTAINER]) {
      container = storage[componentTypeInfo.main] = {};
      container[IS_CONTAINER] = true;
    }
    return container;
  }
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/model/mixin/makeStyleMapper.js
function makeStyleMapper(properties, ignoreParent) {
  for (var i = 0; i < properties.length; i++) {
    if (!properties[i][1]) {
      properties[i][1] = properties[i][0];
    }
  }
  ignoreParent = ignoreParent || false;
  return function(model, excludes, includes) {
    var style = {};
    for (var i2 = 0; i2 < properties.length; i2++) {
      var propName = properties[i2][1];
      if (excludes && indexOf(excludes, propName) >= 0 || includes && indexOf(includes, propName) < 0) {
        continue;
      }
      var val = model.getShallow(propName, ignoreParent);
      if (val != null) {
        style[properties[i2][0]] = val;
      }
    }
    return style;
  };
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/model/mixin/areaStyle.js
var AREA_STYLE_KEY_MAP = [
  ["fill", "color"],
  ["shadowBlur"],
  ["shadowOffsetX"],
  ["shadowOffsetY"],
  ["opacity"],
  ["shadowColor"]
  // Option decal is in `DecalObject` but style.decal is in `PatternObject`.
  // So do not transfer decal directly.
];
var getAreaStyle = makeStyleMapper(AREA_STYLE_KEY_MAP);
var AreaStyleMixin = (
  /** @class */
  (function() {
    function AreaStyleMixin2() {
    }
    AreaStyleMixin2.prototype.getAreaStyle = function(excludes, includes) {
      return getAreaStyle(this, excludes, includes);
    };
    return AreaStyleMixin2;
  })()
);

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/core/LRU.js
var Entry = /* @__PURE__ */ (function() {
  function Entry2(val) {
    this.value = val;
  }
  return Entry2;
})();
var LinkedList = (function() {
  function LinkedList2() {
    this._len = 0;
  }
  LinkedList2.prototype.insert = function(val) {
    var entry = new Entry(val);
    this.insertEntry(entry);
    return entry;
  };
  LinkedList2.prototype.insertEntry = function(entry) {
    if (!this.head) {
      this.head = this.tail = entry;
    } else {
      this.tail.next = entry;
      entry.prev = this.tail;
      entry.next = null;
      this.tail = entry;
    }
    this._len++;
  };
  LinkedList2.prototype.remove = function(entry) {
    var prev = entry.prev;
    var next = entry.next;
    if (prev) {
      prev.next = next;
    } else {
      this.head = next;
    }
    if (next) {
      next.prev = prev;
    } else {
      this.tail = prev;
    }
    entry.next = entry.prev = null;
    this._len--;
  };
  LinkedList2.prototype.len = function() {
    return this._len;
  };
  LinkedList2.prototype.clear = function() {
    this.head = this.tail = null;
    this._len = 0;
  };
  return LinkedList2;
})();
var LRU = (function() {
  function LRU2(maxSize) {
    this._list = new LinkedList();
    this._maxSize = 10;
    this._map = {};
    this._maxSize = maxSize;
  }
  LRU2.prototype.put = function(key2, value) {
    var list = this._list;
    var map2 = this._map;
    var removed = null;
    if (map2[key2] == null) {
      var len2 = list.len();
      var entry = this._lastRemovedEntry;
      if (len2 >= this._maxSize && len2 > 0) {
        var leastUsedEntry = list.head;
        list.remove(leastUsedEntry);
        delete map2[leastUsedEntry.key];
        removed = leastUsedEntry.value;
        this._lastRemovedEntry = leastUsedEntry;
      }
      if (entry) {
        entry.value = value;
      } else {
        entry = new Entry(value);
      }
      entry.key = key2;
      list.insertEntry(entry);
      map2[key2] = entry;
    }
    return removed;
  };
  LRU2.prototype.get = function(key2) {
    var entry = this._map[key2];
    var list = this._list;
    if (entry != null) {
      if (entry !== list.tail) {
        list.remove(entry);
        list.insertEntry(entry);
      }
      return entry.value;
    }
  };
  LRU2.prototype.clear = function() {
    this._list.clear();
    this._map = {};
  };
  LRU2.prototype.len = function() {
    return this._list.len();
  };
  return LRU2;
})();
var LRU_default = LRU;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/graphic/helper/image.js
var globalImageCache = new LRU_default(50);
function findExistImage(newImageOrSrc) {
  if (typeof newImageOrSrc === "string") {
    var cachedImgObj = globalImageCache.get(newImageOrSrc);
    return cachedImgObj && cachedImgObj.image;
  } else {
    return newImageOrSrc;
  }
}
function isImageReady(image) {
  return image && image.width && image.height;
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/core/matrix.js
function create() {
  return [1, 0, 0, 1, 0, 0];
}
function identity(out2) {
  out2[0] = 1;
  out2[1] = 0;
  out2[2] = 0;
  out2[3] = 1;
  out2[4] = 0;
  out2[5] = 0;
  return out2;
}
function copy(out2, m) {
  out2[0] = m[0];
  out2[1] = m[1];
  out2[2] = m[2];
  out2[3] = m[3];
  out2[4] = m[4];
  out2[5] = m[5];
  return out2;
}
function mul(out2, m1, m2) {
  var out0 = m1[0] * m2[0] + m1[2] * m2[1];
  var out1 = m1[1] * m2[0] + m1[3] * m2[1];
  var out22 = m1[0] * m2[2] + m1[2] * m2[3];
  var out3 = m1[1] * m2[2] + m1[3] * m2[3];
  var out4 = m1[0] * m2[4] + m1[2] * m2[5] + m1[4];
  var out5 = m1[1] * m2[4] + m1[3] * m2[5] + m1[5];
  out2[0] = out0;
  out2[1] = out1;
  out2[2] = out22;
  out2[3] = out3;
  out2[4] = out4;
  out2[5] = out5;
  return out2;
}
function translate(out2, a, v) {
  out2[0] = a[0];
  out2[1] = a[1];
  out2[2] = a[2];
  out2[3] = a[3];
  out2[4] = a[4] + v[0];
  out2[5] = a[5] + v[1];
  return out2;
}
function rotate(out2, a, rad, pivot) {
  if (pivot === void 0) {
    pivot = [0, 0];
  }
  var aa = a[0];
  var ac = a[2];
  var atx = a[4];
  var ab = a[1];
  var ad = a[3];
  var aty = a[5];
  var st = Math.sin(rad);
  var ct = Math.cos(rad);
  out2[0] = aa * ct + ab * st;
  out2[1] = -aa * st + ab * ct;
  out2[2] = ac * ct + ad * st;
  out2[3] = -ac * st + ct * ad;
  out2[4] = ct * (atx - pivot[0]) + st * (aty - pivot[1]) + pivot[0];
  out2[5] = ct * (aty - pivot[1]) - st * (atx - pivot[0]) + pivot[1];
  return out2;
}
function scale(out2, a, v) {
  var vx = v[0];
  var vy = v[1];
  out2[0] = a[0] * vx;
  out2[1] = a[1] * vy;
  out2[2] = a[2] * vx;
  out2[3] = a[3] * vy;
  out2[4] = a[4] * vx;
  out2[5] = a[5] * vy;
  return out2;
}
function invert(out2, a) {
  var aa = a[0];
  var ac = a[2];
  var atx = a[4];
  var ab = a[1];
  var ad = a[3];
  var aty = a[5];
  var det = aa * ad - ab * ac;
  if (!det) {
    return null;
  }
  det = 1 / det;
  out2[0] = ad * det;
  out2[1] = -ab * det;
  out2[2] = -ac * det;
  out2[3] = aa * det;
  out2[4] = (ac * aty - ad * atx) * det;
  out2[5] = (ab * atx - aa * aty) * det;
  return out2;
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/core/vector.js
function create2(x, y) {
  if (x == null) {
    x = 0;
  }
  if (y == null) {
    y = 0;
  }
  return [x, y];
}
function clone2(v) {
  return [v[0], v[1]];
}
function set(out2, a, b) {
  out2[0] = a;
  out2[1] = b;
  return out2;
}
function add(out2, v1, v2) {
  out2[0] = v1[0] + v2[0];
  out2[1] = v1[1] + v2[1];
  return out2;
}
function sub(out2, v1, v2) {
  out2[0] = v1[0] - v2[0];
  out2[1] = v1[1] - v2[1];
  return out2;
}
function len(v) {
  return Math.sqrt(lenSquare(v));
}
function lenSquare(v) {
  return v[0] * v[0] + v[1] * v[1];
}
function scale2(out2, v, s) {
  out2[0] = v[0] * s;
  out2[1] = v[1] * s;
  return out2;
}
function normalize(out2, v) {
  var d = len(v);
  if (d === 0) {
    out2[0] = 0;
    out2[1] = 0;
  } else {
    out2[0] = v[0] / d;
    out2[1] = v[1] / d;
  }
  return out2;
}
function distance(v1, v2) {
  return Math.sqrt((v1[0] - v2[0]) * (v1[0] - v2[0]) + (v1[1] - v2[1]) * (v1[1] - v2[1]));
}
var dist = distance;
function distanceSquare(v1, v2) {
  return (v1[0] - v2[0]) * (v1[0] - v2[0]) + (v1[1] - v2[1]) * (v1[1] - v2[1]);
}
var distSquare = distanceSquare;
function lerp(out2, v1, v2, t) {
  out2[0] = v1[0] + t * (v2[0] - v1[0]);
  out2[1] = v1[1] + t * (v2[1] - v1[1]);
  return out2;
}
function applyTransform(out2, v, m) {
  var x = v[0];
  var y = v[1];
  out2[0] = m[0] * x + m[2] * y + m[4];
  out2[1] = m[1] * x + m[3] * y + m[5];
  return out2;
}
function min(out2, v1, v2) {
  out2[0] = Math.min(v1[0], v2[0]);
  out2[1] = Math.min(v1[1], v2[1]);
  return out2;
}
function max(out2, v1, v2) {
  out2[0] = Math.max(v1[0], v2[0]);
  out2[1] = Math.max(v1[1], v2[1]);
  return out2;
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/core/Point.js
var Point = (function() {
  function Point2(x, y) {
    this.x = x || 0;
    this.y = y || 0;
  }
  Point2.prototype.copy = function(other) {
    this.x = other.x;
    this.y = other.y;
    return this;
  };
  Point2.prototype.clone = function() {
    return new Point2(this.x, this.y);
  };
  Point2.prototype.set = function(x, y) {
    this.x = x;
    this.y = y;
    return this;
  };
  Point2.prototype.equal = function(other) {
    return other.x === this.x && other.y === this.y;
  };
  Point2.prototype.add = function(other) {
    this.x += other.x;
    this.y += other.y;
    return this;
  };
  Point2.prototype.scale = function(scalar) {
    this.x *= scalar;
    this.y *= scalar;
  };
  Point2.prototype.scaleAndAdd = function(other, scalar) {
    this.x += other.x * scalar;
    this.y += other.y * scalar;
  };
  Point2.prototype.sub = function(other) {
    this.x -= other.x;
    this.y -= other.y;
    return this;
  };
  Point2.prototype.dot = function(other) {
    return this.x * other.x + this.y * other.y;
  };
  Point2.prototype.len = function() {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  };
  Point2.prototype.lenSquare = function() {
    return this.x * this.x + this.y * this.y;
  };
  Point2.prototype.normalize = function() {
    var len2 = this.len();
    this.x /= len2;
    this.y /= len2;
    return this;
  };
  Point2.prototype.distance = function(other) {
    var dx = this.x - other.x;
    var dy = this.y - other.y;
    return Math.sqrt(dx * dx + dy * dy);
  };
  Point2.prototype.distanceSquare = function(other) {
    var dx = this.x - other.x;
    var dy = this.y - other.y;
    return dx * dx + dy * dy;
  };
  Point2.prototype.negate = function() {
    this.x = -this.x;
    this.y = -this.y;
    return this;
  };
  Point2.prototype.transform = function(m) {
    if (!m) {
      return;
    }
    var x = this.x;
    var y = this.y;
    this.x = m[0] * x + m[2] * y + m[4];
    this.y = m[1] * x + m[3] * y + m[5];
    return this;
  };
  Point2.prototype.toArray = function(out2) {
    out2[0] = this.x;
    out2[1] = this.y;
    return out2;
  };
  Point2.prototype.fromArray = function(input) {
    this.x = input[0];
    this.y = input[1];
  };
  Point2.set = function(p, x, y) {
    p.x = x;
    p.y = y;
  };
  Point2.copy = function(p, p2) {
    p.x = p2.x;
    p.y = p2.y;
  };
  Point2.len = function(p) {
    return Math.sqrt(p.x * p.x + p.y * p.y);
  };
  Point2.lenSquare = function(p) {
    return p.x * p.x + p.y * p.y;
  };
  Point2.dot = function(p0, p1) {
    return p0.x * p1.x + p0.y * p1.y;
  };
  Point2.add = function(out2, p0, p1) {
    out2.x = p0.x + p1.x;
    out2.y = p0.y + p1.y;
  };
  Point2.sub = function(out2, p0, p1) {
    out2.x = p0.x - p1.x;
    out2.y = p0.y - p1.y;
  };
  Point2.scale = function(out2, p0, scalar) {
    out2.x = p0.x * scalar;
    out2.y = p0.y * scalar;
  };
  Point2.scaleAndAdd = function(out2, p0, p1, scalar) {
    out2.x = p0.x + p1.x * scalar;
    out2.y = p0.y + p1.y * scalar;
  };
  Point2.lerp = function(out2, p0, p1, t) {
    var onet = 1 - t;
    out2.x = onet * p0.x + t * p1.x;
    out2.y = onet * p0.y + t * p1.y;
  };
  return Point2;
})();
var Point_default = Point;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/core/BoundingRect.js
var mathMin2 = Math.min;
var mathMax2 = Math.max;
var mathAbs2 = Math.abs;
var XY = ["x", "y"];
var WH = ["width", "height"];
var lt = new Point_default();
var rb = new Point_default();
var lb = new Point_default();
var rt = new Point_default();
var _intersectCtx = createIntersectContext();
var _minTv = _intersectCtx.minTv;
var _maxTv = _intersectCtx.maxTv;
var _lenMinMax = [0, 0];
var BoundingRect = (function() {
  function BoundingRect2(x, y, width, height) {
    boundingRectSet(this, x, y, width, height);
  }
  BoundingRect2.set = function(target, x, y, width, height) {
    if (width < 0) {
      x = x + width;
      width = -width;
    }
    if (height < 0) {
      y = y + height;
      height = -height;
    }
    target.x = x;
    target.y = y;
    target.width = width;
    target.height = height;
    return target;
  };
  BoundingRect2.prototype.union = function(other) {
    var x = mathMin2(other.x, this.x);
    var y = mathMin2(other.y, this.y);
    if (isFinite(this.x) && isFinite(this.width)) {
      this.width = mathMax2(other.x + other.width, this.x + this.width) - x;
    } else {
      this.width = other.width;
    }
    if (isFinite(this.y) && isFinite(this.height)) {
      this.height = mathMax2(other.y + other.height, this.y + this.height) - y;
    } else {
      this.height = other.height;
    }
    this.x = x;
    this.y = y;
  };
  BoundingRect2.prototype.applyTransform = function(m) {
    BoundingRect2.applyTransform(this, this, m);
  };
  BoundingRect2.prototype.calculateTransform = function(b) {
    return boundingRectCalculateTransform(create(), this, b);
  };
  BoundingRect2.prototype.intersect = function(b, mtv, opt) {
    return BoundingRect2.intersect(this, b, mtv, opt);
  };
  BoundingRect2.intersect = function(a, b, mtv, opt) {
    if (mtv) {
      Point_default.set(mtv, 0, 0);
    }
    var outIntersectRect = opt && opt.outIntersectRect || null;
    var clamp = opt && opt.clamp;
    if (outIntersectRect) {
      outIntersectRect.x = outIntersectRect.y = outIntersectRect.width = outIntersectRect.height = NaN;
    }
    if (!a || !b) {
      return false;
    }
    if (!(a instanceof BoundingRect2)) {
      a = boundingRectSet(_tmpIntersectA, a.x, a.y, a.width, a.height);
    }
    if (!(b instanceof BoundingRect2)) {
      b = boundingRectSet(_tmpIntersectB, b.x, b.y, b.width, b.height);
    }
    var useMTV = !!mtv;
    _intersectCtx.reset(opt, useMTV);
    var touchThreshold = _intersectCtx.touchThreshold;
    var ax0 = a.x + touchThreshold;
    var ax1 = a.x + a.width - touchThreshold;
    var ay0 = a.y + touchThreshold;
    var ay1 = a.y + a.height - touchThreshold;
    var bx0 = b.x + touchThreshold;
    var bx1 = b.x + b.width - touchThreshold;
    var by0 = b.y + touchThreshold;
    var by1 = b.y + b.height - touchThreshold;
    if (ax0 > ax1 || ay0 > ay1 || bx0 > bx1 || by0 > by1) {
      return false;
    }
    var overlap = !(ax1 < bx0 || bx1 < ax0 || ay1 < by0 || by1 < ay0);
    if (useMTV || outIntersectRect) {
      _lenMinMax[0] = Infinity;
      _lenMinMax[1] = 0;
      intersectOneDim(ax0, ax1, bx0, bx1, 0, useMTV, outIntersectRect, clamp);
      intersectOneDim(ay0, ay1, by0, by1, 1, useMTV, outIntersectRect, clamp);
      if (useMTV) {
        Point_default.copy(mtv, overlap ? _intersectCtx.useDir ? _intersectCtx.dirMinTv : _minTv : _maxTv);
      }
    }
    return overlap;
  };
  BoundingRect2.contain = function(rect, x, y) {
    return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
  };
  BoundingRect2.prototype.contain = function(x, y) {
    return BoundingRect2.contain(this, x, y);
  };
  BoundingRect2.prototype.clone = function() {
    return new BoundingRect2(this.x, this.y, this.width, this.height);
  };
  BoundingRect2.prototype.copy = function(other) {
    boundingRectCopy(this, other);
  };
  BoundingRect2.prototype.plain = function() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height
    };
  };
  BoundingRect2.prototype.isFinite = function() {
    return isFinite(this.x) && isFinite(this.y) && isFinite(this.width) && isFinite(this.height);
  };
  BoundingRect2.prototype.isZero = function() {
    return this.width === 0 || this.height === 0;
  };
  BoundingRect2.create = function(rect) {
    return new BoundingRect2(rect ? rect.x : 0, rect ? rect.y : 0, rect ? rect.width : 0, rect ? rect.height : 0);
  };
  BoundingRect2.copy = function(target, source) {
    target.x = source.x;
    target.y = source.y;
    target.width = source.width;
    target.height = source.height;
    return target;
  };
  BoundingRect2.applyTransform = function(target, source, m) {
    if (!m) {
      if (target !== source) {
        boundingRectCopy(target, source);
      }
      return;
    }
    if (m[1] < 1e-5 && m[1] > -1e-5 && m[2] < 1e-5 && m[2] > -1e-5) {
      var sx = m[0];
      var sy = m[3];
      var tx = m[4];
      var ty = m[5];
      target.x = source.x * sx + tx;
      target.y = source.y * sy + ty;
      target.width = source.width * sx;
      target.height = source.height * sy;
      if (target.width < 0) {
        target.x += target.width;
        target.width = -target.width;
      }
      if (target.height < 0) {
        target.y += target.height;
        target.height = -target.height;
      }
      return;
    }
    lt.x = lb.x = source.x;
    lt.y = rt.y = source.y;
    rb.x = rt.x = source.x + source.width;
    rb.y = lb.y = source.y + source.height;
    lt.transform(m);
    rt.transform(m);
    rb.transform(m);
    lb.transform(m);
    target.x = mathMin2(lt.x, rb.x, lb.x, rt.x);
    target.y = mathMin2(lt.y, rb.y, lb.y, rt.y);
    var maxX = mathMax2(lt.x, rb.x, lb.x, rt.x);
    var maxY = mathMax2(lt.y, rb.y, lb.y, rt.y);
    target.width = maxX - target.x;
    target.height = maxY - target.y;
  };
  BoundingRect2.calculateTransform = function(out2, a, b) {
    var sx = b.width / a.width;
    var sy = b.height / a.height;
    out2 = identity(out2 || []);
    translate(out2, out2, set(_tmpCalcTrans, -a.x, -a.y));
    scale(out2, out2, set(_tmpCalcTrans, sx, sy));
    translate(out2, out2, set(_tmpCalcTrans, b.x, b.y));
    return out2;
  };
  return BoundingRect2;
})();
var boundingRectCreate = BoundingRect.create;
var boundingRectSet = BoundingRect.set;
var boundingRectCopy = BoundingRect.copy;
var boundingRectCalculateTransform = BoundingRect.calculateTransform;
var boundingRectApplyTransform = BoundingRect.applyTransform;
var boundingRectContain = BoundingRect.contain;
var _tmpIntersectA = new BoundingRect(0, 0, 0, 0);
var _tmpIntersectB = new BoundingRect(0, 0, 0, 0);
var _tmpCalcTrans = [];
function intersectOneDim(a0, a1, b0, b1, updateDimIdx, useMTV, outIntersectRect, clamp) {
  var d0 = mathAbs2(a1 - b0);
  var d1 = mathAbs2(b1 - a0);
  var d01min = mathMin2(d0, d1);
  var updateDim = XY[updateDimIdx];
  var zeroDim = XY[1 - updateDimIdx];
  var wh = WH[updateDimIdx];
  if (a1 < b0 || b1 < a0) {
    if (d0 < d1) {
      if (useMTV) {
        _maxTv[updateDim] = -d0;
      }
      if (clamp) {
        outIntersectRect[updateDim] = a1;
        outIntersectRect[wh] = 0;
      }
    } else {
      if (useMTV) {
        _maxTv[updateDim] = d1;
      }
      if (clamp) {
        outIntersectRect[updateDim] = a0;
        outIntersectRect[wh] = 0;
      }
    }
  } else {
    if (outIntersectRect) {
      outIntersectRect[updateDim] = mathMax2(a0, b0);
      outIntersectRect[wh] = mathMin2(a1, b1) - outIntersectRect[updateDim];
    }
    if (useMTV) {
      if (d01min < _lenMinMax[0] || _intersectCtx.useDir) {
        _lenMinMax[0] = mathMin2(d01min, _lenMinMax[0]);
        if (d0 < d1 || !_intersectCtx.bidirectional) {
          _minTv[updateDim] = d0;
          _minTv[zeroDim] = 0;
          if (_intersectCtx.useDir) {
            _intersectCtx.calcDirMTV();
          }
        }
        if (d0 >= d1 || !_intersectCtx.bidirectional) {
          _minTv[updateDim] = -d1;
          _minTv[zeroDim] = 0;
          if (_intersectCtx.useDir) {
            _intersectCtx.calcDirMTV();
          }
        }
      }
    }
  }
}
function createIntersectContext() {
  var _direction = 0;
  var _dirCheckVec = new Point_default();
  var _dirTmp = new Point_default();
  var _ctx = {
    minTv: new Point_default(),
    maxTv: new Point_default(),
    useDir: false,
    dirMinTv: new Point_default(),
    touchThreshold: 0,
    bidirectional: true,
    negativeSize: false,
    reset: function(opt, useMTV) {
      _ctx.touchThreshold = 0;
      if (opt && opt.touchThreshold != null) {
        _ctx.touchThreshold = mathMax2(0, opt.touchThreshold);
      }
      _ctx.negativeSize = false;
      if (!useMTV) {
        return;
      }
      _ctx.minTv.set(Infinity, Infinity);
      _ctx.maxTv.set(0, 0);
      _ctx.useDir = false;
      if (opt && opt.direction != null) {
        _ctx.useDir = true;
        _ctx.dirMinTv.copy(_ctx.minTv);
        _dirTmp.copy(_ctx.minTv);
        _direction = opt.direction;
        _ctx.bidirectional = opt.bidirectional == null || !!opt.bidirectional;
        if (!_ctx.bidirectional) {
          _dirCheckVec.set(Math.cos(_direction), Math.sin(_direction));
        }
      }
    },
    calcDirMTV: function() {
      var minTv = _ctx.minTv;
      var dirMinTv = _ctx.dirMinTv;
      var squareMag = minTv.y * minTv.y + minTv.x * minTv.x;
      var dirSin = Math.sin(_direction);
      var dirCos = Math.cos(_direction);
      var dotProd = dirSin * minTv.y + dirCos * minTv.x;
      if (nearZero(dotProd)) {
        if (nearZero(minTv.x) && nearZero(minTv.y)) {
          dirMinTv.set(0, 0);
        }
        return;
      }
      _dirTmp.x = squareMag * dirCos / dotProd;
      _dirTmp.y = squareMag * dirSin / dotProd;
      if (nearZero(_dirTmp.x) && nearZero(_dirTmp.y)) {
        dirMinTv.set(0, 0);
        return;
      }
      if ((_ctx.bidirectional || _dirCheckVec.dot(_dirTmp) > 0) && _dirTmp.len() < dirMinTv.len()) {
        dirMinTv.copy(_dirTmp);
      }
    }
  };
  function nearZero(val) {
    return mathAbs2(val) < 1e-10;
  }
  return _ctx;
}
var BoundingRect_default = BoundingRect;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/contain/text.js
function ensureFontMeasureInfo(font) {
  if (!_fontMeasureInfoCache) {
    _fontMeasureInfoCache = new LRU_default(100);
  }
  font = font || DEFAULT_FONT;
  var measureInfo = _fontMeasureInfoCache.get(font);
  if (!measureInfo) {
    measureInfo = {
      font,
      strWidthCache: new LRU_default(500),
      asciiWidthMap: null,
      asciiWidthMapTried: false,
      stWideCharWidth: platformApi.measureText("\u56FD", font).width,
      asciiCharWidth: platformApi.measureText("a", font).width
    };
    _fontMeasureInfoCache.put(font, measureInfo);
  }
  return measureInfo;
}
var _fontMeasureInfoCache;
function tryCreateASCIIWidthMap(font) {
  if (_getASCIIWidthMapLongCount >= GET_ASCII_WIDTH_LONG_COUNT_MAX) {
    return;
  }
  font = font || DEFAULT_FONT;
  var asciiWidthMap = [];
  var start2 = +/* @__PURE__ */ new Date();
  for (var code = 0; code <= 127; code++) {
    asciiWidthMap[code] = platformApi.measureText(String.fromCharCode(code), font).width;
  }
  var cost = +/* @__PURE__ */ new Date() - start2;
  if (cost > 16) {
    _getASCIIWidthMapLongCount = GET_ASCII_WIDTH_LONG_COUNT_MAX;
  } else if (cost > 2) {
    _getASCIIWidthMapLongCount++;
  }
  return asciiWidthMap;
}
var _getASCIIWidthMapLongCount = 0;
var GET_ASCII_WIDTH_LONG_COUNT_MAX = 5;
function measureCharWidth(fontMeasureInfo, charCode) {
  if (!fontMeasureInfo.asciiWidthMapTried) {
    fontMeasureInfo.asciiWidthMap = tryCreateASCIIWidthMap(fontMeasureInfo.font);
    fontMeasureInfo.asciiWidthMapTried = true;
  }
  return 0 <= charCode && charCode <= 127 ? fontMeasureInfo.asciiWidthMap != null ? fontMeasureInfo.asciiWidthMap[charCode] : fontMeasureInfo.asciiCharWidth : fontMeasureInfo.stWideCharWidth;
}
function measureWidth(fontMeasureInfo, text) {
  var strWidthCache = fontMeasureInfo.strWidthCache;
  var width = strWidthCache.get(text);
  if (width == null) {
    width = platformApi.measureText(text, fontMeasureInfo.font).width;
    strWidthCache.put(text, width);
  }
  return width;
}
function innerGetBoundingRect(text, font, textAlign, textBaseline) {
  var width = measureWidth(ensureFontMeasureInfo(font), text);
  var height = getLineHeight(font);
  var x = adjustTextX(0, width, textAlign);
  var y = adjustTextY(0, height, textBaseline);
  var rect = new BoundingRect_default(x, y, width, height);
  return rect;
}
function getBoundingRect(text, font, textAlign, textBaseline) {
  var textLines = ((text || "") + "").split("\n");
  var len2 = textLines.length;
  if (len2 === 1) {
    return innerGetBoundingRect(textLines[0], font, textAlign, textBaseline);
  } else {
    var uniondRect = new BoundingRect_default(0, 0, 0, 0);
    for (var i = 0; i < textLines.length; i++) {
      var rect = innerGetBoundingRect(textLines[i], font, textAlign, textBaseline);
      i === 0 ? uniondRect.copy(rect) : uniondRect.union(rect);
    }
    return uniondRect;
  }
}
function adjustTextX(x, width, textAlign, inverse) {
  if (textAlign === "right") {
    !inverse ? x -= width : x += width;
  } else if (textAlign === "center") {
    !inverse ? x -= width / 2 : x += width / 2;
  }
  return x;
}
function adjustTextY(y, height, verticalAlign, inverse) {
  if (verticalAlign === "middle") {
    !inverse ? y -= height / 2 : y += height / 2;
  } else if (verticalAlign === "bottom") {
    !inverse ? y -= height : y += height;
  }
  return y;
}
function getLineHeight(font) {
  return ensureFontMeasureInfo(font).stWideCharWidth;
}
function parsePercent2(value, maxValue) {
  if (typeof value === "string") {
    if (value.lastIndexOf("%") >= 0) {
      return parseFloat(value) / 100 * maxValue;
    }
    return parseFloat(value);
  }
  return value;
}
function calculateTextPosition(out2, opts, rect) {
  var textPosition = opts.position || "inside";
  var distance2 = opts.distance != null ? opts.distance : 5;
  var height = rect.height;
  var width = rect.width;
  var halfHeight = height / 2;
  var x = rect.x;
  var y = rect.y;
  var textAlign = "left";
  var textVerticalAlign = "top";
  if (textPosition instanceof Array) {
    x += parsePercent2(textPosition[0], rect.width);
    y += parsePercent2(textPosition[1], rect.height);
    textAlign = null;
    textVerticalAlign = null;
  } else {
    switch (textPosition) {
      case "left":
        x -= distance2;
        y += halfHeight;
        textAlign = "right";
        textVerticalAlign = "middle";
        break;
      case "right":
        x += distance2 + width;
        y += halfHeight;
        textVerticalAlign = "middle";
        break;
      case "top":
        x += width / 2;
        y -= distance2;
        textAlign = "center";
        textVerticalAlign = "bottom";
        break;
      case "bottom":
        x += width / 2;
        y += height + distance2;
        textAlign = "center";
        break;
      case "inside":
        x += width / 2;
        y += halfHeight;
        textAlign = "center";
        textVerticalAlign = "middle";
        break;
      case "insideLeft":
        x += distance2;
        y += halfHeight;
        textVerticalAlign = "middle";
        break;
      case "insideRight":
        x += width - distance2;
        y += halfHeight;
        textAlign = "right";
        textVerticalAlign = "middle";
        break;
      case "insideTop":
        x += width / 2;
        y += distance2;
        textAlign = "center";
        break;
      case "insideBottom":
        x += width / 2;
        y += height - distance2;
        textAlign = "center";
        textVerticalAlign = "bottom";
        break;
      case "insideTopLeft":
        x += distance2;
        y += distance2;
        break;
      case "insideTopRight":
        x += width - distance2;
        y += distance2;
        textAlign = "right";
        break;
      case "insideBottomLeft":
        x += distance2;
        y += height - distance2;
        textVerticalAlign = "bottom";
        break;
      case "insideBottomRight":
        x += width - distance2;
        y += height - distance2;
        textAlign = "right";
        textVerticalAlign = "bottom";
        break;
    }
  }
  out2 = out2 || {};
  out2.x = x;
  out2.y = y;
  out2.align = textAlign;
  out2.verticalAlign = textVerticalAlign;
  return out2;
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/graphic/helper/parseText.js
var STYLE_REG = /\{([a-zA-Z0-9_]+)\|([^}]*)\}/g;
function truncateText2(out2, text, containerWidth, font, ellipsis, options) {
  if (!containerWidth) {
    out2.text = "";
    out2.isTruncated = false;
    return;
  }
  var textLines = (text + "").split("\n");
  options = prepareTruncateOptions(containerWidth, font, ellipsis, options);
  var isTruncated = false;
  var truncateOut = {};
  for (var i = 0, len2 = textLines.length; i < len2; i++) {
    truncateSingleLine(truncateOut, textLines[i], options);
    textLines[i] = truncateOut.textLine;
    isTruncated = isTruncated || truncateOut.isTruncated;
  }
  out2.text = textLines.join("\n");
  out2.isTruncated = isTruncated;
}
function prepareTruncateOptions(containerWidth, font, ellipsis, options) {
  options = options || {};
  var preparedOpts = extend({}, options);
  ellipsis = retrieve2(ellipsis, "...");
  preparedOpts.maxIterations = retrieve2(options.maxIterations, 2);
  var minChar = preparedOpts.minChar = retrieve2(options.minChar, 0);
  var fontMeasureInfo = preparedOpts.fontMeasureInfo = ensureFontMeasureInfo(font);
  var ascCharWidth = fontMeasureInfo.asciiCharWidth;
  preparedOpts.placeholder = retrieve2(options.placeholder, "");
  var contentWidth = containerWidth = Math.max(0, containerWidth - 1);
  for (var i = 0; i < minChar && contentWidth >= ascCharWidth; i++) {
    contentWidth -= ascCharWidth;
  }
  var ellipsisWidth = measureWidth(fontMeasureInfo, ellipsis);
  if (ellipsisWidth > contentWidth) {
    ellipsis = "";
    ellipsisWidth = 0;
  }
  contentWidth = containerWidth - ellipsisWidth;
  preparedOpts.ellipsis = ellipsis;
  preparedOpts.ellipsisWidth = ellipsisWidth;
  preparedOpts.contentWidth = contentWidth;
  preparedOpts.containerWidth = containerWidth;
  return preparedOpts;
}
function truncateSingleLine(out2, textLine, options) {
  var containerWidth = options.containerWidth;
  var contentWidth = options.contentWidth;
  var fontMeasureInfo = options.fontMeasureInfo;
  if (!containerWidth) {
    out2.textLine = "";
    out2.isTruncated = false;
    return;
  }
  var lineWidth = measureWidth(fontMeasureInfo, textLine);
  if (lineWidth <= containerWidth) {
    out2.textLine = textLine;
    out2.isTruncated = false;
    return;
  }
  for (var j = 0; ; j++) {
    if (lineWidth <= contentWidth || j >= options.maxIterations) {
      textLine += options.ellipsis;
      break;
    }
    var subLength = j === 0 ? estimateLength(textLine, contentWidth, fontMeasureInfo) : lineWidth > 0 ? Math.floor(textLine.length * contentWidth / lineWidth) : 0;
    textLine = textLine.substr(0, subLength);
    lineWidth = measureWidth(fontMeasureInfo, textLine);
  }
  if (textLine === "") {
    textLine = options.placeholder;
  }
  out2.textLine = textLine;
  out2.isTruncated = true;
}
function estimateLength(text, contentWidth, fontMeasureInfo) {
  var width = 0;
  var i = 0;
  for (var len2 = text.length; i < len2 && width < contentWidth; i++) {
    width += measureCharWidth(fontMeasureInfo, text.charCodeAt(i));
  }
  return i;
}
function parsePlainText(rawText, style, defaultOuterWidth, defaultOuterHeight) {
  var text = formatText(rawText);
  var overflow = style.overflow;
  var padding = style.padding;
  var paddingH = padding ? padding[1] + padding[3] : 0;
  var paddingV = padding ? padding[0] + padding[2] : 0;
  var font = style.font;
  var truncate = overflow === "truncate";
  var calculatedLineHeight = getLineHeight(font);
  var lineHeight = retrieve2(style.lineHeight, calculatedLineHeight);
  var truncateLineOverflow = style.lineOverflow === "truncate";
  var isTruncated = false;
  var width = style.width;
  if (width == null && defaultOuterWidth != null) {
    width = defaultOuterWidth - paddingH;
  }
  var height = style.height;
  if (height == null && defaultOuterHeight != null) {
    height = defaultOuterHeight - paddingV;
  }
  var lines;
  if (width != null && (overflow === "break" || overflow === "breakAll")) {
    lines = text ? wrapText(text, style.font, width, overflow === "breakAll", 0).lines : [];
  } else {
    lines = text ? text.split("\n") : [];
  }
  var contentHeight = lines.length * lineHeight;
  if (height == null) {
    height = contentHeight;
  }
  if (contentHeight > height && truncateLineOverflow) {
    var lineCount = Math.floor(height / lineHeight);
    isTruncated = isTruncated || lines.length > lineCount;
    lines = lines.slice(0, lineCount);
    contentHeight = lines.length * lineHeight;
  }
  if (text && truncate && width != null) {
    var options = prepareTruncateOptions(width, font, style.ellipsis, {
      minChar: style.truncateMinChar,
      placeholder: style.placeholder
    });
    var singleOut = {};
    for (var i = 0; i < lines.length; i++) {
      truncateSingleLine(singleOut, lines[i], options);
      lines[i] = singleOut.textLine;
      isTruncated = isTruncated || singleOut.isTruncated;
    }
  }
  var outerHeight = height;
  var contentWidth = 0;
  var fontMeasureInfo = ensureFontMeasureInfo(font);
  for (var i = 0; i < lines.length; i++) {
    contentWidth = Math.max(measureWidth(fontMeasureInfo, lines[i]), contentWidth);
  }
  if (width == null) {
    width = contentWidth;
  }
  var outerWidth = width;
  outerHeight += paddingV;
  outerWidth += paddingH;
  return {
    lines,
    height,
    outerWidth,
    outerHeight,
    lineHeight,
    calculatedLineHeight,
    contentWidth,
    contentHeight,
    width,
    isTruncated
  };
}
var RichTextToken = /* @__PURE__ */ (function() {
  function RichTextToken2() {
  }
  return RichTextToken2;
})();
var RichTextLine = /* @__PURE__ */ (function() {
  function RichTextLine2(tokens2) {
    this.tokens = [];
    if (tokens2) {
      this.tokens = tokens2;
    }
  }
  return RichTextLine2;
})();
var RichTextContentBlock = /* @__PURE__ */ (function() {
  function RichTextContentBlock2() {
    this.width = 0;
    this.height = 0;
    this.contentWidth = 0;
    this.contentHeight = 0;
    this.outerWidth = 0;
    this.outerHeight = 0;
    this.lines = [];
    this.isTruncated = false;
  }
  return RichTextContentBlock2;
})();
function parseRichText(rawText, style, defaultOuterWidth, defaultOuterHeight, topTextAlign) {
  var contentBlock = new RichTextContentBlock();
  var text = formatText(rawText);
  if (!text) {
    return contentBlock;
  }
  var stlPadding = style.padding;
  var stlPaddingH = stlPadding ? stlPadding[1] + stlPadding[3] : 0;
  var stlPaddingV = stlPadding ? stlPadding[0] + stlPadding[2] : 0;
  var topWidth = style.width;
  if (topWidth == null && defaultOuterWidth != null) {
    topWidth = defaultOuterWidth - stlPaddingH;
  }
  var topHeight = style.height;
  if (topHeight == null && defaultOuterHeight != null) {
    topHeight = defaultOuterHeight - stlPaddingV;
  }
  var overflow = style.overflow;
  var wrapInfo = (overflow === "break" || overflow === "breakAll") && topWidth != null ? { width: topWidth, accumWidth: 0, breakAll: overflow === "breakAll" } : null;
  var lastIndex = STYLE_REG.lastIndex = 0;
  var result;
  while ((result = STYLE_REG.exec(text)) != null) {
    var matchedIndex = result.index;
    if (matchedIndex > lastIndex) {
      pushTokens(contentBlock, text.substring(lastIndex, matchedIndex), style, wrapInfo);
    }
    pushTokens(contentBlock, result[2], style, wrapInfo, result[1]);
    lastIndex = STYLE_REG.lastIndex;
  }
  if (lastIndex < text.length) {
    pushTokens(contentBlock, text.substring(lastIndex, text.length), style, wrapInfo);
  }
  var pendingList = [];
  var calculatedHeight = 0;
  var calculatedWidth = 0;
  var truncate = overflow === "truncate";
  var truncateLine = style.lineOverflow === "truncate";
  var tmpTruncateOut = {};
  function finishLine(line2, lineWidth2, lineHeight2) {
    line2.width = lineWidth2;
    line2.lineHeight = lineHeight2;
    calculatedHeight += lineHeight2;
    calculatedWidth = Math.max(calculatedWidth, lineWidth2);
  }
  outer: for (var i = 0; i < contentBlock.lines.length; i++) {
    var line = contentBlock.lines[i];
    var lineHeight = 0;
    var lineWidth = 0;
    for (var j = 0; j < line.tokens.length; j++) {
      var token = line.tokens[j];
      var tokenStyle = token.styleName && style.rich[token.styleName] || {};
      var textPadding = token.textPadding = tokenStyle.padding;
      var paddingH = textPadding ? textPadding[1] + textPadding[3] : 0;
      var font = token.font = tokenStyle.font || style.font;
      token.contentHeight = getLineHeight(font);
      var tokenHeight = retrieve2(tokenStyle.height, token.contentHeight);
      token.innerHeight = tokenHeight;
      textPadding && (tokenHeight += textPadding[0] + textPadding[2]);
      token.height = tokenHeight;
      token.lineHeight = retrieve3(tokenStyle.lineHeight, style.lineHeight, tokenHeight);
      token.align = tokenStyle && tokenStyle.align || topTextAlign;
      token.verticalAlign = tokenStyle && tokenStyle.verticalAlign || "middle";
      if (truncateLine && topHeight != null && calculatedHeight + token.lineHeight > topHeight) {
        var originalLength = contentBlock.lines.length;
        if (j > 0) {
          line.tokens = line.tokens.slice(0, j);
          finishLine(line, lineWidth, lineHeight);
          contentBlock.lines = contentBlock.lines.slice(0, i + 1);
        } else {
          contentBlock.lines = contentBlock.lines.slice(0, i);
        }
        contentBlock.isTruncated = contentBlock.isTruncated || contentBlock.lines.length < originalLength;
        break outer;
      }
      var styleTokenWidth = tokenStyle.width;
      var tokenWidthNotSpecified = styleTokenWidth == null || styleTokenWidth === "auto";
      if (typeof styleTokenWidth === "string" && styleTokenWidth.charAt(styleTokenWidth.length - 1) === "%") {
        token.percentWidth = styleTokenWidth;
        pendingList.push(token);
        token.contentWidth = measureWidth(ensureFontMeasureInfo(font), token.text);
      } else {
        if (tokenWidthNotSpecified) {
          var textBackgroundColor = tokenStyle.backgroundColor;
          var bgImg = textBackgroundColor && textBackgroundColor.image;
          if (bgImg) {
            bgImg = findExistImage(bgImg);
            if (isImageReady(bgImg)) {
              token.width = Math.max(token.width, bgImg.width * tokenHeight / bgImg.height);
            }
          }
        }
        var remainTruncWidth = truncate && topWidth != null ? topWidth - lineWidth : null;
        if (remainTruncWidth != null && remainTruncWidth < token.width) {
          if (!tokenWidthNotSpecified || remainTruncWidth < paddingH) {
            token.text = "";
            token.width = token.contentWidth = 0;
          } else {
            truncateText2(tmpTruncateOut, token.text, remainTruncWidth - paddingH, font, style.ellipsis, { minChar: style.truncateMinChar });
            token.text = tmpTruncateOut.text;
            contentBlock.isTruncated = contentBlock.isTruncated || tmpTruncateOut.isTruncated;
            token.width = token.contentWidth = measureWidth(ensureFontMeasureInfo(font), token.text);
          }
        } else {
          token.contentWidth = measureWidth(ensureFontMeasureInfo(font), token.text);
        }
      }
      token.width += paddingH;
      lineWidth += token.width;
      tokenStyle && (lineHeight = Math.max(lineHeight, token.lineHeight));
    }
    finishLine(line, lineWidth, lineHeight);
  }
  contentBlock.outerWidth = contentBlock.width = retrieve2(topWidth, calculatedWidth);
  contentBlock.outerHeight = contentBlock.height = retrieve2(topHeight, calculatedHeight);
  contentBlock.contentHeight = calculatedHeight;
  contentBlock.contentWidth = calculatedWidth;
  contentBlock.outerWidth += stlPaddingH;
  contentBlock.outerHeight += stlPaddingV;
  for (var i = 0; i < pendingList.length; i++) {
    var token = pendingList[i];
    var percentWidth = token.percentWidth;
    token.width = parseInt(percentWidth, 10) / 100 * contentBlock.width;
  }
  return contentBlock;
}
function pushTokens(block, str, style, wrapInfo, styleName) {
  var isEmptyStr = str === "";
  var tokenStyle = styleName && style.rich[styleName] || {};
  var lines = block.lines;
  var font = tokenStyle.font || style.font;
  var newLine = false;
  var strLines;
  var linesWidths;
  if (wrapInfo) {
    var tokenPadding = tokenStyle.padding;
    var tokenPaddingH = tokenPadding ? tokenPadding[1] + tokenPadding[3] : 0;
    if (tokenStyle.width != null && tokenStyle.width !== "auto") {
      var outerWidth_1 = parsePercent2(tokenStyle.width, wrapInfo.width) + tokenPaddingH;
      if (lines.length > 0) {
        if (outerWidth_1 + wrapInfo.accumWidth > wrapInfo.width) {
          strLines = str.split("\n");
          newLine = true;
        }
      }
      wrapInfo.accumWidth = outerWidth_1;
    } else {
      var res = wrapText(str, font, wrapInfo.width, wrapInfo.breakAll, wrapInfo.accumWidth);
      wrapInfo.accumWidth = res.accumWidth + tokenPaddingH;
      linesWidths = res.linesWidths;
      strLines = res.lines;
    }
  }
  if (!strLines) {
    strLines = str.split("\n");
  }
  var fontMeasureInfo = ensureFontMeasureInfo(font);
  for (var i = 0; i < strLines.length; i++) {
    var text = strLines[i];
    var token = new RichTextToken();
    token.styleName = styleName;
    token.text = text;
    token.isLineHolder = !text && !isEmptyStr;
    if (typeof tokenStyle.width === "number") {
      token.width = tokenStyle.width;
    } else {
      token.width = linesWidths ? linesWidths[i] : measureWidth(fontMeasureInfo, text);
    }
    if (!i && !newLine) {
      var tokens2 = (lines[lines.length - 1] || (lines[0] = new RichTextLine())).tokens;
      var tokensLen = tokens2.length;
      tokensLen === 1 && tokens2[0].isLineHolder ? tokens2[0] = token : (text || !tokensLen || isEmptyStr) && tokens2.push(token);
    } else {
      lines.push(new RichTextLine([token]));
    }
  }
}
function isAlphabeticLetter(ch) {
  var code = ch.charCodeAt(0);
  return code >= 32 && code <= 591 || code >= 880 && code <= 4351 || code >= 4608 && code <= 5119 || code >= 7680 && code <= 8303;
}
var breakCharMap = reduce(",&?/;] ".split(""), function(obj, ch) {
  obj[ch] = true;
  return obj;
}, {});
function isWordBreakChar(ch) {
  if (isAlphabeticLetter(ch)) {
    if (breakCharMap[ch]) {
      return true;
    }
    return false;
  }
  return true;
}
function wrapText(text, font, lineWidth, isBreakAll, lastAccumWidth) {
  var lines = [];
  var linesWidths = [];
  var line = "";
  var currentWord = "";
  var currentWordWidth = 0;
  var accumWidth = 0;
  var fontMeasureInfo = ensureFontMeasureInfo(font);
  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    if (ch === "\n") {
      if (currentWord) {
        line += currentWord;
        accumWidth += currentWordWidth;
      }
      lines.push(line);
      linesWidths.push(accumWidth);
      line = "";
      currentWord = "";
      currentWordWidth = 0;
      accumWidth = 0;
      continue;
    }
    var chWidth = measureCharWidth(fontMeasureInfo, ch.charCodeAt(0));
    var inWord = isBreakAll ? false : !isWordBreakChar(ch);
    if (!lines.length ? lastAccumWidth + accumWidth + chWidth > lineWidth : accumWidth + chWidth > lineWidth) {
      if (!accumWidth) {
        if (inWord) {
          lines.push(currentWord);
          linesWidths.push(currentWordWidth);
          currentWord = ch;
          currentWordWidth = chWidth;
        } else {
          lines.push(ch);
          linesWidths.push(chWidth);
        }
      } else if (line || currentWord) {
        if (inWord) {
          if (!line) {
            line = currentWord;
            currentWord = "";
            currentWordWidth = 0;
            accumWidth = currentWordWidth;
          }
          lines.push(line);
          linesWidths.push(accumWidth - currentWordWidth);
          currentWord += ch;
          currentWordWidth += chWidth;
          line = "";
          accumWidth = currentWordWidth;
        } else {
          if (currentWord) {
            line += currentWord;
            currentWord = "";
            currentWordWidth = 0;
          }
          lines.push(line);
          linesWidths.push(accumWidth);
          line = ch;
          accumWidth = chWidth;
        }
      }
      continue;
    }
    accumWidth += chWidth;
    if (inWord) {
      currentWord += ch;
      currentWordWidth += chWidth;
    } else {
      if (currentWord) {
        line += currentWord;
        currentWord = "";
        currentWordWidth = 0;
      }
      line += ch;
    }
  }
  if (currentWord) {
    line += currentWord;
  }
  if (line) {
    lines.push(line);
    linesWidths.push(accumWidth);
  }
  if (lines.length === 1) {
    accumWidth += lastAccumWidth;
  }
  return {
    accumWidth,
    lines,
    linesWidths
  };
}
function calcInnerTextOverflowArea(out2, overflowRect, baseX, baseY, textAlign, textVerticalAlign) {
  out2.baseX = baseX;
  out2.baseY = baseY;
  out2.outerWidth = out2.outerHeight = null;
  if (!overflowRect) {
    return;
  }
  var textWidth = overflowRect.width * 2;
  var textHeight = overflowRect.height * 2;
  BoundingRect_default.set(tmpCITCTextRect, adjustTextX(baseX, textWidth, textAlign), adjustTextY(baseY, textHeight, textVerticalAlign), textWidth, textHeight);
  BoundingRect_default.intersect(overflowRect, tmpCITCTextRect, null, tmpCITCIntersectRectOpt);
  var outIntersectRect = tmpCITCIntersectRectOpt.outIntersectRect;
  out2.outerWidth = outIntersectRect.width;
  out2.outerHeight = outIntersectRect.height;
  out2.baseX = adjustTextX(outIntersectRect.x, outIntersectRect.width, textAlign, true);
  out2.baseY = adjustTextY(outIntersectRect.y, outIntersectRect.height, textVerticalAlign, true);
}
var tmpCITCTextRect = new BoundingRect_default(0, 0, 0, 0);
var tmpCITCIntersectRectOpt = { outIntersectRect: {}, clamp: true };
function formatText(text) {
  return text != null ? text += "" : text = "";
}
function tSpanCreateBoundingRect(style) {
  var text = formatText(style.text);
  var font = style.font;
  var contentWidth = measureWidth(ensureFontMeasureInfo(font), text);
  var contentHeight = getLineHeight(font);
  return tSpanCreateBoundingRect2(style, contentWidth, contentHeight, null);
}
function tSpanCreateBoundingRect2(style, contentWidth, contentHeight, forceLineWidth) {
  var rect = new BoundingRect_default(adjustTextX(style.x || 0, contentWidth, style.textAlign), adjustTextY(style.y || 0, contentHeight, style.textBaseline), contentWidth, contentHeight);
  var lineWidth = forceLineWidth != null ? forceLineWidth : tSpanHasStroke(style) ? style.lineWidth : 0;
  if (lineWidth > 0) {
    rect.x -= lineWidth / 2;
    rect.y -= lineWidth / 2;
    rect.width += lineWidth;
    rect.height += lineWidth;
  }
  return rect;
}
function tSpanHasStroke(style) {
  var stroke = style.stroke;
  return stroke != null && stroke !== "none" && style.lineWidth > 0;
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/core/Transformable.js
var mIdentity = identity;
var EPSILON2 = 5e-5;
function isNotAroundZero(val) {
  return val > EPSILON2 || val < -EPSILON2;
}
var scaleTmp = [];
var tmpTransform = [];
var originTransform = create();
var abs = Math.abs;
var Transformable = (function() {
  function Transformable2() {
  }
  Transformable2.prototype.getLocalTransform = function(m) {
    return transformableGetLocalTransform(this, m);
  };
  Transformable2.prototype.setPosition = function(arr) {
    this.x = arr[0];
    this.y = arr[1];
  };
  Transformable2.prototype.setScale = function(arr) {
    this.scaleX = arr[0];
    this.scaleY = arr[1];
  };
  Transformable2.prototype.setSkew = function(arr) {
    this.skewX = arr[0];
    this.skewY = arr[1];
  };
  Transformable2.prototype.setOrigin = function(arr) {
    this.originX = arr[0];
    this.originY = arr[1];
  };
  Transformable2.prototype.needLocalTransform = function() {
    return isNotAroundZero(this.rotation) || isNotAroundZero(this.x) || isNotAroundZero(this.y) || isNotAroundZero(this.scaleX - 1) || isNotAroundZero(this.scaleY - 1) || isNotAroundZero(this.skewX) || isNotAroundZero(this.skewY);
  };
  Transformable2.prototype.updateTransform = function() {
    var parentTransform = this.parent && this.parent.transform;
    var needLocalTransform = this.needLocalTransform();
    var m = this.transform;
    if (!(needLocalTransform || parentTransform)) {
      if (m) {
        mIdentity(m);
        this.invTransform = null;
      }
      return;
    }
    m = m || create();
    if (needLocalTransform) {
      this.getLocalTransform(m);
    } else {
      mIdentity(m);
    }
    if (parentTransform) {
      if (needLocalTransform) {
        mul(m, parentTransform, m);
      } else {
        copy(m, parentTransform);
      }
    }
    this.transform = m;
    this._resolveGlobalScaleRatio(m);
    this.invTransform = this.invTransform || create();
    invert(this.invTransform, m);
  };
  Transformable2.prototype._resolveGlobalScaleRatio = function(m) {
    var globalScaleRatio = this.globalScaleRatio;
    if (globalScaleRatio != null && globalScaleRatio !== 1) {
      this.getGlobalScale(scaleTmp);
      var relX = scaleTmp[0] < 0 ? -1 : 1;
      var relY = scaleTmp[1] < 0 ? -1 : 1;
      var sx = ((scaleTmp[0] - relX) * globalScaleRatio + relX) / scaleTmp[0] || 0;
      var sy = ((scaleTmp[1] - relY) * globalScaleRatio + relY) / scaleTmp[1] || 0;
      m[0] *= sx;
      m[1] *= sx;
      m[2] *= sy;
      m[3] *= sy;
    }
  };
  Transformable2.prototype.getComputedTransform = function() {
    var transformNode = this;
    var ancestors = [];
    while (transformNode) {
      ancestors.push(transformNode);
      transformNode = transformNode.parent;
    }
    while (transformNode = ancestors.pop()) {
      transformNode.updateTransform();
    }
    return this.transform;
  };
  Transformable2.prototype.setLocalTransform = function(m) {
    if (!m) {
      return;
    }
    var sx = m[0] * m[0] + m[1] * m[1];
    var sy = m[2] * m[2] + m[3] * m[3];
    var rotation = Math.atan2(m[1], m[0]);
    var shearX = Math.PI / 2 + rotation - Math.atan2(m[3], m[2]);
    sy = Math.sqrt(sy) * Math.cos(shearX);
    sx = Math.sqrt(sx);
    this.skewX = shearX;
    this.skewY = 0;
    this.rotation = -rotation;
    this.x = +m[4];
    this.y = +m[5];
    this.scaleX = sx;
    this.scaleY = sy;
    this.originX = 0;
    this.originY = 0;
  };
  Transformable2.prototype.decomposeTransform = function() {
    if (!this.transform) {
      return;
    }
    var parent = this.parent;
    var m = this.transform;
    if (parent && parent.transform) {
      parent.invTransform = parent.invTransform || create();
      mul(tmpTransform, parent.invTransform, m);
      m = tmpTransform;
    }
    var ox = this.originX;
    var oy = this.originY;
    if (ox || oy) {
      originTransform[4] = ox;
      originTransform[5] = oy;
      mul(tmpTransform, m, originTransform);
      tmpTransform[4] -= ox;
      tmpTransform[5] -= oy;
      m = tmpTransform;
    }
    this.setLocalTransform(m);
  };
  Transformable2.prototype.getGlobalScale = function(out2) {
    var m = this.transform;
    out2 = out2 || [];
    if (!m) {
      out2[0] = 1;
      out2[1] = 1;
      return out2;
    }
    out2[0] = Math.sqrt(m[0] * m[0] + m[1] * m[1]);
    out2[1] = Math.sqrt(m[2] * m[2] + m[3] * m[3]);
    if (m[0] < 0) {
      out2[0] = -out2[0];
    }
    if (m[3] < 0) {
      out2[1] = -out2[1];
    }
    return out2;
  };
  Transformable2.prototype.transformCoordToLocal = function(x, y) {
    var v2 = [x, y];
    var invTransform = this.invTransform;
    if (invTransform) {
      applyTransform(v2, v2, invTransform);
    }
    return v2;
  };
  Transformable2.prototype.transformCoordToGlobal = function(x, y) {
    var v2 = [x, y];
    var transform = this.transform;
    if (transform) {
      applyTransform(v2, v2, transform);
    }
    return v2;
  };
  Transformable2.prototype.getLineScale = function() {
    var m = this.transform;
    return m && abs(m[0] - 1) > 1e-10 && abs(m[3] - 1) > 1e-10 ? Math.sqrt(abs(m[0] * m[3] - m[2] * m[1])) : 1;
  };
  Transformable2.prototype.copyTransform = function(source) {
    copyTransform(this, source);
  };
  Transformable2.getLocalTransform = function(target, m) {
    m = m || [];
    var ox = target.originX || 0;
    var oy = target.originY || 0;
    var sx = target.scaleX;
    var sy = target.scaleY;
    var ax = target.anchorX;
    var ay = target.anchorY;
    var rotation = target.rotation || 0;
    var x = target.x;
    var y = target.y;
    var skewX = target.skewX ? Math.tan(target.skewX) : 0;
    var skewY = target.skewY ? Math.tan(-target.skewY) : 0;
    if (ox || oy || ax || ay) {
      var dx = ox + ax;
      var dy = oy + ay;
      m[4] = -dx * sx - skewX * dy * sy;
      m[5] = -dy * sy - skewY * dx * sx;
    } else {
      m[4] = m[5] = 0;
    }
    m[0] = sx;
    m[3] = sy;
    m[1] = skewY * sx;
    m[2] = skewX * sy;
    rotation && rotate(m, m, rotation);
    m[4] += ox + x;
    m[5] += oy + y;
    return m;
  };
  Transformable2.initDefaultProps = (function() {
    var proto = Transformable2.prototype;
    proto.scaleX = proto.scaleY = proto.globalScaleRatio = 1;
    proto.x = proto.y = proto.originX = proto.originY = proto.skewX = proto.skewY = proto.rotation = proto.anchorX = proto.anchorY = 0;
  })();
  return Transformable2;
})();
var transformableGetLocalTransform = Transformable.getLocalTransform;
var TRANSFORMABLE_PROPS = [
  "x",
  "y",
  "originX",
  "originY",
  "anchorX",
  "anchorY",
  "rotation",
  "scaleX",
  "scaleY",
  "skewX",
  "skewY"
];
function copyTransform(target, source) {
  return assignProps(target, source, TRANSFORMABLE_PROPS);
}
var Transformable_default = Transformable;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/animation/easing.js
var easingFuncs = {
  linear: function(k) {
    return k;
  },
  quadraticIn: function(k) {
    return k * k;
  },
  quadraticOut: function(k) {
    return k * (2 - k);
  },
  quadraticInOut: function(k) {
    if ((k *= 2) < 1) {
      return 0.5 * k * k;
    }
    return -0.5 * (--k * (k - 2) - 1);
  },
  cubicIn: function(k) {
    return k * k * k;
  },
  cubicOut: function(k) {
    return --k * k * k + 1;
  },
  cubicInOut: function(k) {
    if ((k *= 2) < 1) {
      return 0.5 * k * k * k;
    }
    return 0.5 * ((k -= 2) * k * k + 2);
  },
  quarticIn: function(k) {
    return k * k * k * k;
  },
  quarticOut: function(k) {
    return 1 - --k * k * k * k;
  },
  quarticInOut: function(k) {
    if ((k *= 2) < 1) {
      return 0.5 * k * k * k * k;
    }
    return -0.5 * ((k -= 2) * k * k * k - 2);
  },
  quinticIn: function(k) {
    return k * k * k * k * k;
  },
  quinticOut: function(k) {
    return --k * k * k * k * k + 1;
  },
  quinticInOut: function(k) {
    if ((k *= 2) < 1) {
      return 0.5 * k * k * k * k * k;
    }
    return 0.5 * ((k -= 2) * k * k * k * k + 2);
  },
  sinusoidalIn: function(k) {
    return 1 - Math.cos(k * Math.PI / 2);
  },
  sinusoidalOut: function(k) {
    return Math.sin(k * Math.PI / 2);
  },
  sinusoidalInOut: function(k) {
    return 0.5 * (1 - Math.cos(Math.PI * k));
  },
  exponentialIn: function(k) {
    return k === 0 ? 0 : Math.pow(1024, k - 1);
  },
  exponentialOut: function(k) {
    return k === 1 ? 1 : 1 - Math.pow(2, -10 * k);
  },
  exponentialInOut: function(k) {
    if (k === 0) {
      return 0;
    }
    if (k === 1) {
      return 1;
    }
    if ((k *= 2) < 1) {
      return 0.5 * Math.pow(1024, k - 1);
    }
    return 0.5 * (-Math.pow(2, -10 * (k - 1)) + 2);
  },
  circularIn: function(k) {
    return 1 - Math.sqrt(1 - k * k);
  },
  circularOut: function(k) {
    return Math.sqrt(1 - --k * k);
  },
  circularInOut: function(k) {
    if ((k *= 2) < 1) {
      return -0.5 * (Math.sqrt(1 - k * k) - 1);
    }
    return 0.5 * (Math.sqrt(1 - (k -= 2) * k) + 1);
  },
  elasticIn: function(k) {
    var s;
    var a = 0.1;
    var p = 0.4;
    if (k === 0) {
      return 0;
    }
    if (k === 1) {
      return 1;
    }
    if (!a || a < 1) {
      a = 1;
      s = p / 4;
    } else {
      s = p * Math.asin(1 / a) / (2 * Math.PI);
    }
    return -(a * Math.pow(2, 10 * (k -= 1)) * Math.sin((k - s) * (2 * Math.PI) / p));
  },
  elasticOut: function(k) {
    var s;
    var a = 0.1;
    var p = 0.4;
    if (k === 0) {
      return 0;
    }
    if (k === 1) {
      return 1;
    }
    if (!a || a < 1) {
      a = 1;
      s = p / 4;
    } else {
      s = p * Math.asin(1 / a) / (2 * Math.PI);
    }
    return a * Math.pow(2, -10 * k) * Math.sin((k - s) * (2 * Math.PI) / p) + 1;
  },
  elasticInOut: function(k) {
    var s;
    var a = 0.1;
    var p = 0.4;
    if (k === 0) {
      return 0;
    }
    if (k === 1) {
      return 1;
    }
    if (!a || a < 1) {
      a = 1;
      s = p / 4;
    } else {
      s = p * Math.asin(1 / a) / (2 * Math.PI);
    }
    if ((k *= 2) < 1) {
      return -0.5 * (a * Math.pow(2, 10 * (k -= 1)) * Math.sin((k - s) * (2 * Math.PI) / p));
    }
    return a * Math.pow(2, -10 * (k -= 1)) * Math.sin((k - s) * (2 * Math.PI) / p) * 0.5 + 1;
  },
  backIn: function(k) {
    var s = 1.70158;
    return k * k * ((s + 1) * k - s);
  },
  backOut: function(k) {
    var s = 1.70158;
    return --k * k * ((s + 1) * k + s) + 1;
  },
  backInOut: function(k) {
    var s = 1.70158 * 1.525;
    if ((k *= 2) < 1) {
      return 0.5 * (k * k * ((s + 1) * k - s));
    }
    return 0.5 * ((k -= 2) * k * ((s + 1) * k + s) + 2);
  },
  bounceIn: function(k) {
    return 1 - easingFuncs.bounceOut(1 - k);
  },
  bounceOut: function(k) {
    if (k < 1 / 2.75) {
      return 7.5625 * k * k;
    } else if (k < 2 / 2.75) {
      return 7.5625 * (k -= 1.5 / 2.75) * k + 0.75;
    } else if (k < 2.5 / 2.75) {
      return 7.5625 * (k -= 2.25 / 2.75) * k + 0.9375;
    } else {
      return 7.5625 * (k -= 2.625 / 2.75) * k + 0.984375;
    }
  },
  bounceInOut: function(k) {
    if (k < 0.5) {
      return easingFuncs.bounceIn(k * 2) * 0.5;
    }
    return easingFuncs.bounceOut(k * 2 - 1) * 0.5 + 0.5;
  }
};
var easing_default = easingFuncs;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/core/curve.js
var mathPow2 = Math.pow;
var mathSqrt = Math.sqrt;
var EPSILON3 = 1e-8;
var EPSILON_NUMERIC = 1e-4;
var THREE_SQRT = mathSqrt(3);
var ONE_THIRD = 1 / 3;
var _v0 = create2();
var _v1 = create2();
var _v2 = create2();
function isAroundZero(val) {
  return val > -EPSILON3 && val < EPSILON3;
}
function isNotAroundZero2(val) {
  return val > EPSILON3 || val < -EPSILON3;
}
function cubicAt(p0, p1, p2, p3, t) {
  var onet = 1 - t;
  return onet * onet * (onet * p0 + 3 * t * p1) + t * t * (t * p3 + 3 * onet * p2);
}
function cubicDerivativeAt(p0, p1, p2, p3, t) {
  var onet = 1 - t;
  return 3 * (((p1 - p0) * onet + 2 * (p2 - p1) * t) * onet + (p3 - p2) * t * t);
}
function cubicRootAt(p0, p1, p2, p3, val, roots2) {
  var a = p3 + 3 * (p1 - p2) - p0;
  var b = 3 * (p2 - p1 * 2 + p0);
  var c = 3 * (p1 - p0);
  var d = p0 - val;
  var A = b * b - 3 * a * c;
  var B = b * c - 9 * a * d;
  var C = c * c - 3 * b * d;
  var n = 0;
  if (isAroundZero(A) && isAroundZero(B)) {
    if (isAroundZero(b)) {
      roots2[0] = 0;
    } else {
      var t1 = -c / b;
      if (t1 >= 0 && t1 <= 1) {
        roots2[n++] = t1;
      }
    }
  } else {
    var disc = B * B - 4 * A * C;
    if (isAroundZero(disc)) {
      var K = B / A;
      var t1 = -b / a + K;
      var t2 = -K / 2;
      if (t1 >= 0 && t1 <= 1) {
        roots2[n++] = t1;
      }
      if (t2 >= 0 && t2 <= 1) {
        roots2[n++] = t2;
      }
    } else if (disc > 0) {
      var discSqrt = mathSqrt(disc);
      var Y1 = A * b + 1.5 * a * (-B + discSqrt);
      var Y2 = A * b + 1.5 * a * (-B - discSqrt);
      if (Y1 < 0) {
        Y1 = -mathPow2(-Y1, ONE_THIRD);
      } else {
        Y1 = mathPow2(Y1, ONE_THIRD);
      }
      if (Y2 < 0) {
        Y2 = -mathPow2(-Y2, ONE_THIRD);
      } else {
        Y2 = mathPow2(Y2, ONE_THIRD);
      }
      var t1 = (-b - (Y1 + Y2)) / (3 * a);
      if (t1 >= 0 && t1 <= 1) {
        roots2[n++] = t1;
      }
    } else {
      var T = (2 * A * b - 3 * a * B) / (2 * mathSqrt(A * A * A));
      var theta = Math.acos(T) / 3;
      var ASqrt = mathSqrt(A);
      var tmp = Math.cos(theta);
      var t1 = (-b - 2 * ASqrt * tmp) / (3 * a);
      var t2 = (-b + ASqrt * (tmp + THREE_SQRT * Math.sin(theta))) / (3 * a);
      var t3 = (-b + ASqrt * (tmp - THREE_SQRT * Math.sin(theta))) / (3 * a);
      if (t1 >= 0 && t1 <= 1) {
        roots2[n++] = t1;
      }
      if (t2 >= 0 && t2 <= 1) {
        roots2[n++] = t2;
      }
      if (t3 >= 0 && t3 <= 1) {
        roots2[n++] = t3;
      }
    }
  }
  return n;
}
function cubicExtrema(p0, p1, p2, p3, extrema2) {
  var b = 6 * p2 - 12 * p1 + 6 * p0;
  var a = 9 * p1 + 3 * p3 - 3 * p0 - 9 * p2;
  var c = 3 * p1 - 3 * p0;
  var n = 0;
  if (isAroundZero(a)) {
    if (isNotAroundZero2(b)) {
      var t1 = -c / b;
      if (t1 >= 0 && t1 <= 1) {
        extrema2[n++] = t1;
      }
    }
  } else {
    var disc = b * b - 4 * a * c;
    if (isAroundZero(disc)) {
      extrema2[0] = -b / (2 * a);
    } else if (disc > 0) {
      var discSqrt = mathSqrt(disc);
      var t1 = (-b + discSqrt) / (2 * a);
      var t2 = (-b - discSqrt) / (2 * a);
      if (t1 >= 0 && t1 <= 1) {
        extrema2[n++] = t1;
      }
      if (t2 >= 0 && t2 <= 1) {
        extrema2[n++] = t2;
      }
    }
  }
  return n;
}
function cubicSubdivide(p0, p1, p2, p3, t, out2) {
  var p01 = (p1 - p0) * t + p0;
  var p12 = (p2 - p1) * t + p1;
  var p23 = (p3 - p2) * t + p2;
  var p012 = (p12 - p01) * t + p01;
  var p123 = (p23 - p12) * t + p12;
  var p0123 = (p123 - p012) * t + p012;
  out2[0] = p0;
  out2[1] = p01;
  out2[2] = p012;
  out2[3] = p0123;
  out2[4] = p0123;
  out2[5] = p123;
  out2[6] = p23;
  out2[7] = p3;
}
function cubicProjectPoint(x0, y0, x1, y1, x2, y2, x3, y3, x, y, out2) {
  var t;
  var interval = 5e-3;
  var d = Infinity;
  var prev;
  var next;
  var d1;
  var d2;
  _v0[0] = x;
  _v0[1] = y;
  for (var _t = 0; _t < 1; _t += 0.05) {
    _v1[0] = cubicAt(x0, x1, x2, x3, _t);
    _v1[1] = cubicAt(y0, y1, y2, y3, _t);
    d1 = distSquare(_v0, _v1);
    if (d1 < d) {
      t = _t;
      d = d1;
    }
  }
  d = Infinity;
  for (var i = 0; i < 32; i++) {
    if (interval < EPSILON_NUMERIC) {
      break;
    }
    prev = t - interval;
    next = t + interval;
    _v1[0] = cubicAt(x0, x1, x2, x3, prev);
    _v1[1] = cubicAt(y0, y1, y2, y3, prev);
    d1 = distSquare(_v1, _v0);
    if (prev >= 0 && d1 < d) {
      t = prev;
      d = d1;
    } else {
      _v2[0] = cubicAt(x0, x1, x2, x3, next);
      _v2[1] = cubicAt(y0, y1, y2, y3, next);
      d2 = distSquare(_v2, _v0);
      if (next <= 1 && d2 < d) {
        t = next;
        d = d2;
      } else {
        interval *= 0.5;
      }
    }
  }
  if (out2) {
    out2[0] = cubicAt(x0, x1, x2, x3, t);
    out2[1] = cubicAt(y0, y1, y2, y3, t);
  }
  return mathSqrt(d);
}
function cubicLength(x0, y0, x1, y1, x2, y2, x3, y3, iteration) {
  var px = x0;
  var py = y0;
  var d = 0;
  var step = 1 / iteration;
  for (var i = 1; i <= iteration; i++) {
    var t = i * step;
    var x = cubicAt(x0, x1, x2, x3, t);
    var y = cubicAt(y0, y1, y2, y3, t);
    var dx = x - px;
    var dy = y - py;
    d += Math.sqrt(dx * dx + dy * dy);
    px = x;
    py = y;
  }
  return d;
}
function quadraticAt(p0, p1, p2, t) {
  var onet = 1 - t;
  return onet * (onet * p0 + 2 * t * p1) + t * t * p2;
}
function quadraticDerivativeAt(p0, p1, p2, t) {
  return 2 * ((1 - t) * (p1 - p0) + t * (p2 - p1));
}
function quadraticRootAt(p0, p1, p2, val, roots2) {
  var a = p0 - 2 * p1 + p2;
  var b = 2 * (p1 - p0);
  var c = p0 - val;
  var n = 0;
  if (isAroundZero(a)) {
    if (isNotAroundZero2(b)) {
      var t1 = -c / b;
      if (t1 >= 0 && t1 <= 1) {
        roots2[n++] = t1;
      }
    }
  } else {
    var disc = b * b - 4 * a * c;
    if (isAroundZero(disc)) {
      var t1 = -b / (2 * a);
      if (t1 >= 0 && t1 <= 1) {
        roots2[n++] = t1;
      }
    } else if (disc > 0) {
      var discSqrt = mathSqrt(disc);
      var t1 = (-b + discSqrt) / (2 * a);
      var t2 = (-b - discSqrt) / (2 * a);
      if (t1 >= 0 && t1 <= 1) {
        roots2[n++] = t1;
      }
      if (t2 >= 0 && t2 <= 1) {
        roots2[n++] = t2;
      }
    }
  }
  return n;
}
function quadraticExtremum(p0, p1, p2) {
  var divider = p0 + p2 - 2 * p1;
  if (divider === 0) {
    return 0.5;
  } else {
    return (p0 - p1) / divider;
  }
}
function quadraticSubdivide(p0, p1, p2, t, out2) {
  var p01 = (p1 - p0) * t + p0;
  var p12 = (p2 - p1) * t + p1;
  var p012 = (p12 - p01) * t + p01;
  out2[0] = p0;
  out2[1] = p01;
  out2[2] = p012;
  out2[3] = p012;
  out2[4] = p12;
  out2[5] = p2;
}
function quadraticProjectPoint(x0, y0, x1, y1, x2, y2, x, y, out2) {
  var t;
  var interval = 5e-3;
  var d = Infinity;
  _v0[0] = x;
  _v0[1] = y;
  for (var _t = 0; _t < 1; _t += 0.05) {
    _v1[0] = quadraticAt(x0, x1, x2, _t);
    _v1[1] = quadraticAt(y0, y1, y2, _t);
    var d1 = distSquare(_v0, _v1);
    if (d1 < d) {
      t = _t;
      d = d1;
    }
  }
  d = Infinity;
  for (var i = 0; i < 32; i++) {
    if (interval < EPSILON_NUMERIC) {
      break;
    }
    var prev = t - interval;
    var next = t + interval;
    _v1[0] = quadraticAt(x0, x1, x2, prev);
    _v1[1] = quadraticAt(y0, y1, y2, prev);
    var d1 = distSquare(_v1, _v0);
    if (prev >= 0 && d1 < d) {
      t = prev;
      d = d1;
    } else {
      _v2[0] = quadraticAt(x0, x1, x2, next);
      _v2[1] = quadraticAt(y0, y1, y2, next);
      var d2 = distSquare(_v2, _v0);
      if (next <= 1 && d2 < d) {
        t = next;
        d = d2;
      } else {
        interval *= 0.5;
      }
    }
  }
  if (out2) {
    out2[0] = quadraticAt(x0, x1, x2, t);
    out2[1] = quadraticAt(y0, y1, y2, t);
  }
  return mathSqrt(d);
}
function quadraticLength(x0, y0, x1, y1, x2, y2, iteration) {
  var px = x0;
  var py = y0;
  var d = 0;
  var step = 1 / iteration;
  for (var i = 1; i <= iteration; i++) {
    var t = i * step;
    var x = quadraticAt(x0, x1, x2, t);
    var y = quadraticAt(y0, y1, y2, t);
    var dx = x - px;
    var dy = y - py;
    d += Math.sqrt(dx * dx + dy * dy);
    px = x;
    py = y;
  }
  return d;
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/animation/cubicEasing.js
var regexp = /cubic-bezier\(([0-9,\.e ]+)\)/;
function createCubicEasingFunc(cubicEasingStr) {
  var cubic = cubicEasingStr && regexp.exec(cubicEasingStr);
  if (cubic) {
    var points2 = cubic[1].split(",");
    var a_1 = +trim(points2[0]);
    var b_1 = +trim(points2[1]);
    var c_1 = +trim(points2[2]);
    var d_1 = +trim(points2[3]);
    if (isNaN(a_1 + b_1 + c_1 + d_1)) {
      return;
    }
    var roots_1 = [];
    return function(p) {
      return p <= 0 ? 0 : p >= 1 ? 1 : cubicRootAt(0, a_1, c_1, 1, p, roots_1) && cubicAt(0, b_1, d_1, 1, roots_1[0]);
    };
  }
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/animation/Clip.js
var Clip = (function() {
  function Clip2(opts) {
    this._inited = false;
    this._startTime = 0;
    this._pausedTime = 0;
    this._paused = false;
    this._life = opts.life || 1e3;
    this._delay = opts.delay || 0;
    this.loop = opts.loop || false;
    this.onframe = opts.onframe || noop;
    this.ondestroy = opts.ondestroy || noop;
    this.onrestart = opts.onrestart || noop;
    opts.easing && this.setEasing(opts.easing);
  }
  Clip2.prototype.step = function(globalTime, deltaTime) {
    if (!this._inited) {
      this._startTime = globalTime + this._delay;
      this._inited = true;
    }
    if (this._paused) {
      this._pausedTime += deltaTime;
      return;
    }
    var life = this._life;
    var elapsedTime = globalTime - this._startTime - this._pausedTime;
    var percent = elapsedTime / life;
    if (percent < 0) {
      percent = 0;
    }
    percent = Math.min(percent, 1);
    var easingFunc = this.easingFunc;
    var schedule = easingFunc ? easingFunc(percent) : percent;
    this.onframe(schedule);
    if (percent === 1) {
      if (this.loop) {
        var remainder = elapsedTime % life;
        this._startTime = globalTime - remainder;
        this._pausedTime = 0;
        this.onrestart();
      } else {
        return true;
      }
    }
    return false;
  };
  Clip2.prototype.pause = function() {
    this._paused = true;
  };
  Clip2.prototype.resume = function() {
    this._paused = false;
  };
  Clip2.prototype.setEasing = function(easing) {
    this.easing = easing;
    this.easingFunc = isFunction(easing) ? easing : easing_default[easing] || createCubicEasingFunc(easing);
  };
  return Clip2;
})();
var Clip_default = Clip;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/tool/color.js
var kCSSColorTable = {
  "transparent": [0, 0, 0, 0],
  "aliceblue": [240, 248, 255, 1],
  "antiquewhite": [250, 235, 215, 1],
  "aqua": [0, 255, 255, 1],
  "aquamarine": [127, 255, 212, 1],
  "azure": [240, 255, 255, 1],
  "beige": [245, 245, 220, 1],
  "bisque": [255, 228, 196, 1],
  "black": [0, 0, 0, 1],
  "blanchedalmond": [255, 235, 205, 1],
  "blue": [0, 0, 255, 1],
  "blueviolet": [138, 43, 226, 1],
  "brown": [165, 42, 42, 1],
  "burlywood": [222, 184, 135, 1],
  "cadetblue": [95, 158, 160, 1],
  "chartreuse": [127, 255, 0, 1],
  "chocolate": [210, 105, 30, 1],
  "coral": [255, 127, 80, 1],
  "cornflowerblue": [100, 149, 237, 1],
  "cornsilk": [255, 248, 220, 1],
  "crimson": [220, 20, 60, 1],
  "cyan": [0, 255, 255, 1],
  "darkblue": [0, 0, 139, 1],
  "darkcyan": [0, 139, 139, 1],
  "darkgoldenrod": [184, 134, 11, 1],
  "darkgray": [169, 169, 169, 1],
  "darkgreen": [0, 100, 0, 1],
  "darkgrey": [169, 169, 169, 1],
  "darkkhaki": [189, 183, 107, 1],
  "darkmagenta": [139, 0, 139, 1],
  "darkolivegreen": [85, 107, 47, 1],
  "darkorange": [255, 140, 0, 1],
  "darkorchid": [153, 50, 204, 1],
  "darkred": [139, 0, 0, 1],
  "darksalmon": [233, 150, 122, 1],
  "darkseagreen": [143, 188, 143, 1],
  "darkslateblue": [72, 61, 139, 1],
  "darkslategray": [47, 79, 79, 1],
  "darkslategrey": [47, 79, 79, 1],
  "darkturquoise": [0, 206, 209, 1],
  "darkviolet": [148, 0, 211, 1],
  "deeppink": [255, 20, 147, 1],
  "deepskyblue": [0, 191, 255, 1],
  "dimgray": [105, 105, 105, 1],
  "dimgrey": [105, 105, 105, 1],
  "dodgerblue": [30, 144, 255, 1],
  "firebrick": [178, 34, 34, 1],
  "floralwhite": [255, 250, 240, 1],
  "forestgreen": [34, 139, 34, 1],
  "fuchsia": [255, 0, 255, 1],
  "gainsboro": [220, 220, 220, 1],
  "ghostwhite": [248, 248, 255, 1],
  "gold": [255, 215, 0, 1],
  "goldenrod": [218, 165, 32, 1],
  "gray": [128, 128, 128, 1],
  "green": [0, 128, 0, 1],
  "greenyellow": [173, 255, 47, 1],
  "grey": [128, 128, 128, 1],
  "honeydew": [240, 255, 240, 1],
  "hotpink": [255, 105, 180, 1],
  "indianred": [205, 92, 92, 1],
  "indigo": [75, 0, 130, 1],
  "ivory": [255, 255, 240, 1],
  "khaki": [240, 230, 140, 1],
  "lavender": [230, 230, 250, 1],
  "lavenderblush": [255, 240, 245, 1],
  "lawngreen": [124, 252, 0, 1],
  "lemonchiffon": [255, 250, 205, 1],
  "lightblue": [173, 216, 230, 1],
  "lightcoral": [240, 128, 128, 1],
  "lightcyan": [224, 255, 255, 1],
  "lightgoldenrodyellow": [250, 250, 210, 1],
  "lightgray": [211, 211, 211, 1],
  "lightgreen": [144, 238, 144, 1],
  "lightgrey": [211, 211, 211, 1],
  "lightpink": [255, 182, 193, 1],
  "lightsalmon": [255, 160, 122, 1],
  "lightseagreen": [32, 178, 170, 1],
  "lightskyblue": [135, 206, 250, 1],
  "lightslategray": [119, 136, 153, 1],
  "lightslategrey": [119, 136, 153, 1],
  "lightsteelblue": [176, 196, 222, 1],
  "lightyellow": [255, 255, 224, 1],
  "lime": [0, 255, 0, 1],
  "limegreen": [50, 205, 50, 1],
  "linen": [250, 240, 230, 1],
  "magenta": [255, 0, 255, 1],
  "maroon": [128, 0, 0, 1],
  "mediumaquamarine": [102, 205, 170, 1],
  "mediumblue": [0, 0, 205, 1],
  "mediumorchid": [186, 85, 211, 1],
  "mediumpurple": [147, 112, 219, 1],
  "mediumseagreen": [60, 179, 113, 1],
  "mediumslateblue": [123, 104, 238, 1],
  "mediumspringgreen": [0, 250, 154, 1],
  "mediumturquoise": [72, 209, 204, 1],
  "mediumvioletred": [199, 21, 133, 1],
  "midnightblue": [25, 25, 112, 1],
  "mintcream": [245, 255, 250, 1],
  "mistyrose": [255, 228, 225, 1],
  "moccasin": [255, 228, 181, 1],
  "navajowhite": [255, 222, 173, 1],
  "navy": [0, 0, 128, 1],
  "oldlace": [253, 245, 230, 1],
  "olive": [128, 128, 0, 1],
  "olivedrab": [107, 142, 35, 1],
  "orange": [255, 165, 0, 1],
  "orangered": [255, 69, 0, 1],
  "orchid": [218, 112, 214, 1],
  "palegoldenrod": [238, 232, 170, 1],
  "palegreen": [152, 251, 152, 1],
  "paleturquoise": [175, 238, 238, 1],
  "palevioletred": [219, 112, 147, 1],
  "papayawhip": [255, 239, 213, 1],
  "peachpuff": [255, 218, 185, 1],
  "peru": [205, 133, 63, 1],
  "pink": [255, 192, 203, 1],
  "plum": [221, 160, 221, 1],
  "powderblue": [176, 224, 230, 1],
  "purple": [128, 0, 128, 1],
  "red": [255, 0, 0, 1],
  "rosybrown": [188, 143, 143, 1],
  "royalblue": [65, 105, 225, 1],
  "saddlebrown": [139, 69, 19, 1],
  "salmon": [250, 128, 114, 1],
  "sandybrown": [244, 164, 96, 1],
  "seagreen": [46, 139, 87, 1],
  "seashell": [255, 245, 238, 1],
  "sienna": [160, 82, 45, 1],
  "silver": [192, 192, 192, 1],
  "skyblue": [135, 206, 235, 1],
  "slateblue": [106, 90, 205, 1],
  "slategray": [112, 128, 144, 1],
  "slategrey": [112, 128, 144, 1],
  "snow": [255, 250, 250, 1],
  "springgreen": [0, 255, 127, 1],
  "steelblue": [70, 130, 180, 1],
  "tan": [210, 180, 140, 1],
  "teal": [0, 128, 128, 1],
  "thistle": [216, 191, 216, 1],
  "tomato": [255, 99, 71, 1],
  "turquoise": [64, 224, 208, 1],
  "violet": [238, 130, 238, 1],
  "wheat": [245, 222, 179, 1],
  "white": [255, 255, 255, 1],
  "whitesmoke": [245, 245, 245, 1],
  "yellow": [255, 255, 0, 1],
  "yellowgreen": [154, 205, 50, 1]
};
function clampCssByte(i) {
  i = Math.round(i);
  return i < 0 ? 0 : i > 255 ? 255 : i;
}
function clampCssAngle(i) {
  i = Math.round(i);
  return i < 0 ? 0 : i > 360 ? 360 : i;
}
function clampCssFloat(f) {
  return f < 0 ? 0 : f > 1 ? 1 : f;
}
function parseCssInt(val) {
  var str = val;
  if (str.length && str.charAt(str.length - 1) === "%") {
    return clampCssByte(parseFloat(str) / 100 * 255);
  }
  return clampCssByte(parseInt(str, 10));
}
function parseCssFloat(val) {
  var str = val;
  if (str.length && str.charAt(str.length - 1) === "%") {
    return clampCssFloat(parseFloat(str) / 100);
  }
  return clampCssFloat(parseFloat(str));
}
function cssHueToRgb(m1, m2, h) {
  if (h < 0) {
    h += 1;
  } else if (h > 1) {
    h -= 1;
  }
  if (h * 6 < 1) {
    return m1 + (m2 - m1) * h * 6;
  }
  if (h * 2 < 1) {
    return m2;
  }
  if (h * 3 < 2) {
    return m1 + (m2 - m1) * (2 / 3 - h) * 6;
  }
  return m1;
}
function setRgba(out2, r, g, b, a) {
  out2[0] = r;
  out2[1] = g;
  out2[2] = b;
  out2[3] = a;
  return out2;
}
function copyRgba(out2, a) {
  out2[0] = a[0];
  out2[1] = a[1];
  out2[2] = a[2];
  out2[3] = a[3];
  return out2;
}
var colorCache = new LRU_default(20);
var lastRemovedArr = null;
function putToCache(colorStr, rgbaArr) {
  if (lastRemovedArr) {
    copyRgba(lastRemovedArr, rgbaArr);
  }
  lastRemovedArr = colorCache.put(colorStr, lastRemovedArr || rgbaArr.slice());
}
function parse(colorStr, rgbaArr) {
  if (!colorStr) {
    return;
  }
  rgbaArr = rgbaArr || [];
  var cached = colorCache.get(colorStr);
  if (cached) {
    return copyRgba(rgbaArr, cached);
  }
  colorStr = colorStr + "";
  var str = colorStr.replace(/ /g, "").toLowerCase();
  if (str in kCSSColorTable) {
    copyRgba(rgbaArr, kCSSColorTable[str]);
    putToCache(colorStr, rgbaArr);
    return rgbaArr;
  }
  var strLen = str.length;
  if (str.charAt(0) === "#") {
    if (strLen === 4 || strLen === 5) {
      var iv = parseInt(str.slice(1, 4), 16);
      if (!(iv >= 0 && iv <= 4095)) {
        setRgba(rgbaArr, 0, 0, 0, 1);
        return;
      }
      setRgba(rgbaArr, (iv & 3840) >> 4 | (iv & 3840) >> 8, iv & 240 | (iv & 240) >> 4, iv & 15 | (iv & 15) << 4, strLen === 5 ? parseInt(str.slice(4), 16) / 15 : 1);
      putToCache(colorStr, rgbaArr);
      return rgbaArr;
    } else if (strLen === 7 || strLen === 9) {
      var iv = parseInt(str.slice(1, 7), 16);
      if (!(iv >= 0 && iv <= 16777215)) {
        setRgba(rgbaArr, 0, 0, 0, 1);
        return;
      }
      setRgba(rgbaArr, (iv & 16711680) >> 16, (iv & 65280) >> 8, iv & 255, strLen === 9 ? parseInt(str.slice(7), 16) / 255 : 1);
      putToCache(colorStr, rgbaArr);
      return rgbaArr;
    }
    return;
  }
  var op = str.indexOf("(");
  var ep = str.indexOf(")");
  if (op !== -1 && ep + 1 === strLen) {
    var fname = str.substr(0, op);
    var params = str.substr(op + 1, ep - (op + 1)).split(",");
    var alpha = 1;
    switch (fname) {
      case "rgba":
        if (params.length !== 4) {
          return params.length === 3 ? setRgba(rgbaArr, +params[0], +params[1], +params[2], 1) : setRgba(rgbaArr, 0, 0, 0, 1);
        }
        alpha = parseCssFloat(params.pop());
      case "rgb":
        if (params.length >= 3) {
          setRgba(rgbaArr, parseCssInt(params[0]), parseCssInt(params[1]), parseCssInt(params[2]), params.length === 3 ? alpha : parseCssFloat(params[3]));
          putToCache(colorStr, rgbaArr);
          return rgbaArr;
        } else {
          setRgba(rgbaArr, 0, 0, 0, 1);
          return;
        }
      case "hsla":
        if (params.length !== 4) {
          setRgba(rgbaArr, 0, 0, 0, 1);
          return;
        }
        params[3] = parseCssFloat(params[3]);
        hsla2rgba(params, rgbaArr);
        putToCache(colorStr, rgbaArr);
        return rgbaArr;
      case "hsl":
        if (params.length !== 3) {
          setRgba(rgbaArr, 0, 0, 0, 1);
          return;
        }
        hsla2rgba(params, rgbaArr);
        putToCache(colorStr, rgbaArr);
        return rgbaArr;
      default:
        return;
    }
  }
  setRgba(rgbaArr, 0, 0, 0, 1);
  return;
}
function hsla2rgba(hsla, rgba) {
  var h = (parseFloat(hsla[0]) % 360 + 360) % 360 / 360;
  var s = parseCssFloat(hsla[1]);
  var l = parseCssFloat(hsla[2]);
  var m2 = l <= 0.5 ? l * (s + 1) : l + s - l * s;
  var m1 = l * 2 - m2;
  rgba = rgba || [];
  setRgba(rgba, clampCssByte(cssHueToRgb(m1, m2, h + 1 / 3) * 255), clampCssByte(cssHueToRgb(m1, m2, h) * 255), clampCssByte(cssHueToRgb(m1, m2, h - 1 / 3) * 255), 1);
  if (hsla.length === 4) {
    rgba[3] = hsla[3];
  }
  return rgba;
}
function rgba2hsla(rgba) {
  if (!rgba) {
    return;
  }
  var R = rgba[0] / 255;
  var G = rgba[1] / 255;
  var B = rgba[2] / 255;
  var vMin = Math.min(R, G, B);
  var vMax = Math.max(R, G, B);
  var delta = vMax - vMin;
  var L = (vMax + vMin) / 2;
  var H;
  var S;
  if (delta === 0) {
    H = 0;
    S = 0;
  } else {
    if (L < 0.5) {
      S = delta / (vMax + vMin);
    } else {
      S = delta / (2 - vMax - vMin);
    }
    var deltaR = ((vMax - R) / 6 + delta / 2) / delta;
    var deltaG = ((vMax - G) / 6 + delta / 2) / delta;
    var deltaB = ((vMax - B) / 6 + delta / 2) / delta;
    if (R === vMax) {
      H = deltaB - deltaG;
    } else if (G === vMax) {
      H = 1 / 3 + deltaR - deltaB;
    } else if (B === vMax) {
      H = 2 / 3 + deltaG - deltaR;
    }
    if (H < 0) {
      H += 1;
    }
    if (H > 1) {
      H -= 1;
    }
  }
  var hsla = [H * 360, S, L];
  if (rgba[3] != null) {
    hsla.push(rgba[3]);
  }
  return hsla;
}
function modifyHSL(color2, h, s, l) {
  var colorArr = parse(color2);
  if (color2) {
    colorArr = rgba2hsla(colorArr);
    h != null && (colorArr[0] = clampCssAngle(isFunction(h) ? h(colorArr[0]) : h));
    s != null && (colorArr[1] = parseCssFloat(isFunction(s) ? s(colorArr[1]) : s));
    l != null && (colorArr[2] = parseCssFloat(isFunction(l) ? l(colorArr[2]) : l));
    return stringify(hsla2rgba(colorArr), "rgba");
  }
}
function stringify(arrColor, type) {
  if (!arrColor || !arrColor.length) {
    return;
  }
  var colorStr = arrColor[0] + "," + arrColor[1] + "," + arrColor[2];
  if (type === "rgba" || type === "hsva" || type === "hsla") {
    colorStr += "," + arrColor[3];
  }
  return type + "(" + colorStr + ")";
}
function lum(color2, backgroundLum) {
  var arr = parse(color2);
  return arr ? (0.299 * arr[0] + 0.587 * arr[1] + 0.114 * arr[2]) * arr[3] / 255 + (1 - arr[3]) * backgroundLum : 0;
}
var liftedColorCache = new LRU_default(100);

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/svg/helper.js
function isLinearGradient(val) {
  return val.type === "linear";
}
function isRadialGradient(val) {
  return val.type === "radial";
}
var encodeBase64 = (function() {
  if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
    return function(str) {
      return Buffer.from(str).toString("base64");
    };
  }
  if (typeof btoa === "function" && typeof unescape === "function" && typeof encodeURIComponent === "function") {
    return function(str) {
      return btoa(unescape(encodeURIComponent(str)));
    };
  }
  return function(str) {
    if (false) {
      logError("Base64 isn't natively supported in the current environment.");
    }
    return null;
  };
})();

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/animation/Animator.js
var arraySlice = Array.prototype.slice;
function interpolateNumber2(p0, p1, percent) {
  return (p1 - p0) * percent + p0;
}
function interpolate1DArray(out2, p0, p1, percent) {
  var len2 = p0.length;
  for (var i = 0; i < len2; i++) {
    out2[i] = interpolateNumber2(p0[i], p1[i], percent);
  }
  return out2;
}
function interpolate2DArray(out2, p0, p1, percent) {
  var len2 = p0.length;
  var len22 = len2 && p0[0].length;
  for (var i = 0; i < len2; i++) {
    if (!out2[i]) {
      out2[i] = [];
    }
    for (var j = 0; j < len22; j++) {
      out2[i][j] = interpolateNumber2(p0[i][j], p1[i][j], percent);
    }
  }
  return out2;
}
function add1DArray(out2, p0, p1, sign) {
  var len2 = p0.length;
  for (var i = 0; i < len2; i++) {
    out2[i] = p0[i] + p1[i] * sign;
  }
  return out2;
}
function add2DArray(out2, p0, p1, sign) {
  var len2 = p0.length;
  var len22 = len2 && p0[0].length;
  for (var i = 0; i < len2; i++) {
    if (!out2[i]) {
      out2[i] = [];
    }
    for (var j = 0; j < len22; j++) {
      out2[i][j] = p0[i][j] + p1[i][j] * sign;
    }
  }
  return out2;
}
function fillColorStops(val0, val1) {
  var len0 = val0.length;
  var len1 = val1.length;
  var shorterArr = len0 > len1 ? val1 : val0;
  var shorterLen = Math.min(len0, len1);
  var last = shorterArr[shorterLen - 1] || { color: [0, 0, 0, 0], offset: 0 };
  for (var i = shorterLen; i < Math.max(len0, len1); i++) {
    shorterArr.push({
      offset: last.offset,
      color: last.color.slice()
    });
  }
}
function fillArray(val0, val1, arrDim) {
  var arr0 = val0;
  var arr1 = val1;
  if (!arr0.push || !arr1.push) {
    return;
  }
  var arr0Len = arr0.length;
  var arr1Len = arr1.length;
  if (arr0Len !== arr1Len) {
    var isPreviousLarger = arr0Len > arr1Len;
    if (isPreviousLarger) {
      arr0.length = arr1Len;
    } else {
      for (var i = arr0Len; i < arr1Len; i++) {
        arr0.push(arrDim === 1 ? arr1[i] : arraySlice.call(arr1[i]));
      }
    }
  }
  var len2 = arr0[0] && arr0[0].length;
  for (var i = 0; i < arr0.length; i++) {
    if (arrDim === 1) {
      if (isNaN(arr0[i])) {
        arr0[i] = arr1[i];
      }
    } else {
      for (var j = 0; j < len2; j++) {
        if (isNaN(arr0[i][j])) {
          arr0[i][j] = arr1[i][j];
        }
      }
    }
  }
}
function cloneValue(value) {
  if (isArrayLike(value)) {
    var len2 = value.length;
    if (isArrayLike(value[0])) {
      var ret = [];
      for (var i = 0; i < len2; i++) {
        ret.push(arraySlice.call(value[i]));
      }
      return ret;
    }
    return arraySlice.call(value);
  }
  return value;
}
function rgba2String(rgba) {
  rgba[0] = Math.floor(rgba[0]) || 0;
  rgba[1] = Math.floor(rgba[1]) || 0;
  rgba[2] = Math.floor(rgba[2]) || 0;
  rgba[3] = rgba[3] == null ? 1 : rgba[3];
  return "rgba(" + rgba.join(",") + ")";
}
function guessArrayDim(value) {
  return isArrayLike(value && value[0]) ? 2 : 1;
}
var VALUE_TYPE_NUMBER = 0;
var VALUE_TYPE_1D_ARRAY = 1;
var VALUE_TYPE_2D_ARRAY = 2;
var VALUE_TYPE_COLOR = 3;
var VALUE_TYPE_LINEAR_GRADIENT = 4;
var VALUE_TYPE_RADIAL_GRADIENT = 5;
var VALUE_TYPE_UNKOWN = 6;
function isGradientValueType(valType) {
  return valType === VALUE_TYPE_LINEAR_GRADIENT || valType === VALUE_TYPE_RADIAL_GRADIENT;
}
function isArrayValueType(valType) {
  return valType === VALUE_TYPE_1D_ARRAY || valType === VALUE_TYPE_2D_ARRAY;
}
var tmpRgba = [0, 0, 0, 0];
var Track = (function() {
  function Track2(propName) {
    this.keyframes = [];
    this.discrete = false;
    this._invalid = false;
    this._needsSort = false;
    this._lastFr = 0;
    this._lastFrP = 0;
    this.propName = propName;
  }
  Track2.prototype.isFinished = function() {
    return this._finished;
  };
  Track2.prototype.setFinished = function() {
    this._finished = true;
    if (this._additiveTrack) {
      this._additiveTrack.setFinished();
    }
  };
  Track2.prototype.needsAnimate = function() {
    return this.keyframes.length >= 1;
  };
  Track2.prototype.getAdditiveTrack = function() {
    return this._additiveTrack;
  };
  Track2.prototype.addKeyframe = function(time, rawValue, easing) {
    this._needsSort = true;
    var keyframes = this.keyframes;
    var len2 = keyframes.length;
    var discrete = false;
    var valType = VALUE_TYPE_UNKOWN;
    var value = rawValue;
    if (isArrayLike(rawValue)) {
      var arrayDim = guessArrayDim(rawValue);
      valType = arrayDim;
      if (arrayDim === 1 && !isNumber(rawValue[0]) || arrayDim === 2 && !isNumber(rawValue[0][0])) {
        discrete = true;
      }
    } else {
      if (isNumber(rawValue) && !eqNaN(rawValue)) {
        valType = VALUE_TYPE_NUMBER;
      } else if (isString(rawValue)) {
        if (!isNaN(+rawValue)) {
          valType = VALUE_TYPE_NUMBER;
        } else {
          var colorArray = parse(rawValue);
          if (colorArray) {
            value = colorArray;
            valType = VALUE_TYPE_COLOR;
          }
        }
      } else if (isGradientObject(rawValue)) {
        var parsedGradient = extend({}, value);
        parsedGradient.colorStops = map(rawValue.colorStops, function(colorStop) {
          return {
            offset: colorStop.offset,
            color: parse(colorStop.color)
          };
        });
        if (isLinearGradient(rawValue)) {
          valType = VALUE_TYPE_LINEAR_GRADIENT;
        } else if (isRadialGradient(rawValue)) {
          valType = VALUE_TYPE_RADIAL_GRADIENT;
        }
        value = parsedGradient;
      }
    }
    if (len2 === 0) {
      this.valType = valType;
    } else if (valType !== this.valType || valType === VALUE_TYPE_UNKOWN) {
      discrete = true;
    }
    this.discrete = this.discrete || discrete;
    var kf = {
      time,
      value,
      rawValue,
      percent: 0
    };
    if (easing) {
      kf.easing = easing;
      kf.easingFunc = isFunction(easing) ? easing : easing_default[easing] || createCubicEasingFunc(easing);
    }
    keyframes.push(kf);
    return kf;
  };
  Track2.prototype.prepare = function(maxTime, additiveTrack) {
    var kfs = this.keyframes;
    if (this._needsSort) {
      kfs.sort(function(a, b) {
        return a.time - b.time;
      });
    }
    var valType = this.valType;
    var kfsLen = kfs.length;
    var lastKf = kfs[kfsLen - 1];
    var isDiscrete = this.discrete;
    var isArr = isArrayValueType(valType);
    var isGradient = isGradientValueType(valType);
    for (var i = 0; i < kfsLen; i++) {
      var kf = kfs[i];
      var value = kf.value;
      var lastValue = lastKf.value;
      kf.percent = kf.time / maxTime;
      if (!isDiscrete) {
        if (isArr && i !== kfsLen - 1) {
          fillArray(value, lastValue, valType);
        } else if (isGradient) {
          fillColorStops(value.colorStops, lastValue.colorStops);
        }
      }
    }
    if (!isDiscrete && valType !== VALUE_TYPE_RADIAL_GRADIENT && additiveTrack && this.needsAnimate() && additiveTrack.needsAnimate() && valType === additiveTrack.valType && !additiveTrack._finished) {
      this._additiveTrack = additiveTrack;
      var startValue = kfs[0].value;
      for (var i = 0; i < kfsLen; i++) {
        if (valType === VALUE_TYPE_NUMBER) {
          kfs[i].additiveValue = kfs[i].value - startValue;
        } else if (valType === VALUE_TYPE_COLOR) {
          kfs[i].additiveValue = add1DArray([], kfs[i].value, startValue, -1);
        } else if (isArrayValueType(valType)) {
          kfs[i].additiveValue = valType === VALUE_TYPE_1D_ARRAY ? add1DArray([], kfs[i].value, startValue, -1) : add2DArray([], kfs[i].value, startValue, -1);
        }
      }
    }
  };
  Track2.prototype.step = function(target, percent) {
    if (this._finished) {
      return;
    }
    if (this._additiveTrack && this._additiveTrack._finished) {
      this._additiveTrack = null;
    }
    var isAdditive = this._additiveTrack != null;
    var valueKey = isAdditive ? "additiveValue" : "value";
    var valType = this.valType;
    var keyframes = this.keyframes;
    var kfsNum = keyframes.length;
    var propName = this.propName;
    var isValueColor = valType === VALUE_TYPE_COLOR;
    var frameIdx;
    var lastFrame = this._lastFr;
    var mathMin7 = Math.min;
    var frame;
    var nextFrame;
    if (kfsNum === 1) {
      frame = nextFrame = keyframes[0];
    } else {
      if (percent < 0) {
        frameIdx = 0;
      } else if (percent < this._lastFrP) {
        var start2 = mathMin7(lastFrame + 1, kfsNum - 1);
        for (frameIdx = start2; frameIdx >= 0; frameIdx--) {
          if (keyframes[frameIdx].percent <= percent) {
            break;
          }
        }
        frameIdx = mathMin7(frameIdx, kfsNum - 2);
      } else {
        for (frameIdx = lastFrame; frameIdx < kfsNum; frameIdx++) {
          if (keyframes[frameIdx].percent > percent) {
            break;
          }
        }
        frameIdx = mathMin7(frameIdx - 1, kfsNum - 2);
      }
      nextFrame = keyframes[frameIdx + 1];
      frame = keyframes[frameIdx];
    }
    if (!(frame && nextFrame)) {
      return;
    }
    this._lastFr = frameIdx;
    this._lastFrP = percent;
    var interval = nextFrame.percent - frame.percent;
    var w = interval === 0 ? 1 : mathMin7((percent - frame.percent) / interval, 1);
    if (nextFrame.easingFunc) {
      w = nextFrame.easingFunc(w);
    }
    var targetArr = isAdditive ? this._additiveValue : isValueColor ? tmpRgba : target[propName];
    if ((isArrayValueType(valType) || isValueColor) && !targetArr) {
      targetArr = this._additiveValue = [];
    }
    if (this.discrete) {
      target[propName] = w < 1 ? frame.rawValue : nextFrame.rawValue;
    } else if (isArrayValueType(valType)) {
      valType === VALUE_TYPE_1D_ARRAY ? interpolate1DArray(targetArr, frame[valueKey], nextFrame[valueKey], w) : interpolate2DArray(targetArr, frame[valueKey], nextFrame[valueKey], w);
    } else if (isGradientValueType(valType)) {
      var val = frame[valueKey];
      var nextVal_1 = nextFrame[valueKey];
      var isLinearGradient_1 = valType === VALUE_TYPE_LINEAR_GRADIENT;
      target[propName] = {
        type: isLinearGradient_1 ? "linear" : "radial",
        x: interpolateNumber2(val.x, nextVal_1.x, w),
        y: interpolateNumber2(val.y, nextVal_1.y, w),
        colorStops: map(val.colorStops, function(colorStop, idx) {
          var nextColorStop = nextVal_1.colorStops[idx];
          return {
            offset: interpolateNumber2(colorStop.offset, nextColorStop.offset, w),
            color: rgba2String(interpolate1DArray([], colorStop.color, nextColorStop.color, w))
          };
        }),
        global: nextVal_1.global
      };
      if (isLinearGradient_1) {
        target[propName].x2 = interpolateNumber2(val.x2, nextVal_1.x2, w);
        target[propName].y2 = interpolateNumber2(val.y2, nextVal_1.y2, w);
      } else {
        target[propName].r = interpolateNumber2(val.r, nextVal_1.r, w);
      }
    } else if (isValueColor) {
      interpolate1DArray(targetArr, frame[valueKey], nextFrame[valueKey], w);
      if (!isAdditive) {
        target[propName] = rgba2String(targetArr);
      }
    } else {
      var value = interpolateNumber2(frame[valueKey], nextFrame[valueKey], w);
      if (isAdditive) {
        this._additiveValue = value;
      } else {
        target[propName] = value;
      }
    }
    if (isAdditive) {
      this._addToTarget(target);
    }
  };
  Track2.prototype._addToTarget = function(target) {
    var valType = this.valType;
    var propName = this.propName;
    var additiveValue = this._additiveValue;
    if (valType === VALUE_TYPE_NUMBER) {
      target[propName] = target[propName] + additiveValue;
    } else if (valType === VALUE_TYPE_COLOR) {
      parse(target[propName], tmpRgba);
      add1DArray(tmpRgba, tmpRgba, additiveValue, 1);
      target[propName] = rgba2String(tmpRgba);
    } else if (valType === VALUE_TYPE_1D_ARRAY) {
      add1DArray(target[propName], target[propName], additiveValue, 1);
    } else if (valType === VALUE_TYPE_2D_ARRAY) {
      add2DArray(target[propName], target[propName], additiveValue, 1);
    }
  };
  return Track2;
})();
var Animator = (function() {
  function Animator2(target, loop, allowDiscreteAnimation, additiveTo) {
    this._tracks = {};
    this._trackKeys = [];
    this._maxTime = 0;
    this._started = 0;
    this._clip = null;
    this._target = target;
    this._loop = loop;
    if (loop && additiveTo) {
      logError("Can' use additive animation on looped animation.");
      return;
    }
    this._additiveAnimators = additiveTo;
    this._allowDiscrete = allowDiscreteAnimation;
  }
  Animator2.prototype.getMaxTime = function() {
    return this._maxTime;
  };
  Animator2.prototype.getDelay = function() {
    return this._delay;
  };
  Animator2.prototype.getLoop = function() {
    return this._loop;
  };
  Animator2.prototype.getTarget = function() {
    return this._target;
  };
  Animator2.prototype.changeTarget = function(target) {
    this._target = target;
  };
  Animator2.prototype.when = function(time, props, easing) {
    return this.whenWithKeys(time, props, keys(props), easing);
  };
  Animator2.prototype.whenWithKeys = function(time, props, propNames, easing) {
    var tracks = this._tracks;
    for (var i = 0; i < propNames.length; i++) {
      var propName = propNames[i];
      var track = tracks[propName];
      if (!track) {
        track = tracks[propName] = new Track(propName);
        var initialValue = void 0;
        var additiveTrack = this._getAdditiveTrack(propName);
        if (additiveTrack) {
          var addtiveTrackKfs = additiveTrack.keyframes;
          var lastFinalKf = addtiveTrackKfs[addtiveTrackKfs.length - 1];
          initialValue = lastFinalKf && lastFinalKf.value;
          if (additiveTrack.valType === VALUE_TYPE_COLOR && initialValue) {
            initialValue = rgba2String(initialValue);
          }
        } else {
          initialValue = this._target[propName];
        }
        if (initialValue == null) {
          continue;
        }
        if (time > 0) {
          track.addKeyframe(0, cloneValue(initialValue), easing);
        }
        this._trackKeys.push(propName);
      }
      track.addKeyframe(time, cloneValue(props[propName]), easing);
    }
    this._maxTime = Math.max(this._maxTime, time);
    return this;
  };
  Animator2.prototype.pause = function() {
    this._clip.pause();
    this._paused = true;
  };
  Animator2.prototype.resume = function() {
    this._clip.resume();
    this._paused = false;
  };
  Animator2.prototype.isPaused = function() {
    return !!this._paused;
  };
  Animator2.prototype.duration = function(duration) {
    this._maxTime = duration;
    this._force = true;
    return this;
  };
  Animator2.prototype._doneCallback = function() {
    this._setTracksFinished();
    this._clip = null;
    var doneList = this._doneCbs;
    if (doneList) {
      var len2 = doneList.length;
      for (var i = 0; i < len2; i++) {
        doneList[i].call(this);
      }
    }
  };
  Animator2.prototype._abortedCallback = function() {
    this._setTracksFinished();
    var animation = this.animation;
    var abortedList = this._abortedCbs;
    if (animation) {
      animation.removeClip(this._clip);
    }
    this._clip = null;
    if (abortedList) {
      for (var i = 0; i < abortedList.length; i++) {
        abortedList[i].call(this);
      }
    }
  };
  Animator2.prototype._setTracksFinished = function() {
    var tracks = this._tracks;
    var tracksKeys = this._trackKeys;
    for (var i = 0; i < tracksKeys.length; i++) {
      tracks[tracksKeys[i]].setFinished();
    }
  };
  Animator2.prototype._getAdditiveTrack = function(trackName) {
    var additiveTrack;
    var additiveAnimators = this._additiveAnimators;
    if (additiveAnimators) {
      for (var i = 0; i < additiveAnimators.length; i++) {
        var track = additiveAnimators[i].getTrack(trackName);
        if (track) {
          additiveTrack = track;
        }
      }
    }
    return additiveTrack;
  };
  Animator2.prototype.start = function(easing) {
    if (this._started > 0) {
      return;
    }
    this._started = 1;
    var self2 = this;
    var tracks = [];
    var maxTime = this._maxTime || 0;
    for (var i = 0; i < this._trackKeys.length; i++) {
      var propName = this._trackKeys[i];
      var track = this._tracks[propName];
      var additiveTrack = this._getAdditiveTrack(propName);
      var kfs = track.keyframes;
      var kfsNum = kfs.length;
      track.prepare(maxTime, additiveTrack);
      if (track.needsAnimate()) {
        if (!this._allowDiscrete && track.discrete) {
          var lastKf = kfs[kfsNum - 1];
          if (lastKf) {
            self2._target[track.propName] = lastKf.rawValue;
          }
          track.setFinished();
        } else {
          tracks.push(track);
        }
      }
    }
    if (tracks.length || this._force) {
      var clip = new Clip_default({
        life: maxTime,
        loop: this._loop,
        delay: this._delay || 0,
        onframe: function(percent) {
          self2._started = 2;
          var additiveAnimators = self2._additiveAnimators;
          if (additiveAnimators) {
            var stillHasAdditiveAnimator = false;
            for (var i2 = 0; i2 < additiveAnimators.length; i2++) {
              if (additiveAnimators[i2]._clip) {
                stillHasAdditiveAnimator = true;
                break;
              }
            }
            if (!stillHasAdditiveAnimator) {
              self2._additiveAnimators = null;
            }
          }
          for (var i2 = 0; i2 < tracks.length; i2++) {
            tracks[i2].step(self2._target, percent);
          }
          var onframeList = self2._onframeCbs;
          if (onframeList) {
            for (var i2 = 0; i2 < onframeList.length; i2++) {
              onframeList[i2](self2._target, percent);
            }
          }
        },
        ondestroy: function() {
          self2._doneCallback();
        }
      });
      this._clip = clip;
      if (this.animation) {
        this.animation.addClip(clip);
      }
      if (easing) {
        clip.setEasing(easing);
      }
    } else {
      this._doneCallback();
    }
    return this;
  };
  Animator2.prototype.stop = function(forwardToLast) {
    if (!this._clip) {
      return;
    }
    var clip = this._clip;
    if (forwardToLast) {
      clip.onframe(1);
    }
    this._abortedCallback();
  };
  Animator2.prototype.delay = function(time) {
    this._delay = time;
    return this;
  };
  Animator2.prototype.during = function(cb) {
    if (cb) {
      if (!this._onframeCbs) {
        this._onframeCbs = [];
      }
      this._onframeCbs.push(cb);
    }
    return this;
  };
  Animator2.prototype.done = function(cb) {
    if (cb) {
      if (!this._doneCbs) {
        this._doneCbs = [];
      }
      this._doneCbs.push(cb);
    }
    return this;
  };
  Animator2.prototype.aborted = function(cb) {
    if (cb) {
      if (!this._abortedCbs) {
        this._abortedCbs = [];
      }
      this._abortedCbs.push(cb);
    }
    return this;
  };
  Animator2.prototype.getClip = function() {
    return this._clip;
  };
  Animator2.prototype.getTrack = function(propName) {
    return this._tracks[propName];
  };
  Animator2.prototype.getTracks = function() {
    var _this = this;
    return map(this._trackKeys, function(key2) {
      return _this._tracks[key2];
    });
  };
  Animator2.prototype.stopTracks = function(propNames, forwardToLast) {
    if (!propNames.length || !this._clip) {
      return true;
    }
    var tracks = this._tracks;
    var tracksKeys = this._trackKeys;
    for (var i = 0; i < propNames.length; i++) {
      var track = tracks[propNames[i]];
      if (track && !track.isFinished()) {
        if (forwardToLast) {
          track.step(this._target, 1);
        } else if (this._started === 1) {
          track.step(this._target, 0);
        }
        track.setFinished();
      }
    }
    var allAborted = true;
    for (var i = 0; i < tracksKeys.length; i++) {
      if (!tracks[tracksKeys[i]].isFinished()) {
        allAborted = false;
        break;
      }
    }
    if (allAborted) {
      this._abortedCallback();
    }
    return allAborted;
  };
  Animator2.prototype.saveTo = function(target, trackKeys, firstOrLast) {
    if (!target) {
      return;
    }
    trackKeys = trackKeys || this._trackKeys;
    for (var i = 0; i < trackKeys.length; i++) {
      var propName = trackKeys[i];
      var track = this._tracks[propName];
      if (!track || track.isFinished()) {
        continue;
      }
      var kfs = track.keyframes;
      var kf = kfs[firstOrLast ? 0 : kfs.length - 1];
      if (kf) {
        target[propName] = cloneValue(kf.rawValue);
      }
    }
  };
  Animator2.prototype.__changeFinalValue = function(finalProps, trackKeys) {
    trackKeys = trackKeys || keys(finalProps);
    for (var i = 0; i < trackKeys.length; i++) {
      var propName = trackKeys[i];
      var track = this._tracks[propName];
      if (!track) {
        continue;
      }
      var kfs = track.keyframes;
      if (kfs.length > 1) {
        var lastKf = kfs.pop();
        track.addKeyframe(lastKf.time, finalProps[propName]);
        track.prepare(this._maxTime, track.getAdditiveTrack());
      }
    }
  };
  return Animator2;
})();
var Animator_default = Animator;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/core/Eventful.js
var Eventful = (function() {
  function Eventful2(eventProcessors) {
    if (eventProcessors) {
      this._$eventProcessor = eventProcessors;
    }
  }
  Eventful2.prototype.on = function(event, query, handler, context) {
    if (!this._$handlers) {
      this._$handlers = {};
    }
    var _h = this._$handlers;
    if (typeof query === "function") {
      context = handler;
      handler = query;
      query = null;
    }
    if (!handler || !event) {
      return this;
    }
    var eventProcessor = this._$eventProcessor;
    if (query != null && eventProcessor && eventProcessor.normalizeQuery) {
      query = eventProcessor.normalizeQuery(query);
    }
    if (!_h[event]) {
      _h[event] = [];
    }
    for (var i = 0; i < _h[event].length; i++) {
      if (_h[event][i].h === handler) {
        return this;
      }
    }
    var wrap = {
      h: handler,
      query,
      ctx: context || this,
      callAtLast: handler.zrEventfulCallAtLast
    };
    var lastIndex = _h[event].length - 1;
    var lastWrap = _h[event][lastIndex];
    lastWrap && lastWrap.callAtLast ? _h[event].splice(lastIndex, 0, wrap) : _h[event].push(wrap);
    return this;
  };
  Eventful2.prototype.isSilent = function(eventName) {
    var _h = this._$handlers;
    return !_h || !_h[eventName] || !_h[eventName].length;
  };
  Eventful2.prototype.off = function(eventType, handler) {
    var _h = this._$handlers;
    if (!_h) {
      return this;
    }
    if (!eventType) {
      this._$handlers = {};
      return this;
    }
    if (handler) {
      if (_h[eventType]) {
        var newList = [];
        for (var i = 0, l = _h[eventType].length; i < l; i++) {
          if (_h[eventType][i].h !== handler) {
            newList.push(_h[eventType][i]);
          }
        }
        _h[eventType] = newList;
      }
      if (_h[eventType] && _h[eventType].length === 0) {
        delete _h[eventType];
      }
    } else {
      delete _h[eventType];
    }
    return this;
  };
  Eventful2.prototype.trigger = function(eventType) {
    var args = [];
    for (var _i = 1; _i < arguments.length; _i++) {
      args[_i - 1] = arguments[_i];
    }
    if (!this._$handlers) {
      return this;
    }
    var _h = this._$handlers[eventType];
    var eventProcessor = this._$eventProcessor;
    if (_h) {
      var argLen = args.length;
      var len2 = _h.length;
      for (var i = 0; i < len2; i++) {
        var hItem = _h[i];
        if (eventProcessor && eventProcessor.filter && hItem.query != null && !eventProcessor.filter(eventType, hItem.query)) {
          continue;
        }
        switch (argLen) {
          case 0:
            hItem.h.call(hItem.ctx);
            break;
          case 1:
            hItem.h.call(hItem.ctx, args[0]);
            break;
          case 2:
            hItem.h.call(hItem.ctx, args[0], args[1]);
            break;
          default:
            hItem.h.apply(hItem.ctx, args);
            break;
        }
      }
    }
    eventProcessor && eventProcessor.afterTrigger && eventProcessor.afterTrigger(eventType);
    return this;
  };
  Eventful2.prototype.triggerWithContext = function(type) {
    var args = [];
    for (var _i = 1; _i < arguments.length; _i++) {
      args[_i - 1] = arguments[_i];
    }
    if (!this._$handlers) {
      return this;
    }
    var _h = this._$handlers[type];
    var eventProcessor = this._$eventProcessor;
    if (_h) {
      var argLen = args.length;
      var ctx = args[argLen - 1];
      var len2 = _h.length;
      for (var i = 0; i < len2; i++) {
        var hItem = _h[i];
        if (eventProcessor && eventProcessor.filter && hItem.query != null && !eventProcessor.filter(type, hItem.query)) {
          continue;
        }
        switch (argLen) {
          case 0:
            hItem.h.call(ctx);
            break;
          case 1:
            hItem.h.call(ctx, args[0]);
            break;
          case 2:
            hItem.h.call(ctx, args[0], args[1]);
            break;
          default:
            hItem.h.apply(ctx, args.slice(1, argLen - 1));
            break;
        }
      }
    }
    eventProcessor && eventProcessor.afterTrigger && eventProcessor.afterTrigger(type);
    return this;
  };
  return Eventful2;
})();
var Eventful_default = Eventful;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/config.js
var dpr = 1;
if (env_default.hasGlobalWindow) {
  dpr = Math.max(window.devicePixelRatio || window.screen && window.screen.deviceXDPI / window.screen.logicalXDPI || 1, 1);
}
var devicePixelRatio = dpr;
var DARK_MODE_THRESHOLD = 0.4;
var DARK_LABEL_COLOR = "#333";
var LIGHT_LABEL_COLOR = "#ccc";
var LIGHTER_LABEL_COLOR = "#eee";

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/graphic/constants.js
var REDRAW_BIT = 1;
var STYLE_CHANGED_BIT = 2;
var SHAPE_CHANGED_BIT = 4;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/Element.js
var PRESERVED_NORMAL_STATE = "__zr_normal__";
var PRIMARY_STATES_KEYS = TRANSFORMABLE_PROPS.concat(["ignore"]);
var DEFAULT_ANIMATABLE_MAP = reduce(TRANSFORMABLE_PROPS, function(obj, key2) {
  obj[key2] = true;
  return obj;
}, { ignore: false });
var tmpTextPosCalcRes = {};
var tmpBoundingRect = new BoundingRect_default(0, 0, 0, 0);
var tmpInnerTextTrans = [];
var IN_HOVER_LAYER_KIND_NO = 0;
var IN_HOVER_LAYER_KIND_ONLY_STYLE_CHANGE = 1;
var Element = (function() {
  function Element2(props) {
    this.id = guid();
    this.animators = [];
    this.currentStates = [];
    this.states = {};
    this._init(props);
  }
  Element2.prototype._init = function(props) {
    this.attr(props);
  };
  Element2.prototype.drift = function(dx, dy, e2) {
    switch (this.draggable) {
      case "horizontal":
        dy = 0;
        break;
      case "vertical":
        dx = 0;
        break;
    }
    var m = this.transform;
    if (!m) {
      m = this.transform = [1, 0, 0, 1, 0, 0];
    }
    m[4] += dx;
    m[5] += dy;
    this.decomposeTransform();
    this.markRedraw();
  };
  Element2.prototype.beforeUpdate = function() {
  };
  Element2.prototype.afterUpdate = function() {
  };
  Element2.prototype.update = function() {
    this.updateTransform();
    if (this.__dirty) {
      this.updateInnerText();
    }
  };
  Element2.prototype.updateInnerText = function(forceUpdate) {
    var textEl = this._textContent;
    if (textEl && (!textEl.ignore || forceUpdate)) {
      if (!this.textConfig) {
        this.textConfig = {};
      }
      var textConfig = this.textConfig;
      var isLocal = textConfig.local;
      var innerTransformable = textEl.innerTransformable;
      var textAlign = void 0;
      var textVerticalAlign = void 0;
      var textStyleChanged = false;
      innerTransformable.parent = isLocal ? this : null;
      var innerOrigin = false;
      innerTransformable.copyTransform(textEl);
      var hasPosition = textConfig.position != null;
      var autoOverflowArea = textConfig.autoOverflowArea;
      var layoutRect = void 0;
      if (autoOverflowArea || hasPosition) {
        layoutRect = tmpBoundingRect;
        if (textConfig.layoutRect) {
          layoutRect.copy(textConfig.layoutRect);
        } else {
          layoutRect.copy(this.getBoundingRect());
        }
        if (!isLocal) {
          layoutRect.applyTransform(this.transform);
        }
      }
      if (hasPosition) {
        if (this.calculateTextPosition) {
          this.calculateTextPosition(tmpTextPosCalcRes, textConfig, layoutRect);
        } else {
          calculateTextPosition(tmpTextPosCalcRes, textConfig, layoutRect);
        }
        innerTransformable.x = tmpTextPosCalcRes.x;
        innerTransformable.y = tmpTextPosCalcRes.y;
        textAlign = tmpTextPosCalcRes.align;
        textVerticalAlign = tmpTextPosCalcRes.verticalAlign;
        var textOrigin = textConfig.origin;
        if (textOrigin && textConfig.rotation != null) {
          var relOriginX = void 0;
          var relOriginY = void 0;
          if (textOrigin === "center") {
            relOriginX = layoutRect.width * 0.5;
            relOriginY = layoutRect.height * 0.5;
          } else {
            relOriginX = parsePercent2(textOrigin[0], layoutRect.width);
            relOriginY = parsePercent2(textOrigin[1], layoutRect.height);
          }
          innerOrigin = true;
          innerTransformable.originX = -innerTransformable.x + relOriginX + (isLocal ? 0 : layoutRect.x);
          innerTransformable.originY = -innerTransformable.y + relOriginY + (isLocal ? 0 : layoutRect.y);
        }
      }
      if (textConfig.rotation != null) {
        innerTransformable.rotation = textConfig.rotation;
      }
      var textOffset = textConfig.offset;
      if (textOffset) {
        innerTransformable.x += textOffset[0];
        innerTransformable.y += textOffset[1];
        if (!innerOrigin) {
          innerTransformable.originX = -textOffset[0];
          innerTransformable.originY = -textOffset[1];
        }
      }
      var innerTextDefaultStyle = this._innerTextDefaultStyle || (this._innerTextDefaultStyle = {});
      if (autoOverflowArea) {
        var overflowRect = innerTextDefaultStyle.overflowRect = innerTextDefaultStyle.overflowRect || new BoundingRect_default(0, 0, 0, 0);
        innerTransformable.getLocalTransform(tmpInnerTextTrans);
        invert(tmpInnerTextTrans, tmpInnerTextTrans);
        BoundingRect_default.copy(overflowRect, layoutRect);
        overflowRect.applyTransform(tmpInnerTextTrans);
      } else {
        innerTextDefaultStyle.overflowRect = null;
      }
      var isInside = textConfig.inside == null ? typeof textConfig.position === "string" && textConfig.position.indexOf("inside") >= 0 : textConfig.inside;
      var textFill = void 0;
      var textStroke = void 0;
      var autoStroke = void 0;
      if (isInside && this.canBeInsideText()) {
        textFill = textConfig.insideFill;
        textStroke = textConfig.insideStroke;
        if (textFill == null || textFill === "auto") {
          textFill = this.getInsideTextFill();
        }
        if (textStroke == null || textStroke === "auto") {
          textStroke = this.getInsideTextStroke(textFill);
          autoStroke = true;
        }
      } else {
        textFill = textConfig.outsideFill;
        textStroke = textConfig.outsideStroke;
        if (textFill == null || textFill === "auto") {
          textFill = this.getOutsideFill();
        }
        if (textStroke == null || textStroke === "auto") {
          textStroke = this.getOutsideStroke(textFill);
          autoStroke = true;
        }
      }
      textFill = textFill || "#000";
      if (textFill !== innerTextDefaultStyle.fill || textStroke !== innerTextDefaultStyle.stroke || autoStroke !== innerTextDefaultStyle.autoStroke || textAlign !== innerTextDefaultStyle.align || textVerticalAlign !== innerTextDefaultStyle.verticalAlign) {
        textStyleChanged = true;
        innerTextDefaultStyle.fill = textFill;
        innerTextDefaultStyle.stroke = textStroke;
        innerTextDefaultStyle.autoStroke = autoStroke;
        innerTextDefaultStyle.align = textAlign;
        innerTextDefaultStyle.verticalAlign = textVerticalAlign;
        textEl.setDefaultTextStyle(innerTextDefaultStyle);
      }
      textEl.__dirty |= REDRAW_BIT;
      if (textStyleChanged) {
        textEl.dirtyStyle(true);
      }
    }
  };
  Element2.prototype.canBeInsideText = function() {
    return true;
  };
  Element2.prototype.getInsideTextFill = function() {
    return "#fff";
  };
  Element2.prototype.getInsideTextStroke = function(textFill) {
    return "#000";
  };
  Element2.prototype.getOutsideFill = function() {
    return this.__zr && this.__zr.isDarkMode() ? LIGHT_LABEL_COLOR : DARK_LABEL_COLOR;
  };
  Element2.prototype.getOutsideStroke = function(textFill) {
    var backgroundColor = this.__zr && this.__zr.getBackgroundColor();
    var colorArr = typeof backgroundColor === "string" && parse(backgroundColor);
    if (!colorArr) {
      colorArr = [255, 255, 255, 1];
    }
    var alpha = colorArr[3];
    var isDark = this.__zr.isDarkMode();
    for (var i = 0; i < 3; i++) {
      colorArr[i] = colorArr[i] * alpha + (isDark ? 0 : 255) * (1 - alpha);
    }
    colorArr[3] = 1;
    return stringify(colorArr, "rgba");
  };
  Element2.prototype.traverse = function(cb, context) {
  };
  Element2.prototype.attrKV = function(key2, value) {
    if (key2 === "textConfig") {
      this.setTextConfig(value);
    } else if (key2 === "textContent") {
      this.setTextContent(value);
    } else if (key2 === "clipPath") {
      this.setClipPath(value);
    } else if (key2 === "extra") {
      this.extra = this.extra || {};
      extend(this.extra, value);
    } else {
      this[key2] = value;
    }
  };
  Element2.prototype.hide = function() {
    this.ignore = true;
    this.markRedraw();
  };
  Element2.prototype.show = function() {
    this.ignore = false;
    this.markRedraw();
  };
  Element2.prototype.attr = function(keyOrObj, value) {
    if (typeof keyOrObj === "string") {
      this.attrKV(keyOrObj, value);
    } else if (isObject(keyOrObj)) {
      var obj = keyOrObj;
      var keysArr = keys(obj);
      for (var i = 0; i < keysArr.length; i++) {
        var key2 = keysArr[i];
        this.attrKV(key2, keyOrObj[key2]);
      }
    }
    this.markRedraw();
    return this;
  };
  Element2.prototype.saveCurrentToNormalState = function(toState) {
    this._innerSaveToNormal(toState);
    var normalState = this._normalState;
    for (var i = 0; i < this.animators.length; i++) {
      var animator = this.animators[i];
      var fromStateTransition = animator.__fromStateTransition;
      if (animator.getLoop() || fromStateTransition && fromStateTransition !== PRESERVED_NORMAL_STATE) {
        continue;
      }
      var targetName = animator.targetName;
      var target = targetName ? normalState[targetName] : normalState;
      animator.saveTo(target);
    }
  };
  Element2.prototype._innerSaveToNormal = function(toState) {
    var normalState = this._normalState;
    if (!normalState) {
      normalState = this._normalState = {};
    }
    if (toState.textConfig && !normalState.textConfig) {
      normalState.textConfig = this.textConfig;
    }
    this._savePrimaryToNormal(toState, normalState, PRIMARY_STATES_KEYS);
  };
  Element2.prototype._savePrimaryToNormal = function(toState, normalState, primaryKeys) {
    for (var i = 0; i < primaryKeys.length; i++) {
      var key2 = primaryKeys[i];
      if (toState[key2] != null && !(key2 in normalState)) {
        normalState[key2] = this[key2];
      }
    }
  };
  Element2.prototype.hasState = function() {
    return this.currentStates.length > 0;
  };
  Element2.prototype.getState = function(name) {
    return this.states[name];
  };
  Element2.prototype.ensureState = function(name) {
    var states = this.states;
    if (!states[name]) {
      states[name] = {};
    }
    return states[name];
  };
  Element2.prototype.clearStates = function(noAnimation) {
    this.useState(PRESERVED_NORMAL_STATE, false, noAnimation);
  };
  Element2.prototype.useState = function(stateName, keepCurrentStates, noAnimation, forceUseHoverLayer) {
    var toNormalState = stateName === PRESERVED_NORMAL_STATE;
    var hasStates = this.hasState();
    if (!hasStates && toNormalState) {
      return;
    }
    var currentStates = this.currentStates;
    var animationCfg = this.stateTransition;
    if (indexOf(currentStates, stateName) >= 0 && (keepCurrentStates || currentStates.length === 1)) {
      return;
    }
    var state;
    if (this.stateProxy && !toNormalState) {
      state = this.stateProxy(stateName);
    }
    if (!state) {
      state = this.states && this.states[stateName];
    }
    if (!state && !toNormalState) {
      logError("State " + stateName + " not exists.");
      return;
    }
    if (!toNormalState) {
      this.saveCurrentToNormalState(state);
    }
    var textContent = this._textContent;
    var useHoverLayer = shouldUseHoverLayer(this, textContent, state, forceUseHoverLayer);
    if (useHoverLayer && !this.__inHover) {
      this.__inHover = useHoverLayer;
    }
    this._applyStateObj(stateName, state, this._normalState, keepCurrentStates, canTransition(this, noAnimation, animationCfg), animationCfg);
    var textGuide = this._textGuide;
    if (textContent) {
      textContent.useState(stateName, keepCurrentStates, noAnimation, !!useHoverLayer);
    }
    if (textGuide) {
      textGuide.useState(stateName, keepCurrentStates, noAnimation, !!useHoverLayer);
    }
    if (toNormalState) {
      this.currentStates = [];
      this._normalState = {};
    } else {
      if (!keepCurrentStates) {
        this.currentStates = [stateName];
      } else {
        this.currentStates.push(stateName);
      }
    }
    this._updateAnimationTargets();
    this.markRedraw();
    if (!useHoverLayer && this.__inHover) {
      this.__inHover = IN_HOVER_LAYER_KIND_NO;
      this.__dirty &= ~REDRAW_BIT;
    }
    return state;
  };
  Element2.prototype.useStates = function(states, noAnimation, forceUseHoverLayer) {
    if (!states.length) {
      this.clearStates();
    } else {
      var stateObjects = [];
      var currentStates = this.currentStates;
      var len2 = states.length;
      var notChange = len2 === currentStates.length;
      if (notChange) {
        for (var i = 0; i < len2; i++) {
          if (states[i] !== currentStates[i]) {
            notChange = false;
            break;
          }
        }
      }
      if (notChange) {
        return;
      }
      for (var i = 0; i < len2; i++) {
        var stateName = states[i];
        var stateObj = void 0;
        if (this.stateProxy) {
          stateObj = this.stateProxy(stateName, states);
        }
        if (!stateObj) {
          stateObj = this.states[stateName];
        }
        if (stateObj) {
          stateObjects.push(stateObj);
        }
      }
      var lastStateObj = stateObjects[len2 - 1];
      var textContent = this._textContent;
      var useHoverLayer = shouldUseHoverLayer(this, textContent, lastStateObj, forceUseHoverLayer);
      if (useHoverLayer && !this.__inHover) {
        this.__inHover = useHoverLayer;
      }
      var mergedState = this._mergeStates(stateObjects);
      var animationCfg = this.stateTransition;
      this.saveCurrentToNormalState(mergedState);
      this._applyStateObj(states.join(","), mergedState, this._normalState, false, canTransition(this, noAnimation, animationCfg), animationCfg);
      var textGuide = this._textGuide;
      if (textContent) {
        textContent.useStates(states, noAnimation, !!useHoverLayer);
      }
      if (textGuide) {
        textGuide.useStates(states, noAnimation, !!useHoverLayer);
      }
      this._updateAnimationTargets();
      this.currentStates = states.slice();
      this.markRedraw();
      if (!useHoverLayer && this.__inHover) {
        this.__inHover = IN_HOVER_LAYER_KIND_NO;
        this.__dirty &= ~REDRAW_BIT;
      }
    }
  };
  Element2.prototype.isSilent = function() {
    var el = this;
    while (el) {
      if (el.silent) {
        return true;
      }
      var hostEl = el.__hostTarget;
      el = hostEl ? el.ignoreHostSilent ? null : hostEl : el.parent;
    }
    return false;
  };
  Element2.prototype._updateAnimationTargets = function() {
    for (var i = 0; i < this.animators.length; i++) {
      var animator = this.animators[i];
      if (animator.targetName) {
        animator.changeTarget(this[animator.targetName]);
      }
    }
  };
  Element2.prototype.removeState = function(state) {
    var idx = indexOf(this.currentStates, state);
    if (idx >= 0) {
      var currentStates = this.currentStates.slice();
      currentStates.splice(idx, 1);
      this.useStates(currentStates);
    }
  };
  Element2.prototype.replaceState = function(oldState, newState, forceAdd) {
    var currentStates = this.currentStates.slice();
    var idx = indexOf(currentStates, oldState);
    var newStateExists = indexOf(currentStates, newState) >= 0;
    if (idx >= 0) {
      if (!newStateExists) {
        currentStates[idx] = newState;
      } else {
        currentStates.splice(idx, 1);
      }
    } else if (forceAdd && !newStateExists) {
      currentStates.push(newState);
    }
    this.useStates(currentStates);
  };
  Element2.prototype.toggleState = function(state, enable) {
    if (enable) {
      this.useState(state, true);
    } else {
      this.removeState(state);
    }
  };
  Element2.prototype._mergeStates = function(states) {
    var mergedState = {};
    var mergedTextConfig;
    for (var i = 0; i < states.length; i++) {
      var state = states[i];
      extend(mergedState, state);
      if (state.textConfig) {
        mergedTextConfig = mergedTextConfig || {};
        extend(mergedTextConfig, state.textConfig);
      }
    }
    if (mergedTextConfig) {
      mergedState.textConfig = mergedTextConfig;
    }
    return mergedState;
  };
  Element2.prototype._applyStateObj = function(stateName, state, normalState, keepCurrentStates, transition, animationCfg) {
    if (this.__inHover === IN_HOVER_LAYER_KIND_ONLY_STYLE_CHANGE) {
      return;
    }
    var needsRestoreToNormal = !(state && keepCurrentStates);
    if (state && state.textConfig) {
      this.textConfig = extend({}, keepCurrentStates ? this.textConfig : normalState.textConfig);
      extend(this.textConfig, state.textConfig);
    } else if (needsRestoreToNormal) {
      if (normalState.textConfig) {
        this.textConfig = normalState.textConfig;
      }
    }
    var transitionTarget = {};
    var hasTransition = false;
    for (var i = 0; i < PRIMARY_STATES_KEYS.length; i++) {
      var key2 = PRIMARY_STATES_KEYS[i];
      var propNeedsTransition = transition && DEFAULT_ANIMATABLE_MAP[key2];
      if (state && state[key2] != null) {
        if (propNeedsTransition) {
          hasTransition = true;
          transitionTarget[key2] = state[key2];
        } else {
          this[key2] = state[key2];
        }
      } else if (needsRestoreToNormal) {
        if (normalState[key2] != null) {
          if (propNeedsTransition) {
            hasTransition = true;
            transitionTarget[key2] = normalState[key2];
          } else {
            this[key2] = normalState[key2];
          }
        }
      }
    }
    if (!transition) {
      for (var i = 0; i < this.animators.length; i++) {
        var animator = this.animators[i];
        var targetName = animator.targetName;
        if (!animator.getLoop()) {
          animator.__changeFinalValue(targetName ? (state || normalState)[targetName] : state || normalState);
        }
      }
    }
    if (hasTransition) {
      this._transitionState(stateName, transitionTarget, animationCfg);
    }
  };
  Element2.prototype._attachComponent = function(componentEl) {
    if (componentEl.__zr && !componentEl.__hostTarget) {
      if (false) {
        throw new Error("Text element has been added to zrender.");
      }
      return;
    }
    if (componentEl === this) {
      if (false) {
        throw new Error("Recursive component attachment.");
      }
      return;
    }
    var zr = this.__zr;
    if (zr) {
      componentEl.addSelfToZr(zr);
    }
    componentEl.__zr = zr;
    componentEl.__hostTarget = this;
  };
  Element2.prototype._detachComponent = function(componentEl) {
    if (componentEl.__zr) {
      componentEl.removeSelfFromZr(componentEl.__zr);
    }
    componentEl.__zr = null;
    componentEl.__hostTarget = null;
  };
  Element2.prototype.getClipPath = function() {
    return this._clipPath;
  };
  Element2.prototype.setClipPath = function(clipPath) {
    if (this._clipPath && this._clipPath !== clipPath) {
      this.removeClipPath();
    }
    this._attachComponent(clipPath);
    this._clipPath = clipPath;
    this.markRedraw();
  };
  Element2.prototype.removeClipPath = function() {
    var clipPath = this._clipPath;
    if (clipPath) {
      this._detachComponent(clipPath);
      this._clipPath = null;
      this.markRedraw();
    }
  };
  Element2.prototype.getTextContent = function() {
    return this._textContent;
  };
  Element2.prototype.setTextContent = function(textEl) {
    var previousTextContent = this._textContent;
    if (previousTextContent === textEl) {
      return;
    }
    if (previousTextContent && previousTextContent !== textEl) {
      this.removeTextContent();
    }
    if (false) {
      if (textEl.__zr && !textEl.__hostTarget) {
        throw new Error("Text element has been added to zrender.");
      }
    }
    textEl.innerTransformable = new Transformable_default();
    this._attachComponent(textEl);
    this._textContent = textEl;
    this.markRedraw();
  };
  Element2.prototype.setTextConfig = function(cfg) {
    if (!this.textConfig) {
      this.textConfig = {};
    }
    extend(this.textConfig, cfg);
    this.markRedraw();
  };
  Element2.prototype.removeTextConfig = function() {
    this.textConfig = null;
    this.markRedraw();
  };
  Element2.prototype.removeTextContent = function() {
    var textEl = this._textContent;
    if (textEl) {
      textEl.innerTransformable = null;
      this._detachComponent(textEl);
      this._textContent = null;
      this._innerTextDefaultStyle = null;
      this.markRedraw();
    }
  };
  Element2.prototype.getTextGuideLine = function() {
    return this._textGuide;
  };
  Element2.prototype.setTextGuideLine = function(guideLine) {
    if (this._textGuide && this._textGuide !== guideLine) {
      this.removeTextGuideLine();
    }
    this._attachComponent(guideLine);
    this._textGuide = guideLine;
    this.markRedraw();
  };
  Element2.prototype.removeTextGuideLine = function() {
    var textGuide = this._textGuide;
    if (textGuide) {
      this._detachComponent(textGuide);
      this._textGuide = null;
      this.markRedraw();
    }
  };
  Element2.prototype.markRedraw = function() {
    this.__dirty |= REDRAW_BIT;
    var zr = this.__zr;
    if (zr) {
      if (this.__inHover) {
        zr.refreshHover();
      } else {
        zr.refresh();
      }
    }
    if (this.__hostTarget) {
      this.__hostTarget.markRedraw();
    }
  };
  Element2.prototype.dirty = function() {
    this.markRedraw();
  };
  Element2.prototype.addSelfToZr = function(zr) {
    if (this.__zr === zr) {
      return;
    }
    this.__zr = zr;
    var animators = this.animators;
    if (animators) {
      for (var i = 0; i < animators.length; i++) {
        zr.animation.addAnimator(animators[i]);
      }
    }
    if (this._clipPath) {
      this._clipPath.addSelfToZr(zr);
    }
    if (this._textContent) {
      this._textContent.addSelfToZr(zr);
    }
    if (this._textGuide) {
      this._textGuide.addSelfToZr(zr);
    }
  };
  Element2.prototype.removeSelfFromZr = function(zr) {
    if (!this.__zr) {
      return;
    }
    this.__zr = null;
    var animators = this.animators;
    if (animators) {
      for (var i = 0; i < animators.length; i++) {
        zr.animation.removeAnimator(animators[i]);
      }
    }
    if (this._clipPath) {
      this._clipPath.removeSelfFromZr(zr);
    }
    if (this._textContent) {
      this._textContent.removeSelfFromZr(zr);
    }
    if (this._textGuide) {
      this._textGuide.removeSelfFromZr(zr);
    }
  };
  Element2.prototype.animate = function(key2, loop, allowDiscreteAnimation) {
    var target = key2 ? this[key2] : this;
    if (false) {
      if (!target) {
        logError('Property "' + key2 + '" is not existed in element ' + this.id);
        return;
      }
    }
    var animator = new Animator_default(target, loop, allowDiscreteAnimation);
    key2 && (animator.targetName = key2);
    this.addAnimator(animator, key2);
    return animator;
  };
  Element2.prototype.addAnimator = function(animator, key2) {
    var zr = this.__zr;
    var el = this;
    animator.during(function() {
      el.updateDuringAnimation(key2);
    }).done(function() {
      var animators = el.animators;
      var idx = indexOf(animators, animator);
      if (idx >= 0) {
        animators.splice(idx, 1);
      }
    });
    this.animators.push(animator);
    if (zr) {
      zr.animation.addAnimator(animator);
    }
    zr && zr.wakeUp();
  };
  Element2.prototype.updateDuringAnimation = function(key2) {
    this.markRedraw();
  };
  Element2.prototype.stopAnimation = function(scope, forwardToLast) {
    var animators = this.animators;
    var len2 = animators.length;
    var leftAnimators = [];
    for (var i = 0; i < len2; i++) {
      var animator = animators[i];
      if (!scope || scope === animator.scope) {
        animator.stop(forwardToLast);
      } else {
        leftAnimators.push(animator);
      }
    }
    this.animators = leftAnimators;
    return this;
  };
  Element2.prototype.animateTo = function(target, cfg, animationProps) {
    animateTo(this, target, cfg, animationProps);
  };
  Element2.prototype.animateFrom = function(target, cfg, animationProps) {
    animateTo(this, target, cfg, animationProps, true);
  };
  Element2.prototype._transitionState = function(stateName, target, cfg, animationProps) {
    var animators = animateTo(this, target, cfg, animationProps);
    for (var i = 0; i < animators.length; i++) {
      animators[i].__fromStateTransition = stateName;
    }
  };
  Element2.prototype.getBoundingRect = function() {
    return null;
  };
  Element2.prototype.getPaintRect = function() {
    return null;
  };
  Element2.initDefaultProps = (function() {
    var elProto = Element2.prototype;
    elProto.type = "element";
    elProto.name = "";
    elProto.ignore = elProto.silent = elProto.ignoreHostSilent = elProto.isGroup = elProto.draggable = elProto.dragging = elProto.ignoreClip = false;
    elProto.__inHover = IN_HOVER_LAYER_KIND_NO;
    elProto.__dirty = REDRAW_BIT;
    var logs = {};
    function logDeprecatedError(key2, xKey, yKey) {
      if (!logs[key2 + xKey + yKey]) {
        console.warn("DEPRECATED: '" + key2 + "' has been deprecated. use '" + xKey + "', '" + yKey + "' instead");
        logs[key2 + xKey + yKey] = true;
      }
    }
    function createLegacyProperty(key2, privateKey, xKey, yKey) {
      Object.defineProperty(elProto, key2, {
        get: function() {
          if (false) {
            logDeprecatedError(key2, xKey, yKey);
          }
          if (!this[privateKey]) {
            var pos = this[privateKey] = [];
            enhanceArray(this, pos);
          }
          return this[privateKey];
        },
        set: function(pos) {
          if (false) {
            logDeprecatedError(key2, xKey, yKey);
          }
          this[xKey] = pos[0];
          this[yKey] = pos[1];
          this[privateKey] = pos;
          enhanceArray(this, pos);
        }
      });
      function enhanceArray(self2, pos) {
        Object.defineProperty(pos, 0, {
          get: function() {
            return self2[xKey];
          },
          set: function(val) {
            self2[xKey] = val;
          }
        });
        Object.defineProperty(pos, 1, {
          get: function() {
            return self2[yKey];
          },
          set: function(val) {
            self2[yKey] = val;
          }
        });
      }
    }
    if (Object.defineProperty) {
      createLegacyProperty("position", "_legacyPos", "x", "y");
      createLegacyProperty("scale", "_legacyScale", "scaleX", "scaleY");
      createLegacyProperty("origin", "_legacyOrigin", "originX", "originY");
    }
  })();
  return Element2;
})();
mixin(Element, Eventful_default);
mixin(Element, Transformable_default);
function animateTo(animatable, target, cfg, animationProps, reverse2) {
  cfg = cfg || {};
  var animators = [];
  animateToShallow(animatable, "", animatable, target, cfg, animationProps, animators, reverse2);
  var finishCount = animators.length;
  var doneHappened = false;
  var cfgDone = cfg.done;
  var cfgAborted = cfg.aborted;
  var doneCb = function() {
    doneHappened = true;
    finishCount--;
    if (finishCount <= 0) {
      doneHappened ? cfgDone && cfgDone() : cfgAborted && cfgAborted();
    }
  };
  var abortedCb = function() {
    finishCount--;
    if (finishCount <= 0) {
      doneHappened ? cfgDone && cfgDone() : cfgAborted && cfgAborted();
    }
  };
  if (!finishCount) {
    cfgDone && cfgDone();
  }
  if (animators.length > 0 && cfg.during) {
    animators[0].during(function(target2, percent) {
      cfg.during(percent);
    });
  }
  for (var i = 0; i < animators.length; i++) {
    var animator = animators[i];
    if (doneCb) {
      animator.done(doneCb);
    }
    if (abortedCb) {
      animator.aborted(abortedCb);
    }
    if (cfg.force) {
      animator.duration(cfg.duration);
    }
    animator.start(cfg.easing);
  }
  return animators;
}
function copyArrShallow(source, target, len2) {
  for (var i = 0; i < len2; i++) {
    source[i] = target[i];
  }
}
function is2DArray(value) {
  return isArrayLike(value[0]);
}
function copyValue(target, source, key2) {
  if (isArrayLike(source[key2])) {
    if (!isArrayLike(target[key2])) {
      target[key2] = [];
    }
    if (isTypedArray(source[key2])) {
      var len2 = source[key2].length;
      if (target[key2].length !== len2) {
        target[key2] = new source[key2].constructor(len2);
        copyArrShallow(target[key2], source[key2], len2);
      }
    } else {
      var sourceArr = source[key2];
      var targetArr = target[key2];
      var len0 = sourceArr.length;
      if (is2DArray(sourceArr)) {
        var len1 = sourceArr[0].length;
        for (var i = 0; i < len0; i++) {
          if (!targetArr[i]) {
            targetArr[i] = Array.prototype.slice.call(sourceArr[i]);
          } else {
            copyArrShallow(targetArr[i], sourceArr[i], len1);
          }
        }
      } else {
        copyArrShallow(targetArr, sourceArr, len0);
      }
      targetArr.length = sourceArr.length;
    }
  } else {
    target[key2] = source[key2];
  }
}
function isValueSame(val1, val2) {
  return val1 === val2 || isArrayLike(val1) && isArrayLike(val2) && is1DArraySame(val1, val2);
}
function is1DArraySame(arr0, arr1) {
  var len2 = arr0.length;
  if (len2 !== arr1.length) {
    return false;
  }
  for (var i = 0; i < len2; i++) {
    if (arr0[i] !== arr1[i]) {
      return false;
    }
  }
  return true;
}
function animateToShallow(animatable, topKey, animateObj, target, cfg, animationProps, animators, reverse2) {
  var targetKeys = keys(target);
  var duration = cfg.duration;
  var delay = cfg.delay;
  var additive = cfg.additive;
  var setToFinal = cfg.setToFinal;
  var animateAll = !isObject(animationProps);
  var existsAnimators = animatable.animators;
  var animationKeys = [];
  for (var k = 0; k < targetKeys.length; k++) {
    var innerKey = targetKeys[k];
    var targetVal = target[innerKey];
    if (targetVal != null && animateObj[innerKey] != null && (animateAll || animationProps[innerKey])) {
      if (isObject(targetVal) && !isArrayLike(targetVal) && !isGradientObject(targetVal)) {
        if (topKey) {
          if (!reverse2) {
            animateObj[innerKey] = targetVal;
            animatable.updateDuringAnimation(topKey);
          }
          continue;
        }
        animateToShallow(animatable, innerKey, animateObj[innerKey], targetVal, cfg, animationProps && animationProps[innerKey], animators, reverse2);
      } else {
        animationKeys.push(innerKey);
      }
    } else if (!reverse2) {
      animateObj[innerKey] = targetVal;
      animatable.updateDuringAnimation(topKey);
      animationKeys.push(innerKey);
    }
  }
  var keyLen = animationKeys.length;
  if (!additive && keyLen) {
    for (var i = 0; i < existsAnimators.length; i++) {
      var animator = existsAnimators[i];
      if (animator.targetName === topKey) {
        var allAborted = animator.stopTracks(animationKeys);
        if (allAborted) {
          var idx = indexOf(existsAnimators, animator);
          existsAnimators.splice(idx, 1);
        }
      }
    }
  }
  if (!cfg.force) {
    animationKeys = filter(animationKeys, function(key2) {
      return !isValueSame(target[key2], animateObj[key2]);
    });
    keyLen = animationKeys.length;
  }
  if (keyLen > 0 || cfg.force && !animators.length) {
    var revertedSource = void 0;
    var reversedTarget = void 0;
    var sourceClone = void 0;
    if (reverse2) {
      reversedTarget = {};
      if (setToFinal) {
        revertedSource = {};
      }
      for (var i = 0; i < keyLen; i++) {
        var innerKey = animationKeys[i];
        reversedTarget[innerKey] = animateObj[innerKey];
        if (setToFinal) {
          revertedSource[innerKey] = target[innerKey];
        } else {
          animateObj[innerKey] = target[innerKey];
        }
      }
    } else if (setToFinal) {
      sourceClone = {};
      for (var i = 0; i < keyLen; i++) {
        var innerKey = animationKeys[i];
        sourceClone[innerKey] = cloneValue(animateObj[innerKey]);
        copyValue(animateObj, target, innerKey);
      }
    }
    var animator = new Animator_default(animateObj, false, false, additive ? filter(existsAnimators, function(animator2) {
      return animator2.targetName === topKey;
    }) : null);
    animator.targetName = topKey;
    if (cfg.scope) {
      animator.scope = cfg.scope;
    }
    if (setToFinal && revertedSource) {
      animator.whenWithKeys(0, revertedSource, animationKeys);
    }
    if (sourceClone) {
      animator.whenWithKeys(0, sourceClone, animationKeys);
    }
    animator.whenWithKeys(duration == null ? 500 : duration, reverse2 ? reversedTarget : target, animationKeys).delay(delay || 0);
    animatable.addAnimator(animator, topKey);
    animators.push(animator);
  }
}
function shouldUseHoverLayer(el, textContent, nextState, forceUseHoverLayer) {
  return !(nextState && nextState.hoverLayer || forceUseHoverLayer) || isTextRelatedEl(el) || textContent && isTextRelatedEl(textContent) ? IN_HOVER_LAYER_KIND_NO : IN_HOVER_LAYER_KIND_ONLY_STYLE_CHANGE;
}
function isTextRelatedEl(el) {
  return el.type === "text" || el.type === "tspan";
}
function canTransition(el, noAnimation, animationCfg) {
  return !noAnimation && !el.__inHover && animationCfg && animationCfg.duration > 0;
}
var Element_default = Element;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/graphic/Displayable.js
var STYLE_MAGIC_KEY = "__zr_style_" + Math.round(Math.random() * 10);
var DEFAULT_COMMON_STYLE = {
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  shadowColor: "#000",
  opacity: 1,
  blend: "source-over"
};
var DEFAULT_COMMON_ANIMATION_PROPS = {
  style: {
    shadowBlur: true,
    shadowOffsetX: true,
    shadowOffsetY: true,
    shadowColor: true,
    opacity: true
  }
};
DEFAULT_COMMON_STYLE[STYLE_MAGIC_KEY] = true;
var PRIMARY_STATES_KEYS2 = ["z", "z2", "invisible"];
var PRIMARY_STATES_KEYS_IN_HOVER_LAYER = ["invisible"];
var Displayable = (function(_super) {
  __extends(Displayable2, _super);
  function Displayable2(props) {
    return _super.call(this, props) || this;
  }
  Displayable2.prototype._init = function(props) {
    var keysArr = keys(props);
    for (var i = 0; i < keysArr.length; i++) {
      var key2 = keysArr[i];
      if (key2 === "style") {
        this.useStyle(props[key2]);
      } else {
        _super.prototype.attrKV.call(this, key2, props[key2]);
      }
    }
    if (!this.style) {
      this.useStyle({});
    }
  };
  Displayable2.prototype.beforeBrush = function(param) {
  };
  Displayable2.prototype.afterBrush = function() {
  };
  Displayable2.prototype.innerBeforeBrush = function() {
  };
  Displayable2.prototype.innerAfterBrush = function() {
  };
  Displayable2.prototype.shouldBePainted = function(viewWidth, viewHeight, considerClipPath, considerAncestors) {
    var m = this.transform;
    if (this.ignore || this.invisible || this.style.opacity === 0 || this.culling && isDisplayableCulled(this, viewWidth, viewHeight) || m && !m[0] && !m[3]) {
      return false;
    }
    if (considerClipPath && this.__clipPaths && this.__clipPaths.length) {
      for (var i = 0; i < this.__clipPaths.length; ++i) {
        if (this.__clipPaths[i].isZeroArea()) {
          return false;
        }
      }
    }
    if (considerAncestors && this.parent) {
      var parent_1 = this.parent;
      while (parent_1) {
        if (parent_1.ignore) {
          return false;
        }
        parent_1 = parent_1.parent;
      }
    }
    return true;
  };
  Displayable2.prototype.contain = function(x, y) {
    return this.rectContain(x, y);
  };
  Displayable2.prototype.traverse = function(cb, context) {
    cb.call(context, this);
  };
  Displayable2.prototype.rectContain = function(x, y) {
    var coord = this.transformCoordToLocal(x, y);
    var rect = this.getBoundingRect();
    return rect.contain(coord[0], coord[1]);
  };
  Displayable2.prototype.getPaintRect = function() {
    var rect = this._paintRect;
    if (!this._paintRect || this.__dirty) {
      var transform = this.transform;
      var elRect = this.getBoundingRect();
      var style = this.style;
      var shadowSize = style.shadowBlur || 0;
      var shadowOffsetX = style.shadowOffsetX || 0;
      var shadowOffsetY = style.shadowOffsetY || 0;
      rect = this._paintRect || (this._paintRect = new BoundingRect_default(0, 0, 0, 0));
      if (transform) {
        BoundingRect_default.applyTransform(rect, elRect, transform);
      } else {
        rect.copy(elRect);
      }
      if (shadowSize || shadowOffsetX || shadowOffsetY) {
        rect.width += shadowSize * 2 + Math.abs(shadowOffsetX);
        rect.height += shadowSize * 2 + Math.abs(shadowOffsetY);
        rect.x = Math.min(rect.x, rect.x + shadowOffsetX - shadowSize);
        rect.y = Math.min(rect.y, rect.y + shadowOffsetY - shadowSize);
      }
      var tolerance = this.dirtyRectTolerance;
      if (!rect.isZero()) {
        rect.x = Math.floor(rect.x - tolerance);
        rect.y = Math.floor(rect.y - tolerance);
        rect.width = Math.ceil(rect.width + 1 + tolerance * 2);
        rect.height = Math.ceil(rect.height + 1 + tolerance * 2);
      }
    }
    return rect;
  };
  Displayable2.prototype.setPrevPaintRect = function(paintRect) {
    if (paintRect) {
      this._prevPaintRect = this._prevPaintRect || new BoundingRect_default(0, 0, 0, 0);
      this._prevPaintRect.copy(paintRect);
    } else {
      this._prevPaintRect = null;
    }
  };
  Displayable2.prototype.getPrevPaintRect = function() {
    return this._prevPaintRect;
  };
  Displayable2.prototype.animateStyle = function(loop) {
    return this.animate("style", loop);
  };
  Displayable2.prototype.updateDuringAnimation = function(targetKey) {
    if (targetKey === "style") {
      this.dirtyStyle();
    } else {
      this.markRedraw();
    }
  };
  Displayable2.prototype.attrKV = function(key2, value) {
    if (key2 !== "style") {
      _super.prototype.attrKV.call(this, key2, value);
    } else {
      if (!this.style) {
        this.useStyle(value);
      } else {
        this.setStyle(value);
      }
    }
  };
  Displayable2.prototype.setStyle = function(keyOrObj, value) {
    if (typeof keyOrObj === "string") {
      this.style[keyOrObj] = value;
    } else {
      extend(this.style, keyOrObj);
    }
    this.dirtyStyle();
    return this;
  };
  Displayable2.prototype.dirtyStyle = function(notRedraw) {
    if (!notRedraw) {
      this.markRedraw();
    }
    this.__dirty |= STYLE_CHANGED_BIT;
    if (this._rect) {
      this._rect = null;
    }
  };
  Displayable2.prototype.dirty = function() {
    this.dirtyStyle();
  };
  Displayable2.prototype.styleChanged = function() {
    return !!(this.__dirty & STYLE_CHANGED_BIT);
  };
  Displayable2.prototype.styleUpdated = function() {
    this.__dirty &= ~STYLE_CHANGED_BIT;
  };
  Displayable2.prototype.createStyle = function(obj) {
    return createObject(DEFAULT_COMMON_STYLE, obj);
  };
  Displayable2.prototype.useStyle = function(obj) {
    if (!obj[STYLE_MAGIC_KEY]) {
      obj = this.createStyle(obj);
    }
    this.style = obj;
    this.dirtyStyle();
  };
  Displayable2.prototype._useHoverStyle = function(obj) {
    this.__hoverStyle = obj;
  };
  Displayable2.prototype.isStyleObject = function(obj) {
    return obj[STYLE_MAGIC_KEY];
  };
  Displayable2.prototype._innerSaveToNormal = function(toState) {
    _super.prototype._innerSaveToNormal.call(this, toState);
    var normalState = this._normalState;
    if (toState.style && !normalState.style) {
      normalState.style = this._mergeStyle(this.createStyle(), this.style);
    }
    this._savePrimaryToNormal(toState, normalState, PRIMARY_STATES_KEYS2);
  };
  Displayable2.prototype._applyStateObj = function(stateName, state, normalState, keepCurrentStates, transition, animationCfg) {
    _super.prototype._applyStateObj.call(this, stateName, state, normalState, keepCurrentStates, transition, animationCfg);
    var needsRestoreToNormal = !(state && keepCurrentStates);
    var inHoverOnlyStyleChange = this.__inHover === IN_HOVER_LAYER_KIND_ONLY_STYLE_CHANGE;
    var targetStyle;
    if (state && state.style) {
      if (transition) {
        if (keepCurrentStates) {
          targetStyle = state.style;
        } else {
          targetStyle = this._mergeStyle(this.createStyle(), normalState.style);
          this._mergeStyle(targetStyle, state.style);
        }
      } else {
        targetStyle = this._mergeStyle(this.createStyle(), keepCurrentStates ? this.style : normalState.style);
        this._mergeStyle(targetStyle, state.style);
      }
    } else if (needsRestoreToNormal) {
      targetStyle = normalState.style;
    }
    if (targetStyle) {
      if (transition) {
        var sourceStyle = this.style;
        this.style = this.createStyle(needsRestoreToNormal ? {} : sourceStyle);
        if (needsRestoreToNormal) {
          var changedKeys = keys(sourceStyle);
          for (var i = 0; i < changedKeys.length; i++) {
            var key2 = changedKeys[i];
            if (key2 in targetStyle) {
              targetStyle[key2] = targetStyle[key2];
              this.style[key2] = sourceStyle[key2];
            }
          }
        }
        var targetKeys = keys(targetStyle);
        for (var i = 0; i < targetKeys.length; i++) {
          var key2 = targetKeys[i];
          this.style[key2] = this.style[key2];
        }
        this._transitionState(stateName, {
          style: targetStyle
        }, animationCfg, this.getAnimationStyleProps());
      } else {
        if (inHoverOnlyStyleChange) {
          this._useHoverStyle(targetStyle);
        } else {
          this.useStyle(targetStyle);
        }
      }
    }
    if (!inHoverOnlyStyleChange) {
      var statesKeys = this.__inHover ? PRIMARY_STATES_KEYS_IN_HOVER_LAYER : PRIMARY_STATES_KEYS2;
      for (var i = 0; i < statesKeys.length; i++) {
        var key2 = statesKeys[i];
        if (state && state[key2] != null) {
          this[key2] = state[key2];
        } else if (needsRestoreToNormal) {
          if (normalState[key2] != null) {
            this[key2] = normalState[key2];
          }
        }
      }
    }
  };
  Displayable2.prototype._mergeStates = function(states) {
    var mergedState = _super.prototype._mergeStates.call(this, states);
    var mergedStyle;
    for (var i = 0; i < states.length; i++) {
      var state = states[i];
      if (state.style) {
        mergedStyle = mergedStyle || {};
        this._mergeStyle(mergedStyle, state.style);
      }
    }
    if (mergedStyle) {
      mergedState.style = mergedStyle;
    }
    return mergedState;
  };
  Displayable2.prototype._mergeStyle = function(targetStyle, sourceStyle) {
    extend(targetStyle, sourceStyle);
    return targetStyle;
  };
  Displayable2.prototype.getAnimationStyleProps = function() {
    return DEFAULT_COMMON_ANIMATION_PROPS;
  };
  Displayable2.initDefaultProps = (function() {
    var dispProto = Displayable2.prototype;
    dispProto.type = "displayable";
    dispProto.invisible = false;
    dispProto.z = 0;
    dispProto.z2 = 0;
    dispProto.zlevel = 0;
    dispProto.culling = false;
    dispProto.cursor = "pointer";
    dispProto.rectHover = false;
    dispProto.incremental = 0;
    dispProto._rect = null;
    dispProto.dirtyRectTolerance = 0;
    dispProto.__dirty = REDRAW_BIT | STYLE_CHANGED_BIT;
  })();
  return Displayable2;
})(Element_default);
var tmpRect = new BoundingRect_default(0, 0, 0, 0);
var viewRect = new BoundingRect_default(0, 0, 0, 0);
function isDisplayableCulled(el, width, height) {
  tmpRect.copy(el.getBoundingRect());
  if (el.transform) {
    tmpRect.applyTransform(el.transform);
  }
  viewRect.width = width;
  viewRect.height = height;
  return !tmpRect.intersect(viewRect);
}
var Displayable_default = Displayable;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/core/bbox.js
var mathMin3 = Math.min;
var mathMax3 = Math.max;
var mathSin = Math.sin;
var mathCos = Math.cos;
var PI2 = Math.PI * 2;
var start = create2();
var end = create2();
var extremity = create2();
function fromPoints(points2, min3, max3) {
  if (points2.length === 0) {
    return;
  }
  var p = points2[0];
  var left = p[0];
  var right = p[0];
  var top = p[1];
  var bottom = p[1];
  for (var i = 1; i < points2.length; i++) {
    p = points2[i];
    left = mathMin3(left, p[0]);
    right = mathMax3(right, p[0]);
    top = mathMin3(top, p[1]);
    bottom = mathMax3(bottom, p[1]);
  }
  min3[0] = left;
  min3[1] = top;
  max3[0] = right;
  max3[1] = bottom;
}
function fromLine(x0, y0, x1, y1, min3, max3) {
  min3[0] = mathMin3(x0, x1);
  min3[1] = mathMin3(y0, y1);
  max3[0] = mathMax3(x0, x1);
  max3[1] = mathMax3(y0, y1);
}
var xDim = [];
var yDim = [];
function fromCubic(x0, y0, x1, y1, x2, y2, x3, y3, min3, max3) {
  var cubicExtrema2 = cubicExtrema;
  var cubicAt2 = cubicAt;
  var n = cubicExtrema2(x0, x1, x2, x3, xDim);
  min3[0] = Infinity;
  min3[1] = Infinity;
  max3[0] = -Infinity;
  max3[1] = -Infinity;
  for (var i = 0; i < n; i++) {
    var x = cubicAt2(x0, x1, x2, x3, xDim[i]);
    min3[0] = mathMin3(x, min3[0]);
    max3[0] = mathMax3(x, max3[0]);
  }
  n = cubicExtrema2(y0, y1, y2, y3, yDim);
  for (var i = 0; i < n; i++) {
    var y = cubicAt2(y0, y1, y2, y3, yDim[i]);
    min3[1] = mathMin3(y, min3[1]);
    max3[1] = mathMax3(y, max3[1]);
  }
  min3[0] = mathMin3(x0, min3[0]);
  max3[0] = mathMax3(x0, max3[0]);
  min3[0] = mathMin3(x3, min3[0]);
  max3[0] = mathMax3(x3, max3[0]);
  min3[1] = mathMin3(y0, min3[1]);
  max3[1] = mathMax3(y0, max3[1]);
  min3[1] = mathMin3(y3, min3[1]);
  max3[1] = mathMax3(y3, max3[1]);
}
function fromQuadratic(x0, y0, x1, y1, x2, y2, min3, max3) {
  var quadraticExtremum2 = quadraticExtremum;
  var quadraticAt2 = quadraticAt;
  var tx = mathMax3(mathMin3(quadraticExtremum2(x0, x1, x2), 1), 0);
  var ty = mathMax3(mathMin3(quadraticExtremum2(y0, y1, y2), 1), 0);
  var x = quadraticAt2(x0, x1, x2, tx);
  var y = quadraticAt2(y0, y1, y2, ty);
  min3[0] = mathMin3(x0, x2, x);
  min3[1] = mathMin3(y0, y2, y);
  max3[0] = mathMax3(x0, x2, x);
  max3[1] = mathMax3(y0, y2, y);
}
function fromArc(x, y, rx, ry, startAngle, endAngle, anticlockwise, min3, max3) {
  var vec2Min = min;
  var vec2Max = max;
  var diff = Math.abs(startAngle - endAngle);
  if (diff % PI2 < 1e-4 && diff > 1e-4) {
    min3[0] = x - rx;
    min3[1] = y - ry;
    max3[0] = x + rx;
    max3[1] = y + ry;
    return;
  }
  start[0] = mathCos(startAngle) * rx + x;
  start[1] = mathSin(startAngle) * ry + y;
  end[0] = mathCos(endAngle) * rx + x;
  end[1] = mathSin(endAngle) * ry + y;
  vec2Min(min3, start, end);
  vec2Max(max3, start, end);
  startAngle = startAngle % PI2;
  if (startAngle < 0) {
    startAngle = startAngle + PI2;
  }
  endAngle = endAngle % PI2;
  if (endAngle < 0) {
    endAngle = endAngle + PI2;
  }
  if (startAngle > endAngle && !anticlockwise) {
    endAngle += PI2;
  } else if (startAngle < endAngle && anticlockwise) {
    startAngle += PI2;
  }
  if (anticlockwise) {
    var tmp = endAngle;
    endAngle = startAngle;
    startAngle = tmp;
  }
  for (var angle = 0; angle < endAngle; angle += Math.PI / 2) {
    if (angle > startAngle) {
      extremity[0] = mathCos(angle) * rx + x;
      extremity[1] = mathSin(angle) * ry + y;
      vec2Min(min3, extremity, min3);
      vec2Max(max3, extremity, max3);
    }
  }
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/core/PathProxy.js
var CMD = {
  M: 1,
  L: 2,
  C: 3,
  Q: 4,
  A: 5,
  Z: 6,
  R: 7
};
var tmpOutX = [];
var tmpOutY = [];
var min2 = [];
var max2 = [];
var min22 = [];
var max22 = [];
var mathMin4 = Math.min;
var mathMax4 = Math.max;
var mathCos2 = Math.cos;
var mathSin2 = Math.sin;
var mathAbs3 = Math.abs;
var PI = Math.PI;
var PI22 = PI * 2;
var hasTypedArray = typeof Float32Array !== "undefined";
var tmpAngles = [];
function modPI2(radian) {
  var n = Math.round(radian / PI * 1e8) / 1e8;
  return n % 2 * PI;
}
function normalizeArcAngles(angles, anticlockwise) {
  var newStartAngle = modPI2(angles[0]);
  if (newStartAngle < 0) {
    newStartAngle += PI22;
  }
  var delta = newStartAngle - angles[0];
  var newEndAngle = angles[1];
  newEndAngle += delta;
  if (!anticlockwise && newEndAngle - newStartAngle >= PI22) {
    newEndAngle = newStartAngle + PI22;
  } else if (anticlockwise && newStartAngle - newEndAngle >= PI22) {
    newEndAngle = newStartAngle - PI22;
  } else if (!anticlockwise && newStartAngle > newEndAngle) {
    newEndAngle = newStartAngle + (PI22 - modPI2(newStartAngle - newEndAngle));
  } else if (anticlockwise && newStartAngle < newEndAngle) {
    newEndAngle = newStartAngle - (PI22 - modPI2(newEndAngle - newStartAngle));
  }
  angles[0] = newStartAngle;
  angles[1] = newEndAngle;
}
var PathProxy = (function() {
  function PathProxy2(notSaveData) {
    this.dpr = 1;
    this._xi = 0;
    this._yi = 0;
    this._x0 = 0;
    this._y0 = 0;
    this._len = 0;
    if (notSaveData) {
      this._saveData = false;
    }
    if (this._saveData) {
      this.data = [];
    }
  }
  PathProxy2.prototype.increaseVersion = function() {
    this._version++;
  };
  PathProxy2.prototype.getVersion = function() {
    return this._version;
  };
  PathProxy2.prototype.setScale = function(sx, sy, segmentIgnoreThreshold) {
    segmentIgnoreThreshold = segmentIgnoreThreshold || 0;
    if (segmentIgnoreThreshold > 0) {
      this._ux = mathAbs3(segmentIgnoreThreshold / devicePixelRatio / sx) || 0;
      this._uy = mathAbs3(segmentIgnoreThreshold / devicePixelRatio / sy) || 0;
    }
  };
  PathProxy2.prototype.setDPR = function(dpr2) {
    this.dpr = dpr2;
  };
  PathProxy2.prototype.setContext = function(ctx) {
    this._ctx = ctx;
  };
  PathProxy2.prototype.getContext = function() {
    return this._ctx;
  };
  PathProxy2.prototype.beginPath = function() {
    this._ctx && this._ctx.beginPath();
    this.reset();
    return this;
  };
  PathProxy2.prototype.reset = function() {
    if (this._saveData) {
      this._len = 0;
    }
    if (this._pathSegLen) {
      this._pathSegLen = null;
      this._pathLen = 0;
    }
    this._version++;
  };
  PathProxy2.prototype.moveTo = function(x, y) {
    this._drawPendingPt();
    this.addData(CMD.M, x, y);
    this._ctx && this._ctx.moveTo(x, y);
    this._x0 = x;
    this._y0 = y;
    this._xi = x;
    this._yi = y;
    return this;
  };
  PathProxy2.prototype.lineTo = function(x, y) {
    var dx = mathAbs3(x - this._xi);
    var dy = mathAbs3(y - this._yi);
    var exceedUnit = dx > this._ux || dy > this._uy;
    this.addData(CMD.L, x, y);
    if (this._ctx && exceedUnit) {
      this._ctx.lineTo(x, y);
    }
    if (exceedUnit) {
      this._xi = x;
      this._yi = y;
      this._pendingPtDist = 0;
    } else {
      var d2 = dx * dx + dy * dy;
      if (d2 > this._pendingPtDist) {
        this._pendingPtX = x;
        this._pendingPtY = y;
        this._pendingPtDist = d2;
      }
    }
    return this;
  };
  PathProxy2.prototype.bezierCurveTo = function(x1, y1, x2, y2, x3, y3) {
    this._drawPendingPt();
    this.addData(CMD.C, x1, y1, x2, y2, x3, y3);
    if (this._ctx) {
      this._ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3);
    }
    this._xi = x3;
    this._yi = y3;
    return this;
  };
  PathProxy2.prototype.quadraticCurveTo = function(x1, y1, x2, y2) {
    this._drawPendingPt();
    this.addData(CMD.Q, x1, y1, x2, y2);
    if (this._ctx) {
      this._ctx.quadraticCurveTo(x1, y1, x2, y2);
    }
    this._xi = x2;
    this._yi = y2;
    return this;
  };
  PathProxy2.prototype.arc = function(cx, cy, r, startAngle, endAngle, anticlockwise) {
    this._drawPendingPt();
    tmpAngles[0] = startAngle;
    tmpAngles[1] = endAngle;
    normalizeArcAngles(tmpAngles, anticlockwise);
    startAngle = tmpAngles[0];
    endAngle = tmpAngles[1];
    var delta = endAngle - startAngle;
    this.addData(CMD.A, cx, cy, r, r, startAngle, delta, 0, anticlockwise ? 0 : 1);
    this._ctx && this._ctx.arc(cx, cy, r, startAngle, endAngle, anticlockwise);
    this._xi = mathCos2(endAngle) * r + cx;
    this._yi = mathSin2(endAngle) * r + cy;
    return this;
  };
  PathProxy2.prototype.arcTo = function(x1, y1, x2, y2, radius) {
    this._drawPendingPt();
    if (this._ctx) {
      this._ctx.arcTo(x1, y1, x2, y2, radius);
    }
    return this;
  };
  PathProxy2.prototype.rect = function(x, y, w, h) {
    this._drawPendingPt();
    this._ctx && this._ctx.rect(x, y, w, h);
    this.addData(CMD.R, x, y, w, h);
    return this;
  };
  PathProxy2.prototype.closePath = function() {
    this._drawPendingPt();
    this.addData(CMD.Z);
    var ctx = this._ctx;
    var x0 = this._x0;
    var y0 = this._y0;
    if (ctx) {
      ctx.closePath();
    }
    this._xi = x0;
    this._yi = y0;
    return this;
  };
  PathProxy2.prototype.fill = function(ctx) {
    ctx && ctx.fill();
    this.toStatic();
  };
  PathProxy2.prototype.stroke = function(ctx) {
    ctx && ctx.stroke();
    this.toStatic();
  };
  PathProxy2.prototype.len = function() {
    return this._len;
  };
  PathProxy2.prototype.setData = function(data) {
    if (!this._saveData) {
      return;
    }
    var len2 = data.length;
    if (!(this.data && this.data.length === len2) && hasTypedArray) {
      this.data = new Float32Array(len2);
    }
    for (var i = 0; i < len2; i++) {
      this.data[i] = data[i];
    }
    this._len = len2;
  };
  PathProxy2.prototype.appendPath = function(path) {
    if (!this._saveData) {
      return;
    }
    if (!(path instanceof Array)) {
      path = [path];
    }
    var len2 = path.length;
    var appendSize = 0;
    var offset = this._len;
    for (var i = 0; i < len2; i++) {
      appendSize += path[i].len();
    }
    var oldData = this.data;
    if (hasTypedArray && (oldData instanceof Float32Array || !oldData)) {
      this.data = new Float32Array(offset + appendSize);
      if (offset > 0 && oldData) {
        for (var k = 0; k < offset; k++) {
          this.data[k] = oldData[k];
        }
      }
    }
    for (var i = 0; i < len2; i++) {
      var appendPathData = path[i].data;
      for (var k = 0; k < appendPathData.length; k++) {
        this.data[offset++] = appendPathData[k];
      }
    }
    this._len = offset;
  };
  PathProxy2.prototype.addData = function(cmd, a, b, c, d, e2, f, g, h) {
    if (!this._saveData) {
      return;
    }
    var data = this.data;
    if (this._len + arguments.length > data.length) {
      this._expandData();
      data = this.data;
    }
    for (var i = 0; i < arguments.length; i++) {
      data[this._len++] = arguments[i];
    }
  };
  PathProxy2.prototype._drawPendingPt = function() {
    if (this._pendingPtDist > 0) {
      this._ctx && this._ctx.lineTo(this._pendingPtX, this._pendingPtY);
      this._pendingPtDist = 0;
    }
  };
  PathProxy2.prototype._expandData = function() {
    if (!(this.data instanceof Array)) {
      var newData = [];
      for (var i = 0; i < this._len; i++) {
        newData[i] = this.data[i];
      }
      this.data = newData;
    }
  };
  PathProxy2.prototype.toStatic = function() {
    if (!this._saveData) {
      return;
    }
    this._drawPendingPt();
    var data = this.data;
    if (data instanceof Array) {
      data.length = this._len;
      if (hasTypedArray && this._len > 11) {
        this.data = new Float32Array(data);
      }
    }
  };
  PathProxy2.prototype.getBoundingRect = function() {
    min2[0] = min2[1] = min22[0] = min22[1] = Number.MAX_VALUE;
    max2[0] = max2[1] = max22[0] = max22[1] = -Number.MAX_VALUE;
    var data = this.data;
    var xi = 0;
    var yi = 0;
    var x0 = 0;
    var y0 = 0;
    var i;
    for (i = 0; i < this._len; ) {
      var cmd = data[i++];
      var isFirst = i === 1;
      if (isFirst) {
        xi = data[i];
        yi = data[i + 1];
        x0 = xi;
        y0 = yi;
      }
      switch (cmd) {
        case CMD.M:
          xi = x0 = data[i++];
          yi = y0 = data[i++];
          min22[0] = x0;
          min22[1] = y0;
          max22[0] = x0;
          max22[1] = y0;
          break;
        case CMD.L:
          fromLine(xi, yi, data[i], data[i + 1], min22, max22);
          xi = data[i++];
          yi = data[i++];
          break;
        case CMD.C:
          fromCubic(xi, yi, data[i++], data[i++], data[i++], data[i++], data[i], data[i + 1], min22, max22);
          xi = data[i++];
          yi = data[i++];
          break;
        case CMD.Q:
          fromQuadratic(xi, yi, data[i++], data[i++], data[i], data[i + 1], min22, max22);
          xi = data[i++];
          yi = data[i++];
          break;
        case CMD.A:
          var cx = data[i++];
          var cy = data[i++];
          var rx = data[i++];
          var ry = data[i++];
          var startAngle = data[i++];
          var endAngle = data[i++] + startAngle;
          i += 1;
          var anticlockwise = !data[i++];
          if (isFirst) {
            x0 = mathCos2(startAngle) * rx + cx;
            y0 = mathSin2(startAngle) * ry + cy;
          }
          fromArc(cx, cy, rx, ry, startAngle, endAngle, anticlockwise, min22, max22);
          xi = mathCos2(endAngle) * rx + cx;
          yi = mathSin2(endAngle) * ry + cy;
          break;
        case CMD.R:
          x0 = xi = data[i++];
          y0 = yi = data[i++];
          var width = data[i++];
          var height = data[i++];
          fromLine(x0, y0, x0 + width, y0 + height, min22, max22);
          break;
        case CMD.Z:
          xi = x0;
          yi = y0;
          break;
      }
      min(min2, min2, min22);
      max(max2, max2, max22);
    }
    if (i === 0) {
      min2[0] = min2[1] = max2[0] = max2[1] = 0;
    }
    return new BoundingRect_default(min2[0], min2[1], max2[0] - min2[0], max2[1] - min2[1]);
  };
  PathProxy2.prototype._calculateLength = function() {
    var data = this.data;
    var len2 = this._len;
    var ux = this._ux;
    var uy = this._uy;
    var xi = 0;
    var yi = 0;
    var x0 = 0;
    var y0 = 0;
    if (!this._pathSegLen) {
      this._pathSegLen = [];
    }
    var pathSegLen = this._pathSegLen;
    var pathTotalLen = 0;
    var segCount = 0;
    for (var i = 0; i < len2; ) {
      var cmd = data[i++];
      var isFirst = i === 1;
      if (isFirst) {
        xi = data[i];
        yi = data[i + 1];
        x0 = xi;
        y0 = yi;
      }
      var l = -1;
      switch (cmd) {
        case CMD.M:
          xi = x0 = data[i++];
          yi = y0 = data[i++];
          break;
        case CMD.L: {
          var x2 = data[i++];
          var y2 = data[i++];
          var dx = x2 - xi;
          var dy = y2 - yi;
          if (mathAbs3(dx) > ux || mathAbs3(dy) > uy || i === len2 - 1) {
            l = Math.sqrt(dx * dx + dy * dy);
            xi = x2;
            yi = y2;
          }
          break;
        }
        case CMD.C: {
          var x1 = data[i++];
          var y1 = data[i++];
          var x2 = data[i++];
          var y2 = data[i++];
          var x3 = data[i++];
          var y3 = data[i++];
          l = cubicLength(xi, yi, x1, y1, x2, y2, x3, y3, 10);
          xi = x3;
          yi = y3;
          break;
        }
        case CMD.Q: {
          var x1 = data[i++];
          var y1 = data[i++];
          var x2 = data[i++];
          var y2 = data[i++];
          l = quadraticLength(xi, yi, x1, y1, x2, y2, 10);
          xi = x2;
          yi = y2;
          break;
        }
        case CMD.A:
          var cx = data[i++];
          var cy = data[i++];
          var rx = data[i++];
          var ry = data[i++];
          var startAngle = data[i++];
          var delta = data[i++];
          var endAngle = delta + startAngle;
          i += 1;
          if (isFirst) {
            x0 = mathCos2(startAngle) * rx + cx;
            y0 = mathSin2(startAngle) * ry + cy;
          }
          l = mathMax4(rx, ry) * mathMin4(PI22, Math.abs(delta));
          xi = mathCos2(endAngle) * rx + cx;
          yi = mathSin2(endAngle) * ry + cy;
          break;
        case CMD.R: {
          x0 = xi = data[i++];
          y0 = yi = data[i++];
          var width = data[i++];
          var height = data[i++];
          l = width * 2 + height * 2;
          break;
        }
        case CMD.Z: {
          var dx = x0 - xi;
          var dy = y0 - yi;
          l = Math.sqrt(dx * dx + dy * dy);
          xi = x0;
          yi = y0;
          break;
        }
      }
      if (l >= 0) {
        pathSegLen[segCount++] = l;
        pathTotalLen += l;
      }
    }
    this._pathLen = pathTotalLen;
    return pathTotalLen;
  };
  PathProxy2.prototype.rebuildPath = function(ctx, percent) {
    var d = this.data;
    var ux = this._ux;
    var uy = this._uy;
    var len2 = this._len;
    var x0;
    var y0;
    var xi;
    var yi;
    var x;
    var y;
    var drawPart = percent < 1;
    var pathSegLen;
    var pathTotalLen;
    var accumLength = 0;
    var segCount = 0;
    var displayedLength;
    var pendingPtDist = 0;
    var pendingPtX;
    var pendingPtY;
    if (drawPart) {
      if (!this._pathSegLen) {
        this._calculateLength();
      }
      pathSegLen = this._pathSegLen;
      pathTotalLen = this._pathLen;
      displayedLength = percent * pathTotalLen;
      if (!displayedLength) {
        return;
      }
    }
    lo: for (var i = 0; i < len2; ) {
      var cmd = d[i++];
      var isFirst = i === 1;
      if (isFirst) {
        xi = d[i];
        yi = d[i + 1];
        x0 = xi;
        y0 = yi;
      }
      if (cmd !== CMD.L && pendingPtDist > 0) {
        ctx.lineTo(pendingPtX, pendingPtY);
        pendingPtDist = 0;
      }
      switch (cmd) {
        case CMD.M:
          x0 = xi = d[i++];
          y0 = yi = d[i++];
          ctx.moveTo(xi, yi);
          break;
        case CMD.L: {
          x = d[i++];
          y = d[i++];
          var dx = mathAbs3(x - xi);
          var dy = mathAbs3(y - yi);
          if (dx > ux || dy > uy) {
            if (drawPart) {
              var l = pathSegLen[segCount++];
              if (accumLength + l > displayedLength) {
                var t = (displayedLength - accumLength) / l;
                ctx.lineTo(xi * (1 - t) + x * t, yi * (1 - t) + y * t);
                break lo;
              }
              accumLength += l;
            }
            ctx.lineTo(x, y);
            xi = x;
            yi = y;
            pendingPtDist = 0;
          } else {
            var d2 = dx * dx + dy * dy;
            if (d2 > pendingPtDist) {
              pendingPtX = x;
              pendingPtY = y;
              pendingPtDist = d2;
            }
          }
          break;
        }
        case CMD.C: {
          var x1 = d[i++];
          var y1 = d[i++];
          var x2 = d[i++];
          var y2 = d[i++];
          var x3 = d[i++];
          var y3 = d[i++];
          if (drawPart) {
            var l = pathSegLen[segCount++];
            if (accumLength + l > displayedLength) {
              var t = (displayedLength - accumLength) / l;
              cubicSubdivide(xi, x1, x2, x3, t, tmpOutX);
              cubicSubdivide(yi, y1, y2, y3, t, tmpOutY);
              ctx.bezierCurveTo(tmpOutX[1], tmpOutY[1], tmpOutX[2], tmpOutY[2], tmpOutX[3], tmpOutY[3]);
              break lo;
            }
            accumLength += l;
          }
          ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3);
          xi = x3;
          yi = y3;
          break;
        }
        case CMD.Q: {
          var x1 = d[i++];
          var y1 = d[i++];
          var x2 = d[i++];
          var y2 = d[i++];
          if (drawPart) {
            var l = pathSegLen[segCount++];
            if (accumLength + l > displayedLength) {
              var t = (displayedLength - accumLength) / l;
              quadraticSubdivide(xi, x1, x2, t, tmpOutX);
              quadraticSubdivide(yi, y1, y2, t, tmpOutY);
              ctx.quadraticCurveTo(tmpOutX[1], tmpOutY[1], tmpOutX[2], tmpOutY[2]);
              break lo;
            }
            accumLength += l;
          }
          ctx.quadraticCurveTo(x1, y1, x2, y2);
          xi = x2;
          yi = y2;
          break;
        }
        case CMD.A:
          var cx = d[i++];
          var cy = d[i++];
          var rx = d[i++];
          var ry = d[i++];
          var startAngle = d[i++];
          var delta = d[i++];
          var psi = d[i++];
          var anticlockwise = !d[i++];
          var r = rx > ry ? rx : ry;
          var isEllipse = mathAbs3(rx - ry) > 1e-3;
          var endAngle = startAngle + delta;
          var breakBuild = false;
          if (drawPart) {
            var l = pathSegLen[segCount++];
            if (accumLength + l > displayedLength) {
              endAngle = startAngle + delta * (displayedLength - accumLength) / l;
              breakBuild = true;
            }
            accumLength += l;
          }
          if (isEllipse && ctx.ellipse) {
            ctx.ellipse(cx, cy, rx, ry, psi, startAngle, endAngle, anticlockwise);
          } else {
            ctx.arc(cx, cy, r, startAngle, endAngle, anticlockwise);
          }
          if (breakBuild) {
            break lo;
          }
          if (isFirst) {
            x0 = mathCos2(startAngle) * rx + cx;
            y0 = mathSin2(startAngle) * ry + cy;
          }
          xi = mathCos2(endAngle) * rx + cx;
          yi = mathSin2(endAngle) * ry + cy;
          break;
        case CMD.R:
          x0 = xi = d[i];
          y0 = yi = d[i + 1];
          x = d[i++];
          y = d[i++];
          var width = d[i++];
          var height = d[i++];
          if (drawPart) {
            var l = pathSegLen[segCount++];
            if (accumLength + l > displayedLength) {
              var d_1 = displayedLength - accumLength;
              ctx.moveTo(x, y);
              ctx.lineTo(x + mathMin4(d_1, width), y);
              d_1 -= width;
              if (d_1 > 0) {
                ctx.lineTo(x + width, y + mathMin4(d_1, height));
              }
              d_1 -= height;
              if (d_1 > 0) {
                ctx.lineTo(x + mathMax4(width - d_1, 0), y + height);
              }
              d_1 -= width;
              if (d_1 > 0) {
                ctx.lineTo(x, y + mathMax4(height - d_1, 0));
              }
              break lo;
            }
            accumLength += l;
          }
          ctx.rect(x, y, width, height);
          break;
        case CMD.Z:
          if (drawPart) {
            var l = pathSegLen[segCount++];
            if (accumLength + l > displayedLength) {
              var t = (displayedLength - accumLength) / l;
              ctx.lineTo(xi * (1 - t) + x0 * t, yi * (1 - t) + y0 * t);
              break lo;
            }
            accumLength += l;
          }
          ctx.closePath();
          xi = x0;
          yi = y0;
      }
    }
  };
  PathProxy2.prototype.clone = function() {
    var newProxy = new PathProxy2();
    var data = this.data;
    newProxy.data = data.slice ? data.slice() : Array.prototype.slice.call(data);
    newProxy._len = this._len;
    return newProxy;
  };
  PathProxy2.prototype.canSave = function() {
    return !!this._saveData;
  };
  PathProxy2.CMD = CMD;
  PathProxy2.initDefaultProps = (function() {
    var proto = PathProxy2.prototype;
    proto._saveData = true;
    proto._ux = 0;
    proto._uy = 0;
    proto._pendingPtDist = 0;
    proto._version = 0;
  })();
  return PathProxy2;
})();
var PathProxy_default = PathProxy;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/contain/line.js
function containStroke(x0, y0, x1, y1, lineWidth, x, y) {
  if (lineWidth === 0) {
    return false;
  }
  var _l = lineWidth;
  var _a2 = 0;
  var _b2 = x0;
  if (y > y0 + _l && y > y1 + _l || y < y0 - _l && y < y1 - _l || x > x0 + _l && x > x1 + _l || x < x0 - _l && x < x1 - _l) {
    return false;
  }
  if (x0 !== x1) {
    _a2 = (y0 - y1) / (x0 - x1);
    _b2 = (x0 * y1 - x1 * y0) / (x0 - x1);
  } else {
    return Math.abs(x - x0) <= _l / 2;
  }
  var tmp = _a2 * x - y + _b2;
  var _s = tmp * tmp / (_a2 * _a2 + 1);
  return _s <= _l / 2 * _l / 2;
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/contain/cubic.js
function containStroke2(x0, y0, x1, y1, x2, y2, x3, y3, lineWidth, x, y) {
  if (lineWidth === 0) {
    return false;
  }
  var _l = lineWidth;
  if (y > y0 + _l && y > y1 + _l && y > y2 + _l && y > y3 + _l || y < y0 - _l && y < y1 - _l && y < y2 - _l && y < y3 - _l || x > x0 + _l && x > x1 + _l && x > x2 + _l && x > x3 + _l || x < x0 - _l && x < x1 - _l && x < x2 - _l && x < x3 - _l) {
    return false;
  }
  var d = cubicProjectPoint(x0, y0, x1, y1, x2, y2, x3, y3, x, y, null);
  return d <= _l / 2;
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/contain/quadratic.js
function containStroke3(x0, y0, x1, y1, x2, y2, lineWidth, x, y) {
  if (lineWidth === 0) {
    return false;
  }
  var _l = lineWidth;
  if (y > y0 + _l && y > y1 + _l && y > y2 + _l || y < y0 - _l && y < y1 - _l && y < y2 - _l || x > x0 + _l && x > x1 + _l && x > x2 + _l || x < x0 - _l && x < x1 - _l && x < x2 - _l) {
    return false;
  }
  var d = quadraticProjectPoint(x0, y0, x1, y1, x2, y2, x, y, null);
  return d <= _l / 2;
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/contain/util.js
var PI23 = Math.PI * 2;
function normalizeRadian(angle) {
  angle %= PI23;
  if (angle < 0) {
    angle += PI23;
  }
  return angle;
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/contain/arc.js
var PI24 = Math.PI * 2;
function containStroke4(cx, cy, r, startAngle, endAngle, anticlockwise, lineWidth, x, y) {
  if (lineWidth === 0) {
    return false;
  }
  var _l = lineWidth;
  x -= cx;
  y -= cy;
  var d = Math.sqrt(x * x + y * y);
  if (d - _l > r || d + _l < r) {
    return false;
  }
  if (Math.abs(startAngle - endAngle) % PI24 < 1e-4) {
    return true;
  }
  if (anticlockwise) {
    var tmp = startAngle;
    startAngle = normalizeRadian(endAngle);
    endAngle = normalizeRadian(tmp);
  } else {
    startAngle = normalizeRadian(startAngle);
    endAngle = normalizeRadian(endAngle);
  }
  if (startAngle > endAngle) {
    endAngle += PI24;
  }
  var angle = Math.atan2(y, x);
  if (angle < 0) {
    angle += PI24;
  }
  return angle >= startAngle && angle <= endAngle || angle + PI24 >= startAngle && angle + PI24 <= endAngle;
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/contain/windingLine.js
function windingLine(x0, y0, x1, y1, x, y) {
  if (y > y0 && y > y1 || y < y0 && y < y1) {
    return 0;
  }
  if (y1 === y0) {
    return 0;
  }
  var t = (y - y0) / (y1 - y0);
  var dir3 = y1 < y0 ? 1 : -1;
  if (t === 1 || t === 0) {
    dir3 = y1 < y0 ? 0.5 : -0.5;
  }
  var x_ = t * (x1 - x0) + x0;
  return x_ === x ? Infinity : x_ > x ? dir3 : 0;
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/contain/path.js
var CMD2 = PathProxy_default.CMD;
var PI25 = Math.PI * 2;
var EPSILON4 = 1e-4;
function isAroundEqual(a, b) {
  return Math.abs(a - b) < EPSILON4;
}
var roots = [-1, -1, -1];
var extrema = [-1, -1];
function swapExtrema() {
  var tmp = extrema[0];
  extrema[0] = extrema[1];
  extrema[1] = tmp;
}
function windingCubic(x0, y0, x1, y1, x2, y2, x3, y3, x, y) {
  if (y > y0 && y > y1 && y > y2 && y > y3 || y < y0 && y < y1 && y < y2 && y < y3) {
    return 0;
  }
  var nRoots = cubicRootAt(y0, y1, y2, y3, y, roots);
  if (nRoots === 0) {
    return 0;
  } else {
    var w = 0;
    var nExtrema = -1;
    var y0_ = void 0;
    var y1_ = void 0;
    for (var i = 0; i < nRoots; i++) {
      var t = roots[i];
      var unit = t === 0 || t === 1 ? 0.5 : 1;
      var x_ = cubicAt(x0, x1, x2, x3, t);
      if (x_ < x) {
        continue;
      }
      if (nExtrema < 0) {
        nExtrema = cubicExtrema(y0, y1, y2, y3, extrema);
        if (extrema[1] < extrema[0] && nExtrema > 1) {
          swapExtrema();
        }
        y0_ = cubicAt(y0, y1, y2, y3, extrema[0]);
        if (nExtrema > 1) {
          y1_ = cubicAt(y0, y1, y2, y3, extrema[1]);
        }
      }
      if (nExtrema === 2) {
        if (t < extrema[0]) {
          w += y0_ < y0 ? unit : -unit;
        } else if (t < extrema[1]) {
          w += y1_ < y0_ ? unit : -unit;
        } else {
          w += y3 < y1_ ? unit : -unit;
        }
      } else {
        if (t < extrema[0]) {
          w += y0_ < y0 ? unit : -unit;
        } else {
          w += y3 < y0_ ? unit : -unit;
        }
      }
    }
    return w;
  }
}
function windingQuadratic(x0, y0, x1, y1, x2, y2, x, y) {
  if (y > y0 && y > y1 && y > y2 || y < y0 && y < y1 && y < y2) {
    return 0;
  }
  var nRoots = quadraticRootAt(y0, y1, y2, y, roots);
  if (nRoots === 0) {
    return 0;
  } else {
    var t = quadraticExtremum(y0, y1, y2);
    if (t >= 0 && t <= 1) {
      var w = 0;
      var y_ = quadraticAt(y0, y1, y2, t);
      for (var i = 0; i < nRoots; i++) {
        var unit = roots[i] === 0 || roots[i] === 1 ? 0.5 : 1;
        var x_ = quadraticAt(x0, x1, x2, roots[i]);
        if (x_ < x) {
          continue;
        }
        if (roots[i] < t) {
          w += y_ < y0 ? unit : -unit;
        } else {
          w += y2 < y_ ? unit : -unit;
        }
      }
      return w;
    } else {
      var unit = roots[0] === 0 || roots[0] === 1 ? 0.5 : 1;
      var x_ = quadraticAt(x0, x1, x2, roots[0]);
      if (x_ < x) {
        return 0;
      }
      return y2 < y0 ? unit : -unit;
    }
  }
}
function windingArc(cx, cy, r, startAngle, endAngle, anticlockwise, x, y) {
  y -= cy;
  if (y > r || y < -r) {
    return 0;
  }
  var tmp = Math.sqrt(r * r - y * y);
  roots[0] = -tmp;
  roots[1] = tmp;
  var dTheta = Math.abs(startAngle - endAngle);
  if (dTheta < 1e-4) {
    return 0;
  }
  if (dTheta >= PI25 - 1e-4) {
    startAngle = 0;
    endAngle = PI25;
    var dir3 = anticlockwise ? 1 : -1;
    if (x >= roots[0] + cx && x <= roots[1] + cx) {
      return dir3;
    } else {
      return 0;
    }
  }
  if (startAngle > endAngle) {
    var tmp_1 = startAngle;
    startAngle = endAngle;
    endAngle = tmp_1;
  }
  if (startAngle < 0) {
    startAngle += PI25;
    endAngle += PI25;
  }
  var w = 0;
  for (var i = 0; i < 2; i++) {
    var x_ = roots[i];
    if (x_ + cx > x) {
      var angle = Math.atan2(y, x_);
      var dir3 = anticlockwise ? 1 : -1;
      if (angle < 0) {
        angle = PI25 + angle;
      }
      if (angle >= startAngle && angle <= endAngle || angle + PI25 >= startAngle && angle + PI25 <= endAngle) {
        if (angle > Math.PI / 2 && angle < Math.PI * 1.5) {
          dir3 = -dir3;
        }
        w += dir3;
      }
    }
  }
  return w;
}
function containPath(path, lineWidth, isStroke, x, y) {
  var data = path.data;
  var len2 = path.len();
  var w = 0;
  var xi = 0;
  var yi = 0;
  var x0 = 0;
  var y0 = 0;
  var x1;
  var y1;
  for (var i = 0; i < len2; ) {
    var cmd = data[i++];
    var isFirst = i === 1;
    if (cmd === CMD2.M && i > 1) {
      if (!isStroke) {
        w += windingLine(xi, yi, x0, y0, x, y);
      }
    }
    if (isFirst) {
      xi = data[i];
      yi = data[i + 1];
      x0 = xi;
      y0 = yi;
    }
    switch (cmd) {
      case CMD2.M:
        x0 = data[i++];
        y0 = data[i++];
        xi = x0;
        yi = y0;
        break;
      case CMD2.L:
        if (isStroke) {
          if (containStroke(xi, yi, data[i], data[i + 1], lineWidth, x, y)) {
            return true;
          }
        } else {
          w += windingLine(xi, yi, data[i], data[i + 1], x, y) || 0;
        }
        xi = data[i++];
        yi = data[i++];
        break;
      case CMD2.C:
        if (isStroke) {
          if (containStroke2(xi, yi, data[i++], data[i++], data[i++], data[i++], data[i], data[i + 1], lineWidth, x, y)) {
            return true;
          }
        } else {
          w += windingCubic(xi, yi, data[i++], data[i++], data[i++], data[i++], data[i], data[i + 1], x, y) || 0;
        }
        xi = data[i++];
        yi = data[i++];
        break;
      case CMD2.Q:
        if (isStroke) {
          if (containStroke3(xi, yi, data[i++], data[i++], data[i], data[i + 1], lineWidth, x, y)) {
            return true;
          }
        } else {
          w += windingQuadratic(xi, yi, data[i++], data[i++], data[i], data[i + 1], x, y) || 0;
        }
        xi = data[i++];
        yi = data[i++];
        break;
      case CMD2.A:
        var cx = data[i++];
        var cy = data[i++];
        var rx = data[i++];
        var ry = data[i++];
        var theta = data[i++];
        var dTheta = data[i++];
        i += 1;
        var anticlockwise = !!(1 - data[i++]);
        x1 = Math.cos(theta) * rx + cx;
        y1 = Math.sin(theta) * ry + cy;
        if (!isFirst) {
          w += windingLine(xi, yi, x1, y1, x, y);
        } else {
          x0 = x1;
          y0 = y1;
        }
        var _x = (x - cx) * ry / rx + cx;
        if (isStroke) {
          if (containStroke4(cx, cy, ry, theta, theta + dTheta, anticlockwise, lineWidth, _x, y)) {
            return true;
          }
        } else {
          w += windingArc(cx, cy, ry, theta, theta + dTheta, anticlockwise, _x, y);
        }
        xi = Math.cos(theta + dTheta) * rx + cx;
        yi = Math.sin(theta + dTheta) * ry + cy;
        break;
      case CMD2.R:
        x0 = xi = data[i++];
        y0 = yi = data[i++];
        var width = data[i++];
        var height = data[i++];
        x1 = x0 + width;
        y1 = y0 + height;
        if (isStroke) {
          if (containStroke(x0, y0, x1, y0, lineWidth, x, y) || containStroke(x1, y0, x1, y1, lineWidth, x, y) || containStroke(x1, y1, x0, y1, lineWidth, x, y) || containStroke(x0, y1, x0, y0, lineWidth, x, y)) {
            return true;
          }
        } else {
          w += windingLine(x1, y0, x1, y1, x, y);
          w += windingLine(x0, y1, x0, y0, x, y);
        }
        break;
      case CMD2.Z:
        if (isStroke) {
          if (containStroke(xi, yi, x0, y0, lineWidth, x, y)) {
            return true;
          }
        } else {
          w += windingLine(xi, yi, x0, y0, x, y);
        }
        xi = x0;
        yi = y0;
        break;
    }
  }
  if (!isStroke && !isAroundEqual(yi, y0)) {
    w += windingLine(xi, yi, x0, y0, x, y) || 0;
  }
  return w !== 0;
}
function contain(pathProxy, x, y) {
  return containPath(pathProxy, 0, false, x, y);
}
function containStroke5(pathProxy, lineWidth, x, y) {
  return containPath(pathProxy, lineWidth, true, x, y);
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/graphic/Path.js
var DEFAULT_PATH_STYLE = defaults({
  fill: "#000",
  stroke: null,
  strokePercent: 1,
  fillOpacity: 1,
  strokeOpacity: 1,
  lineDashOffset: 0,
  lineWidth: 1,
  lineCap: "butt",
  miterLimit: 10,
  strokeNoScale: false,
  strokeFirst: false
}, DEFAULT_COMMON_STYLE);
var DEFAULT_PATH_ANIMATION_PROPS = {
  style: defaults({
    fill: true,
    stroke: true,
    strokePercent: true,
    fillOpacity: true,
    strokeOpacity: true,
    lineDashOffset: true,
    lineWidth: true,
    miterLimit: true
  }, DEFAULT_COMMON_ANIMATION_PROPS.style)
};
var pathCopyParams = TRANSFORMABLE_PROPS.concat([
  "invisible",
  "culling",
  "z",
  "z2",
  "zlevel",
  "parent"
]);
var Path = (function(_super) {
  __extends(Path2, _super);
  function Path2(opts) {
    return _super.call(this, opts) || this;
  }
  Path2.prototype.update = function() {
    var _this = this;
    _super.prototype.update.call(this);
    var style = this.style;
    if (style.decal) {
      var decalEl = this._decalEl = this._decalEl || new Path2();
      if (decalEl.buildPath === Path2.prototype.buildPath) {
        decalEl.buildPath = function(ctx) {
          _this.buildPath(ctx, _this.shape);
        };
      }
      decalEl.silent = true;
      var decalElStyle = decalEl.style;
      for (var key2 in style) {
        if (decalElStyle[key2] !== style[key2]) {
          decalElStyle[key2] = style[key2];
        }
      }
      decalElStyle.fill = style.fill ? style.decal : null;
      decalElStyle.decal = null;
      decalElStyle.shadowColor = null;
      style.strokeFirst && (decalElStyle.stroke = null);
      for (var i = 0; i < pathCopyParams.length; ++i) {
        decalEl[pathCopyParams[i]] = this[pathCopyParams[i]];
      }
      decalEl.__dirty |= REDRAW_BIT;
    } else if (this._decalEl) {
      this._decalEl = null;
    }
  };
  Path2.prototype.getDecalElement = function() {
    return this._decalEl;
  };
  Path2.prototype._init = function(props) {
    var keysArr = keys(props);
    this.shape = this.getDefaultShape();
    var defaultStyle = this.getDefaultStyle();
    if (defaultStyle) {
      this.useStyle(defaultStyle);
    }
    for (var i = 0; i < keysArr.length; i++) {
      var key2 = keysArr[i];
      var value = props[key2];
      if (key2 === "style") {
        if (!this.style) {
          this.useStyle(value);
        } else {
          extend(this.style, value);
        }
      } else if (key2 === "shape") {
        extend(this.shape, value);
      } else {
        _super.prototype.attrKV.call(this, key2, value);
      }
    }
    if (!this.style) {
      this.useStyle({});
    }
  };
  Path2.prototype.getDefaultStyle = function() {
    return null;
  };
  Path2.prototype.getDefaultShape = function() {
    return {};
  };
  Path2.prototype.canBeInsideText = function() {
    return this.hasFill();
  };
  Path2.prototype.getInsideTextFill = function() {
    var pathFill = this.style.fill;
    if (pathFill !== "none") {
      if (isString(pathFill)) {
        var fillLum = lum(pathFill, 0);
        if (fillLum > 0.5) {
          return DARK_LABEL_COLOR;
        } else if (fillLum > 0.2) {
          return LIGHTER_LABEL_COLOR;
        }
        return LIGHT_LABEL_COLOR;
      } else if (pathFill) {
        return LIGHT_LABEL_COLOR;
      }
    }
    return DARK_LABEL_COLOR;
  };
  Path2.prototype.getInsideTextStroke = function(textFill) {
    var pathFill = this.style.fill;
    if (isString(pathFill)) {
      var zr = this.__zr;
      var isDarkMode = !!(zr && zr.isDarkMode());
      var isDarkLabel = lum(textFill, 0) < DARK_MODE_THRESHOLD;
      if (isDarkMode === isDarkLabel) {
        return pathFill;
      }
    }
  };
  Path2.prototype.buildPath = function(ctx, shapeCfg, inBatch) {
  };
  Path2.prototype.pathUpdated = function() {
    this.__dirty &= ~SHAPE_CHANGED_BIT;
  };
  Path2.prototype.getUpdatedPathProxy = function(inBatch) {
    !this.path && this.createPathProxy();
    this.path.beginPath();
    this.buildPath(this.path, this.shape, inBatch);
    return this.path;
  };
  Path2.prototype.createPathProxy = function() {
    this.path = new PathProxy_default(false);
  };
  Path2.prototype.hasStroke = function() {
    var style = this.style;
    var stroke = style.stroke;
    return !(stroke == null || stroke === "none" || !(style.lineWidth > 0));
  };
  Path2.prototype.hasFill = function() {
    var style = this.style;
    var fill = style.fill;
    return fill != null && fill !== "none";
  };
  Path2.prototype.getBoundingRect = function() {
    var rect = this._rect;
    var style = this.style;
    var needsUpdateRect = !rect;
    if (needsUpdateRect) {
      var firstInvoke = false;
      if (!this.path) {
        firstInvoke = true;
        this.createPathProxy();
      }
      var path = this.path;
      if (firstInvoke || this.__dirty & SHAPE_CHANGED_BIT) {
        path.beginPath();
        this.buildPath(path, this.shape, false);
        this.pathUpdated();
      }
      rect = path.getBoundingRect();
    }
    this._rect = rect;
    if (this.hasStroke() && this.path && this.path.len() > 0) {
      var rectStroke = this._rectStroke || (this._rectStroke = rect.clone());
      if (this.__dirty || needsUpdateRect) {
        rectStroke.copy(rect);
        var lineScale = style.strokeNoScale ? this.getLineScale() : 1;
        var w = style.lineWidth;
        if (!this.hasFill()) {
          var strokeContainThreshold = this.strokeContainThreshold;
          w = Math.max(w, strokeContainThreshold == null ? 4 : strokeContainThreshold);
        }
        if (lineScale > 1e-10) {
          rectStroke.width += w / lineScale;
          rectStroke.height += w / lineScale;
          rectStroke.x -= w / lineScale / 2;
          rectStroke.y -= w / lineScale / 2;
        }
      }
      return rectStroke;
    }
    return rect;
  };
  Path2.prototype.contain = function(x, y) {
    var localPos = this.transformCoordToLocal(x, y);
    var rect = this.getBoundingRect();
    var style = this.style;
    x = localPos[0];
    y = localPos[1];
    if (rect.contain(x, y)) {
      var pathProxy = this.path;
      if (this.hasStroke()) {
        var lineWidth = style.lineWidth;
        var lineScale = style.strokeNoScale ? this.getLineScale() : 1;
        if (lineScale > 1e-10) {
          if (!this.hasFill()) {
            lineWidth = Math.max(lineWidth, this.strokeContainThreshold);
          }
          if (containStroke5(pathProxy, lineWidth / lineScale, x, y)) {
            return true;
          }
        }
      }
      if (this.hasFill()) {
        return contain(pathProxy, x, y);
      }
    }
    return false;
  };
  Path2.prototype.dirtyShape = function() {
    this.__dirty |= SHAPE_CHANGED_BIT;
    if (this._rect) {
      this._rect = null;
    }
    if (this._decalEl) {
      this._decalEl.dirtyShape();
    }
    this.markRedraw();
  };
  Path2.prototype.dirty = function() {
    this.dirtyStyle();
    this.dirtyShape();
  };
  Path2.prototype.animateShape = function(loop) {
    return this.animate("shape", loop);
  };
  Path2.prototype.updateDuringAnimation = function(targetKey) {
    if (targetKey === "style") {
      this.dirtyStyle();
    } else if (targetKey === "shape") {
      this.dirtyShape();
    } else {
      this.markRedraw();
    }
  };
  Path2.prototype.attrKV = function(key2, value) {
    if (key2 === "shape") {
      this.setShape(value);
    } else {
      _super.prototype.attrKV.call(this, key2, value);
    }
  };
  Path2.prototype.setShape = function(keyOrObj, value) {
    var shape = this.shape;
    if (!shape) {
      shape = this.shape = {};
    }
    if (typeof keyOrObj === "string") {
      shape[keyOrObj] = value;
    } else {
      extend(shape, keyOrObj);
    }
    this.dirtyShape();
    return this;
  };
  Path2.prototype.shapeChanged = function() {
    return !!(this.__dirty & SHAPE_CHANGED_BIT);
  };
  Path2.prototype.createStyle = function(obj) {
    return createObject(DEFAULT_PATH_STYLE, obj);
  };
  Path2.prototype._innerSaveToNormal = function(toState) {
    _super.prototype._innerSaveToNormal.call(this, toState);
    var normalState = this._normalState;
    if (toState.shape && !normalState.shape) {
      normalState.shape = extend({}, this.shape);
    }
  };
  Path2.prototype._applyStateObj = function(stateName, state, normalState, keepCurrentStates, transition, animationCfg) {
    _super.prototype._applyStateObj.call(this, stateName, state, normalState, keepCurrentStates, transition, animationCfg);
    if (this.__inHover === IN_HOVER_LAYER_KIND_ONLY_STYLE_CHANGE) {
      return;
    }
    var needsRestoreToNormal = !(state && keepCurrentStates);
    var targetShape;
    if (state && state.shape) {
      if (transition) {
        if (keepCurrentStates) {
          targetShape = state.shape;
        } else {
          targetShape = extend({}, normalState.shape);
          extend(targetShape, state.shape);
        }
      } else {
        targetShape = extend({}, keepCurrentStates ? this.shape : normalState.shape);
        extend(targetShape, state.shape);
      }
    } else if (needsRestoreToNormal) {
      targetShape = normalState.shape;
    }
    if (targetShape) {
      if (transition) {
        this.shape = extend({}, this.shape);
        var targetShapePrimaryProps = {};
        var shapeKeys = keys(targetShape);
        for (var i = 0; i < shapeKeys.length; i++) {
          var key2 = shapeKeys[i];
          if (typeof targetShape[key2] === "object") {
            this.shape[key2] = targetShape[key2];
          } else {
            targetShapePrimaryProps[key2] = targetShape[key2];
          }
        }
        this._transitionState(stateName, {
          shape: targetShapePrimaryProps
        }, animationCfg);
      } else {
        this.shape = targetShape;
        this.dirtyShape();
      }
    }
  };
  Path2.prototype._mergeStates = function(states) {
    var mergedState = _super.prototype._mergeStates.call(this, states);
    var mergedShape;
    for (var i = 0; i < states.length; i++) {
      var state = states[i];
      if (state.shape) {
        mergedShape = mergedShape || {};
        this._mergeStyle(mergedShape, state.shape);
      }
    }
    if (mergedShape) {
      mergedState.shape = mergedShape;
    }
    return mergedState;
  };
  Path2.prototype.getAnimationStyleProps = function() {
    return DEFAULT_PATH_ANIMATION_PROPS;
  };
  Path2.prototype.isZeroArea = function() {
    return false;
  };
  Path2.extend = function(defaultProps) {
    var Sub = (function(_super2) {
      __extends(Sub2, _super2);
      function Sub2(opts) {
        var _this = _super2.call(this, opts) || this;
        defaultProps.init && defaultProps.init.call(_this, opts);
        return _this;
      }
      Sub2.prototype.getDefaultStyle = function() {
        return clone(defaultProps.style);
      };
      Sub2.prototype.getDefaultShape = function() {
        return clone(defaultProps.shape);
      };
      return Sub2;
    })(Path2);
    for (var key2 in defaultProps) {
      if (typeof defaultProps[key2] === "function") {
        Sub.prototype[key2] = defaultProps[key2];
      }
    }
    return Sub;
  };
  Path2.initDefaultProps = (function() {
    var pathProto = Path2.prototype;
    pathProto.type = "path";
    pathProto.strokeContainThreshold = 5;
    pathProto.segmentIgnoreThreshold = 0;
    pathProto.subPixelOptimize = false;
    pathProto.autoBatch = false;
    pathProto.__dirty = REDRAW_BIT | STYLE_CHANGED_BIT | SHAPE_CHANGED_BIT;
  })();
  return Path2;
})(Displayable_default);
var Path_default = Path;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/graphic/TSpan.js
var DEFAULT_TSPAN_STYLE = defaults({
  strokeFirst: true,
  font: DEFAULT_FONT,
  x: 0,
  y: 0,
  textAlign: "left",
  textBaseline: "top",
  miterLimit: 2
}, DEFAULT_PATH_STYLE);
var TSpan = (function(_super) {
  __extends(TSpan2, _super);
  function TSpan2() {
    return _super !== null && _super.apply(this, arguments) || this;
  }
  TSpan2.prototype.hasStroke = function() {
    return tSpanHasStroke(this.style);
  };
  TSpan2.prototype.hasFill = function() {
    var style = this.style;
    var fill = style.fill;
    return fill != null && fill !== "none";
  };
  TSpan2.prototype.createStyle = function(obj) {
    return createObject(DEFAULT_TSPAN_STYLE, obj);
  };
  TSpan2.prototype.setBoundingRect = function(rect) {
    this._rect = rect;
  };
  TSpan2.prototype.getBoundingRect = function() {
    if (!this._rect) {
      this._rect = tSpanCreateBoundingRect(this.style);
    }
    return this._rect;
  };
  TSpan2.initDefaultProps = (function() {
    var tspanProto = TSpan2.prototype;
    tspanProto.dirtyRectTolerance = 10;
  })();
  return TSpan2;
})(Displayable_default);
TSpan.prototype.type = "tspan";
var TSpan_default = TSpan;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/graphic/Image.js
var DEFAULT_IMAGE_STYLE = defaults({
  x: 0,
  y: 0
}, DEFAULT_COMMON_STYLE);
var DEFAULT_IMAGE_ANIMATION_PROPS = {
  style: defaults({
    x: true,
    y: true,
    width: true,
    height: true,
    sx: true,
    sy: true,
    sWidth: true,
    sHeight: true
  }, DEFAULT_COMMON_ANIMATION_PROPS.style)
};
function isImageLike(source) {
  return !!(source && typeof source !== "string" && source.width && source.height);
}
var ZRImage = (function(_super) {
  __extends(ZRImage2, _super);
  function ZRImage2() {
    return _super !== null && _super.apply(this, arguments) || this;
  }
  ZRImage2.prototype.createStyle = function(obj) {
    return createObject(DEFAULT_IMAGE_STYLE, obj);
  };
  ZRImage2.prototype._getSize = function(dim) {
    var style = this.style;
    var size = style[dim];
    if (size != null) {
      return size;
    }
    var imageSource = isImageLike(style.image) ? style.image : this.__image;
    if (!imageSource) {
      return 0;
    }
    var otherDim = dim === "width" ? "height" : "width";
    var otherDimSize = style[otherDim];
    if (otherDimSize == null) {
      return imageSource[dim];
    } else {
      return imageSource[dim] / imageSource[otherDim] * otherDimSize;
    }
  };
  ZRImage2.prototype.getWidth = function() {
    return this._getSize("width");
  };
  ZRImage2.prototype.getHeight = function() {
    return this._getSize("height");
  };
  ZRImage2.prototype.getAnimationStyleProps = function() {
    return DEFAULT_IMAGE_ANIMATION_PROPS;
  };
  ZRImage2.prototype.getBoundingRect = function() {
    var style = this.style;
    if (!this._rect) {
      this._rect = new BoundingRect_default(style.x || 0, style.y || 0, this.getWidth(), this.getHeight());
    }
    return this._rect;
  };
  return ZRImage2;
})(Displayable_default);
ZRImage.prototype.type = "image";
var Image_default = ZRImage;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/graphic/helper/roundRect.js
function buildPath(ctx, shape) {
  var x = shape.x;
  var y = shape.y;
  var width = shape.width;
  var height = shape.height;
  var r = shape.r;
  var r1;
  var r2;
  var r3;
  var r4;
  if (width < 0) {
    x = x + width;
    width = -width;
  }
  if (height < 0) {
    y = y + height;
    height = -height;
  }
  if (typeof r === "number") {
    r1 = r2 = r3 = r4 = r;
  } else if (r instanceof Array) {
    if (r.length === 1) {
      r1 = r2 = r3 = r4 = r[0];
    } else if (r.length === 2) {
      r1 = r3 = r[0];
      r2 = r4 = r[1];
    } else if (r.length === 3) {
      r1 = r[0];
      r2 = r4 = r[1];
      r3 = r[2];
    } else {
      r1 = r[0];
      r2 = r[1];
      r3 = r[2];
      r4 = r[3];
    }
  } else {
    r1 = r2 = r3 = r4 = 0;
  }
  var total;
  if (r1 + r2 > width) {
    total = r1 + r2;
    r1 *= width / total;
    r2 *= width / total;
  }
  if (r3 + r4 > width) {
    total = r3 + r4;
    r3 *= width / total;
    r4 *= width / total;
  }
  if (r2 + r3 > height) {
    total = r2 + r3;
    r2 *= height / total;
    r3 *= height / total;
  }
  if (r1 + r4 > height) {
    total = r1 + r4;
    r1 *= height / total;
    r4 *= height / total;
  }
  ctx.moveTo(x + r1, y);
  ctx.lineTo(x + width - r2, y);
  r2 !== 0 && ctx.arc(x + width - r2, y + r2, r2, -Math.PI / 2, 0);
  ctx.lineTo(x + width, y + height - r3);
  r3 !== 0 && ctx.arc(x + width - r3, y + height - r3, r3, 0, Math.PI / 2);
  ctx.lineTo(x + r4, y + height);
  r4 !== 0 && ctx.arc(x + r4, y + height - r4, r4, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r1);
  r1 !== 0 && ctx.arc(x + r1, y + r1, r1, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/graphic/helper/subPixelOptimize.js
var round2 = Math.round;
function subPixelOptimizeLine(outputShape, inputShape, style) {
  if (!inputShape) {
    return;
  }
  var x1 = inputShape.x1;
  var x2 = inputShape.x2;
  var y1 = inputShape.y1;
  var y2 = inputShape.y2;
  outputShape.x1 = x1;
  outputShape.x2 = x2;
  outputShape.y1 = y1;
  outputShape.y2 = y2;
  var lineWidth = style && style.lineWidth;
  if (!lineWidth) {
    return outputShape;
  }
  if (round2(x1 * 2) === round2(x2 * 2)) {
    outputShape.x1 = outputShape.x2 = subPixelOptimize(x1, lineWidth, true);
  }
  if (round2(y1 * 2) === round2(y2 * 2)) {
    outputShape.y1 = outputShape.y2 = subPixelOptimize(y1, lineWidth, true);
  }
  return outputShape;
}
function subPixelOptimizeRect(outputShape, inputShape, style) {
  if (!inputShape) {
    return;
  }
  var originX = inputShape.x;
  var originY = inputShape.y;
  var originWidth = inputShape.width;
  var originHeight = inputShape.height;
  outputShape.x = originX;
  outputShape.y = originY;
  outputShape.width = originWidth;
  outputShape.height = originHeight;
  var lineWidth = style && style.lineWidth;
  if (!lineWidth) {
    return outputShape;
  }
  outputShape.x = subPixelOptimize(originX, lineWidth, true);
  outputShape.y = subPixelOptimize(originY, lineWidth, true);
  outputShape.width = Math.max(subPixelOptimize(originX + originWidth, lineWidth, false) - outputShape.x, originWidth === 0 ? 0 : 1);
  outputShape.height = Math.max(subPixelOptimize(originY + originHeight, lineWidth, false) - outputShape.y, originHeight === 0 ? 0 : 1);
  return outputShape;
}
function subPixelOptimize(position, lineWidth, positiveOrNegative) {
  if (!lineWidth) {
    return position;
  }
  var doubledPosition = round2(position * 2);
  return (doubledPosition + round2(lineWidth)) % 2 === 0 ? doubledPosition / 2 : (doubledPosition + (positiveOrNegative ? 1 : -1)) / 2;
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/graphic/shape/Rect.js
var RectShape = /* @__PURE__ */ (function() {
  function RectShape2() {
    this.x = 0;
    this.y = 0;
    this.width = 0;
    this.height = 0;
  }
  return RectShape2;
})();
var subPixelOptimizeOutputShape = {};
var Rect = (function(_super) {
  __extends(Rect2, _super);
  function Rect2(opts) {
    return _super.call(this, opts) || this;
  }
  Rect2.prototype.getDefaultShape = function() {
    return new RectShape();
  };
  Rect2.prototype.buildPath = function(ctx, shape) {
    var x;
    var y;
    var width;
    var height;
    if (this.subPixelOptimize) {
      var optimizedShape = subPixelOptimizeRect(subPixelOptimizeOutputShape, shape, this.style);
      x = optimizedShape.x;
      y = optimizedShape.y;
      width = optimizedShape.width;
      height = optimizedShape.height;
      optimizedShape.r = shape.r;
      shape = optimizedShape;
    } else {
      x = shape.x;
      y = shape.y;
      width = shape.width;
      height = shape.height;
    }
    if (!shape.r) {
      ctx.rect(x, y, width, height);
    } else {
      buildPath(ctx, shape);
    }
  };
  Rect2.prototype.isZeroArea = function() {
    return !this.shape.width || !this.shape.height;
  };
  return Rect2;
})(Path_default);
Rect.prototype.type = "rect";
var Rect_default = Rect;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/graphic/Text.js
var DEFAULT_RICH_TEXT_COLOR = {
  fill: "#000"
};
var DEFAULT_STROKE_LINE_WIDTH = 2;
var tmpCITOverflowAreaOut = {};
var DEFAULT_TEXT_ANIMATION_PROPS = {
  style: defaults({
    fill: true,
    stroke: true,
    fillOpacity: true,
    strokeOpacity: true,
    lineWidth: true,
    fontSize: true,
    lineHeight: true,
    width: true,
    height: true,
    textShadowColor: true,
    textShadowBlur: true,
    textShadowOffsetX: true,
    textShadowOffsetY: true,
    backgroundColor: true,
    padding: true,
    borderColor: true,
    borderWidth: true,
    borderRadius: true
  }, DEFAULT_COMMON_ANIMATION_PROPS.style)
};
var ZRText = (function(_super) {
  __extends(ZRText2, _super);
  function ZRText2(opts) {
    var _this = _super.call(this) || this;
    _this.type = "text";
    _this._children = [];
    _this._defaultStyle = DEFAULT_RICH_TEXT_COLOR;
    _this.attr(opts);
    return _this;
  }
  ZRText2.prototype.childrenRef = function() {
    return this._children;
  };
  ZRText2.prototype.update = function() {
    _super.prototype.update.call(this);
    if (this.styleChanged()) {
      this._updateSubTexts();
    }
    for (var i = 0; i < this._children.length; i++) {
      var child = this._children[i];
      child.zlevel = this.zlevel;
      child.z = this.z;
      child.z2 = this.z2;
      child.culling = this.culling;
      child.cursor = this.cursor;
      child.invisible = this.invisible;
    }
  };
  ZRText2.prototype.updateTransform = function() {
    var innerTransformable = this.innerTransformable;
    if (innerTransformable) {
      innerTransformable.updateTransform();
      if (innerTransformable.transform) {
        this.transform = innerTransformable.transform;
      }
    } else {
      _super.prototype.updateTransform.call(this);
    }
  };
  ZRText2.prototype.getLocalTransform = function(m) {
    var innerTransformable = this.innerTransformable;
    return innerTransformable ? innerTransformable.getLocalTransform(m) : _super.prototype.getLocalTransform.call(this, m);
  };
  ZRText2.prototype.getComputedTransform = function() {
    if (this.__hostTarget) {
      this.__hostTarget.getComputedTransform();
      this.__hostTarget.updateInnerText(true);
    }
    return _super.prototype.getComputedTransform.call(this);
  };
  ZRText2.prototype._updateSubTexts = function() {
    this._childCursor = 0;
    normalizeTextStyle(this.style);
    this.style.rich ? this._updateRichTexts() : this._updatePlainTexts();
    this._children.length = this._childCursor;
    this.styleUpdated();
  };
  ZRText2.prototype.addSelfToZr = function(zr) {
    _super.prototype.addSelfToZr.call(this, zr);
    for (var i = 0; i < this._children.length; i++) {
      this._children[i].__zr = zr;
    }
  };
  ZRText2.prototype.removeSelfFromZr = function(zr) {
    _super.prototype.removeSelfFromZr.call(this, zr);
    for (var i = 0; i < this._children.length; i++) {
      this._children[i].__zr = null;
    }
  };
  ZRText2.prototype.getBoundingRect = function() {
    if (this.styleChanged()) {
      this._updateSubTexts();
    }
    if (!this._rect) {
      var tmpRect2 = new BoundingRect_default(0, 0, 0, 0);
      var children = this._children;
      var tmpMat = [];
      var rect = null;
      for (var i = 0; i < children.length; i++) {
        var child = children[i];
        var childRect = child.getBoundingRect();
        var transform = child.getLocalTransform(tmpMat);
        if (transform) {
          tmpRect2.copy(childRect);
          tmpRect2.applyTransform(transform);
          rect = rect || tmpRect2.clone();
          rect.union(tmpRect2);
        } else {
          rect = rect || childRect.clone();
          rect.union(childRect);
        }
      }
      this._rect = rect || tmpRect2;
    }
    return this._rect;
  };
  ZRText2.prototype.setDefaultTextStyle = function(defaultTextStyle) {
    this._defaultStyle = defaultTextStyle || DEFAULT_RICH_TEXT_COLOR;
  };
  ZRText2.prototype.setTextContent = function(textContent) {
    if (false) {
      throw new Error("Can't attach text on another text");
    }
  };
  ZRText2.prototype._mergeStyle = function(targetStyle, sourceStyle) {
    if (!sourceStyle) {
      return targetStyle;
    }
    var sourceRich = sourceStyle.rich;
    var targetRich = targetStyle.rich || sourceRich && {};
    extend(targetStyle, sourceStyle);
    if (sourceRich && targetRich) {
      this._mergeRich(targetRich, sourceRich);
      targetStyle.rich = targetRich;
    } else if (targetRich) {
      targetStyle.rich = targetRich;
    }
    return targetStyle;
  };
  ZRText2.prototype._mergeRich = function(targetRich, sourceRich) {
    var richNames = keys(sourceRich);
    for (var i = 0; i < richNames.length; i++) {
      var richName = richNames[i];
      targetRich[richName] = targetRich[richName] || {};
      extend(targetRich[richName], sourceRich[richName]);
    }
  };
  ZRText2.prototype.getAnimationStyleProps = function() {
    return DEFAULT_TEXT_ANIMATION_PROPS;
  };
  ZRText2.prototype._getOrCreateChild = function(Ctor) {
    var child = this._children[this._childCursor];
    if (!child || !(child instanceof Ctor)) {
      child = new Ctor();
    }
    this._children[this._childCursor++] = child;
    child.__zr = this.__zr;
    child.parent = this;
    return child;
  };
  ZRText2.prototype._updatePlainTexts = function() {
    var style = this.style;
    var textFont = style.font || DEFAULT_FONT;
    var textPadding = style.padding;
    var defaultStyle = this._defaultStyle;
    var baseX = style.x || 0;
    var baseY = style.y || 0;
    var textAlign = style.align || defaultStyle.align || "left";
    var verticalAlign = style.verticalAlign || defaultStyle.verticalAlign || "top";
    calcInnerTextOverflowArea(tmpCITOverflowAreaOut, defaultStyle.overflowRect, baseX, baseY, textAlign, verticalAlign);
    baseX = tmpCITOverflowAreaOut.baseX;
    baseY = tmpCITOverflowAreaOut.baseY;
    var text = getStyleText(style);
    var contentBlock = parsePlainText(text, style, tmpCITOverflowAreaOut.outerWidth, tmpCITOverflowAreaOut.outerHeight);
    var needDrawBg = needDrawBackground(style);
    var bgColorDrawn = !!style.backgroundColor;
    var outerHeight = contentBlock.outerHeight;
    var outerWidth = contentBlock.outerWidth;
    var textLines = contentBlock.lines;
    var lineHeight = contentBlock.lineHeight;
    this.isTruncated = !!contentBlock.isTruncated;
    var textX = baseX;
    var textY = adjustTextY(baseY, contentBlock.contentHeight, verticalAlign);
    if (needDrawBg || textPadding) {
      var boxX = adjustTextX(baseX, outerWidth, textAlign);
      var boxY = adjustTextY(baseY, outerHeight, verticalAlign);
      needDrawBg && this._renderBackground(style, style, boxX, boxY, outerWidth, outerHeight);
    }
    textY += lineHeight / 2;
    if (textPadding) {
      textX = getTextXForPadding(baseX, textAlign, textPadding);
      if (verticalAlign === "top") {
        textY += textPadding[0];
      } else if (verticalAlign === "bottom") {
        textY -= textPadding[2];
      }
    }
    var defaultLineWidth = 0;
    var usingDefaultStroke = false;
    var useDefaultFill = false;
    var textFill = getFill("fill" in style ? style.fill : (useDefaultFill = true, defaultStyle.fill));
    var textStroke = getStroke("stroke" in style ? style.stroke : !bgColorDrawn && (!defaultStyle.autoStroke || useDefaultFill) ? (defaultLineWidth = DEFAULT_STROKE_LINE_WIDTH, usingDefaultStroke = true, defaultStyle.stroke) : null);
    var hasShadow = style.textShadowBlur > 0;
    for (var i = 0; i < textLines.length; i++) {
      var el = this._getOrCreateChild(TSpan_default);
      var subElStyle = el.createStyle();
      el.useStyle(subElStyle);
      subElStyle.text = textLines[i];
      subElStyle.x = textX;
      subElStyle.y = textY;
      if (textAlign) {
        subElStyle.textAlign = textAlign;
      }
      subElStyle.textBaseline = "middle";
      subElStyle.opacity = style.opacity;
      subElStyle.strokeFirst = true;
      if (hasShadow) {
        subElStyle.shadowBlur = style.textShadowBlur || 0;
        subElStyle.shadowColor = style.textShadowColor || "transparent";
        subElStyle.shadowOffsetX = style.textShadowOffsetX || 0;
        subElStyle.shadowOffsetY = style.textShadowOffsetY || 0;
      }
      subElStyle.stroke = textStroke;
      subElStyle.fill = textFill;
      if (textStroke) {
        subElStyle.lineWidth = style.lineWidth || defaultLineWidth;
        subElStyle.lineDash = style.lineDash;
        subElStyle.lineDashOffset = style.lineDashOffset || 0;
      }
      subElStyle.font = textFont;
      setSeparateFont(subElStyle, style);
      textY += lineHeight;
      el.setBoundingRect(tSpanCreateBoundingRect2(subElStyle, contentBlock.contentWidth, contentBlock.calculatedLineHeight, usingDefaultStroke ? 0 : null));
    }
  };
  ZRText2.prototype._updateRichTexts = function() {
    var style = this.style;
    var defaultStyle = this._defaultStyle;
    var textAlign = style.align || defaultStyle.align;
    var verticalAlign = style.verticalAlign || defaultStyle.verticalAlign;
    var baseX = style.x || 0;
    var baseY = style.y || 0;
    calcInnerTextOverflowArea(tmpCITOverflowAreaOut, defaultStyle.overflowRect, baseX, baseY, textAlign, verticalAlign);
    baseX = tmpCITOverflowAreaOut.baseX;
    baseY = tmpCITOverflowAreaOut.baseY;
    var text = getStyleText(style);
    var contentBlock = parseRichText(text, style, tmpCITOverflowAreaOut.outerWidth, tmpCITOverflowAreaOut.outerHeight, textAlign);
    var contentWidth = contentBlock.width;
    var outerWidth = contentBlock.outerWidth;
    var outerHeight = contentBlock.outerHeight;
    var textPadding = style.padding;
    this.isTruncated = !!contentBlock.isTruncated;
    var boxX = adjustTextX(baseX, outerWidth, textAlign);
    var boxY = adjustTextY(baseY, outerHeight, verticalAlign);
    var xLeft = boxX;
    var lineTop = boxY;
    if (textPadding) {
      xLeft += textPadding[3];
      lineTop += textPadding[0];
    }
    var xRight = xLeft + contentWidth;
    if (needDrawBackground(style)) {
      this._renderBackground(style, style, boxX, boxY, outerWidth, outerHeight);
    }
    var bgColorDrawn = !!style.backgroundColor;
    for (var i = 0; i < contentBlock.lines.length; i++) {
      var line = contentBlock.lines[i];
      var tokens2 = line.tokens;
      var tokenCount = tokens2.length;
      var lineHeight = line.lineHeight;
      var remainedWidth = line.width;
      var leftIndex = 0;
      var lineXLeft = xLeft;
      var lineXRight = xRight;
      var rightIndex = tokenCount - 1;
      var token = void 0;
      while (leftIndex < tokenCount && (token = tokens2[leftIndex], !token.align || token.align === "left")) {
        this._placeToken(token, style, lineHeight, lineTop, lineXLeft, "left", bgColorDrawn);
        remainedWidth -= token.width;
        lineXLeft += token.width;
        leftIndex++;
      }
      while (rightIndex >= 0 && (token = tokens2[rightIndex], token.align === "right")) {
        this._placeToken(token, style, lineHeight, lineTop, lineXRight, "right", bgColorDrawn);
        remainedWidth -= token.width;
        lineXRight -= token.width;
        rightIndex--;
      }
      lineXLeft += (contentWidth - (lineXLeft - xLeft) - (xRight - lineXRight) - remainedWidth) / 2;
      while (leftIndex <= rightIndex) {
        token = tokens2[leftIndex];
        this._placeToken(token, style, lineHeight, lineTop, lineXLeft + token.width / 2, "center", bgColorDrawn);
        lineXLeft += token.width;
        leftIndex++;
      }
      lineTop += lineHeight;
    }
  };
  ZRText2.prototype._placeToken = function(token, style, lineHeight, lineTop, x, textAlign, parentBgColorDrawn) {
    var tokenStyle = style.rich[token.styleName] || {};
    tokenStyle.text = token.text;
    var verticalAlign = token.verticalAlign;
    var y = lineTop + lineHeight / 2;
    if (verticalAlign === "top") {
      y = lineTop + token.height / 2;
    } else if (verticalAlign === "bottom") {
      y = lineTop + lineHeight - token.height / 2;
    }
    var needDrawBg = !token.isLineHolder && needDrawBackground(tokenStyle);
    needDrawBg && this._renderBackground(tokenStyle, style, textAlign === "right" ? x - token.width : textAlign === "center" ? x - token.width / 2 : x, y - token.height / 2, token.width, token.height);
    var bgColorDrawn = !!tokenStyle.backgroundColor;
    var textPadding = token.textPadding;
    if (textPadding) {
      x = getTextXForPadding(x, textAlign, textPadding);
      y -= token.height / 2 - textPadding[0] - token.innerHeight / 2;
    }
    var el = this._getOrCreateChild(TSpan_default);
    var subElStyle = el.createStyle();
    el.useStyle(subElStyle);
    var defaultStyle = this._defaultStyle;
    var useDefaultFill = false;
    var defaultLineWidth = 0;
    var usingDefaultStroke = false;
    var textFill = getFill("fill" in tokenStyle ? tokenStyle.fill : "fill" in style ? style.fill : (useDefaultFill = true, defaultStyle.fill));
    var textStroke = getStroke("stroke" in tokenStyle ? tokenStyle.stroke : "stroke" in style ? style.stroke : !bgColorDrawn && !parentBgColorDrawn && (!defaultStyle.autoStroke || useDefaultFill) ? (defaultLineWidth = DEFAULT_STROKE_LINE_WIDTH, usingDefaultStroke = true, defaultStyle.stroke) : null);
    var hasShadow = tokenStyle.textShadowBlur > 0 || style.textShadowBlur > 0;
    subElStyle.text = token.text;
    subElStyle.x = x;
    subElStyle.y = y;
    if (hasShadow) {
      subElStyle.shadowBlur = tokenStyle.textShadowBlur || style.textShadowBlur || 0;
      subElStyle.shadowColor = tokenStyle.textShadowColor || style.textShadowColor || "transparent";
      subElStyle.shadowOffsetX = tokenStyle.textShadowOffsetX || style.textShadowOffsetX || 0;
      subElStyle.shadowOffsetY = tokenStyle.textShadowOffsetY || style.textShadowOffsetY || 0;
    }
    subElStyle.textAlign = textAlign;
    subElStyle.textBaseline = "middle";
    subElStyle.font = token.font || DEFAULT_FONT;
    subElStyle.opacity = retrieve3(tokenStyle.opacity, style.opacity, 1);
    setSeparateFont(subElStyle, tokenStyle);
    if (textStroke) {
      subElStyle.lineWidth = retrieve3(tokenStyle.lineWidth, style.lineWidth, defaultLineWidth);
      subElStyle.lineDash = retrieve2(tokenStyle.lineDash, style.lineDash);
      subElStyle.lineDashOffset = style.lineDashOffset || 0;
      subElStyle.stroke = textStroke;
    }
    if (textFill) {
      subElStyle.fill = textFill;
    }
    el.setBoundingRect(tSpanCreateBoundingRect2(subElStyle, token.contentWidth, token.contentHeight, usingDefaultStroke ? 0 : null));
  };
  ZRText2.prototype._renderBackground = function(style, topStyle, x, y, width, height) {
    var textBackgroundColor = style.backgroundColor;
    var textBorderWidth = style.borderWidth;
    var textBorderColor = style.borderColor;
    var isImageBg = textBackgroundColor && textBackgroundColor.image;
    var isPlainOrGradientBg = textBackgroundColor && !isImageBg;
    var textBorderRadius = style.borderRadius;
    var self2 = this;
    var rectEl;
    var imgEl;
    if (isPlainOrGradientBg || style.lineHeight || textBorderWidth && textBorderColor) {
      rectEl = this._getOrCreateChild(Rect_default);
      rectEl.useStyle(rectEl.createStyle());
      rectEl.style.fill = null;
      var rectShape = rectEl.shape;
      rectShape.x = x;
      rectShape.y = y;
      rectShape.width = width;
      rectShape.height = height;
      rectShape.r = textBorderRadius;
      rectEl.dirtyShape();
    }
    if (isPlainOrGradientBg) {
      var rectStyle = rectEl.style;
      rectStyle.fill = textBackgroundColor || null;
      rectStyle.fillOpacity = retrieve2(style.fillOpacity, 1);
    } else if (isImageBg) {
      imgEl = this._getOrCreateChild(Image_default);
      imgEl.onload = function() {
        self2.dirtyStyle();
      };
      var imgStyle = imgEl.style;
      imgStyle.image = textBackgroundColor.image;
      imgStyle.x = x;
      imgStyle.y = y;
      imgStyle.width = width;
      imgStyle.height = height;
    }
    if (textBorderWidth && textBorderColor) {
      var rectStyle = rectEl.style;
      rectStyle.lineWidth = textBorderWidth;
      rectStyle.stroke = textBorderColor;
      rectStyle.strokeOpacity = retrieve2(style.strokeOpacity, 1);
      rectStyle.lineDash = style.borderDash;
      rectStyle.lineDashOffset = style.borderDashOffset || 0;
      rectEl.strokeContainThreshold = 0;
      if (rectEl.hasFill() && rectEl.hasStroke()) {
        rectStyle.strokeFirst = true;
        rectStyle.lineWidth *= 2;
      }
    }
    var commonStyle = (rectEl || imgEl).style;
    commonStyle.shadowBlur = style.shadowBlur || 0;
    commonStyle.shadowColor = style.shadowColor || "transparent";
    commonStyle.shadowOffsetX = style.shadowOffsetX || 0;
    commonStyle.shadowOffsetY = style.shadowOffsetY || 0;
    commonStyle.opacity = retrieve3(style.opacity, topStyle.opacity, 1);
  };
  ZRText2.makeFont = function(style) {
    var font = "";
    if (hasSeparateFont(style)) {
      font = [
        style.fontStyle,
        style.fontWeight,
        parseFontSize(style.fontSize),
        style.fontFamily || "sans-serif"
      ].join(" ");
    }
    return font && trim(font) || style.textFont || style.font;
  };
  return ZRText2;
})(Displayable_default);
var VALID_TEXT_ALIGN = { left: true, right: 1, center: 1 };
var VALID_TEXT_VERTICAL_ALIGN = { top: 1, bottom: 1, middle: 1 };
var FONT_PARTS = ["fontStyle", "fontWeight", "fontSize", "fontFamily"];
function parseFontSize(fontSize) {
  if (typeof fontSize === "string" && (fontSize.indexOf("px") !== -1 || fontSize.indexOf("rem") !== -1 || fontSize.indexOf("em") !== -1)) {
    return fontSize;
  } else if (!isNaN(+fontSize)) {
    return fontSize + "px";
  } else {
    return DEFAULT_FONT_SIZE + "px";
  }
}
function setSeparateFont(targetStyle, sourceStyle) {
  for (var i = 0; i < FONT_PARTS.length; i++) {
    var fontProp = FONT_PARTS[i];
    var val = sourceStyle[fontProp];
    if (val != null) {
      targetStyle[fontProp] = val;
    }
  }
}
function hasSeparateFont(style) {
  return style.fontSize != null || style.fontFamily || style.fontWeight;
}
function normalizeTextStyle(style) {
  normalizeStyle(style);
  each(style.rich, normalizeStyle);
  return style;
}
function normalizeStyle(style) {
  if (style) {
    style.font = ZRText.makeFont(style);
    var textAlign = style.align;
    textAlign === "middle" && (textAlign = "center");
    style.align = textAlign == null || VALID_TEXT_ALIGN[textAlign] ? textAlign : "left";
    var verticalAlign = style.verticalAlign;
    verticalAlign === "center" && (verticalAlign = "middle");
    style.verticalAlign = verticalAlign == null || VALID_TEXT_VERTICAL_ALIGN[verticalAlign] ? verticalAlign : "top";
    var textPadding = style.padding;
    if (textPadding) {
      style.padding = normalizeCssArray(style.padding);
    }
  }
}
function getStroke(stroke, lineWidth) {
  return stroke == null || lineWidth <= 0 || stroke === "transparent" || stroke === "none" ? null : stroke.image || stroke.colorStops ? "#000" : stroke;
}
function getFill(fill) {
  return fill == null || fill === "none" ? null : fill.image || fill.colorStops ? "#000" : fill;
}
function getTextXForPadding(x, textAlign, textPadding) {
  return textAlign === "right" ? x - textPadding[1] : textAlign === "center" ? x + textPadding[3] / 2 - textPadding[1] / 2 : x + textPadding[3];
}
function getStyleText(style) {
  var text = style.text;
  text != null && (text += "");
  return text;
}
function needDrawBackground(style) {
  return !!(style.backgroundColor || style.lineHeight || style.borderWidth && style.borderColor);
}
var Text_default = ZRText;

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/util/innerStore.js
var getECData = makeInner();

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/util/types.js
var UNDEFINED_STR = "undefined";
var VISUAL_DIMENSIONS = createHashMap(["tooltip", "label", "itemName", "itemId", "itemGroupId", "itemChildGroupId", "seriesName"]);
var SOURCE_FORMAT_ORIGINAL = "original";
var SOURCE_FORMAT_ARRAY_ROWS = "arrayRows";
var SOURCE_FORMAT_OBJECT_ROWS = "objectRows";
var SOURCE_FORMAT_KEYED_COLUMNS = "keyedColumns";
var SOURCE_FORMAT_TYPED_ARRAY = "typedArray";
var SOURCE_FORMAT_UNKNOWN = "unknown";
var SERIES_LAYOUT_BY_COLUMN = "column";
var SERIES_LAYOUT_BY_ROW = "row";

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/util/states.js
var getSavedStates = makeInner();
var getComponentStates = makeInner();
var SPECIAL_STATES = ["emphasis", "blur", "select"];
var DISPLAY_STATES = ["normal", "emphasis", "blur", "select"];

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/tool/transformPath.js
var CMD3 = PathProxy_default.CMD;
var points = [[], [], []];
var mathSqrt2 = Math.sqrt;
var mathAtan2 = Math.atan2;
function transformPath(path, m) {
  if (!m) {
    return;
  }
  var data = path.data;
  var len2 = path.len();
  var cmd;
  var nPoint;
  var i;
  var j;
  var k;
  var p;
  var M = CMD3.M;
  var C = CMD3.C;
  var L = CMD3.L;
  var R = CMD3.R;
  var A = CMD3.A;
  var Q = CMD3.Q;
  for (i = 0, j = 0; i < len2; ) {
    cmd = data[i++];
    j = i;
    nPoint = 0;
    switch (cmd) {
      case M:
        nPoint = 1;
        break;
      case L:
        nPoint = 1;
        break;
      case C:
        nPoint = 3;
        break;
      case Q:
        nPoint = 2;
        break;
      case A:
        var x = m[4];
        var y = m[5];
        var sx = mathSqrt2(m[0] * m[0] + m[1] * m[1]);
        var sy = mathSqrt2(m[2] * m[2] + m[3] * m[3]);
        var angle = mathAtan2(-m[1] / sy, m[0] / sx);
        data[i] *= sx;
        data[i++] += x;
        data[i] *= sy;
        data[i++] += y;
        data[i++] *= sx;
        data[i++] *= sy;
        data[i++] += angle;
        data[i++] += angle;
        i += 2;
        j = i;
        break;
      case R:
        p[0] = data[i++];
        p[1] = data[i++];
        applyTransform(p, p, m);
        data[j++] = p[0];
        data[j++] = p[1];
        p[0] += data[i++];
        p[1] += data[i++];
        applyTransform(p, p, m);
        data[j++] = p[0];
        data[j++] = p[1];
    }
    for (k = 0; k < nPoint; k++) {
      var p_1 = points[k];
      p_1[0] = data[i++];
      p_1[1] = data[i++];
      applyTransform(p_1, p_1, m);
      data[j++] = p_1[0];
      data[j++] = p_1[1];
    }
  }
  path.increaseVersion();
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/tool/path.js
var mathSqrt3 = Math.sqrt;
var mathSin3 = Math.sin;
var mathCos3 = Math.cos;
var PI3 = Math.PI;
function vMag(v) {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1]);
}
function vRatio(u, v) {
  return (u[0] * v[0] + u[1] * v[1]) / (vMag(u) * vMag(v));
}
function vAngle(u, v) {
  return (u[0] * v[1] < u[1] * v[0] ? -1 : 1) * Math.acos(vRatio(u, v));
}
function processArc(x1, y1, x2, y2, fa, fs, rx, ry, psiDeg, cmd, path) {
  var psi = psiDeg * (PI3 / 180);
  var xp = mathCos3(psi) * (x1 - x2) / 2 + mathSin3(psi) * (y1 - y2) / 2;
  var yp = -1 * mathSin3(psi) * (x1 - x2) / 2 + mathCos3(psi) * (y1 - y2) / 2;
  var lambda = xp * xp / (rx * rx) + yp * yp / (ry * ry);
  if (lambda > 1) {
    rx *= mathSqrt3(lambda);
    ry *= mathSqrt3(lambda);
  }
  var f = (fa === fs ? -1 : 1) * mathSqrt3((rx * rx * (ry * ry) - rx * rx * (yp * yp) - ry * ry * (xp * xp)) / (rx * rx * (yp * yp) + ry * ry * (xp * xp))) || 0;
  var cxp = f * rx * yp / ry;
  var cyp = f * -ry * xp / rx;
  var cx = (x1 + x2) / 2 + mathCos3(psi) * cxp - mathSin3(psi) * cyp;
  var cy = (y1 + y2) / 2 + mathSin3(psi) * cxp + mathCos3(psi) * cyp;
  var theta = vAngle([1, 0], [(xp - cxp) / rx, (yp - cyp) / ry]);
  var u = [(xp - cxp) / rx, (yp - cyp) / ry];
  var v = [(-1 * xp - cxp) / rx, (-1 * yp - cyp) / ry];
  var dTheta = vAngle(u, v);
  if (vRatio(u, v) <= -1) {
    dTheta = PI3;
  }
  if (vRatio(u, v) >= 1) {
    dTheta = 0;
  }
  if (dTheta < 0) {
    var n = Math.round(dTheta / PI3 * 1e6) / 1e6;
    dTheta = PI3 * 2 + n % 2 * PI3;
  }
  path.addData(cmd, cx, cy, rx, ry, theta, dTheta, psi, fs);
}
var commandReg = /([mlvhzcqtsa])([^mlvhzcqtsa]*)/ig;
var numberReg = /-?([0-9]*\.)?[0-9]+([eE]-?[0-9]+)?/g;
function createPathProxyFromString(data) {
  var path = new PathProxy_default();
  if (!data) {
    return path;
  }
  var cpx = 0;
  var cpy = 0;
  var subpathX = cpx;
  var subpathY = cpy;
  var prevCmd;
  var CMD6 = PathProxy_default.CMD;
  var cmdList = data.match(commandReg);
  if (!cmdList) {
    return path;
  }
  for (var l = 0; l < cmdList.length; l++) {
    var cmdText = cmdList[l];
    var cmdStr = cmdText.charAt(0);
    var cmd = void 0;
    var p = cmdText.match(numberReg) || [];
    var pLen = p.length;
    for (var i = 0; i < pLen; i++) {
      p[i] = parseFloat(p[i]);
    }
    var off = 0;
    while (off < pLen) {
      var ctlPtx = void 0;
      var ctlPty = void 0;
      var rx = void 0;
      var ry = void 0;
      var psi = void 0;
      var fa = void 0;
      var fs = void 0;
      var x1 = cpx;
      var y1 = cpy;
      var len2 = void 0;
      var pathData = void 0;
      switch (cmdStr) {
        case "l":
          cpx += p[off++];
          cpy += p[off++];
          cmd = CMD6.L;
          path.addData(cmd, cpx, cpy);
          break;
        case "L":
          cpx = p[off++];
          cpy = p[off++];
          cmd = CMD6.L;
          path.addData(cmd, cpx, cpy);
          break;
        case "m":
          cpx += p[off++];
          cpy += p[off++];
          cmd = CMD6.M;
          path.addData(cmd, cpx, cpy);
          subpathX = cpx;
          subpathY = cpy;
          cmdStr = "l";
          break;
        case "M":
          cpx = p[off++];
          cpy = p[off++];
          cmd = CMD6.M;
          path.addData(cmd, cpx, cpy);
          subpathX = cpx;
          subpathY = cpy;
          cmdStr = "L";
          break;
        case "h":
          cpx += p[off++];
          cmd = CMD6.L;
          path.addData(cmd, cpx, cpy);
          break;
        case "H":
          cpx = p[off++];
          cmd = CMD6.L;
          path.addData(cmd, cpx, cpy);
          break;
        case "v":
          cpy += p[off++];
          cmd = CMD6.L;
          path.addData(cmd, cpx, cpy);
          break;
        case "V":
          cpy = p[off++];
          cmd = CMD6.L;
          path.addData(cmd, cpx, cpy);
          break;
        case "C":
          cmd = CMD6.C;
          path.addData(cmd, p[off++], p[off++], p[off++], p[off++], p[off++], p[off++]);
          cpx = p[off - 2];
          cpy = p[off - 1];
          break;
        case "c":
          cmd = CMD6.C;
          path.addData(cmd, p[off++] + cpx, p[off++] + cpy, p[off++] + cpx, p[off++] + cpy, p[off++] + cpx, p[off++] + cpy);
          cpx += p[off - 2];
          cpy += p[off - 1];
          break;
        case "S":
          ctlPtx = cpx;
          ctlPty = cpy;
          len2 = path.len();
          pathData = path.data;
          if (prevCmd === CMD6.C) {
            ctlPtx += cpx - pathData[len2 - 4];
            ctlPty += cpy - pathData[len2 - 3];
          }
          cmd = CMD6.C;
          x1 = p[off++];
          y1 = p[off++];
          cpx = p[off++];
          cpy = p[off++];
          path.addData(cmd, ctlPtx, ctlPty, x1, y1, cpx, cpy);
          break;
        case "s":
          ctlPtx = cpx;
          ctlPty = cpy;
          len2 = path.len();
          pathData = path.data;
          if (prevCmd === CMD6.C) {
            ctlPtx += cpx - pathData[len2 - 4];
            ctlPty += cpy - pathData[len2 - 3];
          }
          cmd = CMD6.C;
          x1 = cpx + p[off++];
          y1 = cpy + p[off++];
          cpx += p[off++];
          cpy += p[off++];
          path.addData(cmd, ctlPtx, ctlPty, x1, y1, cpx, cpy);
          break;
        case "Q":
          x1 = p[off++];
          y1 = p[off++];
          cpx = p[off++];
          cpy = p[off++];
          cmd = CMD6.Q;
          path.addData(cmd, x1, y1, cpx, cpy);
          break;
        case "q":
          x1 = p[off++] + cpx;
          y1 = p[off++] + cpy;
          cpx += p[off++];
          cpy += p[off++];
          cmd = CMD6.Q;
          path.addData(cmd, x1, y1, cpx, cpy);
          break;
        case "T":
          ctlPtx = cpx;
          ctlPty = cpy;
          len2 = path.len();
          pathData = path.data;
          if (prevCmd === CMD6.Q) {
            ctlPtx += cpx - pathData[len2 - 4];
            ctlPty += cpy - pathData[len2 - 3];
          }
          cpx = p[off++];
          cpy = p[off++];
          cmd = CMD6.Q;
          path.addData(cmd, ctlPtx, ctlPty, cpx, cpy);
          break;
        case "t":
          ctlPtx = cpx;
          ctlPty = cpy;
          len2 = path.len();
          pathData = path.data;
          if (prevCmd === CMD6.Q) {
            ctlPtx += cpx - pathData[len2 - 4];
            ctlPty += cpy - pathData[len2 - 3];
          }
          cpx += p[off++];
          cpy += p[off++];
          cmd = CMD6.Q;
          path.addData(cmd, ctlPtx, ctlPty, cpx, cpy);
          break;
        case "A":
          rx = p[off++];
          ry = p[off++];
          psi = p[off++];
          fa = p[off++];
          fs = p[off++];
          x1 = cpx, y1 = cpy;
          cpx = p[off++];
          cpy = p[off++];
          cmd = CMD6.A;
          processArc(x1, y1, cpx, cpy, fa, fs, rx, ry, psi, cmd, path);
          break;
        case "a":
          rx = p[off++];
          ry = p[off++];
          psi = p[off++];
          fa = p[off++];
          fs = p[off++];
          x1 = cpx, y1 = cpy;
          cpx += p[off++];
          cpy += p[off++];
          cmd = CMD6.A;
          processArc(x1, y1, cpx, cpy, fa, fs, rx, ry, psi, cmd, path);
          break;
      }
    }
    if (cmdStr === "z" || cmdStr === "Z") {
      cmd = CMD6.Z;
      path.addData(cmd);
      cpx = subpathX;
      cpy = subpathY;
    }
    prevCmd = cmd;
  }
  path.toStatic();
  return path;
}
var SVGPath = (function(_super) {
  __extends(SVGPath2, _super);
  function SVGPath2() {
    return _super !== null && _super.apply(this, arguments) || this;
  }
  SVGPath2.prototype.applyTransform = function(m) {
  };
  return SVGPath2;
})(Path_default);
function isPathProxy(path) {
  return path.setData != null;
}
function createPathOptions(str, opts) {
  var pathProxy = createPathProxyFromString(str);
  var innerOpts = extend({}, opts);
  innerOpts.buildPath = function(path) {
    var beProxy = isPathProxy(path);
    if (beProxy && path.canSave()) {
      path.appendPath(pathProxy);
      var ctx = path.getContext();
      if (ctx) {
        path.rebuildPath(ctx, 1);
      }
    } else {
      var ctx = beProxy ? path.getContext() : path;
      if (ctx) {
        pathProxy.rebuildPath(ctx, 1);
      }
    }
  };
  innerOpts.applyTransform = function(m) {
    transformPath(pathProxy, m);
    this.dirtyShape();
  };
  return innerOpts;
}
function createFromString(str, opts) {
  return new SVGPath(createPathOptions(str, opts));
}
function clonePath(sourcePath, opts) {
  opts = opts || {};
  var path = new Path_default();
  if (sourcePath.shape) {
    path.setShape(sourcePath.shape);
  }
  path.setStyle(sourcePath.style);
  if (opts.bakeTransform) {
    transformPath(path.path, sourcePath.getComputedTransform());
  } else {
    if (opts.toLocal) {
      path.setLocalTransform(sourcePath.getComputedTransform());
    } else {
      path.copyTransform(sourcePath);
    }
  }
  path.buildPath = sourcePath.buildPath;
  path.applyTransform = path.applyTransform;
  path.z = sourcePath.z;
  path.z2 = sourcePath.z2;
  path.zlevel = sourcePath.zlevel;
  return path;
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/graphic/Group.js
var Group = (function(_super) {
  __extends(Group2, _super);
  function Group2(opts) {
    var _this = _super.call(this) || this;
    _this.isGroup = true;
    _this._children = [];
    _this.attr(opts);
    return _this;
  }
  Group2.prototype.childrenRef = function() {
    return this._children;
  };
  Group2.prototype.children = function() {
    return this._children.slice();
  };
  Group2.prototype.childAt = function(idx) {
    return this._children[idx];
  };
  Group2.prototype.childOfName = function(name) {
    var children = this._children;
    for (var i = 0; i < children.length; i++) {
      if (children[i].name === name) {
        return children[i];
      }
    }
  };
  Group2.prototype.childCount = function() {
    return this._children.length;
  };
  Group2.prototype.add = function(child) {
    if (child) {
      if (child !== this && child.parent !== this) {
        this._children.push(child);
        this._doAdd(child);
      }
      if (false) {
        if (child.__hostTarget) {
          throw "This elemenet has been used as an attachment";
        }
      }
    }
    return this;
  };
  Group2.prototype.addBefore = function(child, nextSibling) {
    if (child && child !== this && child.parent !== this && nextSibling && nextSibling.parent === this) {
      var children = this._children;
      var idx = children.indexOf(nextSibling);
      if (idx >= 0) {
        children.splice(idx, 0, child);
        this._doAdd(child);
      }
    }
    return this;
  };
  Group2.prototype.replace = function(oldChild, newChild) {
    var idx = indexOf(this._children, oldChild);
    if (idx >= 0) {
      this.replaceAt(newChild, idx);
    }
    return this;
  };
  Group2.prototype.replaceAt = function(child, index) {
    var children = this._children;
    var old = children[index];
    if (child && child !== this && child.parent !== this && child !== old) {
      children[index] = child;
      old.parent = null;
      var zr = this.__zr;
      if (zr) {
        old.removeSelfFromZr(zr);
      }
      this._doAdd(child);
    }
    return this;
  };
  Group2.prototype._doAdd = function(child) {
    if (child.parent) {
      child.parent.remove(child);
    }
    child.parent = this;
    var zr = this.__zr;
    if (zr && zr !== child.__zr) {
      child.addSelfToZr(zr);
    }
    zr && zr.refresh();
  };
  Group2.prototype.remove = function(child) {
    var zr = this.__zr;
    var children = this._children;
    var idx = indexOf(children, child);
    if (idx < 0) {
      return this;
    }
    children.splice(idx, 1);
    child.parent = null;
    if (zr) {
      child.removeSelfFromZr(zr);
    }
    zr && zr.refresh();
    return this;
  };
  Group2.prototype.removeAll = function() {
    var children = this._children;
    var zr = this.__zr;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (zr) {
        child.removeSelfFromZr(zr);
      }
      child.parent = null;
    }
    children.length = 0;
    return this;
  };
  Group2.prototype.eachChild = function(cb, context) {
    var children = this._children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      cb.call(context, child, i);
    }
    return this;
  };
  Group2.prototype.traverse = function(cb, context) {
    for (var i = 0; i < this._children.length; i++) {
      var child = this._children[i];
      var stopped = cb.call(context, child);
      if (child.isGroup && !stopped) {
        child.traverse(cb, context);
      }
    }
    return this;
  };
  Group2.prototype.addSelfToZr = function(zr) {
    _super.prototype.addSelfToZr.call(this, zr);
    for (var i = 0; i < this._children.length; i++) {
      var child = this._children[i];
      child.addSelfToZr(zr);
    }
  };
  Group2.prototype.removeSelfFromZr = function(zr) {
    _super.prototype.removeSelfFromZr.call(this, zr);
    for (var i = 0; i < this._children.length; i++) {
      var child = this._children[i];
      child.removeSelfFromZr(zr);
    }
  };
  Group2.prototype.getBoundingRect = function(includeChildren) {
    var tmpRect2 = new BoundingRect_default(0, 0, 0, 0);
    var children = includeChildren || this._children;
    var tmpMat = [];
    var rect = null;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child.ignore || child.invisible) {
        continue;
      }
      var childRect = child.getBoundingRect();
      var transform = child.getLocalTransform(tmpMat);
      if (transform) {
        BoundingRect_default.applyTransform(tmpRect2, childRect, transform);
        rect = rect || tmpRect2.clone();
        rect.union(tmpRect2);
      } else {
        rect = rect || childRect.clone();
        rect.union(childRect);
      }
    }
    return rect || tmpRect2;
  };
  return Group2;
})(Element_default);
Group.prototype.type = "group";
var Group_default = Group;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/graphic/shape/Circle.js
var CircleShape = /* @__PURE__ */ (function() {
  function CircleShape2() {
    this.cx = 0;
    this.cy = 0;
    this.r = 0;
  }
  return CircleShape2;
})();
var Circle = (function(_super) {
  __extends(Circle2, _super);
  function Circle2(opts) {
    return _super.call(this, opts) || this;
  }
  Circle2.prototype.getDefaultShape = function() {
    return new CircleShape();
  };
  Circle2.prototype.buildPath = function(ctx, shape) {
    ctx.moveTo(shape.cx + shape.r, shape.cy);
    ctx.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
  };
  return Circle2;
})(Path_default);
Circle.prototype.type = "circle";
var Circle_default = Circle;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/graphic/shape/Ellipse.js
var EllipseShape = /* @__PURE__ */ (function() {
  function EllipseShape2() {
    this.cx = 0;
    this.cy = 0;
    this.rx = 0;
    this.ry = 0;
  }
  return EllipseShape2;
})();
var Ellipse = (function(_super) {
  __extends(Ellipse2, _super);
  function Ellipse2(opts) {
    return _super.call(this, opts) || this;
  }
  Ellipse2.prototype.getDefaultShape = function() {
    return new EllipseShape();
  };
  Ellipse2.prototype.buildPath = function(ctx, shape) {
    var k = 0.5522848;
    var x = shape.cx;
    var y = shape.cy;
    var a = shape.rx;
    var b = shape.ry;
    var ox = a * k;
    var oy = b * k;
    ctx.moveTo(x - a, y);
    ctx.bezierCurveTo(x - a, y - oy, x - ox, y - b, x, y - b);
    ctx.bezierCurveTo(x + ox, y - b, x + a, y - oy, x + a, y);
    ctx.bezierCurveTo(x + a, y + oy, x + ox, y + b, x, y + b);
    ctx.bezierCurveTo(x - ox, y + b, x - a, y + oy, x - a, y);
    ctx.closePath();
  };
  return Ellipse2;
})(Path_default);
Ellipse.prototype.type = "ellipse";
var Ellipse_default = Ellipse;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/graphic/helper/roundSector.js
var PI4 = Math.PI;
var PI26 = PI4 * 2;
var mathSin4 = Math.sin;
var mathCos4 = Math.cos;
var mathACos = Math.acos;
var mathATan2 = Math.atan2;
var mathAbs4 = Math.abs;
var mathSqrt4 = Math.sqrt;
var mathMax5 = Math.max;
var mathMin5 = Math.min;
var e = 1e-4;
function intersect(x0, y0, x1, y1, x2, y2, x3, y3) {
  var dx10 = x1 - x0;
  var dy10 = y1 - y0;
  var dx32 = x3 - x2;
  var dy32 = y3 - y2;
  var t = dy32 * dx10 - dx32 * dy10;
  if (t * t < e) {
    return;
  }
  t = (dx32 * (y0 - y2) - dy32 * (x0 - x2)) / t;
  return [x0 + t * dx10, y0 + t * dy10];
}
function computeCornerTangents(x0, y0, x1, y1, radius, cr, clockwise) {
  var x01 = x0 - x1;
  var y01 = y0 - y1;
  var lo = (clockwise ? cr : -cr) / mathSqrt4(x01 * x01 + y01 * y01);
  var ox = lo * y01;
  var oy = -lo * x01;
  var x11 = x0 + ox;
  var y11 = y0 + oy;
  var x10 = x1 + ox;
  var y10 = y1 + oy;
  var x00 = (x11 + x10) / 2;
  var y00 = (y11 + y10) / 2;
  var dx = x10 - x11;
  var dy = y10 - y11;
  var d2 = dx * dx + dy * dy;
  var r = radius - cr;
  var s = x11 * y10 - x10 * y11;
  var d = (dy < 0 ? -1 : 1) * mathSqrt4(mathMax5(0, r * r * d2 - s * s));
  var cx0 = (s * dy - dx * d) / d2;
  var cy0 = (-s * dx - dy * d) / d2;
  var cx1 = (s * dy + dx * d) / d2;
  var cy1 = (-s * dx + dy * d) / d2;
  var dx0 = cx0 - x00;
  var dy0 = cy0 - y00;
  var dx1 = cx1 - x00;
  var dy1 = cy1 - y00;
  if (dx0 * dx0 + dy0 * dy0 > dx1 * dx1 + dy1 * dy1) {
    cx0 = cx1;
    cy0 = cy1;
  }
  return {
    cx: cx0,
    cy: cy0,
    x0: -ox,
    y0: -oy,
    x1: cx0 * (radius / r - 1),
    y1: cy0 * (radius / r - 1)
  };
}
function normalizeCornerRadius(cr) {
  var arr;
  if (isArray(cr)) {
    var len2 = cr.length;
    if (!len2) {
      return cr;
    }
    if (len2 === 1) {
      arr = [cr[0], cr[0], 0, 0];
    } else if (len2 === 2) {
      arr = [cr[0], cr[0], cr[1], cr[1]];
    } else if (len2 === 3) {
      arr = cr.concat(cr[2]);
    } else {
      arr = cr;
    }
  } else {
    arr = [cr, cr, cr, cr];
  }
  return arr;
}
function buildPath2(ctx, shape) {
  var _a2;
  var radius = mathMax5(shape.r, 0);
  var innerRadius = mathMax5(shape.r0 || 0, 0);
  var hasRadius = radius > 0;
  var hasInnerRadius = innerRadius > 0;
  if (!hasRadius && !hasInnerRadius) {
    return;
  }
  if (!hasRadius) {
    radius = innerRadius;
    innerRadius = 0;
  }
  if (innerRadius > radius) {
    var tmp = radius;
    radius = innerRadius;
    innerRadius = tmp;
  }
  var startAngle = shape.startAngle, endAngle = shape.endAngle;
  if (isNaN(startAngle) || isNaN(endAngle)) {
    return;
  }
  var cx = shape.cx, cy = shape.cy;
  var clockwise = !!shape.clockwise;
  var arc = mathAbs4(endAngle - startAngle);
  var mod = arc > PI26 && arc % PI26;
  mod > e && (arc = mod);
  if (!(radius > e)) {
    ctx.moveTo(cx, cy);
  } else if (arc > PI26 - e) {
    ctx.moveTo(cx + radius * mathCos4(startAngle), cy + radius * mathSin4(startAngle));
    ctx.arc(cx, cy, radius, startAngle, endAngle, !clockwise);
    if (innerRadius > e) {
      ctx.moveTo(cx + innerRadius * mathCos4(endAngle), cy + innerRadius * mathSin4(endAngle));
      ctx.arc(cx, cy, innerRadius, endAngle, startAngle, clockwise);
    }
  } else {
    var icrStart = void 0;
    var icrEnd = void 0;
    var ocrStart = void 0;
    var ocrEnd = void 0;
    var ocrs = void 0;
    var ocre = void 0;
    var icrs = void 0;
    var icre = void 0;
    var ocrMax = void 0;
    var icrMax = void 0;
    var limitedOcrMax = void 0;
    var limitedIcrMax = void 0;
    var xre = void 0;
    var yre = void 0;
    var xirs = void 0;
    var yirs = void 0;
    var xrs = radius * mathCos4(startAngle);
    var yrs = radius * mathSin4(startAngle);
    var xire = innerRadius * mathCos4(endAngle);
    var yire = innerRadius * mathSin4(endAngle);
    var hasArc = arc > e;
    if (hasArc) {
      var cornerRadius = shape.cornerRadius;
      if (cornerRadius) {
        _a2 = normalizeCornerRadius(cornerRadius), icrStart = _a2[0], icrEnd = _a2[1], ocrStart = _a2[2], ocrEnd = _a2[3];
      }
      var halfRd = mathAbs4(radius - innerRadius) / 2;
      ocrs = mathMin5(halfRd, ocrStart);
      ocre = mathMin5(halfRd, ocrEnd);
      icrs = mathMin5(halfRd, icrStart);
      icre = mathMin5(halfRd, icrEnd);
      limitedOcrMax = ocrMax = mathMax5(ocrs, ocre);
      limitedIcrMax = icrMax = mathMax5(icrs, icre);
      if (ocrMax > e || icrMax > e) {
        xre = radius * mathCos4(endAngle);
        yre = radius * mathSin4(endAngle);
        xirs = innerRadius * mathCos4(startAngle);
        yirs = innerRadius * mathSin4(startAngle);
        if (arc < PI4) {
          var it_1 = intersect(xrs, yrs, xirs, yirs, xre, yre, xire, yire);
          if (it_1) {
            var x0 = xrs - it_1[0];
            var y0 = yrs - it_1[1];
            var x1 = xre - it_1[0];
            var y1 = yre - it_1[1];
            var a = 1 / mathSin4(mathACos((x0 * x1 + y0 * y1) / (mathSqrt4(x0 * x0 + y0 * y0) * mathSqrt4(x1 * x1 + y1 * y1))) / 2);
            var b = mathSqrt4(it_1[0] * it_1[0] + it_1[1] * it_1[1]);
            limitedOcrMax = mathMin5(ocrMax, (radius - b) / (a + 1));
            limitedIcrMax = mathMin5(icrMax, (innerRadius - b) / (a - 1));
          }
        }
      }
    }
    if (!hasArc) {
      ctx.moveTo(cx + xrs, cy + yrs);
    } else if (limitedOcrMax > e) {
      var crStart = mathMin5(ocrStart, limitedOcrMax);
      var crEnd = mathMin5(ocrEnd, limitedOcrMax);
      var ct0 = computeCornerTangents(xirs, yirs, xrs, yrs, radius, crStart, clockwise);
      var ct1 = computeCornerTangents(xre, yre, xire, yire, radius, crEnd, clockwise);
      ctx.moveTo(cx + ct0.cx + ct0.x0, cy + ct0.cy + ct0.y0);
      if (limitedOcrMax < ocrMax && crStart === crEnd) {
        ctx.arc(cx + ct0.cx, cy + ct0.cy, limitedOcrMax, mathATan2(ct0.y0, ct0.x0), mathATan2(ct1.y0, ct1.x0), !clockwise);
      } else {
        crStart > 0 && ctx.arc(cx + ct0.cx, cy + ct0.cy, crStart, mathATan2(ct0.y0, ct0.x0), mathATan2(ct0.y1, ct0.x1), !clockwise);
        ctx.arc(cx, cy, radius, mathATan2(ct0.cy + ct0.y1, ct0.cx + ct0.x1), mathATan2(ct1.cy + ct1.y1, ct1.cx + ct1.x1), !clockwise);
        crEnd > 0 && ctx.arc(cx + ct1.cx, cy + ct1.cy, crEnd, mathATan2(ct1.y1, ct1.x1), mathATan2(ct1.y0, ct1.x0), !clockwise);
      }
    } else {
      ctx.moveTo(cx + xrs, cy + yrs);
      ctx.arc(cx, cy, radius, startAngle, endAngle, !clockwise);
    }
    if (!(innerRadius > e) || !hasArc) {
      ctx.lineTo(cx + xire, cy + yire);
    } else if (limitedIcrMax > e) {
      var crStart = mathMin5(icrStart, limitedIcrMax);
      var crEnd = mathMin5(icrEnd, limitedIcrMax);
      var ct0 = computeCornerTangents(xire, yire, xre, yre, innerRadius, -crEnd, clockwise);
      var ct1 = computeCornerTangents(xrs, yrs, xirs, yirs, innerRadius, -crStart, clockwise);
      ctx.lineTo(cx + ct0.cx + ct0.x0, cy + ct0.cy + ct0.y0);
      if (limitedIcrMax < icrMax && crStart === crEnd) {
        ctx.arc(cx + ct0.cx, cy + ct0.cy, limitedIcrMax, mathATan2(ct0.y0, ct0.x0), mathATan2(ct1.y0, ct1.x0), !clockwise);
      } else {
        crEnd > 0 && ctx.arc(cx + ct0.cx, cy + ct0.cy, crEnd, mathATan2(ct0.y0, ct0.x0), mathATan2(ct0.y1, ct0.x1), !clockwise);
        ctx.arc(cx, cy, innerRadius, mathATan2(ct0.cy + ct0.y1, ct0.cx + ct0.x1), mathATan2(ct1.cy + ct1.y1, ct1.cx + ct1.x1), clockwise);
        crStart > 0 && ctx.arc(cx + ct1.cx, cy + ct1.cy, crStart, mathATan2(ct1.y1, ct1.x1), mathATan2(ct1.y0, ct1.x0), !clockwise);
      }
    } else {
      ctx.lineTo(cx + xire, cy + yire);
      ctx.arc(cx, cy, innerRadius, endAngle, startAngle, clockwise);
    }
  }
  ctx.closePath();
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/graphic/shape/Sector.js
var SectorShape = /* @__PURE__ */ (function() {
  function SectorShape2() {
    this.cx = 0;
    this.cy = 0;
    this.r0 = 0;
    this.r = 0;
    this.startAngle = 0;
    this.endAngle = Math.PI * 2;
    this.clockwise = true;
    this.cornerRadius = 0;
  }
  return SectorShape2;
})();
var Sector = (function(_super) {
  __extends(Sector2, _super);
  function Sector2(opts) {
    return _super.call(this, opts) || this;
  }
  Sector2.prototype.getDefaultShape = function() {
    return new SectorShape();
  };
  Sector2.prototype.buildPath = function(ctx, shape) {
    buildPath2(ctx, shape);
  };
  Sector2.prototype.isZeroArea = function() {
    return this.shape.startAngle === this.shape.endAngle || this.shape.r === this.shape.r0;
  };
  return Sector2;
})(Path_default);
Sector.prototype.type = "sector";
var Sector_default = Sector;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/graphic/shape/Ring.js
var RingShape = /* @__PURE__ */ (function() {
  function RingShape2() {
    this.cx = 0;
    this.cy = 0;
    this.r = 0;
    this.r0 = 0;
  }
  return RingShape2;
})();
var Ring = (function(_super) {
  __extends(Ring2, _super);
  function Ring2(opts) {
    return _super.call(this, opts) || this;
  }
  Ring2.prototype.getDefaultShape = function() {
    return new RingShape();
  };
  Ring2.prototype.buildPath = function(ctx, shape) {
    var x = shape.cx;
    var y = shape.cy;
    var PI28 = Math.PI * 2;
    ctx.moveTo(x + shape.r, y);
    ctx.arc(x, y, shape.r, 0, PI28, false);
    ctx.moveTo(x + shape.r0, y);
    ctx.arc(x, y, shape.r0, 0, PI28, true);
  };
  return Ring2;
})(Path_default);
Ring.prototype.type = "ring";
var Ring_default = Ring;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/graphic/helper/smoothBezier.js
function smoothBezier(points2, smooth, isLoop, constraint) {
  var cps = [];
  var v = [];
  var v1 = [];
  var v2 = [];
  var prevPoint;
  var nextPoint;
  var min3;
  var max3;
  if (constraint) {
    min3 = [Infinity, Infinity];
    max3 = [-Infinity, -Infinity];
    for (var i = 0, len2 = points2.length; i < len2; i++) {
      min(min3, min3, points2[i]);
      max(max3, max3, points2[i]);
    }
    min(min3, min3, constraint[0]);
    max(max3, max3, constraint[1]);
  }
  for (var i = 0, len2 = points2.length; i < len2; i++) {
    var point = points2[i];
    if (isLoop) {
      prevPoint = points2[i ? i - 1 : len2 - 1];
      nextPoint = points2[(i + 1) % len2];
    } else {
      if (i === 0 || i === len2 - 1) {
        cps.push(clone2(points2[i]));
        continue;
      } else {
        prevPoint = points2[i - 1];
        nextPoint = points2[i + 1];
      }
    }
    sub(v, nextPoint, prevPoint);
    scale2(v, v, smooth);
    var d0 = distance(point, prevPoint);
    var d1 = distance(point, nextPoint);
    var sum = d0 + d1;
    if (sum !== 0) {
      d0 /= sum;
      d1 /= sum;
    }
    scale2(v1, v, -d0);
    scale2(v2, v, d1);
    var cp0 = add([], point, v1);
    var cp1 = add([], point, v2);
    if (constraint) {
      max(cp0, cp0, min3);
      min(cp0, cp0, max3);
      max(cp1, cp1, min3);
      min(cp1, cp1, max3);
    }
    cps.push(cp0);
    cps.push(cp1);
  }
  if (isLoop) {
    cps.push(cps.shift());
  }
  return cps;
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/graphic/helper/poly.js
function buildPath3(ctx, shape, closePath) {
  var smooth = shape.smooth;
  var points2 = shape.points;
  if (points2 && points2.length >= 2) {
    if (smooth) {
      var controlPoints = smoothBezier(points2, smooth, closePath, shape.smoothConstraint);
      ctx.moveTo(points2[0][0], points2[0][1]);
      var len2 = points2.length;
      for (var i = 0; i < (closePath ? len2 : len2 - 1); i++) {
        var cp1 = controlPoints[i * 2];
        var cp2 = controlPoints[i * 2 + 1];
        var p = points2[(i + 1) % len2];
        ctx.bezierCurveTo(cp1[0], cp1[1], cp2[0], cp2[1], p[0], p[1]);
      }
    } else {
      ctx.moveTo(points2[0][0], points2[0][1]);
      for (var i = 1, l = points2.length; i < l; i++) {
        ctx.lineTo(points2[i][0], points2[i][1]);
      }
    }
    closePath && ctx.closePath();
  }
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/graphic/shape/Polygon.js
var PolygonShape = /* @__PURE__ */ (function() {
  function PolygonShape2() {
    this.points = null;
    this.smooth = 0;
    this.smoothConstraint = null;
  }
  return PolygonShape2;
})();
var Polygon = (function(_super) {
  __extends(Polygon2, _super);
  function Polygon2(opts) {
    return _super.call(this, opts) || this;
  }
  Polygon2.prototype.getDefaultShape = function() {
    return new PolygonShape();
  };
  Polygon2.prototype.buildPath = function(ctx, shape) {
    buildPath3(ctx, shape, true);
  };
  return Polygon2;
})(Path_default);
Polygon.prototype.type = "polygon";
var Polygon_default = Polygon;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/graphic/shape/Polyline.js
var PolylineShape = /* @__PURE__ */ (function() {
  function PolylineShape2() {
    this.points = null;
    this.percent = 1;
    this.smooth = 0;
    this.smoothConstraint = null;
  }
  return PolylineShape2;
})();
var Polyline = (function(_super) {
  __extends(Polyline2, _super);
  function Polyline2(opts) {
    return _super.call(this, opts) || this;
  }
  Polyline2.prototype.getDefaultStyle = function() {
    return {
      stroke: "#000",
      fill: null
    };
  };
  Polyline2.prototype.getDefaultShape = function() {
    return new PolylineShape();
  };
  Polyline2.prototype.buildPath = function(ctx, shape) {
    buildPath3(ctx, shape, false);
  };
  return Polyline2;
})(Path_default);
Polyline.prototype.type = "polyline";
var Polyline_default = Polyline;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/graphic/shape/Line.js
var subPixelOptimizeOutputShape2 = {};
var LineShape = /* @__PURE__ */ (function() {
  function LineShape2() {
    this.x1 = 0;
    this.y1 = 0;
    this.x2 = 0;
    this.y2 = 0;
    this.percent = 1;
  }
  return LineShape2;
})();
var Line = (function(_super) {
  __extends(Line2, _super);
  function Line2(opts) {
    return _super.call(this, opts) || this;
  }
  Line2.prototype.getDefaultStyle = function() {
    return {
      stroke: "#000",
      fill: null
    };
  };
  Line2.prototype.getDefaultShape = function() {
    return new LineShape();
  };
  Line2.prototype.buildPath = function(ctx, shape) {
    var x1;
    var y1;
    var x2;
    var y2;
    if (this.subPixelOptimize) {
      var optimizedShape = subPixelOptimizeLine(subPixelOptimizeOutputShape2, shape, this.style);
      x1 = optimizedShape.x1;
      y1 = optimizedShape.y1;
      x2 = optimizedShape.x2;
      y2 = optimizedShape.y2;
    } else {
      x1 = shape.x1;
      y1 = shape.y1;
      x2 = shape.x2;
      y2 = shape.y2;
    }
    var percent = shape.percent;
    if (percent === 0) {
      return;
    }
    ctx.moveTo(x1, y1);
    if (percent < 1) {
      x2 = x1 * (1 - percent) + x2 * percent;
      y2 = y1 * (1 - percent) + y2 * percent;
    }
    ctx.lineTo(x2, y2);
  };
  Line2.prototype.pointAt = function(p) {
    var shape = this.shape;
    return [
      shape.x1 * (1 - p) + shape.x2 * p,
      shape.y1 * (1 - p) + shape.y2 * p
    ];
  };
  return Line2;
})(Path_default);
Line.prototype.type = "line";
var Line_default = Line;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/graphic/shape/BezierCurve.js
var out = [];
var BezierCurveShape = /* @__PURE__ */ (function() {
  function BezierCurveShape2() {
    this.x1 = 0;
    this.y1 = 0;
    this.x2 = 0;
    this.y2 = 0;
    this.cpx1 = 0;
    this.cpy1 = 0;
    this.percent = 1;
  }
  return BezierCurveShape2;
})();
function someVectorAt(shape, t, isTangent) {
  var cpx2 = shape.cpx2;
  var cpy2 = shape.cpy2;
  if (cpx2 != null || cpy2 != null) {
    return [
      (isTangent ? cubicDerivativeAt : cubicAt)(shape.x1, shape.cpx1, shape.cpx2, shape.x2, t),
      (isTangent ? cubicDerivativeAt : cubicAt)(shape.y1, shape.cpy1, shape.cpy2, shape.y2, t)
    ];
  } else {
    return [
      (isTangent ? quadraticDerivativeAt : quadraticAt)(shape.x1, shape.cpx1, shape.x2, t),
      (isTangent ? quadraticDerivativeAt : quadraticAt)(shape.y1, shape.cpy1, shape.y2, t)
    ];
  }
}
var BezierCurve = (function(_super) {
  __extends(BezierCurve2, _super);
  function BezierCurve2(opts) {
    return _super.call(this, opts) || this;
  }
  BezierCurve2.prototype.getDefaultStyle = function() {
    return {
      stroke: "#000",
      fill: null
    };
  };
  BezierCurve2.prototype.getDefaultShape = function() {
    return new BezierCurveShape();
  };
  BezierCurve2.prototype.buildPath = function(ctx, shape) {
    var x1 = shape.x1;
    var y1 = shape.y1;
    var x2 = shape.x2;
    var y2 = shape.y2;
    var cpx1 = shape.cpx1;
    var cpy1 = shape.cpy1;
    var cpx2 = shape.cpx2;
    var cpy2 = shape.cpy2;
    var percent = shape.percent;
    if (percent === 0) {
      return;
    }
    ctx.moveTo(x1, y1);
    if (cpx2 == null || cpy2 == null) {
      if (percent < 1) {
        quadraticSubdivide(x1, cpx1, x2, percent, out);
        cpx1 = out[1];
        x2 = out[2];
        quadraticSubdivide(y1, cpy1, y2, percent, out);
        cpy1 = out[1];
        y2 = out[2];
      }
      ctx.quadraticCurveTo(cpx1, cpy1, x2, y2);
    } else {
      if (percent < 1) {
        cubicSubdivide(x1, cpx1, cpx2, x2, percent, out);
        cpx1 = out[1];
        cpx2 = out[2];
        x2 = out[3];
        cubicSubdivide(y1, cpy1, cpy2, y2, percent, out);
        cpy1 = out[1];
        cpy2 = out[2];
        y2 = out[3];
      }
      ctx.bezierCurveTo(cpx1, cpy1, cpx2, cpy2, x2, y2);
    }
  };
  BezierCurve2.prototype.pointAt = function(t) {
    return someVectorAt(this.shape, t, false);
  };
  BezierCurve2.prototype.tangentAt = function(t) {
    var p = someVectorAt(this.shape, t, true);
    return normalize(p, p);
  };
  return BezierCurve2;
})(Path_default);
BezierCurve.prototype.type = "bezier-curve";
var BezierCurve_default = BezierCurve;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/graphic/shape/Arc.js
var ArcShape = /* @__PURE__ */ (function() {
  function ArcShape2() {
    this.cx = 0;
    this.cy = 0;
    this.r = 0;
    this.startAngle = 0;
    this.endAngle = Math.PI * 2;
    this.clockwise = true;
  }
  return ArcShape2;
})();
var Arc = (function(_super) {
  __extends(Arc2, _super);
  function Arc2(opts) {
    return _super.call(this, opts) || this;
  }
  Arc2.prototype.getDefaultStyle = function() {
    return {
      stroke: "#000",
      fill: null
    };
  };
  Arc2.prototype.getDefaultShape = function() {
    return new ArcShape();
  };
  Arc2.prototype.buildPath = function(ctx, shape) {
    var x = shape.cx;
    var y = shape.cy;
    var r = Math.max(shape.r, 0);
    var startAngle = shape.startAngle;
    var endAngle = shape.endAngle;
    var clockwise = shape.clockwise;
    var unitX = Math.cos(startAngle);
    var unitY = Math.sin(startAngle);
    ctx.moveTo(unitX * r + x, unitY * r + y);
    ctx.arc(x, y, r, startAngle, endAngle, !clockwise);
  };
  return Arc2;
})(Path_default);
Arc.prototype.type = "arc";
var Arc_default = Arc;

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/core/OrientedBoundingRect.js
var mathMin6 = Math.min;
var mathMax6 = Math.max;
var mathAbs5 = Math.abs;
var _extent = [0, 0];
var _extent2 = [0, 0];
var _intersectCtx2 = createIntersectContext();
var _minTv2 = _intersectCtx2.minTv;
var _maxTv2 = _intersectCtx2.maxTv;
var OrientedBoundingRect = (function() {
  function OrientedBoundingRect2(rect, transform) {
    this._corners = [];
    this._axes = [];
    this._origin = [0, 0];
    for (var i = 0; i < 4; i++) {
      this._corners[i] = new Point_default();
    }
    for (var i = 0; i < 2; i++) {
      this._axes[i] = new Point_default();
    }
    if (rect) {
      this.fromBoundingRect(rect, transform);
    }
  }
  OrientedBoundingRect2.prototype.fromBoundingRect = function(rect, transform) {
    var corners = this._corners;
    var axes = this._axes;
    var x = rect.x;
    var y = rect.y;
    var x2 = x + rect.width;
    var y2 = y + rect.height;
    corners[0].set(x, y);
    corners[1].set(x2, y);
    corners[2].set(x2, y2);
    corners[3].set(x, y2);
    if (transform) {
      for (var i = 0; i < 4; i++) {
        corners[i].transform(transform);
      }
    }
    Point_default.sub(axes[0], corners[1], corners[0]);
    Point_default.sub(axes[1], corners[3], corners[0]);
    axes[0].normalize();
    axes[1].normalize();
    for (var i = 0; i < 2; i++) {
      this._origin[i] = axes[i].dot(corners[0]);
    }
  };
  OrientedBoundingRect2.prototype.intersect = function(other, mtv, opt) {
    var overlapped = true;
    var noMtv = !mtv;
    if (mtv) {
      Point_default.set(mtv, 0, 0);
    }
    _intersectCtx2.reset(opt, !noMtv);
    if (!this._intersectCheckOneSide(this, other, noMtv, 1)) {
      overlapped = false;
      if (noMtv) {
        return overlapped;
      }
    }
    if (!this._intersectCheckOneSide(other, this, noMtv, -1)) {
      overlapped = false;
      if (noMtv) {
        return overlapped;
      }
    }
    if (!noMtv && !_intersectCtx2.negativeSize) {
      Point_default.copy(mtv, overlapped ? _intersectCtx2.useDir ? _intersectCtx2.dirMinTv : _minTv2 : _maxTv2);
    }
    return overlapped;
  };
  OrientedBoundingRect2.prototype._intersectCheckOneSide = function(self2, other, noMtv, inverse) {
    var overlapped = true;
    for (var i = 0; i < 2; i++) {
      var axis = self2._axes[i];
      self2._getProjMinMaxOnAxis(i, self2._corners, _extent);
      self2._getProjMinMaxOnAxis(i, other._corners, _extent2);
      if (_intersectCtx2.negativeSize || _extent[1] < _extent2[0] || _extent[0] > _extent2[1]) {
        overlapped = false;
        if (_intersectCtx2.negativeSize || noMtv) {
          return overlapped;
        }
        var dist0 = mathAbs5(_extent2[0] - _extent[1]);
        var dist1 = mathAbs5(_extent[0] - _extent2[1]);
        if (mathMin6(dist0, dist1) > _maxTv2.len()) {
          if (dist0 < dist1) {
            Point_default.scale(_maxTv2, axis, -dist0 * inverse);
          } else {
            Point_default.scale(_maxTv2, axis, dist1 * inverse);
          }
        }
      } else if (!noMtv) {
        var dist0 = mathAbs5(_extent2[0] - _extent[1]);
        var dist1 = mathAbs5(_extent[0] - _extent2[1]);
        if (_intersectCtx2.useDir || mathMin6(dist0, dist1) < _minTv2.len()) {
          if (dist0 < dist1 || !_intersectCtx2.bidirectional) {
            Point_default.scale(_minTv2, axis, dist0 * inverse);
            if (_intersectCtx2.useDir) {
              _intersectCtx2.calcDirMTV();
            }
          }
          if (dist0 >= dist1 || !_intersectCtx2.bidirectional) {
            Point_default.scale(_minTv2, axis, -dist1 * inverse);
            if (_intersectCtx2.useDir) {
              _intersectCtx2.calcDirMTV();
            }
          }
        }
      }
    }
    return overlapped;
  };
  OrientedBoundingRect2.prototype._getProjMinMaxOnAxis = function(dim, corners, out2) {
    var axis = this._axes[dim];
    var origin = this._origin;
    var proj = corners[0].dot(axis) + origin[dim];
    var min3 = proj;
    var max3 = proj;
    for (var i = 1; i < corners.length; i++) {
      var proj_1 = corners[i].dot(axis) + origin[dim];
      min3 = mathMin6(proj_1, min3);
      max3 = mathMax6(proj_1, max3);
    }
    out2[0] = min3 + _intersectCtx2.touchThreshold;
    out2[1] = max3 - _intersectCtx2.touchThreshold;
    _intersectCtx2.negativeSize = out2[1] < out2[0];
  };
  return OrientedBoundingRect2;
})();
var OrientedBoundingRect_default = OrientedBoundingRect;

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/animation/basicTransition.js
var transitionStore = makeInner();
function getAnimationConfig(animationType, animatableModel, dataIndex, extraOpts, extraDelayParams) {
  var animationPayload;
  if (animatableModel && animatableModel.ecModel) {
    var updatePayload = animatableModel.ecModel.getUpdatePayload();
    animationPayload = updatePayload && updatePayload.animation;
  }
  var animationEnabled = animatableModel && animatableModel.isAnimationEnabled();
  var isUpdate = animationType === "update";
  if (animationEnabled) {
    var duration = void 0;
    var easing = void 0;
    var delay = void 0;
    if (extraOpts) {
      duration = retrieve2(extraOpts.duration, 200);
      easing = retrieve2(extraOpts.easing, "cubicOut");
      delay = 0;
    } else {
      duration = animatableModel.getShallow(isUpdate ? "animationDurationUpdate" : "animationDuration");
      easing = animatableModel.getShallow(isUpdate ? "animationEasingUpdate" : "animationEasing");
      delay = animatableModel.getShallow(isUpdate ? "animationDelayUpdate" : "animationDelay");
    }
    if (animationPayload) {
      animationPayload.duration != null && (duration = animationPayload.duration);
      animationPayload.easing != null && (easing = animationPayload.easing);
      animationPayload.delay != null && (delay = animationPayload.delay);
    }
    if (isFunction(delay)) {
      delay = delay(dataIndex, extraDelayParams);
    }
    if (isFunction(duration)) {
      duration = duration(dataIndex);
    }
    var config = {
      duration: duration || 0,
      delay,
      easing
    };
    return config;
  } else {
    return null;
  }
}
function animateOrSetProps(animationType, el, props, animatableModel, dataIndex, cb, during) {
  var isFrom = false;
  var removeOpt;
  if (isFunction(dataIndex)) {
    during = cb;
    cb = dataIndex;
    dataIndex = null;
  } else if (isObject(dataIndex)) {
    cb = dataIndex.cb;
    during = dataIndex.during;
    isFrom = dataIndex.isFrom;
    removeOpt = dataIndex.removeOpt;
    dataIndex = dataIndex.dataIndex;
  }
  var isRemove = animationType === "leave";
  if (!isRemove) {
    el.stopAnimation("leave");
  }
  var animationConfig = getAnimationConfig(animationType, animatableModel, dataIndex, isRemove ? removeOpt || {} : null, animatableModel && animatableModel.getAnimationDelayParams ? animatableModel.getAnimationDelayParams(el, dataIndex) : null);
  if (animationConfig && animationConfig.duration > 0) {
    var duration = animationConfig.duration;
    var animationDelay = animationConfig.delay;
    var animationEasing = animationConfig.easing;
    var animateConfig = {
      duration,
      delay: animationDelay || 0,
      easing: animationEasing,
      done: cb,
      force: !!cb || !!during,
      // Set to final state in update/init animation.
      // So the post processing based on the path shape can be done correctly.
      setToFinal: !isRemove,
      scope: animationType,
      during
    };
    isFrom ? el.animateFrom(props, animateConfig) : el.animateTo(props, animateConfig);
  } else {
    el.stopAnimation();
    !isFrom && el.attr(props);
    during && during(1);
    cb && cb();
  }
}
function updateProps(el, props, animatableModel, dataIndex, cb, during) {
  animateOrSetProps("update", el, props, animatableModel, dataIndex, cb, during);
}
function initProps(el, props, animatableModel, dataIndex, cb, during) {
  animateOrSetProps("enter", el, props, animatableModel, dataIndex, cb, during);
}
function isElementRemoved(el) {
  if (!el.__zr) {
    return true;
  }
  for (var i = 0; i < el.animators.length; i++) {
    var animator = el.animators[i];
    if (animator.scope === "leave") {
      return true;
    }
  }
  return false;
}
function getOldStyle(el) {
  return transitionStore(el).oldStyle;
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/util/graphic.js
var _customShapeMap = {};
var XY2 = ["x", "y"];
var WH2 = ["width", "height"];
function registerShape(name, ShapeClass) {
  _customShapeMap[name] = ShapeClass;
}
function makePath(pathData, opts, rect, layout2) {
  var path = createFromString(pathData, opts);
  if (rect) {
    if (layout2 === "center") {
      rect = centerGraphic(rect, path.getBoundingRect());
    }
    resizePath(path, rect);
  }
  return path;
}
function makeImage(imageUrl, rect, layout2) {
  var zrImg = new Image_default({
    style: {
      image: imageUrl,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    },
    onload: function(img) {
      if (layout2 === "center") {
        var boundingRect = {
          width: img.width,
          height: img.height
        };
        zrImg.setStyle(centerGraphic(rect, boundingRect));
      }
    }
  });
  return zrImg;
}
function centerGraphic(rect, boundingRect) {
  var aspect = boundingRect.width / boundingRect.height;
  var width = rect.height * aspect;
  var height;
  if (width <= rect.width) {
    height = rect.height;
  } else {
    width = rect.width;
    height = width / aspect;
  }
  var cx = rect.x + rect.width / 2;
  var cy = rect.y + rect.height / 2;
  return {
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height
  };
}
function resizePath(path, rect) {
  if (!path.applyTransform) {
    return;
  }
  var pathRect = path.getBoundingRect();
  var m = pathRect.calculateTransform(rect);
  path.applyTransform(m);
}
function subPixelOptimizeLine2(shape, lineWidth) {
  subPixelOptimizeLine(shape, shape, {
    lineWidth
  });
  return shape;
}
function expandOrShrinkRect(rect, delta, shrinkOrExpand, noNegative, minSize) {
  if (delta == null) {
    return rect;
  } else if (isNumber(delta)) {
    _tmpExpandRectDelta[0] = _tmpExpandRectDelta[1] = _tmpExpandRectDelta[2] = _tmpExpandRectDelta[3] = delta;
  } else {
    if (false) {
      assert(delta.length === 4);
    }
    _tmpExpandRectDelta[0] = delta[0];
    _tmpExpandRectDelta[1] = delta[1];
    _tmpExpandRectDelta[2] = delta[2];
    _tmpExpandRectDelta[3] = delta[3];
  }
  if (noNegative) {
    _tmpExpandRectDelta[0] = mathMax(0, _tmpExpandRectDelta[0]);
    _tmpExpandRectDelta[1] = mathMax(0, _tmpExpandRectDelta[1]);
    _tmpExpandRectDelta[2] = mathMax(0, _tmpExpandRectDelta[2]);
    _tmpExpandRectDelta[3] = mathMax(0, _tmpExpandRectDelta[3]);
  }
  if (shrinkOrExpand) {
    _tmpExpandRectDelta[0] = -_tmpExpandRectDelta[0];
    _tmpExpandRectDelta[1] = -_tmpExpandRectDelta[1];
    _tmpExpandRectDelta[2] = -_tmpExpandRectDelta[2];
    _tmpExpandRectDelta[3] = -_tmpExpandRectDelta[3];
  }
  expandRectOnOneDimension(rect, _tmpExpandRectDelta, "x", "width", 3, 1, minSize && minSize[0] || 0);
  expandRectOnOneDimension(rect, _tmpExpandRectDelta, "y", "height", 0, 2, minSize && minSize[1] || 0);
  return rect;
}
var _tmpExpandRectDelta = [0, 0, 0, 0];
function expandRectOnOneDimension(rect, delta, xy, wh, ltIdx, rbIdx, minSize) {
  var deltaSum = delta[rbIdx] + delta[ltIdx];
  var oldSize = rect[wh];
  rect[wh] += deltaSum;
  minSize = mathMax(0, mathMin(minSize, oldSize));
  if (rect[wh] < minSize) {
    rect[wh] = minSize;
    rect[xy] += delta[ltIdx] >= 0 ? -delta[ltIdx] : delta[rbIdx] >= 0 ? oldSize + delta[rbIdx] : mathAbs(deltaSum) > 1e-8 ? (oldSize - minSize) * delta[ltIdx] / deltaSum : 0;
  } else {
    rect[xy] -= delta[ltIdx];
  }
}
function setTooltipConfig(opt) {
  var itemTooltipOption = opt.itemTooltipOption;
  var componentModel = opt.componentModel;
  var itemName = opt.itemName;
  var itemTooltipOptionObj = isString(itemTooltipOption) ? {
    formatter: itemTooltipOption
  } : itemTooltipOption;
  var mainType = componentModel.mainType;
  var componentIndex = componentModel.componentIndex;
  var formatterParams = {
    componentType: mainType,
    name: itemName,
    $vars: ["name"]
  };
  formatterParams[mainType + "Index"] = componentIndex;
  var formatterParamsExtra = opt.formatterParamsExtra;
  if (formatterParamsExtra) {
    each(keys(formatterParamsExtra), function(key2) {
      if (!hasOwn(formatterParams, key2)) {
        formatterParams[key2] = formatterParamsExtra[key2];
        formatterParams.$vars.push(key2);
      }
    });
  }
  var ecData = getECData(opt.el);
  ecData.componentMainType = mainType;
  ecData.componentIndex = componentIndex;
  ecData.tooltipConfig = {
    name: itemName,
    option: defaults({
      content: itemName,
      encodeHTMLContent: true,
      formatterParams
    }, itemTooltipOptionObj)
  };
}
function isBoundingRectAxisAligned(transform) {
  return !transform || mathAbs(transform[1]) < AXIS_ALIGN_EPSILON && mathAbs(transform[2]) < AXIS_ALIGN_EPSILON || mathAbs(transform[0]) < AXIS_ALIGN_EPSILON && mathAbs(transform[3]) < AXIS_ALIGN_EPSILON;
}
var AXIS_ALIGN_EPSILON = 1e-5;
function ensureCopyRect(target, source) {
  return target ? BoundingRect_default.copy(target, source) : source.clone();
}
function ensureCopyTransform(target, source) {
  return source ? copy(target || create(), source) : void 0;
}
var tmpDTR = new Transformable_default();
tmpDTR.transform = create();
registerShape("circle", Circle_default);
registerShape("ellipse", Ellipse_default);
registerShape("sector", Sector_default);
registerShape("ring", Ring_default);
registerShape("polygon", Polygon_default);
registerShape("polyline", Polyline_default);
registerShape("rect", Rect_default);
registerShape("line", Line_default);
registerShape("bezierCurve", BezierCurve_default);
registerShape("arc", Arc_default);

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/label/labelStyle.js
var EMPTY_OBJ = {};
function setLabelText(label, labelTexts) {
  for (var i = 0; i < SPECIAL_STATES.length; i++) {
    var stateName = SPECIAL_STATES[i];
    var text = labelTexts[stateName];
    var state = label.ensureState(stateName);
    state.style = state.style || {};
    state.style.text = text;
  }
  var oldStates = label.currentStates.slice();
  label.clearStates(true);
  label.setStyle({
    text: labelTexts.normal
  });
  label.useStates(oldStates, true);
}
function getLabelText(opt, stateModels, interpolatedValue) {
  var labelFetcher = opt.labelFetcher;
  var labelDataIndex = opt.labelDataIndex;
  var labelDimIndex = opt.labelDimIndex;
  var normalModel = stateModels.normal;
  var baseText;
  if (labelFetcher) {
    baseText = labelFetcher.getFormattedLabel(labelDataIndex, "normal", null, labelDimIndex, normalModel && normalModel.get("formatter"), interpolatedValue != null ? {
      interpolatedValue
    } : null);
  }
  if (baseText == null) {
    baseText = isFunction(opt.defaultText) ? opt.defaultText(labelDataIndex, opt, interpolatedValue) : opt.defaultText;
  }
  var statesText = {
    normal: baseText
  };
  for (var i = 0; i < SPECIAL_STATES.length; i++) {
    var stateName = SPECIAL_STATES[i];
    var stateModel = stateModels[stateName];
    statesText[stateName] = retrieve2(labelFetcher ? labelFetcher.getFormattedLabel(labelDataIndex, stateName, null, labelDimIndex, stateModel && stateModel.get("formatter")) : null, baseText);
  }
  return statesText;
}
function createTextStyle(textStyleModel, specifiedTextStyle, opt, isNotNormal, isAttached) {
  var textStyle = {};
  setTextStyleCommon(textStyle, textStyleModel, opt, isNotNormal, isAttached);
  specifiedTextStyle && extend(textStyle, specifiedTextStyle);
  return textStyle;
}
function setTextStyleCommon(textStyle, textStyleModel, opt, isNotNormal, isAttached) {
  opt = opt || EMPTY_OBJ;
  var ecModel = textStyleModel.ecModel;
  var globalTextStyle = ecModel && ecModel.option.textStyle;
  var richItemNames = getRichItemNames(textStyleModel);
  var richResult;
  if (richItemNames) {
    richResult = {};
    var richInheritPlainLabelOptionName = "richInheritPlainLabel";
    var richInheritPlainLabel = retrieve2(textStyleModel.get(richInheritPlainLabelOptionName), ecModel ? ecModel.get(richInheritPlainLabelOptionName) : void 0);
    for (var name_1 in richItemNames) {
      if (richItemNames.hasOwnProperty(name_1)) {
        var richTextStyle = textStyleModel.getModel(["rich", name_1]);
        setTokenTextStyle(richResult[name_1] = {}, richTextStyle, globalTextStyle, textStyleModel, richInheritPlainLabel, opt, isNotNormal, isAttached, false, true);
      }
    }
  }
  if (richResult) {
    textStyle.rich = richResult;
  }
  var overflow = textStyleModel.get("overflow");
  if (overflow) {
    textStyle.overflow = overflow;
  }
  var lineOverflow = textStyleModel.get("lineOverflow");
  if (lineOverflow) {
    textStyle.lineOverflow = lineOverflow;
  }
  var labelTextStyle = textStyle;
  var minMargin = textStyleModel.get("minMargin");
  if (minMargin != null) {
    minMargin = !isNumber(minMargin) ? 0 : minMargin / 2;
    labelTextStyle.margin = [minMargin, minMargin, minMargin, minMargin];
    labelTextStyle.__marginType = LabelMarginType.minMargin;
  } else {
    var textMargin = textStyleModel.get("textMargin");
    if (textMargin != null) {
      labelTextStyle.margin = normalizeCssArray(textMargin);
      labelTextStyle.__marginType = LabelMarginType.textMargin;
    }
  }
  setTokenTextStyle(textStyle, textStyleModel, globalTextStyle, null, null, opt, isNotNormal, isAttached, true, false);
}
function getRichItemNames(textStyleModel) {
  var richItemNameMap;
  while (textStyleModel && textStyleModel !== textStyleModel.ecModel) {
    var rich = (textStyleModel.option || EMPTY_OBJ).rich;
    if (rich) {
      richItemNameMap = richItemNameMap || {};
      var richKeys = keys(rich);
      for (var i = 0; i < richKeys.length; i++) {
        var richKey = richKeys[i];
        richItemNameMap[richKey] = 1;
      }
    }
    textStyleModel = textStyleModel.parentModel;
  }
  return richItemNameMap;
}
var TEXT_PROPS_WITH_GLOBAL = ["fontStyle", "fontWeight", "fontSize", "fontFamily", "textShadowColor", "textShadowBlur", "textShadowOffsetX", "textShadowOffsetY"];
var TEXT_PROPS_SELF = ["align", "lineHeight", "width", "height", "tag", "verticalAlign", "ellipsis"];
var TEXT_PROPS_BOX = ["padding", "borderWidth", "borderRadius", "borderDashOffset", "backgroundColor", "borderColor", "shadowColor", "shadowBlur", "shadowOffsetX", "shadowOffsetY"];
function setTokenTextStyle(textStyle, textStyleModel, globalTextStyle, plainTextModel, richInheritPlainLabel, opt, isNotNormal, isAttached, isBlock, inRich) {
  globalTextStyle = !isNotNormal && globalTextStyle || EMPTY_OBJ;
  var inheritColor = opt && opt.inheritColor;
  var fillColor = textStyleModel.getShallow("color");
  var strokeColor = textStyleModel.getShallow("textBorderColor");
  var opacity = retrieve2(textStyleModel.getShallow("opacity"), globalTextStyle.opacity);
  if (fillColor === "inherit" || fillColor === "auto") {
    if (false) {
      if (fillColor === "auto") {
        deprecateReplaceLog("color: 'auto'", "color: 'inherit'");
      }
    }
    if (inheritColor) {
      fillColor = inheritColor;
    } else {
      fillColor = null;
    }
  }
  if (strokeColor === "inherit" || strokeColor === "auto") {
    if (false) {
      if (strokeColor === "auto") {
        deprecateReplaceLog("color: 'auto'", "color: 'inherit'");
      }
    }
    if (inheritColor) {
      strokeColor = inheritColor;
    } else {
      strokeColor = null;
    }
  }
  if (!isAttached) {
    fillColor = fillColor || globalTextStyle.color;
    strokeColor = strokeColor || globalTextStyle.textBorderColor;
  }
  if (fillColor != null) {
    textStyle.fill = fillColor;
  }
  if (strokeColor != null) {
    textStyle.stroke = strokeColor;
  }
  var textBorderWidth = retrieve2(textStyleModel.getShallow("textBorderWidth"), globalTextStyle.textBorderWidth);
  if (textBorderWidth != null) {
    textStyle.lineWidth = textBorderWidth;
  }
  var textBorderType = retrieve2(textStyleModel.getShallow("textBorderType"), globalTextStyle.textBorderType);
  if (textBorderType != null) {
    textStyle.lineDash = textBorderType;
  }
  var textBorderDashOffset = retrieve2(textStyleModel.getShallow("textBorderDashOffset"), globalTextStyle.textBorderDashOffset);
  if (textBorderDashOffset != null) {
    textStyle.lineDashOffset = textBorderDashOffset;
  }
  if (!isNotNormal && opacity == null && !inRich) {
    opacity = opt && opt.defaultOpacity;
  }
  if (opacity != null) {
    textStyle.opacity = opacity;
  }
  if (!isNotNormal && !isAttached) {
    if (textStyle.fill == null && opt.inheritColor) {
      textStyle.fill = opt.inheritColor;
    }
  }
  for (var i = 0; i < TEXT_PROPS_WITH_GLOBAL.length; i++) {
    var key2 = TEXT_PROPS_WITH_GLOBAL[i];
    var val = richInheritPlainLabel !== false && plainTextModel ? retrieve3(textStyleModel.getShallow(key2), plainTextModel.getShallow(key2), globalTextStyle[key2]) : retrieve2(textStyleModel.getShallow(key2), globalTextStyle[key2]);
    if (val != null) {
      textStyle[key2] = val;
    }
  }
  for (var i = 0; i < TEXT_PROPS_SELF.length; i++) {
    var key2 = TEXT_PROPS_SELF[i];
    var val = textStyleModel.getShallow(key2);
    if (val != null) {
      textStyle[key2] = val;
    }
  }
  if (textStyle.verticalAlign == null) {
    var baseline = textStyleModel.getShallow("baseline");
    if (baseline != null) {
      textStyle.verticalAlign = baseline;
    }
  }
  if (!isBlock || !opt.disableBox) {
    for (var i = 0; i < TEXT_PROPS_BOX.length; i++) {
      var key2 = TEXT_PROPS_BOX[i];
      var val = textStyleModel.getShallow(key2);
      if (val != null) {
        textStyle[key2] = val;
      }
    }
    var borderType = textStyleModel.getShallow("borderType");
    if (borderType != null) {
      textStyle.borderDash = borderType;
    }
    if ((textStyle.backgroundColor === "auto" || textStyle.backgroundColor === "inherit") && inheritColor) {
      if (false) {
        if (textStyle.backgroundColor === "auto") {
          deprecateReplaceLog("backgroundColor: 'auto'", "backgroundColor: 'inherit'");
        }
      }
      textStyle.backgroundColor = inheritColor;
    }
    if ((textStyle.borderColor === "auto" || textStyle.borderColor === "inherit") && inheritColor) {
      if (false) {
        if (textStyle.borderColor === "auto") {
          deprecateReplaceLog("borderColor: 'auto'", "borderColor: 'inherit'");
        }
      }
      textStyle.borderColor = inheritColor;
    }
  }
}
function getFont(opt, ecModel) {
  var gTextStyleModel = ecModel && ecModel.getModel("textStyle");
  return trim([
    // FIXME in node-canvas fontWeight is before fontStyle
    opt.fontStyle || gTextStyleModel && gTextStyleModel.getShallow("fontStyle") || "",
    opt.fontWeight || gTextStyleModel && gTextStyleModel.getShallow("fontWeight") || "",
    (opt.fontSize || gTextStyleModel && gTextStyleModel.getShallow("fontSize") || 12) + "px",
    opt.fontFamily || gTextStyleModel && gTextStyleModel.getShallow("fontFamily") || "sans-serif"
  ].join(" "));
}
var labelInner = makeInner();
function animateLabelValue(textEl, dataIndex, data, animatableModel, labelFetcher) {
  var labelInnerStore = labelInner(textEl);
  if (!labelInnerStore.valueAnimation || labelInnerStore.prevValue === labelInnerStore.value) {
    return;
  }
  var defaultInterpolatedText = labelInnerStore.defaultInterpolatedText;
  var currValue = retrieve2(labelInnerStore.interpolatedValue, labelInnerStore.prevValue);
  var targetValue = labelInnerStore.value;
  function during(percent) {
    var interpolated = interpolateRawValues(data, labelInnerStore.precision, currValue, targetValue, percent);
    labelInnerStore.interpolatedValue = percent === 1 ? null : interpolated;
    var labelText = getLabelText({
      labelDataIndex: dataIndex,
      labelFetcher,
      defaultText: defaultInterpolatedText ? defaultInterpolatedText(interpolated) : interpolated + ""
    }, labelInnerStore.statesModels, interpolated);
    setLabelText(textEl, labelText);
  }
  textEl.percent = 0;
  (labelInnerStore.prevValue == null ? initProps : updateProps)(textEl, {
    // percent is used to prevent animation from being aborted #15916
    percent: 1
  }, animatableModel, dataIndex, null, during);
}
var LabelMarginType = {
  minMargin: 1,
  textMargin: 2
};

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/model/mixin/textStyle.js
var PATH_COLOR = ["textStyle", "color"];
var textStyleParams = ["fontStyle", "fontWeight", "fontSize", "fontFamily", "padding", "lineHeight", "rich", "width", "height", "overflow"];
var tmpText = new Text_default();
var TextStyleMixin = (
  /** @class */
  (function() {
    function TextStyleMixin2() {
    }
    TextStyleMixin2.prototype.getTextColor = function(isEmphasis) {
      var ecModel = this.ecModel;
      return this.getShallow("color") || (!isEmphasis && ecModel ? ecModel.get(PATH_COLOR) : null);
    };
    TextStyleMixin2.prototype.getFont = function() {
      return getFont({
        fontStyle: this.getShallow("fontStyle"),
        fontWeight: this.getShallow("fontWeight"),
        fontSize: this.getShallow("fontSize"),
        fontFamily: this.getShallow("fontFamily")
      }, this.ecModel);
    };
    TextStyleMixin2.prototype.getTextRect = function(text) {
      var style = {
        text,
        verticalAlign: this.getShallow("verticalAlign") || this.getShallow("baseline")
      };
      for (var i = 0; i < textStyleParams.length; i++) {
        style[textStyleParams[i]] = this.getShallow(textStyleParams[i]);
      }
      tmpText.useStyle(style);
      tmpText.update();
      return tmpText.getBoundingRect();
    };
    return TextStyleMixin2;
  })()
);
var textStyle_default = TextStyleMixin;

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/model/mixin/lineStyle.js
var LINE_STYLE_KEY_MAP = [
  ["lineWidth", "width"],
  ["stroke", "color"],
  ["opacity"],
  ["shadowBlur"],
  ["shadowOffsetX"],
  ["shadowOffsetY"],
  ["shadowColor"],
  ["lineDash", "type"],
  ["lineDashOffset", "dashOffset"],
  ["lineCap", "cap"],
  ["lineJoin", "join"],
  ["miterLimit"]
  // Option decal is in `DecalObject` but style.decal is in `PatternObject`.
  // So do not transfer decal directly.
];
var getLineStyle = makeStyleMapper(LINE_STYLE_KEY_MAP);
var LineStyleMixin = (
  /** @class */
  (function() {
    function LineStyleMixin2() {
    }
    LineStyleMixin2.prototype.getLineStyle = function(excludes) {
      return getLineStyle(this, excludes);
    };
    return LineStyleMixin2;
  })()
);

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/model/mixin/itemStyle.js
var ITEM_STYLE_KEY_MAP = [
  ["fill", "color"],
  ["stroke", "borderColor"],
  ["lineWidth", "borderWidth"],
  ["opacity"],
  ["shadowBlur"],
  ["shadowOffsetX"],
  ["shadowOffsetY"],
  ["shadowColor"],
  ["lineDash", "borderType"],
  ["lineDashOffset", "borderDashOffset"],
  ["lineCap", "borderCap"],
  ["lineJoin", "borderJoin"],
  ["miterLimit", "borderMiterLimit"]
  // Option decal is in `DecalObject` but style.decal is in `PatternObject`.
  // So do not transfer decal directly.
];
var getItemStyle = makeStyleMapper(ITEM_STYLE_KEY_MAP);
var ItemStyleMixin = (
  /** @class */
  (function() {
    function ItemStyleMixin2() {
    }
    ItemStyleMixin2.prototype.getItemStyle = function(excludes, includes) {
      return getItemStyle(this, excludes, includes);
    };
    return ItemStyleMixin2;
  })()
);

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/model/Model.js
var Model = (
  /** @class */
  (function() {
    function Model2(option, parentModel, ecModel) {
      this.parentModel = parentModel;
      this.ecModel = ecModel;
      this.option = option;
    }
    Model2.prototype.init = function(option, parentModel, ecModel) {
      var rest = [];
      for (var _i = 3; _i < arguments.length; _i++) {
        rest[_i - 3] = arguments[_i];
      }
    };
    Model2.prototype.mergeOption = function(option, ecModel) {
      merge(this.option, option, true);
    };
    Model2.prototype.get = function(path, ignoreParent) {
      if (path == null) {
        return this.option;
      }
      return this._doGet(this.parsePath(path), !ignoreParent && this.parentModel);
    };
    Model2.prototype.getShallow = function(key2, ignoreParent) {
      var option = this.option;
      var val = option == null ? option : option[key2];
      if (val == null && !ignoreParent) {
        var parentModel = this.parentModel;
        if (parentModel) {
          val = parentModel.getShallow(key2);
        }
      }
      return val;
    };
    Model2.prototype.getModel = function(path, parentModel) {
      var hasPath = path != null;
      var pathFinal = hasPath ? this.parsePath(path) : null;
      var obj = hasPath ? this._doGet(pathFinal) : this.option;
      parentModel = parentModel || this.parentModel && this.parentModel.getModel(this.resolveParentPath(pathFinal));
      return new Model2(obj, parentModel, this.ecModel);
    };
    Model2.prototype.isEmpty = function() {
      return this.option == null;
    };
    Model2.prototype.restoreData = function() {
    };
    Model2.prototype.clone = function() {
      var Ctor = this.constructor;
      return new Ctor(clone(this.option));
    };
    Model2.prototype.parsePath = function(path) {
      if (typeof path === "string") {
        return path.split(".");
      }
      return path;
    };
    Model2.prototype.resolveParentPath = function(path) {
      return path;
    };
    Model2.prototype.isAnimationEnabled = function() {
      if (!env_default.node && this.option) {
        if (this.option.animation != null) {
          return !!this.option.animation;
        } else if (this.parentModel) {
          return this.parentModel.isAnimationEnabled();
        }
      }
    };
    Model2.prototype._doGet = function(pathArr, parentModel) {
      var obj = this.option;
      if (!pathArr) {
        return obj;
      }
      for (var i = 0; i < pathArr.length; i++) {
        if (!pathArr[i]) {
          continue;
        }
        obj = obj && typeof obj === "object" ? obj[pathArr[i]] : null;
        if (obj == null) {
          break;
        }
      }
      if (obj == null && parentModel) {
        obj = parentModel._doGet(this.resolveParentPath(pathArr), parentModel.parentModel);
      }
      return obj;
    };
    return Model2;
  })()
);
enableClassExtend(Model);
enableClassCheck(Model);
mixin(Model, LineStyleMixin);
mixin(Model, ItemStyleMixin);
mixin(Model, AreaStyleMixin);
mixin(Model, textStyle_default);
var Model_default = Model;

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/util/component.js
var base = Math.round(Math.random() * 10);
function getUID(type) {
  return [type || "", base++].join("_");
}
function enableSubTypeDefaulter(target) {
  var subTypeDefaulters = {};
  target.registerSubTypeDefaulter = function(componentType, defaulter) {
    var componentTypeInfo = parseClassType(componentType);
    subTypeDefaulters[componentTypeInfo.main] = defaulter;
  };
  target.determineSubType = function(componentType, option) {
    var type = option.type;
    if (!type) {
      var componentTypeMain = parseClassType(componentType).main;
      if (target.hasSubTypes(componentType) && subTypeDefaulters[componentTypeMain]) {
        type = subTypeDefaulters[componentTypeMain](option);
      }
    }
    return type;
  };
}
function enableTopologicalTravel(entity, dependencyGetter) {
  entity.topologicalTravel = function(targetNameList, fullNameList, callback, context) {
    if (!targetNameList.length) {
      return;
    }
    var result = makeDepndencyGraph(fullNameList);
    var graph = result.graph;
    var noEntryList = result.noEntryList;
    var targetNameSet = {};
    each(targetNameList, function(name) {
      targetNameSet[name] = true;
    });
    while (noEntryList.length) {
      var currComponentType = noEntryList.pop();
      var currVertex = graph[currComponentType];
      var isInTargetNameSet = !!targetNameSet[currComponentType];
      if (isInTargetNameSet) {
        callback.call(context, currComponentType, currVertex.originalDeps.slice());
        delete targetNameSet[currComponentType];
      }
      each(currVertex.successor, isInTargetNameSet ? removeEdgeAndAdd : removeEdge);
    }
    each(targetNameSet, function() {
      var errMsg = "";
      if (false) {
        errMsg = makePrintable("Circular dependency may exists: ", targetNameSet, targetNameList, fullNameList);
      }
      throw new Error(errMsg);
    });
    function removeEdge(succComponentType) {
      graph[succComponentType].entryCount--;
      if (graph[succComponentType].entryCount === 0) {
        noEntryList.push(succComponentType);
      }
    }
    function removeEdgeAndAdd(succComponentType) {
      targetNameSet[succComponentType] = true;
      removeEdge(succComponentType);
    }
  };
  function makeDepndencyGraph(fullNameList) {
    var graph = {};
    var noEntryList = [];
    each(fullNameList, function(name) {
      var thisItem = createDependencyGraphItem(graph, name);
      var originalDeps = thisItem.originalDeps = dependencyGetter(name);
      var availableDeps = getAvailableDependencies(originalDeps, fullNameList);
      thisItem.entryCount = availableDeps.length;
      if (thisItem.entryCount === 0) {
        noEntryList.push(name);
      }
      each(availableDeps, function(dependentName) {
        if (indexOf(thisItem.predecessor, dependentName) < 0) {
          thisItem.predecessor.push(dependentName);
        }
        var thatItem = createDependencyGraphItem(graph, dependentName);
        if (indexOf(thatItem.successor, dependentName) < 0) {
          thatItem.successor.push(name);
        }
      });
    });
    return {
      graph,
      noEntryList
    };
  }
  function createDependencyGraphItem(graph, name) {
    if (!graph[name]) {
      graph[name] = {
        predecessor: [],
        successor: []
      };
    }
    return graph[name];
  }
  function getAvailableDependencies(originalDeps, fullNameList) {
    var availableDeps = [];
    each(originalDeps, function(dep) {
      indexOf(fullNameList, dep) >= 0 && availableDeps.push(dep);
    });
    return availableDeps;
  }
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/core/dom.js
var replaceReg = /([&<>"'])/g;
var replaceMap = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};
function encodeHTML(source) {
  return source == null ? "" : (source + "").replace(replaceReg, function(str, c) {
    return replaceMap[c];
  });
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/i18n/langEN.js
var langEN_default = {
  time: {
    month: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    monthAbbr: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    dayOfWeek: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    dayOfWeekAbbr: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  },
  legend: {
    selector: {
      all: "All",
      inverse: "Inv"
    }
  },
  toolbox: {
    brush: {
      title: {
        rect: "Box Select",
        polygon: "Lasso Select",
        lineX: "Horizontally Select",
        lineY: "Vertically Select",
        keep: "Keep Selections",
        clear: "Clear Selections"
      }
    },
    dataView: {
      title: "Data View",
      lang: ["Data View", "Close", "Refresh"]
    },
    dataZoom: {
      title: {
        zoom: "Zoom",
        back: "Zoom Reset"
      }
    },
    magicType: {
      title: {
        line: "Switch to Line Chart",
        bar: "Switch to Bar Chart",
        stack: "Stack",
        tiled: "Tile"
      }
    },
    restore: {
      title: "Restore"
    },
    saveAsImage: {
      title: "Save as Image",
      lang: ["Right Click to Save Image"]
    }
  },
  series: {
    typeNames: {
      pie: "Pie chart",
      bar: "Bar chart",
      line: "Line chart",
      scatter: "Scatter plot",
      effectScatter: "Ripple scatter plot",
      radar: "Radar chart",
      tree: "Tree",
      treemap: "Treemap",
      boxplot: "Boxplot",
      candlestick: "Candlestick",
      k: "K line chart",
      heatmap: "Heat map",
      map: "Map",
      parallel: "Parallel coordinate map",
      lines: "Line graph",
      graph: "Relationship graph",
      sankey: "Sankey diagram",
      funnel: "Funnel chart",
      gauge: "Gauge",
      pictorialBar: "Pictorial bar",
      themeRiver: "Theme River Map",
      sunburst: "Sunburst",
      custom: "Custom chart",
      chart: "Chart"
    }
  },
  aria: {
    general: {
      withTitle: 'This is a chart about "{title}"',
      withoutTitle: "This is a chart"
    },
    series: {
      single: {
        prefix: "",
        withName: " with type {seriesType} named {seriesName}.",
        withoutName: " with type {seriesType}."
      },
      multiple: {
        prefix: ". It consists of {seriesCount} series count.",
        withName: " The {seriesId} series is a {seriesType} representing {seriesName}.",
        withoutName: " The {seriesId} series is a {seriesType}.",
        separator: {
          middle: "",
          end: ""
        }
      }
    },
    data: {
      allData: "The data is as follows: ",
      partialData: "The first {displayCnt} items are: ",
      withName: "the data for {name} is {value}",
      withoutName: "{value}",
      separator: {
        middle: ", ",
        end: ". "
      }
    }
  }
};

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/i18n/langZH.js
var langZH_default = {
  time: {
    month: ["\u4E00\u6708", "\u4E8C\u6708", "\u4E09\u6708", "\u56DB\u6708", "\u4E94\u6708", "\u516D\u6708", "\u4E03\u6708", "\u516B\u6708", "\u4E5D\u6708", "\u5341\u6708", "\u5341\u4E00\u6708", "\u5341\u4E8C\u6708"],
    monthAbbr: ["1\u6708", "2\u6708", "3\u6708", "4\u6708", "5\u6708", "6\u6708", "7\u6708", "8\u6708", "9\u6708", "10\u6708", "11\u6708", "12\u6708"],
    dayOfWeek: ["\u661F\u671F\u65E5", "\u661F\u671F\u4E00", "\u661F\u671F\u4E8C", "\u661F\u671F\u4E09", "\u661F\u671F\u56DB", "\u661F\u671F\u4E94", "\u661F\u671F\u516D"],
    dayOfWeekAbbr: ["\u65E5", "\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D"]
  },
  legend: {
    selector: {
      all: "\u5168\u9009",
      inverse: "\u53CD\u9009"
    }
  },
  toolbox: {
    brush: {
      title: {
        rect: "\u77E9\u5F62\u9009\u62E9",
        polygon: "\u5708\u9009",
        lineX: "\u6A2A\u5411\u9009\u62E9",
        lineY: "\u7EB5\u5411\u9009\u62E9",
        keep: "\u4FDD\u6301\u9009\u62E9",
        clear: "\u6E05\u9664\u9009\u62E9"
      }
    },
    dataView: {
      title: "\u6570\u636E\u89C6\u56FE",
      lang: ["\u6570\u636E\u89C6\u56FE", "\u5173\u95ED", "\u5237\u65B0"]
    },
    dataZoom: {
      title: {
        zoom: "\u533A\u57DF\u7F29\u653E",
        back: "\u533A\u57DF\u7F29\u653E\u8FD8\u539F"
      }
    },
    magicType: {
      title: {
        line: "\u5207\u6362\u4E3A\u6298\u7EBF\u56FE",
        bar: "\u5207\u6362\u4E3A\u67F1\u72B6\u56FE",
        stack: "\u5207\u6362\u4E3A\u5806\u53E0",
        tiled: "\u5207\u6362\u4E3A\u5E73\u94FA"
      }
    },
    restore: {
      title: "\u8FD8\u539F"
    },
    saveAsImage: {
      title: "\u4FDD\u5B58\u4E3A\u56FE\u7247",
      lang: ["\u53F3\u952E\u53E6\u5B58\u4E3A\u56FE\u7247"]
    }
  },
  series: {
    typeNames: {
      pie: "\u997C\u56FE",
      bar: "\u67F1\u72B6\u56FE",
      line: "\u6298\u7EBF\u56FE",
      scatter: "\u6563\u70B9\u56FE",
      effectScatter: "\u6D9F\u6F2A\u6563\u70B9\u56FE",
      radar: "\u96F7\u8FBE\u56FE",
      tree: "\u6811\u56FE",
      treemap: "\u77E9\u5F62\u6811\u56FE",
      boxplot: "\u7BB1\u578B\u56FE",
      candlestick: "K\u7EBF\u56FE",
      k: "K\u7EBF\u56FE",
      heatmap: "\u70ED\u529B\u56FE",
      map: "\u5730\u56FE",
      parallel: "\u5E73\u884C\u5750\u6807\u56FE",
      lines: "\u7EBF\u56FE",
      graph: "\u5173\u7CFB\u56FE",
      sankey: "\u6851\u57FA\u56FE",
      funnel: "\u6F0F\u6597\u56FE",
      gauge: "\u4EEA\u8868\u76D8\u56FE",
      pictorialBar: "\u8C61\u5F62\u67F1\u56FE",
      themeRiver: "\u4E3B\u9898\u6CB3\u6D41\u56FE",
      sunburst: "\u65ED\u65E5\u56FE",
      custom: "\u81EA\u5B9A\u4E49\u56FE\u8868",
      chart: "\u56FE\u8868"
    }
  },
  aria: {
    general: {
      withTitle: "\u8FD9\u662F\u4E00\u4E2A\u5173\u4E8E\u201C{title}\u201D\u7684\u56FE\u8868\u3002",
      withoutTitle: "\u8FD9\u662F\u4E00\u4E2A\u56FE\u8868\uFF0C"
    },
    series: {
      single: {
        prefix: "",
        withName: "\u56FE\u8868\u7C7B\u578B\u662F{seriesType}\uFF0C\u8868\u793A{seriesName}\u3002",
        withoutName: "\u56FE\u8868\u7C7B\u578B\u662F{seriesType}\u3002"
      },
      multiple: {
        prefix: "\u5B83\u7531{seriesCount}\u4E2A\u56FE\u8868\u7CFB\u5217\u7EC4\u6210\u3002",
        withName: "\u7B2C{seriesId}\u4E2A\u7CFB\u5217\u662F\u4E00\u4E2A\u8868\u793A{seriesName}\u7684{seriesType}\uFF0C",
        withoutName: "\u7B2C{seriesId}\u4E2A\u7CFB\u5217\u662F\u4E00\u4E2A{seriesType}\uFF0C",
        separator: {
          middle: "\uFF1B",
          end: "\u3002"
        }
      }
    },
    data: {
      allData: "\u5176\u6570\u636E\u662F\u2014\u2014",
      partialData: "\u5176\u4E2D\uFF0C\u524D{displayCnt}\u9879\u662F\u2014\u2014",
      withName: "{name}\u7684\u6570\u636E\u662F{value}",
      withoutName: "{value}",
      separator: {
        middle: "\uFF0C",
        end: ""
      }
    }
  }
};

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/core/locale.js
var LOCALE_ZH = "ZH";
var LOCALE_EN = "EN";
var DEFAULT_LOCALE = LOCALE_EN;
var localeStorage = {};
var localeModels = {};
var SYSTEM_LANG = !env_default.domSupported ? DEFAULT_LOCALE : (function() {
  var langStr = (document.documentElement.lang || navigator.language || navigator.browserLanguage || DEFAULT_LOCALE).toUpperCase();
  return langStr.indexOf(LOCALE_ZH) > -1 ? LOCALE_ZH : DEFAULT_LOCALE;
})();
function registerLocale(locale, localeObj) {
  locale = locale.toUpperCase();
  localeModels[locale] = new Model_default(localeObj);
  localeStorage[locale] = localeObj;
}
function getLocaleModel(lang) {
  return localeModels[lang];
}
function getDefaultLocaleModel() {
  return localeModels[DEFAULT_LOCALE];
}
registerLocale(LOCALE_EN, langEN_default);
registerLocale(LOCALE_ZH, langZH_default);

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/scale/break.js
var _impl = null;
function registerScaleBreakHelperImpl(impl) {
  if (!_impl) {
    _impl = impl;
  }
}
function getScaleBreakHelper() {
  return _impl;
}
function simplyParseBreakOption(scale3, opt) {
  var scaleBreakHelper = getScaleBreakHelper();
  var breakOption = opt.breakOption;
  var breakParsed = opt.breakParsed;
  if (!breakParsed && scaleBreakHelper) {
    breakParsed = scaleBreakHelper.parseAxisBreakOption(breakOption, scale3);
  }
  return breakParsed;
}
function getBreaksUnsafe(scale3) {
  var brk = scale3.brk;
  return brk ? brk.breaks : [];
}
function hasBreaks(scale3) {
  var brk = scale3.brk;
  return brk ? brk.hasBreaks() : false;
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/util/time.js
var ONE_SECOND = 1e3;
var ONE_MINUTE = ONE_SECOND * 60;
var ONE_HOUR = ONE_MINUTE * 60;
var ONE_DAY = ONE_HOUR * 24;
var ONE_YEAR = ONE_DAY * 365;
var primaryTimeUnitFormatterMatchers = {
  year: /({yyyy}|{yy})/,
  month: /({MMMM}|{MMM}|{MM}|{M})/,
  day: /({dd}|{d})/,
  hour: /({HH}|{H}|{hh}|{h})/,
  minute: /({mm}|{m})/,
  second: /({ss}|{s})/,
  millisecond: /({SSS}|{S})/
};
var defaultFormatterSeed = {
  year: "{yyyy}",
  month: "{MMM}",
  day: "{d}",
  hour: "{HH}:{mm}",
  minute: "{HH}:{mm}",
  second: "{HH}:{mm}:{ss}",
  millisecond: "{HH}:{mm}:{ss} {SSS}"
};
var defaultFullFormatter = "{yyyy}-{MM}-{dd} {HH}:{mm}:{ss} {SSS}";
var fullDayFormatter = "{yyyy}-{MM}-{dd}";
var fullLeveledFormatter = {
  year: "{yyyy}",
  month: "{yyyy}-{MM}",
  day: fullDayFormatter,
  hour: fullDayFormatter + " " + defaultFormatterSeed.hour,
  minute: fullDayFormatter + " " + defaultFormatterSeed.minute,
  second: fullDayFormatter + " " + defaultFormatterSeed.second,
  millisecond: defaultFullFormatter
};
var primaryTimeUnits = ["year", "month", "day", "hour", "minute", "second", "millisecond"];
var timeUnits = ["year", "half-year", "quarter", "month", "week", "half-week", "day", "half-day", "quarter-day", "hour", "minute", "second", "millisecond"];
function parseTimeAxisLabelFormatter(formatter) {
  return !isString(formatter) && !isFunction(formatter) ? parseTimeAxisLabelFormatterDictionary(formatter) : formatter;
}
function parseTimeAxisLabelFormatterDictionary(dictOption) {
  dictOption = dictOption || {};
  var dict = {};
  var canAddHighlight = true;
  each(primaryTimeUnits, function(lowestUnit) {
    canAddHighlight && (canAddHighlight = dictOption[lowestUnit] == null);
  });
  each(primaryTimeUnits, function(lowestUnit, lowestUnitIdx) {
    var upperDictOption = dictOption[lowestUnit];
    dict[lowestUnit] = {};
    var lowerTpl = null;
    for (var upperUnitIdx = lowestUnitIdx; upperUnitIdx >= 0; upperUnitIdx--) {
      var upperUnit = primaryTimeUnits[upperUnitIdx];
      var upperDictItemOption = isObject(upperDictOption) && !isArray(upperDictOption) ? upperDictOption[upperUnit] : upperDictOption;
      var tplArr = void 0;
      if (isArray(upperDictItemOption)) {
        tplArr = upperDictItemOption.slice();
        lowerTpl = tplArr[0] || "";
      } else if (isString(upperDictItemOption)) {
        lowerTpl = upperDictItemOption;
        tplArr = [lowerTpl];
      } else {
        if (lowerTpl == null) {
          lowerTpl = defaultFormatterSeed[lowestUnit];
        } else if (!primaryTimeUnitFormatterMatchers[upperUnit].test(lowerTpl)) {
          lowerTpl = dict[upperUnit][upperUnit][0] + " " + lowerTpl;
        }
        tplArr = [lowerTpl];
        if (canAddHighlight) {
          tplArr[1] = "{primary|" + lowerTpl + "}";
        }
      }
      dict[lowestUnit][upperUnit] = tplArr;
    }
  });
  return dict;
}
function pad(str, len2) {
  str += "";
  return "0000".substr(0, len2 - str.length) + str;
}
function getPrimaryTimeUnit(timeUnit) {
  switch (timeUnit) {
    case "half-year":
    case "quarter":
      return "month";
    case "week":
    case "half-week":
      return "day";
    case "half-day":
    case "quarter-day":
      return "hour";
    default:
      return timeUnit;
  }
}
function isPrimaryTimeUnit(timeUnit) {
  return timeUnit === getPrimaryTimeUnit(timeUnit);
}
function getDefaultFormatPrecisionOfInterval(timeUnit) {
  switch (timeUnit) {
    case "year":
    case "month":
      return "day";
    case "millisecond":
      return "millisecond";
    default:
      return "second";
  }
}
function format(time, template, isUTC, lang) {
  var date = parseDate(time);
  var y = date[fullYearGetterName(isUTC)]();
  var M = date[monthGetterName(isUTC)]() + 1;
  var q = Math.floor((M - 1) / 3) + 1;
  var d = date[dateGetterName(isUTC)]();
  var e2 = date["get" + (isUTC ? "UTC" : "") + "Day"]();
  var H = date[hoursGetterName(isUTC)]();
  var h = (H - 1) % 12 + 1;
  var m = date[minutesGetterName(isUTC)]();
  var s = date[secondsGetterName(isUTC)]();
  var S = date[millisecondsGetterName(isUTC)]();
  var a = H >= 12 ? "pm" : "am";
  var A = a.toUpperCase();
  var localeModel = lang instanceof Model_default ? lang : getLocaleModel(lang || SYSTEM_LANG) || getDefaultLocaleModel();
  var timeModel = localeModel.getModel("time");
  var month = timeModel.get("month");
  var monthAbbr = timeModel.get("monthAbbr");
  var dayOfWeek = timeModel.get("dayOfWeek");
  var dayOfWeekAbbr = timeModel.get("dayOfWeekAbbr");
  return (template || "").replace(/{a}/g, a + "").replace(/{A}/g, A + "").replace(/{yyyy}/g, y + "").replace(/{yy}/g, pad(y % 100 + "", 2)).replace(/{Q}/g, q + "").replace(/{MMMM}/g, month[M - 1]).replace(/{MMM}/g, monthAbbr[M - 1]).replace(/{MM}/g, pad(M, 2)).replace(/{M}/g, M + "").replace(/{dd}/g, pad(d, 2)).replace(/{d}/g, d + "").replace(/{eeee}/g, dayOfWeek[e2]).replace(/{ee}/g, dayOfWeekAbbr[e2]).replace(/{e}/g, e2 + "").replace(/{HH}/g, pad(H, 2)).replace(/{H}/g, H + "").replace(/{hh}/g, pad(h + "", 2)).replace(/{h}/g, h + "").replace(/{mm}/g, pad(m, 2)).replace(/{m}/g, m + "").replace(/{ss}/g, pad(s, 2)).replace(/{s}/g, s + "").replace(/{SSS}/g, pad(S, 3)).replace(/{S}/g, S + "");
}
function leveledFormat(tick, idx, formatter, lang, isUTC) {
  var template = null;
  if (isString(formatter)) {
    template = formatter;
  } else if (isFunction(formatter)) {
    var extra = {
      time: tick.time,
      level: tick.time ? tick.time.level : 0
    };
    var scaleBreakHelper = getScaleBreakHelper();
    if (scaleBreakHelper) {
      scaleBreakHelper.makeAxisLabelFormatterParamBreak(extra, tick["break"]);
    }
    template = formatter(tick.value, idx, extra);
  } else {
    var tickTime = tick.time;
    if (tickTime) {
      var leveledTplArr = formatter[tickTime.lowerTimeUnit][tickTime.upperTimeUnit];
      template = leveledTplArr[Math.min(tickTime.level, leveledTplArr.length - 1)] || "";
    } else {
      var unit = getUnitFromValue(tick.value, isUTC);
      template = formatter[unit][unit][0];
    }
  }
  return format(new Date(tick.value), template, isUTC, lang);
}
function getUnitFromValue(value, isUTC) {
  var date = parseDate(value);
  var M = date[monthGetterName(isUTC)]() + 1;
  var d = date[dateGetterName(isUTC)]();
  var h = date[hoursGetterName(isUTC)]();
  var m = date[minutesGetterName(isUTC)]();
  var s = date[secondsGetterName(isUTC)]();
  var S = date[millisecondsGetterName(isUTC)]();
  var isSecond = S === 0;
  var isMinute = isSecond && s === 0;
  var isHour = isMinute && m === 0;
  var isDay = isHour && h === 0;
  var isMonth = isDay && d === 1;
  var isYear = isMonth && M === 1;
  if (isYear) {
    return "year";
  } else if (isMonth) {
    return "month";
  } else if (isDay) {
    return "day";
  } else if (isHour) {
    return "hour";
  } else if (isMinute) {
    return "minute";
  } else if (isSecond) {
    return "second";
  } else {
    return "millisecond";
  }
}
function roundTime(date, timeUnit, isUTC) {
  switch (timeUnit) {
    case "year":
      date[monthSetterName(isUTC)](0);
    case "month":
      date[dateSetterName(isUTC)](1);
    case "day":
      date[hoursSetterName(isUTC)](0);
    case "hour":
      date[minutesSetterName(isUTC)](0);
    case "minute":
      date[secondsSetterName(isUTC)](0);
    case "second":
      date[millisecondsSetterName(isUTC)](0);
  }
  return date;
}
function fullYearGetterName(isUTC) {
  return isUTC ? "getUTCFullYear" : "getFullYear";
}
function monthGetterName(isUTC) {
  return isUTC ? "getUTCMonth" : "getMonth";
}
function dateGetterName(isUTC) {
  return isUTC ? "getUTCDate" : "getDate";
}
function hoursGetterName(isUTC) {
  return isUTC ? "getUTCHours" : "getHours";
}
function minutesGetterName(isUTC) {
  return isUTC ? "getUTCMinutes" : "getMinutes";
}
function secondsGetterName(isUTC) {
  return isUTC ? "getUTCSeconds" : "getSeconds";
}
function millisecondsGetterName(isUTC) {
  return isUTC ? "getUTCMilliseconds" : "getMilliseconds";
}
function fullYearSetterName(isUTC) {
  return isUTC ? "setUTCFullYear" : "setFullYear";
}
function monthSetterName(isUTC) {
  return isUTC ? "setUTCMonth" : "setMonth";
}
function dateSetterName(isUTC) {
  return isUTC ? "setUTCDate" : "setDate";
}
function hoursSetterName(isUTC) {
  return isUTC ? "setUTCHours" : "setHours";
}
function minutesSetterName(isUTC) {
  return isUTC ? "setUTCMinutes" : "setMinutes";
}
function secondsSetterName(isUTC) {
  return isUTC ? "setUTCSeconds" : "setSeconds";
}
function millisecondsSetterName(isUTC) {
  return isUTC ? "setUTCMilliseconds" : "setMilliseconds";
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/util/format.js
function addCommas(x) {
  if (!isNumeric(x)) {
    return isString(x) ? x : "-";
  }
  var parts = (x + "").split(".");
  return parts[0].replace(/(\d{1,3})(?=(?:\d{3})+(?!\d))/g, "$1,") + (parts.length > 1 ? "." + parts[1] : "");
}
var normalizeCssArray2 = normalizeCssArray;
var TPL_VAR_ALIAS = ["a", "b", "c", "d", "e", "f", "g"];
var wrapVar = function(varName, seriesIdx) {
  return "{" + varName + (seriesIdx == null ? "" : seriesIdx) + "}";
};
function formatTpl(tpl, paramsList, encode) {
  if (!isArray(paramsList)) {
    paramsList = [paramsList];
  }
  var seriesLen = paramsList.length;
  if (!seriesLen) {
    return "";
  }
  var $vars = paramsList[0].$vars || [];
  for (var i = 0; i < $vars.length; i++) {
    var alias = TPL_VAR_ALIAS[i];
    tpl = tpl.replace(wrapVar(alias), wrapVar(alias, 0));
  }
  for (var seriesIdx = 0; seriesIdx < seriesLen; seriesIdx++) {
    for (var k = 0; k < $vars.length; k++) {
      var val = paramsList[seriesIdx][$vars[k]];
      tpl = tpl.replace(wrapVar(TPL_VAR_ALIAS[k], seriesIdx), encode ? encodeHTML(val) : val);
    }
  }
  return tpl;
}
function getTooltipMarker(inOpt, extraCssText) {
  var opt = isString(inOpt) ? {
    color: inOpt,
    extraCssText
  } : inOpt || {};
  var color2 = opt.color;
  var type = opt.type;
  extraCssText = opt.extraCssText;
  var renderMode = opt.renderMode || "html";
  if (!color2) {
    return "";
  }
  if (renderMode === "html") {
    return type === "subItem" ? '<span style="display:inline-block;vertical-align:middle;margin-right:8px;margin-left:3px;border-radius:4px;width:4px;height:4px;background-color:' + encodeHTML(color2) + ";" + (extraCssText || "") + '"></span>' : '<span style="display:inline-block;margin-right:4px;border-radius:10px;width:10px;height:10px;background-color:' + encodeHTML(color2) + ";" + (extraCssText || "") + '"></span>';
  } else {
    var markerId = opt.markerId || "markerX";
    return {
      renderMode,
      content: "{" + markerId + "|}  ",
      style: type === "subItem" ? {
        width: 4,
        height: 4,
        borderRadius: 2,
        backgroundColor: color2
      } : {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: color2
      }
    };
  }
}
function convertToColorString(color2, defaultColor) {
  defaultColor = defaultColor || "transparent";
  return isString(color2) ? color2 : isObject(color2) ? color2.colorStops && (color2.colorStops[0] || {}).color || defaultColor : defaultColor;
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/core/CoordinateSystem.js
var nonSeriesBoxCoordSysCreators = {};
var normalCoordSysCreators = {};
var CoordinateSystemManager = (
  /** @class */
  (function() {
    function CoordinateSystemManager2() {
      this._normalMasterList = [];
      this._nonSeriesBoxMasterList = [];
    }
    CoordinateSystemManager2.prototype.create = function(ecModel, api) {
      this._nonSeriesBoxMasterList = dealCreate(nonSeriesBoxCoordSysCreators, true);
      this._normalMasterList = dealCreate(normalCoordSysCreators, false);
      function dealCreate(creatorMap, canBeNonSeriesBox) {
        var coordinateSystems = [];
        each(creatorMap, function(creator, type) {
          var list = creator.create(ecModel, api);
          coordinateSystems = coordinateSystems.concat(list || []);
          if (false) {
            if (canBeNonSeriesBox) {
              each(list, function(master) {
                return assert(!master.update);
              });
            }
          }
        });
        return coordinateSystems;
      }
    };
    CoordinateSystemManager2.prototype.update = function(ecModel, api) {
      each(this._normalMasterList, function(coordSys) {
        coordSys.update && coordSys.update(ecModel, api);
      });
    };
    CoordinateSystemManager2.prototype.getCoordinateSystems = function() {
      return this._normalMasterList.concat(this._nonSeriesBoxMasterList);
    };
    CoordinateSystemManager2.register = function(type, creator) {
      if (type === "matrix" || type === "calendar") {
        nonSeriesBoxCoordSysCreators[type] = creator;
        return;
      }
      normalCoordSysCreators[type] = creator;
    };
    CoordinateSystemManager2.get = function(type) {
      return normalCoordSysCreators[type] || nonSeriesBoxCoordSysCreators[type];
    };
    return CoordinateSystemManager2;
  })()
);
function canBeNonSeriesBoxCoordSys(coordSysType) {
  return !!nonSeriesBoxCoordSysCreators[coordSysType];
}
var BOX_COORD_SYS_COORD_FROM_PROP_COORD = 1;
var BOX_COORD_SYS_COORD_FROM_PROP_COORD2 = 2;
var coordSysUseMap = createHashMap();
function getCoordForCoordSysUsageKindBox(model) {
  var coord = model.getShallow("coord", true);
  var from = BOX_COORD_SYS_COORD_FROM_PROP_COORD;
  if (coord == null) {
    var store = coordSysUseMap.get(model.type);
    if (store && store.getCoord2) {
      from = BOX_COORD_SYS_COORD_FROM_PROP_COORD2;
      coord = store.getCoord2(model);
    }
  }
  return {
    coord,
    from
  };
}
var COORD_SYS_USAGE_KIND_NONE = 0;
var COORD_SYS_USAGE_KIND_DATA = 1;
var COORD_SYS_USAGE_KIND_BOX = 2;
function decideCoordSysUsageKind(model, printError) {
  var coordSysType = model.getShallow("coordinateSystem");
  var coordSysUsageOption = model.getShallow("coordinateSystemUsage", true);
  var isDeclaredExplicitly = coordSysUsageOption != null;
  var kind = COORD_SYS_USAGE_KIND_NONE;
  if (coordSysType) {
    var isSeries2 = model.mainType === "series";
    if (coordSysUsageOption == null) {
      coordSysUsageOption = isSeries2 ? "data" : "box";
    }
    if (coordSysUsageOption === "data") {
      kind = COORD_SYS_USAGE_KIND_DATA;
      if (!isSeries2) {
        if (false) {
          if (isDeclaredExplicitly && printError) {
            error('coordinateSystemUsage "data" is not supported in non-series components.');
          }
        }
        kind = COORD_SYS_USAGE_KIND_NONE;
      }
    } else if (coordSysUsageOption === "box") {
      kind = COORD_SYS_USAGE_KIND_BOX;
      if (!isSeries2 && !canBeNonSeriesBoxCoordSys(coordSysType)) {
        if (false) {
          if (isDeclaredExplicitly && printError) {
            error('coordinateSystem "' + coordSysType + '" cannot be used' + (' as coordinateSystemUsage "box" for "' + model.type + '" yet.'));
          }
        }
        kind = COORD_SYS_USAGE_KIND_NONE;
      }
    }
  }
  return {
    coordSysType,
    kind
  };
}
function injectCoordSysByOption(opt) {
  var targetModel = opt.targetModel, coordSysType = opt.coordSysType, coordSysProvider = opt.coordSysProvider, isDefaultDataCoordSys = opt.isDefaultDataCoordSys, allowNotFound = opt.allowNotFound;
  if (false) {
    assert(!!coordSysType);
  }
  var _a2 = decideCoordSysUsageKind(targetModel, true), kind = _a2.kind, declaredType = _a2.coordSysType;
  if (isDefaultDataCoordSys && kind !== COORD_SYS_USAGE_KIND_DATA) {
    kind = COORD_SYS_USAGE_KIND_DATA;
    declaredType = coordSysType;
  }
  if (kind === COORD_SYS_USAGE_KIND_NONE || declaredType !== coordSysType) {
    return COORD_SYS_USAGE_KIND_NONE;
  }
  var coordSys = coordSysProvider(coordSysType, targetModel);
  if (!coordSys) {
    if (false) {
      if (!allowNotFound) {
        error(coordSysType + " cannot be found for" + (" " + targetModel.type + " (index: " + targetModel.componentIndex + ")."));
      }
    }
    return COORD_SYS_USAGE_KIND_NONE;
  }
  if (kind === COORD_SYS_USAGE_KIND_DATA) {
    if (false) {
      assert(targetModel.mainType === "series");
    }
    targetModel.coordinateSystem = coordSys;
  } else {
    targetModel.boxCoordinateSystem = coordSys;
  }
  return kind;
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/util/layout.js
var each2 = each;
var LOCATION_PARAMS = ["left", "right", "top", "bottom", "width", "height"];
var HV_NAMES = [["width", "left", "right"], ["height", "top", "bottom"]];
function boxLayout(orient, group, gap, maxWidth, maxHeight) {
  var x = 0;
  var y = 0;
  if (maxWidth == null) {
    maxWidth = Infinity;
  }
  if (maxHeight == null) {
    maxHeight = Infinity;
  }
  var currentLineMaxSize = 0;
  group.eachChild(function(child, idx) {
    var rect = child.getBoundingRect();
    var nextChild = group.childAt(idx + 1);
    var nextChildRect = nextChild && nextChild.getBoundingRect();
    var nextX;
    var nextY;
    if (orient === "horizontal") {
      var moveX = rect.width + (nextChildRect ? -nextChildRect.x + rect.x : 0);
      nextX = x + moveX;
      if (nextX > maxWidth || child.newline) {
        x = 0;
        nextX = moveX;
        y += currentLineMaxSize + gap;
        currentLineMaxSize = rect.height;
      } else {
        currentLineMaxSize = Math.max(currentLineMaxSize, rect.height);
      }
    } else {
      var moveY = rect.height + (nextChildRect ? -nextChildRect.y + rect.y : 0);
      nextY = y + moveY;
      if (nextY > maxHeight || child.newline) {
        x += currentLineMaxSize + gap;
        y = 0;
        nextY = moveY;
        currentLineMaxSize = rect.width;
      } else {
        currentLineMaxSize = Math.max(currentLineMaxSize, rect.width);
      }
    }
    if (child.newline) {
      return;
    }
    child.x = x;
    child.y = y;
    child.markRedraw();
    orient === "horizontal" ? x = nextX + gap : y = nextY + gap;
  });
}
var vbox = curry(boxLayout, "vertical");
var hbox = curry(boxLayout, "horizontal");
function getBoxLayoutParams(boxLayoutModel, ignoreParent) {
  return {
    left: boxLayoutModel.getShallow("left", ignoreParent),
    top: boxLayoutModel.getShallow("top", ignoreParent),
    right: boxLayoutModel.getShallow("right", ignoreParent),
    bottom: boxLayoutModel.getShallow("bottom", ignoreParent),
    width: boxLayoutModel.getShallow("width", ignoreParent),
    height: boxLayoutModel.getShallow("height", ignoreParent)
  };
}
function getLayoutRect(positionInfo, containerRect, margin) {
  margin = normalizeCssArray2(margin || 0);
  var containerWidth = containerRect.width;
  var containerHeight = containerRect.height;
  var left = parsePercent(positionInfo.left, containerWidth);
  var top = parsePercent(positionInfo.top, containerHeight);
  var right = parsePercent(positionInfo.right, containerWidth);
  var bottom = parsePercent(positionInfo.bottom, containerHeight);
  var width = parsePercent(positionInfo.width, containerWidth);
  var height = parsePercent(positionInfo.height, containerHeight);
  var verticalMargin = margin[2] + margin[0];
  var horizontalMargin = margin[1] + margin[3];
  var aspect = positionInfo.aspect;
  if (isNaN(width)) {
    width = containerWidth - right - horizontalMargin - left;
  }
  if (isNaN(height)) {
    height = containerHeight - bottom - verticalMargin - top;
  }
  if (aspect != null) {
    if (isNaN(width) && isNaN(height)) {
      if (aspect > containerWidth / containerHeight) {
        width = containerWidth * 0.8;
      } else {
        height = containerHeight * 0.8;
      }
    }
    if (isNaN(width)) {
      width = aspect * height;
    }
    if (isNaN(height)) {
      height = width / aspect;
    }
  }
  if (isNaN(left)) {
    left = containerWidth - right - width - horizontalMargin;
  }
  if (isNaN(top)) {
    top = containerHeight - bottom - height - verticalMargin;
  }
  switch (positionInfo.left || positionInfo.right) {
    case "center":
      left = containerWidth / 2 - width / 2 - margin[3];
      break;
    case "right":
      left = containerWidth - width - horizontalMargin;
      break;
  }
  switch (positionInfo.top || positionInfo.bottom) {
    case "middle":
    case "center":
      top = containerHeight / 2 - height / 2 - margin[0];
      break;
    case "bottom":
      top = containerHeight - height - verticalMargin;
      break;
  }
  left = left || 0;
  top = top || 0;
  if (isNaN(width)) {
    width = containerWidth - horizontalMargin - left - (right || 0);
  }
  if (isNaN(height)) {
    height = containerHeight - verticalMargin - top - (bottom || 0);
  }
  var rect = new BoundingRect_default((containerRect.x || 0) + left + margin[3], (containerRect.y || 0) + top + margin[0], width, height);
  rect.margin = margin;
  return rect;
}
var BoxLayoutReferenceType = {
  rect: 1,
  point: 2
};
function createBoxLayoutReference(model, api, opt) {
  var refContainer;
  var refPoint;
  var layoutRefType;
  var boxCoordSys = model.boxCoordinateSystem;
  var boxCoordFrom;
  if (boxCoordSys) {
    var _a2 = getCoordForCoordSysUsageKindBox(model), coord = _a2.coord, from = _a2.from;
    if (boxCoordSys.dataToLayout) {
      layoutRefType = BoxLayoutReferenceType.rect;
      boxCoordFrom = from;
      var result = boxCoordSys.dataToLayout(coord);
      refContainer = result.contentRect || result.rect;
    } else if (opt && opt.enableLayoutOnlyByCenter && boxCoordSys.dataToPoint) {
      layoutRefType = BoxLayoutReferenceType.point;
      boxCoordFrom = from;
      refPoint = boxCoordSys.dataToPoint(coord);
    } else {
      if (false) {
        error(model.type + "[" + model.componentIndex + "]" + (" layout based on " + boxCoordSys.type + " is not supported."));
      }
    }
  }
  if (layoutRefType == null) {
    layoutRefType = BoxLayoutReferenceType.rect;
  }
  if (layoutRefType === BoxLayoutReferenceType.rect) {
    if (!refContainer) {
      refContainer = {
        x: 0,
        y: 0,
        width: api.getWidth(),
        height: api.getHeight()
      };
    }
    refPoint = [refContainer.x + refContainer.width / 2, refContainer.y + refContainer.height / 2];
  }
  return {
    type: layoutRefType,
    refContainer,
    refPoint,
    boxCoordFrom
  };
}
function fetchLayoutMode(ins) {
  var layoutMode = ins.layoutMode || ins.constructor.layoutMode;
  return isObject(layoutMode) ? layoutMode : layoutMode ? {
    type: layoutMode
  } : null;
}
function mergeLayoutParam(targetOption, newOption, opt) {
  var ignoreSize = opt && opt.ignoreSize;
  !isArray(ignoreSize) && (ignoreSize = [ignoreSize, ignoreSize]);
  var hResult = merge2(HV_NAMES[0], 0);
  var vResult = merge2(HV_NAMES[1], 1);
  copy2(HV_NAMES[0], targetOption, hResult);
  copy2(HV_NAMES[1], targetOption, vResult);
  function merge2(names, hvIdx) {
    var newParams = {};
    var newValueCount = 0;
    var merged = {};
    var mergedValueCount = 0;
    var enoughParamNumber = 2;
    each2(names, function(name) {
      merged[name] = targetOption[name];
    });
    each2(names, function(name) {
      hasOwn(newOption, name) && (newParams[name] = merged[name] = newOption[name]);
      hasValue(newParams, name) && newValueCount++;
      hasValue(merged, name) && mergedValueCount++;
    });
    if (ignoreSize[hvIdx]) {
      if (hasValue(newOption, names[1])) {
        merged[names[2]] = null;
      } else if (hasValue(newOption, names[2])) {
        merged[names[1]] = null;
      }
      return merged;
    }
    if (mergedValueCount === enoughParamNumber || !newValueCount) {
      return merged;
    } else if (newValueCount >= enoughParamNumber) {
      return newParams;
    } else {
      for (var i = 0; i < names.length; i++) {
        var name_1 = names[i];
        if (!hasOwn(newParams, name_1) && hasOwn(targetOption, name_1)) {
          newParams[name_1] = targetOption[name_1];
          break;
        }
      }
      return newParams;
    }
  }
  function hasValue(obj, name) {
    return obj[name] != null && obj[name] !== "auto";
  }
  function copy2(names, target, source) {
    each2(names, function(name) {
      target[name] = source[name];
    });
  }
}
function getLayoutParams(source) {
  return copyLayoutParams({}, source);
}
function copyLayoutParams(target, source) {
  source && target && each2(LOCATION_PARAMS, function(name) {
    hasOwn(source, name) && (target[name] = source[name]);
  });
  return target;
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/model/Component.js
var inner = makeInner();
var ComponentModel = (
  /** @class */
  (function(_super) {
    __extends(ComponentModel2, _super);
    function ComponentModel2(option, parentModel, ecModel) {
      var _this = _super.call(this, option, parentModel, ecModel) || this;
      _this.uid = getUID("ec_cpt_model");
      return _this;
    }
    ComponentModel2.prototype.init = function(option, parentModel, ecModel) {
      this.mergeDefaultAndTheme(option, ecModel);
    };
    ComponentModel2.prototype.mergeDefaultAndTheme = function(option, ecModel) {
      var layoutMode = fetchLayoutMode(this);
      var inputPositionParams = layoutMode ? getLayoutParams(option) : {};
      var themeModel = ecModel.getTheme();
      merge(option, themeModel.get(this.mainType));
      merge(option, this.getDefaultOption());
      if (layoutMode) {
        mergeLayoutParam(option, inputPositionParams, layoutMode);
      }
    };
    ComponentModel2.prototype.mergeOption = function(option, ecModel) {
      merge(this.option, option, true);
      var layoutMode = fetchLayoutMode(this);
      if (layoutMode) {
        mergeLayoutParam(this.option, option, layoutMode);
      }
    };
    ComponentModel2.prototype.optionUpdated = function(newCptOption, isInit) {
    };
    ComponentModel2.prototype.getDefaultOption = function() {
      var ctor = this.constructor;
      if (!isExtendedClass(ctor)) {
        return ctor.defaultOption;
      }
      var fields = inner(this);
      if (!fields.defaultOption) {
        var optList = [];
        var clz = ctor;
        while (clz) {
          var opt = clz.prototype.defaultOption;
          opt && optList.push(opt);
          clz = clz.superClass;
        }
        var defaultOption = {};
        for (var i = optList.length - 1; i >= 0; i--) {
          defaultOption = merge(defaultOption, optList[i], true);
        }
        fields.defaultOption = defaultOption;
      }
      return fields.defaultOption;
    };
    ComponentModel2.prototype.getReferringComponents = function(mainType, opt) {
      var indexKey = mainType + "Index";
      var idKey = mainType + "Id";
      return queryReferringComponents(this.ecModel, mainType, {
        index: this.get(indexKey, true),
        id: this.get(idKey, true)
      }, opt);
    };
    ComponentModel2.prototype.getBoxLayoutParams = function() {
      return getBoxLayoutParams(this, false);
    };
    ComponentModel2.prototype.getZLevelKey = function() {
      return "";
    };
    ComponentModel2.prototype.setZLevel = function(zlevel) {
      this.option.zlevel = zlevel;
    };
    ComponentModel2.protoInitialize = (function() {
      var proto = ComponentModel2.prototype;
      proto.type = "component";
      proto.id = "";
      proto.name = "";
      proto.mainType = "";
      proto.subType = "";
      proto.componentIndex = 0;
    })();
    return ComponentModel2;
  })(Model_default)
);
mountExtend(ComponentModel, Model_default);
enableClassManagement(ComponentModel);
enableSubTypeDefaulter(ComponentModel);
enableTopologicalTravel(ComponentModel, getDependencies);
function getDependencies(componentType) {
  var deps = [];
  each(ComponentModel.getClassesByMainType(componentType), function(clz) {
    deps = deps.concat(clz.dependencies || clz.prototype.dependencies || []);
  });
  deps = map(deps, function(type) {
    return parseClassType(type).main;
  });
  if (componentType !== "dataset" && indexOf(deps, "dataset") <= 0) {
    deps.unshift("dataset");
  }
  return deps;
}
var Component_default = ComponentModel;

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/model/mixin/palette.js
var innerColor = makeInner();
var innerDecal = makeInner();
var PaletteMixin = (
  /** @class */
  (function() {
    function PaletteMixin2() {
    }
    PaletteMixin2.prototype.getColorFromPalette = function(name, scope, requestNum) {
      var defaultPalette = normalizeToArray(this.get("color", true));
      var layeredPalette = this.get("colorLayer", true);
      return getFromPalette(this, innerColor, defaultPalette, layeredPalette, name, scope, requestNum);
    };
    PaletteMixin2.prototype.clearColorPalette = function() {
      clearPalette(this, innerColor);
    };
    return PaletteMixin2;
  })()
);
function getNearestPalette(palettes, requestColorNum) {
  var paletteNum = palettes.length;
  for (var i = 0; i < paletteNum; i++) {
    if (palettes[i].length > requestColorNum) {
      return palettes[i];
    }
  }
  return palettes[paletteNum - 1];
}
function getFromPalette(that, inner5, defaultPalette, layeredPalette, name, scope, requestNum) {
  scope = scope || that;
  var scopeFields = inner5(scope);
  var paletteIdx = scopeFields.paletteIdx || 0;
  var paletteNameMap = scopeFields.paletteNameMap = scopeFields.paletteNameMap || {};
  if (paletteNameMap.hasOwnProperty(name)) {
    return paletteNameMap[name];
  }
  var palette = requestNum == null || !layeredPalette ? defaultPalette : getNearestPalette(layeredPalette, requestNum);
  palette = palette || defaultPalette;
  if (!palette || !palette.length) {
    return;
  }
  var pickedPaletteItem = palette[paletteIdx];
  if (name) {
    paletteNameMap[name] = pickedPaletteItem;
  }
  scopeFields.paletteIdx = (paletteIdx + 1) % palette.length;
  return pickedPaletteItem;
}
function clearPalette(that, inner5) {
  inner5(that).paletteIdx = 0;
  inner5(that).paletteNameMap = {};
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/data/helper/sourceHelper.js
var BE_ORDINAL = {
  Must: 1,
  Might: 2,
  Not: 3
  // Other cases
};
var innerGlobalModel = makeInner();
function querySeriesUpstreamDatasetModel(seriesModel) {
  var thisData = seriesModel.get("data", true);
  if (!thisData) {
    return queryReferringComponents(seriesModel.ecModel, "dataset", {
      index: seriesModel.get("datasetIndex", true),
      id: seriesModel.get("datasetId", true)
    }, SINGLE_REFERRING).models[0];
  }
}
function queryDatasetUpstreamDatasetModels(datasetModel) {
  if (!datasetModel.get("transform", true) && !datasetModel.get("fromTransformResult", true)) {
    return [];
  }
  return queryReferringComponents(datasetModel.ecModel, "dataset", {
    index: datasetModel.get("fromDatasetIndex", true),
    id: datasetModel.get("fromDatasetId", true)
  }, SINGLE_REFERRING).models;
}
function guessOrdinal(source, dimIndex) {
  return doGuessOrdinal(source.data, source.sourceFormat, source.seriesLayoutBy, source.dimensionsDefine, source.startIndex, dimIndex);
}
function doGuessOrdinal(data, sourceFormat, seriesLayoutBy, dimensionsDefine, startIndex, dimIndex) {
  var result;
  var maxLoop = 5;
  if (isTypedArray(data)) {
    return BE_ORDINAL.Not;
  }
  var dimName;
  var dimType;
  if (dimensionsDefine) {
    var dimDefItem = dimensionsDefine[dimIndex];
    if (isObject(dimDefItem)) {
      dimName = dimDefItem.name;
      dimType = dimDefItem.type;
    } else if (isString(dimDefItem)) {
      dimName = dimDefItem;
    }
  }
  if (dimType != null) {
    return dimType === "ordinal" ? BE_ORDINAL.Must : BE_ORDINAL.Not;
  }
  if (sourceFormat === SOURCE_FORMAT_ARRAY_ROWS) {
    var dataArrayRows = data;
    if (seriesLayoutBy === SERIES_LAYOUT_BY_ROW) {
      var sample = dataArrayRows[dimIndex];
      for (var i = 0; i < (sample || []).length && i < maxLoop; i++) {
        if ((result = detectValue(sample[startIndex + i])) != null) {
          return result;
        }
      }
    } else {
      for (var i = 0; i < dataArrayRows.length && i < maxLoop; i++) {
        var row = dataArrayRows[startIndex + i];
        if (row && (result = detectValue(row[dimIndex])) != null) {
          return result;
        }
      }
    }
  } else if (sourceFormat === SOURCE_FORMAT_OBJECT_ROWS) {
    var dataObjectRows = data;
    if (!dimName) {
      return BE_ORDINAL.Not;
    }
    for (var i = 0; i < dataObjectRows.length && i < maxLoop; i++) {
      var item = dataObjectRows[i];
      if (item && (result = detectValue(item[dimName])) != null) {
        return result;
      }
    }
  } else if (sourceFormat === SOURCE_FORMAT_KEYED_COLUMNS) {
    var dataKeyedColumns = data;
    if (!dimName) {
      return BE_ORDINAL.Not;
    }
    var sample = dataKeyedColumns[dimName];
    if (!sample || isTypedArray(sample)) {
      return BE_ORDINAL.Not;
    }
    for (var i = 0; i < sample.length && i < maxLoop; i++) {
      if ((result = detectValue(sample[i])) != null) {
        return result;
      }
    }
  } else if (sourceFormat === SOURCE_FORMAT_ORIGINAL) {
    var dataOriginal = data;
    for (var i = 0; i < dataOriginal.length && i < maxLoop; i++) {
      var item = dataOriginal[i];
      var val = getDataItemValue(item);
      if (!isArray(val)) {
        return BE_ORDINAL.Not;
      }
      if ((result = detectValue(val[dimIndex])) != null) {
        return result;
      }
    }
  }
  function detectValue(val2) {
    var beStr = isString(val2);
    if (val2 != null && isFinite(Number(val2)) && val2 !== "") {
      return beStr ? BE_ORDINAL.Might : BE_ORDINAL.Not;
    } else if (beStr && val2 !== "-") {
      return BE_ORDINAL.Must;
    }
  }
  return BE_ORDINAL.Not;
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/data/Source.js
var SourceImpl = (
  /** @class */
  /* @__PURE__ */ (function() {
    function SourceImpl2(fields) {
      this.data = fields.data || (fields.sourceFormat === SOURCE_FORMAT_KEYED_COLUMNS ? {} : []);
      this.sourceFormat = fields.sourceFormat || SOURCE_FORMAT_UNKNOWN;
      this.seriesLayoutBy = fields.seriesLayoutBy || SERIES_LAYOUT_BY_COLUMN;
      this.startIndex = fields.startIndex || 0;
      this.dimensionsDetectedCount = fields.dimensionsDetectedCount;
      this.metaRawOption = fields.metaRawOption;
      var dimensionsDefine = this.dimensionsDefine = fields.dimensionsDefine;
      if (dimensionsDefine) {
        for (var i = 0; i < dimensionsDefine.length; i++) {
          var dim = dimensionsDefine[i];
          if (dim.type == null) {
            if (guessOrdinal(this, i) === BE_ORDINAL.Must) {
              dim.type = "ordinal";
            }
          }
        }
      }
    }
    return SourceImpl2;
  })()
);
function isSourceInstance(val) {
  return val instanceof SourceImpl;
}
function createSource(sourceData, thisMetaRawOption, sourceFormat) {
  sourceFormat = sourceFormat || detectSourceFormat(sourceData);
  var seriesLayoutBy = thisMetaRawOption.seriesLayoutBy;
  var determined = determineSourceDimensions(sourceData, sourceFormat, seriesLayoutBy, thisMetaRawOption.sourceHeader, thisMetaRawOption.dimensions);
  var source = new SourceImpl({
    data: sourceData,
    sourceFormat,
    seriesLayoutBy,
    dimensionsDefine: determined.dimensionsDefine,
    startIndex: determined.startIndex,
    dimensionsDetectedCount: determined.dimensionsDetectedCount,
    metaRawOption: clone(thisMetaRawOption)
  });
  return source;
}
function createSourceFromSeriesDataOption(data) {
  return new SourceImpl({
    data,
    sourceFormat: isTypedArray(data) ? SOURCE_FORMAT_TYPED_ARRAY : SOURCE_FORMAT_ORIGINAL
  });
}
function cloneSourceShallow(source) {
  return new SourceImpl({
    data: source.data,
    sourceFormat: source.sourceFormat,
    seriesLayoutBy: source.seriesLayoutBy,
    dimensionsDefine: clone(source.dimensionsDefine),
    startIndex: source.startIndex,
    dimensionsDetectedCount: source.dimensionsDetectedCount
  });
}
function detectSourceFormat(data) {
  var sourceFormat = SOURCE_FORMAT_UNKNOWN;
  if (isTypedArray(data)) {
    sourceFormat = SOURCE_FORMAT_TYPED_ARRAY;
  } else if (isArray(data)) {
    if (data.length === 0) {
      sourceFormat = SOURCE_FORMAT_ARRAY_ROWS;
    }
    for (var i = 0, len2 = data.length; i < len2; i++) {
      var item = data[i];
      if (item == null) {
        continue;
      } else if (isArray(item) || isTypedArray(item)) {
        sourceFormat = SOURCE_FORMAT_ARRAY_ROWS;
        break;
      } else if (isObject(item)) {
        sourceFormat = SOURCE_FORMAT_OBJECT_ROWS;
        break;
      }
    }
  } else if (isObject(data)) {
    for (var key2 in data) {
      if (hasOwn(data, key2) && isArrayLike(data[key2])) {
        sourceFormat = SOURCE_FORMAT_KEYED_COLUMNS;
        break;
      }
    }
  }
  return sourceFormat;
}
function determineSourceDimensions(data, sourceFormat, seriesLayoutBy, sourceHeader, dimensionsDefine) {
  var dimensionsDetectedCount;
  var startIndex;
  if (!data) {
    return {
      dimensionsDefine: normalizeDimensionsOption(dimensionsDefine),
      startIndex,
      dimensionsDetectedCount
    };
  }
  if (sourceFormat === SOURCE_FORMAT_ARRAY_ROWS) {
    var dataArrayRows = data;
    if (sourceHeader === "auto" || sourceHeader == null) {
      arrayRowsTravelFirst(function(val) {
        if (val != null && val !== "-") {
          if (isString(val)) {
            startIndex == null && (startIndex = 1);
          } else {
            startIndex = 0;
          }
        }
      }, seriesLayoutBy, dataArrayRows, 10);
    } else {
      startIndex = isNumber(sourceHeader) ? sourceHeader : sourceHeader ? 1 : 0;
    }
    if (!dimensionsDefine && startIndex === 1) {
      dimensionsDefine = [];
      arrayRowsTravelFirst(function(val, index) {
        dimensionsDefine[index] = val != null ? val + "" : "";
      }, seriesLayoutBy, dataArrayRows, Infinity);
    }
    dimensionsDetectedCount = dimensionsDefine ? dimensionsDefine.length : seriesLayoutBy === SERIES_LAYOUT_BY_ROW ? dataArrayRows.length : dataArrayRows[0] ? dataArrayRows[0].length : null;
  } else if (sourceFormat === SOURCE_FORMAT_OBJECT_ROWS) {
    if (!dimensionsDefine) {
      dimensionsDefine = objectRowsCollectDimensions(data);
    }
  } else if (sourceFormat === SOURCE_FORMAT_KEYED_COLUMNS) {
    if (!dimensionsDefine) {
      dimensionsDefine = [];
      each(data, function(colArr, key2) {
        dimensionsDefine.push(key2);
      });
    }
  } else if (sourceFormat === SOURCE_FORMAT_ORIGINAL) {
    var value0 = getDataItemValue(data[0]);
    dimensionsDetectedCount = isArray(value0) && value0.length || 1;
  } else if (sourceFormat === SOURCE_FORMAT_TYPED_ARRAY) {
    if (false) {
      assert(!!dimensionsDefine, "dimensions must be given if data is TypedArray.");
    }
  }
  return {
    startIndex,
    dimensionsDefine: normalizeDimensionsOption(dimensionsDefine),
    dimensionsDetectedCount
  };
}
function objectRowsCollectDimensions(data) {
  var firstIndex = 0;
  var obj;
  while (firstIndex < data.length && !(obj = data[firstIndex++])) {
  }
  if (obj) {
    return keys(obj);
  }
}
function normalizeDimensionsOption(dimensionsDefine) {
  if (!dimensionsDefine) {
    return;
  }
  var nameMap = createHashMap();
  return map(dimensionsDefine, function(rawItem, index) {
    rawItem = isObject(rawItem) ? rawItem : {
      name: rawItem
    };
    var item = {
      name: rawItem.name,
      displayName: rawItem.displayName,
      type: rawItem.type
    };
    if (item.name == null) {
      return item;
    }
    item.name += "";
    if (item.displayName == null) {
      item.displayName = item.name;
    }
    var exist = nameMap.get(item.name);
    if (!exist) {
      nameMap.set(item.name, {
        count: 1
      });
    } else {
      item.name += "-" + exist.count++;
    }
    return item;
  });
}
function arrayRowsTravelFirst(cb, seriesLayoutBy, data, maxLoop) {
  if (seriesLayoutBy === SERIES_LAYOUT_BY_ROW) {
    for (var i = 0; i < data.length && i < maxLoop; i++) {
      cb(data[i] ? data[i][0] : null, i);
    }
  } else {
    var value0 = data[0] || [];
    for (var i = 0; i < value0.length && i < maxLoop; i++) {
      cb(value0[i], i);
    }
  }
}
function shouldRetrieveDataByName(source) {
  var sourceFormat = source.sourceFormat;
  return sourceFormat === SOURCE_FORMAT_OBJECT_ROWS || sourceFormat === SOURCE_FORMAT_KEYED_COLUMNS;
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/data/helper/dataProvider.js
var _a;
var _b;
var _c;
var _d;
var providerMethods;
var mountMethods;
var DefaultDataProvider = (
  /** @class */
  (function() {
    function DefaultDataProvider2(sourceParam, dimSize) {
      var source = !isSourceInstance(sourceParam) ? createSourceFromSeriesDataOption(sourceParam) : sourceParam;
      this._source = source;
      var data = this._data = source.data;
      var sourceFormat = source.sourceFormat;
      var seriesLayoutBy = source.seriesLayoutBy;
      if (sourceFormat === SOURCE_FORMAT_TYPED_ARRAY) {
        if (false) {
          if (dimSize == null) {
            throw new Error("Typed array data must specify dimension size");
          }
        }
        this._offset = 0;
        this._dimSize = dimSize;
        this._data = data;
      }
      if (false) {
        var validator = rawSourceDataValidatorMap[getMethodMapKey(sourceFormat, seriesLayoutBy)];
        validator && validator(data, source.dimensionsDefine);
      }
      mountMethods(this, data, source);
    }
    DefaultDataProvider2.prototype.getSource = function() {
      return this._source;
    };
    DefaultDataProvider2.prototype.count = function() {
      return 0;
    };
    DefaultDataProvider2.prototype.getItem = function(idx, out2) {
      return;
    };
    DefaultDataProvider2.prototype.appendData = function(newData) {
    };
    DefaultDataProvider2.prototype.clean = function() {
    };
    DefaultDataProvider2.protoInitialize = (function() {
      var proto = DefaultDataProvider2.prototype;
      proto.pure = false;
      proto.persistent = true;
    })();
    DefaultDataProvider2.internalField = (function() {
      var _a2;
      mountMethods = function(provider, data, source) {
        var sourceFormat = source.sourceFormat;
        var seriesLayoutBy = source.seriesLayoutBy;
        var startIndex = source.startIndex;
        var dimsDef = source.dimensionsDefine;
        var methods = providerMethods[getMethodMapKey(sourceFormat, seriesLayoutBy)];
        if (false) {
          assert(methods, "Invalide sourceFormat: " + sourceFormat);
        }
        extend(provider, methods);
        if (sourceFormat === SOURCE_FORMAT_TYPED_ARRAY) {
          provider.getItem = getItemForTypedArray;
          provider.count = countForTypedArray;
          provider.fillStorage = fillStorageForTypedArray;
        } else {
          var rawItemGetter = getRawSourceItemGetter(sourceFormat, seriesLayoutBy);
          provider.getItem = bind(rawItemGetter, null, data, startIndex, dimsDef);
          var rawCounter = getRawSourceDataCounter(sourceFormat, seriesLayoutBy);
          provider.count = bind(rawCounter, null, data, startIndex, dimsDef);
        }
      };
      var getItemForTypedArray = function(idx, out2) {
        idx = idx - this._offset;
        out2 = out2 || [];
        var data = this._data;
        var dimSize = this._dimSize;
        var offset = dimSize * idx;
        for (var i = 0; i < dimSize; i++) {
          out2[i] = data[offset + i];
        }
        return out2;
      };
      var fillStorageForTypedArray = function(start2, end2, storage, extent) {
        var data = this._data;
        var dimSize = this._dimSize;
        for (var dim = 0; dim < dimSize; dim++) {
          var dimExtent = extent[dim];
          var min3 = dimExtent[0] == null ? Infinity : dimExtent[0];
          var max3 = dimExtent[1] == null ? -Infinity : dimExtent[1];
          var count = end2 - start2;
          var arr = storage[dim];
          for (var i = 0; i < count; i++) {
            var val = data[i * dimSize + dim];
            arr[start2 + i] = val;
            val < min3 && (min3 = val);
            val > max3 && (max3 = val);
          }
          dimExtent[0] = min3;
          dimExtent[1] = max3;
        }
      };
      var countForTypedArray = function() {
        return this._data ? this._data.length / this._dimSize : 0;
      };
      providerMethods = (_a2 = {}, _a2[SOURCE_FORMAT_ARRAY_ROWS + "_" + SERIES_LAYOUT_BY_COLUMN] = {
        pure: true,
        appendData: appendDataSimply
      }, _a2[SOURCE_FORMAT_ARRAY_ROWS + "_" + SERIES_LAYOUT_BY_ROW] = {
        pure: true,
        appendData: function() {
          throw new Error('Do not support appendData when set seriesLayoutBy: "row".');
        }
      }, _a2[SOURCE_FORMAT_OBJECT_ROWS] = {
        pure: true,
        appendData: appendDataSimply
      }, _a2[SOURCE_FORMAT_KEYED_COLUMNS] = {
        pure: true,
        appendData: function(newData) {
          var data = this._data;
          each(newData, function(newCol, key2) {
            var oldCol = data[key2] || (data[key2] = []);
            for (var i = 0; i < (newCol || []).length; i++) {
              oldCol.push(newCol[i]);
            }
          });
        }
      }, _a2[SOURCE_FORMAT_ORIGINAL] = {
        appendData: appendDataSimply
      }, _a2[SOURCE_FORMAT_TYPED_ARRAY] = {
        persistent: false,
        pure: true,
        appendData: function(newData) {
          if (false) {
            assert(isTypedArray(newData), "Added data must be TypedArray if data in initialization is TypedArray");
          }
          this._data = newData;
        },
        // Clean self if data is already used.
        clean: function() {
          this._offset += this.count();
          this._data = null;
        }
      }, _a2);
      function appendDataSimply(newData) {
        for (var i = 0; i < newData.length; i++) {
          this._data.push(newData[i]);
        }
      }
    })();
    return DefaultDataProvider2;
  })()
);
var validateSimply = function(rawData) {
  if (!isArray(rawData)) {
    error("series.data or dataset.source must be an array.");
  }
};
var rawSourceDataValidatorMap = (_a = {}, _a[SOURCE_FORMAT_ARRAY_ROWS + "_" + SERIES_LAYOUT_BY_COLUMN] = validateSimply, _a[SOURCE_FORMAT_ARRAY_ROWS + "_" + SERIES_LAYOUT_BY_ROW] = validateSimply, _a[SOURCE_FORMAT_OBJECT_ROWS] = validateSimply, _a[SOURCE_FORMAT_KEYED_COLUMNS] = function(rawData, dimsDef) {
  for (var i = 0; i < dimsDef.length; i++) {
    var dimName = dimsDef[i].name;
    if (dimName == null) {
      error("dimension name must not be null/undefined.");
    }
  }
}, _a[SOURCE_FORMAT_ORIGINAL] = validateSimply, _a);
var getItemSimply = function(rawData, startIndex, dimsDef, idx) {
  return rawData[idx];
};
var rawSourceItemGetterMap = (_b = {}, _b[SOURCE_FORMAT_ARRAY_ROWS + "_" + SERIES_LAYOUT_BY_COLUMN] = function(rawData, startIndex, dimsDef, idx) {
  return rawData[idx + startIndex];
}, _b[SOURCE_FORMAT_ARRAY_ROWS + "_" + SERIES_LAYOUT_BY_ROW] = function(rawData, startIndex, dimsDef, idx, out2) {
  idx += startIndex;
  var item = out2 || [];
  var data = rawData;
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    item[i] = row ? row[idx] : null;
  }
  return item;
}, _b[SOURCE_FORMAT_OBJECT_ROWS] = getItemSimply, _b[SOURCE_FORMAT_KEYED_COLUMNS] = function(rawData, startIndex, dimsDef, idx, out2) {
  var item = out2 || [];
  for (var i = 0; i < dimsDef.length; i++) {
    var dimName = dimsDef[i].name;
    var col = dimName != null ? rawData[dimName] : null;
    item[i] = col ? col[idx] : null;
  }
  return item;
}, _b[SOURCE_FORMAT_ORIGINAL] = getItemSimply, _b);
function getRawSourceItemGetter(sourceFormat, seriesLayoutBy) {
  var method = rawSourceItemGetterMap[getMethodMapKey(sourceFormat, seriesLayoutBy)];
  if (false) {
    assert(method, 'Do not support get item on "' + sourceFormat + '", "' + seriesLayoutBy + '".');
  }
  return method;
}
var countSimply = function(rawData, startIndex, dimsDef) {
  return rawData.length;
};
var rawSourceDataCounterMap = (_c = {}, _c[SOURCE_FORMAT_ARRAY_ROWS + "_" + SERIES_LAYOUT_BY_COLUMN] = function(rawData, startIndex, dimsDef) {
  return Math.max(0, rawData.length - startIndex);
}, _c[SOURCE_FORMAT_ARRAY_ROWS + "_" + SERIES_LAYOUT_BY_ROW] = function(rawData, startIndex, dimsDef) {
  var row = rawData[0];
  return row ? Math.max(0, row.length - startIndex) : 0;
}, _c[SOURCE_FORMAT_OBJECT_ROWS] = countSimply, _c[SOURCE_FORMAT_KEYED_COLUMNS] = function(rawData, startIndex, dimsDef) {
  var dimName = dimsDef[0].name;
  var col = dimName != null ? rawData[dimName] : null;
  return col ? col.length : 0;
}, _c[SOURCE_FORMAT_ORIGINAL] = countSimply, _c);
function getRawSourceDataCounter(sourceFormat, seriesLayoutBy) {
  var method = rawSourceDataCounterMap[getMethodMapKey(sourceFormat, seriesLayoutBy)];
  if (false) {
    assert(method, 'Do not support count on "' + sourceFormat + '", "' + seriesLayoutBy + '".');
  }
  return method;
}
var getRawValueSimply = function(dataItem, dimIndex, property) {
  return dataItem[dimIndex];
};
var rawSourceValueGetterMap = (_d = {}, _d[SOURCE_FORMAT_ARRAY_ROWS] = getRawValueSimply, _d[SOURCE_FORMAT_OBJECT_ROWS] = function(dataItem, dimIndex, property) {
  return dataItem[property];
}, _d[SOURCE_FORMAT_KEYED_COLUMNS] = getRawValueSimply, _d[SOURCE_FORMAT_ORIGINAL] = function(dataItem, dimIndex, property) {
  var value = getDataItemValue(dataItem);
  return !(value instanceof Array) ? value : value[dimIndex];
}, _d[SOURCE_FORMAT_TYPED_ARRAY] = getRawValueSimply, _d);
function getRawSourceValueGetter(sourceFormat) {
  var method = rawSourceValueGetterMap[sourceFormat];
  if (false) {
    assert(method, 'Do not support get value on "' + sourceFormat + '".');
  }
  return method;
}
function getMethodMapKey(sourceFormat, seriesLayoutBy) {
  return sourceFormat === SOURCE_FORMAT_ARRAY_ROWS ? sourceFormat + "_" + seriesLayoutBy : sourceFormat;
}
function retrieveRawValue(data, dataIndex, dim) {
  if (!data) {
    return;
  }
  var dataItem = data.getRawDataItem(dataIndex);
  if (dataItem == null) {
    return;
  }
  var store = data.getStore();
  var sourceFormat = store.getSource().sourceFormat;
  if (dim != null) {
    var dimIndex = data.getDimensionIndex(dim);
    var property = store.getDimensionProperty(dimIndex);
    return getRawSourceValueGetter(sourceFormat)(dataItem, dimIndex, property);
  } else {
    var result = dataItem;
    if (sourceFormat === SOURCE_FORMAT_ORIGINAL) {
      result = getDataItemValue(dataItem);
    }
    return result;
  }
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/model/mixin/dataFormat.js
var DIMENSION_LABEL_REG = /\{@(.+?)\}/g;
var DataFormatMixin = (
  /** @class */
  (function() {
    function DataFormatMixin2() {
    }
    DataFormatMixin2.prototype.getDataParams = function(dataIndex, dataType) {
      var data = this.getData(dataType);
      var rawValue = this.getRawValue(dataIndex, dataType);
      var rawDataIndex = data.getRawIndex(dataIndex);
      var name = data.getName(dataIndex);
      var itemOpt = data.getRawDataItem(dataIndex);
      var style = data.getItemVisual(dataIndex, "style");
      var color2 = style && style[data.getItemVisual(dataIndex, "drawType") || "fill"];
      var borderColor = style && style.stroke;
      var mainType = this.mainType;
      var isSeries2 = mainType === "series";
      var userOutput = data.userOutput && data.userOutput.get();
      return {
        componentType: mainType,
        componentSubType: this.subType,
        componentIndex: this.componentIndex,
        seriesType: isSeries2 ? this.subType : null,
        seriesIndex: this.seriesIndex,
        seriesId: isSeries2 ? this.id : null,
        seriesName: isSeries2 ? this.name : null,
        name,
        dataIndex: rawDataIndex,
        data: itemOpt,
        dataType,
        value: rawValue,
        color: color2,
        borderColor,
        dimensionNames: userOutput ? userOutput.fullDimensions : null,
        encode: userOutput ? userOutput.encode : null,
        // Param name list for mapping `a`, `b`, `c`, `d`, `e`
        $vars: ["seriesName", "name", "value"]
      };
    };
    DataFormatMixin2.prototype.getFormattedLabel = function(dataIndex, status, dataType, labelDimIndex, formatter, extendParams) {
      status = status || "normal";
      var data = this.getData(dataType);
      var params = this.getDataParams(dataIndex, dataType);
      if (extendParams) {
        params.value = extendParams.interpolatedValue;
      }
      if (labelDimIndex != null && isArray(params.value)) {
        params.value = params.value[labelDimIndex];
      }
      if (!formatter) {
        var itemModel = data.getItemModel(dataIndex);
        formatter = itemModel.get(status === "normal" ? ["label", "formatter"] : [status, "label", "formatter"]);
      }
      if (isFunction(formatter)) {
        params.status = status;
        params.dimensionIndex = labelDimIndex;
        return formatter(params);
      } else if (isString(formatter)) {
        var str = formatTpl(formatter, params);
        return str.replace(DIMENSION_LABEL_REG, function(origin, dimStr) {
          var len2 = dimStr.length;
          var dimLoose = dimStr;
          if (dimLoose.charAt(0) === "[" && dimLoose.charAt(len2 - 1) === "]") {
            dimLoose = +dimLoose.slice(1, len2 - 1);
            if (false) {
              if (isNaN(dimLoose)) {
                error("Invalide label formatter: @" + dimStr + ", only support @[0], @[1], @[2], ...");
              }
            }
          }
          var val = retrieveRawValue(data, dataIndex, dimLoose);
          if (extendParams && isArray(extendParams.interpolatedValue)) {
            var dimIndex = data.getDimensionIndex(dimLoose);
            if (dimIndex >= 0) {
              val = extendParams.interpolatedValue[dimIndex];
            }
          }
          return val != null ? val + "" : "";
        });
      }
    };
    DataFormatMixin2.prototype.getRawValue = function(idx, dataType) {
      return retrieveRawValue(this.getData(dataType), idx);
    };
    DataFormatMixin2.prototype.formatTooltip = function(dataIndex, multipleSeries, dataType) {
      return;
    };
    return DataFormatMixin2;
  })()
);

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/core/task.js
function createTask(define) {
  return new Task(define);
}
var Task = (
  /** @class */
  (function() {
    function Task2(define) {
      define = define || {};
      this._reset = define.reset;
      this._plan = define.plan;
      this._count = define.count;
      this._onDirty = define.onDirty;
      this._dirty = true;
    }
    Task2.prototype.perform = function(performArgs) {
      var upTask = this._upstream;
      var skip = performArgs && performArgs.skip;
      if (this._dirty && upTask) {
        var context = this.context;
        context.data = context.outputData = upTask.context.outputData;
      }
      if (this.__pipeline) {
        this.__pipeline.currentTask = this;
      }
      var planResult;
      if (this._plan && !skip) {
        planResult = this._plan(this.context);
      }
      var lastModBy = normalizeModBy(this._modBy);
      var lastModDataCount = this._modDataCount || 0;
      var modBy = normalizeModBy(performArgs && performArgs.modBy);
      var modDataCount = performArgs && performArgs.modDataCount || 0;
      if (lastModBy !== modBy || lastModDataCount !== modDataCount) {
        planResult = "reset";
      }
      function normalizeModBy(val) {
        !(val >= 1) && (val = 1);
        return val;
      }
      var forceFirstProgress;
      if (this._dirty || planResult === "reset") {
        this._dirty = false;
        forceFirstProgress = this._doReset(skip);
      }
      this._modBy = modBy;
      this._modDataCount = modDataCount;
      var step = performArgs && performArgs.step;
      if (upTask) {
        if (false) {
          assert(upTask._outputDueEnd != null);
        }
        this._dueEnd = upTask._outputDueEnd;
      } else {
        if (false) {
          assert(!this._progress || this._count);
        }
        this._dueEnd = this._count ? this._count(this.context) : Infinity;
      }
      if (this._progress) {
        var start2 = this._dueIndex;
        var end2 = Math.min(step != null ? this._dueIndex + step : Infinity, this._dueEnd);
        if (!skip && (forceFirstProgress || start2 < end2)) {
          var progress = this._progress;
          if (isArray(progress)) {
            for (var i = 0; i < progress.length; i++) {
              this._doProgress(progress[i], start2, end2, modBy, modDataCount);
            }
          } else {
            this._doProgress(progress, start2, end2, modBy, modDataCount);
          }
        }
        this._dueIndex = end2;
        var outputDueEnd = this._settedOutputEnd != null ? this._settedOutputEnd : end2;
        if (false) {
          assert(outputDueEnd >= this._outputDueEnd);
        }
        this._outputDueEnd = outputDueEnd;
      } else {
        this._dueIndex = this._outputDueEnd = this._settedOutputEnd != null ? this._settedOutputEnd : this._dueEnd;
      }
      return this.unfinished();
    };
    Task2.prototype.dirty = function() {
      this._dirty = true;
      this._onDirty && this._onDirty(this.context);
    };
    Task2.prototype._doProgress = function(progress, start2, end2, modBy, modDataCount) {
      iterator.reset(start2, end2, modBy, modDataCount);
      this._callingProgress = progress;
      this._callingProgress({
        start: start2,
        end: end2,
        count: end2 - start2,
        next: iterator.next
      }, this.context);
    };
    Task2.prototype._doReset = function(skip) {
      this._dueIndex = this._outputDueEnd = this._dueEnd = 0;
      this._settedOutputEnd = null;
      var progress;
      var forceFirstProgress;
      if (!skip && this._reset) {
        progress = this._reset(this.context);
        if (progress && progress.progress) {
          forceFirstProgress = progress.forceFirstProgress;
          progress = progress.progress;
        }
        if (isArray(progress) && !progress.length) {
          progress = null;
        }
      }
      this._progress = progress;
      this._modBy = this._modDataCount = null;
      var downstream = this._downstream;
      downstream && downstream.dirty();
      return forceFirstProgress;
    };
    Task2.prototype.unfinished = function() {
      return this._progress && this._dueIndex < this._dueEnd;
    };
    Task2.prototype.pipe = function(downTask) {
      if (false) {
        assert(downTask && !downTask._disposed && downTask !== this);
      }
      if (this._downstream !== downTask || this._dirty) {
        this._downstream = downTask;
        downTask._upstream = this;
        downTask.dirty();
      }
    };
    Task2.prototype.dispose = function() {
      if (this._disposed) {
        return;
      }
      this._upstream && (this._upstream._downstream = null);
      this._downstream && (this._downstream._upstream = null);
      this._dirty = false;
      this._disposed = true;
    };
    Task2.prototype.getUpstream = function() {
      return this._upstream;
    };
    Task2.prototype.getDownstream = function() {
      return this._downstream;
    };
    Task2.prototype.setOutputEnd = function(end2) {
      this._outputDueEnd = this._settedOutputEnd = end2;
    };
    return Task2;
  })()
);
var iterator = /* @__PURE__ */ (function() {
  var end2;
  var current;
  var modBy;
  var modDataCount;
  var winCount;
  var it = {
    reset: function(s, e2, sStep, sCount) {
      current = s;
      end2 = e2;
      modBy = sStep;
      modDataCount = sCount;
      winCount = Math.ceil(modDataCount / modBy);
      it.next = modBy > 1 && modDataCount > 0 ? modNext : sequentialNext;
    }
  };
  return it;
  function sequentialNext() {
    return current < end2 ? current++ : null;
  }
  function modNext() {
    var dataIndex = current % winCount * modBy + Math.ceil(current / winCount);
    var result = current >= end2 ? null : dataIndex < modDataCount ? dataIndex : current;
    current++;
    return result;
  }
})();

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/data/helper/dataValueHelper.js
function parseDataValue(value, opt) {
  var dimType = opt && opt.type;
  if (dimType === "ordinal") {
    return value;
  }
  if (dimType === "time" && !isNumber(value) && value != null && value !== "-") {
    value = +parseDate(value);
  }
  return value == null || value === "" ? NaN : Number(value);
}
var valueParserMap = createHashMap({
  "number": function(val) {
    return parseFloat(val);
  },
  "time": function(val) {
    return +parseDate(val);
  },
  "trim": function(val) {
    return isString(val) ? trim(val) : val;
  }
});
var ORDER_COMPARISON_OP_MAP = {
  lt: function(lval, rval) {
    return lval < rval;
  },
  lte: function(lval, rval) {
    return lval <= rval;
  },
  gt: function(lval, rval) {
    return lval > rval;
  },
  gte: function(lval, rval) {
    return lval >= rval;
  }
};
var FilterOrderComparator = (
  /** @class */
  (function() {
    function FilterOrderComparator2(op, rval) {
      if (!isNumber(rval)) {
        var errMsg = "";
        if (false) {
          errMsg = 'rvalue of "<", ">", "<=", ">=" can only be number in filter.';
        }
        throwError(errMsg);
      }
      this._opFn = ORDER_COMPARISON_OP_MAP[op];
      this._rvalFloat = numericToNumber(rval);
    }
    FilterOrderComparator2.prototype.evaluate = function(lval) {
      return isNumber(lval) ? this._opFn(lval, this._rvalFloat) : this._opFn(numericToNumber(lval), this._rvalFloat);
    };
    return FilterOrderComparator2;
  })()
);
var SortOrderComparator = (
  /** @class */
  (function() {
    function SortOrderComparator2(order, incomparable) {
      var isDesc = order === "desc";
      this._resultLT = isDesc ? 1 : -1;
      if (incomparable == null) {
        incomparable = isDesc ? "min" : "max";
      }
      this._incomparable = incomparable === "min" ? -Infinity : Infinity;
    }
    SortOrderComparator2.prototype.evaluate = function(lval, rval) {
      var lvalFloat = isNumber(lval) ? lval : numericToNumber(lval);
      var rvalFloat = isNumber(rval) ? rval : numericToNumber(rval);
      var lvalNotNumeric = isNaN(lvalFloat);
      var rvalNotNumeric = isNaN(rvalFloat);
      if (lvalNotNumeric) {
        lvalFloat = this._incomparable;
      }
      if (rvalNotNumeric) {
        rvalFloat = this._incomparable;
      }
      if (lvalNotNumeric && rvalNotNumeric) {
        var lvalIsStr = isString(lval);
        var rvalIsStr = isString(rval);
        if (lvalIsStr) {
          lvalFloat = rvalIsStr ? lval : 0;
        }
        if (rvalIsStr) {
          rvalFloat = lvalIsStr ? rval : 0;
        }
      }
      return lvalFloat < rvalFloat ? this._resultLT : lvalFloat > rvalFloat ? -this._resultLT : 0;
    };
    return SortOrderComparator2;
  })()
);
var FilterEqualityComparator = (
  /** @class */
  (function() {
    function FilterEqualityComparator2(isEq, rval) {
      this._rval = rval;
      this._isEQ = isEq;
      this._rvalTypeof = typeof rval;
      this._rvalFloat = numericToNumber(rval);
    }
    FilterEqualityComparator2.prototype.evaluate = function(lval) {
      var eqResult = lval === this._rval;
      if (!eqResult) {
        var lvalTypeof = typeof lval;
        if (lvalTypeof !== this._rvalTypeof && (lvalTypeof === "number" || this._rvalTypeof === "number")) {
          eqResult = numericToNumber(lval) === this._rvalFloat;
        }
      }
      return this._isEQ ? eqResult : !eqResult;
    };
    return FilterEqualityComparator2;
  })()
);
function parseSanitizationFilter(filter2) {
  var filterKey = "";
  var filterG = -Infinity;
  var filterGE = -Infinity;
  var filterL = Infinity;
  var filterLE = Infinity;
  if (filter2) {
    if (filter2.g != null) {
      filterKey += "G" + filter2.g;
      filterG = filter2.g;
    }
    if (filter2.ge != null) {
      filterKey += "GE" + filter2.ge;
      filterGE = filter2.ge;
    }
    if (filter2.l != null) {
      filterKey += "L" + filter2.l;
      filterL = filter2.l;
    }
    if (filter2.le != null) {
      filterKey += "LE" + filter2.le;
      filterLE = filter2.le;
    }
  }
  return {
    key: filterKey,
    g: filterG,
    ge: filterGE,
    l: filterL,
    le: filterLE
  };
}
function passesSanitizationFilter(filterParsed, value) {
  return value > filterParsed.g && value >= filterParsed.ge && value < filterParsed.l && value <= filterParsed.le;
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/data/helper/transform.js
var ExternalSource = (
  /** @class */
  (function() {
    function ExternalSource2() {
    }
    ExternalSource2.prototype.getRawData = function() {
      throw new Error("not supported");
    };
    ExternalSource2.prototype.getRawDataItem = function(dataIndex) {
      throw new Error("not supported");
    };
    ExternalSource2.prototype.cloneRawData = function() {
      return;
    };
    ExternalSource2.prototype.getDimensionInfo = function(dim) {
      return;
    };
    ExternalSource2.prototype.cloneAllDimensionInfo = function() {
      return;
    };
    ExternalSource2.prototype.count = function() {
      return;
    };
    ExternalSource2.prototype.retrieveValue = function(dataIndex, dimIndex) {
      return;
    };
    ExternalSource2.prototype.retrieveValueFromItem = function(dataItem, dimIndex) {
      return;
    };
    ExternalSource2.prototype.convertValue = function(rawVal, dimInfo) {
      return parseDataValue(rawVal, dimInfo);
    };
    return ExternalSource2;
  })()
);
function createExternalSource(internalSource, externalTransform) {
  var extSource = new ExternalSource();
  var data = internalSource.data;
  var sourceFormat = extSource.sourceFormat = internalSource.sourceFormat;
  var sourceHeaderCount = internalSource.startIndex;
  var errMsg = "";
  if (internalSource.seriesLayoutBy !== SERIES_LAYOUT_BY_COLUMN) {
    if (false) {
      errMsg = '`seriesLayoutBy` of upstream dataset can only be "column" in data transform.';
    }
    throwError(errMsg);
  }
  var dimensions = [];
  var dimsByName = {};
  var dimsDef = internalSource.dimensionsDefine;
  if (dimsDef) {
    each(dimsDef, function(dimDef, idx) {
      var name = dimDef.name;
      var dimDefExt = {
        index: idx,
        name,
        displayName: dimDef.displayName
      };
      dimensions.push(dimDefExt);
      if (name != null) {
        var errMsg_1 = "";
        if (hasOwn(dimsByName, name)) {
          if (false) {
            errMsg_1 = 'dimension name "' + name + '" duplicated.';
          }
          throwError(errMsg_1);
        }
        dimsByName[name] = dimDefExt;
      }
    });
  } else {
    for (var i = 0; i < internalSource.dimensionsDetectedCount || 0; i++) {
      dimensions.push({
        index: i
      });
    }
  }
  var rawItemGetter = getRawSourceItemGetter(sourceFormat, SERIES_LAYOUT_BY_COLUMN);
  if (externalTransform.__isBuiltIn) {
    extSource.getRawDataItem = function(dataIndex) {
      return rawItemGetter(data, sourceHeaderCount, dimensions, dataIndex);
    };
    extSource.getRawData = bind(getRawData, null, internalSource);
  }
  extSource.cloneRawData = bind(cloneRawData, null, internalSource);
  var rawCounter = getRawSourceDataCounter(sourceFormat, SERIES_LAYOUT_BY_COLUMN);
  extSource.count = bind(rawCounter, null, data, sourceHeaderCount, dimensions);
  var rawValueGetter = getRawSourceValueGetter(sourceFormat);
  extSource.retrieveValue = function(dataIndex, dimIndex) {
    var rawItem = rawItemGetter(data, sourceHeaderCount, dimensions, dataIndex);
    return retrieveValueFromItem(rawItem, dimIndex);
  };
  var retrieveValueFromItem = extSource.retrieveValueFromItem = function(dataItem, dimIndex) {
    if (dataItem == null) {
      return;
    }
    var dimDef = dimensions[dimIndex];
    if (dimDef) {
      return rawValueGetter(dataItem, dimIndex, dimDef.name);
    }
  };
  extSource.getDimensionInfo = bind(getDimensionInfo, null, dimensions, dimsByName);
  extSource.cloneAllDimensionInfo = bind(cloneAllDimensionInfo, null, dimensions);
  return extSource;
}
function getRawData(upstream) {
  var sourceFormat = upstream.sourceFormat;
  if (!isSupportedSourceFormat(sourceFormat)) {
    var errMsg = "";
    if (false) {
      errMsg = "`getRawData` is not supported in source format " + sourceFormat;
    }
    throwError(errMsg);
  }
  return upstream.data;
}
function cloneRawData(upstream) {
  var sourceFormat = upstream.sourceFormat;
  var data = upstream.data;
  if (!isSupportedSourceFormat(sourceFormat)) {
    var errMsg = "";
    if (false) {
      errMsg = "`cloneRawData` is not supported in source format " + sourceFormat;
    }
    throwError(errMsg);
  }
  if (sourceFormat === SOURCE_FORMAT_ARRAY_ROWS) {
    var result = [];
    for (var i = 0, len2 = data.length; i < len2; i++) {
      result.push(data[i].slice());
    }
    return result;
  } else if (sourceFormat === SOURCE_FORMAT_OBJECT_ROWS) {
    var result = [];
    for (var i = 0, len2 = data.length; i < len2; i++) {
      result.push(extend({}, data[i]));
    }
    return result;
  }
}
function getDimensionInfo(dimensions, dimsByName, dim) {
  if (dim == null) {
    return;
  }
  if (isNumber(dim) || !isNaN(dim) && !hasOwn(dimsByName, dim)) {
    return dimensions[dim];
  } else if (hasOwn(dimsByName, dim)) {
    return dimsByName[dim];
  }
}
function cloneAllDimensionInfo(dimensions) {
  return clone(dimensions);
}
var externalTransformMap = createHashMap();
function applyDataTransform(rawTransOption, sourceList, infoForPrint) {
  var pipedTransOption = normalizeToArray(rawTransOption);
  var pipeLen = pipedTransOption.length;
  var errMsg = "";
  if (!pipeLen) {
    if (false) {
      errMsg = "If `transform` declared, it should at least contain one transform.";
    }
    throwError(errMsg);
  }
  for (var i = 0, len2 = pipeLen; i < len2; i++) {
    var transOption = pipedTransOption[i];
    sourceList = applySingleDataTransform(transOption, sourceList, infoForPrint, pipeLen === 1 ? null : i);
    if (i !== len2 - 1) {
      sourceList.length = Math.max(sourceList.length, 1);
    }
  }
  return sourceList;
}
function applySingleDataTransform(transOption, upSourceList, infoForPrint, pipeIndex) {
  var errMsg = "";
  if (!upSourceList.length) {
    if (false) {
      errMsg = "Must have at least one upstream dataset.";
    }
    throwError(errMsg);
  }
  if (!isObject(transOption)) {
    if (false) {
      errMsg = "transform declaration must be an object rather than " + typeof transOption + ".";
    }
    throwError(errMsg);
  }
  var transType = transOption.type;
  var externalTransform = externalTransformMap.get(transType);
  if (!externalTransform) {
    if (false) {
      errMsg = 'Can not find transform on type "' + transType + '".';
    }
    throwError(errMsg);
  }
  var extUpSourceList = map(upSourceList, function(upSource) {
    return createExternalSource(upSource, externalTransform);
  });
  var resultList = normalizeToArray(externalTransform.transform({
    upstream: extUpSourceList[0],
    upstreamList: extUpSourceList,
    config: clone(transOption.config)
  }));
  if (false) {
    if (transOption.print) {
      var printStrArr = map(resultList, function(extSource) {
        var pipeIndexStr = pipeIndex != null ? " === pipe index: " + pipeIndex : "";
        return ["=== dataset index: " + infoForPrint.datasetIndex + pipeIndexStr + " ===", "- transform result data:", makePrintable(extSource.data), "- transform result dimensions:", makePrintable(extSource.dimensions)].join("\n");
      }).join("\n");
      log(printStrArr);
    }
  }
  return map(resultList, function(result, resultIndex) {
    var errMsg2 = "";
    if (!isObject(result)) {
      if (false) {
        errMsg2 = "A transform should not return some empty results.";
      }
      throwError(errMsg2);
    }
    if (!result.data) {
      if (false) {
        errMsg2 = "Transform result data should be not be null or undefined";
      }
      throwError(errMsg2);
    }
    var sourceFormat = detectSourceFormat(result.data);
    if (!isSupportedSourceFormat(sourceFormat)) {
      if (false) {
        errMsg2 = "Transform result data should be array rows or object rows.";
      }
      throwError(errMsg2);
    }
    var resultMetaRawOption;
    var firstUpSource = upSourceList[0];
    if (firstUpSource && resultIndex === 0 && !result.dimensions) {
      var startIndex = firstUpSource.startIndex;
      if (startIndex) {
        result.data = firstUpSource.data.slice(0, startIndex).concat(result.data);
      }
      resultMetaRawOption = {
        seriesLayoutBy: SERIES_LAYOUT_BY_COLUMN,
        sourceHeader: startIndex,
        dimensions: firstUpSource.metaRawOption.dimensions
      };
    } else {
      resultMetaRawOption = {
        seriesLayoutBy: SERIES_LAYOUT_BY_COLUMN,
        sourceHeader: 0,
        dimensions: result.dimensions
      };
    }
    return createSource(result.data, resultMetaRawOption, null);
  });
}
function isSupportedSourceFormat(sourceFormat) {
  return sourceFormat === SOURCE_FORMAT_ARRAY_ROWS || sourceFormat === SOURCE_FORMAT_OBJECT_ROWS;
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/data/DataStore.js
var CtorUint32Array = typeof Uint32Array === UNDEFINED_STR ? Array : Uint32Array;
var CtorUint16Array = typeof Uint16Array === UNDEFINED_STR ? Array : Uint16Array;
var CtorInt32Array = typeof Int32Array === UNDEFINED_STR ? Array : Int32Array;
var CtorFloat64Array = typeof Float64Array === UNDEFINED_STR ? Array : Float64Array;
var dataCtors = {
  "float": CtorFloat64Array,
  "int": CtorInt32Array,
  // Ordinal data type can be string or int
  "ordinal": Array,
  "number": Array,
  "time": CtorFloat64Array
};
var defaultDimValueGetters;
function getIndicesCtor(rawCount) {
  return rawCount > 65535 ? CtorUint32Array : CtorUint16Array;
}
function cloneChunk(originalChunk) {
  var Ctor = originalChunk.constructor;
  return Ctor === Array ? originalChunk.slice() : new Ctor(originalChunk);
}
function prepareStore(store, dimIdx, dimType, end2, append) {
  var DataCtor = dataCtors[dimType || "float"];
  if (append) {
    var oldStore = store[dimIdx];
    var oldLen = oldStore && oldStore.length;
    if (!(oldLen === end2)) {
      var newStore = new DataCtor(end2);
      for (var j = 0; j < oldLen; j++) {
        newStore[j] = oldStore[j];
      }
      store[dimIdx] = newStore;
    }
  } else {
    store[dimIdx] = new DataCtor(end2);
  }
}
var DataStore = (
  /** @class */
  (function() {
    function DataStore2() {
      this._chunks = [];
      this._rawExtent = [];
      this._extent = [];
      this._count = 0;
      this._rawCount = 0;
      this._calcDimNameToIdx = createHashMap();
    }
    DataStore2.prototype.initData = function(provider, inputDimensions, dimValueGetter) {
      if (false) {
        assert(isFunction(provider.getItem) && isFunction(provider.count), "Invalid data provider.");
      }
      this._provider = provider;
      this._chunks = [];
      this._indices = null;
      this.getRawIndex = this._getRawIdxIdentity;
      var source = provider.getSource();
      var defaultGetter = this.defaultDimValueGetter = defaultDimValueGetters[source.sourceFormat];
      this._dimValueGetter = dimValueGetter || defaultGetter;
      this._rawExtent = [];
      var willRetrieveDataByName = shouldRetrieveDataByName(source);
      this._dimensions = map(inputDimensions, function(dim) {
        if (false) {
          if (willRetrieveDataByName) {
            assert(dim.property != null);
          }
        }
        return {
          // Only pick these two props. Not leak other properties like orderMeta.
          type: dim.type,
          property: dim.property
        };
      });
      this._initDataFromProvider(0, provider.count());
    };
    DataStore2.prototype.getProvider = function() {
      return this._provider;
    };
    DataStore2.prototype.getSource = function() {
      return this._provider.getSource();
    };
    DataStore2.prototype.ensureCalculationDimension = function(dimName, type) {
      var calcDimNameToIdx = this._calcDimNameToIdx;
      var dimensions = this._dimensions;
      var calcDimIdx = calcDimNameToIdx.get(dimName);
      if (calcDimIdx != null) {
        if (dimensions[calcDimIdx].type === type) {
          return calcDimIdx;
        }
      } else {
        calcDimIdx = dimensions.length;
      }
      dimensions[calcDimIdx] = {
        type
      };
      calcDimNameToIdx.set(dimName, calcDimIdx);
      this._chunks[calcDimIdx] = new dataCtors[type || "float"](this._rawCount);
      this._rawExtent[calcDimIdx] = initExtentForUnion();
      return calcDimIdx;
    };
    DataStore2.prototype.collectOrdinalMeta = function(dimIdx, ordinalMeta) {
      var chunk = this._chunks[dimIdx];
      var dim = this._dimensions[dimIdx];
      var rawExtents = this._rawExtent;
      var offset = dim.ordinalOffset || 0;
      var len2 = chunk.length;
      if (offset === 0) {
        rawExtents[dimIdx] = initExtentForUnion();
      }
      var dimRawExtent = rawExtents[dimIdx];
      for (var i = offset; i < len2; i++) {
        var val = chunk[i] = ordinalMeta.parseAndCollect(chunk[i]);
        if (!isNaN(val)) {
          dimRawExtent[0] = Math.min(val, dimRawExtent[0]);
          dimRawExtent[1] = Math.max(val, dimRawExtent[1]);
        }
      }
      dim.ordinalMeta = ordinalMeta;
      dim.ordinalOffset = len2;
      dim.type = "ordinal";
    };
    DataStore2.prototype.getOrdinalMeta = function(dimIdx) {
      var dimInfo = this._dimensions[dimIdx];
      var ordinalMeta = dimInfo.ordinalMeta;
      return ordinalMeta;
    };
    DataStore2.prototype.getDimensionProperty = function(dimIndex) {
      var item = this._dimensions[dimIndex];
      return item && item.property;
    };
    DataStore2.prototype.appendData = function(data) {
      if (false) {
        assert(!this._indices, "appendData can only be called on raw data.");
      }
      var provider = this._provider;
      var start2 = this.count();
      provider.appendData(data);
      var end2 = provider.count();
      if (!provider.persistent) {
        end2 += start2;
      }
      if (start2 < end2) {
        this._initDataFromProvider(start2, end2, true);
      }
      return [start2, end2];
    };
    DataStore2.prototype.appendValues = function(values, minFillLen) {
      var chunks = this._chunks;
      var dimensions = this._dimensions;
      var dimLen = dimensions.length;
      var rawExtent = this._rawExtent;
      var start2 = this.count();
      var end2 = start2 + Math.max(values.length, minFillLen || 0);
      for (var i = 0; i < dimLen; i++) {
        var dim = dimensions[i];
        prepareStore(chunks, i, dim.type, end2, true);
      }
      var emptyDataItem = [];
      for (var idx = start2; idx < end2; idx++) {
        var sourceIdx = idx - start2;
        for (var dimIdx = 0; dimIdx < dimLen; dimIdx++) {
          var dim = dimensions[dimIdx];
          var val = defaultDimValueGetters.arrayRows.call(this, values[sourceIdx] || emptyDataItem, dim.property, sourceIdx, dimIdx);
          chunks[dimIdx][idx] = val;
          var dimRawExtent = rawExtent[dimIdx];
          val < dimRawExtent[0] && (dimRawExtent[0] = val);
          val > dimRawExtent[1] && (dimRawExtent[1] = val);
        }
      }
      this._rawCount = this._count = end2;
      return {
        start: start2,
        end: end2
      };
    };
    DataStore2.prototype._initDataFromProvider = function(start2, end2, append) {
      var provider = this._provider;
      var chunks = this._chunks;
      var dimensions = this._dimensions;
      var dimLen = dimensions.length;
      var rawExtent = this._rawExtent;
      var dimNames = map(dimensions, function(dim2) {
        return dim2.property;
      });
      for (var i = 0; i < dimLen; i++) {
        var dim = dimensions[i];
        if (!rawExtent[i]) {
          rawExtent[i] = initExtentForUnion();
        }
        prepareStore(chunks, i, dim.type, end2, append);
      }
      if (provider.fillStorage) {
        provider.fillStorage(start2, end2, chunks, rawExtent);
      } else {
        var dataItem = [];
        for (var idx = start2; idx < end2; idx++) {
          dataItem = provider.getItem(idx, dataItem);
          for (var dimIdx = 0; dimIdx < dimLen; dimIdx++) {
            var dimStorage = chunks[dimIdx];
            var val = this._dimValueGetter(dataItem, dimNames[dimIdx], idx, dimIdx);
            dimStorage[idx] = val;
            var dimRawExtent = rawExtent[dimIdx];
            val < dimRawExtent[0] && (dimRawExtent[0] = val);
            val > dimRawExtent[1] && (dimRawExtent[1] = val);
          }
        }
      }
      if (!provider.persistent && provider.clean) {
        provider.clean();
      }
      this._rawCount = this._count = end2;
      this._extent = [];
    };
    DataStore2.prototype.count = function() {
      return this._count;
    };
    DataStore2.prototype.get = function(dim, idx) {
      if (!(idx >= 0 && idx < this._count)) {
        return NaN;
      }
      var dimStore = this._chunks[dim];
      return dimStore ? dimStore[this.getRawIndex(idx)] : NaN;
    };
    DataStore2.prototype.getValues = function(dimensions, idx) {
      var values = [];
      var dimArr = [];
      if (idx == null) {
        idx = dimensions;
        dimensions = [];
        for (var i = 0; i < this._dimensions.length; i++) {
          dimArr.push(i);
        }
      } else {
        dimArr = dimensions;
      }
      for (var i = 0, len2 = dimArr.length; i < len2; i++) {
        values.push(this.get(dimArr[i], idx));
      }
      return values;
    };
    DataStore2.prototype.getByRawIndex = function(dim, rawIdx) {
      if (!(rawIdx >= 0 && rawIdx < this._rawCount)) {
        return NaN;
      }
      var dimStore = this._chunks[dim];
      return dimStore ? dimStore[rawIdx] : NaN;
    };
    DataStore2.prototype.getSum = function(dim) {
      var dimData = this._chunks[dim];
      var sum = 0;
      if (dimData) {
        for (var i = 0, len2 = this.count(); i < len2; i++) {
          var value = this.get(dim, i);
          if (!isNaN(value)) {
            sum += value;
          }
        }
      }
      return sum;
    };
    DataStore2.prototype.getMedian = function(dim) {
      var dimDataArray = [];
      this.each([dim], function(val) {
        if (!isNaN(val)) {
          dimDataArray.push(val);
        }
      });
      asc(dimDataArray);
      var len2 = this.count();
      return len2 === 0 ? 0 : len2 % 2 === 1 ? dimDataArray[(len2 - 1) / 2] : (dimDataArray[len2 / 2] + dimDataArray[len2 / 2 - 1]) / 2;
    };
    DataStore2.prototype.indexOfRawIndex = function(rawIndex) {
      if (rawIndex >= this._rawCount || rawIndex < 0) {
        return -1;
      }
      if (!this._indices) {
        return rawIndex;
      }
      var indices = this._indices;
      var rawDataIndex = indices[rawIndex];
      if (rawDataIndex != null && rawDataIndex < this._count && rawDataIndex === rawIndex) {
        return rawIndex;
      }
      var left = 0;
      var right = this._count - 1;
      while (left <= right) {
        var mid = (left + right) / 2 | 0;
        if (indices[mid] < rawIndex) {
          left = mid + 1;
        } else if (indices[mid] > rawIndex) {
          right = mid - 1;
        } else {
          return mid;
        }
      }
      return -1;
    };
    DataStore2.prototype.getIndices = function() {
      var newIndices;
      var indices = this._indices;
      if (indices) {
        var Ctor = indices.constructor;
        var thisCount = this._count;
        if (Ctor === Array) {
          newIndices = new Ctor(thisCount);
          for (var i = 0; i < thisCount; i++) {
            newIndices[i] = indices[i];
          }
        } else {
          newIndices = new Ctor(indices.buffer, 0, thisCount);
        }
      } else {
        var Ctor = getIndicesCtor(this._rawCount);
        newIndices = new Ctor(this.count());
        for (var i = 0; i < newIndices.length; i++) {
          newIndices[i] = i;
        }
      }
      return newIndices;
    };
    DataStore2.prototype.filter = function(dims, cb) {
      if (!this._count) {
        return this;
      }
      var newStore = this.clone();
      var count = newStore.count();
      var Ctor = getIndicesCtor(newStore._rawCount);
      var newIndices = new Ctor(count);
      var value = [];
      var dimSize = dims.length;
      var offset = 0;
      var dim0 = dims[0];
      var chunks = newStore._chunks;
      for (var i = 0; i < count; i++) {
        var keep = void 0;
        var rawIdx = newStore.getRawIndex(i);
        if (dimSize === 0) {
          keep = cb(i);
        } else if (dimSize === 1) {
          var val = chunks[dim0][rawIdx];
          keep = cb(val, i);
        } else {
          var k = 0;
          for (; k < dimSize; k++) {
            value[k] = chunks[dims[k]][rawIdx];
          }
          value[k] = i;
          keep = cb.apply(null, value);
        }
        if (keep) {
          newIndices[offset++] = rawIdx;
        }
      }
      if (offset < count) {
        newStore._indices = newIndices;
      }
      newStore._count = offset;
      newStore._extent = [];
      newStore._updateGetRawIdx();
      return newStore;
    };
    DataStore2.prototype.selectRange = function(range) {
      var newStore = this.clone();
      var len2 = newStore._count;
      if (!len2) {
        return this;
      }
      var dims = keys(range);
      var dimSize = dims.length;
      if (!dimSize) {
        return this;
      }
      var originalCount = newStore.count();
      var Ctor = getIndicesCtor(newStore._rawCount);
      var newIndices = new Ctor(originalCount);
      var offset = 0;
      var dim0 = dims[0];
      var min3 = range[dim0][0];
      var max3 = range[dim0][1];
      var storeArr = newStore._chunks;
      var quickFinished = false;
      if (!newStore._indices) {
        var idx = 0;
        if (dimSize === 1) {
          var dimStorage = storeArr[dims[0]];
          for (var i = 0; i < len2; i++) {
            var val = dimStorage[i];
            if (val >= min3 && val <= max3 || isNaN(val)) {
              newIndices[offset++] = idx;
            }
            idx++;
          }
          quickFinished = true;
        } else if (dimSize === 2) {
          var dimStorage = storeArr[dims[0]];
          var dimStorage2 = storeArr[dims[1]];
          var min23 = range[dims[1]][0];
          var max23 = range[dims[1]][1];
          for (var i = 0; i < len2; i++) {
            var val = dimStorage[i];
            var val2 = dimStorage2[i];
            if ((val >= min3 && val <= max3 || isNaN(val)) && (val2 >= min23 && val2 <= max23 || isNaN(val2))) {
              newIndices[offset++] = idx;
            }
            idx++;
          }
          quickFinished = true;
        }
      }
      if (!quickFinished) {
        if (dimSize === 1) {
          for (var i = 0; i < originalCount; i++) {
            var rawIndex = newStore.getRawIndex(i);
            var val = storeArr[dims[0]][rawIndex];
            if (val >= min3 && val <= max3 || isNaN(val)) {
              newIndices[offset++] = rawIndex;
            }
          }
        } else {
          for (var i = 0; i < originalCount; i++) {
            var keep = true;
            var rawIndex = newStore.getRawIndex(i);
            for (var k = 0; k < dimSize; k++) {
              var dimk = dims[k];
              var val = storeArr[dimk][rawIndex];
              if (val < range[dimk][0] || val > range[dimk][1]) {
                keep = false;
              }
            }
            if (keep) {
              newIndices[offset++] = newStore.getRawIndex(i);
            }
          }
        }
      }
      if (offset < originalCount) {
        newStore._indices = newIndices;
      }
      newStore._count = offset;
      newStore._extent = [];
      newStore._updateGetRawIdx();
      return newStore;
    };
    DataStore2.prototype.map = function(dims, cb) {
      var target = this.clone(dims);
      this._updateDims(target, dims, cb);
      return target;
    };
    DataStore2.prototype.modify = function(dims, cb) {
      this._updateDims(this, dims, cb);
    };
    DataStore2.prototype._updateDims = function(target, dims, cb) {
      var targetChunks = target._chunks;
      var tmpRetValue = [];
      var dimSize = dims.length;
      var dataCount = target.count();
      var values = [];
      var rawExtent = target._rawExtent;
      for (var i = 0; i < dims.length; i++) {
        rawExtent[dims[i]] = initExtentForUnion();
      }
      for (var dataIndex = 0; dataIndex < dataCount; dataIndex++) {
        var rawIndex = target.getRawIndex(dataIndex);
        for (var k = 0; k < dimSize; k++) {
          values[k] = targetChunks[dims[k]][rawIndex];
        }
        values[dimSize] = dataIndex;
        var retValue = cb && cb.apply(null, values);
        if (retValue != null) {
          if (typeof retValue !== "object") {
            tmpRetValue[0] = retValue;
            retValue = tmpRetValue;
          }
          for (var i = 0; i < retValue.length; i++) {
            var dim = dims[i];
            var val = retValue[i];
            var rawExtentOnDim = rawExtent[dim];
            var dimStore = targetChunks[dim];
            if (dimStore) {
              dimStore[rawIndex] = val;
            }
            if (val < rawExtentOnDim[0]) {
              rawExtentOnDim[0] = val;
            }
            if (val > rawExtentOnDim[1]) {
              rawExtentOnDim[1] = val;
            }
          }
        }
      }
    };
    DataStore2.prototype.lttbDownSample = function(valueDimension, rate) {
      var target = this.clone([valueDimension], true);
      var targetStorage = target._chunks;
      var dimStore = targetStorage[valueDimension];
      var len2 = this.count();
      var sampledIndex = 0;
      var frameSize = Math.floor(1 / rate);
      var currentRawIndex = this.getRawIndex(0);
      var maxArea;
      var area;
      var nextRawIndex;
      var newIndices = new (getIndicesCtor(this._rawCount))(Math.min((Math.ceil(len2 / frameSize) + 2) * 2, len2));
      newIndices[sampledIndex++] = currentRawIndex;
      for (var i = 1; i < len2 - 1; i += frameSize) {
        var nextFrameStart = Math.min(i + frameSize, len2 - 1);
        var nextFrameEnd = Math.min(i + frameSize * 2, len2);
        var avgX = (nextFrameEnd + nextFrameStart) / 2;
        var avgY = 0;
        for (var idx = nextFrameStart; idx < nextFrameEnd; idx++) {
          var rawIndex = this.getRawIndex(idx);
          var y = dimStore[rawIndex];
          if (isNaN(y)) {
            continue;
          }
          avgY += y;
        }
        avgY /= nextFrameEnd - nextFrameStart;
        var frameStart = i;
        var frameEnd = Math.min(i + frameSize, len2);
        var pointAX = i - 1;
        var pointAY = dimStore[currentRawIndex];
        maxArea = -1;
        nextRawIndex = frameStart;
        var firstNaNIndex = -1;
        var countNaN = 0;
        for (var idx = frameStart; idx < frameEnd; idx++) {
          var rawIndex = this.getRawIndex(idx);
          var y = dimStore[rawIndex];
          if (isNaN(y)) {
            countNaN++;
            if (firstNaNIndex < 0) {
              firstNaNIndex = rawIndex;
            }
            continue;
          }
          area = Math.abs((pointAX - avgX) * (y - pointAY) - (pointAX - idx) * (avgY - pointAY));
          if (area > maxArea) {
            maxArea = area;
            nextRawIndex = rawIndex;
          }
        }
        if (countNaN > 0 && countNaN < frameEnd - frameStart) {
          newIndices[sampledIndex++] = Math.min(firstNaNIndex, nextRawIndex);
          nextRawIndex = Math.max(firstNaNIndex, nextRawIndex);
        }
        newIndices[sampledIndex++] = nextRawIndex;
        currentRawIndex = nextRawIndex;
      }
      newIndices[sampledIndex++] = this.getRawIndex(len2 - 1);
      target._count = sampledIndex;
      target._indices = newIndices;
      target.getRawIndex = this._getRawIdx;
      return target;
    };
    DataStore2.prototype.minmaxDownSample = function(valueDimension, rate) {
      var target = this.clone([valueDimension], true);
      var targetStorage = target._chunks;
      var frameSize = Math.floor(1 / rate);
      var dimStore = targetStorage[valueDimension];
      var len2 = this.count();
      var newIndices = new (getIndicesCtor(this._rawCount))(Math.ceil(len2 / frameSize) * 2);
      var offset = 0;
      for (var i = 0; i < len2; i += frameSize) {
        var minIndex = i;
        var minValue = dimStore[this.getRawIndex(minIndex)];
        var maxIndex = i;
        var maxValue = dimStore[this.getRawIndex(maxIndex)];
        var thisFrameSize = frameSize;
        if (i + frameSize > len2) {
          thisFrameSize = len2 - i;
        }
        for (var k = 0; k < thisFrameSize; k++) {
          var rawIndex = this.getRawIndex(i + k);
          var value = dimStore[rawIndex];
          if (value < minValue) {
            minValue = value;
            minIndex = i + k;
          }
          if (value > maxValue) {
            maxValue = value;
            maxIndex = i + k;
          }
        }
        var rawMinIndex = this.getRawIndex(minIndex);
        var rawMaxIndex = this.getRawIndex(maxIndex);
        if (minIndex < maxIndex) {
          newIndices[offset++] = rawMinIndex;
          newIndices[offset++] = rawMaxIndex;
        } else {
          newIndices[offset++] = rawMaxIndex;
          newIndices[offset++] = rawMinIndex;
        }
      }
      target._count = offset;
      target._indices = newIndices;
      target._updateGetRawIdx();
      return target;
    };
    DataStore2.prototype.downSample = function(dimension, rate, sampleValue, sampleIndex) {
      var target = this.clone([dimension], true);
      var targetStorage = target._chunks;
      var frameValues = [];
      var frameSize = Math.floor(1 / rate);
      var dimStore = targetStorage[dimension];
      var len2 = this.count();
      var rawExtentOnDim = target._rawExtent[dimension] = initExtentForUnion();
      var newIndices = new (getIndicesCtor(this._rawCount))(Math.ceil(len2 / frameSize));
      var offset = 0;
      for (var i = 0; i < len2; i += frameSize) {
        if (frameSize > len2 - i) {
          frameSize = len2 - i;
          frameValues.length = frameSize;
        }
        for (var k = 0; k < frameSize; k++) {
          var dataIdx = this.getRawIndex(i + k);
          frameValues[k] = dimStore[dataIdx];
        }
        var value = sampleValue(frameValues);
        var sampleFrameIdx = this.getRawIndex(Math.min(i + sampleIndex(frameValues, value) || 0, len2 - 1));
        dimStore[sampleFrameIdx] = value;
        if (value < rawExtentOnDim[0]) {
          rawExtentOnDim[0] = value;
        }
        if (value > rawExtentOnDim[1]) {
          rawExtentOnDim[1] = value;
        }
        newIndices[offset++] = sampleFrameIdx;
      }
      target._count = offset;
      target._indices = newIndices;
      target._updateGetRawIdx();
      return target;
    };
    DataStore2.prototype.each = function(dims, cb) {
      if (!this._count) {
        return;
      }
      var dimSize = dims.length;
      var chunks = this._chunks;
      for (var i = 0, len2 = this.count(); i < len2; i++) {
        var rawIdx = this.getRawIndex(i);
        switch (dimSize) {
          case 0:
            cb(i);
            break;
          case 1:
            cb(chunks[dims[0]][rawIdx], i);
            break;
          case 2:
            cb(chunks[dims[0]][rawIdx], chunks[dims[1]][rawIdx], i);
            break;
          default:
            var k = 0;
            var value = [];
            for (; k < dimSize; k++) {
              value[k] = chunks[dims[k]][rawIdx];
            }
            value[k] = i;
            cb.apply(null, value);
        }
      }
    };
    DataStore2.prototype.getDataExtent = function(dim, filter2) {
      var dimData = this._chunks[dim];
      var initialExtent = initExtentForUnion();
      if (!dimData) {
        return initialExtent;
      }
      var currEnd = this.count();
      var useRaw = !this._indices && !filter2;
      if (useRaw) {
        return this._rawExtent[dim].slice();
      }
      var thisExtent = this._extent;
      var dimExtentRecord = thisExtent[dim] || (thisExtent[dim] = {});
      var filterParsed = parseSanitizationFilter(filter2);
      var filterKey = filterParsed.key;
      var dimExtent = dimExtentRecord[filterKey];
      if (dimExtent) {
        return dimExtent.slice();
      }
      var min3 = initialExtent[0];
      var max3 = initialExtent[1];
      for (var i = 0; i < currEnd; i++) {
        var rawIdx = this.getRawIndex(i);
        var value = dimData[rawIdx];
        if (!filter2 || passesSanitizationFilter(filterParsed, value)) {
          if (value < min3) {
            min3 = value;
          }
          if (value > max3) {
            max3 = value;
          }
        }
      }
      return dimExtentRecord[filterKey] = [min3, max3];
    };
    DataStore2.prototype.getRawDataItem = function(idx) {
      var rawIdx = this.getRawIndex(idx);
      if (!this._provider.persistent) {
        var val = [];
        var chunks = this._chunks;
        for (var i = 0; i < chunks.length; i++) {
          val.push(chunks[i][rawIdx]);
        }
        return val;
      } else {
        return this._provider.getItem(rawIdx);
      }
    };
    DataStore2.prototype.clone = function(clonedDims, ignoreIndices) {
      var target = new DataStore2();
      var chunks = this._chunks;
      var clonedDimsMap = clonedDims && reduce(clonedDims, function(obj, dimIdx) {
        obj[dimIdx] = true;
        return obj;
      }, {});
      if (clonedDimsMap) {
        for (var i = 0; i < chunks.length; i++) {
          target._chunks[i] = !clonedDimsMap[i] ? chunks[i] : cloneChunk(chunks[i]);
        }
      } else {
        target._chunks = chunks;
      }
      this._copyCommonProps(target);
      if (!ignoreIndices) {
        target._indices = this._cloneIndices();
      }
      target._updateGetRawIdx();
      return target;
    };
    DataStore2.prototype._copyCommonProps = function(target) {
      target._count = this._count;
      target._rawCount = this._rawCount;
      target._provider = this._provider;
      target._dimensions = this._dimensions;
      target._extent = clone(this._extent);
      target._rawExtent = clone(this._rawExtent);
    };
    DataStore2.prototype._cloneIndices = function() {
      if (this._indices) {
        var Ctor = this._indices.constructor;
        var indices = void 0;
        if (Ctor === Array) {
          var thisCount = this._indices.length;
          indices = new Ctor(thisCount);
          for (var i = 0; i < thisCount; i++) {
            indices[i] = this._indices[i];
          }
        } else {
          indices = new Ctor(this._indices);
        }
        return indices;
      }
      return null;
    };
    DataStore2.prototype._getRawIdxIdentity = function(idx) {
      return idx;
    };
    DataStore2.prototype._getRawIdx = function(idx) {
      if (idx < this._count && idx >= 0) {
        return this._indices[idx];
      }
      return -1;
    };
    DataStore2.prototype._updateGetRawIdx = function() {
      this.getRawIndex = this._indices ? this._getRawIdx : this._getRawIdxIdentity;
    };
    DataStore2.internalField = (function() {
      function getDimValueSimply(dataItem, property, dataIndex, dimIndex) {
        return parseDataValue(dataItem[dimIndex], this._dimensions[dimIndex]);
      }
      defaultDimValueGetters = {
        arrayRows: getDimValueSimply,
        objectRows: function(dataItem, property, dataIndex, dimIndex) {
          return parseDataValue(dataItem[property], this._dimensions[dimIndex]);
        },
        keyedColumns: getDimValueSimply,
        original: function(dataItem, property, dataIndex, dimIndex) {
          var value = dataItem && (dataItem.value == null ? dataItem : dataItem.value);
          return parseDataValue(value instanceof Array ? value[dimIndex] : value, this._dimensions[dimIndex]);
        },
        typedArray: function(dataItem, property, dataIndex, dimIndex) {
          return dataItem[dimIndex];
        }
      };
    })();
    return DataStore2;
  })()
);
var DataStore_default = DataStore;

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/data/helper/sourceManager.js
var SourceManager = (
  /** @class */
  (function() {
    function SourceManager2(sourceHost) {
      this._sourceList = [];
      this._storeList = [];
      this._upstreamSignList = [];
      this._versionSignBase = 0;
      this._dirty = true;
      this._sourceHost = sourceHost;
    }
    SourceManager2.prototype.dirty = function() {
      this._setLocalSource([], []);
      this._storeList = [];
      this._dirty = true;
    };
    SourceManager2.prototype._setLocalSource = function(sourceList, upstreamSignList) {
      this._sourceList = sourceList;
      this._upstreamSignList = upstreamSignList;
      this._versionSignBase++;
      if (this._versionSignBase > 9e10) {
        this._versionSignBase = 0;
      }
    };
    SourceManager2.prototype._getVersionSign = function() {
      return this._sourceHost.uid + "_" + this._versionSignBase;
    };
    SourceManager2.prototype.prepareSource = function() {
      if (this._isDirty()) {
        this._createSource();
        this._dirty = false;
      }
    };
    SourceManager2.prototype._createSource = function() {
      this._setLocalSource([], []);
      var sourceHost = this._sourceHost;
      var upSourceMgrList = this._getUpstreamSourceManagers();
      var hasUpstream = !!upSourceMgrList.length;
      var resultSourceList;
      var upstreamSignList;
      if (isSeries(sourceHost)) {
        var seriesModel = sourceHost;
        var data = void 0;
        var sourceFormat = void 0;
        var upSource = void 0;
        if (hasUpstream) {
          var upSourceMgr = upSourceMgrList[0];
          upSourceMgr.prepareSource();
          upSource = upSourceMgr.getSource();
          data = upSource.data;
          sourceFormat = upSource.sourceFormat;
          upstreamSignList = [upSourceMgr._getVersionSign()];
        } else {
          data = seriesModel.get("data", true);
          sourceFormat = isTypedArray(data) ? SOURCE_FORMAT_TYPED_ARRAY : SOURCE_FORMAT_ORIGINAL;
          upstreamSignList = [];
        }
        var newMetaRawOption = this._getSourceMetaRawOption() || {};
        var upMetaRawOption = upSource && upSource.metaRawOption || {};
        var seriesLayoutBy = retrieve2(newMetaRawOption.seriesLayoutBy, upMetaRawOption.seriesLayoutBy) || null;
        var sourceHeader = retrieve2(newMetaRawOption.sourceHeader, upMetaRawOption.sourceHeader);
        var dimensions = retrieve2(newMetaRawOption.dimensions, upMetaRawOption.dimensions);
        var needsCreateSource = seriesLayoutBy !== upMetaRawOption.seriesLayoutBy || !!sourceHeader !== !!upMetaRawOption.sourceHeader || dimensions;
        resultSourceList = needsCreateSource ? [createSource(data, {
          seriesLayoutBy,
          sourceHeader,
          dimensions
        }, sourceFormat)] : [];
      } else {
        var datasetModel = sourceHost;
        if (hasUpstream) {
          var result = this._applyTransform(upSourceMgrList);
          resultSourceList = result.sourceList;
          upstreamSignList = result.upstreamSignList;
        } else {
          var sourceData = datasetModel.get("source", true);
          resultSourceList = [createSource(sourceData, this._getSourceMetaRawOption(), null)];
          upstreamSignList = [];
        }
      }
      if (false) {
        assert(resultSourceList && upstreamSignList);
      }
      this._setLocalSource(resultSourceList, upstreamSignList);
    };
    SourceManager2.prototype._applyTransform = function(upMgrList) {
      var datasetModel = this._sourceHost;
      var transformOption = datasetModel.get("transform", true);
      var fromTransformResult = datasetModel.get("fromTransformResult", true);
      if (false) {
        assert(fromTransformResult != null || transformOption != null);
      }
      if (fromTransformResult != null) {
        var errMsg = "";
        if (upMgrList.length !== 1) {
          if (false) {
            errMsg = "When using `fromTransformResult`, there should be only one upstream dataset";
          }
          doThrow(errMsg);
        }
      }
      var sourceList;
      var upSourceList = [];
      var upstreamSignList = [];
      each(upMgrList, function(upMgr) {
        upMgr.prepareSource();
        var upSource = upMgr.getSource(fromTransformResult || 0);
        var errMsg2 = "";
        if (fromTransformResult != null && !upSource) {
          if (false) {
            errMsg2 = "Can not retrieve result by `fromTransformResult`: " + fromTransformResult;
          }
          doThrow(errMsg2);
        }
        upSourceList.push(upSource);
        upstreamSignList.push(upMgr._getVersionSign());
      });
      if (transformOption) {
        sourceList = applyDataTransform(transformOption, upSourceList, {
          datasetIndex: datasetModel.componentIndex
        });
      } else if (fromTransformResult != null) {
        sourceList = [cloneSourceShallow(upSourceList[0])];
      }
      return {
        sourceList,
        upstreamSignList
      };
    };
    SourceManager2.prototype._isDirty = function() {
      if (this._dirty) {
        return true;
      }
      var upSourceMgrList = this._getUpstreamSourceManagers();
      for (var i = 0; i < upSourceMgrList.length; i++) {
        var upSrcMgr = upSourceMgrList[i];
        if (
          // Consider the case that there is ancestor diry, call it recursively.
          // The performance is probably not an issue because usually the chain is not long.
          upSrcMgr._isDirty() || this._upstreamSignList[i] !== upSrcMgr._getVersionSign()
        ) {
          return true;
        }
      }
    };
    SourceManager2.prototype.getSource = function(sourceIndex) {
      sourceIndex = sourceIndex || 0;
      var source = this._sourceList[sourceIndex];
      if (!source) {
        var upSourceMgrList = this._getUpstreamSourceManagers();
        return upSourceMgrList[0] && upSourceMgrList[0].getSource(sourceIndex);
      }
      return source;
    };
    SourceManager2.prototype.getSharedDataStore = function(seriesDimRequest) {
      if (false) {
        assert(isSeries(this._sourceHost), "Can only call getDataStore on series source manager.");
      }
      var schema = seriesDimRequest.makeStoreSchema();
      return this._innerGetDataStore(schema.dimensions, seriesDimRequest.source, schema.hash);
    };
    SourceManager2.prototype._innerGetDataStore = function(storeDims, seriesSource, sourceReadKey) {
      var sourceIndex = 0;
      var storeList = this._storeList;
      var cachedStoreMap = storeList[sourceIndex];
      if (!cachedStoreMap) {
        cachedStoreMap = storeList[sourceIndex] = {};
      }
      var cachedStore = cachedStoreMap[sourceReadKey];
      if (!cachedStore) {
        var upSourceMgr = this._getUpstreamSourceManagers()[0];
        if (isSeries(this._sourceHost) && upSourceMgr) {
          cachedStore = upSourceMgr._innerGetDataStore(storeDims, seriesSource, sourceReadKey);
        } else {
          cachedStore = new DataStore_default();
          cachedStore.initData(new DefaultDataProvider(seriesSource, storeDims.length), storeDims);
        }
        cachedStoreMap[sourceReadKey] = cachedStore;
      }
      return cachedStore;
    };
    SourceManager2.prototype._getUpstreamSourceManagers = function() {
      var sourceHost = this._sourceHost;
      if (isSeries(sourceHost)) {
        var datasetModel = querySeriesUpstreamDatasetModel(sourceHost);
        return !datasetModel ? [] : [datasetModel.getSourceManager()];
      } else {
        return map(queryDatasetUpstreamDatasetModels(sourceHost), function(datasetModel2) {
          return datasetModel2.getSourceManager();
        });
      }
    };
    SourceManager2.prototype._getSourceMetaRawOption = function() {
      var sourceHost = this._sourceHost;
      var seriesLayoutBy;
      var sourceHeader;
      var dimensions;
      if (isSeries(sourceHost)) {
        seriesLayoutBy = sourceHost.get("seriesLayoutBy", true);
        sourceHeader = sourceHost.get("sourceHeader", true);
        dimensions = sourceHost.get("dimensions", true);
      } else if (!this._getUpstreamSourceManagers().length) {
        var model = sourceHost;
        seriesLayoutBy = model.get("seriesLayoutBy", true);
        sourceHeader = model.get("sourceHeader", true);
        dimensions = model.get("dimensions", true);
      }
      return {
        seriesLayoutBy,
        sourceHeader,
        dimensions
      };
    };
    return SourceManager2;
  })()
);
function isSeries(sourceHost) {
  return sourceHost.mainType === "series";
}
function doThrow(errMsg) {
  throw new Error(errMsg);
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/visual/tokens.js
var tokens = {
  color: {},
  darkColor: {},
  size: {}
};
var color = tokens.color = {
  theme: ["#5070dd", "#b6d634", "#505372", "#ff994d", "#0ca8df", "#ffd10a", "#fb628b", "#785db0", "#3fbe95"],
  neutral00: "#fff",
  neutral05: "#f4f7fd",
  neutral10: "#e8ebf0",
  neutral15: "#dbdee4",
  neutral20: "#cfd2d7",
  neutral25: "#c3c5cb",
  neutral30: "#b7b9be",
  neutral35: "#aaacb2",
  neutral40: "#9ea0a5",
  neutral45: "#929399",
  neutral50: "#86878c",
  neutral55: "#797b7f",
  neutral60: "#6d6e73",
  neutral65: "#616266",
  neutral70: "#54555a",
  neutral75: "#48494d",
  neutral80: "#3c3c41",
  neutral85: "#303034",
  neutral90: "#232328",
  neutral95: "#17171b",
  neutral99: "#000",
  accent05: "#eff1f9",
  accent10: "#e0e4f2",
  accent15: "#d0d6ec",
  accent20: "#c0c9e6",
  accent25: "#b1bbdf",
  accent30: "#a1aed9",
  accent35: "#91a0d3",
  accent40: "#8292cc",
  accent45: "#7285c6",
  accent50: "#6578ba",
  accent55: "#5c6da9",
  accent60: "#536298",
  accent65: "#4a5787",
  accent70: "#404c76",
  accent75: "#374165",
  accent80: "#2e3654",
  accent85: "#252b43",
  accent90: "#1b2032",
  accent95: "#121521",
  transparent: "rgba(0,0,0,0)",
  highlight: "rgba(255,231,130,0.8)"
};
extend(color, {
  primary: color.neutral80,
  secondary: color.neutral70,
  tertiary: color.neutral60,
  quaternary: color.neutral50,
  disabled: color.neutral20,
  border: color.neutral30,
  borderTint: color.neutral20,
  borderShade: color.neutral40,
  background: color.neutral05,
  backgroundTint: "rgba(234,237,245,0.5)",
  backgroundTransparent: "rgba(255,255,255,0)",
  backgroundShade: color.neutral10,
  shadow: "rgba(0,0,0,0.2)",
  shadowTint: "rgba(129,130,136,0.2)",
  axisLine: color.neutral70,
  axisLineTint: color.neutral40,
  axisTick: color.neutral70,
  axisTickMinor: color.neutral60,
  axisLabel: color.neutral70,
  axisSplitLine: color.neutral15,
  axisMinorSplitLine: color.neutral05
});
for (key in color) {
  if (color.hasOwnProperty(key)) {
    hex = color[key];
    if (key === "theme") {
      tokens.darkColor.theme = color.theme.slice();
    } else if (key === "highlight") {
      tokens.darkColor.highlight = "rgba(255,231,130,0.4)";
    } else if (key.indexOf("accent") === 0) {
      tokens.darkColor[key] = modifyHSL(hex, null, function(s) {
        return s * 0.5;
      }, function(l) {
        return Math.min(1, 1.3 - l);
      });
    } else {
      tokens.darkColor[key] = modifyHSL(hex, null, function(s) {
        return s * 0.9;
      }, function(l) {
        return 1 - Math.pow(l, 1.5);
      });
    }
  }
}
var hex;
var key;
tokens.size = {
  xxs: 2,
  xs: 5,
  s: 10,
  m: 15,
  l: 20,
  xl: 30,
  xxl: 40,
  xxxl: 50
};
var tokens_default = tokens;

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/component/tooltip/tooltipMarkup.js
function createTooltipMarkup(type, option) {
  option.type = type;
  return option;
}
function retrieveVisualColorForTooltipMarker(series, dataIndex) {
  var style = series.getData().getItemVisual(dataIndex, "style");
  var color2 = style[series.visualDrawType];
  return convertToColorString(color2);
}
var TooltipMarkupStyleCreator = (
  /** @class */
  (function() {
    function TooltipMarkupStyleCreator2() {
      this.richTextStyles = {};
      this._nextStyleNameId = getRandomIdBase();
    }
    TooltipMarkupStyleCreator2.prototype._generateStyleName = function() {
      return "__EC_aUTo_" + this._nextStyleNameId++;
    };
    TooltipMarkupStyleCreator2.prototype.makeTooltipMarker = function(markerType, colorStr, renderMode) {
      var markerId = renderMode === "richText" ? this._generateStyleName() : null;
      var marker = getTooltipMarker({
        color: colorStr,
        type: markerType,
        renderMode,
        markerId
      });
      if (isString(marker)) {
        return marker;
      } else {
        if (false) {
          assert(markerId);
        }
        this.richTextStyles[markerId] = marker.style;
        return marker.content;
      }
    };
    TooltipMarkupStyleCreator2.prototype.wrapRichTextStyle = function(text, styles) {
      var finalStl = {};
      if (isArray(styles)) {
        each(styles, function(stl) {
          return extend(finalStl, stl);
        });
      } else {
        extend(finalStl, styles);
      }
      var styleName = this._generateStyleName();
      this.richTextStyles[styleName] = finalStl;
      return "{" + styleName + "|" + text + "}";
    };
    return TooltipMarkupStyleCreator2;
  })()
);

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/component/tooltip/seriesFormatTooltip.js
function defaultSeriesFormatTooltip(opt) {
  var series = opt.series;
  var dataIndex = opt.dataIndex;
  var multipleSeries = opt.multipleSeries;
  var data = series.getData();
  var tooltipDims = data.mapDimensionsAll("defaultedTooltip");
  var tooltipDimLen = tooltipDims.length;
  var value = series.getRawValue(dataIndex);
  var isValueArr = isArray(value);
  var markerColor = retrieveVisualColorForTooltipMarker(series, dataIndex);
  var inlineValue;
  var inlineValueType;
  var subBlocks;
  var sortParam;
  if (tooltipDimLen > 1 || isValueArr && !tooltipDimLen) {
    var formatArrResult = formatTooltipArrayValue(value, series, dataIndex, tooltipDims, markerColor);
    inlineValue = formatArrResult.inlineValues;
    inlineValueType = formatArrResult.inlineValueTypes;
    subBlocks = formatArrResult.blocks;
    sortParam = formatArrResult.inlineValues[0];
  } else if (tooltipDimLen) {
    var dimInfo = data.getDimensionInfo(tooltipDims[0]);
    sortParam = inlineValue = retrieveRawValue(data, dataIndex, tooltipDims[0]);
    inlineValueType = dimInfo.type;
  } else {
    sortParam = inlineValue = isValueArr ? value[0] : value;
  }
  var seriesNameSpecified = isNameSpecified(series);
  var seriesName = seriesNameSpecified && series.name || "";
  var itemName = data.getName(dataIndex);
  var inlineName = multipleSeries ? seriesName : itemName;
  return createTooltipMarkup("section", {
    header: seriesName,
    // When series name is not specified, do not show a header line with only '-'.
    // This case always happens in tooltip.trigger: 'item'.
    noHeader: multipleSeries || !seriesNameSpecified,
    sortParam,
    blocks: [createTooltipMarkup("nameValue", {
      markerType: "item",
      markerColor,
      // Do not mix display seriesName and itemName in one tooltip,
      // which might confuses users.
      name: inlineName,
      // name dimension might be auto assigned, where the name might
      // be not readable. So we check trim here.
      noName: !trim(inlineName),
      value: inlineValue,
      valueType: inlineValueType,
      rawDataIndex: data.getRawIndex(dataIndex)
    })].concat(subBlocks || [])
  });
}
function formatTooltipArrayValue(value, series, dataIndex, tooltipDims, colorStr) {
  var data = series.getData();
  var isValueMultipleLine = reduce(value, function(isValueMultipleLine2, val, idx) {
    var dimItem = data.getDimensionInfo(idx);
    return isValueMultipleLine2 = isValueMultipleLine2 || dimItem && dimItem.tooltip !== false && dimItem.displayName != null;
  }, false);
  var inlineValues = [];
  var inlineValueTypes = [];
  var blocks = [];
  tooltipDims.length ? each(tooltipDims, function(dim) {
    setEachItem(retrieveRawValue(data, dataIndex, dim), dim);
  }) : each(value, setEachItem);
  function setEachItem(val, dim) {
    var dimInfo = data.getDimensionInfo(dim);
    if (!dimInfo || dimInfo.otherDims.tooltip === false) {
      return;
    }
    if (isValueMultipleLine) {
      blocks.push(createTooltipMarkup("nameValue", {
        markerType: "subItem",
        markerColor: colorStr,
        name: dimInfo.displayName,
        value: val,
        valueType: dimInfo.type
      }));
    } else {
      inlineValues.push(val);
      inlineValueTypes.push(dimInfo.type);
    }
  }
  return {
    inlineValues,
    inlineValueTypes,
    blocks
  };
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/model/Series.js
var inner2 = makeInner();
function getSelectionKey(data, dataIndex) {
  return data.getName(dataIndex) || data.getId(dataIndex);
}
var SERIES_UNIVERSAL_TRANSITION_PROP = "__universalTransitionEnabled";
var SeriesModel = (
  /** @class */
  (function(_super) {
    __extends(SeriesModel2, _super);
    function SeriesModel2() {
      var _this = _super !== null && _super.apply(this, arguments) || this;
      _this._selectedDataIndicesMap = {};
      return _this;
    }
    SeriesModel2.prototype.init = function(option, parentModel, ecModel) {
      this.seriesIndex = this.componentIndex;
      this.dataTask = createTask({
        count: dataTaskCount,
        reset: dataTaskReset
      });
      this.dataTask.context = {
        model: this
      };
      this.mergeDefaultAndTheme(option, ecModel);
      var sourceManager = inner2(this).sourceManager = new SourceManager(this);
      sourceManager.prepareSource();
      var data = this.getInitialData(option, ecModel);
      wrapData(data, this);
      this.dataTask.context.data = data;
      if (false) {
        assert(data, "getInitialData returned invalid data.");
      }
      inner2(this).dataBeforeProcessed = data;
      autoSeriesName(this);
      this._initSelectedMapFromData(data);
    };
    SeriesModel2.prototype.mergeDefaultAndTheme = function(option, ecModel) {
      var layoutMode = fetchLayoutMode(this);
      var inputPositionParams = layoutMode ? getLayoutParams(option) : {};
      var themeSubType = this.subType;
      if (Component_default.hasClass(themeSubType)) {
        themeSubType += "Series";
      }
      merge(option, ecModel.getTheme().get(this.subType));
      merge(option, this.getDefaultOption());
      defaultEmphasis(option, "label", ["show"]);
      this.fillDataTextStyle(option.data);
      if (layoutMode) {
        mergeLayoutParam(option, inputPositionParams, layoutMode);
      }
    };
    SeriesModel2.prototype.mergeOption = function(newSeriesOption, ecModel) {
      newSeriesOption = merge(this.option, newSeriesOption, true);
      this.fillDataTextStyle(newSeriesOption.data);
      var layoutMode = fetchLayoutMode(this);
      if (layoutMode) {
        mergeLayoutParam(this.option, newSeriesOption, layoutMode);
      }
      var sourceManager = inner2(this).sourceManager;
      sourceManager.dirty();
      sourceManager.prepareSource();
      var data = this.getInitialData(newSeriesOption, ecModel);
      wrapData(data, this);
      this.dataTask.dirty();
      this.dataTask.context.data = data;
      inner2(this).dataBeforeProcessed = data;
      autoSeriesName(this);
      this._initSelectedMapFromData(data);
    };
    SeriesModel2.prototype.fillDataTextStyle = function(data) {
      if (data && !isTypedArray(data)) {
        var props = ["show"];
        for (var i = 0; i < data.length; i++) {
          if (data[i] && data[i].label) {
            defaultEmphasis(data[i], "label", props);
          }
        }
      }
    };
    SeriesModel2.prototype.getInitialData = function(option, ecModel) {
      return;
    };
    SeriesModel2.prototype.appendData = function(params) {
      var data = this.getRawData();
      data.appendData(params.data);
    };
    SeriesModel2.prototype.getData = function(dataType) {
      var task = getCurrentTask(this);
      if (task) {
        var data = task.context.data;
        return dataType == null || !data.getLinkedData ? data : data.getLinkedData(dataType);
      } else {
        return inner2(this).data;
      }
    };
    SeriesModel2.prototype.getAllData = function() {
      var mainData = this.getData();
      return mainData && mainData.getLinkedDataAll ? mainData.getLinkedDataAll() : [{
        data: mainData
      }];
    };
    SeriesModel2.prototype.setData = function(data) {
      var task = getCurrentTask(this);
      if (task) {
        var context = task.context;
        context.outputData = data;
        if (task !== this.dataTask) {
          context.data = data;
        }
      }
      inner2(this).data = data;
    };
    SeriesModel2.prototype.getEncode = function() {
      var encode = this.get("encode", true);
      if (encode) {
        return createHashMap(encode);
      }
    };
    SeriesModel2.prototype.getSourceManager = function() {
      return inner2(this).sourceManager;
    };
    SeriesModel2.prototype.getSource = function() {
      return this.getSourceManager().getSource();
    };
    SeriesModel2.prototype.getRawData = function() {
      return inner2(this).dataBeforeProcessed;
    };
    SeriesModel2.prototype.getColorBy = function() {
      var colorBy = this.get("colorBy");
      return colorBy || "series";
    };
    SeriesModel2.prototype.isColorBySeries = function() {
      return this.getColorBy() === "series";
    };
    SeriesModel2.prototype.getBaseAxis = function() {
      var coordSys = this.coordinateSystem;
      return coordSys && coordSys.getBaseAxis && coordSys.getBaseAxis();
    };
    SeriesModel2.prototype.indicesOfNearest = function(axisDim, dim, value, maxDistance) {
      var data = this.getData();
      var coordSys = this.coordinateSystem;
      var axis = coordSys && coordSys.getAxis(axisDim);
      if (!coordSys || !axis) {
        return [];
      }
      var targetCoord = axis.dataToCoord(value);
      if (maxDistance == null) {
        maxDistance = Infinity;
      }
      var nearestIndices = [];
      var minDist = Infinity;
      var minDiff = -1;
      var nearestIndicesLen = 0;
      var dimIdx = data.getDimensionIndex(dim);
      var store = data.getStore();
      for (var idx = 0, len2 = store.count(); idx < len2; idx++) {
        var dimValue = store.get(dimIdx, idx);
        var dataCoord = axis.dataToCoord(dimValue);
        var diff = targetCoord - dataCoord;
        var dist2 = Math.abs(diff);
        if (dist2 <= maxDistance) {
          if (dist2 < minDist || dist2 === minDist && diff >= 0 && minDiff < 0) {
            minDist = dist2;
            minDiff = diff;
            nearestIndicesLen = 0;
          }
          if (diff === minDiff) {
            nearestIndices[nearestIndicesLen++] = idx;
          }
        }
      }
      nearestIndices.length = nearestIndicesLen;
      return nearestIndices;
    };
    SeriesModel2.prototype.formatTooltip = function(dataIndex, multipleSeries, dataType) {
      return defaultSeriesFormatTooltip({
        series: this,
        dataIndex,
        multipleSeries
      });
    };
    SeriesModel2.prototype.isAnimationEnabled = function() {
      var ecModel = this.ecModel;
      if (env_default.node && !(ecModel && ecModel.ssr)) {
        return false;
      }
      var animationEnabled = this.getShallow("animation");
      if (animationEnabled) {
        if (this.getData().count() > this.getShallow("animationThreshold")) {
          animationEnabled = false;
        }
      }
      return !!animationEnabled;
    };
    SeriesModel2.prototype.restoreData = function() {
      this.dataTask.dirty();
    };
    SeriesModel2.prototype.getColorFromPalette = function(name, scope, requestColorNum) {
      var ecModel = this.ecModel;
      var color2 = PaletteMixin.prototype.getColorFromPalette.call(this, name, scope, requestColorNum);
      if (!color2) {
        color2 = ecModel.getColorFromPalette(name, scope, requestColorNum);
      }
      return color2;
    };
    SeriesModel2.prototype.coordDimToDataDim = function(coordDim) {
      return this.getRawData().mapDimensionsAll(coordDim);
    };
    SeriesModel2.prototype.getProgressive = function() {
      return this.get("progressive");
    };
    SeriesModel2.prototype.getProgressiveThreshold = function() {
      return this.get("progressiveThreshold");
    };
    SeriesModel2.prototype.select = function(innerDataIndices, dataType) {
      this._innerSelect(this.getData(dataType), innerDataIndices);
    };
    SeriesModel2.prototype.unselect = function(innerDataIndices, dataType) {
      var selectedMap = this.option.selectedMap;
      if (!selectedMap) {
        return;
      }
      var selectedMode = this.option.selectedMode;
      var data = this.getData(dataType);
      if (selectedMode === "series" || selectedMap === "all") {
        this.option.selectedMap = {};
        this._selectedDataIndicesMap = {};
        return;
      }
      for (var i = 0; i < innerDataIndices.length; i++) {
        var dataIndex = innerDataIndices[i];
        var nameOrId = getSelectionKey(data, dataIndex);
        selectedMap[nameOrId] = false;
        this._selectedDataIndicesMap[nameOrId] = -1;
      }
    };
    SeriesModel2.prototype.toggleSelect = function(innerDataIndices, dataType) {
      var tmpArr2 = [];
      for (var i = 0; i < innerDataIndices.length; i++) {
        tmpArr2[0] = innerDataIndices[i];
        this.isSelected(innerDataIndices[i], dataType) ? this.unselect(tmpArr2, dataType) : this.select(tmpArr2, dataType);
      }
    };
    SeriesModel2.prototype.getSelectedDataIndices = function() {
      if (this.option.selectedMap === "all") {
        return [].slice.call(this.getData().getIndices());
      }
      var selectedDataIndicesMap = this._selectedDataIndicesMap;
      var nameOrIds = keys(selectedDataIndicesMap);
      var dataIndices = [];
      for (var i = 0; i < nameOrIds.length; i++) {
        var dataIndex = selectedDataIndicesMap[nameOrIds[i]];
        if (dataIndex >= 0) {
          dataIndices.push(dataIndex);
        }
      }
      return dataIndices;
    };
    SeriesModel2.prototype.isSelected = function(dataIndex, dataType) {
      var selectedMap = this.option.selectedMap;
      if (!selectedMap) {
        return false;
      }
      var data = this.getData(dataType);
      return (selectedMap === "all" || selectedMap[getSelectionKey(data, dataIndex)]) && !data.getItemModel(dataIndex).get(["select", "disabled"]);
    };
    SeriesModel2.prototype.isUniversalTransitionEnabled = function() {
      if (this[SERIES_UNIVERSAL_TRANSITION_PROP]) {
        return true;
      }
      var universalTransitionOpt = this.option.universalTransition;
      if (!universalTransitionOpt) {
        return false;
      }
      if (universalTransitionOpt === true) {
        return true;
      }
      return universalTransitionOpt && universalTransitionOpt.enabled;
    };
    SeriesModel2.prototype._innerSelect = function(data, innerDataIndices) {
      var _a2, _b2;
      var option = this.option;
      var selectedMode = option.selectedMode;
      var len2 = innerDataIndices.length;
      if (!selectedMode || !len2) {
        return;
      }
      if (selectedMode === "series") {
        option.selectedMap = "all";
      } else if (selectedMode === "multiple") {
        if (!isObject(option.selectedMap)) {
          option.selectedMap = {};
        }
        var selectedMap = option.selectedMap;
        for (var i = 0; i < len2; i++) {
          var dataIndex = innerDataIndices[i];
          var nameOrId = getSelectionKey(data, dataIndex);
          selectedMap[nameOrId] = true;
          this._selectedDataIndicesMap[nameOrId] = data.getRawIndex(dataIndex);
        }
      } else if (selectedMode === "single" || selectedMode === true) {
        var lastDataIndex = innerDataIndices[len2 - 1];
        var nameOrId = getSelectionKey(data, lastDataIndex);
        option.selectedMap = (_a2 = {}, _a2[nameOrId] = true, _a2);
        this._selectedDataIndicesMap = (_b2 = {}, _b2[nameOrId] = data.getRawIndex(lastDataIndex), _b2);
      }
    };
    SeriesModel2.prototype._initSelectedMapFromData = function(data) {
      if (this.option.selectedMap) {
        return;
      }
      var dataIndices = [];
      if (data.hasItemOption) {
        data.each(function(idx) {
          var rawItem = data.getRawDataItem(idx);
          if (rawItem && rawItem.selected) {
            dataIndices.push(idx);
          }
        });
      }
      if (dataIndices.length > 0) {
        this._innerSelect(data, dataIndices);
      }
    };
    SeriesModel2.registerClass = function(clz) {
      return Component_default.registerClass(clz);
    };
    SeriesModel2.protoInitialize = (function() {
      var proto = SeriesModel2.prototype;
      proto.type = "series.__base__";
      proto.seriesIndex = 0;
      proto.ignoreStyleOnData = false;
      proto.hasSymbolVisual = false;
      proto.defaultSymbol = "circle";
      proto.visualStyleAccessPath = "itemStyle";
      proto.visualDrawType = "fill";
    })();
    return SeriesModel2;
  })(Component_default)
);
mixin(SeriesModel, DataFormatMixin);
mixin(SeriesModel, PaletteMixin);
mountExtend(SeriesModel, Component_default);
function autoSeriesName(seriesModel) {
  var name = seriesModel.name;
  if (!isNameSpecified(seriesModel)) {
    seriesModel.name = getSeriesAutoName(seriesModel) || name;
  }
}
function getSeriesAutoName(seriesModel) {
  var data = seriesModel.getRawData();
  var dataDims = data.mapDimensionsAll("seriesName");
  var nameArr = [];
  each(dataDims, function(dataDim) {
    var dimInfo = data.getDimensionInfo(dataDim);
    dimInfo.displayName && nameArr.push(dimInfo.displayName);
  });
  return nameArr.join(" ");
}
function dataTaskCount(context) {
  return context.model.getRawData().count();
}
function dataTaskReset(context) {
  var seriesModel = context.model;
  seriesModel.setData(seriesModel.getRawData().cloneShallow());
  return dataTaskProgress;
}
function dataTaskProgress(param, context) {
  if (context.outputData && param.end > context.outputData.count()) {
    context.model.getRawData().cloneShallow(context.outputData);
  }
}
function wrapData(data, seriesModel) {
  each(concatArray(data.CHANGABLE_METHODS, data.DOWNSAMPLE_METHODS), function(methodName) {
    data.wrapMethod(methodName, curry(onDataChange, seriesModel));
  });
}
function onDataChange(seriesModel, newList) {
  var task = getCurrentTask(seriesModel);
  if (task) {
    task.setOutputEnd((newList || this).count());
  }
  return newList;
}
function getCurrentTask(seriesModel) {
  var scheduler = (seriesModel.ecModel || {}).scheduler;
  var pipeline = scheduler && scheduler.getPipeline(seriesModel.uid);
  if (pipeline) {
    var task = pipeline.currentTask;
    if (task) {
      var agentStubMap = task.agentStubMap;
      if (agentStubMap) {
        task = agentStubMap.get(seriesModel.uid);
      }
    }
    return task;
  }
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/tool/convertPath.js
var CMD4 = PathProxy_default.CMD;
function aroundEqual(a, b) {
  return Math.abs(a - b) < 1e-5;
}
function pathToBezierCurves(path) {
  var data = path.data;
  var len2 = path.len();
  var bezierArrayGroups = [];
  var currentSubpath;
  var xi = 0;
  var yi = 0;
  var x0 = 0;
  var y0 = 0;
  function createNewSubpath(x, y) {
    if (currentSubpath && currentSubpath.length > 2) {
      bezierArrayGroups.push(currentSubpath);
    }
    currentSubpath = [x, y];
  }
  function addLine(x02, y02, x12, y12) {
    if (!(aroundEqual(x02, x12) && aroundEqual(y02, y12))) {
      currentSubpath.push(x02, y02, x12, y12, x12, y12);
    }
  }
  function addArc(startAngle2, endAngle2, cx2, cy2, rx2, ry2) {
    var delta = Math.abs(endAngle2 - startAngle2);
    var len3 = Math.tan(delta / 4) * 4 / 3;
    var dir3 = endAngle2 < startAngle2 ? -1 : 1;
    var c1 = Math.cos(startAngle2);
    var s1 = Math.sin(startAngle2);
    var c2 = Math.cos(endAngle2);
    var s2 = Math.sin(endAngle2);
    var x12 = c1 * rx2 + cx2;
    var y12 = s1 * ry2 + cy2;
    var x4 = c2 * rx2 + cx2;
    var y4 = s2 * ry2 + cy2;
    var hx = rx2 * len3 * dir3;
    var hy = ry2 * len3 * dir3;
    currentSubpath.push(x12 - hx * s1, y12 + hy * c1, x4 + hx * s2, y4 - hy * c2, x4, y4);
  }
  var x1;
  var y1;
  var x2;
  var y2;
  for (var i = 0; i < len2; ) {
    var cmd = data[i++];
    var isFirst = i === 1;
    if (isFirst) {
      xi = data[i];
      yi = data[i + 1];
      x0 = xi;
      y0 = yi;
      if (cmd === CMD4.L || cmd === CMD4.C || cmd === CMD4.Q) {
        currentSubpath = [x0, y0];
      }
    }
    switch (cmd) {
      case CMD4.M:
        xi = x0 = data[i++];
        yi = y0 = data[i++];
        createNewSubpath(x0, y0);
        break;
      case CMD4.L:
        x1 = data[i++];
        y1 = data[i++];
        addLine(xi, yi, x1, y1);
        xi = x1;
        yi = y1;
        break;
      case CMD4.C:
        currentSubpath.push(data[i++], data[i++], data[i++], data[i++], xi = data[i++], yi = data[i++]);
        break;
      case CMD4.Q:
        x1 = data[i++];
        y1 = data[i++];
        x2 = data[i++];
        y2 = data[i++];
        currentSubpath.push(xi + 2 / 3 * (x1 - xi), yi + 2 / 3 * (y1 - yi), x2 + 2 / 3 * (x1 - x2), y2 + 2 / 3 * (y1 - y2), x2, y2);
        xi = x2;
        yi = y2;
        break;
      case CMD4.A:
        var cx = data[i++];
        var cy = data[i++];
        var rx = data[i++];
        var ry = data[i++];
        var startAngle = data[i++];
        var endAngle = data[i++] + startAngle;
        i += 1;
        var anticlockwise = !data[i++];
        x1 = Math.cos(startAngle) * rx + cx;
        y1 = Math.sin(startAngle) * ry + cy;
        if (isFirst) {
          x0 = x1;
          y0 = y1;
          createNewSubpath(x0, y0);
        } else {
          addLine(xi, yi, x1, y1);
        }
        xi = Math.cos(endAngle) * rx + cx;
        yi = Math.sin(endAngle) * ry + cy;
        var step = (anticlockwise ? -1 : 1) * Math.PI / 2;
        for (var angle = startAngle; anticlockwise ? angle > endAngle : angle < endAngle; angle += step) {
          var nextAngle = anticlockwise ? Math.max(angle + step, endAngle) : Math.min(angle + step, endAngle);
          addArc(angle, nextAngle, cx, cy, rx, ry);
        }
        break;
      case CMD4.R:
        x0 = xi = data[i++];
        y0 = yi = data[i++];
        x1 = x0 + data[i++];
        y1 = y0 + data[i++];
        createNewSubpath(x1, y0);
        addLine(x1, y0, x1, y1);
        addLine(x1, y1, x0, y1);
        addLine(x0, y1, x0, y0);
        addLine(x0, y0, x1, y0);
        break;
      case CMD4.Z:
        currentSubpath && addLine(xi, yi, x0, y0);
        xi = x0;
        yi = y0;
        break;
    }
  }
  if (currentSubpath && currentSubpath.length > 2) {
    bezierArrayGroups.push(currentSubpath);
  }
  return bezierArrayGroups;
}
function adpativeBezier(x0, y0, x1, y1, x2, y2, x3, y3, out2, scale3) {
  if (aroundEqual(x0, x1) && aroundEqual(y0, y1) && aroundEqual(x2, x3) && aroundEqual(y2, y3)) {
    out2.push(x3, y3);
    return;
  }
  var PIXEL_DISTANCE = 2 / scale3;
  var PIXEL_DISTANCE_SQR = PIXEL_DISTANCE * PIXEL_DISTANCE;
  var dx = x3 - x0;
  var dy = y3 - y0;
  var d = Math.sqrt(dx * dx + dy * dy);
  dx /= d;
  dy /= d;
  var dx1 = x1 - x0;
  var dy1 = y1 - y0;
  var dx2 = x2 - x3;
  var dy2 = y2 - y3;
  var cp1LenSqr = dx1 * dx1 + dy1 * dy1;
  var cp2LenSqr = dx2 * dx2 + dy2 * dy2;
  if (cp1LenSqr < PIXEL_DISTANCE_SQR && cp2LenSqr < PIXEL_DISTANCE_SQR) {
    out2.push(x3, y3);
    return;
  }
  var projLen1 = dx * dx1 + dy * dy1;
  var projLen2 = -dx * dx2 - dy * dy2;
  var d1Sqr = cp1LenSqr - projLen1 * projLen1;
  var d2Sqr = cp2LenSqr - projLen2 * projLen2;
  if (d1Sqr < PIXEL_DISTANCE_SQR && projLen1 >= 0 && d2Sqr < PIXEL_DISTANCE_SQR && projLen2 >= 0) {
    out2.push(x3, y3);
    return;
  }
  var tmpSegX = [];
  var tmpSegY = [];
  cubicSubdivide(x0, x1, x2, x3, 0.5, tmpSegX);
  cubicSubdivide(y0, y1, y2, y3, 0.5, tmpSegY);
  adpativeBezier(tmpSegX[0], tmpSegY[0], tmpSegX[1], tmpSegY[1], tmpSegX[2], tmpSegY[2], tmpSegX[3], tmpSegY[3], out2, scale3);
  adpativeBezier(tmpSegX[4], tmpSegY[4], tmpSegX[5], tmpSegY[5], tmpSegX[6], tmpSegY[6], tmpSegX[7], tmpSegY[7], out2, scale3);
}
function pathToPolygons(path, scale3) {
  var bezierArrayGroups = pathToBezierCurves(path);
  var polygons = [];
  scale3 = scale3 || 1;
  for (var i = 0; i < bezierArrayGroups.length; i++) {
    var beziers = bezierArrayGroups[i];
    var polygon = [];
    var x0 = beziers[0];
    var y0 = beziers[1];
    polygon.push(x0, y0);
    for (var k = 2; k < beziers.length; ) {
      var x1 = beziers[k++];
      var y1 = beziers[k++];
      var x2 = beziers[k++];
      var y2 = beziers[k++];
      var x3 = beziers[k++];
      var y3 = beziers[k++];
      adpativeBezier(x0, y0, x1, y1, x2, y2, x3, y3, polygon, scale3);
      x0 = x3;
      y0 = y3;
    }
    polygons.push(polygon);
  }
  return polygons;
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/tool/dividePath.js
function getDividingGrids(dimSize, rowDim, count) {
  var rowSize = dimSize[rowDim];
  var columnSize = dimSize[1 - rowDim];
  var ratio = Math.abs(rowSize / columnSize);
  var rowCount = Math.ceil(Math.sqrt(ratio * count));
  var columnCount = Math.floor(count / rowCount);
  if (columnCount === 0) {
    columnCount = 1;
    rowCount = count;
  }
  var grids = [];
  for (var i = 0; i < rowCount; i++) {
    grids.push(columnCount);
  }
  var currentCount = rowCount * columnCount;
  var remained = count - currentCount;
  if (remained > 0) {
    for (var i = 0; i < remained; i++) {
      grids[i % rowCount] += 1;
    }
  }
  return grids;
}
function divideSector(sectorShape, count, outShapes) {
  var r0 = sectorShape.r0;
  var r = sectorShape.r;
  var startAngle = sectorShape.startAngle;
  var endAngle = sectorShape.endAngle;
  var angle = Math.abs(endAngle - startAngle);
  var arcLen = angle * r;
  var deltaR = r - r0;
  var isAngleRow = arcLen > Math.abs(deltaR);
  var grids = getDividingGrids([arcLen, deltaR], isAngleRow ? 0 : 1, count);
  var rowSize = (isAngleRow ? angle : deltaR) / grids.length;
  for (var row = 0; row < grids.length; row++) {
    var columnSize = (isAngleRow ? deltaR : angle) / grids[row];
    for (var column = 0; column < grids[row]; column++) {
      var newShape = {};
      if (isAngleRow) {
        newShape.startAngle = startAngle + rowSize * row;
        newShape.endAngle = startAngle + rowSize * (row + 1);
        newShape.r0 = r0 + columnSize * column;
        newShape.r = r0 + columnSize * (column + 1);
      } else {
        newShape.startAngle = startAngle + columnSize * column;
        newShape.endAngle = startAngle + columnSize * (column + 1);
        newShape.r0 = r0 + rowSize * row;
        newShape.r = r0 + rowSize * (row + 1);
      }
      newShape.clockwise = sectorShape.clockwise;
      newShape.cx = sectorShape.cx;
      newShape.cy = sectorShape.cy;
      outShapes.push(newShape);
    }
  }
}
function divideRect(rectShape, count, outShapes) {
  var width = rectShape.width;
  var height = rectShape.height;
  var isHorizontalRow = width > height;
  var grids = getDividingGrids([width, height], isHorizontalRow ? 0 : 1, count);
  var rowSizeDim = isHorizontalRow ? "width" : "height";
  var columnSizeDim = isHorizontalRow ? "height" : "width";
  var rowDim = isHorizontalRow ? "x" : "y";
  var columnDim = isHorizontalRow ? "y" : "x";
  var rowSize = rectShape[rowSizeDim] / grids.length;
  for (var row = 0; row < grids.length; row++) {
    var columnSize = rectShape[columnSizeDim] / grids[row];
    for (var column = 0; column < grids[row]; column++) {
      var newShape = {};
      newShape[rowDim] = row * rowSize;
      newShape[columnDim] = column * columnSize;
      newShape[rowSizeDim] = rowSize;
      newShape[columnSizeDim] = columnSize;
      newShape.x += rectShape.x;
      newShape.y += rectShape.y;
      outShapes.push(newShape);
    }
  }
}
function crossProduct2d(x1, y1, x2, y2) {
  return x1 * y2 - x2 * y1;
}
function lineLineIntersect(a1x, a1y, a2x, a2y, b1x, b1y, b2x, b2y) {
  var mx = a2x - a1x;
  var my = a2y - a1y;
  var nx = b2x - b1x;
  var ny = b2y - b1y;
  var nmCrossProduct = crossProduct2d(nx, ny, mx, my);
  if (Math.abs(nmCrossProduct) < 1e-6) {
    return null;
  }
  var b1a1x = a1x - b1x;
  var b1a1y = a1y - b1y;
  var p = crossProduct2d(b1a1x, b1a1y, nx, ny) / nmCrossProduct;
  if (p < 0 || p > 1) {
    return null;
  }
  return new Point_default(p * mx + a1x, p * my + a1y);
}
function projPtOnLine(pt, lineA, lineB) {
  var dir3 = new Point_default();
  Point_default.sub(dir3, lineB, lineA);
  dir3.normalize();
  var dir22 = new Point_default();
  Point_default.sub(dir22, pt, lineA);
  var len2 = dir22.dot(dir3);
  return len2;
}
function addToPoly(poly, pt) {
  var last = poly[poly.length - 1];
  if (last && last[0] === pt[0] && last[1] === pt[1]) {
    return;
  }
  poly.push(pt);
}
function splitPolygonByLine(points2, lineA, lineB) {
  var len2 = points2.length;
  var intersections = [];
  for (var i = 0; i < len2; i++) {
    var p0 = points2[i];
    var p1 = points2[(i + 1) % len2];
    var intersectionPt = lineLineIntersect(p0[0], p0[1], p1[0], p1[1], lineA.x, lineA.y, lineB.x, lineB.y);
    if (intersectionPt) {
      intersections.push({
        projPt: projPtOnLine(intersectionPt, lineA, lineB),
        pt: intersectionPt,
        idx: i
      });
    }
  }
  if (intersections.length < 2) {
    return [{ points: points2 }, { points: points2 }];
  }
  intersections.sort(function(a, b) {
    return a.projPt - b.projPt;
  });
  var splitPt0 = intersections[0];
  var splitPt1 = intersections[intersections.length - 1];
  if (splitPt1.idx < splitPt0.idx) {
    var tmp = splitPt0;
    splitPt0 = splitPt1;
    splitPt1 = tmp;
  }
  var splitPt0Arr = [splitPt0.pt.x, splitPt0.pt.y];
  var splitPt1Arr = [splitPt1.pt.x, splitPt1.pt.y];
  var newPolyA = [splitPt0Arr];
  var newPolyB = [splitPt1Arr];
  for (var i = splitPt0.idx + 1; i <= splitPt1.idx; i++) {
    addToPoly(newPolyA, points2[i].slice());
  }
  addToPoly(newPolyA, splitPt1Arr);
  addToPoly(newPolyA, splitPt0Arr);
  for (var i = splitPt1.idx + 1; i <= splitPt0.idx + len2; i++) {
    addToPoly(newPolyB, points2[i % len2].slice());
  }
  addToPoly(newPolyB, splitPt0Arr);
  addToPoly(newPolyB, splitPt1Arr);
  return [{
    points: newPolyA
  }, {
    points: newPolyB
  }];
}
function binaryDividePolygon(polygonShape) {
  var points2 = polygonShape.points;
  var min3 = [];
  var max3 = [];
  fromPoints(points2, min3, max3);
  var boundingRect = new BoundingRect_default(min3[0], min3[1], max3[0] - min3[0], max3[1] - min3[1]);
  var width = boundingRect.width;
  var height = boundingRect.height;
  var x = boundingRect.x;
  var y = boundingRect.y;
  var pt02 = new Point_default();
  var pt12 = new Point_default();
  if (width > height) {
    pt02.x = pt12.x = x + width / 2;
    pt02.y = y;
    pt12.y = y + height;
  } else {
    pt02.y = pt12.y = y + height / 2;
    pt02.x = x;
    pt12.x = x + width;
  }
  return splitPolygonByLine(points2, pt02, pt12);
}
function binaryDivideRecursive(divider, shape, count, out2) {
  if (count === 1) {
    out2.push(shape);
  } else {
    var mid = Math.floor(count / 2);
    var sub2 = divider(shape);
    binaryDivideRecursive(divider, sub2[0], mid, out2);
    binaryDivideRecursive(divider, sub2[1], count - mid, out2);
  }
  return out2;
}
function clone3(path, count) {
  var paths = [];
  for (var i = 0; i < count; i++) {
    paths.push(clonePath(path));
  }
  return paths;
}
function copyPathProps(source, target) {
  target.setStyle(source.style);
  target.z = source.z;
  target.z2 = source.z2;
  target.zlevel = source.zlevel;
}
function polygonConvert(points2) {
  var out2 = [];
  for (var i = 0; i < points2.length; ) {
    out2.push([points2[i++], points2[i++]]);
  }
  return out2;
}
function split(path, count) {
  var outShapes = [];
  var shape = path.shape;
  var OutShapeCtor;
  switch (path.type) {
    case "rect":
      divideRect(shape, count, outShapes);
      OutShapeCtor = Rect_default;
      break;
    case "sector":
      divideSector(shape, count, outShapes);
      OutShapeCtor = Sector_default;
      break;
    case "circle":
      divideSector({
        r0: 0,
        r: shape.r,
        startAngle: 0,
        endAngle: Math.PI * 2,
        cx: shape.cx,
        cy: shape.cy
      }, count, outShapes);
      OutShapeCtor = Sector_default;
      break;
    default:
      var m = path.getComputedTransform();
      var scale3 = m ? Math.sqrt(Math.max(m[0] * m[0] + m[1] * m[1], m[2] * m[2] + m[3] * m[3])) : 1;
      var polygons = map(pathToPolygons(path.getUpdatedPathProxy(), scale3), function(poly) {
        return polygonConvert(poly);
      });
      var polygonCount = polygons.length;
      if (polygonCount === 0) {
        binaryDivideRecursive(binaryDividePolygon, {
          points: polygons[0]
        }, count, outShapes);
      } else if (polygonCount === count) {
        for (var i = 0; i < polygonCount; i++) {
          outShapes.push({
            points: polygons[i]
          });
        }
      } else {
        var totalArea_1 = 0;
        var items = map(polygons, function(poly) {
          var min3 = [];
          var max3 = [];
          fromPoints(poly, min3, max3);
          var area = (max3[1] - min3[1]) * (max3[0] - min3[0]);
          totalArea_1 += area;
          return { poly, area };
        });
        items.sort(function(a, b) {
          return b.area - a.area;
        });
        var left = count;
        for (var i = 0; i < polygonCount; i++) {
          var item = items[i];
          if (left <= 0) {
            break;
          }
          var selfCount = i === polygonCount - 1 ? left : Math.ceil(item.area / totalArea_1 * count);
          if (selfCount < 0) {
            continue;
          }
          binaryDivideRecursive(binaryDividePolygon, {
            points: item.poly
          }, selfCount, outShapes);
          left -= selfCount;
        }
        ;
      }
      OutShapeCtor = Polygon_default;
      break;
  }
  if (!OutShapeCtor) {
    return clone3(path, count);
  }
  var out2 = [];
  for (var i = 0; i < outShapes.length; i++) {
    var subPath = new OutShapeCtor();
    subPath.setShape(outShapes[i]);
    copyPathProps(path, subPath);
    out2.push(subPath);
  }
  return out2;
}

// ../../node_modules/.pnpm/zrender@6.1.0/node_modules/zrender/lib/tool/morphPath.js
function alignSubpath(subpath1, subpath2) {
  var len1 = subpath1.length;
  var len2 = subpath2.length;
  if (len1 === len2) {
    return [subpath1, subpath2];
  }
  var tmpSegX = [];
  var tmpSegY = [];
  var shorterPath = len1 < len2 ? subpath1 : subpath2;
  var shorterLen = Math.min(len1, len2);
  var diff = Math.abs(len2 - len1) / 6;
  var shorterBezierCount = (shorterLen - 2) / 6;
  var eachCurveSubDivCount = Math.ceil(diff / shorterBezierCount) + 1;
  var newSubpath = [shorterPath[0], shorterPath[1]];
  var remained = diff;
  for (var i = 2; i < shorterLen; ) {
    var x0 = shorterPath[i - 2];
    var y0 = shorterPath[i - 1];
    var x1 = shorterPath[i++];
    var y1 = shorterPath[i++];
    var x2 = shorterPath[i++];
    var y2 = shorterPath[i++];
    var x3 = shorterPath[i++];
    var y3 = shorterPath[i++];
    if (remained <= 0) {
      newSubpath.push(x1, y1, x2, y2, x3, y3);
      continue;
    }
    var actualSubDivCount = Math.min(remained, eachCurveSubDivCount - 1) + 1;
    for (var k = 1; k <= actualSubDivCount; k++) {
      var p = k / actualSubDivCount;
      cubicSubdivide(x0, x1, x2, x3, p, tmpSegX);
      cubicSubdivide(y0, y1, y2, y3, p, tmpSegY);
      x0 = tmpSegX[3];
      y0 = tmpSegY[3];
      newSubpath.push(tmpSegX[1], tmpSegY[1], tmpSegX[2], tmpSegY[2], x0, y0);
      x1 = tmpSegX[5];
      y1 = tmpSegY[5];
      x2 = tmpSegX[6];
      y2 = tmpSegY[6];
    }
    remained -= actualSubDivCount - 1;
  }
  return shorterPath === subpath1 ? [newSubpath, subpath2] : [subpath1, newSubpath];
}
function createSubpath(lastSubpathSubpath, otherSubpath) {
  var len2 = lastSubpathSubpath.length;
  var lastX = lastSubpathSubpath[len2 - 2];
  var lastY = lastSubpathSubpath[len2 - 1];
  var newSubpath = [];
  for (var i = 0; i < otherSubpath.length; ) {
    newSubpath[i++] = lastX;
    newSubpath[i++] = lastY;
  }
  return newSubpath;
}
function alignBezierCurves(array1, array2) {
  var _a2;
  var lastSubpath1;
  var lastSubpath2;
  var newArray1 = [];
  var newArray2 = [];
  for (var i = 0; i < Math.max(array1.length, array2.length); i++) {
    var subpath1 = array1[i];
    var subpath2 = array2[i];
    var newSubpath1 = void 0;
    var newSubpath2 = void 0;
    if (!subpath1) {
      newSubpath1 = createSubpath(lastSubpath1 || subpath2, subpath2);
      newSubpath2 = subpath2;
    } else if (!subpath2) {
      newSubpath2 = createSubpath(lastSubpath2 || subpath1, subpath1);
      newSubpath1 = subpath1;
    } else {
      _a2 = alignSubpath(subpath1, subpath2), newSubpath1 = _a2[0], newSubpath2 = _a2[1];
      lastSubpath1 = newSubpath1;
      lastSubpath2 = newSubpath2;
    }
    newArray1.push(newSubpath1);
    newArray2.push(newSubpath2);
  }
  return [newArray1, newArray2];
}
function centroid(array) {
  var signedArea = 0;
  var cx = 0;
  var cy = 0;
  var len2 = array.length;
  for (var i = 0, j = len2 - 2; i < len2; j = i, i += 2) {
    var x0 = array[j];
    var y0 = array[j + 1];
    var x1 = array[i];
    var y1 = array[i + 1];
    var a = x0 * y1 - x1 * y0;
    signedArea += a;
    cx += (x0 + x1) * a;
    cy += (y0 + y1) * a;
  }
  if (signedArea === 0) {
    return [array[0] || 0, array[1] || 0];
  }
  return [cx / signedArea / 3, cy / signedArea / 3, signedArea];
}
function findBestRingOffset(fromSubBeziers, toSubBeziers, fromCp, toCp) {
  var bezierCount = (fromSubBeziers.length - 2) / 6;
  var bestScore = Infinity;
  var bestOffset = 0;
  var len2 = fromSubBeziers.length;
  var len22 = len2 - 2;
  for (var offset = 0; offset < bezierCount; offset++) {
    var cursorOffset = offset * 6;
    var score = 0;
    for (var k = 0; k < len2; k += 2) {
      var idx = k === 0 ? cursorOffset : (cursorOffset + k - 2) % len22 + 2;
      var x0 = fromSubBeziers[idx] - fromCp[0];
      var y0 = fromSubBeziers[idx + 1] - fromCp[1];
      var x1 = toSubBeziers[k] - toCp[0];
      var y1 = toSubBeziers[k + 1] - toCp[1];
      var dx = x1 - x0;
      var dy = y1 - y0;
      score += dx * dx + dy * dy;
    }
    if (score < bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }
  return bestOffset;
}
function reverse(array) {
  var newArr = [];
  var len2 = array.length;
  for (var i = 0; i < len2; i += 2) {
    newArr[i] = array[len2 - i - 2];
    newArr[i + 1] = array[len2 - i - 1];
  }
  return newArr;
}
function findBestMorphingRotation(fromArr, toArr, searchAngleIteration, searchAngleRange) {
  var result = [];
  var fromNeedsReverse;
  for (var i = 0; i < fromArr.length; i++) {
    var fromSubpathBezier = fromArr[i];
    var toSubpathBezier = toArr[i];
    var fromCp = centroid(fromSubpathBezier);
    var toCp = centroid(toSubpathBezier);
    if (fromNeedsReverse == null) {
      fromNeedsReverse = fromCp[2] < 0 !== toCp[2] < 0;
    }
    var newFromSubpathBezier = [];
    var newToSubpathBezier = [];
    var bestAngle = 0;
    var bestScore = Infinity;
    var tmpArr2 = [];
    var len2 = fromSubpathBezier.length;
    if (fromNeedsReverse) {
      fromSubpathBezier = reverse(fromSubpathBezier);
    }
    var offset = findBestRingOffset(fromSubpathBezier, toSubpathBezier, fromCp, toCp) * 6;
    var len22 = len2 - 2;
    for (var k = 0; k < len22; k += 2) {
      var idx = (offset + k) % len22 + 2;
      newFromSubpathBezier[k + 2] = fromSubpathBezier[idx] - fromCp[0];
      newFromSubpathBezier[k + 3] = fromSubpathBezier[idx + 1] - fromCp[1];
    }
    newFromSubpathBezier[0] = fromSubpathBezier[offset] - fromCp[0];
    newFromSubpathBezier[1] = fromSubpathBezier[offset + 1] - fromCp[1];
    if (searchAngleIteration > 0) {
      var step = searchAngleRange / searchAngleIteration;
      for (var angle = -searchAngleRange / 2; angle <= searchAngleRange / 2; angle += step) {
        var sa = Math.sin(angle);
        var ca = Math.cos(angle);
        var score = 0;
        for (var k = 0; k < fromSubpathBezier.length; k += 2) {
          var x0 = newFromSubpathBezier[k];
          var y0 = newFromSubpathBezier[k + 1];
          var x1 = toSubpathBezier[k] - toCp[0];
          var y1 = toSubpathBezier[k + 1] - toCp[1];
          var newX1 = x1 * ca - y1 * sa;
          var newY1 = x1 * sa + y1 * ca;
          tmpArr2[k] = newX1;
          tmpArr2[k + 1] = newY1;
          var dx = newX1 - x0;
          var dy = newY1 - y0;
          score += dx * dx + dy * dy;
        }
        if (score < bestScore) {
          bestScore = score;
          bestAngle = angle;
          for (var m = 0; m < tmpArr2.length; m++) {
            newToSubpathBezier[m] = tmpArr2[m];
          }
        }
      }
    } else {
      for (var i_1 = 0; i_1 < len2; i_1 += 2) {
        newToSubpathBezier[i_1] = toSubpathBezier[i_1] - toCp[0];
        newToSubpathBezier[i_1 + 1] = toSubpathBezier[i_1 + 1] - toCp[1];
      }
    }
    result.push({
      from: newFromSubpathBezier,
      to: newToSubpathBezier,
      fromCp,
      toCp,
      rotation: -bestAngle
    });
  }
  return result;
}
function isCombineMorphing(path) {
  return path.__isCombineMorphing;
}
var SAVED_METHOD_PREFIX = "__mOriginal_";
function saveAndModifyMethod(obj, methodName, modifiers) {
  var savedMethodName = SAVED_METHOD_PREFIX + methodName;
  var originalMethod = obj[savedMethodName] || obj[methodName];
  if (!obj[savedMethodName]) {
    obj[savedMethodName] = obj[methodName];
  }
  var replace = modifiers.replace;
  var after = modifiers.after;
  var before = modifiers.before;
  obj[methodName] = function() {
    var args = arguments;
    var res;
    before && before.apply(this, args);
    if (replace) {
      res = replace.apply(this, args);
    } else {
      res = originalMethod.apply(this, args);
    }
    after && after.apply(this, args);
    return res;
  };
}
function restoreMethod(obj, methodName) {
  var savedMethodName = SAVED_METHOD_PREFIX + methodName;
  if (obj[savedMethodName]) {
    obj[methodName] = obj[savedMethodName];
    obj[savedMethodName] = null;
  }
}
function applyTransformOnBeziers(bezierCurves, mm) {
  for (var i = 0; i < bezierCurves.length; i++) {
    var subBeziers = bezierCurves[i];
    for (var k = 0; k < subBeziers.length; ) {
      var x = subBeziers[k];
      var y = subBeziers[k + 1];
      subBeziers[k++] = mm[0] * x + mm[2] * y + mm[4];
      subBeziers[k++] = mm[1] * x + mm[3] * y + mm[5];
    }
  }
}
function prepareMorphPath(fromPath, toPath) {
  var fromPathProxy = fromPath.getUpdatedPathProxy();
  var toPathProxy = toPath.getUpdatedPathProxy();
  var _a2 = alignBezierCurves(pathToBezierCurves(fromPathProxy), pathToBezierCurves(toPathProxy)), fromBezierCurves = _a2[0], toBezierCurves = _a2[1];
  var fromPathTransform = fromPath.getComputedTransform();
  var toPathTransform = toPath.getComputedTransform();
  function updateIdentityTransform() {
    this.transform = null;
  }
  fromPathTransform && applyTransformOnBeziers(fromBezierCurves, fromPathTransform);
  toPathTransform && applyTransformOnBeziers(toBezierCurves, toPathTransform);
  saveAndModifyMethod(toPath, "updateTransform", { replace: updateIdentityTransform });
  toPath.transform = null;
  var morphingData = findBestMorphingRotation(fromBezierCurves, toBezierCurves, 10, Math.PI);
  var tmpArr2 = [];
  saveAndModifyMethod(toPath, "buildPath", { replace: function(path) {
    var t = toPath.__morphT;
    var onet = 1 - t;
    var newCp = [];
    for (var i = 0; i < morphingData.length; i++) {
      var item = morphingData[i];
      var from = item.from;
      var to = item.to;
      var angle = item.rotation * t;
      var fromCp = item.fromCp;
      var toCp = item.toCp;
      var sa = Math.sin(angle);
      var ca = Math.cos(angle);
      lerp(newCp, fromCp, toCp, t);
      for (var m = 0; m < from.length; m += 2) {
        var x0_1 = from[m];
        var y0_1 = from[m + 1];
        var x1 = to[m];
        var y1 = to[m + 1];
        var x = x0_1 * onet + x1 * t;
        var y = y0_1 * onet + y1 * t;
        tmpArr2[m] = x * ca - y * sa + newCp[0];
        tmpArr2[m + 1] = x * sa + y * ca + newCp[1];
      }
      var x0 = tmpArr2[0];
      var y0 = tmpArr2[1];
      path.moveTo(x0, y0);
      for (var m = 2; m < from.length; ) {
        var x1 = tmpArr2[m++];
        var y1 = tmpArr2[m++];
        var x2 = tmpArr2[m++];
        var y2 = tmpArr2[m++];
        var x3 = tmpArr2[m++];
        var y3 = tmpArr2[m++];
        if (x0 === x1 && y0 === y1 && x2 === x3 && y2 === y3) {
          path.lineTo(x3, y3);
        } else {
          path.bezierCurveTo(x1, y1, x2, y2, x3, y3);
        }
        x0 = x3;
        y0 = y3;
      }
    }
  } });
}
function morphPath(fromPath, toPath, animationOpts) {
  if (!fromPath || !toPath) {
    return toPath;
  }
  var oldDone = animationOpts.done;
  var oldDuring = animationOpts.during;
  prepareMorphPath(fromPath, toPath);
  toPath.__morphT = 0;
  function restoreToPath() {
    restoreMethod(toPath, "buildPath");
    restoreMethod(toPath, "updateTransform");
    toPath.__morphT = -1;
    toPath.createPathProxy();
    toPath.dirtyShape();
  }
  toPath.animateTo({
    __morphT: 1
  }, defaults({
    during: function(p) {
      toPath.dirtyShape();
      oldDuring && oldDuring(p);
    },
    done: function() {
      restoreToPath();
      oldDone && oldDone();
    }
  }, animationOpts));
  return toPath;
}
function hilbert(x, y, minX, minY, maxX, maxY) {
  var bits = 16;
  x = maxX === minX ? 0 : Math.round(32767 * (x - minX) / (maxX - minX));
  y = maxY === minY ? 0 : Math.round(32767 * (y - minY) / (maxY - minY));
  var d = 0;
  var tmp;
  for (var s = (1 << bits) / 2; s > 0; s /= 2) {
    var rx = 0;
    var ry = 0;
    if ((x & s) > 0) {
      rx = 1;
    }
    if ((y & s) > 0) {
      ry = 1;
    }
    d += s * s * (3 * rx ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      tmp = x;
      x = y;
      y = tmp;
    }
  }
  return d;
}
function sortPaths(pathList) {
  var xMin = Infinity;
  var yMin = Infinity;
  var xMax = -Infinity;
  var yMax = -Infinity;
  var cps = map(pathList, function(path) {
    var rect = path.getBoundingRect();
    var m = path.getComputedTransform();
    var x = rect.x + rect.width / 2 + (m ? m[4] : 0);
    var y = rect.y + rect.height / 2 + (m ? m[5] : 0);
    xMin = Math.min(x, xMin);
    yMin = Math.min(y, yMin);
    xMax = Math.max(x, xMax);
    yMax = Math.max(y, yMax);
    return [x, y];
  });
  var items = map(cps, function(cp, idx) {
    return {
      cp,
      z: hilbert(cp[0], cp[1], xMin, yMin, xMax, yMax),
      path: pathList[idx]
    };
  });
  return items.sort(function(a, b) {
    return a.z - b.z;
  }).map(function(item) {
    return item.path;
  });
}
function defaultDividePath(param) {
  return split(param.path, param.count);
}
function createEmptyReturn() {
  return {
    fromIndividuals: [],
    toIndividuals: [],
    count: 0
  };
}
function combineMorph(fromList, toPath, animationOpts) {
  var fromPathList = [];
  function addFromPath(fromList2) {
    for (var i2 = 0; i2 < fromList2.length; i2++) {
      var from2 = fromList2[i2];
      if (isCombineMorphing(from2)) {
        addFromPath(from2.childrenRef());
      } else if (from2 instanceof Path_default) {
        fromPathList.push(from2);
      }
    }
  }
  addFromPath(fromList);
  var separateCount = fromPathList.length;
  if (!separateCount) {
    return createEmptyReturn();
  }
  var dividePath = animationOpts.dividePath || defaultDividePath;
  var toSubPathList = dividePath({
    path: toPath,
    count: separateCount
  });
  if (toSubPathList.length !== separateCount) {
    console.error("Invalid morphing: unmatched splitted path");
    return createEmptyReturn();
  }
  fromPathList = sortPaths(fromPathList);
  toSubPathList = sortPaths(toSubPathList);
  var oldDone = animationOpts.done;
  var oldDuring = animationOpts.during;
  var individualDelay = animationOpts.individualDelay;
  var identityTransform = new Transformable_default();
  for (var i = 0; i < separateCount; i++) {
    var from = fromPathList[i];
    var to = toSubPathList[i];
    to.parent = toPath;
    to.copyTransform(identityTransform);
    if (!individualDelay) {
      prepareMorphPath(from, to);
    }
  }
  toPath.__isCombineMorphing = true;
  toPath.childrenRef = function() {
    return toSubPathList;
  };
  function addToSubPathListToZr(zr) {
    for (var i2 = 0; i2 < toSubPathList.length; i2++) {
      toSubPathList[i2].addSelfToZr(zr);
    }
  }
  saveAndModifyMethod(toPath, "addSelfToZr", {
    after: function(zr) {
      addToSubPathListToZr(zr);
    }
  });
  saveAndModifyMethod(toPath, "removeSelfFromZr", {
    after: function(zr) {
      for (var i2 = 0; i2 < toSubPathList.length; i2++) {
        toSubPathList[i2].removeSelfFromZr(zr);
      }
    }
  });
  function restoreToPath() {
    toPath.__isCombineMorphing = false;
    toPath.__morphT = -1;
    toPath.childrenRef = null;
    restoreMethod(toPath, "addSelfToZr");
    restoreMethod(toPath, "removeSelfFromZr");
  }
  var toLen = toSubPathList.length;
  if (individualDelay) {
    var animating_1 = toLen;
    var eachDone = function() {
      animating_1--;
      if (animating_1 === 0) {
        restoreToPath();
        oldDone && oldDone();
      }
    };
    for (var i = 0; i < toLen; i++) {
      var indivdualAnimationOpts = individualDelay ? defaults({
        delay: (animationOpts.delay || 0) + individualDelay(i, toLen, fromPathList[i], toSubPathList[i]),
        done: eachDone
      }, animationOpts) : animationOpts;
      morphPath(fromPathList[i], toSubPathList[i], indivdualAnimationOpts);
    }
  } else {
    toPath.__morphT = 0;
    toPath.animateTo({
      __morphT: 1
    }, defaults({
      during: function(p) {
        for (var i2 = 0; i2 < toLen; i2++) {
          var child = toSubPathList[i2];
          child.__morphT = toPath.__morphT;
          child.dirtyShape();
        }
        oldDuring && oldDuring(p);
      },
      done: function() {
        restoreToPath();
        for (var i2 = 0; i2 < fromList.length; i2++) {
          restoreMethod(fromList[i2], "updateTransform");
        }
        oldDone && oldDone();
      }
    }, animationOpts));
  }
  if (toPath.__zr) {
    addToSubPathListToZr(toPath.__zr);
  }
  return {
    fromIndividuals: fromPathList,
    toIndividuals: toSubPathList,
    count: toLen
  };
}
function separateMorph(fromPath, toPathList, animationOpts) {
  var toLen = toPathList.length;
  var fromPathList = [];
  var dividePath = animationOpts.dividePath || defaultDividePath;
  function addFromPath(fromList) {
    for (var i2 = 0; i2 < fromList.length; i2++) {
      var from = fromList[i2];
      if (isCombineMorphing(from)) {
        addFromPath(from.childrenRef());
      } else if (from instanceof Path_default) {
        fromPathList.push(from);
      }
    }
  }
  if (isCombineMorphing(fromPath)) {
    addFromPath(fromPath.childrenRef());
    var fromLen = fromPathList.length;
    if (fromLen < toLen) {
      var k = 0;
      for (var i = fromLen; i < toLen; i++) {
        fromPathList.push(clonePath(fromPathList[k++ % fromLen]));
      }
    }
    fromPathList.length = toLen;
  } else {
    fromPathList = dividePath({ path: fromPath, count: toLen });
    var fromPathTransform = fromPath.getComputedTransform();
    for (var i = 0; i < fromPathList.length; i++) {
      fromPathList[i].setLocalTransform(fromPathTransform);
    }
    if (fromPathList.length !== toLen) {
      console.error("Invalid morphing: unmatched splitted path");
      return createEmptyReturn();
    }
  }
  fromPathList = sortPaths(fromPathList);
  toPathList = sortPaths(toPathList);
  var individualDelay = animationOpts.individualDelay;
  for (var i = 0; i < toLen; i++) {
    var indivdualAnimationOpts = individualDelay ? defaults({
      delay: (animationOpts.delay || 0) + individualDelay(i, toLen, fromPathList[i], toPathList[i])
    }, animationOpts) : animationOpts;
    morphPath(fromPathList[i], toPathList[i], indivdualAnimationOpts);
  }
  return {
    fromIndividuals: fromPathList,
    toIndividuals: toPathList,
    count: toPathList.length
  };
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/animation/morphTransitionHelper.js
function isMultiple(elements) {
  return isArray(elements[0]);
}
function prepareMorphBatches(one, many) {
  var batches = [];
  var batchCount = one.length;
  for (var i = 0; i < batchCount; i++) {
    batches.push({
      one: one[i],
      many: []
    });
  }
  for (var i = 0; i < many.length; i++) {
    var len2 = many[i].length;
    var k = void 0;
    for (k = 0; k < len2; k++) {
      batches[k % batchCount].many.push(many[i][k]);
    }
  }
  var off = 0;
  for (var i = batchCount - 1; i >= 0; i--) {
    if (!batches[i].many.length) {
      var moveFrom = batches[off].many;
      if (moveFrom.length <= 1) {
        if (off) {
          off = 0;
        } else {
          return batches;
        }
      }
      var len2 = moveFrom.length;
      var mid = Math.ceil(len2 / 2);
      batches[i].many = moveFrom.slice(mid, len2);
      batches[off].many = moveFrom.slice(0, mid);
      off++;
    }
  }
  return batches;
}
var pathDividers = {
  clone: function(params) {
    var ret = [];
    var approxOpacity = 1 - Math.pow(1 - params.path.style.opacity, 1 / params.count);
    for (var i = 0; i < params.count; i++) {
      var cloned = clonePath(params.path);
      cloned.setStyle("opacity", approxOpacity);
      ret.push(cloned);
    }
    return ret;
  },
  // Use the default divider
  split: null
};
function applyMorphAnimation(from, to, divideShape, seriesModel, dataIndex, animateOtherProps) {
  if (!from.length || !to.length) {
    return;
  }
  var updateAnimationCfg = getAnimationConfig("update", seriesModel, dataIndex);
  if (!(updateAnimationCfg && updateAnimationCfg.duration > 0)) {
    return;
  }
  var animationDelay = seriesModel.getModel("universalTransition").get("delay");
  var animationCfg = extend({
    // Need to setToFinal so the further calculation based on the style can be correct.
    // Like emphasis color.
    setToFinal: true
  }, updateAnimationCfg);
  var many;
  var one;
  if (isMultiple(from)) {
    many = from;
    one = to;
  }
  if (isMultiple(to)) {
    many = to;
    one = from;
  }
  function morphOneBatch(batch, fromIsMany2, animateIndex2, animateCount2, forceManyOne) {
    var batchMany = batch.many;
    var batchOne = batch.one;
    if (batchMany.length === 1 && !forceManyOne) {
      var batchFrom = fromIsMany2 ? batchMany[0] : batchOne;
      var batchTo = fromIsMany2 ? batchOne : batchMany[0];
      if (isCombineMorphing(batchFrom)) {
        morphOneBatch({
          many: [batchFrom],
          one: batchTo
        }, true, animateIndex2, animateCount2, true);
      } else {
        var individualAnimationCfg = animationDelay ? defaults({
          delay: animationDelay(animateIndex2, animateCount2)
        }, animationCfg) : animationCfg;
        morphPath(batchFrom, batchTo, individualAnimationCfg);
        animateOtherProps(batchFrom, batchTo, batchFrom, batchTo, individualAnimationCfg);
      }
    } else {
      var separateAnimationCfg = defaults({
        dividePath: pathDividers[divideShape],
        individualDelay: animationDelay && function(idx, count2, fromPath, toPath) {
          return animationDelay(idx + animateIndex2, animateCount2);
        }
      }, animationCfg);
      var _a2 = fromIsMany2 ? combineMorph(batchMany, batchOne, separateAnimationCfg) : separateMorph(batchOne, batchMany, separateAnimationCfg), fromIndividuals = _a2.fromIndividuals, toIndividuals = _a2.toIndividuals;
      var count = fromIndividuals.length;
      for (var k = 0; k < count; k++) {
        var individualAnimationCfg = animationDelay ? defaults({
          delay: animationDelay(k, count)
        }, animationCfg) : animationCfg;
        animateOtherProps(fromIndividuals[k], toIndividuals[k], fromIsMany2 ? batchMany[k] : batch.one, fromIsMany2 ? batch.one : batchMany[k], individualAnimationCfg);
      }
    }
  }
  var fromIsMany = many ? many === from : from.length > to.length;
  var morphBatches = many ? prepareMorphBatches(one, many) : prepareMorphBatches(fromIsMany ? to : from, [fromIsMany ? from : to]);
  var animateCount = 0;
  for (var i = 0; i < morphBatches.length; i++) {
    animateCount += morphBatches[i].many.length;
  }
  var animateIndex = 0;
  for (var i = 0; i < morphBatches.length; i++) {
    morphOneBatch(morphBatches[i], fromIsMany, animateIndex, animateCount);
    animateIndex += morphBatches[i].many.length;
  }
}
function getPathList(elements) {
  if (!elements) {
    return [];
  }
  if (isArray(elements)) {
    var pathList_1 = [];
    for (var i = 0; i < elements.length; i++) {
      pathList_1.push(getPathList(elements[i]));
    }
    return pathList_1;
  }
  var pathList = [];
  elements.traverse(function(el) {
    if (el instanceof Path_default && !el.disableMorphing && !el.invisible && !el.ignore) {
      pathList.push(el);
    }
  });
  return pathList;
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/data/DataDiffer.js
function dataIndexMapValueLength(valNumOrArrLengthMoreThan2) {
  return valNumOrArrLengthMoreThan2 == null ? 0 : valNumOrArrLengthMoreThan2.length || 1;
}
function defaultKeyGetter(item) {
  return item;
}
var DataDiffer = (
  /** @class */
  (function() {
    function DataDiffer2(oldArr, newArr, oldKeyGetter, newKeyGetter, context, diffMode) {
      this._old = oldArr;
      this._new = newArr;
      this._oldKeyGetter = oldKeyGetter || defaultKeyGetter;
      this._newKeyGetter = newKeyGetter || defaultKeyGetter;
      this.context = context;
      this._diffModeMultiple = diffMode === "multiple";
    }
    DataDiffer2.prototype.add = function(func) {
      this._add = func;
      return this;
    };
    DataDiffer2.prototype.update = function(func) {
      this._update = func;
      return this;
    };
    DataDiffer2.prototype.updateManyToOne = function(func) {
      this._updateManyToOne = func;
      return this;
    };
    DataDiffer2.prototype.updateOneToMany = function(func) {
      this._updateOneToMany = func;
      return this;
    };
    DataDiffer2.prototype.updateManyToMany = function(func) {
      this._updateManyToMany = func;
      return this;
    };
    DataDiffer2.prototype.remove = function(func) {
      this._remove = func;
      return this;
    };
    DataDiffer2.prototype.execute = function() {
      this[this._diffModeMultiple ? "_executeMultiple" : "_executeOneToOne"]();
    };
    DataDiffer2.prototype._executeOneToOne = function() {
      var oldArr = this._old;
      var newArr = this._new;
      var newDataIndexMap = {};
      var oldDataKeyArr = new Array(oldArr.length);
      var newDataKeyArr = new Array(newArr.length);
      this._initIndexMap(oldArr, null, oldDataKeyArr, "_oldKeyGetter");
      this._initIndexMap(newArr, newDataIndexMap, newDataKeyArr, "_newKeyGetter");
      for (var i = 0; i < oldArr.length; i++) {
        var oldKey = oldDataKeyArr[i];
        var newIdxMapVal = newDataIndexMap[oldKey];
        var newIdxMapValLen = dataIndexMapValueLength(newIdxMapVal);
        if (newIdxMapValLen > 1) {
          var newIdx = newIdxMapVal.shift();
          if (newIdxMapVal.length === 1) {
            newDataIndexMap[oldKey] = newIdxMapVal[0];
          }
          this._update && this._update(newIdx, i);
        } else if (newIdxMapValLen === 1) {
          newDataIndexMap[oldKey] = null;
          this._update && this._update(newIdxMapVal, i);
        } else {
          this._remove && this._remove(i);
        }
      }
      this._performRestAdd(newDataKeyArr, newDataIndexMap);
    };
    DataDiffer2.prototype._executeMultiple = function() {
      var oldArr = this._old;
      var newArr = this._new;
      var oldDataIndexMap = {};
      var newDataIndexMap = {};
      var oldDataKeyArr = [];
      var newDataKeyArr = [];
      this._initIndexMap(oldArr, oldDataIndexMap, oldDataKeyArr, "_oldKeyGetter");
      this._initIndexMap(newArr, newDataIndexMap, newDataKeyArr, "_newKeyGetter");
      for (var i = 0; i < oldDataKeyArr.length; i++) {
        var oldKey = oldDataKeyArr[i];
        var oldIdxMapVal = oldDataIndexMap[oldKey];
        var newIdxMapVal = newDataIndexMap[oldKey];
        var oldIdxMapValLen = dataIndexMapValueLength(oldIdxMapVal);
        var newIdxMapValLen = dataIndexMapValueLength(newIdxMapVal);
        if (oldIdxMapValLen > 1 && newIdxMapValLen === 1) {
          this._updateManyToOne && this._updateManyToOne(newIdxMapVal, oldIdxMapVal);
          newDataIndexMap[oldKey] = null;
        } else if (oldIdxMapValLen === 1 && newIdxMapValLen > 1) {
          this._updateOneToMany && this._updateOneToMany(newIdxMapVal, oldIdxMapVal);
          newDataIndexMap[oldKey] = null;
        } else if (oldIdxMapValLen === 1 && newIdxMapValLen === 1) {
          this._update && this._update(newIdxMapVal, oldIdxMapVal);
          newDataIndexMap[oldKey] = null;
        } else if (oldIdxMapValLen > 1 && newIdxMapValLen > 1) {
          this._updateManyToMany && this._updateManyToMany(newIdxMapVal, oldIdxMapVal);
          newDataIndexMap[oldKey] = null;
        } else if (oldIdxMapValLen > 1) {
          for (var i_1 = 0; i_1 < oldIdxMapValLen; i_1++) {
            this._remove && this._remove(oldIdxMapVal[i_1]);
          }
        } else {
          this._remove && this._remove(oldIdxMapVal);
        }
      }
      this._performRestAdd(newDataKeyArr, newDataIndexMap);
    };
    DataDiffer2.prototype._performRestAdd = function(newDataKeyArr, newDataIndexMap) {
      for (var i = 0; i < newDataKeyArr.length; i++) {
        var newKey = newDataKeyArr[i];
        var newIdxMapVal = newDataIndexMap[newKey];
        var idxMapValLen = dataIndexMapValueLength(newIdxMapVal);
        if (idxMapValLen > 1) {
          for (var j = 0; j < idxMapValLen; j++) {
            this._add && this._add(newIdxMapVal[j]);
          }
        } else if (idxMapValLen === 1) {
          this._add && this._add(newIdxMapVal);
        }
        newDataIndexMap[newKey] = null;
      }
    };
    DataDiffer2.prototype._initIndexMap = function(arr, map2, keyArr, keyGetterName) {
      var cbModeMultiple = this._diffModeMultiple;
      for (var i = 0; i < arr.length; i++) {
        var key2 = "_ec_" + this[keyGetterName](arr[i], i);
        if (!cbModeMultiple) {
          keyArr[i] = key2;
        }
        if (!map2) {
          continue;
        }
        var idxMapVal = map2[key2];
        var idxMapValLen = dataIndexMapValueLength(idxMapVal);
        if (idxMapValLen === 0) {
          map2[key2] = i;
          if (cbModeMultiple) {
            keyArr.push(key2);
          }
        } else if (idxMapValLen === 1) {
          map2[key2] = [idxMapVal, i];
        } else {
          idxMapVal.push(i);
        }
      }
    };
    return DataDiffer2;
  })()
);
var DataDiffer_default = DataDiffer;

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/animation/universalTransition.js
var DATA_COUNT_THRESHOLD = 1e4;
var TRANSITION_NONE = 0;
var TRANSITION_P2C = 1;
var TRANSITION_C2P = 2;
var getUniversalTransitionGlobalStore = makeInner();
function getDimension(data, visualDimension) {
  var dimensions = data.dimensions;
  for (var i = 0; i < dimensions.length; i++) {
    var dimInfo = data.getDimensionInfo(dimensions[i]);
    if (dimInfo && dimInfo.otherDims[visualDimension] === 0) {
      return dimensions[i];
    }
  }
}
function getValueByDimension(data, dataIndex, dimension) {
  var dimInfo = data.getDimensionInfo(dimension);
  var dimOrdinalMeta = dimInfo && dimInfo.ordinalMeta;
  if (dimInfo) {
    var value = data.get(dimInfo.name, dataIndex);
    if (dimOrdinalMeta) {
      return dimOrdinalMeta.categories[value] || value + "";
    }
    return value + "";
  }
}
function getGroupId(data, dataIndex, dataGroupId, isChild) {
  var visualDimension = isChild ? "itemChildGroupId" : "itemGroupId";
  var groupIdDim = getDimension(data, visualDimension);
  if (groupIdDim) {
    var groupId = getValueByDimension(data, dataIndex, groupIdDim);
    return groupId;
  }
  var rawDataItem = data.getRawDataItem(dataIndex);
  var property = isChild ? "childGroupId" : "groupId";
  if (rawDataItem && rawDataItem[property]) {
    return rawDataItem[property] + "";
  }
  if (isChild) {
    return;
  }
  return dataGroupId || data.getId(dataIndex);
}
function flattenDataDiffItems(list) {
  var items = [];
  each(list, function(seriesInfo) {
    var data = seriesInfo.data;
    var dataGroupId = seriesInfo.dataGroupId;
    if (data.count() > DATA_COUNT_THRESHOLD) {
      if (false) {
        warn("Universal transition is disabled on large data > 10k.");
      }
      return;
    }
    var indices = data.getIndices();
    for (var dataIndex = 0; dataIndex < indices.length; dataIndex++) {
      items.push({
        data,
        groupId: getGroupId(data, dataIndex, dataGroupId, false),
        childGroupId: getGroupId(data, dataIndex, dataGroupId, true),
        divide: seriesInfo.divide,
        dataIndex
      });
    }
  });
  return items;
}
function fadeInElement(newEl, newSeries, newIndex) {
  newEl.traverse(function(el) {
    if (el instanceof Path_default) {
      initProps(el, {
        style: {
          opacity: 0
        }
      }, newSeries, {
        dataIndex: newIndex,
        isFrom: true
      });
    }
  });
}
function removeEl(el) {
  if (el.parent) {
    var computedTransform = el.getComputedTransform();
    el.setLocalTransform(computedTransform);
    el.parent.remove(el);
  }
}
function stopAnimation(el) {
  el.stopAnimation();
  if (el.isGroup) {
    el.traverse(function(child) {
      child.stopAnimation();
    });
  }
}
function animateElementStyles(el, dataIndex, seriesModel) {
  var animationConfig = getAnimationConfig("update", seriesModel, dataIndex);
  animationConfig && el.traverse(function(child) {
    if (child instanceof Displayable_default) {
      var oldStyle = getOldStyle(child);
      if (oldStyle) {
        child.animateFrom({
          style: oldStyle
        }, animationConfig);
      }
    }
  });
}
function isAllIdSame(oldDiffItems, newDiffItems) {
  var len2 = oldDiffItems.length;
  if (len2 !== newDiffItems.length) {
    return false;
  }
  for (var i = 0; i < len2; i++) {
    var oldItem = oldDiffItems[i];
    var newItem = newDiffItems[i];
    if (oldItem.data.getId(oldItem.dataIndex) !== newItem.data.getId(newItem.dataIndex)) {
      return false;
    }
  }
  return true;
}
function transitionBetween(oldList, newList, api) {
  var oldDiffItems = flattenDataDiffItems(oldList);
  var newDiffItems = flattenDataDiffItems(newList);
  function updateMorphingPathProps(from, to, rawFrom, rawTo, animationCfg) {
    if (rawFrom || from) {
      to.animateFrom({
        style: rawFrom && rawFrom !== from ? extend(extend({}, rawFrom.style), from.style) : from.style
      }, animationCfg);
    }
  }
  var hasMorphAnimation = false;
  var direction = TRANSITION_NONE;
  var oldGroupIds = createHashMap();
  var oldChildGroupIds = createHashMap();
  each(oldDiffItems, function(item) {
    item.groupId && oldGroupIds.set(item.groupId, true);
    item.childGroupId && oldChildGroupIds.set(item.childGroupId, true);
  });
  for (var i = 0; i < newDiffItems.length; i++) {
    var newGroupId = newDiffItems[i].groupId;
    if (oldChildGroupIds.get(newGroupId)) {
      direction = TRANSITION_P2C;
      break;
    }
    var newChildGroupId = newDiffItems[i].childGroupId;
    if (newChildGroupId && oldGroupIds.get(newChildGroupId)) {
      direction = TRANSITION_C2P;
      break;
    }
  }
  function createKeyGetter(isOld, onlyGetId) {
    return function(diffItem) {
      var data = diffItem.data;
      var dataIndex = diffItem.dataIndex;
      if (onlyGetId) {
        return data.getId(dataIndex);
      }
      if (isOld) {
        return direction === TRANSITION_P2C ? diffItem.childGroupId : diffItem.groupId;
      } else {
        return direction === TRANSITION_C2P ? diffItem.childGroupId : diffItem.groupId;
      }
    };
  }
  var useId = isAllIdSame(oldDiffItems, newDiffItems);
  var isElementStillInChart = {};
  if (!useId) {
    for (var i = 0; i < newDiffItems.length; i++) {
      var newItem = newDiffItems[i];
      var el = newItem.data.getItemGraphicEl(newItem.dataIndex);
      if (el) {
        isElementStillInChart[el.id] = true;
      }
    }
  }
  function updateOneToOne(newIndex, oldIndex) {
    var oldItem = oldDiffItems[oldIndex];
    var newItem2 = newDiffItems[newIndex];
    var newSeries = newItem2.data.hostModel;
    var oldEl = oldItem.data.getItemGraphicEl(oldItem.dataIndex);
    var newEl = newItem2.data.getItemGraphicEl(newItem2.dataIndex);
    if (oldEl === newEl) {
      newEl && animateElementStyles(newEl, newItem2.dataIndex, newSeries);
      return;
    }
    if (
      // We can't use the elements that already being morphed
      oldEl && isElementStillInChart[oldEl.id]
    ) {
      return;
    }
    if (newEl) {
      stopAnimation(newEl);
      if (oldEl) {
        stopAnimation(oldEl);
        removeEl(oldEl);
        hasMorphAnimation = true;
        applyMorphAnimation(getPathList(oldEl), getPathList(newEl), newItem2.divide, newSeries, newIndex, updateMorphingPathProps);
      } else {
        fadeInElement(newEl, newSeries, newIndex);
      }
    }
  }
  new DataDiffer_default(oldDiffItems, newDiffItems, createKeyGetter(true, useId), createKeyGetter(false, useId), null, "multiple").update(updateOneToOne).updateManyToOne(function(newIndex, oldIndices) {
    var newItem2 = newDiffItems[newIndex];
    var newData = newItem2.data;
    var newSeries = newData.hostModel;
    var newEl = newData.getItemGraphicEl(newItem2.dataIndex);
    var oldElsList = filter(map(oldIndices, function(idx) {
      return oldDiffItems[idx].data.getItemGraphicEl(oldDiffItems[idx].dataIndex);
    }), function(oldEl) {
      return oldEl && oldEl !== newEl && !isElementStillInChart[oldEl.id];
    });
    if (newEl) {
      stopAnimation(newEl);
      if (oldElsList.length) {
        each(oldElsList, function(oldEl) {
          stopAnimation(oldEl);
          removeEl(oldEl);
        });
        hasMorphAnimation = true;
        applyMorphAnimation(getPathList(oldElsList), getPathList(newEl), newItem2.divide, newSeries, newIndex, updateMorphingPathProps);
      } else {
        fadeInElement(newEl, newSeries, newItem2.dataIndex);
      }
    }
  }).updateOneToMany(function(newIndices, oldIndex) {
    var oldItem = oldDiffItems[oldIndex];
    var oldEl = oldItem.data.getItemGraphicEl(oldItem.dataIndex);
    if (oldEl && isElementStillInChart[oldEl.id]) {
      return;
    }
    var newElsList = filter(map(newIndices, function(idx) {
      return newDiffItems[idx].data.getItemGraphicEl(newDiffItems[idx].dataIndex);
    }), function(el2) {
      return el2 && el2 !== oldEl;
    });
    var newSeris = newDiffItems[newIndices[0]].data.hostModel;
    if (newElsList.length) {
      each(newElsList, function(newEl) {
        return stopAnimation(newEl);
      });
      if (oldEl) {
        stopAnimation(oldEl);
        removeEl(oldEl);
        hasMorphAnimation = true;
        applyMorphAnimation(
          getPathList(oldEl),
          getPathList(newElsList),
          oldItem.divide,
          // Use divide on old.
          newSeris,
          newIndices[0],
          updateMorphingPathProps
        );
      } else {
        each(newElsList, function(newEl) {
          return fadeInElement(newEl, newSeris, newIndices[0]);
        });
      }
    }
  }).updateManyToMany(function(newIndices, oldIndices) {
    new DataDiffer_default(oldIndices, newIndices, function(rawIdx) {
      return oldDiffItems[rawIdx].data.getId(oldDiffItems[rawIdx].dataIndex);
    }, function(rawIdx) {
      return newDiffItems[rawIdx].data.getId(newDiffItems[rawIdx].dataIndex);
    }).update(function(newIndex, oldIndex) {
      updateOneToOne(newIndices[newIndex], oldIndices[oldIndex]);
    }).execute();
  }).execute();
  if (hasMorphAnimation) {
    each(newList, function(_a2) {
      var data = _a2.data;
      var seriesModel = data.hostModel;
      var view = seriesModel && api.getViewOfSeriesModel(seriesModel);
      var animationCfg = getAnimationConfig("update", seriesModel, 0);
      if (view && seriesModel.isAnimationEnabled() && animationCfg && animationCfg.duration > 0) {
        view.group.traverse(function(el2) {
          if (el2 instanceof Path_default && !el2.animators.length) {
            el2.animateFrom({
              style: {
                opacity: 0
              }
            }, animationCfg);
          }
        });
      }
    });
  }
}
function getSeriesTransitionKey(series) {
  var seriesKey = series.getModel("universalTransition").get("seriesKey");
  if (!seriesKey) {
    return series.id;
  }
  return seriesKey;
}
function convertArraySeriesKeyToString(seriesKey) {
  if (isArray(seriesKey)) {
    return seriesKey.sort().join(",");
  }
  return seriesKey;
}
function getDivideShapeFromData(data) {
  if (data.hostModel) {
    return data.hostModel.getModel("universalTransition").get("divideShape");
  }
}
function findTransitionSeriesBatches(globalStore, params) {
  var updateBatches = createHashMap();
  var oldDataMap = createHashMap();
  var oldDataMapForSplit = createHashMap();
  each(globalStore.oldSeries, function(series, idx) {
    var oldDataGroupId = globalStore.oldDataGroupIds[idx];
    var oldData = globalStore.oldData[idx];
    var transitionKey = getSeriesTransitionKey(series);
    var transitionKeyStr = convertArraySeriesKeyToString(transitionKey);
    oldDataMap.set(transitionKeyStr, {
      dataGroupId: oldDataGroupId,
      data: oldData
    });
    if (isArray(transitionKey)) {
      each(transitionKey, function(key2) {
        oldDataMapForSplit.set(key2, {
          key: transitionKeyStr,
          dataGroupId: oldDataGroupId,
          data: oldData
        });
      });
    }
  });
  function checkTransitionSeriesKeyDuplicated(transitionKeyStr) {
    if (updateBatches.get(transitionKeyStr)) {
      warn("Duplicated seriesKey in universalTransition " + transitionKeyStr);
    }
  }
  each(params.updatedSeries, function(series) {
    if (series.isUniversalTransitionEnabled() && series.isAnimationEnabled()) {
      var newDataGroupId = series.get("dataGroupId");
      var newData = series.getData();
      var transitionKey = getSeriesTransitionKey(series);
      var transitionKeyStr = convertArraySeriesKeyToString(transitionKey);
      var oldData = oldDataMap.get(transitionKeyStr);
      if (oldData) {
        if (false) {
          checkTransitionSeriesKeyDuplicated(transitionKeyStr);
        }
        updateBatches.set(transitionKeyStr, {
          oldSeries: [{
            dataGroupId: oldData.dataGroupId,
            divide: getDivideShapeFromData(oldData.data),
            data: oldData.data
          }],
          newSeries: [{
            dataGroupId: newDataGroupId,
            divide: getDivideShapeFromData(newData),
            data: newData
          }]
        });
      } else {
        if (isArray(transitionKey)) {
          if (false) {
            checkTransitionSeriesKeyDuplicated(transitionKeyStr);
          }
          var oldSeries_1 = [];
          each(transitionKey, function(key2) {
            var oldData2 = oldDataMap.get(key2);
            if (oldData2.data) {
              oldSeries_1.push({
                dataGroupId: oldData2.dataGroupId,
                divide: getDivideShapeFromData(oldData2.data),
                data: oldData2.data
              });
            }
          });
          if (oldSeries_1.length) {
            updateBatches.set(transitionKeyStr, {
              oldSeries: oldSeries_1,
              newSeries: [{
                dataGroupId: newDataGroupId,
                data: newData,
                divide: getDivideShapeFromData(newData)
              }]
            });
          }
        } else {
          var oldData_1 = oldDataMapForSplit.get(transitionKey);
          if (oldData_1) {
            var batch = updateBatches.get(oldData_1.key);
            if (!batch) {
              batch = {
                oldSeries: [{
                  dataGroupId: oldData_1.dataGroupId,
                  data: oldData_1.data,
                  divide: getDivideShapeFromData(oldData_1.data)
                }],
                newSeries: []
              };
              updateBatches.set(oldData_1.key, batch);
            }
            batch.newSeries.push({
              dataGroupId: newDataGroupId,
              data: newData,
              divide: getDivideShapeFromData(newData)
            });
          }
        }
      }
    }
  });
  return updateBatches;
}
function querySeries(series, finder) {
  for (var i = 0; i < series.length; i++) {
    var found = finder.seriesIndex != null && finder.seriesIndex === series[i].seriesIndex || finder.seriesId != null && finder.seriesId === series[i].id;
    if (found) {
      return i;
    }
  }
}
function transitionSeriesFromOpt(transitionOpt, globalStore, params, api) {
  var from = [];
  var to = [];
  each(normalizeToArray(transitionOpt.from), function(finder) {
    var idx = querySeries(globalStore.oldSeries, finder);
    if (idx >= 0) {
      from.push({
        dataGroupId: globalStore.oldDataGroupIds[idx],
        data: globalStore.oldData[idx],
        // TODO can specify divideShape in transition.
        divide: getDivideShapeFromData(globalStore.oldData[idx]),
        groupIdDim: finder.dimension
      });
    }
  });
  each(normalizeToArray(transitionOpt.to), function(finder) {
    var idx = querySeries(params.updatedSeries, finder);
    if (idx >= 0) {
      var data = params.updatedSeries[idx].getData();
      to.push({
        dataGroupId: globalStore.oldDataGroupIds[idx],
        data,
        divide: getDivideShapeFromData(data),
        groupIdDim: finder.dimension
      });
    }
  });
  if (from.length > 0 && to.length > 0) {
    transitionBetween(from, to, api);
  }
}
function installUniversalTransition(registers) {
  registers.registerUpdateLifecycle("series:beforeupdate", function(ecMOdel, api, params) {
    each(normalizeToArray(params.seriesTransition), function(transOpt) {
      each(normalizeToArray(transOpt.to), function(finder) {
        var series = params.updatedSeries;
        for (var i = 0; i < series.length; i++) {
          if (finder.seriesIndex != null && finder.seriesIndex === series[i].seriesIndex || finder.seriesId != null && finder.seriesId === series[i].id) {
            series[i][SERIES_UNIVERSAL_TRANSITION_PROP] = true;
          }
        }
      });
    });
  });
  registers.registerUpdateLifecycle("series:transition", function(ecModel, api, params) {
    var globalStore = getUniversalTransitionGlobalStore(api);
    if (globalStore.oldSeries && params.updatedSeries && params.optionChanged) {
      var transitionOpt = params.seriesTransition;
      if (transitionOpt) {
        each(normalizeToArray(transitionOpt), function(opt) {
          transitionSeriesFromOpt(opt, globalStore, params, api);
        });
      } else {
        var updateBatches_1 = findTransitionSeriesBatches(globalStore, params);
        each(updateBatches_1.keys(), function(key2) {
          var batch = updateBatches_1.get(key2);
          transitionBetween(batch.oldSeries, batch.newSeries, api);
        });
      }
      each(params.updatedSeries, function(series) {
        if (series[SERIES_UNIVERSAL_TRANSITION_PROP]) {
          series[SERIES_UNIVERSAL_TRANSITION_PROP] = false;
        }
      });
    }
    var allSeries = ecModel.getSeries();
    var savedSeries = globalStore.oldSeries = [];
    var savedDataGroupIds = globalStore.oldDataGroupIds = [];
    var savedData = globalStore.oldData = [];
    for (var i = 0; i < allSeries.length; i++) {
      var data = allSeries[i].getData();
      if (data.count() < DATA_COUNT_THRESHOLD) {
        savedSeries.push(allSeries[i]);
        savedDataGroupIds.push(allSeries[i].get("dataGroupId"));
        savedData.push(data);
      }
    }
  });
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/label/labelGuideHelper.js
var PI27 = Math.PI * 2;
var CMD5 = PathProxy_default.CMD;
var DEFAULT_SEARCH_SPACE = ["top", "right", "bottom", "left"];
function getCandidateAnchor(pos, distance2, rect, outPt, outDir) {
  var width = rect.width;
  var height = rect.height;
  switch (pos) {
    case "top":
      outPt.set(rect.x + width / 2, rect.y - distance2);
      outDir.set(0, -1);
      break;
    case "bottom":
      outPt.set(rect.x + width / 2, rect.y + height + distance2);
      outDir.set(0, 1);
      break;
    case "left":
      outPt.set(rect.x - distance2, rect.y + height / 2);
      outDir.set(-1, 0);
      break;
    case "right":
      outPt.set(rect.x + width + distance2, rect.y + height / 2);
      outDir.set(1, 0);
      break;
  }
}
function projectPointToArc(cx, cy, r, startAngle, endAngle, anticlockwise, x, y, out2) {
  x -= cx;
  y -= cy;
  var d = Math.sqrt(x * x + y * y);
  x /= d;
  y /= d;
  var ox = x * r + cx;
  var oy = y * r + cy;
  if (Math.abs(startAngle - endAngle) % PI27 < 1e-4) {
    out2[0] = ox;
    out2[1] = oy;
    return d - r;
  }
  if (anticlockwise) {
    var tmp = startAngle;
    startAngle = normalizeRadian(endAngle);
    endAngle = normalizeRadian(tmp);
  } else {
    startAngle = normalizeRadian(startAngle);
    endAngle = normalizeRadian(endAngle);
  }
  if (startAngle > endAngle) {
    endAngle += PI27;
  }
  var angle = Math.atan2(y, x);
  if (angle < 0) {
    angle += PI27;
  }
  if (angle >= startAngle && angle <= endAngle || angle + PI27 >= startAngle && angle + PI27 <= endAngle) {
    out2[0] = ox;
    out2[1] = oy;
    return d - r;
  }
  var x1 = r * Math.cos(startAngle) + cx;
  var y1 = r * Math.sin(startAngle) + cy;
  var x2 = r * Math.cos(endAngle) + cx;
  var y2 = r * Math.sin(endAngle) + cy;
  var d1 = (x1 - x) * (x1 - x) + (y1 - y) * (y1 - y);
  var d2 = (x2 - x) * (x2 - x) + (y2 - y) * (y2 - y);
  if (d1 < d2) {
    out2[0] = x1;
    out2[1] = y1;
    return Math.sqrt(d1);
  } else {
    out2[0] = x2;
    out2[1] = y2;
    return Math.sqrt(d2);
  }
}
function projectPointToLine(x1, y1, x2, y2, x, y, out2, limitToEnds) {
  var dx = x - x1;
  var dy = y - y1;
  var dx1 = x2 - x1;
  var dy1 = y2 - y1;
  var lineLen = Math.sqrt(dx1 * dx1 + dy1 * dy1);
  dx1 /= lineLen;
  dy1 /= lineLen;
  var projectedLen = dx * dx1 + dy * dy1;
  var t = projectedLen / lineLen;
  if (limitToEnds) {
    t = Math.min(Math.max(t, 0), 1);
  }
  t *= lineLen;
  var ox = out2[0] = x1 + t * dx1;
  var oy = out2[1] = y1 + t * dy1;
  return Math.sqrt((ox - x) * (ox - x) + (oy - y) * (oy - y));
}
function projectPointToRect(x1, y1, width, height, x, y, out2) {
  if (width < 0) {
    x1 = x1 + width;
    width = -width;
  }
  if (height < 0) {
    y1 = y1 + height;
    height = -height;
  }
  var x2 = x1 + width;
  var y2 = y1 + height;
  var ox = out2[0] = Math.min(Math.max(x, x1), x2);
  var oy = out2[1] = Math.min(Math.max(y, y1), y2);
  return Math.sqrt((ox - x) * (ox - x) + (oy - y) * (oy - y));
}
var tmpPt = [];
function nearestPointOnRect(pt, rect, out2) {
  var dist2 = projectPointToRect(rect.x, rect.y, rect.width, rect.height, pt.x, pt.y, tmpPt);
  out2.set(tmpPt[0], tmpPt[1]);
  return dist2;
}
function nearestPointOnPath(pt, path, out2) {
  var xi = 0;
  var yi = 0;
  var x0 = 0;
  var y0 = 0;
  var x1;
  var y1;
  var minDist = Infinity;
  var data = path.data;
  var x = pt.x;
  var y = pt.y;
  for (var i = 0; i < data.length; ) {
    var cmd = data[i++];
    if (i === 1) {
      xi = data[i];
      yi = data[i + 1];
      x0 = xi;
      y0 = yi;
    }
    var d = minDist;
    switch (cmd) {
      case CMD5.M:
        x0 = data[i++];
        y0 = data[i++];
        xi = x0;
        yi = y0;
        break;
      case CMD5.L:
        d = projectPointToLine(xi, yi, data[i], data[i + 1], x, y, tmpPt, true);
        xi = data[i++];
        yi = data[i++];
        break;
      case CMD5.C:
        d = cubicProjectPoint(xi, yi, data[i++], data[i++], data[i++], data[i++], data[i], data[i + 1], x, y, tmpPt);
        xi = data[i++];
        yi = data[i++];
        break;
      case CMD5.Q:
        d = quadraticProjectPoint(xi, yi, data[i++], data[i++], data[i], data[i + 1], x, y, tmpPt);
        xi = data[i++];
        yi = data[i++];
        break;
      case CMD5.A:
        var cx = data[i++];
        var cy = data[i++];
        var rx = data[i++];
        var ry = data[i++];
        var theta = data[i++];
        var dTheta = data[i++];
        i += 1;
        var anticlockwise = !!(1 - data[i++]);
        x1 = Math.cos(theta) * rx + cx;
        y1 = Math.sin(theta) * ry + cy;
        if (i <= 1) {
          x0 = x1;
          y0 = y1;
        }
        var _x = (x - cx) * ry / rx + cx;
        d = projectPointToArc(cx, cy, ry, theta, theta + dTheta, anticlockwise, _x, y, tmpPt);
        xi = Math.cos(theta + dTheta) * rx + cx;
        yi = Math.sin(theta + dTheta) * ry + cy;
        break;
      case CMD5.R:
        x0 = xi = data[i++];
        y0 = yi = data[i++];
        var width = data[i++];
        var height = data[i++];
        d = projectPointToRect(x0, y0, width, height, x, y, tmpPt);
        break;
      case CMD5.Z:
        d = projectPointToLine(xi, yi, x0, y0, x, y, tmpPt, true);
        xi = x0;
        yi = y0;
        break;
    }
    if (d < minDist) {
      minDist = d;
      out2.set(tmpPt[0], tmpPt[1]);
    }
  }
  return minDist;
}
var pt0 = new Point_default();
var pt1 = new Point_default();
var pt2 = new Point_default();
var dir = new Point_default();
var dir2 = new Point_default();
function updateLabelLinePoints(target, labelLineModel) {
  if (!target) {
    return;
  }
  var labelLine = target.getTextGuideLine();
  var label = target.getTextContent();
  if (!(label && labelLine)) {
    return;
  }
  var labelGuideConfig = target.textGuideLineConfig || {};
  var points2 = [[0, 0], [0, 0], [0, 0]];
  var searchSpace = labelGuideConfig.candidates || DEFAULT_SEARCH_SPACE;
  var labelRect = label.getBoundingRect().clone();
  labelRect.applyTransform(label.getComputedTransform());
  var minDist = Infinity;
  var anchorPoint = labelGuideConfig.anchor;
  var targetTransform = target.getComputedTransform();
  var targetInversedTransform = targetTransform && invert([], targetTransform);
  var len2 = labelLineModel.get("length2") || 0;
  if (anchorPoint) {
    pt2.copy(anchorPoint);
  }
  for (var i = 0; i < searchSpace.length; i++) {
    var candidate = searchSpace[i];
    getCandidateAnchor(candidate, 0, labelRect, pt0, dir);
    Point_default.scaleAndAdd(pt1, pt0, dir, len2);
    pt1.transform(targetInversedTransform);
    var boundingRect = target.getBoundingRect();
    var dist2 = anchorPoint ? anchorPoint.distance(pt1) : target instanceof Path_default ? nearestPointOnPath(pt1, target.path, pt2) : nearestPointOnRect(pt1, boundingRect, pt2);
    if (dist2 < minDist) {
      minDist = dist2;
      pt1.transform(targetTransform);
      pt2.transform(targetTransform);
      pt2.toArray(points2[0]);
      pt1.toArray(points2[1]);
      pt0.toArray(points2[2]);
    }
  }
  limitTurnAngle(points2, labelLineModel.get("minTurnAngle"));
  labelLine.setShape({
    points: points2
  });
}
var tmpArr = [];
var tmpProjPoint = new Point_default();
function limitTurnAngle(linePoints, minTurnAngle) {
  if (!(minTurnAngle <= 180 && minTurnAngle > 0)) {
    return;
  }
  minTurnAngle = minTurnAngle / 180 * Math.PI;
  pt0.fromArray(linePoints[0]);
  pt1.fromArray(linePoints[1]);
  pt2.fromArray(linePoints[2]);
  Point_default.sub(dir, pt0, pt1);
  Point_default.sub(dir2, pt2, pt1);
  var len1 = dir.len();
  var len2 = dir2.len();
  if (len1 < 1e-3 || len2 < 1e-3) {
    return;
  }
  dir.scale(1 / len1);
  dir2.scale(1 / len2);
  var angleCos = dir.dot(dir2);
  var minTurnAngleCos = Math.cos(minTurnAngle);
  if (minTurnAngleCos < angleCos) {
    var d = projectPointToLine(pt1.x, pt1.y, pt2.x, pt2.y, pt0.x, pt0.y, tmpArr, false);
    tmpProjPoint.fromArray(tmpArr);
    tmpProjPoint.scaleAndAdd(dir2, d / Math.tan(Math.PI - minTurnAngle));
    var t = pt2.x !== pt1.x ? (tmpProjPoint.x - pt1.x) / (pt2.x - pt1.x) : (tmpProjPoint.y - pt1.y) / (pt2.y - pt1.y);
    if (isNaN(t)) {
      return;
    }
    if (t < 0) {
      Point_default.copy(tmpProjPoint, pt1);
    } else if (t > 1) {
      Point_default.copy(tmpProjPoint, pt2);
    }
    tmpProjPoint.toArray(linePoints[1]);
  }
}
function setLabelLineState(labelLine, ignore, stateName, stateModel) {
  var isNormal = stateName === "normal";
  var stateObj = isNormal ? labelLine : labelLine.ensureState(stateName);
  stateObj.ignore = ignore;
  var smooth = stateModel.get("smooth");
  smooth = smooth === true ? 0.3 : Math.max(+smooth, 0) || 0;
  stateObj.shape = stateObj.shape || {};
  stateObj.shape.smooth = smooth;
  var styleObj = stateModel.getModel("lineStyle").getLineStyle();
  isNormal ? labelLine.useStyle(styleObj) : stateObj.style = styleObj;
}
function buildLabelLinePath(path, shape) {
  var smooth = shape.smooth;
  var points2 = shape.points;
  if (!points2) {
    return;
  }
  path.moveTo(points2[0][0], points2[0][1]);
  if (smooth > 0 && points2.length >= 3) {
    var len1 = dist(points2[0], points2[1]);
    var len2 = dist(points2[1], points2[2]);
    if (!len1 || !len2) {
      path.lineTo(points2[1][0], points2[1][1]);
      path.lineTo(points2[2][0], points2[2][1]);
      return;
    }
    var moveLen = Math.min(len1, len2) * smooth;
    var midPoint0 = lerp([], points2[1], points2[0], moveLen / len1);
    var midPoint2 = lerp([], points2[1], points2[2], moveLen / len2);
    var midPoint1 = lerp([], midPoint0, midPoint2, 0.5);
    path.bezierCurveTo(midPoint0[0], midPoint0[1], midPoint0[0], midPoint0[1], midPoint1[0], midPoint1[1]);
    path.bezierCurveTo(midPoint2[0], midPoint2[1], midPoint2[0], midPoint2[1], points2[2][0], points2[2][1]);
  } else {
    for (var i = 1; i < points2.length; i++) {
      path.lineTo(points2[i][0], points2[i][1]);
    }
  }
}
function setLabelLineStyle(targetEl, statesModels, defaultStyle) {
  var labelLine = targetEl.getTextGuideLine();
  var label = targetEl.getTextContent();
  if (!label) {
    if (labelLine) {
      targetEl.removeTextGuideLine();
    }
    return;
  }
  var normalModel = statesModels.normal;
  var showNormal = normalModel.get("show");
  var labelIgnoreNormal = label.ignore;
  for (var i = 0; i < DISPLAY_STATES.length; i++) {
    var stateName = DISPLAY_STATES[i];
    var stateModel = statesModels[stateName];
    var isNormal = stateName === "normal";
    if (stateModel) {
      var stateShow = stateModel.get("show");
      var isLabelIgnored = isNormal ? labelIgnoreNormal : retrieve2(label.states[stateName] && label.states[stateName].ignore, labelIgnoreNormal);
      if (isLabelIgnored || !retrieve2(stateShow, showNormal)) {
        var stateObj = isNormal ? labelLine : labelLine && labelLine.states[stateName];
        if (stateObj) {
          stateObj.ignore = true;
        }
        if (!!labelLine) {
          setLabelLineState(labelLine, true, stateName, stateModel);
        }
        continue;
      }
      if (!labelLine) {
        labelLine = new Polyline_default();
        targetEl.setTextGuideLine(labelLine);
        if (!isNormal && (labelIgnoreNormal || !showNormal)) {
          setLabelLineState(labelLine, true, "normal", statesModels.normal);
        }
        if (targetEl.stateProxy) {
          labelLine.stateProxy = targetEl.stateProxy;
        }
      }
      setLabelLineState(labelLine, false, stateName, stateModel);
    }
  }
  if (labelLine) {
    defaults(labelLine.style, defaultStyle);
    labelLine.style.fill = null;
    var showAbove = normalModel.get("showAbove");
    var labelLineConfig = targetEl.textGuideLineConfig = targetEl.textGuideLineConfig || {};
    labelLineConfig.showAbove = showAbove || false;
    labelLine.buildPath = buildLabelLinePath;
  }
}
function getLabelLineStatesModels(itemModel, labelLineName) {
  labelLineName = labelLineName || "labelLine";
  var statesModels = {
    normal: itemModel.getModel(labelLineName)
  };
  for (var i = 0; i < SPECIAL_STATES.length; i++) {
    var stateName = SPECIAL_STATES[i];
    statesModels[stateName] = itemModel.getModel([stateName, labelLineName]);
  }
  return statesModels;
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/label/labelLayoutHelper.js
var LABEL_LAYOUT_BASE_PROPS = ["label", "labelLine", "layoutOption", "priority", "defaultAttr", "marginForce", "minMarginForce", "marginDefault", "suggestIgnore"];
var LABEL_LAYOUT_DIRTY_BIT_OTHERS = 1;
var LABEL_LAYOUT_DIRTY_BIT_OBB = 2;
var LABEL_LAYOUT_DIRTY_ALL = LABEL_LAYOUT_DIRTY_BIT_OTHERS | LABEL_LAYOUT_DIRTY_BIT_OBB;
function setLabelLayoutDirty(labelGeometry, dirtyOrClear, dirtyBits) {
  dirtyBits = dirtyBits || LABEL_LAYOUT_DIRTY_ALL;
  dirtyOrClear ? labelGeometry.dirty |= dirtyBits : labelGeometry.dirty &= ~dirtyBits;
}
function isLabelLayoutDirty(labelGeometry, dirtyBits) {
  dirtyBits = dirtyBits || LABEL_LAYOUT_DIRTY_ALL;
  return labelGeometry.dirty == null || !!(labelGeometry.dirty & dirtyBits);
}
function ensureLabelLayoutWithGeometry(labelLayout) {
  if (!labelLayout) {
    return;
  }
  if (isLabelLayoutDirty(labelLayout)) {
    computeLabelGeometry(labelLayout, labelLayout.label, labelLayout);
  }
  return labelLayout;
}
function computeLabelGeometry(out2, label, opt) {
  var rawTransform = label.getComputedTransform();
  out2.transform = ensureCopyTransform(out2.transform, rawTransform);
  var outLocalRect = out2.localRect = ensureCopyRect(out2.localRect, label.getBoundingRect());
  var labelStyleExt = label.style;
  var margin = labelStyleExt.margin;
  var marginForce = opt && opt.marginForce;
  var minMarginForce = opt && opt.minMarginForce;
  var marginDefault = opt && opt.marginDefault;
  var marginType = labelStyleExt.__marginType;
  if (marginType == null && marginDefault) {
    margin = marginDefault;
    marginType = LabelMarginType.textMargin;
  }
  for (var i = 0; i < 4; i++) {
    _tmpLabelMargin[i] = marginType === LabelMarginType.minMargin && minMarginForce && minMarginForce[i] != null ? minMarginForce[i] : marginForce && marginForce[i] != null ? marginForce[i] : margin ? margin[i] : 0;
  }
  if (marginType === LabelMarginType.textMargin) {
    expandOrShrinkRect(outLocalRect, _tmpLabelMargin, false, false);
  }
  var outGlobalRect = out2.rect = ensureCopyRect(out2.rect, outLocalRect);
  if (rawTransform) {
    outGlobalRect.applyTransform(rawTransform);
  }
  if (marginType === LabelMarginType.minMargin) {
    expandOrShrinkRect(outGlobalRect, _tmpLabelMargin, false, false);
  }
  out2.axisAligned = isBoundingRectAxisAligned(rawTransform);
  (out2.label = out2.label || {}).ignore = label.ignore;
  setLabelLayoutDirty(out2, false);
  setLabelLayoutDirty(out2, true, LABEL_LAYOUT_DIRTY_BIT_OBB);
  return out2;
}
var _tmpLabelMargin = [0, 0, 0, 0];
function computeLabelGeometry2(out2, rawLocalRect, rawTransform) {
  out2.transform = ensureCopyTransform(out2.transform, rawTransform);
  out2.localRect = ensureCopyRect(out2.localRect, rawLocalRect);
  out2.rect = ensureCopyRect(out2.rect, rawLocalRect);
  if (rawTransform) {
    out2.rect.applyTransform(rawTransform);
  }
  out2.axisAligned = isBoundingRectAxisAligned(rawTransform);
  out2.obb = void 0;
  (out2.label = out2.label || {}).ignore = false;
  return out2;
}
function labelLayoutApplyTranslation(labelLayout, offset) {
  if (!labelLayout) {
    return;
  }
  labelLayout.label.x += offset.x;
  labelLayout.label.y += offset.y;
  labelLayout.label.markRedraw();
  var transform = labelLayout.transform;
  if (transform) {
    transform[4] += offset.x;
    transform[5] += offset.y;
  }
  var globalRect = labelLayout.rect;
  if (globalRect) {
    globalRect.x += offset.x;
    globalRect.y += offset.y;
  }
  var obb = labelLayout.obb;
  if (obb) {
    obb.fromBoundingRect(labelLayout.localRect, transform);
  }
}
function newLabelLayoutWithGeometry(newBaseWithDefaults, source) {
  for (var i = 0; i < LABEL_LAYOUT_BASE_PROPS.length; i++) {
    var prop = LABEL_LAYOUT_BASE_PROPS[i];
    if (newBaseWithDefaults[prop] == null) {
      newBaseWithDefaults[prop] = source[prop];
    }
  }
  return ensureLabelLayoutWithGeometry(newBaseWithDefaults);
}
function ensureOBB(labelGeometry) {
  var obb = labelGeometry.obb;
  if (!obb || isLabelLayoutDirty(labelGeometry, LABEL_LAYOUT_DIRTY_BIT_OBB)) {
    labelGeometry.obb = obb = obb || new OrientedBoundingRect_default();
    obb.fromBoundingRect(labelGeometry.localRect, labelGeometry.transform);
    setLabelLayoutDirty(labelGeometry, false, LABEL_LAYOUT_DIRTY_BIT_OBB);
  }
  return obb;
}
function shiftLayoutOnXY(list, xyDimIdx, minBound, maxBound, balanceShift) {
  var len2 = list.length;
  var xyDim = XY2[xyDimIdx];
  var sizeDim = WH2[xyDimIdx];
  if (len2 < 2) {
    return false;
  }
  list.sort(function(a, b) {
    return a.rect[xyDim] - b.rect[xyDim];
  });
  var lastPos = 0;
  var delta;
  var adjusted = false;
  var totalShifts = 0;
  for (var i = 0; i < len2; i++) {
    var item = list[i];
    var rect = item.rect;
    delta = rect[xyDim] - lastPos;
    if (delta < 0) {
      rect[xyDim] -= delta;
      item.label[xyDim] -= delta;
      adjusted = true;
    }
    var shift = Math.max(-delta, 0);
    totalShifts += shift;
    lastPos = rect[xyDim] + rect[sizeDim];
  }
  if (totalShifts > 0 && balanceShift) {
    shiftList(-totalShifts / len2, 0, len2);
  }
  var first = list[0];
  var last = list[len2 - 1];
  var minGap;
  var maxGap;
  updateMinMaxGap();
  minGap < 0 && squeezeGaps(-minGap, 0.8);
  maxGap < 0 && squeezeGaps(maxGap, 0.8);
  updateMinMaxGap();
  takeBoundsGap(minGap, maxGap, 1);
  takeBoundsGap(maxGap, minGap, -1);
  updateMinMaxGap();
  if (minGap < 0) {
    squeezeWhenBailout(-minGap);
  }
  if (maxGap < 0) {
    squeezeWhenBailout(maxGap);
  }
  function updateMinMaxGap() {
    minGap = first.rect[xyDim] - minBound;
    maxGap = maxBound - last.rect[xyDim] - last.rect[sizeDim];
  }
  function takeBoundsGap(gapThisBound, gapOtherBound, moveDir) {
    if (gapThisBound < 0) {
      var moveFromMaxGap = Math.min(gapOtherBound, -gapThisBound);
      if (moveFromMaxGap > 0) {
        shiftList(moveFromMaxGap * moveDir, 0, len2);
        var remained = moveFromMaxGap + gapThisBound;
        if (remained < 0) {
          squeezeGaps(-remained * moveDir, 1);
        }
      } else {
        squeezeGaps(-gapThisBound * moveDir, 1);
      }
    }
  }
  function shiftList(delta2, start2, end2) {
    if (delta2 !== 0) {
      adjusted = true;
    }
    for (var i2 = start2; i2 < end2; i2++) {
      var item2 = list[i2];
      var rect2 = item2.rect;
      rect2[xyDim] += delta2;
      item2.label[xyDim] += delta2;
    }
  }
  function squeezeGaps(delta2, maxSqeezePercent) {
    var gaps = [];
    var totalGaps = 0;
    for (var i2 = 1; i2 < len2; i2++) {
      var prevItemRect = list[i2 - 1].rect;
      var gap = Math.max(list[i2].rect[xyDim] - prevItemRect[xyDim] - prevItemRect[sizeDim], 0);
      gaps.push(gap);
      totalGaps += gap;
    }
    if (!totalGaps) {
      return;
    }
    var squeezePercent = Math.min(Math.abs(delta2) / totalGaps, maxSqeezePercent);
    if (delta2 > 0) {
      for (var i2 = 0; i2 < len2 - 1; i2++) {
        var movement = gaps[i2] * squeezePercent;
        shiftList(movement, 0, i2 + 1);
      }
    } else {
      for (var i2 = len2 - 1; i2 > 0; i2--) {
        var movement = gaps[i2 - 1] * squeezePercent;
        shiftList(-movement, i2, len2);
      }
    }
  }
  function squeezeWhenBailout(delta2) {
    var dir3 = delta2 < 0 ? -1 : 1;
    delta2 = Math.abs(delta2);
    var moveForEachLabel = Math.ceil(delta2 / (len2 - 1));
    for (var i2 = 0; i2 < len2 - 1; i2++) {
      if (dir3 > 0) {
        shiftList(moveForEachLabel, 0, i2 + 1);
      } else {
        shiftList(-moveForEachLabel, len2 - i2 - 1, len2);
      }
      delta2 -= moveForEachLabel;
      if (delta2 <= 0) {
        return;
      }
    }
  }
  return adjusted;
}
function restoreIgnore(labelList) {
  for (var i = 0; i < labelList.length; i++) {
    var labelItem = labelList[i];
    var defaultAttr = labelItem.defaultAttr;
    var labelLine = labelItem.labelLine;
    labelItem.label.attr("ignore", defaultAttr.ignore);
    labelLine && labelLine.attr("ignore", defaultAttr.labelGuideIgnore);
  }
}
function hideOverlap(labelList) {
  var displayedLabels = [];
  labelList.sort(function(a, b) {
    return (b.suggestIgnore ? 1 : 0) - (a.suggestIgnore ? 1 : 0) || b.priority - a.priority;
  });
  function hideEl(el) {
    if (!el.ignore) {
      var emphasisState = el.ensureState("emphasis");
      if (emphasisState.ignore == null) {
        emphasisState.ignore = false;
      }
    }
    el.ignore = true;
  }
  for (var i = 0; i < labelList.length; i++) {
    var labelItem = ensureLabelLayoutWithGeometry(labelList[i]);
    if (labelItem.label.ignore) {
      continue;
    }
    var label = labelItem.label;
    var labelLine = labelItem.labelLine;
    var overlapped = false;
    for (var j = 0; j < displayedLabels.length; j++) {
      if (labelIntersect(labelItem, displayedLabels[j], null, {
        touchThreshold: 0.05
      })) {
        overlapped = true;
        break;
      }
    }
    if (overlapped) {
      hideEl(label);
      labelLine && hideEl(labelLine);
    } else {
      displayedLabels.push(labelItem);
    }
  }
}
function labelIntersect(baseLayoutInfo, targetLayoutInfo, mtv, intersectOpt) {
  if (!baseLayoutInfo || !targetLayoutInfo) {
    return false;
  }
  if (baseLayoutInfo.label && baseLayoutInfo.label.ignore || targetLayoutInfo.label && targetLayoutInfo.label.ignore) {
    return false;
  }
  if (!baseLayoutInfo.rect.intersect(targetLayoutInfo.rect, mtv, intersectOpt)) {
    return false;
  }
  if (baseLayoutInfo.axisAligned && targetLayoutInfo.axisAligned) {
    return true;
  }
  return ensureOBB(baseLayoutInfo).intersect(ensureOBB(targetLayoutInfo), mtv, intersectOpt);
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/label/LabelManager.js
function cloneArr(points2) {
  if (points2) {
    var newPoints = [];
    for (var i = 0; i < points2.length; i++) {
      newPoints.push(points2[i].slice());
    }
    return newPoints;
  }
}
function prepareLayoutCallbackParams(labelItem, hostEl) {
  var label = labelItem.label;
  var labelLine = hostEl && hostEl.getTextGuideLine();
  return {
    dataIndex: labelItem.dataIndex,
    dataType: labelItem.dataType,
    seriesIndex: labelItem.seriesModel.seriesIndex,
    text: labelItem.label.style.text,
    rect: labelItem.hostRect,
    labelRect: labelItem.rect,
    // x: labelAttr.x,
    // y: labelAttr.y,
    align: label.style.align,
    verticalAlign: label.style.verticalAlign,
    labelLinePoints: cloneArr(labelLine && labelLine.shape.points)
  };
}
var LABEL_OPTION_TO_STYLE_KEYS = ["align", "verticalAlign", "width", "height", "fontSize"];
var dummyTransformable = new Transformable_default();
var labelLayoutInnerStore = makeInner();
var labelLineAnimationStore = makeInner();
function extendWithKeys(target, source, keys2) {
  for (var i = 0; i < keys2.length; i++) {
    var key2 = keys2[i];
    if (source[key2] != null) {
      target[key2] = source[key2];
    }
  }
}
var LABEL_LAYOUT_PROPS = ["x", "y", "rotation"];
var LabelManager = (
  /** @class */
  (function() {
    function LabelManager2() {
      this._labelList = [];
      this._chartViewList = [];
    }
    LabelManager2.prototype.clearLabels = function() {
      this._labelList = [];
      this._chartViewList = [];
    };
    LabelManager2.prototype._addLabel = function(dataIndex, dataType, seriesModel, label, layoutOptionOrCb) {
      var labelStyle = label.style;
      var hostEl = label.__hostTarget;
      var textConfig = hostEl.textConfig || {};
      var labelTransform = label.getComputedTransform();
      var labelRect = label.getBoundingRect().plain();
      BoundingRect_default.applyTransform(labelRect, labelRect, labelTransform);
      if (labelTransform) {
        dummyTransformable.setLocalTransform(labelTransform);
      } else {
        dummyTransformable.x = dummyTransformable.y = dummyTransformable.rotation = dummyTransformable.originX = dummyTransformable.originY = 0;
        dummyTransformable.scaleX = dummyTransformable.scaleY = 1;
      }
      dummyTransformable.rotation = normalizeRadian(dummyTransformable.rotation);
      var host = label.__hostTarget;
      var hostRect;
      if (host) {
        hostRect = host.getBoundingRect().plain();
        var transform = host.getComputedTransform();
        BoundingRect_default.applyTransform(hostRect, hostRect, transform);
      }
      var labelGuide = hostRect && host.getTextGuideLine();
      this._labelList.push({
        label,
        labelLine: labelGuide,
        seriesModel,
        dataIndex,
        dataType,
        layoutOptionOrCb,
        layoutOption: null,
        rect: labelRect,
        hostRect,
        // Label with lower priority will be hidden when overlapped
        // Use rect size as default priority
        priority: hostRect ? hostRect.width * hostRect.height : 0,
        // Save default label attributes.
        // For restore if developers want get back to default value in callback.
        defaultAttr: {
          ignore: label.ignore,
          labelGuideIgnore: labelGuide && labelGuide.ignore,
          x: dummyTransformable.x,
          y: dummyTransformable.y,
          scaleX: dummyTransformable.scaleX,
          scaleY: dummyTransformable.scaleY,
          rotation: dummyTransformable.rotation,
          style: {
            x: labelStyle.x,
            y: labelStyle.y,
            align: labelStyle.align,
            verticalAlign: labelStyle.verticalAlign,
            width: labelStyle.width,
            height: labelStyle.height,
            fontSize: labelStyle.fontSize
          },
          cursor: label.cursor,
          attachedPos: textConfig.position,
          attachedRot: textConfig.rotation
        }
      });
    };
    LabelManager2.prototype.addLabelsOfSeries = function(chartView) {
      var _this = this;
      this._chartViewList.push(chartView);
      var seriesModel = chartView.__model;
      var layoutOption = seriesModel.get("labelLayout");
      if (!(isFunction(layoutOption) || keys(layoutOption).length)) {
        return;
      }
      chartView.group.traverse(function(child) {
        if (child.ignore) {
          return true;
        }
        var textEl = child.getTextContent();
        var ecData = getECData(child);
        if (textEl && !textEl.disableLabelLayout) {
          _this._addLabel(ecData.dataIndex, ecData.dataType, seriesModel, textEl, layoutOption);
        }
      });
    };
    LabelManager2.prototype.updateLayoutConfig = function(api) {
      var width = api.getWidth();
      var height = api.getHeight();
      function createDragHandler(el, labelLineModel) {
        return function() {
          updateLabelLinePoints(el, labelLineModel);
        };
      }
      for (var i = 0; i < this._labelList.length; i++) {
        var labelItem = this._labelList[i];
        var label = labelItem.label;
        var hostEl = label.__hostTarget;
        var defaultLabelAttr = labelItem.defaultAttr;
        var layoutOption = void 0;
        if (isFunction(labelItem.layoutOptionOrCb)) {
          layoutOption = labelItem.layoutOptionOrCb(prepareLayoutCallbackParams(labelItem, hostEl));
        } else {
          layoutOption = labelItem.layoutOptionOrCb;
        }
        layoutOption = layoutOption || {};
        labelItem.layoutOption = layoutOption;
        var degreeToRadian = Math.PI / 180;
        if (hostEl) {
          hostEl.setTextConfig({
            // Force to set local false.
            local: false,
            // Ignore position and rotation config on the host el if x or y is changed.
            position: layoutOption.x != null || layoutOption.y != null ? null : defaultLabelAttr.attachedPos,
            // Ignore rotation config on the host el if rotation is changed.
            rotation: layoutOption.rotate != null ? layoutOption.rotate * degreeToRadian : defaultLabelAttr.attachedRot,
            offset: [layoutOption.dx || 0, layoutOption.dy || 0]
          });
        }
        var needsUpdateLabelLine = false;
        if (layoutOption.x != null) {
          label.x = parsePercent(layoutOption.x, width);
          label.setStyle("x", 0);
          needsUpdateLabelLine = true;
        } else {
          label.x = defaultLabelAttr.x;
          label.setStyle("x", defaultLabelAttr.style.x);
        }
        if (layoutOption.y != null) {
          label.y = parsePercent(layoutOption.y, height);
          label.setStyle("y", 0);
          needsUpdateLabelLine = true;
        } else {
          label.y = defaultLabelAttr.y;
          label.setStyle("y", defaultLabelAttr.style.y);
        }
        if (layoutOption.labelLinePoints) {
          var guideLine = hostEl.getTextGuideLine();
          if (guideLine) {
            guideLine.setShape({
              points: layoutOption.labelLinePoints
            });
            needsUpdateLabelLine = false;
          }
        }
        var labelLayoutStore = labelLayoutInnerStore(label);
        labelLayoutStore.needsUpdateLabelLine = needsUpdateLabelLine;
        label.rotation = layoutOption.rotate != null ? layoutOption.rotate * degreeToRadian : defaultLabelAttr.rotation;
        label.scaleX = defaultLabelAttr.scaleX;
        label.scaleY = defaultLabelAttr.scaleY;
        for (var k = 0; k < LABEL_OPTION_TO_STYLE_KEYS.length; k++) {
          var key2 = LABEL_OPTION_TO_STYLE_KEYS[k];
          label.setStyle(key2, layoutOption[key2] != null ? layoutOption[key2] : defaultLabelAttr.style[key2]);
        }
        if (layoutOption.draggable) {
          label.draggable = true;
          label.cursor = "move";
          if (hostEl) {
            var hostModel = labelItem.seriesModel;
            if (labelItem.dataIndex != null) {
              var data = labelItem.seriesModel.getData(labelItem.dataType);
              hostModel = data.getItemModel(labelItem.dataIndex);
            }
            label.on("drag", createDragHandler(hostEl, hostModel.getModel("labelLine")));
          }
        } else {
          label.off("drag");
          label.cursor = defaultLabelAttr.cursor;
        }
      }
    };
    LabelManager2.prototype.layout = function(api) {
      var width = api.getWidth();
      var height = api.getHeight();
      var labelList = [];
      each(this._labelList, function(inputItem) {
        if (!inputItem.defaultAttr.ignore) {
          labelList.push(newLabelLayoutWithGeometry({}, inputItem));
        }
      });
      var labelsNeedsAdjustOnX = filter(labelList, function(item) {
        return item.layoutOption.moveOverlap === "shiftX";
      });
      var labelsNeedsAdjustOnY = filter(labelList, function(item) {
        return item.layoutOption.moveOverlap === "shiftY";
      });
      shiftLayoutOnXY(labelsNeedsAdjustOnX, 0, 0, width);
      shiftLayoutOnXY(labelsNeedsAdjustOnY, 1, 0, height);
      var labelsNeedsHideOverlap = filter(labelList, function(item) {
        return item.layoutOption.hideOverlap;
      });
      restoreIgnore(labelsNeedsHideOverlap);
      hideOverlap(labelsNeedsHideOverlap);
    };
    LabelManager2.prototype.processLabelsOverall = function() {
      var _this = this;
      each(this._chartViewList, function(chartView) {
        var seriesModel = chartView.__model;
        var ignoreLabelLineUpdate = chartView.ignoreLabelLineUpdate;
        var animationEnabled = seriesModel.isAnimationEnabled();
        chartView.group.traverse(function(child) {
          if (child.ignore && !child.forceLabelAnimation) {
            return true;
          }
          var needsUpdateLabelLine = !ignoreLabelLineUpdate;
          var label = child.getTextContent();
          if (!needsUpdateLabelLine && label) {
            needsUpdateLabelLine = labelLayoutInnerStore(label).needsUpdateLabelLine;
          }
          if (needsUpdateLabelLine) {
            _this._updateLabelLine(child, seriesModel);
          }
          if (animationEnabled) {
            _this._animateLabels(child, seriesModel);
          }
        });
      });
    };
    LabelManager2.prototype._updateLabelLine = function(el, seriesModel) {
      var textEl = el.getTextContent();
      var ecData = getECData(el);
      var dataIndex = ecData.dataIndex;
      if (textEl && dataIndex != null) {
        var data = seriesModel.getData(ecData.dataType);
        var itemModel = data.getItemModel(dataIndex);
        var defaultStyle = {};
        var visualStyle = data.getItemVisual(dataIndex, "style");
        if (visualStyle) {
          var visualType = data.getVisual("drawType");
          defaultStyle.stroke = visualStyle[visualType];
        }
        var labelLineModel = itemModel.getModel("labelLine");
        setLabelLineStyle(el, getLabelLineStatesModels(itemModel), defaultStyle);
        updateLabelLinePoints(el, labelLineModel);
      }
    };
    LabelManager2.prototype._animateLabels = function(el, seriesModel) {
      var textEl = el.getTextContent();
      var guideLine = el.getTextGuideLine();
      if (textEl && (el.forceLabelAnimation || !textEl.ignore && !textEl.invisible && !el.disableLabelAnimation && !isElementRemoved(el))) {
        var layoutStore = labelLayoutInnerStore(textEl);
        var oldLayout = layoutStore.oldLayout;
        var ecData = getECData(el);
        var dataIndex = ecData.dataIndex;
        var newProps = {
          x: textEl.x,
          y: textEl.y,
          rotation: textEl.rotation
        };
        var data = seriesModel.getData(ecData.dataType);
        if (!oldLayout) {
          textEl.attr(newProps);
          if (!labelInner(textEl).valueAnimation) {
            var oldOpacity = retrieve2(textEl.style.opacity, 1);
            textEl.style.opacity = 0;
            initProps(textEl, {
              style: {
                opacity: oldOpacity
              }
            }, seriesModel, dataIndex);
          }
        } else {
          textEl.attr(oldLayout);
          var prevStates = el.prevStates;
          if (prevStates) {
            if (indexOf(prevStates, "select") >= 0) {
              textEl.attr(layoutStore.oldLayoutSelect);
            }
            if (indexOf(prevStates, "emphasis") >= 0) {
              textEl.attr(layoutStore.oldLayoutEmphasis);
            }
          }
          updateProps(textEl, newProps, seriesModel, dataIndex);
        }
        layoutStore.oldLayout = newProps;
        if (textEl.states.select) {
          var layoutSelect = layoutStore.oldLayoutSelect = {};
          extendWithKeys(layoutSelect, newProps, LABEL_LAYOUT_PROPS);
          extendWithKeys(layoutSelect, textEl.states.select, LABEL_LAYOUT_PROPS);
        }
        if (textEl.states.emphasis) {
          var layoutEmphasis = layoutStore.oldLayoutEmphasis = {};
          extendWithKeys(layoutEmphasis, newProps, LABEL_LAYOUT_PROPS);
          extendWithKeys(layoutEmphasis, textEl.states.emphasis, LABEL_LAYOUT_PROPS);
        }
        animateLabelValue(textEl, dataIndex, data, seriesModel, seriesModel);
      }
      if (guideLine && !guideLine.ignore && !guideLine.invisible) {
        var layoutStore = labelLineAnimationStore(guideLine);
        var oldLayout = layoutStore.oldLayout;
        var newLayout = {
          points: guideLine.shape.points
        };
        if (!oldLayout) {
          guideLine.setShape(newLayout);
          guideLine.style.strokePercent = 0;
          initProps(guideLine, {
            style: {
              strokePercent: 1
            }
          }, seriesModel);
        } else {
          guideLine.attr({
            shape: oldLayout
          });
          updateProps(guideLine, {
            shape: newLayout
          }, seriesModel);
        }
        layoutStore.oldLayout = newLayout;
      }
    };
    return LabelManager2;
  })()
);
var LabelManager_default = LabelManager;

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/label/installLabelLayout.js
var getLabelManager = makeInner();
function installLabelLayout(registers) {
  registers.registerUpdateLifecycle("series:beforeupdate", function(ecModel, api, params) {
    var labelManager = getLabelManager(api).labelManager;
    if (!labelManager) {
      labelManager = getLabelManager(api).labelManager = new LabelManager_default();
    }
    labelManager.clearLabels();
  });
  registers.registerUpdateLifecycle("series:layoutlabels", function(ecModel, api, params) {
    var labelManager = getLabelManager(api).labelManager;
    each(params.updatedSeries, function(series) {
      labelManager.addLabelsOfSeries(api.getViewOfSeriesModel(series));
    });
    labelManager.updateLayoutConfig(api);
    labelManager.layout(api);
    labelManager.processLabelsOverall();
  });
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/scale/scaleMapper.js
var SCALE_EXTENT_KIND_EFFECTIVE = 0;
var SCALE_EXTENT_KIND_MAPPING = 1;
var SCALE_MAPPER_METHOD_NAMES_MAP = {
  needTransform: 1,
  normalize: 1,
  scale: 1,
  transformIn: 1,
  transformOut: 1,
  contain: 1,
  getExtent: 1,
  getExtentUnsafe: 1,
  setExtent: 1,
  setExtent2: 1,
  getFilter: 1,
  sanitize: 1,
  getDefaultStartValue: 1,
  freeze: 1
};
var SCALE_MAPPER_METHOD_NAMES = keys(SCALE_MAPPER_METHOD_NAMES_MAP);
var SCALE_MAPPER_DEPTH_OUT_OF_BREAK = 2;
var SCALE_MAPPER_DEPTH_INNERMOST = 3;
function initBreakOrLinearMapper(mapper, breakParsed, initialExtent) {
  var brk;
  mapper = mapper || {};
  var scaleBreakHelper = getScaleBreakHelper();
  if (scaleBreakHelper) {
    var brkMapper_1 = scaleBreakHelper.createBreakScaleMapper(breakParsed, initialExtent);
    if (brkMapper_1.hasBreaks()) {
      each(SCALE_MAPPER_METHOD_NAMES, function(methodName) {
        if (brkMapper_1[methodName]) {
          mapper[methodName] = bind(brkMapper_1[methodName], brkMapper_1);
        }
      });
      brk = brkMapper_1;
    }
  }
  if (brk == null) {
    initLinearScaleMapper(mapper, initialExtent);
  }
  return {
    brk,
    mapper
  };
}
function decorateScaleMapper(host, decoratedMapperMethods) {
  each(SCALE_MAPPER_METHOD_NAMES, function(methodName) {
    host[methodName] = decoratedMapperMethods[methodName];
  });
}
function enableScaleMapperFreeze(host, subMapper) {
  host.freeze = noop;
  if (false) {
    host.freeze = function() {
      subMapper.freeze();
    };
  }
  ;
}
function getScaleExtentForTickUnsafe(mapper) {
  return mapper.getExtentUnsafe(SCALE_EXTENT_KIND_EFFECTIVE, SCALE_MAPPER_DEPTH_OUT_OF_BREAK);
}
function getScaleExtentForMappingUnsafe(mapper, depth) {
  return mapper.getExtentUnsafe(SCALE_EXTENT_KIND_MAPPING, depth) || mapper.getExtentUnsafe(SCALE_EXTENT_KIND_EFFECTIVE, depth);
}
function getScaleLinearSpanForMapping(mapper) {
  var extent = getScaleExtentForMappingUnsafe(mapper, SCALE_MAPPER_DEPTH_INNERMOST);
  return extent[1] - extent[0];
}
function getScaleLinearSpanEffective(mapper) {
  var extent = mapper.getExtentUnsafe(SCALE_EXTENT_KIND_EFFECTIVE, SCALE_MAPPER_DEPTH_INNERMOST);
  return extent[1] - extent[0];
}
function initLinearScaleMapper(mapper, initialExtent) {
  var linearMapper = mapper || {};
  var extendList = [];
  linearMapper._extents = extendList;
  extendList[SCALE_EXTENT_KIND_EFFECTIVE] = initialExtent ? initialExtent.slice() : initExtentForUnion();
  extend(linearMapper, linearScaleMapperMethods);
  return linearMapper;
}
var linearScaleMapperMethods = {
  needTransform: function() {
    return false;
  },
  normalize: function(val) {
    var extent = this._extents[SCALE_EXTENT_KIND_MAPPING] || this._extents[SCALE_EXTENT_KIND_EFFECTIVE];
    if (extent[1] === extent[0]) {
      return 0.5;
    }
    return (val - extent[0]) / (extent[1] - extent[0]);
  },
  scale: function(val) {
    var extent = this._extents[SCALE_EXTENT_KIND_MAPPING] || this._extents[SCALE_EXTENT_KIND_EFFECTIVE];
    return val * (extent[1] - extent[0]) + extent[0];
  },
  transformIn: function(val) {
    return val;
  },
  transformOut: function(val) {
    return val;
  },
  contain: function(val) {
    var extent = getScaleExtentForMappingUnsafe(this, null);
    return val >= extent[0] && val <= extent[1];
  },
  getExtent: function() {
    return this._extents[SCALE_EXTENT_KIND_EFFECTIVE].slice();
  },
  getExtentUnsafe: function(kind) {
    return this._extents[kind];
  },
  setExtent: function(start2, end2) {
    if (false) {
      assert(!this._frozen);
    }
    writeExtent(this._extents, SCALE_EXTENT_KIND_EFFECTIVE, start2, end2);
  },
  setExtent2: function(kind, start2, end2) {
    if (false) {
      assert(!this._frozen);
    }
    var extentList = this._extents;
    if (!extentList[kind]) {
      extentList[kind] = extentList[SCALE_EXTENT_KIND_EFFECTIVE].slice();
    }
    writeExtent(extentList, kind, start2, end2);
  },
  freeze: function() {
    if (false) {
      this._frozen = true;
    }
  }
};
function writeExtent(extentList, kind, start2, end2) {
  if (isValidBoundsForExtent(start2, end2)) {
    extentList[kind][0] = start2;
    extentList[kind][1] = end2;
  } else {
    if (false) {
      if (start2 != null && end2 != null && start2 <= end2) {
        error("Invalid setExtent call - start: " + start2 + ", end: " + end2);
      }
    }
  }
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/scale/breakImpl.js
var BreakScaleMapperImpl = (
  /** @class */
  (function() {
    function BreakScaleMapperImpl2(breakParsed, initialExtent) {
      decorateScaleMapper(this, BreakScaleMapperImpl2.decoratedMethods);
      this._outOfBrk = initLinearScaleMapper(null, initialExtent);
      var mapper = this._linear = initLinearScaleMapper(null, initialExtent);
      enableScaleMapperFreeze(this, mapper);
      this.breaks = breakParsed && breakParsed.breaks || [];
    }
    BreakScaleMapperImpl2.prototype.hasBreaks = function() {
      return !!this.breaks.length;
    };
    BreakScaleMapperImpl2.prototype.calcNiceTickMultiple = function(tickVal, estimateNiceMultiple) {
      for (var idx = 0; idx < this.breaks.length; idx++) {
        var brk = this.breaks[idx];
        if (brk.vmin < tickVal && tickVal < brk.vmax) {
          var multiple = estimateNiceMultiple(tickVal, brk.vmax);
          if (false) {
            assert(multiple >= 0 && mathRound(multiple) === multiple);
          }
          return multiple;
        }
      }
      return 0;
    };
    BreakScaleMapperImpl2.decoratedMethods = {
      needTransform: function() {
        return !this.breaks.length;
      },
      getExtent: function() {
        return this._outOfBrk.getExtent();
      },
      getExtentUnsafe: function(kind, depth) {
        return depth == null || depth === SCALE_MAPPER_DEPTH_OUT_OF_BREAK ? this._outOfBrk.getExtentUnsafe(kind, null) : this._linear.getExtentUnsafe(kind, null);
      },
      setExtent: function(start2, end2) {
        this.setExtent2(SCALE_EXTENT_KIND_EFFECTIVE, start2, end2);
      },
      setExtent2: function(kind, start2, end2) {
        if (isValidBoundsForExtent(start2, end2)) {
          if (kind === SCALE_EXTENT_KIND_EFFECTIVE) {
            updateAxisBreakGapReal(this, [start2, end2]);
          }
          this._outOfBrk.setExtent2(kind, start2, end2);
          this._linear.setExtent2(kind, this.transformIn(start2, null), this.transformIn(end2, null));
        }
      },
      normalize: function(val) {
        return this._linear.normalize(this.transformIn(val, null));
      },
      scale: function(val) {
        return this.transformOut(this._linear.scale(val), null);
      },
      contain: function(val) {
        return this._outOfBrk.contain(val);
      },
      /**
       * a.k.a., "elapse"
       * Suppose:
       *    AXIS_BREAK_LAST_BREAK_END_BASE: 0
       *    AXIS_BREAK_ELAPSED_BASE: 0
       *    breaks: [
       *        {start: -400, end: -300, gap: 27},
       *        {start: -100, end: 100, gap: 10},
       *        {start: 200, end: 400, gap: 300},
       *    ]
       * The mapping will be:
       *        |        |
       *    400 +   ->   +  237
       *     |  |        |   |  (gap: 300)
       *    200 +   ->   + -63
       *        |        |
       *    100 +   ->   + -163
       *     |  |        |   |  (gap: 10)
       *   -100 +   ->   + -173
       *        |        |
       *   -300 +   ->   + -373
       *     |  |        |   |  (gap: 27)
       *   -400 +   ->   + -400
       *        |        |
       *   origianl     elapsed
       *
       * Note:
       *   `transformIn` and `transformOut` has nothing to do with "scale extent" - out of extent is supported.
       */
      transformIn: function(val, opt) {
        if (opt && opt.depth === SCALE_MAPPER_DEPTH_OUT_OF_BREAK) {
          return val;
        }
        var elapsedVal = AXIS_BREAK_ELAPSED_BASE;
        var lastBreakEnd = AXIS_BREAK_LAST_BREAK_END_BASE;
        var stillOver = true;
        for (var i = 0; i < this.breaks.length; i++) {
          var brk = this.breaks[i];
          if (val <= brk.vmax) {
            if (val > brk.vmin) {
              elapsedVal += brk.vmin - lastBreakEnd + (val - brk.vmin) / (brk.vmax - brk.vmin) * brk.gapReal;
            } else {
              elapsedVal += val - lastBreakEnd;
            }
            lastBreakEnd = brk.vmax;
            stillOver = false;
            break;
          }
          elapsedVal += brk.vmin - lastBreakEnd + brk.gapReal;
          lastBreakEnd = brk.vmax;
        }
        if (stillOver) {
          elapsedVal += val - lastBreakEnd;
        }
        return elapsedVal;
      },
      /**
       * @see transformIn
       * a.k.a., "unelapse"
       */
      transformOut: function(elapsedVal, opt) {
        if (opt && opt.depth === SCALE_MAPPER_DEPTH_OUT_OF_BREAK) {
          return elapsedVal;
        }
        var lastElapsedEnd = AXIS_BREAK_ELAPSED_BASE;
        var lastBreakEnd = AXIS_BREAK_LAST_BREAK_END_BASE;
        var stillOver = true;
        var unelapsedVal = 0;
        for (var i = 0; i < this.breaks.length; i++) {
          var brk = this.breaks[i];
          var elapsedStart = lastElapsedEnd + brk.vmin - lastBreakEnd;
          var elapsedEnd = elapsedStart + brk.gapReal;
          if (elapsedVal <= elapsedEnd) {
            if (elapsedVal > elapsedStart) {
              unelapsedVal = brk.vmin + (elapsedVal - elapsedStart) / (elapsedEnd - elapsedStart) * (brk.vmax - brk.vmin);
            } else {
              unelapsedVal = lastBreakEnd + elapsedVal - lastElapsedEnd;
            }
            lastBreakEnd = brk.vmax;
            stillOver = false;
            break;
          }
          lastElapsedEnd = elapsedEnd;
          lastBreakEnd = brk.vmax;
        }
        if (stillOver) {
          unelapsedVal = lastBreakEnd + elapsedVal - lastElapsedEnd;
        }
        return unelapsedVal;
      }
    };
    return BreakScaleMapperImpl2;
  })()
);
function createBreakScaleMapper(breakParsed, initialExtent) {
  return new BreakScaleMapperImpl(breakParsed, initialExtent);
}
var AXIS_BREAK_ELAPSED_BASE = 0;
var AXIS_BREAK_LAST_BREAK_END_BASE = 0;
function updateAxisBreakGapReal(brkMapper, scaleExtent) {
  var gapPrctSum = 0;
  var fullyInExtBrksSum = {
    tpAbs: {
      span: 0,
      val: 0
    },
    tpPrct: {
      span: 0,
      val: 0
    }
  };
  var init = function() {
    return {
      has: false,
      span: NaN,
      inExtFrac: NaN,
      val: NaN
    };
  };
  var semiInExtBrk = {
    S: {
      tpAbs: init(),
      tpPrct: init()
    },
    E: {
      tpAbs: init(),
      tpPrct: init()
    }
  };
  each(brkMapper.breaks, function(brk) {
    var gapParsed = brk.gapParsed;
    if (gapParsed.type === "tpPrct") {
      gapPrctSum += gapParsed.val;
    }
    var clampedBrk = clampBreakByExtent(brk, scaleExtent);
    if (clampedBrk) {
      var vminClamped = clampedBrk.vmin !== brk.vmin;
      var vmaxClamped = clampedBrk.vmax !== brk.vmax;
      var clampedSpan = clampedBrk.vmax - clampedBrk.vmin;
      if (vminClamped && vmaxClamped) {
      } else if (vminClamped || vmaxClamped) {
        var sOrE = vminClamped ? "S" : "E";
        semiInExtBrk[sOrE][gapParsed.type].has = true;
        semiInExtBrk[sOrE][gapParsed.type].span = clampedSpan;
        semiInExtBrk[sOrE][gapParsed.type].inExtFrac = clampedSpan / (brk.vmax - brk.vmin);
        semiInExtBrk[sOrE][gapParsed.type].val = gapParsed.val;
      } else {
        fullyInExtBrksSum[gapParsed.type].span += clampedSpan;
        fullyInExtBrksSum[gapParsed.type].val += gapParsed.val;
      }
    }
  });
  var prctBrksGapRealSum = gapPrctSum * (0 + (scaleExtent[1] - scaleExtent[0]) + (fullyInExtBrksSum.tpAbs.val - fullyInExtBrksSum.tpAbs.span) + (semiInExtBrk.S.tpAbs.has ? (semiInExtBrk.S.tpAbs.val - semiInExtBrk.S.tpAbs.span) * semiInExtBrk.S.tpAbs.inExtFrac : 0) + (semiInExtBrk.E.tpAbs.has ? (semiInExtBrk.E.tpAbs.val - semiInExtBrk.E.tpAbs.span) * semiInExtBrk.E.tpAbs.inExtFrac : 0) - fullyInExtBrksSum.tpPrct.span - (semiInExtBrk.S.tpPrct.has ? semiInExtBrk.S.tpPrct.span * semiInExtBrk.S.tpPrct.inExtFrac : 0) - (semiInExtBrk.E.tpPrct.has ? semiInExtBrk.E.tpPrct.span * semiInExtBrk.E.tpPrct.inExtFrac : 0)) / (1 - fullyInExtBrksSum.tpPrct.val - (semiInExtBrk.S.tpPrct.has ? semiInExtBrk.S.tpPrct.val * semiInExtBrk.S.tpPrct.inExtFrac : 0) - (semiInExtBrk.E.tpPrct.has ? semiInExtBrk.E.tpPrct.val * semiInExtBrk.E.tpPrct.inExtFrac : 0));
  each(brkMapper.breaks, function(brk) {
    var gapParsed = brk.gapParsed;
    if (gapParsed.type === "tpPrct") {
      brk.gapReal = gapPrctSum !== 0 ? mathMax(prctBrksGapRealSum, 0) * gapParsed.val / gapPrctSum : 0;
    }
    if (gapParsed.type === "tpAbs") {
      brk.gapReal = gapParsed.val;
    }
    if (brk.gapReal == null) {
      brk.gapReal = 0;
    }
  });
}
function pruneTicksByBreak(pruneByBreak, ticks, breaks, getValue, interval, scaleExtent) {
  if (pruneByBreak === "no") {
    return;
  }
  each(breaks, function(brk) {
    var clampedBrk = clampBreakByExtent(brk, scaleExtent);
    if (!clampedBrk) {
      return;
    }
    for (var j = ticks.length - 1; j >= 0; j--) {
      var tick = ticks[j];
      var val = getValue(tick);
      var gap = interval * 3 / 4;
      if (val > clampedBrk.vmin - gap && val < clampedBrk.vmax + gap && (pruneByBreak !== "preserve_extent_bound" || val !== scaleExtent[0] && val !== scaleExtent[1])) {
        ticks.splice(j, 1);
      }
    }
  });
}
function addBreaksToTicks(ticks, breaks, scaleExtent, getTimeProps) {
  each(breaks, function(brk) {
    var clampedBrk = clampBreakByExtent(brk, scaleExtent);
    if (!clampedBrk) {
      return;
    }
    ticks.push({
      value: clampedBrk.vmin,
      "break": {
        type: "vmin",
        parsedBreak: clampedBrk
      },
      time: getTimeProps ? getTimeProps(clampedBrk) : void 0
    });
    ticks.push({
      value: clampedBrk.vmax,
      "break": {
        type: "vmax",
        parsedBreak: clampedBrk
      },
      time: getTimeProps ? getTimeProps(clampedBrk) : void 0
    });
  });
  if (breaks.length) {
    ticks.sort(function(a, b) {
      return a.value - b.value;
    });
  }
}
function clampBreakByExtent(brk, scaleExtent) {
  var vmin = mathMax(brk.vmin, scaleExtent[0]);
  var vmax = mathMin(brk.vmax, scaleExtent[1]);
  return vmin < vmax || vmin === vmax && vmin > scaleExtent[0] && vmin < scaleExtent[1] ? {
    vmin,
    vmax,
    breakOption: brk.breakOption,
    gapParsed: brk.gapParsed,
    gapReal: brk.gapReal
  } : null;
}
function parseAxisBreakOption(breakOptionList, scale3, opt) {
  var parsedBreaks = [];
  if (!breakOptionList) {
    return {
      breaks: parsedBreaks
    };
  }
  function validatePercent(normalizedPercent, msg) {
    if (normalizedPercent >= 0 && normalizedPercent < 1 - 1e-5) {
      return true;
    }
    if (false) {
      error(msg + " must be >= 0 and < 1, rather than " + normalizedPercent + " .");
    }
    return false;
  }
  each(breakOptionList, function(brkOption) {
    if (!brkOption || brkOption.start == null || brkOption.end == null) {
      if (false) {
        error("The input axis breaks start/end should not be empty.");
      }
      return;
    }
    if (brkOption.isExpanded) {
      return;
    }
    var parsedBrk = {
      breakOption: clone(brkOption),
      vmin: scale3.parse(brkOption.start),
      vmax: scale3.parse(brkOption.end),
      gapParsed: {
        type: "tpAbs",
        val: 0
      },
      gapReal: null
    };
    if (brkOption.gap != null) {
      var isPrct = false;
      if (isString(brkOption.gap)) {
        var trimmedGap = trim(brkOption.gap);
        if (trimmedGap.match(/%$/)) {
          var normalizedPercent = parseFloat(trimmedGap) / 100;
          if (!validatePercent(normalizedPercent, "Percent gap")) {
            normalizedPercent = 0;
          }
          parsedBrk.gapParsed.type = "tpPrct";
          parsedBrk.gapParsed.val = normalizedPercent;
          isPrct = true;
        }
      }
      if (!isPrct) {
        var absolute = scale3.parse(brkOption.gap);
        if (!isFinite(absolute) || absolute < 0) {
          if (false) {
            error("Axis breaks gap must positive finite rather than (" + brkOption.gap + ").");
          }
          absolute = 0;
        }
        parsedBrk.gapParsed.type = "tpAbs";
        parsedBrk.gapParsed.val = absolute;
      }
    }
    if (parsedBrk.vmin === parsedBrk.vmax) {
      parsedBrk.gapParsed.type = "tpAbs";
      parsedBrk.gapParsed.val = 0;
    }
    if (opt && opt.noNegative) {
      each(["vmin", "vmax"], function(se) {
        if (parsedBrk[se] < 0) {
          if (false) {
            error("Axis break." + se + " must not be negative.");
          }
          parsedBrk[se] = 0;
        }
      });
    }
    if (parsedBrk.vmin > parsedBrk.vmax) {
      var tmp = parsedBrk.vmax;
      parsedBrk.vmax = parsedBrk.vmin;
      parsedBrk.vmin = tmp;
    }
    parsedBreaks.push(parsedBrk);
  });
  parsedBreaks.sort(function(item1, item2) {
    return item1.vmin - item2.vmin;
  });
  var lastEnd = -Infinity;
  each(parsedBreaks, function(brk, idx) {
    if (lastEnd > brk.vmin) {
      if (false) {
        error("Axis breaks must not overlap.");
      }
      parsedBreaks[idx] = null;
    }
    lastEnd = brk.vmax;
  });
  return {
    breaks: filter(parsedBreaks, function(brk) {
      return !!brk;
    })
  };
}
function identifyAxisBreak(brk, identifier) {
  return serializeAxisBreakIdentifier(identifier) === serializeAxisBreakIdentifier(brk);
}
function serializeAxisBreakIdentifier(identifier) {
  return identifier.start + "_\0_" + identifier.end;
}
function retrieveAxisBreakPairs(itemList, getVisualAxisBreak, returnIdx) {
  var idxPairList = [];
  each(itemList, function(el, idx) {
    var vBreak = getVisualAxisBreak(el);
    if (vBreak && vBreak.type === "vmin") {
      idxPairList.push([idx]);
    }
  });
  each(itemList, function(el, idx) {
    var vBreak = getVisualAxisBreak(el);
    if (vBreak && vBreak.type === "vmax") {
      var idxPair = find(
        idxPairList,
        // parsedBreak may be changed, can only use breakOption to match them.
        function(pr) {
          return identifyAxisBreak(getVisualAxisBreak(itemList[pr[0]]).parsedBreak.breakOption, vBreak.parsedBreak.breakOption);
        }
      );
      idxPair && idxPair.push(idx);
    }
  });
  var result = [];
  each(idxPairList, function(idxPair) {
    if (idxPair.length === 2) {
      result.push(returnIdx ? idxPair : [itemList[idxPair[0]], itemList[idxPair[1]]]);
    }
  });
  return result;
}
function getTicksBreakOutwardTransform(scale3, tick, outermostBreaks, lookup) {
  if (!tick["break"]) {
    return;
  }
  var brk = tick["break"].parsedBreak;
  var originalBrkItem = find(outermostBreaks, function(brk2) {
    return identifyAxisBreak(brk2.breakOption, tick["break"].parsedBreak.breakOption);
  });
  var opt = {
    lookup,
    depth: SCALE_MAPPER_DEPTH_OUT_OF_BREAK
  };
  var vmin = scale3.transformOut(brk.vmin, opt);
  var vmax = scale3.transformOut(brk.vmax, opt);
  var parsedBreak = {
    vmin,
    vmax,
    breakOption: brk.breakOption,
    gapParsed: clone(originalBrkItem.gapParsed),
    gapReal: brk.gapReal
  };
  return {
    tickVal: parsedBreak[tick["break"].type],
    vBreak: {
      type: tick["break"].type,
      parsedBreak
    }
  };
}
function parseAxisBreakOptionInwardTransform(breakOptionList, scale3, parseOpt, lookupStartIdx, out2) {
  out2.original = parseAxisBreakOption(breakOptionList, scale3, parseOpt);
  var transformed = out2.transformed = parseAxisBreakOption(breakOptionList, scale3, parseOpt);
  var lookup = out2.lookup;
  transformed.breaks = map(transformed.breaks, function(brk, idx) {
    var transOpt = {
      depth: SCALE_MAPPER_DEPTH_OUT_OF_BREAK
    };
    var vmin = scale3.transformIn(brk.vmin, transOpt);
    var vmax = scale3.transformIn(brk.vmax, transOpt);
    var gapParsed = {
      type: brk.gapParsed.type,
      val: brk.gapParsed.type === "tpAbs" ? scale3.transformIn(brk.vmin + brk.gapParsed.val, transOpt) - vmin : brk.gapParsed.val
    };
    lookup.from[lookupStartIdx + idx] = vmin;
    lookup.to[lookupStartIdx + idx] = brk.vmin;
    lookup.from[lookupStartIdx + idx + 1] = vmax;
    lookup.to[lookupStartIdx + idx + 1] = brk.vmax;
    return {
      vmin,
      vmax,
      gapParsed,
      gapReal: brk.gapReal,
      breakOption: brk.breakOption
    };
  });
}
var BREAK_MIN_MAX_TO_PARAM = {
  vmin: "start",
  vmax: "end"
};
function makeAxisLabelFormatterParamBreak(extraParam, vBreak) {
  if (vBreak) {
    extraParam = extraParam || {};
    extraParam["break"] = {
      type: BREAK_MIN_MAX_TO_PARAM[vBreak.type],
      start: vBreak.parsedBreak.vmin,
      end: vBreak.parsedBreak.vmax
    };
  }
  return extraParam;
}
function installScaleBreakHelper() {
  registerScaleBreakHelperImpl({
    createBreakScaleMapper,
    pruneTicksByBreak,
    addBreaksToTicks,
    parseAxisBreakOption,
    identifyAxisBreak,
    serializeAxisBreakIdentifier,
    retrieveAxisBreakPairs,
    getTicksBreakOutwardTransform,
    parseAxisBreakOptionInwardTransform,
    makeAxisLabelFormatterParamBreak
  });
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/component/axis/axisAction.js
var AXIS_BREAK_EXPAND_ACTION_TYPE = "expandAxisBreak";
var AXIS_BREAK_COLLAPSE_ACTION_TYPE = "collapseAxisBreak";
var AXIS_BREAK_TOGGLE_ACTION_TYPE = "toggleAxisBreak";
var AXIS_BREAK_CHANGED_EVENT_TYPE = "axisbreakchanged";
var expandAxisBreakActionInfo = {
  type: AXIS_BREAK_EXPAND_ACTION_TYPE,
  event: AXIS_BREAK_CHANGED_EVENT_TYPE,
  update: "update",
  refineEvent: refineAxisBreakChangeEvent
};
var collapseAxisBreakActionInfo = {
  type: AXIS_BREAK_COLLAPSE_ACTION_TYPE,
  event: AXIS_BREAK_CHANGED_EVENT_TYPE,
  update: "update",
  refineEvent: refineAxisBreakChangeEvent
};
var toggleAxisBreakActionInfo = {
  type: AXIS_BREAK_TOGGLE_ACTION_TYPE,
  event: AXIS_BREAK_CHANGED_EVENT_TYPE,
  update: "update",
  refineEvent: refineAxisBreakChangeEvent
};
function refineAxisBreakChangeEvent(actionResultBatch, payload, ecModel, api) {
  var breaks = [];
  each(actionResultBatch, function(actionResult) {
    breaks = breaks.concat(actionResult.eventBreaks);
  });
  return {
    eventContent: {
      breaks
    }
  };
}
function registerAction(registers) {
  registers.registerAction(expandAxisBreakActionInfo, actionHandler);
  registers.registerAction(collapseAxisBreakActionInfo, actionHandler);
  registers.registerAction(toggleAxisBreakActionInfo, actionHandler);
  function actionHandler(payload, ecModel) {
    var eventBreaks = [];
    var finderResult = parseFinder(ecModel, payload);
    function dealUpdate(modelProp, indexProp) {
      each(finderResult[modelProp], function(axisModel) {
        var result = axisModel.updateAxisBreaks(payload);
        each(result.breaks, function(item) {
          var _a2;
          eventBreaks.push(defaults((_a2 = {}, _a2[indexProp] = axisModel.componentIndex, _a2), item));
        });
      });
    }
    dealUpdate("xAxisModels", "xAxisIndex");
    dealUpdate("yAxisModels", "yAxisIndex");
    dealUpdate("singleAxisModels", "singleAxisIndex");
    return {
      eventBreaks
    };
  }
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/component/axis/axisBreakHelper.js
var _impl2 = null;
function registerAxisBreakHelperImpl(impl) {
  if (!_impl2) {
    _impl2 = impl;
  }
}
function getAxisBreakHelper() {
  return _impl2;
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/component/axis/axisBreakHelperImpl.js
var viewCache = makeInner();
function ensureVisualInCache(visualList, targetBreak) {
  var visual = find(visualList, function(item) {
    return getScaleBreakHelper().identifyAxisBreak(item.parsedBreak.breakOption, targetBreak.breakOption);
  });
  if (!visual) {
    visualList.push(visual = {
      zigzagRandomList: [],
      parsedBreak: targetBreak,
      shouldRemove: false
    });
  }
  return visual;
}
function resetCacheVisualRemoveFlag(visualList) {
  each(visualList, function(item) {
    return item.shouldRemove = true;
  });
}
function removeUnusedCacheVisual(visualList) {
  for (var i = visualList.length - 1; i >= 0; i--) {
    if (visualList[i].shouldRemove) {
      visualList.splice(i, 1);
    }
  }
}
function rectCoordBuildBreakAxis(axisGroup, axisView, axisModel, coordSysRect, api) {
  var axis = axisModel.axis;
  if (axis.scale.isBlank() || !getScaleBreakHelper()) {
    return;
  }
  var breakPairs = getScaleBreakHelper().retrieveAxisBreakPairs(axis.scale.getTicks({
    breakTicks: "only_break"
  }), function(tick) {
    return tick["break"];
  }, false);
  if (!breakPairs.length) {
    return;
  }
  var breakAreaModel = axisModel.getModel("breakArea");
  var zigzagAmplitude = breakAreaModel.get("zigzagAmplitude");
  var zigzagMinSpan = breakAreaModel.get("zigzagMinSpan");
  var zigzagMaxSpan = breakAreaModel.get("zigzagMaxSpan");
  zigzagMinSpan = Math.max(2, zigzagMinSpan || 0);
  zigzagMaxSpan = Math.max(zigzagMinSpan, zigzagMaxSpan || 0);
  var expandOnClick = breakAreaModel.get("expandOnClick");
  var zigzagZ = breakAreaModel.get("zigzagZ");
  var itemStyleModel = breakAreaModel.getModel("itemStyle");
  var itemStyle = itemStyleModel.getItemStyle();
  var borderColor = itemStyle.stroke;
  var borderWidth = itemStyle.lineWidth;
  var borderType = itemStyle.lineDash;
  var color2 = itemStyle.fill;
  var group = new Group_default({
    ignoreModelZ: true
  });
  var isAxisHorizontal = axis.isHorizontal();
  var cachedVisualList = viewCache(axisView).visualList || (viewCache(axisView).visualList = []);
  resetCacheVisualRemoveFlag(cachedVisualList);
  var _loop_1 = function(i2) {
    var parsedBreak = breakPairs[i2][0]["break"].parsedBreak;
    var coords = [];
    coords[0] = axis.toGlobalCoord(axis.dataToCoord(parsedBreak.vmin, true));
    coords[1] = axis.toGlobalCoord(axis.dataToCoord(parsedBreak.vmax, true));
    if (coords[1] < coords[0]) {
      coords.reverse();
    }
    var cachedVisual = ensureVisualInCache(cachedVisualList, parsedBreak);
    cachedVisual.shouldRemove = false;
    var breakGroup = new Group_default();
    addZigzagShapes(cachedVisual.zigzagRandomList, breakGroup, coords[0], coords[1], isAxisHorizontal, parsedBreak);
    if (expandOnClick) {
      breakGroup.on("click", function() {
        var payload = {
          type: AXIS_BREAK_EXPAND_ACTION_TYPE,
          breaks: [{
            start: parsedBreak.breakOption.start,
            end: parsedBreak.breakOption.end
          }]
        };
        payload[axis.dim + "AxisIndex"] = axisModel.componentIndex;
        api.dispatchAction(payload);
      });
    }
    breakGroup.silent = !expandOnClick;
    group.add(breakGroup);
  };
  for (var i = 0; i < breakPairs.length; i++) {
    _loop_1(i);
  }
  axisGroup.add(group);
  removeUnusedCacheVisual(cachedVisualList);
  function addZigzagShapes(zigzagRandomList, breakGroup, startCoord, endCoord, isAxisHorizontal2, trimmedBreak) {
    var polylineStyle = {
      stroke: borderColor,
      lineWidth: borderWidth,
      lineDash: borderType,
      fill: "none"
    };
    var dimBrk = isAxisHorizontal2 ? 0 : 1;
    var dimZigzag = 1 - dimBrk;
    var zigzagCoordMax = coordSysRect[XY2[dimZigzag]] + coordSysRect[WH2[dimZigzag]];
    function subPixelOpt(brkCoord) {
      var pBrk = [];
      var dummyP = [];
      pBrk[dimBrk] = dummyP[dimBrk] = brkCoord;
      pBrk[dimZigzag] = coordSysRect[XY2[dimZigzag]];
      dummyP[dimZigzag] = zigzagCoordMax;
      var dummyShape = {
        x1: pBrk[0],
        y1: pBrk[1],
        x2: dummyP[0],
        y2: dummyP[1]
      };
      subPixelOptimizeLine(dummyShape, dummyShape, {
        lineWidth: 1
      });
      pBrk[0] = dummyShape.x1;
      pBrk[1] = dummyShape.y1;
      return pBrk[dimBrk];
    }
    startCoord = subPixelOpt(startCoord);
    endCoord = subPixelOpt(endCoord);
    var pointsA = [];
    var pointsB = [];
    var isSwap = true;
    var current = coordSysRect[XY2[dimZigzag]];
    for (var idx = 0; ; idx++) {
      var isFirstPoint = current === coordSysRect[XY2[dimZigzag]];
      var isLastPoint = current >= zigzagCoordMax;
      if (isLastPoint) {
        current = zigzagCoordMax;
      }
      var pA = [];
      var pB = [];
      pA[dimBrk] = startCoord;
      pB[dimBrk] = endCoord;
      if (!isFirstPoint && !isLastPoint) {
        pA[dimBrk] += isSwap ? -zigzagAmplitude : zigzagAmplitude;
        pB[dimBrk] -= !isSwap ? -zigzagAmplitude : zigzagAmplitude;
      }
      pA[dimZigzag] = current;
      pB[dimZigzag] = current;
      pointsA.push(pA);
      pointsB.push(pB);
      var randomVal = void 0;
      if (idx < zigzagRandomList.length) {
        randomVal = zigzagRandomList[idx];
      } else {
        randomVal = Math.random();
        zigzagRandomList.push(randomVal);
      }
      current += randomVal * (zigzagMaxSpan - zigzagMinSpan) + zigzagMinSpan;
      isSwap = !isSwap;
      if (isLastPoint) {
        break;
      }
    }
    var anidSuffix = getScaleBreakHelper().serializeAxisBreakIdentifier(trimmedBreak.breakOption);
    breakGroup.add(new Polyline_default({
      anid: "break_a_" + anidSuffix,
      shape: {
        points: pointsA
      },
      style: polylineStyle,
      z: zigzagZ
    }));
    if (trimmedBreak.gapReal !== 0) {
      breakGroup.add(new Polyline_default({
        anid: "break_b_" + anidSuffix,
        shape: {
          // Not reverse to keep the dash stable when dragging resizing.
          points: pointsB
        },
        style: polylineStyle,
        z: zigzagZ
      }));
      var pointsB2 = pointsB.slice();
      pointsB2.reverse();
      var polygonPoints = pointsA.concat(pointsB2);
      breakGroup.add(new Polygon_default({
        anid: "break_c_" + anidSuffix,
        shape: {
          points: polygonPoints
        },
        style: {
          fill: color2,
          opacity: itemStyle.opacity
        },
        z: zigzagZ
      }));
    }
  }
}
function buildAxisBreakLine(axisModel, group, transformGroup, pathBaseProp) {
  var axis = axisModel.axis;
  var transform = transformGroup.transform;
  assert(pathBaseProp.style);
  var extent = axis.getExtent();
  if (axis.inverse) {
    extent = extent.slice();
    extent.reverse();
  }
  var breakPairs = getScaleBreakHelper().retrieveAxisBreakPairs(axis.scale.getTicks({
    breakTicks: "only_break"
  }), function(tick) {
    return tick["break"];
  }, false);
  var brkLayoutList = map(breakPairs, function(breakPair) {
    var parsedBreak = breakPair[0]["break"].parsedBreak;
    var coordPair = [axis.dataToCoord(parsedBreak.vmin, true), axis.dataToCoord(parsedBreak.vmax, true)];
    coordPair[0] > coordPair[1] && coordPair.reverse();
    return {
      coordPair,
      brkId: getScaleBreakHelper().serializeAxisBreakIdentifier(parsedBreak.breakOption)
    };
  });
  brkLayoutList.sort(function(layout1, layout22) {
    return layout1.coordPair[0] - layout22.coordPair[0];
  });
  var ySegMin = extent[0];
  var lastLayout = null;
  for (var idx = 0; idx < brkLayoutList.length; idx++) {
    var layout2 = brkLayoutList[idx];
    var brkTirmmedMin = Math.max(layout2.coordPair[0], extent[0]);
    var brkTirmmedMax = Math.min(layout2.coordPair[1], extent[1]);
    if (ySegMin <= brkTirmmedMin) {
      addSeg(ySegMin, brkTirmmedMin, lastLayout, layout2);
    }
    ySegMin = brkTirmmedMax;
    lastLayout = layout2;
  }
  if (ySegMin <= extent[1]) {
    addSeg(ySegMin, extent[1], lastLayout, null);
  }
  function addSeg(min3, max3, layout1, layout22) {
    function trans(p1, p2) {
      if (transform) {
        applyTransform(p1, p1, transform);
        applyTransform(p2, p2, transform);
      }
    }
    function subPixelOptimizePP(p1, p2) {
      var shape = {
        x1: p1[0],
        y1: p1[1],
        x2: p2[0],
        y2: p2[1]
      };
      subPixelOptimizeLine(shape, shape, pathBaseProp.style);
      p1[0] = shape.x1;
      p1[1] = shape.y1;
      p2[0] = shape.x2;
      p2[1] = shape.y2;
    }
    var lineP1 = [min3, 0];
    var lineP2 = [max3, 0];
    var dummyTickEnd1 = [min3, 5];
    var dummyTickEnd2 = [max3, 5];
    trans(lineP1, dummyTickEnd1);
    subPixelOptimizePP(lineP1, dummyTickEnd1);
    trans(lineP2, dummyTickEnd2);
    subPixelOptimizePP(lineP2, dummyTickEnd2);
    subPixelOptimizePP(lineP1, lineP2);
    var seg = new Line_default(extend({
      shape: {
        x1: lineP1[0],
        y1: lineP1[1],
        x2: lineP2[0],
        y2: lineP2[1]
      }
    }, pathBaseProp));
    group.add(seg);
    seg.anid = "breakLine_" + (layout1 ? layout1.brkId : "\0") + "_\0_" + (layout22 ? layout22.brkId : "\0");
  }
}
function adjustBreakLabelPair(axisInverse, axisRotation, layoutPair) {
  if (find(layoutPair, function(item) {
    return !item;
  })) {
    return;
  }
  var mtv = new Point_default();
  if (!labelIntersect(layoutPair[0], layoutPair[1], mtv, {
    // Assert `labelPair` is `[break_min, break_max]`.
    // `axis.inverse: true` means a smaller scale value corresponds to a bigger value in axis.extent.
    // The axisRotation indicates mtv direction of OBB intersecting.
    direction: -(axisInverse ? axisRotation + Math.PI : axisRotation),
    touchThreshold: 0,
    // If need to resovle intersection align axis by moving labels according to MTV,
    // the direction must not be opposite, otherwise cause misleading.
    bidirectional: false
  })) {
    return;
  }
  var axisStTrans = create();
  rotate(axisStTrans, axisStTrans, -axisRotation);
  var labelPairStTrans = map(layoutPair, function(layout2) {
    return layout2.transform ? mul(create(), axisStTrans, layout2.transform) : axisStTrans;
  });
  function isParallelToAxis(whIdx) {
    var localRect = layoutPair[0].localRect;
    var labelVec0 = new Point_default(localRect[WH2[whIdx]] * labelPairStTrans[0][0], localRect[WH2[whIdx]] * labelPairStTrans[0][1]);
    return Math.abs(labelVec0.y) < 1e-5;
  }
  var k = 0.5;
  if (isParallelToAxis(0) || isParallelToAxis(1)) {
    var rectSt = map(layoutPair, function(layout2, idx) {
      var rect = layout2.localRect.clone();
      rect.applyTransform(labelPairStTrans[idx]);
      return rect;
    });
    var brkCenterSt = new Point_default();
    brkCenterSt.copy(layoutPair[0].label).add(layoutPair[1].label).scale(0.5);
    brkCenterSt.transform(axisStTrans);
    var mtvSt = mtv.clone().transform(axisStTrans);
    var insidePtSum = rectSt[0].x + rectSt[1].x + (mtvSt.x >= 0 ? rectSt[0].width : rectSt[1].width);
    var qval = (insidePtSum + mtvSt.x) / 2 - brkCenterSt.x;
    var uvalMin = Math.min(qval, qval - mtvSt.x);
    var uvalMax = Math.max(qval, qval - mtvSt.x);
    var uval = uvalMax < 0 ? uvalMax : uvalMin > 0 ? uvalMin : 0;
    k = (qval - uval) / mtvSt.x;
  }
  var delta0 = new Point_default();
  var delta1 = new Point_default();
  Point_default.scale(delta0, mtv, -k);
  Point_default.scale(delta1, mtv, 1 - k);
  labelLayoutApplyTranslation(layoutPair[0], delta0);
  labelLayoutApplyTranslation(layoutPair[1], delta1);
}
function updateModelAxisBreak(model, payload) {
  var result = {
    breaks: []
  };
  each(payload.breaks, function(inputBrk) {
    if (!inputBrk) {
      return;
    }
    var breakOption = find(model.get("breaks", true), function(brkOption) {
      return getScaleBreakHelper().identifyAxisBreak(brkOption, inputBrk);
    });
    if (!breakOption) {
      if (false) {
        warn("Can not find axis break by start: " + inputBrk.start + ", end: " + inputBrk.end);
      }
      return;
    }
    var actionType = payload.type;
    var old = {
      isExpanded: !!breakOption.isExpanded
    };
    breakOption.isExpanded = actionType === AXIS_BREAK_EXPAND_ACTION_TYPE ? true : actionType === AXIS_BREAK_COLLAPSE_ACTION_TYPE ? false : actionType === AXIS_BREAK_TOGGLE_ACTION_TYPE ? !breakOption.isExpanded : breakOption.isExpanded;
    result.breaks.push({
      start: breakOption.start,
      end: breakOption.end,
      isExpanded: !!breakOption.isExpanded,
      old
    });
  });
  return result;
}
function installAxisBreakHelper() {
  registerAxisBreakHelperImpl({
    adjustBreakLabelPair,
    buildAxisBreakLine,
    rectCoordBuildBreakAxis,
    updateModelAxisBreak
  });
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/component/axis/installBreak.js
function installAxisBreak(registers) {
  registerAction(registers);
  installScaleBreakHelper();
  installAxisBreakHelper();
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/scale/Scale.js
var Scale = (
  /** @class */
  (function() {
    function Scale2() {
    }
    Scale2.prototype.isBlank = function() {
      return this._isBlank;
    };
    Scale2.prototype.setBlank = function(isBlank) {
      this._isBlank = isBlank;
    };
    return Scale2;
  })()
);
enableClassManagement(Scale);
var Scale_default = Scale;

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/data/OrdinalMeta.js
var uidBase = 0;
var OrdinalMeta = (
  /** @class */
  (function() {
    function OrdinalMeta2(opt) {
      this.categories = opt.categories || [];
      this._needCollect = opt.needCollect;
      this._deduplication = opt.deduplication;
      this.uid = ++uidBase;
      this._onCollect = opt.onCollect;
    }
    OrdinalMeta2.createByAxisModel = function(axisModel) {
      var option = axisModel.option;
      var data = option.data;
      var categories = data && map(data, getName);
      return new OrdinalMeta2({
        categories,
        needCollect: !categories,
        // deduplication is default in axis.
        deduplication: option.dedplication !== false
      });
    };
    ;
    OrdinalMeta2.prototype.getOrdinal = function(category) {
      return this._getOrCreateMap().get(category);
    };
    OrdinalMeta2.prototype.parseAndCollect = function(category) {
      var index;
      var needCollect = this._needCollect;
      if (!isString(category) && !needCollect) {
        return category;
      }
      if (needCollect && !this._deduplication) {
        index = this.categories.length;
        this.categories[index] = category;
        this._onCollect && this._onCollect(category, index);
        return index;
      }
      var map2 = this._getOrCreateMap();
      index = map2.get(category);
      if (index == null) {
        if (needCollect) {
          index = this.categories.length;
          this.categories[index] = category;
          map2.set(category, index);
          this._onCollect && this._onCollect(category, index);
        } else {
          index = NaN;
        }
      }
      return index;
    };
    OrdinalMeta2.prototype._getOrCreateMap = function() {
      return this._map || (this._map = createHashMap(this.categories));
    };
    return OrdinalMeta2;
  })()
);
function getName(obj) {
  if (isObject(obj) && obj.value != null) {
    return obj.value;
  } else {
    return obj + "";
  }
}
var OrdinalMeta_default = OrdinalMeta;

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/scale/helper.js
function isIntervalOrLogScale(scale3) {
  return isIntervalScale(scale3) || isLogScale(scale3);
}
function isIntervalScale(scale3) {
  return scale3.type === "interval";
}
function isTimeScale(scale3) {
  return scale3.type === "time";
}
function isLogScale(scale3) {
  return scale3.type === "log";
}
function isOrdinalScale(scale3) {
  return scale3.type === "ordinal";
}
function increaseInterval(niceInterval) {
  var exponent = quantityExponent(niceInterval);
  var exp10 = mathPow(10, exponent);
  var f = mathRound(niceInterval / exp10);
  if (!f) {
    f = 1;
  } else if (f === 2) {
    f = 3;
  } else if (f === 3) {
    f = 5;
  } else {
    f *= 2;
  }
  return round(f * exp10, -exponent);
}
function getIntervalPrecision(niceInterval) {
  return getPrecision(niceInterval) + 2;
}
function logScaleLogTick(val, base2) {
  return mathLog(val) / mathLog(base2);
}
function logScalePowTick(linearTickVal, base2, opt) {
  var lookup = opt && opt.lookup;
  if (lookup) {
    for (var i = 0; i < lookup.from.length; i++) {
      if (linearTickVal === lookup.from[i]) {
        return lookup.to[i];
      }
    }
  }
  return mathPow(base2, linearTickVal);
}
function intervalScaleEnsureValidExtent(rawExtent, fixMinMax, rawExtentResult) {
  var extent = rawExtent.slice();
  if (extent[0] === extent[1]) {
    var containShapeRequired = rawExtentResult && rawExtentResult.ctnShp;
    if (extent[0] !== 0) {
      var expandSize = mathAbs(extent[0]);
      if (!fixMinMax[1]) {
        extent[1] += expandSize / 2;
        extent[0] -= expandSize / 2;
      } else {
        extent[0] -= expandSize / 2;
      }
    } else {
      if (containShapeRequired) {
        extent[0] = -1;
        extent[1] = 1;
      } else {
        extent[1] = 1;
      }
    }
  }
  if (!isValidNumberForExtent(extent[0]) || !isValidNumberForExtent(extent[1])) {
    extent[0] = 0;
    extent[1] = 1;
  }
  if (extent[1] < extent[0]) {
    extent.reverse();
  }
  return extent;
}
function extentDiffers(extent1, extent2) {
  return [extent1[0] !== extent2[0], extent1[1] !== extent2[1]];
}
function ensureValidSplitNumber(rawSplitNumber, defaultSplitNumber) {
  rawSplitNumber = rawSplitNumber || defaultSplitNumber;
  return mathRound(mathMax(rawSplitNumber, 1));
}
function ordinalScaleCreateTicks(ordinalScale, categoryInterval, addItem) {
  var extent = getScaleExtentForTickUnsafe(ordinalScale);
  var startTick = extent[0];
  var tickCount = ordinalScale.count();
  var step = Math.max((categoryInterval || 0) + 1, 1);
  if (startTick !== 0 && step > 1 && tickCount / step > 2) {
    startTick = Math.round(Math.ceil(startTick / step) * step);
  }
  if (startTick !== extent[0]) {
    addItemInternally(extent[0], true, true);
  }
  var tickValue = startTick;
  for (; tickValue <= extent[1]; tickValue += step) {
    addItemInternally(tickValue, false, tickValue === extent[0] || tickValue === extent[1]);
  }
  if (tickValue - step !== extent[1]) {
    addItemInternally(extent[1], true, true);
  }
  function addItemInternally(tickValue2, offInterval, isExtentBoundary) {
    addItem({
      value: tickValue2,
      offInterval
    }, isExtentBoundary);
  }
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/scale/Ordinal.js
var OrdinalScale = (
  /** @class */
  (function(_super) {
    __extends(OrdinalScale2, _super);
    function OrdinalScale2(setting) {
      var _this = _super.call(this) || this;
      _this.type = "ordinal";
      _this.parse = OrdinalScale2.parse;
      decorateScaleMapper(_this, OrdinalScale2.decoratedMethods);
      var ordinalMeta = setting.ordinalMeta;
      if (!ordinalMeta) {
        ordinalMeta = new OrdinalMeta_default({});
      }
      if (isArray(ordinalMeta)) {
        ordinalMeta = new OrdinalMeta_default({
          categories: map(ordinalMeta, function(item) {
            return isObject(item) ? item.value : item;
          })
        });
      }
      _this._ordinalMeta = ordinalMeta;
      var res = initBreakOrLinearMapper(
        null,
        null,
        // Do not support break in OrdinalScale yet.
        setting.extent || [0, ordinalMeta.categories.length - 1]
      );
      _this._mapper = res.mapper;
      enableScaleMapperFreeze(_this, res.mapper);
      return _this;
    }
    OrdinalScale2.parse = function(val) {
      if (val == null) {
        val = NaN;
      } else if (isString(val)) {
        val = this._ordinalMeta.getOrdinal(val);
        if (val == null) {
          val = NaN;
        }
      } else {
        val = mathRound(val);
      }
      return val;
    };
    OrdinalScale2.prototype.getTicks = function() {
      var ticks = [];
      ordinalScaleCreateTicks(this, 0, function(tick) {
        ticks.push(tick);
      });
      return ticks;
    };
    OrdinalScale2.prototype.getMinorTicks = function(splitNumber) {
      return;
    };
    OrdinalScale2.prototype.setSortInfo = function(info) {
      if (info == null) {
        this._ordinalNumbersByTick = this._ticksByOrdinalNumber = null;
        return;
      }
      var infoOrdinalNumbers = info.ordinalNumbers;
      var ordinalsByTick = this._ordinalNumbersByTick = [];
      var ticksByOrdinal = this._ticksByOrdinalNumber = [];
      var tickNum = 0;
      var allCategoryLen = this._ordinalMeta.categories.length;
      for (var len2 = mathMin(allCategoryLen, infoOrdinalNumbers.length); tickNum < len2; ++tickNum) {
        var ordinalNumber = ordinalsByTick[tickNum] = infoOrdinalNumbers[tickNum];
        ticksByOrdinal[ordinalNumber] = tickNum;
      }
      var unusedOrdinal = 0;
      for (; tickNum < allCategoryLen; ++tickNum) {
        while (ticksByOrdinal[unusedOrdinal] != null) {
          unusedOrdinal++;
        }
        ;
        ordinalsByTick[tickNum] = unusedOrdinal;
        ticksByOrdinal[unusedOrdinal] = tickNum;
      }
    };
    OrdinalScale2.prototype._getTickNumber = function(ordinal) {
      var ticksByOrdinalNumber = this._ticksByOrdinalNumber;
      return ticksByOrdinalNumber && ordinal >= 0 && ordinal < ticksByOrdinalNumber.length ? ticksByOrdinalNumber[ordinal] : ordinal;
    };
    OrdinalScale2.prototype.getRawOrdinalNumber = function(tickValue) {
      var ordinalNumbersByTick = this._ordinalNumbersByTick;
      return ordinalNumbersByTick && tickValue >= 0 && tickValue < ordinalNumbersByTick.length ? ordinalNumbersByTick[tickValue] : tickValue;
    };
    OrdinalScale2.prototype.getLabel = function(tick) {
      if (!this.isBlank()) {
        var ordinalNumber = this.getRawOrdinalNumber(tick.value);
        var category = this._ordinalMeta.categories[ordinalNumber];
        return category == null ? "" : category + "";
      }
    };
    OrdinalScale2.prototype.count = function() {
      var extent = getScaleExtentForTickUnsafe(this._mapper);
      return extent[1] - extent[0] + 1;
    };
    OrdinalScale2.prototype.getOrdinalMeta = function() {
      return this._ordinalMeta;
    };
    OrdinalScale2.type = "ordinal";
    OrdinalScale2.decoratedMethods = {
      needTransform: function() {
        return this._mapper.needTransform();
      },
      contain: function(val) {
        return this._mapper.contain(this._getTickNumber(val)) && val >= 0 && val < this._ordinalMeta.categories.length;
      },
      normalize: function(val) {
        return this._mapper.normalize(this._getTickNumber(val));
      },
      scale: function(val) {
        return this.getRawOrdinalNumber(mathRound(this._mapper.scale(val)));
      },
      transformIn: function(val, opt) {
        return this._mapper.transformIn(this._getTickNumber(val), opt);
      },
      transformOut: function(val, opt) {
        return this.getRawOrdinalNumber(this._mapper.transformOut(val, opt));
      },
      getExtent: function() {
        return this._mapper.getExtent();
      },
      getExtentUnsafe: function(kind, depth) {
        return this._mapper.getExtentUnsafe(kind, depth);
      },
      /**
       * NOTICE: OrdinalScale extent should always originates from
       * `[0, ordinalMeta.categories.length - 1]`, regardless of min/max of `series.data`.
       * But settings like `xxxAxis.min/max` can still modify the extent.
       * It is handled by constructor of `ScaleRawExtentInfo`.
       */
      setExtent: function(start2, end2) {
        return this._mapper.setExtent(start2, end2);
      },
      setExtent2: function(kind, start2, end2) {
        return this._mapper.setExtent2(kind, start2, end2);
      }
    };
    return OrdinalScale2;
  })(Scale_default)
);
Scale_default.registerClass(OrdinalScale);
var Ordinal_default = OrdinalScale;

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/scale/minorTicks.js
function getMinorTicks(scale3, splitNumber, breaks, scaleInterval) {
  var ticks = scale3.getTicks({
    expandToNicedExtent: true
  });
  var minorTicks = [];
  var extent = scale3.getExtent();
  for (var i = 1; i < ticks.length; i++) {
    var nextTick = ticks[i];
    var prevTick = ticks[i - 1];
    if (prevTick["break"] || nextTick["break"]) {
      continue;
    }
    var count = 0;
    var minorTicksGroup = [];
    var interval = nextTick.value - prevTick.value;
    var minorInterval = interval / splitNumber;
    var minorIntervalPrecision = getIntervalPrecision(minorInterval);
    while (count < splitNumber - 1) {
      var minorTick = round(prevTick.value + (count + 1) * minorInterval, minorIntervalPrecision);
      if (minorTick > extent[0] && minorTick < extent[1]) {
        minorTicksGroup.push(minorTick);
      }
      count++;
    }
    var scaleBreakHelper = getScaleBreakHelper();
    scaleBreakHelper && scaleBreakHelper.pruneTicksByBreak("auto", minorTicksGroup, breaks, function(value) {
      return value;
    }, scaleInterval, extent);
    minorTicks.push(minorTicksGroup);
  }
  return minorTicks;
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/scale/Interval.js
var IntervalScale = (
  /** @class */
  (function(_super) {
    __extends(IntervalScale2, _super);
    function IntervalScale2(setting) {
      var _this = _super.call(this) || this;
      _this.type = "interval";
      _this.parse = IntervalScale2.parse;
      setting = setting || {};
      var breakParsed = simplyParseBreakOption(_this, setting);
      var res = initBreakOrLinearMapper(_this, breakParsed, null);
      _this.brk = res.brk;
      _this._cfg = {
        interval: 0,
        intervalPrecision: 2,
        intervalCount: void 0,
        niceExtent: void 0
      };
      return _this;
    }
    IntervalScale2.parse = function(val) {
      return val == null || val === "" ? NaN : Number(val);
    };
    IntervalScale2.prototype.getConfig = function() {
      return clone(this._cfg);
    };
    IntervalScale2.prototype.setConfig = function(cfg) {
      var extent = getScaleExtentForTickUnsafe(this);
      if (false) {
        assert(cfg.interval != null);
        if (cfg.intervalCount != null) {
          assert(cfg.intervalCount >= -1 && cfg.intervalPrecision != null && !hasBreaks(this));
        }
        if (cfg.niceExtent != null) {
          assert(isFinite(cfg.niceExtent[0]) && isFinite(cfg.niceExtent[1]));
          assert(extent[0] <= cfg.niceExtent[0] && cfg.niceExtent[1] <= extent[1]);
          assert(round(cfg.niceExtent[0] - cfg.niceExtent[1], getPrecision(cfg.interval)) <= cfg.interval);
        }
      }
      this._cfg = cfg = clone(cfg);
      if (cfg.niceExtent == null) {
        cfg.niceExtent = extent.slice();
      }
      if (cfg.intervalPrecision == null) {
        cfg.intervalPrecision = getIntervalPrecision(cfg.interval);
      }
    };
    IntervalScale2.prototype.getTicks = function(opt) {
      opt = opt || {};
      var cfg = this._cfg;
      var interval = cfg.interval;
      var extent = getScaleExtentForTickUnsafe(this);
      var niceExtent = cfg.niceExtent;
      var intervalPrecision = cfg.intervalPrecision;
      var scaleBreakHelper = getScaleBreakHelper();
      var brk = this.brk;
      var brkAvailable = scaleBreakHelper && brk;
      var ticks = [];
      if (!interval) {
        return ticks;
      }
      if (opt.breakTicks === "only_break" && brkAvailable) {
        scaleBreakHelper.addBreaksToTicks(ticks, brk.breaks, extent);
        return ticks;
      }
      if (false) {
        assert(niceExtent != null);
      }
      var safeLimit = 3e3;
      if (extent[0] < niceExtent[0]) {
        ticks.push({
          value: opt.expandToNicedExtent ? round(niceExtent[0] - interval, intervalPrecision) : extent[0]
        });
      }
      var estimateNiceMultiple = function(tickVal, targetTick) {
        return mathRound((targetTick - tickVal) / interval);
      };
      var intervalCount = cfg.intervalCount;
      for (var tick = niceExtent[0], niceTickIdx = 0; ; niceTickIdx++) {
        if (intervalCount == null) {
          if (tick > niceExtent[1] || !isFinite(tick) || !isFinite(niceExtent[1])) {
            break;
          }
        } else {
          if (niceTickIdx > intervalCount) {
            break;
          }
          tick = mathMin(tick, niceExtent[1]);
          if (niceTickIdx === intervalCount) {
            tick = niceExtent[1];
          }
        }
        ticks.push({
          value: tick
        });
        tick = round(tick + interval, intervalPrecision);
        if (brk) {
          var moreMultiple = brk.calcNiceTickMultiple(tick, estimateNiceMultiple);
          if (moreMultiple >= 0) {
            tick = round(tick + moreMultiple * interval, intervalPrecision);
          }
        }
        if (ticks.length > 0 && tick === ticks[ticks.length - 1].value) {
          break;
        }
        if (ticks.length > safeLimit) {
          if (false) {
            warn('Exceed safe limit in IntervalScale["getTicks"].');
          }
          return [];
        }
      }
      var lastNiceTick = ticks.length ? ticks[ticks.length - 1].value : niceExtent[1];
      if (extent[1] > lastNiceTick) {
        ticks.push({
          value: opt.expandToNicedExtent ? round(lastNiceTick + interval, intervalPrecision) : extent[1]
        });
      }
      if (brkAvailable) {
        scaleBreakHelper.pruneTicksByBreak(opt.pruneByBreak, ticks, brk.breaks, function(item) {
          return item.value;
        }, cfg.interval, extent);
      }
      if (brkAvailable && opt.breakTicks !== "none") {
        scaleBreakHelper.addBreaksToTicks(ticks, brk.breaks, extent);
      }
      return ticks;
    };
    IntervalScale2.prototype.getMinorTicks = function(splitNumber) {
      return getMinorTicks(this, splitNumber, getBreaksUnsafe(this), this._cfg.interval);
    };
    IntervalScale2.prototype.getLabel = function(tick, opt) {
      if (tick == null) {
        return "";
      }
      var precision = opt && opt.precision;
      if (precision == null) {
        precision = getPrecision(tick.value) || 0;
      } else if (precision === "auto") {
        precision = this._cfg.intervalPrecision;
      }
      var dataNum = round(tick.value, precision, true);
      return addCommas(dataNum);
    };
    IntervalScale2.type = "interval";
    return IntervalScale2;
  })(Scale_default)
);
Scale_default.registerClass(IntervalScale);
var Interval_default = IntervalScale;

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/scale/Time.js
var bisect = function(a, x, lo, hi) {
  while (lo < hi) {
    var mid = lo + hi >>> 1;
    if (a[mid][1] < x) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
};
var TimeScale = (
  /** @class */
  (function(_super) {
    __extends(TimeScale2, _super);
    function TimeScale2(setting) {
      var _this = _super.call(this) || this;
      _this.type = "time";
      _this.parse = TimeScale2.parse;
      _this._locale = setting.locale;
      _this._useUTC = setting.useUTC;
      _this._interval = 0;
      var breakParsed = simplyParseBreakOption(_this, setting);
      var res = initBreakOrLinearMapper(_this, breakParsed, null);
      _this.brk = res.brk;
      return _this;
    }
    TimeScale2.prototype.getLabel = function(tick) {
      return format(tick.value, fullLeveledFormatter[getDefaultFormatPrecisionOfInterval(getPrimaryTimeUnit(this._minLevelUnit))] || fullLeveledFormatter.second, this._useUTC, this._locale);
    };
    TimeScale2.prototype.getFormattedLabel = function(tick, idx, labelFormatter) {
      return leveledFormat(tick, idx, labelFormatter, this._locale, this._useUTC);
    };
    TimeScale2.prototype.getTicks = function(opt) {
      opt = opt || {};
      var interval = this._interval;
      var extent = getScaleExtentForTickUnsafe(this);
      var scaleBreakHelper = getScaleBreakHelper();
      var brk = this.brk;
      var brkAvailable = scaleBreakHelper && brk;
      var ticks = [];
      if (!interval) {
        return ticks;
      }
      var useUTC = this._useUTC;
      if (brkAvailable && opt.breakTicks === "only_break") {
        getScaleBreakHelper().addBreaksToTicks(ticks, brk.breaks, extent);
        return ticks;
      }
      ticks = createIntervalTicks(this._minLevelUnit, this._approxInterval, useUTC, extent, getScaleLinearSpanEffective(this), brk);
      var upperUnitIndex = primaryTimeUnits.length - 1;
      var maxLevel = 0;
      each(ticks, function(tick) {
        if (tick.time) {
          upperUnitIndex = Math.min(upperUnitIndex, indexOf(primaryTimeUnits, tick.time.upperTimeUnit));
          maxLevel = Math.max(maxLevel, tick.time.level);
        }
      });
      if (brkAvailable) {
        getScaleBreakHelper().pruneTicksByBreak(opt.pruneByBreak, ticks, brk.breaks, function(item) {
          return item.value;
        }, this._approxInterval, extent);
      }
      if (brkAvailable && opt.breakTicks !== "none") {
        getScaleBreakHelper().addBreaksToTicks(ticks, brk.breaks, extent, function(trimmedBrk) {
          var lowerBrkUnitIndex = Math.max(indexOf(primaryTimeUnits, getUnitFromValue(trimmedBrk.vmin, useUTC)), indexOf(primaryTimeUnits, getUnitFromValue(trimmedBrk.vmax, useUTC)));
          var upperBrkUnitIndex = 0;
          for (var unitIdx = 0; unitIdx < primaryTimeUnits.length; unitIdx++) {
            if (!isPrimaryUnitValueAndGreaterSame(primaryTimeUnits[unitIdx], trimmedBrk.vmin, trimmedBrk.vmax, useUTC)) {
              upperBrkUnitIndex = unitIdx;
              break;
            }
          }
          var upperIdx = Math.min(upperBrkUnitIndex, upperUnitIndex);
          var lowerIdx = Math.max(upperIdx, lowerBrkUnitIndex);
          return {
            level: maxLevel,
            lowerTimeUnit: primaryTimeUnits[lowerIdx],
            upperTimeUnit: primaryTimeUnits[upperIdx]
          };
        });
      }
      return ticks;
    };
    TimeScale2.prototype.getMinorTicks = function(splitNumber) {
      return getMinorTicks(this, splitNumber, getBreaksUnsafe(this), this._interval);
    };
    TimeScale2.prototype.setTimeInterval = function(opt) {
      this._interval = opt.interval;
      this._approxInterval = opt.approxInterval;
      this._minLevelUnit = opt.minLevelUnit;
    };
    TimeScale2.parse = function(val) {
      return isNumber(val) ? Math.round(val) : +parseDate(val);
    };
    TimeScale2.type = "time";
    return TimeScale2;
  })(Scale_default)
);
var scaleIntervals = [
  // Format                           interval
  ["second", ONE_SECOND],
  ["minute", ONE_MINUTE],
  ["hour", ONE_HOUR],
  ["quarter-day", ONE_HOUR * 6],
  ["half-day", ONE_HOUR * 12],
  ["day", ONE_DAY * 1.2],
  ["half-week", ONE_DAY * 3.5],
  ["week", ONE_DAY * 7],
  ["month", ONE_DAY * 31],
  ["quarter", ONE_DAY * 95],
  ["half-year", ONE_YEAR / 2],
  ["year", ONE_YEAR]
  // 1Y
];
function isPrimaryUnitValueAndGreaterSame(unit, valueA, valueB, isUTC) {
  return roundTime(new Date(valueA), unit, isUTC).getTime() === roundTime(new Date(valueB), unit, isUTC).getTime();
}
function getDateInterval(approxInterval, daysInMonth) {
  approxInterval /= ONE_DAY;
  return approxInterval > 16 ? 16 : approxInterval > 7.5 ? 7 : approxInterval > 3.5 ? 4 : approxInterval > 1.5 ? 2 : 1;
}
function getMonthInterval(approxInterval) {
  var APPROX_ONE_MONTH = 30 * ONE_DAY;
  approxInterval /= APPROX_ONE_MONTH;
  return approxInterval > 6 ? 6 : approxInterval > 3 ? 3 : approxInterval > 2 ? 2 : 1;
}
function getHourInterval(approxInterval) {
  approxInterval /= ONE_HOUR;
  return approxInterval > 12 ? 12 : approxInterval > 6 ? 6 : approxInterval > 3.5 ? 4 : approxInterval > 2 ? 2 : 1;
}
function getMinutesAndSecondsInterval(approxInterval, isMinutes) {
  approxInterval /= isMinutes ? ONE_MINUTE : ONE_SECOND;
  return approxInterval > 30 ? 30 : approxInterval > 20 ? 20 : approxInterval > 15 ? 15 : approxInterval > 10 ? 10 : approxInterval > 5 ? 5 : approxInterval > 2 ? 2 : 1;
}
function getMillisecondsInterval(approxInterval) {
  return mathMax(nice(approxInterval, true), 1);
}
function getFirstTimestampOfUnit(timestamp, unitName, isUTC) {
  var upperUnitIdx = Math.max(0, indexOf(primaryTimeUnits, unitName) - 1);
  return roundTime(new Date(timestamp), primaryTimeUnits[upperUnitIdx], isUTC).getTime();
}
function createEstimateNiceMultiple(setMethodName, dateMethodInterval) {
  var tmpDate = /* @__PURE__ */ new Date(0);
  tmpDate[setMethodName](1);
  var tmpTime = tmpDate.getTime();
  tmpDate[setMethodName](1 + dateMethodInterval);
  var approxTimeInterval = tmpDate.getTime() - tmpTime;
  return function(tickVal, targetValue) {
    return Math.max(0, Math.round((targetValue - tickVal) / approxTimeInterval));
  };
}
function createIntervalTicks(bottomUnitName, approxInterval, isUTC, extent, innermostSpan, brk) {
  var safeLimit = 3e3;
  var unitNames = timeUnits;
  var iter = 0;
  function addTicksInSpan(interval, minTimestamp, maxTimestamp, getMethodName, setMethodName, isDate, out2) {
    var estimateNiceMultiple = createEstimateNiceMultiple(setMethodName, interval);
    var dateTime = minTimestamp;
    var date = new Date(dateTime);
    while (dateTime < maxTimestamp && dateTime <= extent[1]) {
      out2.push({
        value: dateTime
      });
      if (iter++ > safeLimit) {
        if (false) {
          warn('Exceed safe limit in TimeScale["getTicks"].');
        }
        break;
      }
      date[setMethodName](date[getMethodName]() + interval);
      dateTime = date.getTime();
      if (brk) {
        var moreMultiple = brk.calcNiceTickMultiple(dateTime, estimateNiceMultiple);
        if (moreMultiple > 0) {
          date[setMethodName](date[getMethodName]() + moreMultiple * interval);
          dateTime = date.getTime();
        }
      }
    }
    out2.push({
      value: dateTime,
      // extent[1] should be added; deduplication will be performed later.
      notAdd: dateTime > extent[1]
    });
  }
  function addLevelTicks(unitName, lastLevelTicks, levelTicks2) {
    var newAddedTicks = [];
    var isFirstLevel = !lastLevelTicks.length;
    if (isPrimaryUnitValueAndGreaterSame(getPrimaryTimeUnit(unitName), extent[0], extent[1], isUTC)) {
      return;
    }
    if (isFirstLevel) {
      lastLevelTicks = [{
        value: getFirstTimestampOfUnit(extent[0], unitName, isUTC)
      }, {
        value: extent[1]
      }];
    }
    for (var i2 = 0; i2 < lastLevelTicks.length - 1; i2++) {
      var startTick = lastLevelTicks[i2].value;
      var endTick = lastLevelTicks[i2 + 1].value;
      if (startTick === endTick) {
        continue;
      }
      var interval = void 0;
      var getterName = void 0;
      var setterName = void 0;
      var isDate = false;
      switch (unitName) {
        case "year":
          interval = Math.max(1, Math.round(approxInterval / ONE_DAY / 365));
          getterName = fullYearGetterName(isUTC);
          setterName = fullYearSetterName(isUTC);
          break;
        case "half-year":
        case "quarter":
        case "month":
          interval = getMonthInterval(approxInterval);
          getterName = monthGetterName(isUTC);
          setterName = monthSetterName(isUTC);
          break;
        case "week":
        // PENDING If week is added. Ignore day.
        case "half-week":
        case "day":
          interval = getDateInterval(approxInterval, 31);
          getterName = dateGetterName(isUTC);
          setterName = dateSetterName(isUTC);
          isDate = true;
          break;
        case "half-day":
        case "quarter-day":
        case "hour":
          interval = getHourInterval(approxInterval);
          getterName = hoursGetterName(isUTC);
          setterName = hoursSetterName(isUTC);
          break;
        case "minute":
          interval = getMinutesAndSecondsInterval(approxInterval, true);
          getterName = minutesGetterName(isUTC);
          setterName = minutesSetterName(isUTC);
          break;
        case "second":
          interval = getMinutesAndSecondsInterval(approxInterval, false);
          getterName = secondsGetterName(isUTC);
          setterName = secondsSetterName(isUTC);
          break;
        case "millisecond":
          interval = getMillisecondsInterval(approxInterval);
          getterName = millisecondsGetterName(isUTC);
          setterName = millisecondsSetterName(isUTC);
          break;
      }
      if (endTick >= extent[0] && startTick <= extent[1]) {
        addTicksInSpan(interval, startTick, endTick, getterName, setterName, isDate, newAddedTicks);
      }
      if (unitName === "year" && levelTicks2.length > 1 && i2 === 0) {
        levelTicks2.unshift({
          value: levelTicks2[0].value - interval
        });
      }
    }
    for (var i2 = 0; i2 < newAddedTicks.length; i2++) {
      levelTicks2.push(newAddedTicks[i2]);
    }
  }
  var levelsTicks = [];
  var currentLevelTicks = [];
  var tickCount = 0;
  var lastLevelTickCount = 0;
  for (var i = 0; i < unitNames.length; ++i) {
    var primaryTimeUnit = getPrimaryTimeUnit(unitNames[i]);
    if (!isPrimaryTimeUnit(unitNames[i])) {
      continue;
    }
    addLevelTicks(unitNames[i], levelsTicks[levelsTicks.length - 1] || [], currentLevelTicks);
    var nextPrimaryTimeUnit = unitNames[i + 1] ? getPrimaryTimeUnit(unitNames[i + 1]) : null;
    if (primaryTimeUnit !== nextPrimaryTimeUnit) {
      if (currentLevelTicks.length) {
        lastLevelTickCount = tickCount;
        currentLevelTicks.sort(function(a, b) {
          return a.value - b.value;
        });
        var levelTicksRemoveDuplicated = [];
        for (var i_1 = 0; i_1 < currentLevelTicks.length; ++i_1) {
          var tickValue = currentLevelTicks[i_1].value;
          if (i_1 === 0 || currentLevelTicks[i_1 - 1].value !== tickValue) {
            levelTicksRemoveDuplicated.push(currentLevelTicks[i_1]);
            if (tickValue >= extent[0] && tickValue <= extent[1]) {
              tickCount++;
            }
          }
        }
        var targetTickNum = innermostSpan / approxInterval;
        if (tickCount > targetTickNum * 1.5 && lastLevelTickCount > targetTickNum / 1.5) {
          break;
        }
        levelsTicks.push(levelTicksRemoveDuplicated);
        if (tickCount > targetTickNum || bottomUnitName === unitNames[i]) {
          break;
        }
      }
      currentLevelTicks = [];
    }
  }
  var levelsTicksInExtent = filter(map(levelsTicks, function(levelTicks2) {
    return filter(levelTicks2, function(tick) {
      return tick.value >= extent[0] && tick.value <= extent[1] && !tick.notAdd;
    });
  }), function(levelTicks2) {
    return levelTicks2.length > 0;
  });
  var maxLevel = levelsTicksInExtent.length - 1;
  var ticks = [];
  for (var i = 0; i < levelsTicksInExtent.length; ++i) {
    var levelTicks = levelsTicksInExtent[i];
    for (var k = 0; k < levelTicks.length; ++k) {
      var unit = getUnitFromValue(levelTicks[k].value, isUTC);
      ticks.push({
        value: levelTicks[k].value,
        time: {
          level: maxLevel - i,
          upperTimeUnit: unit,
          lowerTimeUnit: unit
        }
      });
    }
  }
  removeDuplicates(ticks, removeDuplicatesGetKeyFromValueProp, null);
  ticks.sort(function(a, b) {
    return a.value - b.value;
  });
  var currMinTick = ticks[0];
  var currMaxTick = ticks[ticks.length - 1];
  var extent0Unit = getUnitFromValue(extent[0], isUTC);
  var extent1Unit = getUnitFromValue(extent[1], isUTC);
  if (!currMinTick || currMinTick.value > extent[0]) {
    ticks.unshift({
      value: extent[0],
      time: {
        level: 0,
        upperTimeUnit: extent0Unit,
        lowerTimeUnit: extent0Unit
      },
      notNice: true
    });
  }
  if (!currMaxTick || currMaxTick.value < extent[1]) {
    ticks.push({
      value: extent[1],
      time: {
        level: 0,
        upperTimeUnit: extent1Unit,
        lowerTimeUnit: extent1Unit
      },
      notNice: true
    });
  }
  return ticks;
}
var calcNiceForTimeScale = function(scale3, opt) {
  var extent = scale3.getExtent();
  if (extent[0] === extent[1]) {
    extent[0] -= ONE_DAY;
    extent[1] += ONE_DAY;
  }
  if (extent[1] === -Infinity && extent[0] === Infinity) {
    var d = /* @__PURE__ */ new Date();
    extent[1] = +new Date(d.getFullYear(), d.getMonth(), d.getDate());
    extent[0] = extent[1] - ONE_DAY;
  }
  scale3.setExtent(extent[0], extent[1]);
  var splitNumber = ensureValidSplitNumber(opt.splitNumber, 10);
  var approxInterval = getScaleLinearSpanEffective(scale3) / splitNumber;
  var minInterval = opt.minInterval;
  var maxInterval = opt.maxInterval;
  if (minInterval != null && approxInterval < minInterval) {
    approxInterval = minInterval;
  }
  if (maxInterval != null && approxInterval > maxInterval) {
    approxInterval = maxInterval;
  }
  var scaleIntervalsLen = scaleIntervals.length;
  var idx = Math.min(bisect(scaleIntervals, approxInterval, 0, scaleIntervalsLen), scaleIntervalsLen - 1);
  var interval = scaleIntervals[idx][1];
  var minLevelUnit = scaleIntervals[Math.max(idx - 1, 0)][0];
  scale3.setTimeInterval({
    approxInterval,
    interval,
    minLevelUnit
  });
};
Scale_default.registerClass(TimeScale);
var Time_default = TimeScale;

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/scale/Log.js
var LOOKUP_IDX_EXTENT_START = 0;
var LOOKUP_IDX_EXTENT_END = 1;
var LOOKUP_IDX_BREAK_START = 2;
var LogScale = (
  /** @class */
  (function(_super) {
    __extends(LogScale2, _super);
    function LogScale2(setting) {
      var _this = _super.call(this) || this;
      _this.type = "log";
      _this.parse = Interval_default.parse;
      _this.base = setting.logBase || 10;
      var lookupFrom = [];
      var lookupTo = [];
      var lookup = _this._lookup = {
        from: lookupFrom,
        to: lookupTo
      };
      lookupFrom[LOOKUP_IDX_EXTENT_START] = lookupFrom[LOOKUP_IDX_EXTENT_END] = lookupTo[LOOKUP_IDX_EXTENT_START] = lookupTo[LOOKUP_IDX_EXTENT_END] = NaN;
      decorateScaleMapper(_this, LogScale2.mapperMethods);
      var scaleBreakHelper = getScaleBreakHelper();
      var breakOption = setting.breakOption;
      var out2 = {
        lookup
      };
      if (scaleBreakHelper) {
        scaleBreakHelper.parseAxisBreakOptionInwardTransform(breakOption, _this, {
          noNegative: true
        }, LOOKUP_IDX_BREAK_START, out2);
      }
      _this.powStub = new Interval_default({
        breakParsed: out2.original
      });
      _this.intervalStub = new Interval_default({
        breakParsed: out2.transformed
      });
      enableScaleMapperFreeze(_this, _this.intervalStub);
      return _this;
    }
    LogScale2.prototype.getTicks = function(opt) {
      var base2 = this.base;
      var powStub = this.powStub;
      var scaleBreakHelper = getScaleBreakHelper();
      var intervalStub = this.intervalStub;
      var intervalExtent = intervalStub.getExtent();
      var powExtent = powStub.getExtent();
      var powOpt = {
        lookup: {
          from: intervalExtent,
          to: powExtent
        }
      };
      return map(intervalStub.getTicks(opt || {}), function(tick) {
        var val = tick.value;
        var powVal = logScalePowTick(val, base2, powOpt);
        var vBreak;
        if (scaleBreakHelper) {
          var brkPowResult = scaleBreakHelper.getTicksBreakOutwardTransform(this, tick, getBreaksUnsafe(powStub), this._lookup);
          if (brkPowResult) {
            vBreak = brkPowResult.vBreak;
            powVal = brkPowResult.tickVal;
          }
        }
        return {
          value: powVal,
          "break": vBreak
        };
      }, this);
    };
    LogScale2.prototype.getMinorTicks = function(splitNumber) {
      return getMinorTicks(
        this,
        splitNumber,
        getBreaksUnsafe(this.powStub),
        // NOTE: minor ticks are in the log scale value to visually hint users "logarithm".
        this.intervalStub.getConfig().interval
      );
    };
    LogScale2.prototype.getLabel = function(data, opt) {
      return this.intervalStub.getLabel(data, opt);
    };
    LogScale2.type = "log";
    LogScale2.mapperMethods = {
      needTransform: function() {
        return true;
      },
      normalize: function(val) {
        return this.intervalStub.normalize(logScaleLogTick(val, this.base));
      },
      scale: function(val) {
        return logScalePowTick(this.intervalStub.scale(val), this.base, null);
      },
      transformIn: function(val, opt) {
        val = logScaleLogTick(val, this.base);
        return opt && opt.depth === SCALE_MAPPER_DEPTH_OUT_OF_BREAK ? val : this.intervalStub.transformIn(val, opt);
      },
      transformOut: function(val, opt) {
        var depth = opt ? opt.depth : null;
        tmpTransformOutOpt1.depth = depth;
        tmpTransformOutOpt2.lookup = this._lookup;
        return logScalePowTick(depth === SCALE_MAPPER_DEPTH_OUT_OF_BREAK ? val : this.intervalStub.transformOut(val, tmpTransformOutOpt1), this.base, tmpTransformOutOpt2);
      },
      contain: function(val) {
        return this.powStub.contain(val);
      },
      /**
       * NOTICE: The caller should ensure `start` and `end` are both non-negative.
       */
      setExtent: function(start2, end2) {
        this.setExtent2(SCALE_EXTENT_KIND_EFFECTIVE, start2, end2);
      },
      setExtent2: function(kind, start2, end2) {
        if (!isValidBoundsForExtent(start2, end2) || start2 <= 0 || end2 <= 0) {
          return;
        }
        var lookupTo = tmpNotUsedArr;
        var lookupFrom = tmpNotUsedArr;
        if (kind === SCALE_EXTENT_KIND_EFFECTIVE) {
          var lookup = this._lookup;
          lookupTo = lookup.to;
          lookupFrom = lookup.from;
        }
        this.powStub.setExtent2(kind, lookupTo[LOOKUP_IDX_EXTENT_START] = start2, lookupTo[LOOKUP_IDX_EXTENT_END] = end2);
        var base2 = this.base;
        this.intervalStub.setExtent2(kind, lookupFrom[LOOKUP_IDX_EXTENT_START] = logScaleLogTick(start2, base2), lookupFrom[LOOKUP_IDX_EXTENT_END] = logScaleLogTick(end2, base2));
      },
      getFilter: function() {
        return {
          g: 0
        };
      },
      sanitize: function(value, dataExtent) {
        if (isValidBoundsForExtent(dataExtent[0], dataExtent[1]) && isNullableNumberFinite(value) && value <= 0) {
          value = dataExtent[0];
        }
        return value;
      },
      getDefaultStartValue: function() {
        return 1;
      },
      getExtent: function() {
        return this.powStub.getExtent();
      },
      getExtentUnsafe: function(kind, depth) {
        return depth === null ? this.powStub.getExtentUnsafe(kind, null) : this.intervalStub.getExtentUnsafe(kind, depth);
      }
    };
    return LogScale2;
  })(Scale_default)
);
Scale_default.registerClass(LogScale);
var tmpTransformOutOpt1 = {};
var tmpTransformOutOpt2 = {};
var tmpNotUsedArr = [];
var Log_default = LogScale;

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/coord/axisCommonTypes.js
var AXIS_TYPES = {
  value: 1,
  category: 1,
  time: 1,
  log: 1
};

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/data/helper/SeriesDataSchema.js
var inner3 = makeInner();
var dimTypeShort = {
  float: "f",
  int: "i",
  ordinal: "o",
  number: "n",
  time: "t"
};
var SeriesDataSchema = (
  /** @class */
  (function() {
    function SeriesDataSchema2(opt) {
      this.dimensions = opt.dimensions;
      this._dimOmitted = opt.dimensionOmitted;
      this.source = opt.source;
      this._fullDimCount = opt.fullDimensionCount;
      this._updateDimOmitted(opt.dimensionOmitted);
    }
    SeriesDataSchema2.prototype.isDimensionOmitted = function() {
      return this._dimOmitted;
    };
    SeriesDataSchema2.prototype._updateDimOmitted = function(dimensionOmitted) {
      this._dimOmitted = dimensionOmitted;
      if (!dimensionOmitted) {
        return;
      }
      if (!this._dimNameMap) {
        this._dimNameMap = ensureSourceDimNameMap(this.source);
      }
    };
    SeriesDataSchema2.prototype.getSourceDimensionIndex = function(dimName) {
      return retrieve2(this._dimNameMap.get(dimName), -1);
    };
    SeriesDataSchema2.prototype.getSourceDimension = function(dimIndex) {
      var dimensionsDefine = this.source.dimensionsDefine;
      if (dimensionsDefine) {
        return dimensionsDefine[dimIndex];
      }
    };
    SeriesDataSchema2.prototype.makeStoreSchema = function() {
      var dimCount = this._fullDimCount;
      var willRetrieveDataByName = shouldRetrieveDataByName(this.source);
      var makeHashStrict = !shouldOmitUnusedDimensions(dimCount);
      var dimHash = "";
      var dims = [];
      for (var fullDimIdx = 0, seriesDimIdx = 0; fullDimIdx < dimCount; fullDimIdx++) {
        var property = void 0;
        var type = void 0;
        var ordinalMeta = void 0;
        var seriesDimDef = this.dimensions[seriesDimIdx];
        if (seriesDimDef && seriesDimDef.storeDimIndex === fullDimIdx) {
          property = willRetrieveDataByName ? seriesDimDef.name : null;
          type = seriesDimDef.type;
          ordinalMeta = seriesDimDef.ordinalMeta;
          seriesDimIdx++;
        } else {
          var sourceDimDef = this.getSourceDimension(fullDimIdx);
          if (sourceDimDef) {
            property = willRetrieveDataByName ? sourceDimDef.name : null;
            type = sourceDimDef.type;
          }
        }
        dims.push({
          property,
          type,
          ordinalMeta
        });
        if (willRetrieveDataByName && property != null && (!seriesDimDef || !seriesDimDef.isCalculationCoord)) {
          dimHash += makeHashStrict ? property.replace(/\`/g, "`1").replace(/\$/g, "`2") : property;
        }
        dimHash += "$";
        dimHash += dimTypeShort[type] || "f";
        if (ordinalMeta) {
          dimHash += ordinalMeta.uid;
        }
        dimHash += "$";
      }
      var source = this.source;
      var hash = [source.seriesLayoutBy, source.startIndex, dimHash].join("$$");
      return {
        dimensions: dims,
        hash
      };
    };
    SeriesDataSchema2.prototype.makeOutputDimensionNames = function() {
      var result = [];
      for (var fullDimIdx = 0, seriesDimIdx = 0; fullDimIdx < this._fullDimCount; fullDimIdx++) {
        var name_1 = void 0;
        var seriesDimDef = this.dimensions[seriesDimIdx];
        if (seriesDimDef && seriesDimDef.storeDimIndex === fullDimIdx) {
          if (!seriesDimDef.isCalculationCoord) {
            name_1 = seriesDimDef.name;
          }
          seriesDimIdx++;
        } else {
          var sourceDimDef = this.getSourceDimension(fullDimIdx);
          if (sourceDimDef) {
            name_1 = sourceDimDef.name;
          }
        }
        result.push(name_1);
      }
      return result;
    };
    SeriesDataSchema2.prototype.appendCalculationDimension = function(dimDef) {
      this.dimensions.push(dimDef);
      dimDef.isCalculationCoord = true;
      this._fullDimCount++;
      this._updateDimOmitted(true);
    };
    return SeriesDataSchema2;
  })()
);
function createDimNameMap(dimsDef) {
  var dataDimNameMap = createHashMap();
  for (var i = 0; i < (dimsDef || []).length; i++) {
    var dimDefItemRaw = dimsDef[i];
    var userDimName = isObject(dimDefItemRaw) ? dimDefItemRaw.name : dimDefItemRaw;
    if (userDimName != null && dataDimNameMap.get(userDimName) == null) {
      dataDimNameMap.set(userDimName, i);
    }
  }
  return dataDimNameMap;
}
function ensureSourceDimNameMap(source) {
  var innerSource = inner3(source);
  return innerSource.dimNameMap || (innerSource.dimNameMap = createDimNameMap(source.dimensionsDefine));
}
function shouldOmitUnusedDimensions(dimCount) {
  return dimCount > 30;
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/data/helper/dataStackHelper.js
function isDimensionStacked(data, stackedDim) {
  return !!stackedDim && stackedDim === data.getCalculationInfo("stackedDimension");
}
function getStackedDimension(data, targetDim) {
  return isDimensionStacked(data, targetDim) ? data.getCalculationInfo("stackResultDimension") : targetDim;
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/coord/axisHelper.js
var axisInner = makeInner();
function determineAxisType(model) {
  var type = model.get("type");
  if (
    // In ec option, `xxxAxis.type` may be undefined.
    type == null || !hasOwn(AXIS_TYPES, type) && !Scale_default.getClass(type)
  ) {
    type = "value";
  }
  return type;
}
function createScaleByModel(model, type, coordSysSupportAxisBreaks) {
  var breakHelper = getScaleBreakHelper();
  var breakOption;
  if (breakHelper) {
    breakOption = retrieveAxisBreaksOption(model, type, coordSysSupportAxisBreaks);
  }
  switch (type) {
    case "category":
      return new Ordinal_default({
        ordinalMeta: model.getOrdinalMeta ? model.getOrdinalMeta() : model.getCategories(),
        extent: initExtentForUnion()
      });
    case "time":
      return new Time_default({
        locale: model.ecModel.getLocaleModel(),
        useUTC: model.ecModel.get("useUTC"),
        breakOption
      });
    case "log":
      return new Log_default({
        logBase: model.get("logBase"),
        breakOption
      });
    case "value":
      return new Interval_default({
        breakOption
      });
    default:
      return new (Scale_default.getClass(type) || Interval_default)({});
  }
}
function getScaleValuePositionKind(scale3, value, considerMappingExtent) {
  var dataExtent = considerMappingExtent ? getScaleExtentForMappingUnsafe(scale3, null) : scale3.getExtentUnsafe(SCALE_EXTENT_KIND_EFFECTIVE, null);
  var min3 = dataExtent[0];
  var max3 = dataExtent[1];
  return !isValidBoundsForExtent(min3, max3) ? SCALE_VALUE_POSITION_KIND_OUTSIDE : min3 === value || max3 === value ? SCALE_VALUE_POSITION_KIND_EDGE : min3 < value && max3 > value ? SCALE_VALUE_POSITION_KIND_INSIDE : SCALE_VALUE_POSITION_KIND_OUTSIDE;
}
var SCALE_VALUE_POSITION_KIND_INSIDE = 1;
var SCALE_VALUE_POSITION_KIND_EDGE = 2;
var SCALE_VALUE_POSITION_KIND_OUTSIDE = 3;
function discourageOnAxisZero(axis) {
  axisInner(axis).noOnMyZero = true;
}
function isOnAxisZeroDiscouraged(axis) {
  return axisInner(axis).noOnMyZero;
}
function makeLabelFormatter(axis) {
  var labelFormatter = axis.getLabelModel().get("formatter");
  if (axis.type === "time") {
    var parsed_1 = parseTimeAxisLabelFormatter(labelFormatter);
    return function(tick, idx) {
      return axis.scale.getFormattedLabel(tick, idx, parsed_1);
    };
  } else if (isString(labelFormatter)) {
    return function(tick) {
      var label = axis.scale.getLabel(tick);
      var text = labelFormatter.replace("{value}", label != null ? label : "");
      return text;
    };
  } else if (isFunction(labelFormatter)) {
    if (axis.type === "category") {
      return function(tick, idx) {
        return labelFormatter(
          getAxisRawValue(axis, tick),
          tick.value - axis.scale.getExtent()[0],
          null
          // Using `null` just for backward compat.
        );
      };
    }
    var scaleBreakHelper_1 = getScaleBreakHelper();
    return function(tick, idx) {
      var extra = null;
      if (scaleBreakHelper_1) {
        extra = scaleBreakHelper_1.makeAxisLabelFormatterParamBreak(extra, tick["break"]);
      }
      return labelFormatter(getAxisRawValue(axis, tick), idx, extra);
    };
  } else {
    return function(tick) {
      return axis.scale.getLabel(tick);
    };
  }
}
function getAxisRawValue(axis, tick) {
  var scale3 = axis.scale;
  return isOrdinalScale(scale3) ? scale3.getLabel(tick) : tick.value;
}
function getOptionCategoryInterval(model) {
  var interval = model.get("interval");
  return interval == null ? "auto" : interval;
}
function shouldShowAllLabels(axis) {
  return axis.type === "category" && getOptionCategoryInterval(axis.getLabelModel()) === 0;
}
function getDataDimensionsOnAxis(data, axisDim) {
  var dataDimMap = {};
  each(data.mapDimensionsAll(axisDim), function(dataDim) {
    dataDimMap[getStackedDimension(data, dataDim)] = true;
  });
  return keys(dataDimMap);
}
function isNameLocationCenter(nameLocation) {
  return nameLocation === "middle" || nameLocation === "center";
}
function shouldAxisShow(axisModel) {
  return axisModel.getShallow("show");
}
function retrieveAxisBreaksOption(model, axisType, coordSysSupportAxisBreaks) {
  var option = model.get("breaks", true);
  if (option != null) {
    if (!getScaleBreakHelper()) {
      if (false) {
        error('Must `import {AxisBreak} from "echarts/features.js"; use(AxisBreak);` first if using breaks option.');
      }
      return void 0;
    }
    if (!coordSysSupportAxisBreaks || !isAxisTypeSupportAxisBreak(axisType)) {
      if (false) {
        var axisInfo = model instanceof Component_default ? " " + model.type + "[" + model.componentIndex + "]" : "";
        error("Axis" + axisInfo + " does not support break.");
      }
      return void 0;
    }
    return option;
  }
}
function isAxisTypeSupportAxisBreak(axisType) {
  return axisType !== "category";
}
function updateIntervalOrLogScaleForNiceOrAligned(scale3, fixMinMax, oldIntervalExtent, newIntervalExtent, oldOutermostExtent, cfg) {
  var isTargetLogScale = isLogScale(scale3);
  var intervalStub = isTargetLogScale ? scale3.intervalStub : scale3;
  intervalStub.setExtent(newIntervalExtent[0], newIntervalExtent[1]);
  if (isTargetLogScale) {
    var powStub = scale3.powStub;
    var opt = {
      depth: SCALE_MAPPER_DEPTH_OUT_OF_BREAK
    };
    var minPow = scale3.transformOut(newIntervalExtent[0], opt);
    var maxPow = scale3.transformOut(newIntervalExtent[1], opt);
    var extentChanged = extentDiffers(oldIntervalExtent, newIntervalExtent);
    if (fixMinMax[0] && !extentChanged[0]) {
      minPow = oldOutermostExtent[0];
    }
    if (fixMinMax[1] && !extentChanged[1]) {
      maxPow = oldOutermostExtent[1];
    }
    powStub.setExtent(minPow, maxPow);
  }
  intervalStub.setConfig(cfg);
}
function getTickValueOutermost(scale3, tick) {
  return isOrdinalScale(scale3) ? scale3.getRawOrdinalNumber(tick.value) : tick.value;
}
function isAxisOnBand(scale3, axisModel) {
  return isOrdinalScale(scale3) && !!axisModel.get("boundaryGap");
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/coord/cartesian/Cartesian.js
var Cartesian = (
  /** @class */
  (function() {
    function Cartesian2(name) {
      this.type = "cartesian";
      this._dimList = [];
      this._axes = {};
      this.name = name || "";
    }
    Cartesian2.prototype.getAxis = function(dim) {
      return this._axes[dim];
    };
    Cartesian2.prototype.getAxes = function() {
      return map(this._dimList, function(dim) {
        return this._axes[dim];
      }, this);
    };
    Cartesian2.prototype.getAxesByScale = function(scaleType) {
      scaleType = scaleType.toLowerCase();
      return filter(this.getAxes(), function(axis) {
        return axis.scale.type === scaleType;
      });
    };
    Cartesian2.prototype.addAxis = function(axis) {
      var dim = axis.dim;
      this._axes[dim] = axis;
      this._dimList.push(dim);
    };
    return Cartesian2;
  })()
);
var Cartesian_default = Cartesian;

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/coord/cartesian/GridModel.js
var OUTER_BOUNDS_DEFAULT = {
  left: 0,
  right: 0,
  top: 0,
  bottom: 0
};
var OUTER_BOUNDS_CLAMP_DEFAULT = ["25%", "25%"];
var COORD_SYS_TYPE_CARTESIAN_2D = "cartesian2d";
var GridModel = (
  /** @class */
  (function(_super) {
    __extends(GridModel2, _super);
    function GridModel2() {
      return _super !== null && _super.apply(this, arguments) || this;
    }
    GridModel2.prototype.mergeDefaultAndTheme = function(option, ecModel) {
      var outerBoundsCp = getLayoutParams(option.outerBounds);
      _super.prototype.mergeDefaultAndTheme.apply(this, arguments);
      if (outerBoundsCp && option.outerBounds) {
        mergeLayoutParam(option.outerBounds, outerBoundsCp);
      }
    };
    GridModel2.prototype.mergeOption = function(newOption, ecModel) {
      _super.prototype.mergeOption.apply(this, arguments);
      if (this.option.outerBounds && newOption.outerBounds) {
        mergeLayoutParam(this.option.outerBounds, newOption.outerBounds);
      }
    };
    GridModel2.type = "grid";
    GridModel2.dependencies = ["xAxis", "yAxis"];
    GridModel2.layoutMode = "box";
    GridModel2.defaultOption = {
      show: false,
      // zlevel: 0,
      z: 0,
      left: "15%",
      top: 65,
      right: "10%",
      bottom: 80,
      // If grid size contain label
      containLabel: false,
      outerBoundsMode: "auto",
      outerBounds: OUTER_BOUNDS_DEFAULT,
      outerBoundsContain: "all",
      outerBoundsClampWidth: OUTER_BOUNDS_CLAMP_DEFAULT[0],
      outerBoundsClampHeight: OUTER_BOUNDS_CLAMP_DEFAULT[1],
      // width: {totalWidth} - left - right,
      // height: {totalHeight} - top - bottom,
      backgroundColor: tokens_default.color.transparent,
      borderWidth: 1,
      borderColor: tokens_default.color.neutral30
    };
    return GridModel2;
  })(Component_default)
);

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/coord/cartesian/Cartesian2D.js
var cartesian2DDimensions = ["x", "y"];
function canCalculateAffineTransform(scale3) {
  return (scale3.type === "interval" || scale3.type === "time") && !hasBreaks(scale3);
}
var Cartesian2D = (
  /** @class */
  (function(_super) {
    __extends(Cartesian2D2, _super);
    function Cartesian2D2() {
      var _this = _super !== null && _super.apply(this, arguments) || this;
      _this.type = COORD_SYS_TYPE_CARTESIAN_2D;
      _this.dimensions = cartesian2DDimensions;
      return _this;
    }
    Cartesian2D2.prototype.calcAffineTransform = function() {
      this._transform = this._invTransform = null;
      var xAxisScale = this.getAxis("x").scale;
      var yAxisScale = this.getAxis("y").scale;
      if (!canCalculateAffineTransform(xAxisScale) || !canCalculateAffineTransform(yAxisScale)) {
        return;
      }
      var xScaleExtent = getScaleExtentForMappingUnsafe(xAxisScale, null);
      var yScaleExtent = getScaleExtentForMappingUnsafe(yAxisScale, null);
      var start2 = this.dataToPoint([xScaleExtent[0], yScaleExtent[0]]);
      var end2 = this.dataToPoint([xScaleExtent[1], yScaleExtent[1]]);
      var xScaleSpan = xScaleExtent[1] - xScaleExtent[0];
      var yScaleSpan = yScaleExtent[1] - yScaleExtent[0];
      if (!xScaleSpan || !yScaleSpan) {
        return;
      }
      var scaleX = (end2[0] - start2[0]) / xScaleSpan;
      var scaleY = (end2[1] - start2[1]) / yScaleSpan;
      var translateX = start2[0] - xScaleExtent[0] * scaleX;
      var translateY = start2[1] - yScaleExtent[0] * scaleY;
      var m = this._transform = [scaleX, 0, 0, scaleY, translateX, translateY];
      this._invTransform = invert([], m);
    };
    Cartesian2D2.prototype.getBaseAxis = function() {
      return this.getAxesByScale("ordinal")[0] || this.getAxesByScale("time")[0] || this.getAxis("x");
    };
    Cartesian2D2.prototype.containPoint = function(point) {
      var axisX = this.getAxis("x");
      var axisY = this.getAxis("y");
      return axisX.contain(axisX.toLocalCoord(point[0])) && axisY.contain(axisY.toLocalCoord(point[1]));
    };
    Cartesian2D2.prototype.containData = function(data) {
      return this.getAxis("x").containData(data[0]) && this.getAxis("y").containData(data[1]);
    };
    Cartesian2D2.prototype.containZone = function(data1, data2) {
      var zoneDiag1 = this.dataToPoint(data1);
      var zoneDiag2 = this.dataToPoint(data2);
      var area = this.getArea();
      var zone = new BoundingRect_default(zoneDiag1[0], zoneDiag1[1], zoneDiag2[0] - zoneDiag1[0], zoneDiag2[1] - zoneDiag1[1]);
      return area.intersect(zone);
    };
    Cartesian2D2.prototype.dataToPoint = function(data, clamp, out2) {
      out2 = out2 || [];
      var xVal = data[0];
      var yVal = data[1];
      if (this._transform && xVal != null && isFinite(xVal) && yVal != null && isFinite(yVal)) {
        return applyTransform(out2, data, this._transform);
      }
      var xAxis = this.getAxis("x");
      var yAxis = this.getAxis("y");
      out2[0] = xAxis.toGlobalCoord(xAxis.dataToCoord(xVal, clamp));
      out2[1] = yAxis.toGlobalCoord(yAxis.dataToCoord(yVal, clamp));
      return out2;
    };
    Cartesian2D2.prototype.clampData = function(data, out2) {
      var xScale = this.getAxis("x").scale;
      var yScale = this.getAxis("y").scale;
      var xAxisExtent = xScale.getExtent();
      var yAxisExtent = yScale.getExtent();
      var x = xScale.parse(data[0]);
      var y = yScale.parse(data[1]);
      out2 = out2 || [];
      out2[0] = Math.min(Math.max(Math.min(xAxisExtent[0], xAxisExtent[1]), x), Math.max(xAxisExtent[0], xAxisExtent[1]));
      out2[1] = Math.min(Math.max(Math.min(yAxisExtent[0], yAxisExtent[1]), y), Math.max(yAxisExtent[0], yAxisExtent[1]));
      return out2;
    };
    Cartesian2D2.prototype.pointToData = function(point, clamp, out2) {
      out2 = out2 || [];
      if (this._invTransform) {
        return applyTransform(out2, point, this._invTransform);
      }
      var xAxis = this.getAxis("x");
      var yAxis = this.getAxis("y");
      out2[0] = xAxis.coordToData(xAxis.toLocalCoord(point[0]), clamp);
      out2[1] = yAxis.coordToData(yAxis.toLocalCoord(point[1]), clamp);
      return out2;
    };
    Cartesian2D2.prototype.getOtherAxis = function(axis) {
      return this.getAxis(axis.dim === "x" ? "y" : "x");
    };
    Cartesian2D2.prototype.getArea = function(tolerance) {
      tolerance = tolerance || 0;
      var xExtent = this.getAxis("x").getGlobalExtent();
      var yExtent = this.getAxis("y").getGlobalExtent();
      var x = Math.min(xExtent[0], xExtent[1]) - tolerance;
      var y = Math.min(yExtent[0], yExtent[1]) - tolerance;
      var width = Math.max(xExtent[0], xExtent[1]) - x + tolerance;
      var height = Math.max(yExtent[0], yExtent[1]) - y + tolerance;
      return new BoundingRect_default(x, y, width, height);
    };
    return Cartesian2D2;
  })(Cartesian_default)
);
var Cartesian2D_default = Cartesian2D;

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/coord/axisTickLabelBuilder.js
var modelInner = makeInner();
var axisInner2 = makeInner();
var AxisTickLabelComputingKind = {
  estimate: 1,
  determine: 2
};
function createAxisLabelsComputingContext(kind) {
  return {
    out: {
      noPxChangeTryDetermine: []
    },
    kind
  };
}
function createAxisLabels(axis, ctx) {
  var custom = axis.getLabelModel().get("customValues");
  if (custom) {
    var scale_1 = axis.scale;
    return {
      labels: map(parseTickLabelCustomValues(custom, scale_1), function(tick, index) {
        return {
          formattedLabel: makeLabelFormatter(axis)(tick, index),
          rawLabel: scale_1.getLabel(tick),
          tick
        };
      })
    };
  }
  return axis.type === "category" ? makeCategoryLabels(axis, ctx) : makeRealNumberLabels(axis);
}
function createAxisTicks(axis, tickModel, opt) {
  var scale3 = axis.scale;
  var custom = axis.getTickModel().get("customValues");
  if (custom) {
    return {
      ticks: parseTickLabelCustomValues(custom, scale3)
    };
  }
  return axis.type === "category" ? makeCategoryTicks(axis, tickModel) : {
    ticks: scale3.getTicks(opt)
  };
}
function parseTickLabelCustomValues(customValues, scale3) {
  var extent = scale3.getExtent();
  var tickNumbers = [];
  each(customValues, function(val) {
    val = scale3.parse(val);
    if (val >= extent[0] && val <= extent[1]) {
      tickNumbers.push(val);
    }
  });
  removeDuplicates(tickNumbers, removeDuplicatesGetKeyFromItemItself, null);
  asc(tickNumbers);
  return map(tickNumbers, function(tickVal) {
    return {
      value: tickVal
    };
  });
}
function makeCategoryLabels(axis, ctx) {
  var labelModel = axis.getLabelModel();
  var result = makeCategoryLabelsActually(axis, labelModel, ctx);
  return !labelModel.get("show") || axis.scale.isBlank() ? {
    labels: []
  } : result;
}
function makeCategoryLabelsActually(axis, labelModel, ctx) {
  var labelsCache = ensureCategoryLabelCache(axis);
  var optionLabelInterval = getOptionCategoryInterval(labelModel);
  var isEstimate = ctx.kind === AxisTickLabelComputingKind.estimate;
  if (!isEstimate) {
    var result_1 = axisCacheGet(labelsCache, optionLabelInterval);
    if (result_1) {
      return result_1;
    }
  }
  var labels;
  var numericLabelInterval;
  if (isFunction(optionLabelInterval)) {
    labels = makeTicksLabelsByCategoryIntervalNumOrCb(axis, optionLabelInterval, false);
  } else {
    numericLabelInterval = optionLabelInterval === "auto" ? makeAutoCategoryInterval(axis, ctx) : optionLabelInterval;
    labels = makeTicksLabelsByCategoryIntervalNumOrCb(axis, numericLabelInterval, false);
  }
  var result = {
    labels,
    labelCategoryInterval: numericLabelInterval
  };
  if (!isEstimate) {
    axisCacheSet(labelsCache, optionLabelInterval, result);
  } else {
    ctx.out.noPxChangeTryDetermine.push(function() {
      axisCacheSet(labelsCache, optionLabelInterval, result);
      return true;
    });
  }
  return result;
}
function makeCategoryTicks(axis, tickModel) {
  var ticksCache = ensureCategoryTickCache(axis);
  var optionTickInterval = getOptionCategoryInterval(tickModel);
  var result = axisCacheGet(ticksCache, optionTickInterval);
  if (result) {
    return result;
  }
  var ticks;
  var tickCategoryInterval;
  if (!tickModel.get("show") || axis.scale.isBlank()) {
    ticks = [];
  }
  if (isFunction(optionTickInterval)) {
    ticks = makeTicksLabelsByCategoryIntervalNumOrCb(axis, optionTickInterval, true);
  } else if (optionTickInterval === "auto") {
    var labelsResult = makeCategoryLabelsActually(axis, axis.getLabelModel(), createAxisLabelsComputingContext(AxisTickLabelComputingKind.determine));
    tickCategoryInterval = labelsResult.labelCategoryInterval;
    ticks = map(labelsResult.labels, function(labelItem) {
      return labelItem.tick;
    });
  } else {
    tickCategoryInterval = optionTickInterval;
    ticks = makeTicksLabelsByCategoryIntervalNumOrCb(axis, tickCategoryInterval, true);
  }
  return axisCacheSet(ticksCache, optionTickInterval, {
    ticks,
    tickCategoryInterval
  });
}
function makeRealNumberLabels(axis) {
  var ticks = axis.scale.getTicks();
  var labelFormatter = makeLabelFormatter(axis);
  return {
    labels: map(ticks, function(tick, idx) {
      return {
        formattedLabel: labelFormatter(tick, idx),
        rawLabel: axis.scale.getLabel(tick),
        tick
      };
    })
  };
}
var ensureCategoryTickCache = initAxisCacheMethod("axisTick");
var ensureCategoryLabelCache = initAxisCacheMethod("axisLabel");
function initAxisCacheMethod(prop) {
  return function ensureCache(axis) {
    return axisInner2(axis)[prop] || (axisInner2(axis)[prop] = {
      list: []
    });
  };
}
function axisCacheGet(cache, key2) {
  for (var i = 0; i < cache.list.length; i++) {
    if (cache.list[i].key === key2) {
      return cache.list[i].value;
    }
  }
}
function axisCacheSet(cache, key2, value) {
  cache.list.push({
    key: key2,
    value
  });
  return value;
}
function makeAutoCategoryInterval(axis, ctx) {
  if (ctx.kind === AxisTickLabelComputingKind.estimate) {
    var result_2 = axis.calculateCategoryInterval(ctx);
    ctx.out.noPxChangeTryDetermine.push(function() {
      axisInner2(axis).autoInterval = result_2;
      return true;
    });
    return result_2;
  }
  var result = axisInner2(axis).autoInterval;
  return result != null ? result : axisInner2(axis).autoInterval = axis.calculateCategoryInterval(ctx);
}
function calculateCategoryInterval(axis, ctx) {
  var kind = ctx.kind;
  var params = fetchAutoCategoryIntervalCalculationParams(axis);
  var labelFormatter = makeLabelFormatter(axis);
  var rotation = (params.axisRotate - params.labelRotate) / 180 * Math.PI;
  var ordinalScale = axis.scale;
  var ordinalExtent = ordinalScale.getExtent();
  var tickCount = ordinalScale.count();
  if (ordinalExtent[1] - ordinalExtent[0] < 1) {
    return 0;
  }
  var step = 1;
  var maxCount = 40;
  if (tickCount > maxCount) {
    step = Math.max(1, Math.floor(tickCount / maxCount));
  }
  var tickValue = ordinalExtent[0];
  var unitSpan = axis.dataToCoord(tickValue + 1) - axis.dataToCoord(tickValue);
  var unitW = Math.abs(unitSpan * Math.cos(rotation));
  var unitH = Math.abs(unitSpan * Math.sin(rotation));
  var maxW = 0;
  var maxH = 0;
  for (; tickValue <= ordinalExtent[1]; tickValue += step) {
    var width = 0;
    var height = 0;
    var rect = getBoundingRect(labelFormatter({
      value: tickValue
    }), params.font, "center", "top");
    width = rect.width * 1.3;
    height = rect.height * 1.3;
    maxW = Math.max(maxW, width, 7);
    maxH = Math.max(maxH, height, 7);
  }
  var dw = maxW / unitW;
  var dh = maxH / unitH;
  isNaN(dw) && (dw = Infinity);
  isNaN(dh) && (dh = Infinity);
  var interval = Math.max(0, Math.floor(Math.min(dw, dh)));
  if (kind === AxisTickLabelComputingKind.estimate) {
    ctx.out.noPxChangeTryDetermine.push(bind(calculateCategoryIntervalTryDetermine, null, axis, interval, tickCount));
    return interval;
  }
  var lastInterval = calculateCategoryIntervalDealCache(axis, interval, tickCount);
  return lastInterval != null ? lastInterval : interval;
}
function calculateCategoryIntervalTryDetermine(axis, interval, tickCount) {
  return calculateCategoryIntervalDealCache(axis, interval, tickCount) == null;
}
function calculateCategoryIntervalDealCache(axis, interval, tickCount) {
  var cache = modelInner(axis.model);
  var axisExtent = axis.getExtent();
  var lastAutoInterval = cache.lastAutoInterval;
  var lastTickCount = cache.lastTickCount;
  if (lastAutoInterval != null && lastTickCount != null && Math.abs(lastAutoInterval - interval) <= 1 && Math.abs(lastTickCount - tickCount) <= 1 && lastAutoInterval > interval && cache.axisExtent0 === axisExtent[0] && cache.axisExtent1 === axisExtent[1]) {
    return lastAutoInterval;
  } else {
    cache.lastTickCount = tickCount;
    cache.lastAutoInterval = interval;
    cache.axisExtent0 = axisExtent[0];
    cache.axisExtent1 = axisExtent[1];
  }
}
function fetchAutoCategoryIntervalCalculationParams(axis) {
  var labelModel = axis.getLabelModel();
  return {
    axisRotate: axis.getRotate ? axis.getRotate() : axis.isHorizontal && !axis.isHorizontal() ? 90 : 0,
    labelRotate: labelModel.get("rotate") || 0,
    font: labelModel.getFont()
  };
}
function makeTicksLabelsByCategoryIntervalNumOrCb(axis, categoryInterval, onlyTick) {
  var labelFormatter = makeLabelFormatter(axis);
  var ordinalScale = axis.scale;
  var result = [];
  var categoryIntervalIsCb = isFunction(categoryInterval);
  ordinalScaleCreateTicks(ordinalScale, categoryIntervalIsCb ? 0 : categoryInterval, function(tickObj, isExtentBoundary) {
    var tickLabel = ordinalScale.getLabel(tickObj);
    if (categoryIntervalIsCb) {
      var isOnInterval = !!categoryInterval(tickObj.value, tickLabel);
      tickObj.offInterval = !isOnInterval;
      if (!isOnInterval && !isExtentBoundary) {
        return;
      }
    }
    result.push(onlyTick ? tickObj : {
      formattedLabel: labelFormatter(tickObj),
      rawLabel: tickLabel,
      tick: tickObj
    });
  });
  return result;
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/util/cycleCache.js
var ecModelCacheInner = makeInner();
function getCachePerECFullUpdate(ecModel) {
  return ecModelCacheInner(ecModel).fullUpdate;
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/coord/axisStatistics.js
var callOnlyOnce = makeCallOnlyOnce();
var AXIS_STAT_KEY_DELIMITER = "|&";
var ecModelCacheFullUpdateInner = makeInner();
var LINEAR_POSITIVE_MIN_GAP_SINGLE_VALID_VALUE = -2;
var ecModelCachePrepareInner = makeInner();
if (false) {
  validateInputAxis = function(axis) {
    assert(axis && axis.model && axis.model.uid && axis.model.ecModel);
  };
}
function getAxisStatPerKeyPerAxis(axis, axisStatKey) {
  var axisModel = axis.model;
  var keyed = ecModelCacheFullUpdateInner(getCachePerECFullUpdate(axisModel.ecModel)).keyed;
  var perKey = keyed && keyed.get(axisStatKey);
  return perKey && perKey.get(axisModel.uid);
}
function getAxisStat(axis, axisStatKey) {
  if (false) {
    assert(axisStatKey != null);
    validateInputAxis(axis);
  }
  return wrapStatResult(getAxisStatPerKeyPerAxis(axis, axisStatKey));
}
function getAxisStatBySeries(axis, seriesList) {
  if (false) {
    validateInputAxis(axis);
  }
  var result = [];
  eachKeyEachAxis(axis.model.ecModel, function(perKeyPerAxis) {
    for (var idx = 0; idx < seriesList.length; idx++) {
      if (seriesList[idx] && perKeyPerAxis.serByIdx[seriesList[idx].seriesIndex]) {
        result.push(wrapStatResult(perKeyPerAxis));
      }
    }
  });
  return result;
}
function eachKeyEachAxis(ecModel, cb) {
  var keyed = ecModelCacheFullUpdateInner(getCachePerECFullUpdate(ecModel)).keyed;
  keyed && keyed.each(function(perKey, axisStatKey) {
    perKey.each(function(perKeyPerAxis, axisModelUid) {
      cb(perKeyPerAxis, axisStatKey, axisModelUid);
    });
  });
}
function wrapStatResult(record) {
  return {
    liPosMinGap: record ? record.liPosMinGap : void 0
  };
}
function eachSeriesOnAxis(axis, cb) {
  if (false) {
    validateInputAxis(axis);
  }
  var ecModel = axis.model.ecModel;
  var seriesOnAxisMap = ecModelCacheFullUpdateInner(getCachePerECFullUpdate(ecModel)).axSer;
  seriesOnAxisMap && eachSeriesDealForAxisStat(ecModel, seriesOnAxisMap.get(axis.model.uid), cb);
}
function eachSeriesDealForAxisStat(ecModel, seriesList, cb) {
  if (!seriesList) {
    return;
  }
  for (var i = 0; i < seriesList.length; i++) {
    var seriesModel = seriesList[i];
    if (!ecModel.isSeriesFiltered(seriesModel)) {
      cb(seriesModel);
    }
  }
}
function eachKeyOnAxis(axis, cb) {
  if (false) {
    validateInputAxis(axis);
  }
  var model = axis.model;
  var keysByAxisModelUid = ecModelCacheFullUpdateInner(getCachePerECFullUpdate(model.ecModel)).keys;
  keysByAxisModelUid && each(keysByAxisModelUid.get(model.uid), function(axisStatKey) {
    if (false) {
      var stat = getAxisStatPerKeyPerAxis(axis, axisStatKey);
      assert(stat && stat.sers.length > 0);
    }
    cb(axisStatKey);
  });
}
function associateSeriesWithAxis(axis, seriesModel, coordSysType) {
  if (!axis) {
    return;
  }
  var ecModel = seriesModel.ecModel;
  var ecFullUpdateCache = ecModelCacheFullUpdateInner(getCachePerECFullUpdate(ecModel));
  var axisModelUid = axis.model.uid;
  if (false) {
    validateInputAxis(axis);
    var axSerPairCheck = ecFullUpdateCache.axSerPairCheck || (ecFullUpdateCache.axSerPairCheck = createHashMap());
    var pairKey = "" + axisModelUid + AXIS_STAT_KEY_DELIMITER + seriesModel.uid;
    assert(!axSerPairCheck.get(pairKey));
    axSerPairCheck.set(pairKey, 1);
  }
  var seriesOnAxisMap = ecFullUpdateCache.axSer || (ecFullUpdateCache.axSer = createHashMap());
  var seriesListPerAxis = seriesOnAxisMap.get(axisModelUid) || seriesOnAxisMap.set(axisModelUid, []);
  if (false) {
    var lastSeries = seriesListPerAxis[seriesListPerAxis.length - 1];
    if (lastSeries) {
      assert(lastSeries.seriesIndex < seriesModel.seriesIndex);
    }
  }
  seriesListPerAxis.push(seriesModel);
  var seriesType = seriesModel.subType;
  var isBaseAxis = seriesModel.getBaseAxis() === axis;
  var client = clientsForLookup.get(makeClientLookupKey(seriesType, isBaseAxis, coordSysType)) || clientsForLookup.get(makeClientLookupKey(seriesType, isBaseAxis, null));
  if (!client) {
    return;
  }
  var keyed = ecFullUpdateCache.keyed || (ecFullUpdateCache.keyed = createHashMap());
  var keys2 = ecFullUpdateCache.keys || (ecFullUpdateCache.keys = createHashMap());
  var axisStatKey = client.key;
  var perKey = keyed.get(axisStatKey) || keyed.set(axisStatKey, createHashMap());
  var perKeyPerAxis = perKey.get(axisModelUid);
  if (!perKeyPerAxis) {
    perKeyPerAxis = perKey.set(axisModelUid, {
      axis,
      sers: [],
      serByIdx: []
    });
    perKeyPerAxis.metrics = client.getMetrics(axis);
    (keys2.get(axisModelUid) || keys2.set(axisModelUid, [])).push(axisStatKey);
  }
  perKeyPerAxis.sers.push(seriesModel);
  perKeyPerAxis.serByIdx[seriesModel.seriesIndex] = seriesModel;
}
function makeClientLookupKey(seriesType, isBaseAxis, coordSysType) {
  return seriesType + AXIS_STAT_KEY_DELIMITER + retrieve2(isBaseAxis, true) + AXIS_STAT_KEY_DELIMITER + (coordSysType || "");
}
if (false) {
  clientsForCheckingStatKey = createHashMap();
}
var clientsForLookup = createHashMap();

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/coord/axisBand.js
var FALLBACK_BAND_WIDTH_RATIO = 0.8;
function calcBandWidth(axis, opt) {
  opt = opt || {};
  var out2 = {
    w: NaN,
    w2: NaN
  };
  var scale3 = axis.scale;
  var fromStat = opt.fromStat;
  var min3 = opt.min;
  var scaleLinearSpan = getScaleLinearSpanForMapping(scale3);
  if (!isNullableNumberFinite(scaleLinearSpan)) {
    scaleLinearSpan = NaN;
  }
  var axisExtent = axis.getExtent();
  var pxSpan = mathAbs(axisExtent[1] - axisExtent[0]);
  if (isOrdinalScale(scale3)) {
    calcBandWidthForCategoryAxis(out2, axis, scaleLinearSpan, pxSpan);
  } else if (fromStat) {
    calcBandWidthForNumericAxis(out2, axis, scaleLinearSpan, pxSpan, fromStat);
  } else if (min3 == null) {
    if (false) {
      assert(false);
    }
  }
  if (min3 != null) {
    out2.w = isNullableNumberFinite(out2.w) ? mathMax(min3, out2.w) : min3;
  }
  return out2;
}
function calcBandWidthForCategoryAxis(out2, axis, scaleLinearSpan, pxSpan) {
  var onBand = axis.onBand;
  var len2 = scaleLinearSpan + (onBand ? 1 : 0);
  len2 === 0 && (len2 = 1);
  out2.w = pxSpan / len2;
  if (!onBand && scaleLinearSpan && pxSpan) {
    out2.w2 = out2.w * scaleLinearSpan / pxSpan;
  }
}
function calcBandWidthForNumericAxis(out2, axis, scaleLinearSpan, pxSpan, fromStat) {
  if (false) {
    assert(fromStat);
  }
  var onlySingular = false;
  var bandWidthInData = -Infinity;
  each(fromStat.key ? [getAxisStat(axis, fromStat.key)] : getAxisStatBySeries(axis, fromStat.sers || []), function(stat) {
    var liPosMinGap = stat.liPosMinGap;
    if (liPosMinGap != null) {
      if (liPosMinGap > 0) {
        if (liPosMinGap > bandWidthInData) {
          bandWidthInData = liPosMinGap;
        }
        onlySingular = false;
      } else if (liPosMinGap === LINEAR_POSITIVE_MIN_GAP_SINGLE_VALID_VALUE) {
        onlySingular = true;
      }
    }
  });
  if (isNullableNumberFinite(scaleLinearSpan) && scaleLinearSpan > 0 && isNullableNumberFinite(bandWidthInData)) {
    out2.w = pxSpan / scaleLinearSpan * bandWidthInData;
    out2.w2 = bandWidthInData;
  } else if (onlySingular) {
    out2.w = pxSpan * FALLBACK_BAND_WIDTH_RATIO;
    out2.w2 = out2.w * scaleLinearSpan / pxSpan;
  }
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/coord/Axis.js
var NORMALIZED_EXTENT = [0, 1];
var Axis = (
  /** @class */
  (function() {
    function Axis2(dim, scale3, extent) {
      this.onBand = false;
      this.inverse = false;
      this.dim = dim;
      this.scale = scale3;
      this._extent = extent || [0, 0];
    }
    Axis2.prototype.contain = function(coord) {
      var extent = this._extent;
      var min3 = Math.min(extent[0], extent[1]);
      var max3 = Math.max(extent[0], extent[1]);
      return coord >= min3 && coord <= max3;
    };
    Axis2.prototype.containData = function(data) {
      return this.scale.contain(this.scale.parse(data));
    };
    Axis2.prototype.getExtent = function() {
      return this._extent.slice();
    };
    Axis2.prototype.setExtent = function(start2, end2) {
      var extent = this._extent;
      extent[0] = start2;
      extent[1] = end2;
    };
    Axis2.prototype.dataToCoord = function(data, clamp) {
      var scale3 = this.scale;
      data = scale3.normalize(scale3.parse(data));
      return linearMap(data, NORMALIZED_EXTENT, makeExtentWithBands(this), clamp);
    };
    Axis2.prototype.coordToData = function(coord, clamp) {
      var t = linearMap(coord, makeExtentWithBands(this), NORMALIZED_EXTENT, clamp);
      return this.scale.scale(t);
    };
    Axis2.prototype.pointToData = function(point, clamp) {
      return;
    };
    Axis2.prototype.getTicksCoords = function(opt) {
      opt = opt || {};
      var tickModel = opt.tickModel || this.getTickModel();
      var result = createAxisTicks(this, tickModel, {
        breakTicks: opt.breakTicks,
        pruneByBreak: opt.pruneByBreak
      });
      var preTicksCoords = map(result.ticks, function(tick) {
        return {
          coord: this.dataToCoord(getTickValueOutermost(this.scale, tick)),
          tick
        };
      }, this);
      var alignWithLabel = tickModel.get("alignWithLabel");
      var onBandModified = fixOnBandTicksCoords(this, preTicksCoords, alignWithLabel);
      return map(preTicksCoords, function(item) {
        return {
          coord: item.coord,
          tickValue: item.tick.value,
          onBand: onBandModified
        };
      });
    };
    Axis2.prototype.getMinorTicksCoords = function() {
      if (isOrdinalScale(this.scale)) {
        return [];
      }
      var minorTickModel = this.model.getModel("minorTick");
      var splitNumber = minorTickModel.get("splitNumber");
      if (!(splitNumber > 0 && splitNumber < 100)) {
        splitNumber = 5;
      }
      var minorTicks = this.scale.getMinorTicks(splitNumber);
      var minorTicksCoords = map(minorTicks, function(minorTicksGroup) {
        return map(minorTicksGroup, function(minorTick) {
          return {
            coord: this.dataToCoord(minorTick),
            tickValue: minorTick
          };
        }, this);
      }, this);
      return minorTicksCoords;
    };
    Axis2.prototype.getViewLabels = function(ctx) {
      ctx = ctx || createAxisLabelsComputingContext(AxisTickLabelComputingKind.determine);
      return createAxisLabels(this, ctx).labels;
    };
    Axis2.prototype.getLabelModel = function() {
      return this.model.getModel("axisLabel");
    };
    Axis2.prototype.getTickModel = function() {
      return this.model.getModel("axisTick");
    };
    Axis2.prototype.getBandWidth = function() {
      return calcBandWidth(this, {
        min: 1
      }).w;
    };
    Axis2.prototype.calculateCategoryInterval = function(ctx) {
      ctx = ctx || createAxisLabelsComputingContext(AxisTickLabelComputingKind.determine);
      return calculateCategoryInterval(this, ctx);
    };
    return Axis2;
  })()
);
function makeExtentWithBands(axis) {
  var extent = axis.getExtent();
  if (axis.onBand) {
    var size = extent[1] - extent[0];
    var margin = size / axis.scale.count() / 2;
    extent[0] += margin;
    extent[1] -= margin;
  }
  return extent;
}
function fixOnBandTicksCoords(axis, preTicksCoords, alignWithLabel) {
  var ticksLen = preTicksCoords.length;
  if (!axis.onBand || alignWithLabel || !ticksLen) {
    return false;
  }
  var bandWidth = calcBandWidth(axis).w;
  if (!bandWidth) {
    return false;
  }
  each(preTicksCoords, function(ticksItem) {
    ticksItem.coord -= bandWidth / 2;
  });
  var dataExtent = axis.scale.getExtent();
  var oldLast = preTicksCoords[ticksLen - 1];
  if (oldLast.tick.offInterval) {
    preTicksCoords.pop();
  }
  preTicksCoords.push({
    coord: oldLast.coord + bandWidth,
    tick: {
      value: dataExtent[1] + 1
    }
  });
  return true;
}
var Axis_default = Axis;

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/coord/cartesian/Axis2D.js
var Axis2D = (
  /** @class */
  (function(_super) {
    __extends(Axis2D2, _super);
    function Axis2D2(dim, scale3, coordExtent, axisType, position) {
      var _this = _super.call(this, dim, scale3, coordExtent) || this;
      _this.index = 0;
      _this.type = axisType || "value";
      _this.position = position || "bottom";
      return _this;
    }
    Axis2D2.prototype.isHorizontal = function() {
      var position = this.position;
      return position === "top" || position === "bottom";
    };
    Axis2D2.prototype.getGlobalExtent = function(asc2) {
      var ret = this.getExtent();
      ret[0] = this.toGlobalCoord(ret[0]);
      ret[1] = this.toGlobalCoord(ret[1]);
      asc2 && ret[0] > ret[1] && ret.reverse();
      return ret;
    };
    Axis2D2.prototype.pointToData = function(point, clamp) {
      return this.coordToData(this.toLocalCoord(point[this.dim === "x" ? 0 : 1]), clamp);
    };
    Axis2D2.prototype.setCategorySortInfo = function(info) {
      if (this.type !== "category") {
        return false;
      }
      this.model.option.categorySortInfo = info;
      this.scale.setSortInfo(info);
    };
    return Axis2D2;
  })(Axis_default)
);
var Axis2D_default = Axis2D;

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/util/symbol.js
var Triangle = Path_default.extend({
  type: "triangle",
  shape: {
    cx: 0,
    cy: 0,
    width: 0,
    height: 0
  },
  buildPath: function(path, shape) {
    var cx = shape.cx;
    var cy = shape.cy;
    var width = shape.width / 2;
    var height = shape.height / 2;
    path.moveTo(cx, cy - height);
    path.lineTo(cx + width, cy + height);
    path.lineTo(cx - width, cy + height);
    path.closePath();
  }
});
var Diamond = Path_default.extend({
  type: "diamond",
  shape: {
    cx: 0,
    cy: 0,
    width: 0,
    height: 0
  },
  buildPath: function(path, shape) {
    var cx = shape.cx;
    var cy = shape.cy;
    var width = shape.width / 2;
    var height = shape.height / 2;
    path.moveTo(cx, cy - height);
    path.lineTo(cx + width, cy);
    path.lineTo(cx, cy + height);
    path.lineTo(cx - width, cy);
    path.closePath();
  }
});
var Pin = Path_default.extend({
  type: "pin",
  shape: {
    // x, y on the cusp
    x: 0,
    y: 0,
    width: 0,
    height: 0
  },
  buildPath: function(path, shape) {
    var x = shape.x;
    var y = shape.y;
    var w = shape.width / 5 * 3;
    var h = Math.max(w, shape.height);
    var r = w / 2;
    var dy = r * r / (h - r);
    var cy = y - h + r + dy;
    var angle = Math.asin(dy / r);
    var dx = Math.cos(angle) * r;
    var tanX = Math.sin(angle);
    var tanY = Math.cos(angle);
    var cpLen = r * 0.6;
    var cpLen2 = r * 0.7;
    path.moveTo(x - dx, cy + dy);
    path.arc(x, cy, r, Math.PI - angle, Math.PI * 2 + angle);
    path.bezierCurveTo(x + dx - tanX * cpLen, cy + dy + tanY * cpLen, x, y - cpLen2, x, y);
    path.bezierCurveTo(x, y - cpLen2, x - dx + tanX * cpLen, cy + dy + tanY * cpLen, x - dx, cy + dy);
    path.closePath();
  }
});
var Arrow = Path_default.extend({
  type: "arrow",
  shape: {
    x: 0,
    y: 0,
    width: 0,
    height: 0
  },
  buildPath: function(ctx, shape) {
    var height = shape.height;
    var width = shape.width;
    var x = shape.x;
    var y = shape.y;
    var dx = width / 3 * 2;
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx, y + height);
    ctx.lineTo(x, y + height / 4 * 3);
    ctx.lineTo(x - dx, y + height);
    ctx.lineTo(x, y);
    ctx.closePath();
  }
});
var symbolCtors = {
  line: Line_default,
  rect: Rect_default,
  roundRect: Rect_default,
  square: Rect_default,
  circle: Circle_default,
  diamond: Diamond,
  pin: Pin,
  arrow: Arrow,
  triangle: Triangle
};
var symbolShapeMakers = {
  line: function(x, y, w, h, shape) {
    shape.x1 = x;
    shape.y1 = y + h / 2;
    shape.x2 = x + w;
    shape.y2 = y + h / 2;
  },
  rect: function(x, y, w, h, shape) {
    shape.x = x;
    shape.y = y;
    shape.width = w;
    shape.height = h;
  },
  roundRect: function(x, y, w, h, shape) {
    shape.x = x;
    shape.y = y;
    shape.width = w;
    shape.height = h;
    shape.r = Math.min(w, h) / 4;
  },
  square: function(x, y, w, h, shape) {
    var size = Math.min(w, h);
    shape.x = x;
    shape.y = y;
    shape.width = size;
    shape.height = size;
  },
  circle: function(x, y, w, h, shape) {
    shape.cx = x + w / 2;
    shape.cy = y + h / 2;
    shape.r = Math.min(w, h) / 2;
  },
  diamond: function(x, y, w, h, shape) {
    shape.cx = x + w / 2;
    shape.cy = y + h / 2;
    shape.width = w;
    shape.height = h;
  },
  pin: function(x, y, w, h, shape) {
    shape.x = x + w / 2;
    shape.y = y + h / 2;
    shape.width = w;
    shape.height = h;
  },
  arrow: function(x, y, w, h, shape) {
    shape.x = x + w / 2;
    shape.y = y + h / 2;
    shape.width = w;
    shape.height = h;
  },
  triangle: function(x, y, w, h, shape) {
    shape.cx = x + w / 2;
    shape.cy = y + h / 2;
    shape.width = w;
    shape.height = h;
  }
};
var symbolBuildProxies = {};
each(symbolCtors, function(Ctor, name) {
  symbolBuildProxies[name] = new Ctor();
});
var SymbolClz = Path_default.extend({
  type: "symbol",
  shape: {
    symbolType: "",
    x: 0,
    y: 0,
    width: 0,
    height: 0
  },
  calculateTextPosition: function(out2, config, rect) {
    var res = calculateTextPosition(out2, config, rect);
    var shape = this.shape;
    if (shape && shape.symbolType === "pin" && config.position === "inside") {
      res.y = rect.y + rect.height * 0.4;
    }
    return res;
  },
  buildPath: function(ctx, shape, inBundle) {
    var symbolType = shape.symbolType;
    if (symbolType !== "none") {
      var proxySymbol = symbolBuildProxies[symbolType];
      if (!proxySymbol) {
        symbolType = "rect";
        proxySymbol = symbolBuildProxies[symbolType];
      }
      symbolShapeMakers[symbolType](shape.x, shape.y, shape.width, shape.height, proxySymbol.shape);
      proxySymbol.buildPath(ctx, proxySymbol.shape, inBundle);
    }
  }
});
function symbolPathSetColor(color2, innerColor2) {
  if (this.type !== "image") {
    var symbolStyle = this.style;
    if (this.__isEmptyBrush) {
      symbolStyle.stroke = color2;
      symbolStyle.fill = innerColor2 || tokens_default.color.neutral00;
      symbolStyle.lineWidth = 2;
    } else if (this.shape.symbolType === "line") {
      symbolStyle.stroke = color2;
    } else {
      symbolStyle.fill = color2;
    }
    this.markRedraw();
  }
}
function createSymbol(symbolType, x, y, w, h, color2, keepAspect) {
  var isEmpty = symbolType.indexOf("empty") === 0;
  if (isEmpty) {
    symbolType = symbolType.substr(5, 1).toLowerCase() + symbolType.substr(6);
  }
  var symbolPath;
  if (symbolType.indexOf("image://") === 0) {
    symbolPath = makeImage(symbolType.slice(8), new BoundingRect_default(x, y, w, h), keepAspect ? "center" : "cover");
  } else if (symbolType.indexOf("path://") === 0) {
    symbolPath = makePath(symbolType.slice(7), {}, new BoundingRect_default(x, y, w, h), keepAspect ? "center" : "cover");
  } else {
    symbolPath = new SymbolClz({
      shape: {
        symbolType,
        x,
        y,
        width: w,
        height: h
      }
    });
  }
  symbolPath.__isEmptyBrush = isEmpty;
  symbolPath.setColor = symbolPathSetColor;
  if (color2) {
    symbolPath.setColor(color2);
  }
  return symbolPath;
}
function normalizeSymbolOffset(symbolOffset, symbolSize) {
  if (symbolOffset == null) {
    return;
  }
  if (!isArray(symbolOffset)) {
    symbolOffset = [symbolOffset, symbolOffset];
  }
  return [parsePercent(symbolOffset[0], symbolSize[0]) || 0, parsePercent(retrieve2(symbolOffset[1], symbolOffset[0]), symbolSize[1]) || 0];
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/component/axis/AxisBuilder.js
var PI5 = Math.PI;
var DEFAULT_CENTER_NAME_MARGIN_LEVELS = [[1, 2, 1, 2], [5, 3, 5, 3], [8, 3, 8, 3]];
var DEFAULT_ENDS_NAME_MARGIN_LEVELS = [[0, 1, 0, 1], [0, 3, 0, 3], [0, 3, 0, 3]];
var getLabelInner = makeInner();
var getTickInner = makeInner();
var AxisBuilderSharedContext = (
  /** @class */
  (function() {
    function AxisBuilderSharedContext2(resolveAxisNameOverlap) {
      this.recordMap = {};
      this.resolveAxisNameOverlap = resolveAxisNameOverlap;
    }
    AxisBuilderSharedContext2.prototype.ensureRecord = function(axisModel) {
      var dim = axisModel.axis.dim;
      var idx = axisModel.componentIndex;
      var recordMap = this.recordMap;
      var records = recordMap[dim] || (recordMap[dim] = []);
      return records[idx] || (records[idx] = {
        ready: {}
      });
    };
    return AxisBuilderSharedContext2;
  })()
);
function resetOverlapRecordToShared(cfg, shared, axisModel, labelLayoutList) {
  var axis = axisModel.axis;
  var record = shared.ensureRecord(axisModel);
  var labelInfoList = [];
  var stOccupiedRect;
  var useStOccupiedRect = hasAxisName(cfg.axisName) && isNameLocationCenter(cfg.nameLocation);
  each(labelLayoutList, function(layout2) {
    var layoutInfo = ensureLabelLayoutWithGeometry(layout2);
    if (!layoutInfo || layoutInfo.label.ignore) {
      return;
    }
    labelInfoList.push(layoutInfo);
    var transGroup = record.transGroup;
    if (useStOccupiedRect) {
      transGroup.transform ? invert(_stTransTmp, transGroup.transform) : identity(_stTransTmp);
      if (layoutInfo.transform) {
        mul(_stTransTmp, _stTransTmp, layoutInfo.transform);
      }
      BoundingRect_default.copy(_stLabelRectTmp, layoutInfo.localRect);
      _stLabelRectTmp.applyTransform(_stTransTmp);
      stOccupiedRect ? stOccupiedRect.union(_stLabelRectTmp) : BoundingRect_default.copy(stOccupiedRect = new BoundingRect_default(0, 0, 0, 0), _stLabelRectTmp);
    }
  });
  var sortByDim = Math.abs(record.dirVec.x) > 0.1 ? "x" : "y";
  var sortByValue = record.transGroup[sortByDim];
  labelInfoList.sort(function(info1, info2) {
    return Math.abs(info1.label[sortByDim] - sortByValue) - Math.abs(info2.label[sortByDim] - sortByValue);
  });
  if (useStOccupiedRect && stOccupiedRect) {
    var extent = axis.getExtent();
    var axisLineX = Math.min(extent[0], extent[1]);
    var axisLineWidth = Math.max(extent[0], extent[1]) - axisLineX;
    stOccupiedRect.union(new BoundingRect_default(axisLineX, 0, axisLineWidth, 1));
  }
  record.stOccupiedRect = stOccupiedRect;
  record.labelInfoList = labelInfoList;
}
var _stTransTmp = create();
var _stLabelRectTmp = new BoundingRect_default(0, 0, 0, 0);
var resolveAxisNameOverlapDefault = function(cfg, ctx, axisModel, nameLayoutInfo, nameMoveDirVec, thisRecord) {
  if (isNameLocationCenter(cfg.nameLocation)) {
    var stOccupiedRect = thisRecord.stOccupiedRect;
    if (stOccupiedRect) {
      moveIfOverlap(computeLabelGeometry2({}, stOccupiedRect, thisRecord.transGroup.transform), nameLayoutInfo, nameMoveDirVec);
    }
  } else {
    moveIfOverlapByLinearLabels(thisRecord.labelInfoList, thisRecord.dirVec, nameLayoutInfo, nameMoveDirVec);
  }
};
function moveIfOverlap(basedLayoutInfo, movableLayoutInfo, moveDirVec) {
  var mtv = new Point_default();
  if (labelIntersect(basedLayoutInfo, movableLayoutInfo, mtv, {
    direction: Math.atan2(moveDirVec.y, moveDirVec.x),
    bidirectional: false,
    touchThreshold: 0.05
  })) {
    labelLayoutApplyTranslation(movableLayoutInfo, mtv);
  }
}
function moveIfOverlapByLinearLabels(baseLayoutInfoList, baseDirVec, movableLayoutInfo, moveDirVec) {
  var sameDir = Point_default.dot(moveDirVec, baseDirVec) >= 0;
  for (var idx = 0, len2 = baseLayoutInfoList.length; idx < len2; idx++) {
    var labelInfo = baseLayoutInfoList[sameDir ? idx : len2 - 1 - idx];
    if (!labelInfo.label.ignore) {
      moveIfOverlap(labelInfo, movableLayoutInfo, moveDirVec);
    }
  }
}
var AxisBuilder = (
  /** @class */
  (function() {
    function AxisBuilder2(axisModel, api, opt, shared) {
      this.group = new Group_default();
      this._axisModel = axisModel;
      this._api = api;
      this._local = {};
      this._shared = shared || new AxisBuilderSharedContext(resolveAxisNameOverlapDefault);
      this._resetCfgDetermined(opt);
    }
    AxisBuilder2.prototype.updateCfg = function(opt) {
      if (false) {
        var ready = this._shared.ensureRecord(this._axisModel).ready;
        assert(!ready.axisLine && !ready.axisTickLabelDetermine);
        ready.axisName = ready.axisTickLabelEstimate = false;
      }
      var raw = this._cfg.raw;
      raw.position = opt.position;
      raw.labelOffset = opt.labelOffset;
      this._resetCfgDetermined(raw);
    };
    AxisBuilder2.prototype.__getRawCfg = function() {
      return this._cfg.raw;
    };
    AxisBuilder2.prototype._resetCfgDetermined = function(raw) {
      var axisModel = this._axisModel;
      var axisModelDefaultOption = axisModel.getDefaultOption ? axisModel.getDefaultOption() : {};
      var axisName = retrieve2(raw.axisName, axisModel.get("name"));
      var nameMoveOverlapOption = axisModel.get("nameMoveOverlap");
      if (nameMoveOverlapOption == null || nameMoveOverlapOption === "auto") {
        nameMoveOverlapOption = retrieve2(raw.defaultNameMoveOverlap, true);
      }
      var cfg = {
        raw,
        position: raw.position,
        rotation: raw.rotation,
        nameDirection: retrieve2(raw.nameDirection, 1),
        tickDirection: retrieve2(raw.tickDirection, 1),
        labelDirection: retrieve2(raw.labelDirection, 1),
        labelOffset: retrieve2(raw.labelOffset, 0),
        silent: retrieve2(raw.silent, true),
        axisName,
        nameLocation: retrieve3(axisModel.get("nameLocation"), axisModelDefaultOption.nameLocation, "end"),
        shouldNameMoveOverlap: hasAxisName(axisName) && nameMoveOverlapOption,
        optionHideOverlap: axisModel.get(["axisLabel", "hideOverlap"]),
        showMinorTicks: axisModel.get(["minorTick", "show"])
      };
      if (false) {
        assert(cfg.position != null);
        assert(cfg.rotation != null);
      }
      this._cfg = cfg;
      var transformGroup = new Group_default({
        x: cfg.position[0],
        y: cfg.position[1],
        rotation: cfg.rotation
      });
      transformGroup.updateTransform();
      this._transformGroup = transformGroup;
      var record = this._shared.ensureRecord(axisModel);
      record.transGroup = this._transformGroup;
      record.dirVec = new Point_default(Math.cos(-cfg.rotation), Math.sin(-cfg.rotation));
    };
    AxisBuilder2.prototype.build = function(axisPartNameMap, extraParams) {
      var _this = this;
      if (!axisPartNameMap) {
        axisPartNameMap = {
          axisLine: true,
          axisTickLabelEstimate: false,
          axisTickLabelDetermine: true,
          axisName: true
        };
      }
      each(AXIS_BUILDER_AXIS_PART_NAMES, function(partName) {
        if (axisPartNameMap[partName]) {
          builders[partName](_this._cfg, _this._local, _this._shared, _this._axisModel, _this.group, _this._transformGroup, _this._api, extraParams || {});
        }
      });
      return this;
    };
    AxisBuilder2.innerTextLayout = function(axisRotation, textRotation, direction) {
      var rotationDiff = remRadian(textRotation - axisRotation);
      var textAlign;
      var textVerticalAlign;
      if (isRadianAroundZero(rotationDiff)) {
        textVerticalAlign = direction > 0 ? "top" : "bottom";
        textAlign = "center";
      } else if (isRadianAroundZero(rotationDiff - PI5)) {
        textVerticalAlign = direction > 0 ? "bottom" : "top";
        textAlign = "center";
      } else {
        textVerticalAlign = "middle";
        if (rotationDiff > 0 && rotationDiff < PI5) {
          textAlign = direction > 0 ? "right" : "left";
        } else {
          textAlign = direction > 0 ? "left" : "right";
        }
      }
      return {
        rotation: rotationDiff,
        textAlign,
        textVerticalAlign
      };
    };
    AxisBuilder2.makeAxisEventDataBase = function(axisModel) {
      var eventData = {
        componentType: axisModel.mainType,
        componentIndex: axisModel.componentIndex
      };
      eventData[axisModel.mainType + "Index"] = axisModel.componentIndex;
      return eventData;
    };
    AxisBuilder2.isLabelSilent = function(axisModel) {
      var tooltipOpt = axisModel.get("tooltip");
      return axisModel.get("silent") || !(axisModel.get("triggerEvent") || tooltipOpt && tooltipOpt.show);
    };
    return AxisBuilder2;
  })()
);
var AXIS_BUILDER_AXIS_PART_NAMES = ["axisLine", "axisTickLabelEstimate", "axisTickLabelDetermine", "axisName"];
var builders = {
  axisLine: function(cfg, local, shared, axisModel, group, transformGroup, api) {
    if (false) {
      var ready = shared.ensureRecord(axisModel).ready;
      assert(!ready.axisLine);
      ready.axisLine = true;
    }
    var shown = axisModel.get(["axisLine", "show"]);
    if (shown === "auto") {
      shown = true;
      if (cfg.raw.axisLineAutoShow != null) {
        shown = !!cfg.raw.axisLineAutoShow;
      }
    }
    if (!shown) {
      return;
    }
    var extent = axisModel.axis.getExtent();
    var matrix = transformGroup.transform;
    var pt12 = [extent[0], 0];
    var pt22 = [extent[1], 0];
    var inverse = pt12[0] > pt22[0];
    if (matrix) {
      applyTransform(pt12, pt12, matrix);
      applyTransform(pt22, pt22, matrix);
    }
    var lineStyle = extend({
      lineCap: "round"
    }, axisModel.getModel(["axisLine", "lineStyle"]).getLineStyle());
    var pathBaseProp = {
      strokeContainThreshold: cfg.raw.strokeContainThreshold || 5,
      silent: true,
      z2: 1,
      style: lineStyle
    };
    if (axisModel.get(["axisLine", "breakLine"]) && hasBreaks(axisModel.axis.scale)) {
      getAxisBreakHelper().buildAxisBreakLine(axisModel, group, transformGroup, pathBaseProp);
    } else {
      var line = new Line_default(extend({
        shape: {
          x1: pt12[0],
          y1: pt12[1],
          x2: pt22[0],
          y2: pt22[1]
        }
      }, pathBaseProp));
      subPixelOptimizeLine2(line.shape, line.style.lineWidth);
      line.anid = "line";
      group.add(line);
    }
    var arrows = axisModel.get(["axisLine", "symbol"]);
    if (arrows != null) {
      var arrowSize = axisModel.get(["axisLine", "symbolSize"]);
      if (isString(arrows)) {
        arrows = [arrows, arrows];
      }
      if (isString(arrowSize) || isNumber(arrowSize)) {
        arrowSize = [arrowSize, arrowSize];
      }
      var arrowOffset = normalizeSymbolOffset(axisModel.get(["axisLine", "symbolOffset"]) || 0, arrowSize);
      var symbolWidth_1 = arrowSize[0];
      var symbolHeight_1 = arrowSize[1];
      each([{
        rotate: cfg.rotation + Math.PI / 2,
        offset: arrowOffset[0],
        r: 0
      }, {
        rotate: cfg.rotation - Math.PI / 2,
        offset: arrowOffset[1],
        r: Math.sqrt((pt12[0] - pt22[0]) * (pt12[0] - pt22[0]) + (pt12[1] - pt22[1]) * (pt12[1] - pt22[1]))
      }], function(point, index) {
        if (arrows[index] !== "none" && arrows[index] != null) {
          var symbol = createSymbol(arrows[index], -symbolWidth_1 / 2, -symbolHeight_1 / 2, symbolWidth_1, symbolHeight_1, lineStyle.stroke, true);
          var r = point.r + point.offset;
          var pt = inverse ? pt22 : pt12;
          symbol.attr({
            rotation: point.rotate,
            x: pt[0] + r * Math.cos(cfg.rotation),
            y: pt[1] - r * Math.sin(cfg.rotation),
            silent: true,
            z2: 11
          });
          group.add(symbol);
        }
      });
    }
  },
  /**
   * [CAUTION] This method can be called multiple times, following the change due to `resetCfg` called
   *  in size measurement. Thus this method should be idempotent, and should be performant.
   */
  axisTickLabelEstimate: function(cfg, local, shared, axisModel, group, transformGroup, api, extraParams) {
    if (false) {
      var ready = shared.ensureRecord(axisModel).ready;
      assert(!ready.axisTickLabelDetermine);
      ready.axisTickLabelEstimate = true;
    }
    var needCallLayout = dealLastTickLabelResultReusable(local, group, extraParams);
    if (needCallLayout) {
      layOutAxisTickLabel(cfg, local, shared, axisModel, group, transformGroup, api, AxisTickLabelComputingKind.estimate);
    }
  },
  /**
   * Finish axis tick label build.
   * Can be only called once.
   */
  axisTickLabelDetermine: function(cfg, local, shared, axisModel, group, transformGroup, api, extraParams) {
    if (false) {
      var ready = shared.ensureRecord(axisModel).ready;
      ready.axisTickLabelDetermine = true;
    }
    var needCallLayout = dealLastTickLabelResultReusable(local, group, extraParams);
    if (needCallLayout) {
      layOutAxisTickLabel(cfg, local, shared, axisModel, group, transformGroup, api, AxisTickLabelComputingKind.determine);
    }
    var ticksEls = buildAxisMajorTicks(cfg, group, transformGroup, axisModel);
    syncLabelIgnoreToMajorTicks(cfg, local.labelLayoutList, ticksEls);
    buildAxisMinorTicks(cfg, group, transformGroup, axisModel, cfg.tickDirection);
  },
  /**
   * [CAUTION] This method can be called multiple times, following the change due to `resetCfg` called
   *  in size measurement. Thus this method should be idempotent, and should be performant.
   */
  axisName: function(cfg, local, shared, axisModel, group, transformGroup, api, extraParams) {
    var sharedRecord = shared.ensureRecord(axisModel);
    if (false) {
      var ready = sharedRecord.ready;
      assert(ready.axisTickLabelEstimate || ready.axisTickLabelDetermine);
      ready.axisName = true;
    }
    if (local.nameEl) {
      group.remove(local.nameEl);
      local.nameEl = sharedRecord.nameLayout = sharedRecord.nameLocation = null;
    }
    var name = cfg.axisName;
    if (!hasAxisName(name)) {
      return;
    }
    var nameLocation = cfg.nameLocation;
    var nameDirection = cfg.nameDirection;
    var textStyleModel = axisModel.getModel("nameTextStyle");
    var gap = axisModel.get("nameGap") || 0;
    var extent = axisModel.axis.getExtent();
    var gapStartEndSignal = axisModel.axis.inverse ? -1 : 1;
    var pos = new Point_default(0, 0);
    var nameMoveDirVec = new Point_default(0, 0);
    if (nameLocation === "start") {
      pos.x = extent[0] - gapStartEndSignal * gap;
      nameMoveDirVec.x = -gapStartEndSignal;
    } else if (nameLocation === "end") {
      pos.x = extent[1] + gapStartEndSignal * gap;
      nameMoveDirVec.x = gapStartEndSignal;
    } else {
      pos.x = (extent[0] + extent[1]) / 2;
      pos.y = cfg.labelOffset + nameDirection * gap;
      nameMoveDirVec.y = nameDirection;
    }
    var mt = create();
    nameMoveDirVec.transform(rotate(mt, mt, cfg.rotation));
    var nameRotation = axisModel.get("nameRotate");
    if (nameRotation != null) {
      nameRotation = nameRotation * PI5 / 180;
    }
    var labelLayout;
    var axisNameAvailableWidth;
    if (isNameLocationCenter(nameLocation)) {
      labelLayout = AxisBuilder.innerTextLayout(
        cfg.rotation,
        nameRotation != null ? nameRotation : cfg.rotation,
        // Adapt to axis.
        nameDirection
      );
    } else {
      labelLayout = endTextLayout(cfg.rotation, nameLocation, nameRotation || 0, extent);
      axisNameAvailableWidth = cfg.raw.axisNameAvailableWidth;
      if (axisNameAvailableWidth != null) {
        axisNameAvailableWidth = Math.abs(axisNameAvailableWidth / Math.sin(labelLayout.rotation));
        !isFinite(axisNameAvailableWidth) && (axisNameAvailableWidth = null);
      }
    }
    var textFont = textStyleModel.getFont();
    var truncateOpt = axisModel.get("nameTruncate", true) || {};
    var ellipsis = truncateOpt.ellipsis;
    var maxWidth = retrieve(cfg.raw.nameTruncateMaxWidth, truncateOpt.maxWidth, axisNameAvailableWidth);
    var nameMarginLevel = extraParams.nameMarginLevel || 0;
    var textEl = new Text_default({
      x: pos.x,
      y: pos.y,
      rotation: labelLayout.rotation,
      silent: AxisBuilder.isLabelSilent(axisModel),
      style: createTextStyle(textStyleModel, {
        text: name,
        font: textFont,
        overflow: "truncate",
        width: maxWidth,
        ellipsis,
        fill: textStyleModel.getTextColor() || axisModel.get(["axisLine", "lineStyle", "color"]),
        align: textStyleModel.get("align") || labelLayout.textAlign,
        verticalAlign: textStyleModel.get("verticalAlign") || labelLayout.textVerticalAlign
      }),
      z2: 1
    });
    setTooltipConfig({
      el: textEl,
      componentModel: axisModel,
      itemName: name
    });
    textEl.__fullText = name;
    textEl.anid = "name";
    if (axisModel.get("triggerEvent")) {
      var eventData = AxisBuilder.makeAxisEventDataBase(axisModel);
      eventData.targetType = "axisName";
      eventData.name = name;
      getECData(textEl).eventData = eventData;
    }
    transformGroup.add(textEl);
    textEl.updateTransform();
    local.nameEl = textEl;
    var nameLayout = sharedRecord.nameLayout = ensureLabelLayoutWithGeometry({
      label: textEl,
      priority: textEl.z2,
      defaultAttr: {
        ignore: textEl.ignore
      },
      marginDefault: isNameLocationCenter(nameLocation) ? DEFAULT_CENTER_NAME_MARGIN_LEVELS[nameMarginLevel] : DEFAULT_ENDS_NAME_MARGIN_LEVELS[nameMarginLevel]
    });
    sharedRecord.nameLocation = nameLocation;
    group.add(textEl);
    textEl.decomposeTransform();
    if (cfg.shouldNameMoveOverlap && nameLayout) {
      var record = shared.ensureRecord(axisModel);
      if (false) {
        assert(record.labelInfoList);
      }
      shared.resolveAxisNameOverlap(cfg, shared, axisModel, nameLayout, nameMoveDirVec, record);
    }
  }
};
function layOutAxisTickLabel(cfg, local, shared, axisModel, group, transformGroup, api, kind) {
  if (!axisLabelBuildResultExists(local)) {
    buildAxisLabel(cfg, local, group, kind, axisModel, api);
  }
  var labelLayoutList = local.labelLayoutList;
  updateAxisLabelChangableProps(cfg, axisModel, labelLayoutList, transformGroup);
  adjustBreakLabels(axisModel, cfg.rotation, labelLayoutList);
  var optionHideOverlap = cfg.optionHideOverlap;
  fixMinMaxLabelShow(axisModel, labelLayoutList, optionHideOverlap);
  if (optionHideOverlap) {
    hideOverlap(
      // Filter the already ignored labels by the previous overlap resolving methods.
      filter(labelLayoutList, function(layout2) {
        return layout2 && !layout2.label.ignore;
      })
    );
  }
  resetOverlapRecordToShared(cfg, shared, axisModel, labelLayoutList);
}
function endTextLayout(rotation, textPosition, textRotate, extent) {
  var rotationDiff = remRadian(textRotate - rotation);
  var textAlign;
  var textVerticalAlign;
  var inverse = extent[0] > extent[1];
  var onLeft = textPosition === "start" && !inverse || textPosition !== "start" && inverse;
  if (isRadianAroundZero(rotationDiff - PI5 / 2)) {
    textVerticalAlign = onLeft ? "bottom" : "top";
    textAlign = "center";
  } else if (isRadianAroundZero(rotationDiff - PI5 * 1.5)) {
    textVerticalAlign = onLeft ? "top" : "bottom";
    textAlign = "center";
  } else {
    textVerticalAlign = "middle";
    if (rotationDiff < PI5 * 1.5 && rotationDiff > PI5 / 2) {
      textAlign = onLeft ? "left" : "right";
    } else {
      textAlign = onLeft ? "right" : "left";
    }
  }
  return {
    rotation: rotationDiff,
    textAlign,
    textVerticalAlign
  };
}
function fixMinMaxLabelShow(axisModel, labelLayoutList, optionHideOverlap) {
  var axis = axisModel.axis;
  var customValuesOption = axisModel.get(["axisLabel", "customValues"]);
  if (shouldShowAllLabels(axis)) {
    return;
  }
  function deal(showMinMaxLabelOption, outmostLabelIdx, innerLabelIdx) {
    var outmostLabelLayout = ensureLabelLayoutWithGeometry(labelLayoutList[outmostLabelIdx]);
    var innerLabelLayout = ensureLabelLayoutWithGeometry(labelLayoutList[innerLabelIdx]);
    var scale3 = axis.scale;
    if (!outmostLabelLayout || !innerLabelLayout) {
      return;
    }
    if (showMinMaxLabelOption == null) {
      if (!optionHideOverlap && customValuesOption) {
        return;
      }
      var tick = getLabelInner(outmostLabelLayout.label).labelInfo.tick;
      if (
        // TimeScale does not expand extent to "nice", so eliminate labels that are not nice.
        isTimeScale(scale3) && tick.notNice || isOrdinalScale(scale3) && tick.offInterval
      ) {
        ignoreEl(outmostLabelLayout.label);
        return;
      }
    }
    if (showMinMaxLabelOption === false || outmostLabelLayout.suggestIgnore) {
      ignoreEl(outmostLabelLayout.label);
      return;
    }
    if (innerLabelLayout.suggestIgnore) {
      ignoreEl(innerLabelLayout.label);
      return;
    }
    var touchThreshold = 0.1;
    if (!optionHideOverlap) {
      var marginForce = [0, 0, 0, 0];
      outmostLabelLayout = newLabelLayoutWithGeometry({
        marginForce
      }, outmostLabelLayout);
      innerLabelLayout = newLabelLayoutWithGeometry({
        marginForce
      }, innerLabelLayout);
    }
    if (labelIntersect(outmostLabelLayout, innerLabelLayout, null, {
      touchThreshold
    })) {
      if (showMinMaxLabelOption) {
        ignoreEl(innerLabelLayout.label);
      } else {
        ignoreEl(outmostLabelLayout.label);
      }
    }
  }
  var showMinLabelOption = axisModel.get(["axisLabel", "showMinLabel"]);
  var showMaxLabelOption = axisModel.get(["axisLabel", "showMaxLabel"]);
  var labelsLen = labelLayoutList.length;
  deal(showMinLabelOption, 0, 1);
  deal(showMaxLabelOption, labelsLen - 1, labelsLen - 2);
}
function syncLabelIgnoreToMajorTicks(cfg, labelLayoutList, tickEls) {
  if (cfg.showMinorTicks) {
    return;
  }
  each(labelLayoutList, function(labelLayout) {
    if (labelLayout && labelLayout.label.ignore) {
      for (var idx = 0; idx < tickEls.length; idx++) {
        var tickEl = tickEls[idx];
        var tickInner = getTickInner(tickEl);
        var labelInner2 = getLabelInner(labelLayout.label);
        if (tickInner.tickValue != null && !tickInner.onBand && tickInner.tickValue === labelInner2.labelInfo.tick.value) {
          ignoreEl(tickEl);
          return;
        }
      }
    }
  });
}
function ignoreEl(el) {
  el && (el.ignore = true);
}
function createTicks(ticksCoords, tickTransform, tickEndCoord, tickLineStyle, anidPrefix) {
  var tickEls = [];
  var pt12 = [];
  var pt22 = [];
  for (var i = 0; i < ticksCoords.length; i++) {
    var tickCoord = ticksCoords[i].coord;
    pt12[0] = tickCoord;
    pt12[1] = 0;
    pt22[0] = tickCoord;
    pt22[1] = tickEndCoord;
    if (tickTransform) {
      applyTransform(pt12, pt12, tickTransform);
      applyTransform(pt22, pt22, tickTransform);
    }
    var tickEl = new Line_default({
      shape: {
        x1: pt12[0],
        y1: pt12[1],
        x2: pt22[0],
        y2: pt22[1]
      },
      style: tickLineStyle,
      z2: 2,
      autoBatch: true,
      silent: true
    });
    subPixelOptimizeLine2(tickEl.shape, tickEl.style.lineWidth);
    tickEl.anid = anidPrefix + "_" + ticksCoords[i].tickValue;
    tickEls.push(tickEl);
    var inner5 = getTickInner(tickEl);
    inner5.onBand = !!ticksCoords[i].onBand;
    inner5.tickValue = ticksCoords[i].tickValue;
  }
  return tickEls;
}
function buildAxisMajorTicks(cfg, group, transformGroup, axisModel) {
  var axis = axisModel.axis;
  var tickModel = axisModel.getModel("axisTick");
  var shown = tickModel.get("show");
  if (shown === "auto") {
    shown = true;
    if (cfg.raw.axisTickAutoShow != null) {
      shown = !!cfg.raw.axisTickAutoShow;
    }
  }
  if (!shown || axis.scale.isBlank()) {
    return [];
  }
  var lineStyleModel = tickModel.getModel("lineStyle");
  var tickEndCoord = cfg.tickDirection * tickModel.get("length");
  var ticksCoords = axis.getTicksCoords();
  var ticksEls = createTicks(ticksCoords, transformGroup.transform, tickEndCoord, defaults(lineStyleModel.getLineStyle(), {
    stroke: axisModel.get(["axisLine", "lineStyle", "color"])
  }), "ticks");
  for (var i = 0; i < ticksEls.length; i++) {
    group.add(ticksEls[i]);
  }
  return ticksEls;
}
function buildAxisMinorTicks(cfg, group, transformGroup, axisModel, tickDirection) {
  var axis = axisModel.axis;
  var minorTickModel = axisModel.getModel("minorTick");
  if (!cfg.showMinorTicks || axis.scale.isBlank()) {
    return;
  }
  var minorTicksCoords = axis.getMinorTicksCoords();
  if (!minorTicksCoords.length) {
    return;
  }
  var lineStyleModel = minorTickModel.getModel("lineStyle");
  var tickEndCoord = tickDirection * minorTickModel.get("length");
  var minorTickLineStyle = defaults(lineStyleModel.getLineStyle(), defaults(axisModel.getModel("axisTick").getLineStyle(), {
    stroke: axisModel.get(["axisLine", "lineStyle", "color"])
  }));
  for (var i = 0; i < minorTicksCoords.length; i++) {
    var minorTicksEls = createTicks(minorTicksCoords[i], transformGroup.transform, tickEndCoord, minorTickLineStyle, "minorticks_" + i);
    for (var k = 0; k < minorTicksEls.length; k++) {
      group.add(minorTicksEls[k]);
    }
  }
}
function dealLastTickLabelResultReusable(local, group, extraParams) {
  if (axisLabelBuildResultExists(local)) {
    var axisLabelsCreationContext = local.axisLabelsCreationContext;
    if (false) {
      assert(local.labelGroup && axisLabelsCreationContext);
    }
    var noPxChangeTryDetermine = axisLabelsCreationContext.out.noPxChangeTryDetermine;
    if (extraParams.noPxChange) {
      var canDetermine = true;
      for (var idx = 0; idx < noPxChangeTryDetermine.length; idx++) {
        canDetermine = canDetermine && noPxChangeTryDetermine[idx]();
      }
      if (canDetermine) {
        return false;
      }
    }
    if (noPxChangeTryDetermine.length) {
      group.remove(local.labelGroup);
      axisLabelBuildResultSet(local, null, null, null);
    }
  }
  return true;
}
function buildAxisLabel(cfg, local, group, kind, axisModel, api) {
  var axis = axisModel.axis;
  var show = retrieve(cfg.raw.axisLabelShow, axisModel.get(["axisLabel", "show"]));
  var labelGroup = new Group_default();
  group.add(labelGroup);
  var axisLabelCreationCtx = createAxisLabelsComputingContext(kind);
  if (!show || axis.scale.isBlank()) {
    axisLabelBuildResultSet(local, [], labelGroup, axisLabelCreationCtx);
    return;
  }
  var labelModel = axisModel.getModel("axisLabel");
  var labels = axis.getViewLabels(axisLabelCreationCtx);
  var labelRotation = (retrieve(cfg.raw.labelRotate, labelModel.get("rotate")) || 0) * PI5 / 180;
  var labelLayout = AxisBuilder.innerTextLayout(cfg.rotation, labelRotation, cfg.labelDirection);
  var rawCategoryData = axisModel.getCategories && axisModel.getCategories(true);
  var labelEls = [];
  var triggerEvent = axisModel.get("triggerEvent");
  var z2Min = Infinity;
  var z2Max = -Infinity;
  each(labels, function(labelItem, index) {
    var _a2;
    var labelItemTick = labelItem.tick;
    var formattedLabel = labelItem.formattedLabel;
    var rawLabel = labelItem.rawLabel;
    var itemLabelModel = labelModel;
    var tickValue = getTickValueOutermost(axis.scale, labelItemTick);
    if (rawCategoryData && rawCategoryData[tickValue]) {
      var rawCategoryItem = rawCategoryData[tickValue];
      if (isObject(rawCategoryItem) && rawCategoryItem.textStyle) {
        itemLabelModel = new Model_default(rawCategoryItem.textStyle, labelModel, axisModel.ecModel);
      }
    }
    var textColor = itemLabelModel.getTextColor() || axisModel.get(["axisLine", "lineStyle", "color"]);
    var align = itemLabelModel.getShallow("align", true) || labelLayout.textAlign;
    var alignMin = retrieve2(itemLabelModel.getShallow("alignMinLabel", true), align);
    var alignMax = retrieve2(itemLabelModel.getShallow("alignMaxLabel", true), align);
    var verticalAlign = itemLabelModel.getShallow("verticalAlign", true) || itemLabelModel.getShallow("baseline", true) || labelLayout.textVerticalAlign;
    var verticalAlignMin = retrieve2(itemLabelModel.getShallow("verticalAlignMinLabel", true), verticalAlign);
    var verticalAlignMax = retrieve2(itemLabelModel.getShallow("verticalAlignMaxLabel", true), verticalAlign);
    var z2 = 10 + (((_a2 = labelItemTick.time) === null || _a2 === void 0 ? void 0 : _a2.level) || 0);
    z2Min = Math.min(z2Min, z2);
    z2Max = Math.max(z2Max, z2);
    var textEl = new Text_default({
      // --- transform props start ---
      // All of the transform props MUST not be set here, but should be set in
      // `updateAxisLabelChangableProps`, because they may change in estimation,
      // and need to calculate based on global coord sys by `decomposeTransform`.
      x: 0,
      y: 0,
      rotation: 0,
      // --- transform props end ---
      silent: AxisBuilder.isLabelSilent(axisModel),
      z2,
      style: createTextStyle(itemLabelModel, {
        text: formattedLabel,
        align: index === 0 ? alignMin : index === labels.length - 1 ? alignMax : align,
        verticalAlign: index === 0 ? verticalAlignMin : index === labels.length - 1 ? verticalAlignMax : verticalAlign,
        fill: isFunction(textColor) ? textColor(
          // (1) In category axis with data zoom, tick is not the original
          // index of axis.data. So tick should not be exposed to user
          // in category axis.
          // (2) Compatible with previous version, which always use formatted label as
          // input. But in interval scale the formatted label is like '223,445', which
          // maked user replace ','. So we modify it to return original val but remain
          // it as 'string' to avoid error in replacing.
          axis.type === "category" ? rawLabel : axis.type === "value" ? tickValue + "" : tickValue,
          index
        ) : textColor
      })
    });
    textEl.anid = "label_" + tickValue;
    var inner5 = getLabelInner(textEl);
    inner5.labelInfo = labelItem;
    inner5.layoutRotation = labelLayout.rotation;
    setTooltipConfig({
      el: textEl,
      componentModel: axisModel,
      itemName: formattedLabel,
      formatterParamsExtra: {
        isTruncated: function() {
          return textEl.isTruncated;
        },
        value: rawLabel,
        tickIndex: index
      }
    });
    if (triggerEvent) {
      var eventData = AxisBuilder.makeAxisEventDataBase(axisModel);
      eventData.targetType = "axisLabel";
      eventData.value = rawLabel;
      eventData.tickIndex = index;
      var labelItemTickBreak = labelItem.tick["break"];
      if (labelItemTickBreak) {
        var labelItemTickBreakParsedBreak = labelItemTickBreak.parsedBreak;
        eventData["break"] = {
          // type: labelItem.break.type,
          start: labelItemTickBreakParsedBreak.vmin,
          end: labelItemTickBreakParsedBreak.vmax
        };
      }
      if (axis.type === "category") {
        eventData.dataIndex = tickValue;
      }
      getECData(textEl).eventData = eventData;
      if (labelItemTickBreak) {
        addBreakEventHandler(axisModel, api, textEl, labelItemTickBreak);
      }
    }
    labelEls.push(textEl);
    labelGroup.add(textEl);
  });
  var labelLayoutList = map(labelEls, function(label) {
    return {
      label,
      priority: getLabelInner(label).labelInfo.tick["break"] ? label.z2 + (z2Max - z2Min + 1) : label.z2,
      defaultAttr: {
        ignore: label.ignore
      }
    };
  });
  axisLabelBuildResultSet(local, labelLayoutList, labelGroup, axisLabelCreationCtx);
}
function axisLabelBuildResultExists(local) {
  return !!local.labelLayoutList;
}
function axisLabelBuildResultSet(local, labelLayoutList, labelGroup, axisLabelsCreationContext) {
  local.labelLayoutList = labelLayoutList;
  local.labelGroup = labelGroup;
  local.axisLabelsCreationContext = axisLabelsCreationContext;
}
function updateAxisLabelChangableProps(cfg, axisModel, labelLayoutList, transformGroup) {
  var labelMargin = axisModel.get(["axisLabel", "margin"]);
  each(labelLayoutList, function(layout2, idx) {
    var geometry = ensureLabelLayoutWithGeometry(layout2);
    if (!geometry) {
      return;
    }
    var labelEl = geometry.label;
    var inner5 = getLabelInner(labelEl);
    geometry.suggestIgnore = labelEl.ignore;
    labelEl.ignore = false;
    copyTransform(_tmpLayoutEl, _tmpLayoutElReset);
    var axis = axisModel.axis;
    _tmpLayoutEl.x = axis.dataToCoord(getTickValueOutermost(axis.scale, inner5.labelInfo.tick));
    _tmpLayoutEl.y = cfg.labelOffset + cfg.labelDirection * labelMargin;
    _tmpLayoutEl.rotation = inner5.layoutRotation;
    transformGroup.add(_tmpLayoutEl);
    _tmpLayoutEl.updateTransform();
    transformGroup.remove(_tmpLayoutEl);
    _tmpLayoutEl.decomposeTransform();
    copyTransform(labelEl, _tmpLayoutEl);
    labelEl.markRedraw();
    setLabelLayoutDirty(geometry, true);
    ensureLabelLayoutWithGeometry(geometry);
  });
}
var _tmpLayoutEl = new Rect_default();
var _tmpLayoutElReset = new Rect_default();
function hasAxisName(axisName) {
  return !!axisName;
}
function addBreakEventHandler(axisModel, api, textEl, visualBreak) {
  textEl.on("click", function(params) {
    var payload = {
      type: AXIS_BREAK_EXPAND_ACTION_TYPE,
      breaks: [{
        start: visualBreak.parsedBreak.breakOption.start,
        end: visualBreak.parsedBreak.breakOption.end
      }]
    };
    payload[axisModel.axis.dim + "AxisIndex"] = axisModel.componentIndex;
    api.dispatchAction(payload);
  });
}
function adjustBreakLabels(axisModel, axisRotation, labelLayoutList) {
  var scaleBreakHelper = getScaleBreakHelper();
  if (!scaleBreakHelper) {
    return;
  }
  var breakLabelIndexPairs = scaleBreakHelper.retrieveAxisBreakPairs(labelLayoutList, function(layoutInfo) {
    return layoutInfo && getLabelInner(layoutInfo.label).labelInfo.tick["break"];
  }, true);
  var moveOverlap = axisModel.get(["breakLabelLayout", "moveOverlap"], true);
  if (moveOverlap === true || moveOverlap === "auto") {
    each(breakLabelIndexPairs, function(idxPair) {
      getAxisBreakHelper().adjustBreakLabelPair(axisModel.axis.inverse, axisRotation, [ensureLabelLayoutWithGeometry(labelLayoutList[idxPair[0]]), ensureLabelLayoutWithGeometry(labelLayoutList[idxPair[1]])]);
    });
  }
}
var AxisBuilder_default = AxisBuilder;

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/coord/cartesian/cartesianAxisHelper.js
function layout(rect, axisModel, opt) {
  opt = opt || {};
  var axis = axisModel.axis;
  var layout2 = {};
  var otherAxisOnZeroOf = axis.getAxesOnZeroOf()[0];
  var rawAxisPosition = axis.position;
  var axisPosition = otherAxisOnZeroOf ? "onZero" : rawAxisPosition;
  var axisDim = axis.dim;
  var rectBound = [rect.x, rect.x + rect.width, rect.y, rect.y + rect.height];
  var idx = {
    left: 0,
    right: 1,
    top: 0,
    bottom: 1,
    onZero: 2
  };
  var axisOffset = axisModel.get("offset") || 0;
  var posBound = axisDim === "x" ? [rectBound[2] - axisOffset, rectBound[3] + axisOffset] : [rectBound[0] - axisOffset, rectBound[1] + axisOffset];
  if (otherAxisOnZeroOf) {
    var onZeroCoord = otherAxisOnZeroOf.toGlobalCoord(otherAxisOnZeroOf.dataToCoord(0));
    posBound[idx.onZero] = Math.max(Math.min(onZeroCoord, posBound[1]), posBound[0]);
  }
  layout2.position = [axisDim === "y" ? posBound[idx[axisPosition]] : rectBound[0], axisDim === "x" ? posBound[idx[axisPosition]] : rectBound[3]];
  layout2.rotation = Math.PI / 2 * (axisDim === "x" ? 0 : 1);
  var dirMap = {
    top: -1,
    bottom: 1,
    left: -1,
    right: 1
  };
  layout2.labelDirection = layout2.tickDirection = layout2.nameDirection = dirMap[rawAxisPosition];
  layout2.labelOffset = otherAxisOnZeroOf ? posBound[idx[rawAxisPosition]] - posBound[idx.onZero] : 0;
  if (axisModel.get(["axisTick", "inside"])) {
    layout2.tickDirection = -layout2.tickDirection;
  }
  if (retrieve(opt.labelInside, axisModel.get(["axisLabel", "inside"]))) {
    layout2.labelDirection = -layout2.labelDirection;
  }
  var labelRotate = axisModel.get(["axisLabel", "rotate"]);
  layout2.labelRotate = axisPosition === "top" ? -labelRotate : labelRotate;
  layout2.z2 = 1;
  return layout2;
}
function findAxisModels(seriesModel) {
  var axisModelMap = {
    xAxisModel: null,
    yAxisModel: null
  };
  each(axisModelMap, function(v, key2) {
    var axisType = key2.replace(/Model$/, "");
    var axisModel = seriesModel.getReferringComponents(axisType, SINGLE_REFERRING).models[0];
    if (false) {
      if (!axisModel) {
        throw new Error(axisType + ' "' + retrieve3(seriesModel.get(axisType + "Index"), seriesModel.get(axisType + "Id"), 0) + '" not found');
      }
    }
    axisModelMap[key2] = axisModel;
  });
  return axisModelMap;
}
function createCartesianAxisViewCommonPartBuilder(gridRect, cartesians, axisModel, api, ctx, defaultNameMoveOverlap) {
  var layoutResult = layout(gridRect, axisModel);
  var axisLineAutoShow = false;
  var axisTickAutoShow = false;
  for (var i = 0; i < cartesians.length; i++) {
    if (isIntervalOrLogScale(cartesians[i].getOtherAxis(axisModel.axis).scale)) {
      axisLineAutoShow = axisTickAutoShow = true;
      if (axisModel.axis.type === "category" && axisModel.axis.onBand) {
        axisTickAutoShow = false;
      }
    }
  }
  layoutResult.axisLineAutoShow = axisLineAutoShow;
  layoutResult.axisTickAutoShow = axisTickAutoShow;
  layoutResult.defaultNameMoveOverlap = defaultNameMoveOverlap;
  return new AxisBuilder_default(axisModel, api, layoutResult, ctx);
}
function updateCartesianAxisViewCommonPartBuilder(axisBuilder, gridRect, axisModel) {
  var newRaw = layout(gridRect, axisModel);
  if (false) {
    var oldRaw_1 = axisBuilder.__getRawCfg();
    each(keys(newRaw), function(prop) {
      if (prop !== "position" && prop !== "labelOffset") {
        assert(newRaw[prop] === oldRaw_1[prop]);
      }
    });
  }
  axisBuilder.updateCfg(newRaw);
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/coord/scaleRawExtentInfo.js
var scaleInner = makeInner();
var AXIS_EXTENT_INFO_BUILD_FROM_COORD_SYS_UPDATE = 1;
var AXIS_EXTENT_INFO_BUILD_FROM_EMPTY = 3;
var ScaleRawExtentInfo = (
  /** @class */
  (function() {
    function ScaleRawExtentInfo2(scale3, model, dataExtent, requireStartValue, requireContainShape) {
      var isOrdinal = isOrdinalScale(scale3);
      var axisDataLen = isOrdinal ? model.getCategories().length : null;
      var categoryAxisModelDataIsEmptyArray;
      if (isOrdinal) {
        var axisModelDataArray = model.getCategories(true);
        categoryAxisModelDataIsEmptyArray = axisModelDataArray && !axisModelDataArray.length;
      }
      var dataMM = dataExtent.slice();
      if (isIntervalScale(scale3) || isLogScale(scale3) || isTimeScale(scale3)) {
        unionExtentStartFromNumber(dataMM, parseAxisModelMinMax(scale3, model.get("dataMin", true)));
        unionExtentEndFromNumber(dataMM, parseAxisModelMinMax(scale3, model.get("dataMax", true)));
      }
      if (!extentHasValue(dataMM)) {
        dataMM[0] = dataMM[1] = NaN;
      }
      var noZoomEffMM = [];
      var fixMM = [false, false];
      var modelMinRaw = model.get("min", true);
      if (modelMinRaw === "dataMin") {
        noZoomEffMM[0] = dataMM[0];
        fixMM[0] = true;
      } else {
        noZoomEffMM[0] = parseAxisModelMinMax(scale3, isFunction(modelMinRaw) ? modelMinRaw({
          min: dataMM[0],
          max: dataMM[1]
        }) : modelMinRaw);
        fixMM[0] = noZoomEffMM[0] != null;
      }
      var modelMaxRaw = model.get("max", true);
      if (modelMaxRaw === "dataMax") {
        noZoomEffMM[1] = dataMM[1];
        fixMM[1] = true;
      } else {
        noZoomEffMM[1] = parseAxisModelMinMax(scale3, isFunction(modelMaxRaw) ? modelMaxRaw({
          min: dataMM[0],
          max: dataMM[1]
        }) : modelMaxRaw);
        fixMM[1] = noZoomEffMM[1] != null;
      }
      var boundaryGap = parseBoundaryGapOption(scale3, model);
      var span = !isOrdinal ? dataMM[1] - dataMM[0] || Math.abs(dataMM[0]) : null;
      if (noZoomEffMM[0] == null) {
        noZoomEffMM[0] = isOrdinal ? categoryAxisModelDataIsEmptyArray ? dataMM[0] : axisDataLen ? 0 : NaN : dataMM[0] - boundaryGap[0] * span;
      }
      if (noZoomEffMM[1] == null) {
        noZoomEffMM[1] = isOrdinal ? categoryAxisModelDataIsEmptyArray ? dataMM[1] : axisDataLen ? axisDataLen - 1 : NaN : dataMM[1] + boundaryGap[1] * span;
      }
      !isValidNumberForExtent(noZoomEffMM[0]) && (noZoomEffMM[0] = NaN);
      !isValidNumberForExtent(noZoomEffMM[1]) && (noZoomEffMM[1] = NaN);
      var isBlank = categoryAxisModelDataIsEmptyArray || eqNaN(noZoomEffMM[0]) || eqNaN(noZoomEffMM[1]) || isOrdinal && !axisDataLen;
      var needIncludeZeroApplicable = isIntervalScale(scale3);
      var needIncludeZero = needIncludeZeroApplicable && model.needIncludeZero && model.needIncludeZero();
      if (needIncludeZero) {
        if (noZoomEffMM[0] > 0 && noZoomEffMM[1] > 0 && !fixMM[0]) {
          noZoomEffMM[0] = 0;
        }
        if (noZoomEffMM[0] < 0 && noZoomEffMM[1] < 0 && !fixMM[1]) {
          noZoomEffMM[1] = 0;
        }
      }
      var needToggleAxisInverse = false;
      if (noZoomEffMM[0] > noZoomEffMM[1]) {
        noZoomEffMM.reverse();
        needToggleAxisInverse = true;
      }
      var startValue = parseAxisModelMinMax(scale3, model.get("startValue", true));
      var startValueSpecified = startValue != null;
      if (!isNullableNumberFinite(startValue) && requireStartValue) {
        startValue = scale3.getDefaultStartValue ? scale3.getDefaultStartValue() : 0;
      }
      if (isNullableNumberFinite(startValue) && (startValueSpecified || !needIncludeZeroApplicable || needIncludeZero)) {
        if (startValue < noZoomEffMM[0] && !fixMM[0]) {
          noZoomEffMM[0] = startValue;
          fixMM[0] = true;
        } else if (startValue > noZoomEffMM[1] && !fixMM[1]) {
          noZoomEffMM[1] = startValue;
          fixMM[1] = true;
        }
      }
      var internal = this._i = {
        scale: scale3,
        dataMM,
        noZoomEffMM,
        zoomMM: [],
        fixMM,
        zoomFixMM: [false, false],
        startValue,
        isBlank,
        incl0: needIncludeZero,
        tggAxInv: needToggleAxisInverse,
        ctnShp: requireContainShape
      };
      sanitizeExtent(internal, noZoomEffMM);
    }
    ScaleRawExtentInfo2.prototype.makeNoZoom = function() {
      return this._i.noZoomEffMM.slice();
    };
    ScaleRawExtentInfo2.prototype.makeFinal = function() {
      var internal = this._i;
      var zoomMM = internal.zoomMM;
      var noZoomEffMM = internal.noZoomEffMM;
      var zoomFixMM = internal.zoomFixMM;
      var fixMM = internal.fixMM;
      var result = {
        fixMM,
        zoomFixMM,
        isBlank: internal.isBlank,
        incl0: internal.incl0,
        tggAxInv: internal.tggAxInv,
        ctnShp: internal.ctnShp,
        effMM: noZoomEffMM.slice()
      };
      var effMM = result.effMM;
      if (zoomMM[0] != null) {
        effMM[0] = zoomMM[0];
        fixMM[0] = zoomFixMM[0] = true;
      }
      if (zoomMM[1] != null) {
        effMM[1] = zoomMM[1];
        fixMM[1] = zoomFixMM[1] = true;
      }
      sanitizeExtent(internal, effMM);
      return result;
    };
    ScaleRawExtentInfo2.prototype.makeRenderInfo = function() {
      return {
        startValue: this._i.startValue
      };
    };
    ScaleRawExtentInfo2.prototype.setZoomMM = function(idxMinMax, val) {
      this._i.zoomMM[idxMinMax] = val;
    };
    return ScaleRawExtentInfo2;
  })()
);
function sanitizeExtent(internal, mm) {
  var scale3 = internal.scale;
  var dataMM = internal.dataMM;
  if (scale3.sanitize) {
    mm[0] = scale3.sanitize(mm[0], dataMM);
    mm[1] = scale3.sanitize(mm[1], dataMM);
    ensureExtentAscSimply(mm);
  }
}
function parseAxisModelMinMax(scale3, minMax) {
  return minMax == null ? null : eqNaN(minMax) ? NaN : scale3.parse(minMax);
}
function parseBoundaryGapOption(scale3, model) {
  var boundaryGapOptionArr;
  if (isOrdinalScale(scale3)) {
    boundaryGapOptionArr = [0, 0];
  } else {
    var boundaryGap = model.get("boundaryGap");
    if (typeof boundaryGap === "boolean") {
      if (false) {
        if (boundaryGap === true) {
          console.warn('Boolean type for boundaryGap is only allowed for ordinal axis. Please use string in percentage instead, e.g., "20%". Currently, boundaryGap is set to 0.');
        }
      }
      boundaryGap = null;
    }
    boundaryGapOptionArr = isArray(boundaryGap) ? boundaryGap : [boundaryGap, boundaryGap];
  }
  return [parseBoundaryGapOptionItem(boundaryGapOptionArr[0]), parseBoundaryGapOptionItem(boundaryGapOptionArr[1])];
}
function parseBoundaryGapOptionItem(opt) {
  return parsePercent2(typeof opt === "boolean" ? 0 : opt, 1) || 0;
}
function ensureScaleStore(axisLike) {
  var store = scaleInner(axisLike.scale);
  if (!store.extent) {
    store.extent = initExtentForUnion();
  }
  return store;
}
function scaleRawExtentInfoEnableBoxCoordSysUsage(axisLike, coordSysDimIdxMap) {
  ensureScaleStore(axisLike).dimIdxInCoord = coordSysDimIdxMap.get(axisLike.dim);
}
function scaleRawExtentInfoCreate(axis, from) {
  var scale3 = axis.scale;
  var model = axis.model;
  var axisDim = axis.dim;
  if (false) {
    assert(scale3 && model && axisDim);
  }
  if (scale3.rawExtentInfo) {
    if (false) {
      assert(scale3.rawExtentInfo.from !== from || from === AXIS_EXTENT_INFO_BUILD_FROM_DATA_ZOOM);
    }
    return;
  }
  scaleRawExtentInfoCreateDeal(scale3, axis, axisDim, model, from);
}
function scaleRawExtentInfoCreateDeal(scale3, axis, axisDim, model, from) {
  var scaleStore = ensureScaleStore(axis);
  var extent = scaleStore.extent;
  var requireStartValue = false;
  eachSeriesOnAxis(axis, function(seriesModel) {
    if (seriesModel.boxCoordinateSystem) {
      var coord = getCoordForCoordSysUsageKindBox(seriesModel).coord;
      var dimIdx = scaleStore.dimIdxInCoord;
      if (!(dimIdx >= 0)) {
        if (false) {
          error('Property "series.coord" is not supported on axis ' + seriesModel.boxCoordinateSystem.type + ".");
        }
      } else if (isArray(coord)) {
        var coordItem = coord[dimIdx];
        if (coordItem != null && !isArray(coordItem)) {
          unionExtentFromNumber(extent, scale3.parse(coordItem));
        }
      }
    } else if (seriesModel.coordinateSystem) {
      var data_1 = seriesModel.getData();
      if (data_1) {
        var filter_1 = scale3.getFilter ? scale3.getFilter() : null;
        each(getDataDimensionsOnAxis(data_1, axisDim), function(dim) {
          unionExtentFromExtent(extent, data_1.getApproximateExtent(dim, filter_1));
        });
      }
      if (seriesModel.__requireStartValue && seriesModel.__requireStartValue(axis)) {
        requireStartValue = true;
      }
    }
  });
  var requireContainShape = determineRequireContainShape(scale3, axis, model);
  var rawExtentInfo = new ScaleRawExtentInfo(scale3, model, extent, requireStartValue, requireContainShape);
  injectScaleRawExtentInfo(scale3, rawExtentInfo, from);
  scaleStore.extent = null;
}
function scaleRawExtentInfoBuildDefault(axisLike, dataExtent) {
  var scale3 = axisLike.scale;
  if (false) {
    assert(!scale3.rawExtentInfo);
  }
  injectScaleRawExtentInfo(scale3, new ScaleRawExtentInfo(scale3, axisLike.model, dataExtent, false, false), AXIS_EXTENT_INFO_BUILD_FROM_EMPTY);
}
function injectScaleRawExtentInfo(scale3, scaleRawExtentInfo, from) {
  scale3.rawExtentInfo = scaleRawExtentInfo;
  scaleRawExtentInfo.from = from;
}
var axisContainShapeHandlerMap = createHashMap();
function adoptScaleRawExtentInfoAndPrepare(scale3, model, ecModel, axis, externalDataExtent) {
  if (false) {
    assert(!externalDataExtent || !scale3.rawExtentInfo);
  }
  if (!scale3.rawExtentInfo) {
    scaleRawExtentInfoBuildDefault({
      scale: scale3,
      model
    }, externalDataExtent || initExtentForUnion());
  }
  var rawExtentResult = scale3.rawExtentInfo.makeFinal();
  var effectiveMinMax = rawExtentResult.effMM;
  scale3.setExtent(effectiveMinMax[0], effectiveMinMax[1]);
  scale3.setBlank(rawExtentResult.isBlank);
  if (axis && rawExtentResult.tggAxInv && ecModel && !ecModel.get("legacyMinMaxDontInverseAxis")) {
    axis.inverse = !axis.inverse;
  }
  return rawExtentResult;
}
function determineRequireContainShape(scale3, axis, model) {
  var onBand = isAxisOnBand(scale3, model);
  var modelContainShape = model.get("containShape", true);
  if (modelContainShape == null && !onBand) {
    modelContainShape = true;
  }
  if (!modelContainShape) {
    return false;
  }
  var requireContainShape = false;
  eachKeyOnAxis(axis, function(axisStatKey) {
    requireContainShape = !!axisContainShapeHandlerMap.get(axisStatKey) || requireContainShape;
  });
  return requireContainShape;
}
function adoptScaleExtentKindMapping(axis, scale3, rawExtentResult, ecModel) {
  if (!rawExtentResult.ctnShp) {
    return;
  }
  var linearSupplement;
  eachKeyOnAxis(axis, function(axisStatKey) {
    var handler = axisContainShapeHandlerMap.get(axisStatKey);
    if (handler) {
      var singleLinearSupplement = handler(axis, ecModel);
      if (singleLinearSupplement) {
        linearSupplement = linearSupplement || [0, 0];
        unionExtentStartFromNumber(linearSupplement, singleLinearSupplement[0]);
        unionExtentEndFromNumber(linearSupplement, singleLinearSupplement[1]);
        discourageOnAxisZero(axis);
      }
    }
  });
  if (!linearSupplement) {
    return;
  }
  var scaleExtent = scale3.getExtent();
  if (isOrdinalScale(scale3)) {
    if (!axis.onBand) {
      scale3.setExtent2(SCALE_EXTENT_KIND_MAPPING, mathMin(scaleExtent[0], scaleExtent[0] + linearSupplement[0]), mathMax(scaleExtent[1], scaleExtent[1] + linearSupplement[1]));
    }
  } else {
    var scaleExtentExpanded = scaleExtent.slice();
    if (!rawExtentResult.zoomFixMM[0]) {
      scaleExtentExpanded[0] = mathMin(scaleExtentExpanded[0], scale3.transformOut(scale3.transformIn(scaleExtentExpanded[0], null) + linearSupplement[0], null));
    }
    if (!rawExtentResult.zoomFixMM[1]) {
      scaleExtentExpanded[1] = mathMax(scaleExtentExpanded[1], scale3.transformOut(scale3.transformIn(scaleExtentExpanded[1], null) + linearSupplement[1], null));
    }
    if (scaleExtentExpanded[0] < scaleExtent[0] || scaleExtentExpanded[1] > scaleExtent[1]) {
      scale3.setExtent2(SCALE_EXTENT_KIND_MAPPING, scaleExtentExpanded[0], scaleExtentExpanded[1]);
    }
  }
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/coord/axisAlignTicks.js
function scaleCalcAlign(targetAxis, alignToScale) {
  var targetScale = targetAxis.scale;
  var targetAxisModel = targetAxis.model;
  if (false) {
    assert(targetScale && targetAxisModel && (targetScale instanceof Interval_default || targetScale instanceof Log_default) && (alignToScale instanceof Interval_default || alignToScale instanceof Log_default));
  }
  var targetExtentInfo = adoptScaleRawExtentInfoAndPrepare(targetScale, targetAxisModel, targetAxisModel.ecModel, targetAxis, null);
  var isTargetLogScale = isLogScale(targetScale);
  var alignToScaleLinear = isLogScale(alignToScale) ? alignToScale.intervalStub : alignToScale;
  var targetIntervalStub = isTargetLogScale ? targetScale.intervalStub : targetScale;
  var targetLogScaleBase = targetScale.base;
  var alignToTicks = alignToScaleLinear.getTicks();
  var alignToExpNiceTicks = alignToScaleLinear.getTicks({
    expandToNicedExtent: true
  });
  var alignToSegCount = alignToTicks.length - 1;
  if (false) {
    assert(!hasBreaks(alignToScale) && !hasBreaks(targetScale));
    assert(alignToSegCount > 0);
    assert(alignToExpNiceTicks.length === alignToTicks.length);
    assert(alignToTicks[0].value <= alignToTicks[alignToSegCount].value);
    assert(alignToExpNiceTicks[0].value <= alignToTicks[0].value && alignToTicks[alignToSegCount].value <= alignToExpNiceTicks[alignToSegCount].value);
    if (alignToSegCount >= 2) {
      assert(alignToExpNiceTicks[1].value === alignToTicks[1].value);
      assert(alignToExpNiceTicks[alignToSegCount - 1].value === alignToTicks[alignToSegCount - 1].value);
    }
  }
  var t0;
  var t1;
  var alignToNiceSegCount;
  if (alignToSegCount === 1) {
    t0 = t1 = 0;
    alignToNiceSegCount = 1;
  } else if (alignToSegCount === 2) {
    var interval0 = mathAbs(alignToTicks[0].value - alignToTicks[1].value);
    var interval1 = mathAbs(alignToTicks[1].value - alignToTicks[2].value);
    t0 = t1 = 0;
    if (interval0 === interval1) {
      alignToNiceSegCount = 2;
    } else {
      alignToNiceSegCount = 1;
      if (interval0 < interval1) {
        t0 = interval0 / interval1;
      } else {
        t1 = interval1 / interval0;
      }
    }
  } else {
    var alignToInterval = alignToScaleLinear.getConfig().interval;
    t0 = (1 - (alignToTicks[0].value - alignToExpNiceTicks[0].value) / alignToInterval) % 1;
    t1 = (1 - (alignToExpNiceTicks[alignToSegCount].value - alignToTicks[alignToSegCount].value) / alignToInterval) % 1;
    alignToNiceSegCount = alignToSegCount - (t0 ? 1 : 0) - (t1 ? 1 : 0);
  }
  if (false) {
    assert(alignToNiceSegCount >= 1);
  }
  var dataZoomFixMinMax = targetExtentInfo.zoomFixMM;
  var hasDataZoomFixMinMax = dataZoomFixMinMax[0] || dataZoomFixMinMax[1];
  var targetMinMaxFixed = [targetExtentInfo.fixMM[0] || hasDataZoomFixMinMax, targetExtentInfo.fixMM[1] || hasDataZoomFixMinMax];
  var targetOldOutermostExtent = targetScale.getExtent();
  var targetOldIntervalExtent = targetIntervalStub.getExtent();
  var targetExtent = intervalScaleEnsureValidExtent(targetOldIntervalExtent, targetMinMaxFixed);
  var min3;
  var max3;
  var interval;
  var intervalPrecision;
  var maxNice;
  var minNice;
  function loopIncreaseInterval(cb) {
    var LOOP_MAX = 50;
    var loopGuard = 0;
    for (; loopGuard < LOOP_MAX; loopGuard++) {
      if (cb()) {
        break;
      }
      interval = isTargetLogScale ? interval * mathMax(targetLogScaleBase, 2) : increaseInterval(interval);
      intervalPrecision = getIntervalPrecision(interval);
    }
    if (false) {
      if (loopGuard >= LOOP_MAX) {
        warn("incorrect impl in `scaleCalcAlign`.");
      }
    }
  }
  function updateMinFromMinNice() {
    min3 = round(minNice - interval * t0, intervalPrecision);
  }
  function updateMaxFromMaxNice() {
    max3 = round(maxNice + interval * t1, intervalPrecision);
  }
  function updateMinNiceFromMinT0Interval() {
    minNice = t0 ? round(min3 + interval * t0, intervalPrecision) : min3;
  }
  function updateMaxNiceFromMaxT1Interval() {
    maxNice = t1 ? round(max3 - interval * t1, intervalPrecision) : max3;
  }
  if (targetMinMaxFixed[0] && targetMinMaxFixed[1]) {
    min3 = targetExtent[0];
    max3 = targetExtent[1];
    interval = (max3 - min3) / (alignToNiceSegCount + t0 + t1);
    var axisPxExtent = targetAxis.getExtent();
    var pxSpan = mathAbs(axisPxExtent[1] - axisPxExtent[0]);
    intervalPrecision = getAcceptableTickPrecision([max3, min3], pxSpan, 0.5 / alignToNiceSegCount);
    updateMinNiceFromMinT0Interval();
    updateMaxNiceFromMaxT1Interval();
    if (isNullableNumberFinite(intervalPrecision)) {
      interval = round(interval, intervalPrecision);
    }
  } else {
    var targetSpan = targetExtent[1] - targetExtent[0];
    interval = isTargetLogScale ? mathMax(quantity(targetSpan), 1) : nice(targetSpan / alignToNiceSegCount, NICE_MODE_MIN);
    intervalPrecision = getIntervalPrecision(interval);
    if (targetMinMaxFixed[0]) {
      min3 = targetExtent[0];
      loopIncreaseInterval(function() {
        updateMinNiceFromMinT0Interval();
        maxNice = round(minNice + interval * alignToNiceSegCount, intervalPrecision);
        updateMaxFromMaxNice();
        if (max3 >= targetExtent[1]) {
          return true;
        }
      });
    } else if (targetMinMaxFixed[1]) {
      max3 = targetExtent[1];
      loopIncreaseInterval(function() {
        updateMaxNiceFromMaxT1Interval();
        minNice = round(maxNice - interval * alignToNiceSegCount, intervalPrecision);
        updateMinFromMinNice();
        if (min3 <= targetExtent[0]) {
          return true;
        }
      });
    } else {
      loopIncreaseInterval(function() {
        minNice = round(mathCeil(targetExtent[0] / interval) * interval, intervalPrecision);
        maxNice = round(mathFloor(targetExtent[1] / interval) * interval, intervalPrecision);
        var currIntervalCount = mathRound((maxNice - minNice) / interval);
        if (currIntervalCount <= alignToNiceSegCount) {
          var moreCount = alignToNiceSegCount - currIntervalCount;
          var moreCountPair = void 0;
          var mayEnhanceZero = targetExtentInfo.incl0 || isTargetLogScale;
          if (mayEnhanceZero && targetExtent[0] === 0) {
            moreCountPair = [0, moreCount];
          } else if (mayEnhanceZero && targetExtent[1] === 0) {
            moreCountPair = [moreCount, 0];
          } else {
            var lessHalfCount = mathFloor(moreCount / 2);
            moreCountPair = moreCount % 2 === 0 ? [lessHalfCount, lessHalfCount] : min3 + max3 < targetExtent[0] + targetExtent[1] ? [lessHalfCount, lessHalfCount + 1] : [lessHalfCount + 1, lessHalfCount];
          }
          minNice = round(minNice - interval * moreCountPair[0], intervalPrecision);
          maxNice = round(maxNice + interval * moreCountPair[1], intervalPrecision);
          updateMinFromMinNice();
          updateMaxFromMaxNice();
          if (min3 <= targetExtent[0] && max3 >= targetExtent[1]) {
            return true;
          }
        }
      });
    }
  }
  updateIntervalOrLogScaleForNiceOrAligned(targetScale, targetMinMaxFixed, targetOldIntervalExtent, [min3, max3], targetOldOutermostExtent, {
    // NOTE: Even in LogScale, `interval` should not be in log space.
    interval,
    // Force ticks count, otherwise cumulative error may cause more unexpected ticks to be generated.
    // Though the overlapping tick labels may be auto-ignored, but probably unexpected, e.g., the min
    // tick label is ignored but the secondary min tick label is shown, which is unexpected when
    // `axis.min` is user-specified or dataZoom-specified.
    intervalCount: alignToNiceSegCount,
    intervalPrecision,
    niceExtent: [minNice, maxNice]
  });
  if (false) {
    targetScale.freeze();
  }
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/coord/axisNiceTicks.js
function calcNiceForIntervalOrLogScale(scale3, opt) {
  var isTargetLogScale = isLogScale(scale3);
  var intervalStub = isTargetLogScale ? scale3.intervalStub : scale3;
  var fixMinMax = opt.fixMinMax || [];
  var oldOutermostExtent = isTargetLogScale ? scale3.getExtent() : null;
  var oldIntervalExtent = intervalStub.getExtent();
  var newIntervalExtent = intervalScaleEnsureValidExtent(oldIntervalExtent, fixMinMax, opt.rawExtentResult);
  intervalStub.setExtent(newIntervalExtent[0], newIntervalExtent[1]);
  newIntervalExtent = intervalStub.getExtent();
  var config = isTargetLogScale ? logScaleCalcNiceTicks(intervalStub, opt) : intervalScaleCalcNiceTicks(intervalStub, opt);
  var autoIntervalPrecision = config.intervalPrecision;
  var autoInterval = config.interval;
  var userInterval = opt.userInterval;
  if (userInterval != null) {
    config.interval = userInterval;
    config.intervalPrecision = getIntervalPrecision(userInterval);
  }
  if (!fixMinMax[0]) {
    newIntervalExtent[0] = round(mathFloor(newIntervalExtent[0] / autoInterval) * autoInterval, autoIntervalPrecision);
  }
  if (!fixMinMax[1]) {
    newIntervalExtent[1] = round(mathCeil(newIntervalExtent[1] / autoInterval) * autoInterval, autoIntervalPrecision);
  }
  if (userInterval != null) {
    config.niceExtent = newIntervalExtent.slice();
  }
  updateIntervalOrLogScaleForNiceOrAligned(scale3, fixMinMax, oldIntervalExtent, newIntervalExtent, oldOutermostExtent, config);
}
function intervalScaleCalcNiceTicks(scale3, opt) {
  var splitNumber = ensureValidSplitNumber(opt.splitNumber, 5);
  var span = getScaleLinearSpanEffective(scale3);
  if (false) {
    assert(isFinite(span) && span > 0);
  }
  var minInterval = opt.minInterval;
  var maxInterval = opt.maxInterval;
  var interval = nice(span / splitNumber, true);
  if (minInterval != null && interval < minInterval) {
    interval = minInterval;
  }
  if (maxInterval != null && interval > maxInterval) {
    interval = maxInterval;
  }
  var intervalPrecision = getIntervalPrecision(interval);
  var extent = scale3.getExtent();
  var niceExtent = [round(mathCeil(extent[0] / interval) * interval, intervalPrecision), round(mathFloor(extent[1] / interval) * interval, intervalPrecision)];
  return {
    interval,
    intervalPrecision,
    niceExtent
  };
}
function logScaleCalcNiceTicks(intervalStub, opt) {
  var splitNumber = ensureValidSplitNumber(opt.splitNumber, 10);
  var intervalExtent = intervalStub.getExtent();
  var span = getScaleLinearSpanEffective(intervalStub);
  if (false) {
    assert(isFinite(span) && span > 0);
  }
  var interval = mathMax(quantity(span), 1);
  var err = splitNumber / span * interval;
  if (err <= 0.5) {
    interval *= 10;
  }
  var intervalPrecision = getIntervalPrecision(interval);
  var niceExtent = [round(mathCeil(intervalExtent[0] / interval) * interval, intervalPrecision), round(mathFloor(intervalExtent[1] / interval) * interval, intervalPrecision)];
  return {
    intervalPrecision,
    interval,
    niceExtent
  };
}
function scaleCalcNice(axisLike) {
  var scale3 = axisLike.scale;
  var model = axisLike.model;
  var axis = model.axis;
  var ecModel = model.ecModel;
  if (false) {
    assert(axis && ecModel);
  }
  scaleCalcNice2(scale3, model, axis, ecModel, null);
}
function scaleCalcNice2(scale3, model, axis, ecModel, externalDataExtent) {
  var rawExtentResult = adoptScaleRawExtentInfoAndPrepare(scale3, model, ecModel, axis, externalDataExtent);
  var isIntervalOrTime = isIntervalScale(scale3) || isTimeScale(scale3);
  scaleCalcNiceDirectly(scale3, {
    splitNumber: model.get("splitNumber"),
    fixMinMax: rawExtentResult.fixMM,
    userInterval: model.get("interval"),
    minInterval: isIntervalOrTime ? model.get("minInterval") : null,
    maxInterval: isIntervalOrTime ? model.get("maxInterval") : null,
    rawExtentResult
  });
  if (axis && ecModel) {
    adoptScaleExtentKindMapping(axis, scale3, rawExtentResult, ecModel);
  }
  if (false) {
    scale3.freeze();
  }
}
function scaleCalcNiceDirectly(scale3, opt) {
  scaleCalcNiceMethods[scale3.type](scale3, opt);
}
var scaleCalcNiceMethods = {
  interval: calcNiceForIntervalOrLogScale,
  log: calcNiceForIntervalOrLogScale,
  time: calcNiceForTimeScale,
  ordinal: noop
};

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/coord/cartesian/Grid.js
var XY_TO_MARGIN_IDX = [
  [3, 1],
  [0, 2]
  // xyIdx 1 => 'y'
];
var Grid = (
  /** @class */
  (function() {
    function Grid2(gridModel, ecModel, api) {
      this.type = "grid";
      this._coordsMap = {};
      this._coordsList = [];
      this._axesMap = {};
      this._axesList = [];
      this.axisPointerEnabled = true;
      this.dimensions = cartesian2DDimensions;
      this._initCartesian(gridModel, ecModel, api);
      this.model = gridModel;
    }
    Grid2.prototype.getRect = function() {
      return this._rect;
    };
    Grid2.prototype.update = function(ecModel, api) {
      var axesMap = this._axesMap;
      each(this._axesList, function(axis) {
        scaleRawExtentInfoCreate(axis, AXIS_EXTENT_INFO_BUILD_FROM_COORD_SYS_UPDATE);
        var scale3 = axis.scale;
        if (isOrdinalScale(scale3)) {
          scale3.setSortInfo(axis.model.get("categorySortInfo"));
        }
      });
      function updateAxisTicks(axes) {
        var axesIndices = keys(axes);
        var axisNeedsAlign = [];
        for (var i = axesIndices.length - 1; i >= 0; i--) {
          var axis = axes[+axesIndices[i]];
          if (axis.__alignTo) {
            axisNeedsAlign.push(axis);
          } else {
            scaleCalcNice(axis);
          }
        }
        ;
        each(axisNeedsAlign, function(axis2) {
          if (incapableOfAlignNeedFallback(axis2, axis2.__alignTo)) {
            scaleCalcNice(axis2);
          } else {
            scaleCalcAlign(axis2, axis2.__alignTo.scale);
          }
        });
      }
      updateAxisTicks(axesMap.x);
      updateAxisTicks(axesMap.y);
      var onZeroRecords = {};
      each(axesMap.x, function(xAxis) {
        fixAxisOnZero(axesMap, "y", xAxis, onZeroRecords);
      });
      each(axesMap.y, function(yAxis) {
        fixAxisOnZero(axesMap, "x", yAxis, onZeroRecords);
      });
      this.resize(this.model, api);
    };
    Grid2.prototype.resize = function(gridModel, api, beforeDataProcessing) {
      var layoutRef = createBoxLayoutReference(gridModel, api);
      var gridRect = this._rect = getLayoutRect(gridModel.getBoxLayoutParams(), layoutRef.refContainer);
      var axesMap = this._axesMap;
      var coordsList = this._coordsList;
      var optionContainLabel = gridModel.get("containLabel");
      updateAllAxisExtentTransByGridRect(axesMap, gridRect);
      if (!beforeDataProcessing) {
        var axisBuilderSharedCtx = createAxisBiulders(gridRect, coordsList, axesMap, optionContainLabel, api);
        var noPxChange = void 0;
        if (optionContainLabel) {
          if (legacyLayOutGridByContainLabel) {
            legacyLayOutGridByContainLabel(this._axesList, gridRect);
            updateAllAxisExtentTransByGridRect(axesMap, gridRect);
          } else {
            if (false) {
              log("Specified `grid.containLabel` but no `use(LegacyGridContainLabel)`;use `grid.outerBounds` instead.", true);
            }
            noPxChange = layOutGridByOuterBounds(gridRect.clone(), "axisLabel", null, gridRect, axesMap, axisBuilderSharedCtx, layoutRef);
          }
        } else {
          var _a2 = prepareOuterBounds(gridModel, gridRect, layoutRef), outerBoundsRect = _a2.outerBoundsRect, parsedOuterBoundsContain = _a2.parsedOuterBoundsContain, outerBoundsClamp = _a2.outerBoundsClamp;
          if (outerBoundsRect) {
            noPxChange = layOutGridByOuterBounds(outerBoundsRect, parsedOuterBoundsContain, outerBoundsClamp, gridRect, axesMap, axisBuilderSharedCtx, layoutRef);
          }
        }
        createOrUpdateAxesView(gridRect, axesMap, AxisTickLabelComputingKind.determine, null, noPxChange, layoutRef);
        each(this._coordsList, function(coord) {
          coord.calcAffineTransform();
        });
      }
    };
    Grid2.prototype.getAxis = function(dim, axisIndex) {
      var axesMapOnDim = this._axesMap[dim];
      if (axesMapOnDim != null) {
        return axesMapOnDim[axisIndex || 0];
      }
    };
    Grid2.prototype.getAxes = function() {
      return this._axesList.slice();
    };
    Grid2.prototype.getCartesian = function(xAxisIndex, yAxisIndex) {
      if (xAxisIndex != null && yAxisIndex != null) {
        var key2 = "x" + xAxisIndex + "y" + yAxisIndex;
        return this._coordsMap[key2];
      }
      if (isObject(xAxisIndex)) {
        yAxisIndex = xAxisIndex.yAxisIndex;
        xAxisIndex = xAxisIndex.xAxisIndex;
      }
      for (var i = 0, coordList = this._coordsList; i < coordList.length; i++) {
        if (coordList[i].getAxis("x").index === xAxisIndex || coordList[i].getAxis("y").index === yAxisIndex) {
          return coordList[i];
        }
      }
    };
    Grid2.prototype.getCartesians = function() {
      return this._coordsList.slice();
    };
    Grid2.prototype.convertToPixel = function(ecModel, finder, value) {
      var target = this._findConvertTarget(finder);
      return target.cartesian ? target.cartesian.dataToPoint(value) : target.axis ? target.axis.toGlobalCoord(target.axis.dataToCoord(value)) : null;
    };
    Grid2.prototype.convertFromPixel = function(ecModel, finder, value) {
      var target = this._findConvertTarget(finder);
      return target.cartesian ? target.cartesian.pointToData(value) : target.axis ? target.axis.coordToData(target.axis.toLocalCoord(value)) : null;
    };
    Grid2.prototype._findConvertTarget = function(finder) {
      var seriesModel = finder.seriesModel;
      var xAxisModel = finder.xAxisModel || seriesModel && seriesModel.getReferringComponents("xAxis", SINGLE_REFERRING).models[0];
      var yAxisModel = finder.yAxisModel || seriesModel && seriesModel.getReferringComponents("yAxis", SINGLE_REFERRING).models[0];
      var gridModel = finder.gridModel;
      var coordsList = this._coordsList;
      var cartesian;
      var axis;
      if (seriesModel) {
        cartesian = seriesModel.coordinateSystem;
        indexOf(coordsList, cartesian) < 0 && (cartesian = null);
      } else if (xAxisModel && yAxisModel) {
        cartesian = this.getCartesian(xAxisModel.componentIndex, yAxisModel.componentIndex);
      } else if (xAxisModel) {
        axis = this.getAxis("x", xAxisModel.componentIndex);
      } else if (yAxisModel) {
        axis = this.getAxis("y", yAxisModel.componentIndex);
      } else if (gridModel) {
        var grid = gridModel.coordinateSystem;
        if (grid === this) {
          cartesian = this._coordsList[0];
        }
      }
      return {
        cartesian,
        axis
      };
    };
    Grid2.prototype.containPoint = function(point) {
      var coord = this._coordsList[0];
      if (coord) {
        return coord.containPoint(point);
      }
    };
    Grid2.prototype._initCartesian = function(gridModel, ecModel, api) {
      var _this = this;
      var grid = this;
      var axisPositionUsed = {
        left: false,
        right: false,
        top: false,
        bottom: false
      };
      var axesMap = {
        x: {},
        y: {}
      };
      var axesCount = {
        x: 0,
        y: 0
      };
      ecModel.eachComponent("xAxis", createAxisCreator("x"), this);
      ecModel.eachComponent("yAxis", createAxisCreator("y"), this);
      if (!axesCount.x || !axesCount.y) {
        this._axesMap = {};
        this._axesList = [];
        return;
      }
      this._axesMap = axesMap;
      each(axesMap.x, function(xAxis, xAxisIndex) {
        each(axesMap.y, function(yAxis, yAxisIndex) {
          var key2 = "x" + xAxisIndex + "y" + yAxisIndex;
          var cartesian = new Cartesian2D_default(key2);
          cartesian.master = _this;
          cartesian.model = gridModel;
          _this._coordsMap[key2] = cartesian;
          _this._coordsList.push(cartesian);
          cartesian.addAxis(xAxis);
          cartesian.addAxis(yAxis);
        });
      });
      prepareAlignToInCoordSysCreate(axesMap.x);
      prepareAlignToInCoordSysCreate(axesMap.y);
      function createAxisCreator(dimName) {
        return function(axisModel, idx) {
          if (!isAxisUsedInTheGrid(axisModel, gridModel)) {
            return;
          }
          var axisPosition = axisModel.get("position");
          if (dimName === "x") {
            if (axisPosition !== "top" && axisPosition !== "bottom") {
              axisPosition = axisPositionUsed.bottom ? "top" : "bottom";
            }
          } else {
            if (axisPosition !== "left" && axisPosition !== "right") {
              axisPosition = axisPositionUsed.left ? "right" : "left";
            }
          }
          axisPositionUsed[axisPosition] = true;
          var axisType = determineAxisType(axisModel);
          var axis = new Axis2D_default(dimName, createScaleByModel(axisModel, axisType, true), [0, 0], axisType, axisPosition);
          axis.onBand = isAxisOnBand(axis.scale, axisModel);
          axis.inverse = axisModel.get("inverse");
          axisModel.axis = axis;
          axis.model = axisModel;
          axis.grid = grid;
          axis.index = idx;
          grid._axesList.push(axis);
          axesMap[dimName][idx] = axis;
          axesCount[dimName]++;
        };
      }
    };
    Grid2.prototype.getTooltipAxes = function(dim) {
      var baseAxes = [];
      var otherAxes = [];
      each(this.getCartesians(), function(cartesian) {
        var baseAxis = dim != null && dim !== "auto" ? cartesian.getAxis(dim) : cartesian.getBaseAxis();
        var otherAxis = cartesian.getOtherAxis(baseAxis);
        indexOf(baseAxes, baseAxis) < 0 && baseAxes.push(baseAxis);
        indexOf(otherAxes, otherAxis) < 0 && otherAxes.push(otherAxis);
      });
      return {
        baseAxes,
        otherAxes
      };
    };
    Grid2.create = function(ecModel, api) {
      var grids = [];
      ecModel.eachComponent("grid", function(gridModel, idx) {
        var grid = new Grid2(gridModel, ecModel, api);
        grid.name = "grid_" + idx;
        grid.resize(gridModel, api, true);
        gridModel.coordinateSystem = grid;
        grids.push(grid);
        each(grid._axesList, function(axis) {
          scaleRawExtentInfoEnableBoxCoordSysUsage(axis, Grid2.dimIdxMap);
        });
      });
      ecModel.eachSeries(function(seriesModel) {
        var xAxis;
        var yAxis;
        injectCoordSysByOption({
          targetModel: seriesModel,
          coordSysType: COORD_SYS_TYPE_CARTESIAN_2D,
          coordSysProvider
        });
        function coordSysProvider() {
          var axesModelMap = findAxisModels(seriesModel);
          var xAxisModel = axesModelMap.xAxisModel;
          var yAxisModel = axesModelMap.yAxisModel;
          xAxis = xAxisModel.axis;
          yAxis = yAxisModel.axis;
          var gridModel = xAxisModel.getCoordSysModel();
          if (false) {
            if (!gridModel) {
              throw new Error('Grid "' + retrieve3(xAxisModel.get("gridIndex"), xAxisModel.get("gridId"), 0) + '" not found');
            }
            if (xAxisModel.getCoordSysModel() !== yAxisModel.getCoordSysModel()) {
              throw new Error("xAxis and yAxis must use the same grid");
            }
          }
          var grid = gridModel.coordinateSystem;
          return grid.getCartesian(xAxisModel.componentIndex, yAxisModel.componentIndex);
        }
        if (xAxis && yAxis) {
          associateSeriesWithAxis(xAxis, seriesModel, COORD_SYS_TYPE_CARTESIAN_2D);
          associateSeriesWithAxis(yAxis, seriesModel, COORD_SYS_TYPE_CARTESIAN_2D);
        }
      }, this);
      return grids;
    };
    Grid2.dimensions = cartesian2DDimensions;
    Grid2.dimIdxMap = createDimNameMap(cartesian2DDimensions);
    return Grid2;
  })()
);
function isAxisUsedInTheGrid(axisModel, gridModel) {
  return axisModel.getCoordSysModel() === gridModel;
}
function fixAxisOnZero(axesMap, otherAxisDim, axis, onZeroRecords) {
  axis.getAxesOnZeroOf = function() {
    return otherAxisOnZeroOf ? [otherAxisOnZeroOf] : [];
  };
  var otherAxes = axesMap[otherAxisDim];
  var otherAxisOnZeroOf;
  var axisModel = axis.model;
  var onZero = axisModel.get(["axisLine", "onZero"]);
  var onZeroAxisIndex = axisModel.get(["axisLine", "onZeroAxisIndex"]);
  if (!onZero) {
    return;
  }
  if (onZeroAxisIndex != null) {
    if (canOnZeroToAxis(onZero, otherAxes[onZeroAxisIndex])) {
      otherAxisOnZeroOf = otherAxes[onZeroAxisIndex];
    }
  } else {
    for (var idx in otherAxes) {
      if (hasOwn(otherAxes, idx) && canOnZeroToAxis(onZero, otherAxes[idx]) && !onZeroRecords[getOnZeroRecordKey(otherAxes[idx])]) {
        otherAxisOnZeroOf = otherAxes[idx];
        break;
      }
    }
  }
  if (otherAxisOnZeroOf) {
    onZeroRecords[getOnZeroRecordKey(otherAxisOnZeroOf)] = true;
  }
  function getOnZeroRecordKey(axis2) {
    return axis2.dim + "_" + axis2.index;
  }
}
function canOnZeroToAxis(onZeroOption, axis) {
  if (!axis) {
    return false;
  }
  var scale3 = axis.scale;
  var kindEffective = getScaleValuePositionKind(scale3, 0, false);
  var can = axis && axis.type !== "category" && axis.type !== "time" && kindEffective !== SCALE_VALUE_POSITION_KIND_OUTSIDE;
  if (can && onZeroOption === "auto" && isOnAxisZeroDiscouraged(axis)) {
    can = false;
  }
  return can;
}
function prepareAlignToInCoordSysCreate(axes) {
  var axesIndices = keys(axes);
  var alignTo;
  var axisNeedsAlign = [];
  for (var i = axesIndices.length - 1; i >= 0; i--) {
    var axis = axes[+axesIndices[i]];
    if (isIntervalOrLogScale(axis.scale) && retrieveAxisBreaksOption(axis.model, axis.type, true) == null) {
      if (axis.model.get("alignTicks") && axis.model.get("interval") == null) {
        axisNeedsAlign.push(axis);
      } else {
        alignTo = axis;
      }
    }
  }
  ;
  if (!alignTo) {
    alignTo = axisNeedsAlign.pop();
  }
  if (alignTo) {
    each(axisNeedsAlign, function(axis2) {
      axis2.__alignTo = alignTo;
    });
  }
}
function incapableOfAlignNeedFallback(targetAxis, alignTo) {
  return hasBreaks(targetAxis.scale) || hasBreaks(alignTo.scale) || alignTo.scale.getTicks().length < 2;
}
function updateAxisTransform(axis, coordBase) {
  var axisExtent = axis.getExtent();
  var axisExtentSum = axisExtent[0] + axisExtent[1];
  axis.toGlobalCoord = axis.dim === "x" ? function(coord) {
    return coord + coordBase;
  } : function(coord) {
    return axisExtentSum - coord + coordBase;
  };
  axis.toLocalCoord = axis.dim === "x" ? function(coord) {
    return coord - coordBase;
  } : function(coord) {
    return axisExtentSum - coord + coordBase;
  };
}
function updateAllAxisExtentTransByGridRect(axesMap, gridRect) {
  each(axesMap.x, function(axis) {
    return updateAxisExtentTransByGridRect(axis, gridRect.x, gridRect.width);
  });
  each(axesMap.y, function(axis) {
    return updateAxisExtentTransByGridRect(axis, gridRect.y, gridRect.height);
  });
}
function updateAxisExtentTransByGridRect(axis, gridXY, gridWH) {
  var extent = [0, gridWH];
  var idx = axis.inverse ? 1 : 0;
  axis.setExtent(extent[idx], extent[1 - idx]);
  updateAxisTransform(axis, gridXY);
}
var legacyLayOutGridByContainLabel;
function registerLegacyGridContainLabelImpl(impl) {
  legacyLayOutGridByContainLabel = impl;
}
function layOutGridByOuterBounds(outerBoundsRect, outerBoundsContain, outerBoundsClamp, gridRect, axesMap, axisBuilderSharedCtx, layoutRef) {
  if (false) {
    assert(outerBoundsContain === "all" || outerBoundsContain === "axisLabel");
  }
  createOrUpdateAxesView(gridRect, axesMap, AxisTickLabelComputingKind.estimate, outerBoundsContain, false, layoutRef);
  var margin = [0, 0, 0, 0];
  fillLabelNameOverflowOnOneDimension(0);
  fillLabelNameOverflowOnOneDimension(1);
  fillMarginOnOneDimension(gridRect, 0, NaN);
  fillMarginOnOneDimension(gridRect, 1, NaN);
  var noPxChange = find(margin, function(item) {
    return item > 0;
  }) == null;
  expandOrShrinkRect(gridRect, margin, true, true, outerBoundsClamp);
  updateAllAxisExtentTransByGridRect(axesMap, gridRect);
  return noPxChange;
  function fillLabelNameOverflowOnOneDimension(xyIdx) {
    each(axesMap[XY2[xyIdx]], function(axis) {
      if (!shouldAxisShow(axis.model)) {
        return;
      }
      var sharedRecord = axisBuilderSharedCtx.ensureRecord(axis.model);
      var labelInfoList = sharedRecord.labelInfoList;
      if (labelInfoList) {
        for (var idx = 0; idx < labelInfoList.length; idx++) {
          var labelInfo = labelInfoList[idx];
          var proportion = axis.scale.normalize(getTickValueOutermost(axis.scale, getLabelInner(labelInfo.label).labelInfo.tick));
          proportion = xyIdx === 1 ? 1 - proportion : proportion;
          fillMarginOnOneDimension(labelInfo.rect, xyIdx, proportion);
          fillMarginOnOneDimension(labelInfo.rect, 1 - xyIdx, NaN);
        }
      }
      var nameLayout = sharedRecord.nameLayout;
      if (nameLayout) {
        var proportion = isNameLocationCenter(sharedRecord.nameLocation) ? 0.5 : NaN;
        fillMarginOnOneDimension(nameLayout.rect, xyIdx, proportion);
        fillMarginOnOneDimension(nameLayout.rect, 1 - xyIdx, NaN);
      }
    });
  }
  function fillMarginOnOneDimension(itemRect, xyIdx, proportion) {
    var overflow1 = outerBoundsRect[XY2[xyIdx]] - itemRect[XY2[xyIdx]];
    var overflow2 = itemRect[WH2[xyIdx]] + itemRect[XY2[xyIdx]] - (outerBoundsRect[WH2[xyIdx]] + outerBoundsRect[XY2[xyIdx]]);
    overflow1 = applyProportion(overflow1, 1 - proportion);
    overflow2 = applyProportion(overflow2, proportion);
    var minIdx = XY_TO_MARGIN_IDX[xyIdx][0];
    var maxIdx = XY_TO_MARGIN_IDX[xyIdx][1];
    margin[minIdx] = mathMax(margin[minIdx], overflow1);
    margin[maxIdx] = mathMax(margin[maxIdx], overflow2);
  }
  function applyProportion(overflow, proportion) {
    if (overflow > 0 && !eqNaN(proportion) && proportion > 1e-4) {
      overflow /= proportion;
    }
    return overflow;
  }
}
function createAxisBiulders(gridRect, cartesians, axesMap, optionContainLabel, api) {
  var axisBuilderSharedCtx = new AxisBuilderSharedContext(resolveAxisNameOverlapForGrid);
  each(axesMap, function(axisList) {
    return each(axisList, function(axis) {
      if (shouldAxisShow(axis.model)) {
        var defaultNameMoveOverlap = !optionContainLabel;
        axis.axisBuilder = createCartesianAxisViewCommonPartBuilder(gridRect, cartesians, axis.model, api, axisBuilderSharedCtx, defaultNameMoveOverlap);
      }
    });
  });
  return axisBuilderSharedCtx;
}
function createOrUpdateAxesView(gridRect, axesMap, kind, outerBoundsContain, noPxChange, layoutRef) {
  var isDetermine = kind === AxisTickLabelComputingKind.determine;
  each(axesMap, function(axisList) {
    return each(axisList, function(axis) {
      if (shouldAxisShow(axis.model)) {
        updateCartesianAxisViewCommonPartBuilder(axis.axisBuilder, gridRect, axis.model);
        axis.axisBuilder.build(isDetermine ? {
          axisTickLabelDetermine: true
        } : {
          axisTickLabelEstimate: true
        }, {
          noPxChange
        });
      }
    });
  });
  var nameMarginLevelMap = {
    x: 0,
    y: 0
  };
  calcNameMarginLevel(0);
  calcNameMarginLevel(1);
  function calcNameMarginLevel(xyIdx) {
    nameMarginLevelMap[XY2[1 - xyIdx]] = gridRect[WH2[xyIdx]] <= layoutRef.refContainer[WH2[xyIdx]] * 0.5 ? 0 : 1 - xyIdx === 1 ? 2 : 1;
  }
  each(axesMap, function(axisList, xy) {
    return each(axisList, function(axis) {
      if (shouldAxisShow(axis.model)) {
        if (outerBoundsContain === "all" || isDetermine) {
          axis.axisBuilder.build({
            axisName: true
          }, {
            nameMarginLevel: nameMarginLevelMap[xy]
          });
        }
        if (isDetermine) {
          axis.axisBuilder.build({
            axisLine: true
          });
        }
      }
    });
  });
}
function prepareOuterBounds(gridModel, rawGridRect, layoutRef) {
  var outerBoundsRect;
  var optionOuterBoundsMode = gridModel.get("outerBoundsMode", true);
  if (optionOuterBoundsMode === "same") {
    outerBoundsRect = rawGridRect.clone();
  } else if (optionOuterBoundsMode == null || optionOuterBoundsMode === "auto") {
    outerBoundsRect = getLayoutRect(gridModel.get("outerBounds", true) || OUTER_BOUNDS_DEFAULT, layoutRef.refContainer);
  } else if (optionOuterBoundsMode !== "none") {
    if (false) {
      error("Invalid grid[" + gridModel.componentIndex + "].outerBoundsMode.");
    }
  }
  var optionOuterBoundsContain = gridModel.get("outerBoundsContain", true);
  var parsedOuterBoundsContain;
  if (optionOuterBoundsContain == null || optionOuterBoundsContain === "auto") {
    parsedOuterBoundsContain = "all";
  } else if (indexOf(["all", "axisLabel"], optionOuterBoundsContain) < 0) {
    if (false) {
      error("Invalid grid[" + gridModel.componentIndex + "].outerBoundsContain.");
    }
    parsedOuterBoundsContain = "all";
  } else {
    parsedOuterBoundsContain = optionOuterBoundsContain;
  }
  var outerBoundsClamp = [parsePositionSizeOption(retrieve2(gridModel.get("outerBoundsClampWidth", true), OUTER_BOUNDS_CLAMP_DEFAULT[0]), rawGridRect.width), parsePositionSizeOption(retrieve2(gridModel.get("outerBoundsClampHeight", true), OUTER_BOUNDS_CLAMP_DEFAULT[1]), rawGridRect.height)];
  return {
    outerBoundsRect,
    parsedOuterBoundsContain,
    outerBoundsClamp
  };
}
var resolveAxisNameOverlapForGrid = function(cfg, ctx, axisModel, nameLayoutInfo, nameMoveDirVec, thisRecord) {
  var perpendicularDim = axisModel.axis.dim === "x" ? "y" : "x";
  resolveAxisNameOverlapDefault(cfg, ctx, axisModel, nameLayoutInfo, nameMoveDirVec, thisRecord);
  if (!isNameLocationCenter(cfg.nameLocation)) {
    each(ctx.recordMap[perpendicularDim], function(perpenRecord) {
      if (perpenRecord && perpenRecord.labelInfoList && perpenRecord.dirVec) {
        moveIfOverlapByLinearLabels(perpenRecord.labelInfoList, perpenRecord.dirVec, nameLayoutInfo, nameMoveDirVec);
      }
    });
  }
};

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/coord/cartesian/legacyContainLabel.js
function installLegacyGridContainLabel() {
  registerLegacyGridContainLabelImpl(legacyLayOutGridByContained);
}
function legacyLayOutGridByContained(axesList, gridRect) {
  each(axesList, function(axis) {
    if (!axis.model.get(["axisLabel", "inside"])) {
      var labelUnionRect = estimateLabelUnionRect(axis);
      if (labelUnionRect) {
        var dim = axis.isHorizontal() ? "height" : "width";
        var margin = axis.model.get(["axisLabel", "margin"]);
        gridRect[dim] -= labelUnionRect[dim] + margin;
        if (axis.position === "top") {
          gridRect.y += labelUnionRect.height + margin;
        } else if (axis.position === "left") {
          gridRect.x += labelUnionRect.width + margin;
        }
      }
    }
  });
}
function estimateLabelUnionRect(axis) {
  var axisModel = axis.model;
  var scale3 = axis.scale;
  if (!axisModel.get(["axisLabel", "show"]) || scale3.isBlank()) {
    return;
  }
  var realNumberScaleTicks;
  var tickCount;
  var categoryScaleExtent = scale3.getExtent();
  if (scale3 instanceof Ordinal_default) {
    tickCount = scale3.count();
  } else {
    realNumberScaleTicks = scale3.getTicks();
    tickCount = realNumberScaleTicks.length;
  }
  var axisLabelModel = axis.getLabelModel();
  var labelFormatter = makeLabelFormatter(axis);
  var rect;
  var step = 1;
  if (tickCount > 40) {
    step = Math.ceil(tickCount / 40);
  }
  for (var i = 0; i < tickCount; i += step) {
    var tick = realNumberScaleTicks ? realNumberScaleTicks[i] : {
      value: categoryScaleExtent[0] + i
    };
    var label = labelFormatter(tick, i);
    var unrotatedSingleRect = axisLabelModel.getTextRect(label);
    var singleRect = rotateTextRect(unrotatedSingleRect, axisLabelModel.get("rotate") || 0);
    rect ? rect.union(singleRect) : rect = singleRect;
  }
  return rect;
  function rotateTextRect(textRect, rotate2) {
    var rotateRadians = rotate2 * Math.PI / 180;
    var beforeWidth = textRect.width;
    var beforeHeight = textRect.height;
    var afterWidth = beforeWidth * Math.abs(Math.cos(rotateRadians)) + Math.abs(beforeHeight * Math.sin(rotateRadians));
    var afterHeight = beforeWidth * Math.abs(Math.sin(rotateRadians)) + Math.abs(beforeHeight * Math.cos(rotateRadians));
    var rotatedRect = new BoundingRect_default(textRect.x, textRect.y, afterWidth, afterHeight);
    return rotatedRect;
  }
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/chart/helper/createRenderPlanner.js
function createRenderPlanner() {
  var inner5 = makeInner();
  return function(seriesModel) {
    var fields = inner5(seriesModel);
    var pipelineContext = seriesModel.pipelineContext;
    var originalLarge = !!fields.large;
    var originalProgressive = !!fields.progressiveRender;
    var large = fields.large = !!(pipelineContext && pipelineContext.large);
    var progressive = fields.progressiveRender = !!(pipelineContext && pipelineContext.progressiveRender);
    return !!(originalLarge !== large || originalProgressive !== progressive) && "reset";
  };
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/coord/axisModelCommonMixin.js
var AxisModelCommonMixin = (
  /** @class */
  (function() {
    function AxisModelCommonMixin2() {
    }
    AxisModelCommonMixin2.prototype.needIncludeZero = function() {
      return !this.option.scale;
    };
    AxisModelCommonMixin2.prototype.getCoordSysModel = function() {
      return;
    };
    return AxisModelCommonMixin2;
  })()
);

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/coord/single/AxisModel.js
var COORD_SYS_TYPE_SINGLE = "single";
var COMPONENT_TYPE_SINGLE_AXIS = "singleAxis";
var SingleAxisModel = (
  /** @class */
  (function(_super) {
    __extends(SingleAxisModel2, _super);
    function SingleAxisModel2() {
      var _this = _super !== null && _super.apply(this, arguments) || this;
      _this.type = SingleAxisModel2.type;
      return _this;
    }
    SingleAxisModel2.prototype.getCoordSysModel = function() {
      return this;
    };
    SingleAxisModel2.type = COMPONENT_TYPE_SINGLE_AXIS;
    SingleAxisModel2.layoutMode = "box";
    SingleAxisModel2.defaultOption = {
      left: "5%",
      top: "5%",
      right: "5%",
      bottom: "5%",
      type: "value",
      position: "bottom",
      orient: "horizontal",
      axisLine: {
        show: true,
        lineStyle: {
          width: 1,
          type: "solid"
        }
      },
      // Single coordinate system and single axis is the,
      // which is used as the parent tooltip model.
      // same model, so we set default tooltip show as true.
      tooltip: {
        show: true
      },
      axisTick: {
        show: true,
        length: 6,
        lineStyle: {
          width: 1
        }
      },
      axisLabel: {
        show: true,
        interval: "auto"
      },
      splitLine: {
        show: true,
        lineStyle: {
          type: "dashed",
          opacity: 0.2
        }
      },
      jitter: 0,
      jitterOverlap: true,
      jitterMargin: 2
    };
    return SingleAxisModel2;
  })(Component_default)
);
mixin(SingleAxisModel, AxisModelCommonMixin.prototype);

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/util/jitter.js
function needFixJitter(seriesModel, axis) {
  var coordinateSystem = seriesModel.coordinateSystem;
  var coordType = coordinateSystem && coordinateSystem.type;
  var baseAxis = coordinateSystem && coordinateSystem.getBaseAxis && coordinateSystem.getBaseAxis();
  var scaleType = baseAxis && baseAxis.scale && baseAxis.scale.type;
  var seriesValid = coordType === COORD_SYS_TYPE_CARTESIAN_2D && scaleType === "ordinal" || coordType === COORD_SYS_TYPE_SINGLE;
  var axisValid = axis.model.get("jitter") > 0;
  return seriesValid && axisValid;
}
var inner4 = makeInner();
function fixJitter(fixedAxis, fixedCoord, floatCoord, radius) {
  if (fixedAxis instanceof Axis2D_default) {
    var scaleType = fixedAxis.scale.type;
    if (scaleType !== "ordinal") {
      return floatCoord;
    }
  }
  var axisModel = fixedAxis.model;
  var jitter = axisModel.get("jitter");
  if (!(jitter > 0)) {
    return floatCoord;
  }
  var jitterOverlap = axisModel.get("jitterOverlap");
  var jitterMargin = axisModel.get("jitterMargin") || 0;
  var bandWidth = isOrdinalScale(fixedAxis.scale) ? calcBandWidth(fixedAxis).w : null;
  if (jitterOverlap) {
    return fixJitterIgnoreOverlaps(floatCoord, jitter, bandWidth, radius);
  }
  return fixJitterAvoidOverlaps(fixedAxis, fixedCoord, floatCoord, radius, jitter, jitterMargin);
}
function fixJitterIgnoreOverlaps(floatCoord, jitter, bandWidth, radius) {
  if (bandWidth === null) {
    return floatCoord + (Math.random() - 0.5) * jitter;
  }
  var maxJitter = bandWidth - radius * 2;
  var actualJitter = Math.min(Math.max(0, jitter), maxJitter);
  return floatCoord + (Math.random() - 0.5) * actualJitter;
}
function fixJitterAvoidOverlaps(fixedAxis, fixedCoord, floatCoord, radius, jitter, margin) {
  var store = inner4(fixedAxis);
  if (!store.items) {
    store.items = [];
  }
  var items = store.items;
  var overlapA = placeJitterOnDirection(items, fixedCoord, floatCoord, radius, jitter, margin, 1);
  var overlapB = placeJitterOnDirection(items, fixedCoord, floatCoord, radius, jitter, margin, -1);
  var minFloat = Math.abs(overlapA - floatCoord) < Math.abs(overlapB - floatCoord) ? overlapA : overlapB;
  var bandWidth = isOrdinalScale(fixedAxis.scale) ? calcBandWidth(fixedAxis).w : null;
  var distance2 = Math.abs(minFloat - floatCoord);
  if (distance2 > jitter / 2 || bandWidth && distance2 > bandWidth / 2 - radius) {
    return fixJitterIgnoreOverlaps(floatCoord, jitter, bandWidth, radius);
  }
  items.push({
    fixedCoord,
    floatCoord: minFloat,
    r: radius
  });
  return minFloat;
}
function placeJitterOnDirection(items, fixedCoord, floatCoord, radius, jitter, margin, direction) {
  var y = floatCoord;
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var dx = fixedCoord - item.fixedCoord;
    var dy = y - item.floatCoord;
    var d2 = dx * dx + dy * dy;
    var r = radius + item.r + margin;
    if (d2 < r * r) {
      var requiredY = item.floatCoord + Math.sqrt(r * r - dx * dx) * direction;
      if (Math.abs(requiredY - floatCoord) > jitter / 2) {
        return Number.MAX_VALUE;
      }
      if (direction === 1 && requiredY > y || direction === -1 && requiredY < y) {
        y = requiredY;
        i = -1;
        continue;
      }
    }
  }
  return y;
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/chart/scatter/jitterLayout.js
function jitterLayout() {
  return {
    seriesType: "scatter",
    plan: createRenderPlanner(),
    reset: function(seriesModel) {
      var coordSys = seriesModel.coordinateSystem;
      if (!coordSys || coordSys.type !== COORD_SYS_TYPE_CARTESIAN_2D && coordSys.type !== COORD_SYS_TYPE_SINGLE) {
        return;
      }
      var baseAxis = coordSys.getBaseAxis && coordSys.getBaseAxis();
      var hasJitter = baseAxis && needFixJitter(seriesModel, baseAxis);
      if (!hasJitter) {
        return;
      }
      var dim = baseAxis.dim;
      var orient = baseAxis.orient;
      var isSingleY = orient === "horizontal" && baseAxis.type !== "category" || orient === "vertical" && baseAxis.type === "category";
      var jitterOnY = dim === "y" || dim === "single" && isSingleY;
      var jitterOnX = dim === "x" || dim === "single" && !isSingleY;
      if (!jitterOnY && !jitterOnX) {
        return;
      }
      return {
        progress: function(params, data) {
          var points2 = data.getLayout("points");
          var hasPoints = !!points2;
          if (false) {
            hasPoints && validateUpstreamOutputRange(data.getLayout("pointsRange"), params);
          }
          for (var i = params.start; i < params.end; i++) {
            var offset = hasPoints ? (i - params.start) * 2 : -1;
            var layout2 = hasPoints ? [points2[offset], points2[offset + 1]] : data.getItemLayout(i);
            if (!layout2) {
              continue;
            }
            var rawSize = data.getItemVisual(i, "symbolSize");
            var size = rawSize instanceof Array ? (rawSize[1] + rawSize[0]) / 2 : rawSize;
            if (jitterOnY) {
              var jittered = fixJitter(baseAxis, layout2[0], layout2[1], size / 2);
              if (hasPoints) {
                points2[offset + 1] = jittered;
              } else {
                layout2[1] = jittered;
              }
            } else if (jitterOnX) {
              var jittered = fixJitter(baseAxis, layout2[1], layout2[0], size / 2);
              if (hasPoints) {
                points2[offset] = jittered;
              } else {
                layout2[0] = jittered;
              }
            }
          }
        }
      };
    }
  };
}

// ../../node_modules/.pnpm/echarts@6.1.0/node_modules/echarts/lib/chart/scatter/install.js
function installScatterJitter(registers) {
  registers.registerLayout(registers.PRIORITY.VISUAL.POST_CHART_LAYOUT, jitterLayout());
}

// shell/.ojm-shim-echarts-features.mjs
var ojm_shim_echarts_features_default = void 0 ?? features_exports;
export {
  installAxisBreak as AxisBreak,
  installLabelLayout as LabelLayout,
  installLegacyGridContainLabel as LegacyGridContainLabel,
  installScatterJitter as ScatterJitter,
  installUniversalTransition as UniversalTransition,
  ojm_shim_echarts_features_default as default
};
/*! Bundled license information:

tslib/tslib.es6.js:
  (*! *****************************************************************************
  Copyright (c) Microsoft Corporation.
  
  Permission to use, copy, modify, and/or distribute this software for any
  purpose with or without fee is hereby granted.
  
  THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
  REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
  AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
  INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
  LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
  OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
  PERFORMANCE OF THIS SOFTWARE.
  ***************************************************************************** *)
*/
