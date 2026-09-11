var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/index.js
var es_exports = {};
__export(es_exports, {
  Keyframes: () => Keyframes_default,
  NaNLinter: () => NaNLinter_default,
  StyleContext: () => StyleContext_default,
  StyleProvider: () => StyleProvider,
  Theme: () => Theme,
  _experimental: () => _experimental,
  autoPrefixTransformer: () => autoPrefix_default,
  createCache: () => createCache,
  createTheme: () => createTheme,
  extractStyle: () => extractStyle,
  genCalc: () => calc_default,
  getComputedToken: () => getComputedToken,
  legacyLogicalPropertiesTransformer: () => legacyLogicalProperties_default,
  legacyNotSelectorLinter: () => legacyNotSelectorLinter_default,
  logicalPropertiesLinter: () => logicalPropertiesLinter_default,
  parentSelectorLinter: () => parentSelectorLinter_default,
  px2remTransformer: () => px2rem_default,
  token2CSSVar: () => token2CSSVar,
  unit: () => unit2,
  useCSSVarRegister: () => useCSSVarRegister_default,
  useCacheToken: () => useCacheToken,
  useStyleRegister: () => useStyleRegister
});

// ../../node_modules/.pnpm/@emotion+hash@0.8.0/node_modules/@emotion/hash/dist/hash.browser.esm.js
function murmur2(str) {
  var h = 0;
  var k, i = 0, len = str.length;
  for (; len >= 4; ++i, len -= 4) {
    k = str.charCodeAt(i) & 255 | (str.charCodeAt(++i) & 255) << 8 | (str.charCodeAt(++i) & 255) << 16 | (str.charCodeAt(++i) & 255) << 24;
    k = /* Math.imul(k, m): */
    (k & 65535) * 1540483477 + ((k >>> 16) * 59797 << 16);
    k ^= /* k >>> r: */
    k >>> 24;
    h = /* Math.imul(k, m): */
    (k & 65535) * 1540483477 + ((k >>> 16) * 59797 << 16) ^ /* Math.imul(h, m): */
    (h & 65535) * 1540483477 + ((h >>> 16) * 59797 << 16);
  }
  switch (len) {
    case 3:
      h ^= (str.charCodeAt(i + 2) & 255) << 16;
    case 2:
      h ^= (str.charCodeAt(i + 1) & 255) << 8;
    case 1:
      h ^= str.charCodeAt(i) & 255;
      h = /* Math.imul(h, m): */
      (h & 65535) * 1540483477 + ((h >>> 16) * 59797 << 16);
  }
  h ^= h >>> 13;
  h = /* Math.imul(h, m): */
  (h & 65535) * 1540483477 + ((h >>> 16) * 59797 << 16);
  return ((h ^ h >>> 15) >>> 0).toString(36);
}
var hash_browser_esm_default = murmur2;

// ../../node_modules/.pnpm/@rc-component+util@1.12.0_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@rc-component/util/es/Dom/canUseDom.js
function canUseDom() {
  return !!(typeof window !== "undefined" && window.document && window.document.createElement);
}

// ../../node_modules/.pnpm/@rc-component+util@1.12.0_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@rc-component/util/es/Dom/contains.js
function contains(root, n) {
  if (!root) {
    return false;
  }
  if (root.contains) {
    return root.contains(n);
  }
  let node2 = n;
  while (node2) {
    if (node2 === root) {
      return true;
    }
    node2 = node2.parentNode;
  }
  return false;
}

// ../../node_modules/.pnpm/@rc-component+util@1.12.0_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@rc-component/util/es/Dom/dynamicCSS.js
var APPEND_ORDER = "data-rc-order";
var APPEND_PRIORITY = "data-rc-priority";
var MARK_KEY = `rc-util-key`;
var containerCache = /* @__PURE__ */ new Map();
function getMark({
  mark
} = {}) {
  if (mark) {
    return mark.startsWith("data-") ? mark : `data-${mark}`;
  }
  return MARK_KEY;
}
function getContainer(option) {
  if (option.attachTo) {
    return option.attachTo;
  }
  const head = document.querySelector("head");
  return head || document.body;
}
function getOrder(prepend) {
  if (prepend === "queue") {
    return "prependQueue";
  }
  return prepend ? "prepend" : "append";
}
function findStyles(container) {
  return Array.from((containerCache.get(container) || container).children).filter((node2) => node2.tagName === "STYLE");
}
function injectCSS(css, option = {}) {
  if (!canUseDom()) {
    return null;
  }
  const {
    csp,
    prepend,
    priority = 0
  } = option;
  const mergedOrder = getOrder(prepend);
  const isPrependQueue = mergedOrder === "prependQueue";
  const styleNode = document.createElement("style");
  styleNode.setAttribute(APPEND_ORDER, mergedOrder);
  if (isPrependQueue && priority) {
    styleNode.setAttribute(APPEND_PRIORITY, `${priority}`);
  }
  if (csp?.nonce) {
    styleNode.nonce = csp?.nonce;
  }
  styleNode.innerHTML = css;
  const container = getContainer(option);
  const {
    firstChild
  } = container;
  if (prepend) {
    if (isPrependQueue) {
      const existStyle = (option.styles || findStyles(container)).filter((node2) => {
        if (!["prepend", "prependQueue"].includes(node2.getAttribute(APPEND_ORDER))) {
          return false;
        }
        const nodePriority = Number(node2.getAttribute(APPEND_PRIORITY) || 0);
        return priority >= nodePriority;
      });
      if (existStyle.length) {
        container.insertBefore(styleNode, existStyle[existStyle.length - 1].nextSibling);
        return styleNode;
      }
    }
    container.insertBefore(styleNode, firstChild);
  } else {
    container.appendChild(styleNode);
  }
  return styleNode;
}
function findExistNode(key, option = {}) {
  let {
    styles
  } = option;
  styles || (styles = findStyles(getContainer(option)));
  return styles.find((node2) => node2.getAttribute(getMark(option)) === key);
}
function removeCSS(key, option = {}) {
  const existNode = findExistNode(key, option);
  if (existNode) {
    const container = getContainer(option);
    container.removeChild(existNode);
  }
}
function syncRealContainer(container, option) {
  const cachedRealContainer = containerCache.get(container);
  if (!cachedRealContainer || !contains(document, cachedRealContainer)) {
    const placeholderStyle = injectCSS("", option);
    const {
      parentNode
    } = placeholderStyle;
    containerCache.set(container, parentNode);
    container.removeChild(placeholderStyle);
  }
}
function updateCSS(css, key, originOption = {}) {
  const container = getContainer(originOption);
  const styles = findStyles(container);
  const option = {
    ...originOption,
    styles
  };
  syncRealContainer(container, option);
  const existNode = findExistNode(key, option);
  if (existNode) {
    if (option.csp?.nonce && existNode.nonce !== option.csp?.nonce) {
      existNode.nonce = option.csp?.nonce;
    }
    if (existNode.innerHTML !== css) {
      existNode.innerHTML = css;
    }
    return existNode;
  }
  const newNode = injectCSS(css, option);
  newNode.setAttribute(getMark(option), key);
  return newNode;
}

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/hooks/useCacheToken.js
import { useContext as useContext3 } from "react";

// ../../node_modules/.pnpm/@rc-component+util@1.12.0_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@rc-component/util/es/hooks/useMemo.js
import * as React from "react";
function useMemo(getValue, condition, shouldUpdate) {
  const cacheRef = React.useRef({});
  if (!("value" in cacheRef.current) || shouldUpdate(cacheRef.current.condition, condition)) {
    cacheRef.current.value = getValue();
    cacheRef.current.condition = condition;
  }
  return cacheRef.current.value;
}

// ../../node_modules/.pnpm/@rc-component+util@1.12.0_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@rc-component/util/es/warning.js
var warned = {};
var preWarningFns = [];
var preMessage = (fn) => {
  preWarningFns.push(fn);
};
function warning(valid, message) {
  if (false) {
    const finalMessage = preWarningFns.reduce((msg, preMessageFn) => preMessageFn(msg ?? "", "warning"), message);
    if (finalMessage) {
      console.error(`Warning: ${finalMessage}`);
    }
  }
}
function note(valid, message) {
  if (false) {
    const finalMessage = preWarningFns.reduce((msg, preMessageFn) => preMessageFn(msg ?? "", "note"), message);
    if (finalMessage) {
      console.warn(`Note: ${finalMessage}`);
    }
  }
}
function resetWarned() {
  warned = {};
}
function call(method, valid, message) {
  if (!valid && !warned[message]) {
    method(false, message);
    warned[message] = true;
  }
}
function warningOnce(valid, message) {
  call(warning, valid, message);
}
function noteOnce(valid, message) {
  call(note, valid, message);
}
warningOnce.preMessage = preMessage;
warningOnce.resetWarned = resetWarned;
warningOnce.noteOnce = noteOnce;
var warning_default = warningOnce;

// ../../node_modules/.pnpm/@rc-component+util@1.12.0_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@rc-component/util/es/isEqual.js
function isEqual(obj1, obj2, shallow = false) {
  const refSet = /* @__PURE__ */ new Set();
  function deepEqual(a, b, level = 1) {
    const circular = refSet.has(a);
    warning_default(!circular, "Warning: There may be circular references");
    if (circular) {
      return false;
    }
    if (a === b) {
      return true;
    }
    if (shallow && level > 1) {
      return false;
    }
    refSet.add(a);
    const newLevel = level + 1;
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) {
        return false;
      }
      for (let i = 0; i < a.length; i++) {
        if (!deepEqual(a[i], b[i], newLevel)) {
          return false;
        }
      }
      return true;
    }
    if (a && b && typeof a === "object" && typeof b === "object") {
      const keys = Object.keys(a);
      if (keys.length !== Object.keys(b).length) {
        return false;
      }
      return keys.every((key) => deepEqual(a[key], b[key], newLevel));
    }
    return false;
  }
  return deepEqual(obj1, obj2);
}
var isEqual_default = isEqual;

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/StyleContext.js
import * as React2 from "react";

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/Cache.js
var SPLIT = "%";
function pathKey(keys) {
  return keys.join(SPLIT);
}
var updateId = 0;
var Entity = class {
  constructor(instanceId) {
    __publicField(this, "instanceId");
    /** @private Internal cache map. Do not access this directly */
    __publicField(this, "cache", /* @__PURE__ */ new Map());
    /** @private Record update times for each key */
    __publicField(this, "updateTimes", /* @__PURE__ */ new Map());
    __publicField(this, "extracted", /* @__PURE__ */ new Set());
    this.instanceId = instanceId;
  }
  get(keys) {
    return this.opGet(pathKey(keys));
  }
  /** A fast get cache with `get` concat. */
  opGet(keyPathStr) {
    return this.cache.get(keyPathStr) || null;
  }
  update(keys, valueFn) {
    return this.opUpdate(pathKey(keys), valueFn);
  }
  /** A fast get cache with `get` concat. */
  opUpdate(keyPathStr, valueFn) {
    const prevValue = this.cache.get(keyPathStr);
    const nextValue = valueFn(prevValue);
    if (nextValue === null) {
      this.cache.delete(keyPathStr);
      this.updateTimes.delete(keyPathStr);
    } else {
      this.cache.set(keyPathStr, nextValue);
      this.updateTimes.set(keyPathStr, updateId);
      updateId += 1;
    }
  }
};
var Cache_default = Entity;

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/transformers/autoPrefix.js
var AUTO_PREFIX = {};
var transform = AUTO_PREFIX;
var autoPrefix_default = transform;

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/StyleContext.js
var ATTR_TOKEN = "data-token-hash";
var ATTR_MARK = "data-css-hash";
var CSS_IN_JS_INSTANCE = "__cssinjs_instance__";
function createCache() {
  const cssinjsInstanceId = Math.random().toString(12).slice(2);
  if (typeof document !== "undefined" && document.head && document.body) {
    const styles = document.body.querySelectorAll(`style[${ATTR_MARK}]`) || [];
    const {
      firstChild
    } = document.head;
    Array.from(styles).forEach((style) => {
      style[CSS_IN_JS_INSTANCE] || (style[CSS_IN_JS_INSTANCE] = cssinjsInstanceId);
      if (style[CSS_IN_JS_INSTANCE] === cssinjsInstanceId) {
        document.head.insertBefore(style, firstChild);
      }
    });
    const styleHash = {};
    Array.from(document.querySelectorAll(`style[${ATTR_MARK}]`)).forEach((style) => {
      const hash2 = style.getAttribute(ATTR_MARK);
      if (styleHash[hash2]) {
        if (style[CSS_IN_JS_INSTANCE] === cssinjsInstanceId) {
          style.parentNode?.removeChild(style);
        }
      } else {
        styleHash[hash2] = true;
      }
    });
  }
  return new Cache_default(cssinjsInstanceId);
}
var StyleContext = /* @__PURE__ */ React2.createContext({
  hashPriority: "low",
  cache: createCache(),
  defaultCache: true,
  autoPrefix: false
});
var StyleProvider = (props) => {
  const {
    children,
    ...restProps
  } = props;
  const parentContext = React2.useContext(StyleContext);
  const context = useMemo(() => {
    const mergedContext = {
      ...parentContext
    };
    Object.keys(restProps).forEach((key) => {
      const value = restProps[key];
      if (restProps[key] !== void 0) {
        mergedContext[key] = value;
      }
    });
    const {
      cache,
      transformers = []
    } = restProps;
    mergedContext.cache = mergedContext.cache || createCache();
    mergedContext.defaultCache = !cache && parentContext.defaultCache;
    if (transformers.includes(AUTO_PREFIX)) {
      mergedContext.autoPrefix = true;
    }
    return mergedContext;
  }, [parentContext, restProps], (prev2, next2) => !isEqual_default(prev2[0], next2[0], true) || !isEqual_default(prev2[1], next2[1], true));
  return /* @__PURE__ */ React2.createElement(StyleContext.Provider, {
    value: context
  }, children);
};
var StyleContext_default = StyleContext;

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/theme/calc/calculator.js
var AbstractCalculator = class {
};
var calculator_default = AbstractCalculator;

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/theme/calc/CSSCalculator.js
var CALC_UNIT = "CALC_UNIT";
var regexp = new RegExp(CALC_UNIT, "g");
function unit(value) {
  if (typeof value === "number") {
    return `${value}${CALC_UNIT}`;
  }
  return value;
}
var CSSCalculator = class _CSSCalculator extends calculator_default {
  constructor(num, unitlessCssVar) {
    super();
    __publicField(this, "result", "");
    __publicField(this, "unitlessCssVar");
    __publicField(this, "lowPriority");
    const numType = typeof num;
    this.unitlessCssVar = unitlessCssVar;
    if (num instanceof _CSSCalculator) {
      this.result = `(${num.result})`;
    } else if (numType === "number") {
      this.result = unit(num);
    } else if (numType === "string") {
      this.result = num;
    }
  }
  add(num) {
    if (num instanceof _CSSCalculator) {
      this.result = `${this.result} + ${num.getResult()}`;
    } else if (typeof num === "number" || typeof num === "string") {
      this.result = `${this.result} + ${unit(num)}`;
    }
    this.lowPriority = true;
    return this;
  }
  sub(num) {
    if (num instanceof _CSSCalculator) {
      this.result = `${this.result} - ${num.getResult()}`;
    } else if (typeof num === "number" || typeof num === "string") {
      this.result = `${this.result} - ${unit(num)}`;
    }
    this.lowPriority = true;
    return this;
  }
  mul(num) {
    if (this.lowPriority) {
      this.result = `(${this.result})`;
    }
    if (num instanceof _CSSCalculator) {
      this.result = `${this.result} * ${num.getResult(true)}`;
    } else if (typeof num === "number" || typeof num === "string") {
      this.result = `${this.result} * ${num}`;
    }
    this.lowPriority = false;
    return this;
  }
  div(num) {
    if (this.lowPriority) {
      this.result = `(${this.result})`;
    }
    if (num instanceof _CSSCalculator) {
      this.result = `${this.result} / ${num.getResult(true)}`;
    } else if (typeof num === "number" || typeof num === "string") {
      this.result = `${this.result} / ${num}`;
    }
    this.lowPriority = false;
    return this;
  }
  getResult(force) {
    return this.lowPriority || force ? `(${this.result})` : this.result;
  }
  equal(options) {
    const {
      unit: cssUnit
    } = options || {};
    let mergedUnit = true;
    if (typeof cssUnit === "boolean") {
      mergedUnit = cssUnit;
    } else if (Array.from(this.unitlessCssVar).some((cssVar) => this.result.includes(cssVar))) {
      mergedUnit = false;
    }
    this.result = this.result.replace(regexp, mergedUnit ? "px" : "");
    if (typeof this.lowPriority !== "undefined") {
      return `calc(${this.result})`;
    }
    return this.result;
  }
};

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/theme/calc/NumCalculator.js
var NumCalculator = class _NumCalculator extends calculator_default {
  constructor(num) {
    super();
    __publicField(this, "result", 0);
    if (num instanceof _NumCalculator) {
      this.result = num.result;
    } else if (typeof num === "number") {
      this.result = num;
    }
  }
  add(num) {
    if (num instanceof _NumCalculator) {
      this.result += num.result;
    } else if (typeof num === "number") {
      this.result += num;
    }
    return this;
  }
  sub(num) {
    if (num instanceof _NumCalculator) {
      this.result -= num.result;
    } else if (typeof num === "number") {
      this.result -= num;
    }
    return this;
  }
  mul(num) {
    if (num instanceof _NumCalculator) {
      this.result *= num.result;
    } else if (typeof num === "number") {
      this.result *= num;
    }
    return this;
  }
  div(num) {
    if (num instanceof _NumCalculator) {
      this.result /= num.result;
    } else if (typeof num === "number") {
      this.result /= num;
    }
    return this;
  }
  equal() {
    return this.result;
  }
};

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/theme/calc/index.js
var genCalc = (type, unitlessCssVar) => {
  const Calculator = type === "css" ? CSSCalculator : NumCalculator;
  return (num) => new Calculator(num, unitlessCssVar);
};
var calc_default = genCalc;

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/theme/ThemeCache.js
function sameDerivativeOption(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}
var _ThemeCache = class _ThemeCache {
  constructor() {
    __publicField(this, "cache");
    __publicField(this, "keys");
    __publicField(this, "cacheCallTimes");
    this.cache = /* @__PURE__ */ new Map();
    this.keys = [];
    this.cacheCallTimes = 0;
  }
  size() {
    return this.keys.length;
  }
  internalGet(derivativeOption, updateCallTimes = false) {
    let cache = {
      map: this.cache
    };
    derivativeOption.forEach((derivative) => {
      if (!cache) {
        cache = void 0;
      } else {
        cache = cache?.map?.get(derivative);
      }
    });
    if (cache?.value && updateCallTimes) {
      cache.value[1] = this.cacheCallTimes++;
    }
    return cache?.value;
  }
  get(derivativeOption) {
    return this.internalGet(derivativeOption, true)?.[0];
  }
  has(derivativeOption) {
    return !!this.internalGet(derivativeOption);
  }
  set(derivativeOption, value) {
    if (!this.has(derivativeOption)) {
      if (this.size() + 1 > _ThemeCache.MAX_CACHE_SIZE + _ThemeCache.MAX_CACHE_OFFSET) {
        const [targetKey] = this.keys.reduce((result, key) => {
          const [, callTimes] = result;
          if (this.internalGet(key)[1] < callTimes) {
            return [key, this.internalGet(key)[1]];
          }
          return result;
        }, [this.keys[0], this.cacheCallTimes]);
        this.delete(targetKey);
      }
      this.keys.push(derivativeOption);
    }
    let cache = this.cache;
    derivativeOption.forEach((derivative, index) => {
      if (index === derivativeOption.length - 1) {
        cache.set(derivative, {
          value: [value, this.cacheCallTimes++]
        });
      } else {
        const cacheValue = cache.get(derivative);
        if (!cacheValue) {
          cache.set(derivative, {
            map: /* @__PURE__ */ new Map()
          });
        } else if (!cacheValue.map) {
          cacheValue.map = /* @__PURE__ */ new Map();
        }
        cache = cache.get(derivative).map;
      }
    });
  }
  deleteByPath(currentCache, derivatives) {
    const cache = currentCache.get(derivatives[0]);
    if (derivatives.length === 1) {
      if (!cache.map) {
        currentCache.delete(derivatives[0]);
      } else {
        currentCache.set(derivatives[0], {
          map: cache.map
        });
      }
      return cache.value?.[0];
    }
    const result = this.deleteByPath(cache.map, derivatives.slice(1));
    if ((!cache.map || cache.map.size === 0) && !cache.value) {
      currentCache.delete(derivatives[0]);
    }
    return result;
  }
  delete(derivativeOption) {
    if (this.has(derivativeOption)) {
      this.keys = this.keys.filter((item) => !sameDerivativeOption(item, derivativeOption));
      return this.deleteByPath(this.cache, derivativeOption);
    }
    return void 0;
  }
};
__publicField(_ThemeCache, "MAX_CACHE_SIZE", 20);
__publicField(_ThemeCache, "MAX_CACHE_OFFSET", 5);
var ThemeCache = _ThemeCache;

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/theme/Theme.js
var uuid = 0;
var Theme = class {
  constructor(derivatives) {
    __publicField(this, "derivatives");
    __publicField(this, "id");
    this.derivatives = Array.isArray(derivatives) ? derivatives : [derivatives];
    this.id = uuid;
    if (derivatives.length === 0) {
      warning(derivatives.length > 0, "[Ant Design CSS-in-JS] Theme should have at least one derivative function.");
    }
    uuid += 1;
  }
  getDerivativeToken(token2) {
    return this.derivatives.reduce((result, derivative) => derivative(token2, result), void 0);
  }
};

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/theme/createTheme.js
var cacheThemes = new ThemeCache();
function createTheme(derivatives) {
  const derivativeArr = Array.isArray(derivatives) ? derivatives : [derivatives];
  if (!cacheThemes.has(derivativeArr)) {
    cacheThemes.set(derivativeArr, new Theme(derivativeArr));
  }
  return cacheThemes.get(derivativeArr);
}

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/util/index.js
var resultCache = /* @__PURE__ */ new WeakMap();
var RESULT_VALUE = {};
function memoResult(callback, deps) {
  let current = resultCache;
  for (let i = 0; i < deps.length; i += 1) {
    const dep = deps[i];
    if (!current.has(dep)) {
      current.set(dep, /* @__PURE__ */ new WeakMap());
    }
    current = current.get(dep);
  }
  if (!current.has(RESULT_VALUE)) {
    current.set(RESULT_VALUE, callback());
  }
  return current.get(RESULT_VALUE);
}
var flattenTokenCache = /* @__PURE__ */ new WeakMap();
function flattenToken(token2) {
  let str = flattenTokenCache.get(token2) || "";
  if (!str) {
    Object.keys(token2).forEach((key) => {
      const value = token2[key];
      str += key;
      if (value instanceof Theme) {
        str += value.id;
      } else if (value && typeof value === "object") {
        str += flattenToken(value);
      } else {
        str += value;
      }
    });
    str = hash_browser_esm_default(str);
    flattenTokenCache.set(token2, str);
  }
  return str;
}
function token2key(token2, salt) {
  return hash_browser_esm_default(`${salt}_${flattenToken(token2)}`);
}
var randomSelectorKey = `random-${Date.now()}-${Math.random()}`.replace(/\./g, "");
var checkContent = "_bAmBoO_";
function supportSelector(styleStr, handleElement, supportCheck) {
  if (canUseDom()) {
    updateCSS(styleStr, randomSelectorKey);
    const ele = document.createElement("div");
    ele.style.position = "fixed";
    ele.style.left = "0";
    ele.style.top = "0";
    handleElement?.(ele);
    document.body.appendChild(ele);
    if (false) {
      ele.innerHTML = "Test";
      ele.style.zIndex = "9999999";
    }
    const support = supportCheck ? supportCheck(ele) : getComputedStyle(ele).content?.includes(checkContent);
    ele.parentNode?.removeChild(ele);
    removeCSS(randomSelectorKey);
    return support;
  }
  return false;
}
var canWhere = void 0;
function supportWhere() {
  if (canWhere === void 0) {
    canWhere = supportSelector(`:where(.${randomSelectorKey}) { content: "${checkContent}"!important; }`, (ele) => {
      ele.className = randomSelectorKey;
    });
  }
  return canWhere;
}
var canLogic = void 0;
function supportLogicProps() {
  if (canLogic === void 0) {
    canLogic = supportSelector(`.${randomSelectorKey} { inset-block: 93px !important; }`, (ele) => {
      ele.className = randomSelectorKey;
    }, (ele) => getComputedStyle(ele).bottom === "93px");
  }
  return canLogic;
}
var isClientSide = canUseDom();
function unit2(num) {
  if (typeof num === "number") {
    return `${num}px`;
  }
  return num;
}
function toStyleStr(style, tokenKey, styleId, customizeAttrs = {}, plain = false) {
  if (plain) {
    return style;
  }
  const attrs = {
    ...customizeAttrs,
    [ATTR_TOKEN]: tokenKey,
    [ATTR_MARK]: styleId
  };
  const attrStr = Object.keys(attrs).map((attr) => {
    const val = attrs[attr];
    return val ? `${attr}="${val}"` : null;
  }).filter((v) => v).join(" ");
  return `<style ${attrStr}>${style}</style>`;
}
function where(options) {
  const {
    hashCls,
    hashPriority = "low"
  } = options || {};
  if (!hashCls) {
    return "";
  }
  const hashSelector = `.${hashCls}`;
  return hashPriority === "low" ? `:where(${hashSelector})` : hashSelector;
}
var isNonNullable = (val) => {
  return val !== void 0 && val !== null;
};
function injectCSPNonce(config, nonce) {
  const nonceStr = typeof nonce === "function" ? nonce() : nonce;
  if (nonceStr) {
    return {
      ...config,
      csp: {
        ...config.csp,
        nonce: nonceStr
      }
    };
  }
  return config;
}

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/util/css-variables.js
var token2CSSVar = (token2, prefix2 = "") => {
  return `--${prefix2 ? `${prefix2}-` : ""}${token2}`.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z]+)([A-Z][a-z0-9]+)/g, "$1-$2").replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase();
};
var serializeCSSVar = (cssVars, hashId, options) => {
  const {
    hashCls,
    hashPriority = "low",
    scope
  } = options || {};
  if (!Object.keys(cssVars).length) {
    return "";
  }
  const baseSelector = `${where({
    hashCls,
    hashPriority
  })}.${hashId}`;
  const scopes = [scope].flat().filter(Boolean);
  const selector = scopes.length ? scopes.map((s) => `${baseSelector}.${s}`).join(", ") : baseSelector;
  return `${selector}{${Object.entries(cssVars).map(([key, value]) => `${key}:${value};`).join("")}}`;
};
var transformToken = (token2, themeKey, config) => {
  const {
    hashCls,
    hashPriority = "low",
    prefix: prefix2,
    unitless,
    ignore,
    preserve
  } = config || {};
  const cssVars = {};
  const result = {};
  Object.entries(token2).forEach(([key, value]) => {
    if (preserve?.[key]) {
      result[key] = value;
    } else if ((typeof value === "string" || typeof value === "number") && !ignore?.[key]) {
      const cssVar = token2CSSVar(key, prefix2);
      cssVars[cssVar] = typeof value === "number" && !unitless?.[key] ? `${value}px` : String(value);
      result[key] = `var(${cssVar})`;
    }
  });
  return [result, serializeCSSVar(cssVars, themeKey, {
    scope: config?.scope,
    hashCls,
    hashPriority
  })];
};

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/hooks/useGlobalCache.js
import * as React3 from "react";
import { useInsertionEffect } from "react";

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/hooks/useHMR.js
function useProdHMR() {
  return false;
}
var useHMR_default = true ? useProdHMR : useDevHMR;
if (false) {
  const win = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : null;
  if (win && typeof win.webpackHotUpdate === "function") {
    const originWebpackHotUpdate = win.webpackHotUpdate;
    win.webpackHotUpdate = (...args) => {
      webpackHMR = true;
      setTimeout(() => {
        webpackHMR = false;
      }, 0);
      return originWebpackHotUpdate(...args);
    };
  }
}

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/hooks/useGlobalCache.js
var effectMap = /* @__PURE__ */ new Map();
function useGlobalCache(prefix2, keyPath, cacheFn, onCacheRemove, onCacheEffect) {
  const {
    cache: globalCache
  } = React3.useContext(StyleContext_default);
  const fullPath = [prefix2, ...keyPath];
  const fullPathStr = pathKey(fullPath);
  const HMRUpdate = useHMR_default();
  const buildCache = (updater) => {
    globalCache.opUpdate(fullPathStr, (prevCache) => {
      const [times = 0, cache] = prevCache || [void 0, void 0];
      let tmpCache = cache;
      if (false) {
        onCacheRemove?.(tmpCache, HMRUpdate);
        tmpCache = null;
      }
      const mergedCache = tmpCache || cacheFn();
      const data = [times, mergedCache];
      return updater ? updater(data) : data;
    });
  };
  React3.useMemo(
    () => {
      buildCache();
    },
    /* eslint-disable react-hooks/exhaustive-deps */
    [fullPathStr]
    /* eslint-enable */
  );
  let cacheEntity = globalCache.opGet(fullPathStr);
  if (false) {
    buildCache();
    cacheEntity = globalCache.opGet(fullPathStr);
  }
  const cacheContent = cacheEntity[1];
  useInsertionEffect(() => {
    buildCache(([times, cache]) => [times + 1, cache]);
    if (!effectMap.has(fullPathStr)) {
      onCacheEffect?.(cacheContent);
      effectMap.set(fullPathStr, true);
      Promise.resolve().then(() => {
        effectMap.delete(fullPathStr);
      });
    }
    return () => {
      globalCache.opUpdate(fullPathStr, (prevCache) => {
        const [times = 0, cache] = prevCache || [];
        const nextCount = times - 1;
        if (nextCount === 0) {
          onCacheRemove?.(cache, false);
          effectMap.delete(fullPathStr);
          return null;
        }
        return [times - 1, cache];
      });
    };
  }, [fullPathStr]);
  return cacheContent;
}

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/hooks/useCacheToken.js
var EMPTY_OVERRIDE = {};
var hashPrefix = false ? "css-dev-only-do-not-override" : "css";
var tokenKeys = /* @__PURE__ */ new Map();
function recordCleanToken(tokenKey) {
  tokenKeys.set(tokenKey, (tokenKeys.get(tokenKey) || 0) + 1);
}
function removeStyleTags(key, instanceId) {
  if (typeof document !== "undefined") {
    const styles = document.querySelectorAll(`style[${ATTR_TOKEN}="${key}"]`);
    styles.forEach((style) => {
      if (style[CSS_IN_JS_INSTANCE] === instanceId) {
        style.parentNode?.removeChild(style);
      }
    });
  }
}
var TOKEN_THRESHOLD = -1;
function cleanTokenStyle(tokenKey, instanceId) {
  tokenKeys.set(tokenKey, (tokenKeys.get(tokenKey) || 0) - 1);
  const cleanableKeyList = /* @__PURE__ */ new Set();
  tokenKeys.forEach((value, key) => {
    if (value <= 0) cleanableKeyList.add(key);
  });
  if (tokenKeys.size - cleanableKeyList.size > TOKEN_THRESHOLD) {
    cleanableKeyList.forEach((key) => {
      removeStyleTags(key, instanceId);
      tokenKeys.delete(key);
    });
  }
}
var getComputedToken = (originToken, overrideToken, theme, format) => {
  const derivativeToken = theme.getDerivativeToken(originToken);
  let mergedDerivativeToken = {
    ...derivativeToken,
    ...overrideToken
  };
  if (format) {
    mergedDerivativeToken = format(mergedDerivativeToken);
  }
  return mergedDerivativeToken;
};
var TOKEN_PREFIX = "token";
function useCacheToken(theme, tokens, option) {
  const {
    cache: {
      instanceId
    },
    container,
    hashPriority
  } = useContext3(StyleContext_default);
  const {
    salt = "",
    override = EMPTY_OVERRIDE,
    formatToken,
    getComputedToken: compute,
    cssVar,
    nonce
  } = option;
  const mergedToken = memoResult(() => Object.assign({}, ...tokens), tokens);
  const tokenStr = flattenToken(mergedToken);
  const overrideTokenStr = flattenToken(override);
  const cssVarStr = flattenToken(cssVar);
  const cachedToken = useGlobalCache(TOKEN_PREFIX, [salt, theme.id, tokenStr, overrideTokenStr, cssVarStr], () => {
    const mergedDerivativeToken = compute ? compute(mergedToken, override, theme) : getComputedToken(mergedToken, override, theme, formatToken);
    const actualToken = {
      ...mergedDerivativeToken
    };
    const mergedSalt = `${salt}_${cssVar.prefix}`;
    const hashId = hash_browser_esm_default(mergedSalt);
    const hashCls = `${hashPrefix}-${hashId}`;
    actualToken._tokenKey = token2key(actualToken, mergedSalt);
    const [tokenWithCssVar, cssVarsStr] = transformToken(mergedDerivativeToken, cssVar.key, {
      prefix: cssVar.prefix,
      ignore: cssVar.ignore,
      unitless: cssVar.unitless,
      preserve: cssVar.preserve,
      hashPriority,
      hashCls: cssVar.hashed ? hashCls : void 0
    });
    tokenWithCssVar._hashId = hashId;
    recordCleanToken(cssVar.key);
    return [tokenWithCssVar, hashCls, actualToken, cssVarsStr, cssVar.key];
  }, ([, , , , themeKey]) => {
    cleanTokenStyle(themeKey, instanceId);
  }, ([, , , cssVarsStr, themeKey]) => {
    if (!cssVarsStr) {
      return;
    }
    let mergedCSSConfig = {
      mark: ATTR_MARK,
      prepend: "queue",
      attachTo: container,
      priority: -999
    };
    mergedCSSConfig = injectCSPNonce(mergedCSSConfig, nonce);
    const style = updateCSS(cssVarsStr, hash_browser_esm_default(`css-var-${themeKey}`), mergedCSSConfig);
    style[CSS_IN_JS_INSTANCE] = instanceId;
    style.setAttribute(ATTR_TOKEN, themeKey);
  });
  return cachedToken;
}
var extract = (cache, effectStyles, options) => {
  const [, , realToken, styleStr, cssVarKey] = cache;
  const {
    plain
  } = options || {};
  if (!styleStr) {
    return null;
  }
  const styleId = realToken._tokenKey;
  const order = -999;
  const sharedAttrs = {
    "data-rc-order": "prependQueue",
    "data-rc-priority": `${order}`
  };
  const styleText = toStyleStr(styleStr, cssVarKey, styleId, sharedAttrs, plain);
  return [order, styleId, styleText];
};

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/hooks/useCSSVarRegister.js
import { useContext as useContext5 } from "react";

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/hooks/useStyleRegister.js
import * as React4 from "react";

// ../../node_modules/.pnpm/@emotion+unitless@0.7.5/node_modules/@emotion/unitless/dist/unitless.browser.esm.js
var unitlessKeys = {
  animationIterationCount: 1,
  borderImageOutset: 1,
  borderImageSlice: 1,
  borderImageWidth: 1,
  boxFlex: 1,
  boxFlexGroup: 1,
  boxOrdinalGroup: 1,
  columnCount: 1,
  columns: 1,
  flex: 1,
  flexGrow: 1,
  flexPositive: 1,
  flexShrink: 1,
  flexNegative: 1,
  flexOrder: 1,
  gridRow: 1,
  gridRowEnd: 1,
  gridRowSpan: 1,
  gridRowStart: 1,
  gridColumn: 1,
  gridColumnEnd: 1,
  gridColumnSpan: 1,
  gridColumnStart: 1,
  msGridRow: 1,
  msGridRowSpan: 1,
  msGridColumn: 1,
  msGridColumnSpan: 1,
  fontWeight: 1,
  lineHeight: 1,
  opacity: 1,
  order: 1,
  orphans: 1,
  tabSize: 1,
  widows: 1,
  zIndex: 1,
  zoom: 1,
  WebkitLineClamp: 1,
  // SVG-related properties
  fillOpacity: 1,
  floodOpacity: 1,
  stopOpacity: 1,
  strokeDasharray: 1,
  strokeDashoffset: 1,
  strokeMiterlimit: 1,
  strokeOpacity: 1,
  strokeWidth: 1
};
var unitless_browser_esm_default = unitlessKeys;

// ../../node_modules/.pnpm/stylis@4.4.0/node_modules/stylis/src/Enum.js
var MS = "-ms-";
var MOZ = "-moz-";
var WEBKIT = "-webkit-";
var COMMENT = "comm";
var RULESET = "rule";
var DECLARATION = "decl";
var IMPORT = "@import";
var NAMESPACE = "@namespace";
var KEYFRAMES = "@keyframes";
var LAYER = "@layer";

// ../../node_modules/.pnpm/stylis@4.4.0/node_modules/stylis/src/Utility.js
var abs = Math.abs;
var from = String.fromCharCode;
var assign = Object.assign;
function hash(value, length2) {
  return charat(value, 0) ^ 45 ? (((length2 << 2 ^ charat(value, 0)) << 2 ^ charat(value, 1)) << 2 ^ charat(value, 2)) << 2 ^ charat(value, 3) : 0;
}
function trim(value) {
  return value.trim();
}
function match(value, pattern) {
  return (value = pattern.exec(value)) ? value[0] : value;
}
function replace(value, pattern, replacement) {
  return value.replace(pattern, replacement);
}
function indexof(value, search) {
  return value.indexOf(search);
}
function charat(value, index) {
  return value.charCodeAt(index) | 0;
}
function substr(value, begin, end) {
  return value.slice(begin, end);
}
function strlen(value) {
  return value.length;
}
function sizeof(value) {
  return value.length;
}
function append(value, array) {
  return array.push(value), value;
}
function combine(array, callback) {
  return array.map(callback).join("");
}
function filter(array, pattern) {
  return array.filter(function(value) {
    return !match(value, pattern);
  });
}

// ../../node_modules/.pnpm/stylis@4.4.0/node_modules/stylis/src/Tokenizer.js
var line = 1;
var column = 1;
var length = 0;
var position = 0;
var character = 0;
var characters = "";
function node(value, root, parent, type, props, children, length2, siblings) {
  return { value, root, parent, type, props, children, line, column, length: length2, return: "", siblings };
}
function copy(root, props) {
  return assign(node("", null, null, "", null, null, 0, root.siblings), root, { length: -root.length }, props);
}
function lift(root) {
  while (root.root)
    root = copy(root.root, { children: [root] });
  append(root, root.siblings);
}
function char() {
  return character;
}
function prev() {
  character = position > 0 ? charat(characters, --position) : 0;
  if (column--, character === 10)
    column = 1, line--;
  return character;
}
function next() {
  character = position < length ? charat(characters, position++) : 0;
  if (column++, character === 10)
    column = 1, line++;
  return character;
}
function peek() {
  return charat(characters, position);
}
function caret() {
  return position;
}
function slice(begin, end) {
  return substr(characters, begin, end);
}
function token(type) {
  switch (type) {
    // \0 \t \n \r \s whitespace token
    case 0:
    case 9:
    case 10:
    case 13:
    case 32:
      return 5;
    // ! + , / > @ ~ isolate token
    case 33:
    case 43:
    case 44:
    case 47:
    case 62:
    case 64:
    case 126:
    // ; { } breakpoint token
    case 59:
    case 123:
    case 125:
      return 4;
    // : accompanied token
    case 58:
      return 3;
    // " ' ( [ opening delimit token
    case 34:
    case 39:
    case 40:
    case 91:
      return 2;
    // ) ] closing delimit token
    case 41:
    case 93:
      return 1;
  }
  return 0;
}
function alloc(value) {
  return line = column = 1, length = strlen(characters = value), position = 0, [];
}
function dealloc(value) {
  return characters = "", value;
}
function delimit(type) {
  return trim(slice(position - 1, delimiter(type === 91 ? type + 2 : type === 40 ? type + 1 : type)));
}
function whitespace(type) {
  while (character = peek())
    if (character < 33)
      next();
    else
      break;
  return token(type) > 2 || token(character) > 3 ? "" : " ";
}
function escaping(index, count) {
  while (--count && next())
    if (character < 48 || character > 102 || character > 57 && character < 65 || character > 70 && character < 97)
      break;
  return slice(index, caret() + (count < 6 && peek() == 32 && next() == 32));
}
function delimiter(type) {
  while (next())
    switch (character) {
      // ] ) " '
      case type:
        return position;
      // " '
      case 34:
      case 39:
        if (type !== 34 && type !== 39)
          delimiter(character);
        break;
      // (
      case 40:
        if (type === 41)
          delimiter(type);
        break;
      // \
      case 92:
        next();
        break;
    }
  return position;
}
function commenter(type, index) {
  while (next())
    if (type + character === 47 + 10)
      break;
    else if (type + character === 42 + 42 && peek() === 47)
      break;
  return "/*" + slice(index, position - 1) + "*" + from(type === 47 ? type : next());
}
function identifier(index) {
  while (!token(peek()))
    next();
  return slice(index, position);
}

// ../../node_modules/.pnpm/stylis@4.4.0/node_modules/stylis/src/Parser.js
function compile(value) {
  return dealloc(parse("", null, null, null, [""], value = alloc(value), 0, [0], value));
}
function parse(value, root, parent, rule, rules, rulesets, pseudo, points, declarations) {
  var index = 0;
  var offset = 0;
  var length2 = pseudo;
  var atrule = 0;
  var property = 0;
  var previous = 0;
  var variable = 1;
  var scanning = 1;
  var ampersand = 1;
  var parens = 0;
  var character2 = 0;
  var type = "";
  var props = rules;
  var children = rulesets;
  var reference = rule;
  var characters2 = type;
  while (scanning)
    switch (previous = character2, character2 = next()) {
      // (
      case 40:
        if (previous != 108 && charat(characters2, length2 - 1) == 58) parens++, characters2 += "(";
        else characters2 += delimit(character2);
        break;
      // )
      case 41:
        parens--, characters2 += ")";
        break;
      // " ' [
      case 34:
      case 39:
      case 91:
        characters2 += delimit(character2);
        break;
      // \t \n \r \s
      case 9:
      case 10:
      case 13:
      case 32:
        if (parens > 0) {
          characters2 += from(character2);
          break;
        }
        characters2 += whitespace(previous);
        break;
      // \
      case 92:
        characters2 += escaping(caret() - 1, 7);
        continue;
      // /
      case 47:
        switch (peek()) {
          case 42:
          case 47:
            append(comment(commenter(next(), caret()), root, parent, declarations), declarations);
            if ((token(previous || 1) == 5 || token(peek() || 1) == 5) && strlen(characters2) && substr(characters2, -1, void 0) !== " ") characters2 += " ";
            break;
          default:
            characters2 += "/";
        }
        break;
      // {
      case 123 * variable:
        points[index++] = strlen(characters2) * ampersand;
      // } ; \0
      case 125 * variable:
      case 59:
      case 0:
        if (parens > 0 && character2) {
          characters2 += from(character2);
          break;
        }
        switch (character2) {
          // \0 }
          case 0:
          case 125:
            scanning = 0;
          // ;
          case 59 + offset:
            if (ampersand == -1) characters2 = replace(characters2, /\f/g, "");
            if (property > 0 && (strlen(characters2) - length2 || variable === 0))
              append(property > 32 ? declaration(characters2 + ";", rule, parent, length2 - 1, declarations) : declaration(replace(characters2, " ", "") + ";", rule, parent, length2 - 2, declarations), declarations);
            break;
          // @ ;
          case 59:
            characters2 += ";";
          // { rule/at-rule
          default:
            append(reference = ruleset(characters2, root, parent, index, offset, rules, points, type, props = [], children = [], length2, rulesets), rulesets);
            if (character2 === 123)
              if (offset === 0)
                parse(characters2, root, reference, reference, props, rulesets, length2, points, children);
              else {
                switch (atrule) {
                  // c(ontainer)
                  case 99:
                    if (charat(characters2, 3) === 110) break;
                  // l(ayer)
                  case 108:
                    if (charat(characters2, 2) === 97) break;
                  default:
                    offset = 0;
                  // d(ocument) m(edia) s(upports)
                  case 100:
                  case 109:
                  case 115:
                }
                if (offset) parse(value, reference, reference, rule && append(ruleset(value, reference, reference, 0, 0, rules, points, type, rules, props = [], length2, children), children), rules, children, length2, points, rule ? props : children);
                else parse(characters2, reference, reference, reference, [""], children, 0, points, children);
              }
        }
        index = offset = property = 0, variable = ampersand = 1, type = characters2 = "", length2 = pseudo;
        break;
      // :
      case 58:
        length2 = 1 + strlen(characters2), property = previous;
      default:
        if (variable < 1) {
          if (character2 == 123)
            --variable;
          else if (character2 == 125 && variable++ == 0 && prev() == 125)
            continue;
        }
        switch (characters2 += from(character2), character2 * variable) {
          // &
          case 38:
            ampersand = offset > 0 ? 1 : (characters2 += "\f", -1);
            break;
          // ,
          case 44:
            if (parens > 0) break;
            points[index++] = (strlen(characters2) - 1) * ampersand, ampersand = 1;
            break;
          // @
          case 64:
            if (peek() === 45)
              characters2 += delimit(next());
            atrule = peek(), offset = length2 = strlen(type = characters2 += identifier(caret())), character2++;
            break;
          // -
          case 45:
            if (previous === 45 && strlen(characters2) == 2)
              variable = 0;
        }
    }
  return rulesets;
}
function ruleset(value, root, parent, index, offset, rules, points, type, props, children, length2, siblings) {
  var post = offset - 1;
  var rule = offset === 0 ? rules : [""];
  var size = sizeof(rule);
  for (var i = 0, j = 0, k = 0; i < index; ++i)
    for (var x = 0, y = substr(value, post + 1, post = abs(j = points[i])), z = value; x < size; ++x)
      if (z = trim(j > 0 ? rule[x] + " " + y : replace(y, /&\f/g, rule[x])))
        props[k++] = z;
  return node(value, root, parent, offset === 0 ? RULESET : type, props, children, length2, siblings);
}
function comment(value, root, parent, siblings) {
  return node(value, root, parent, COMMENT, from(char()), substr(value, 2, -2), 0, siblings);
}
function declaration(value, root, parent, length2, siblings) {
  return node(value, root, parent, DECLARATION, substr(value, 0, length2), substr(value, length2 + 1, -1), length2, siblings);
}

// ../../node_modules/.pnpm/stylis@4.4.0/node_modules/stylis/src/Prefixer.js
function prefix(value, length2, children) {
  switch (hash(value, length2)) {
    // color-adjust
    case 5103:
      return WEBKIT + "print-" + value + value;
    // animation, animation-(delay|direction|duration|fill-mode|iteration-count|name|play-state|timing-function)
    case 5737:
    case 4201:
    case 3177:
    case 3433:
    case 1641:
    case 4457:
    case 2921:
    // text-decoration, filter, clip-path, backface-visibility, column, box-decoration-break
    case 5572:
    case 6356:
    case 5844:
    case 3191:
    case 6645:
    case 3005:
    // background-clip, columns, column-(count|fill|gap|rule|rule-color|rule-style|rule-width|span|width)
    case 4215:
    case 6389:
    case 5109:
    case 5365:
    case 5621:
    case 3829:
    // mask, mask-image, mask-(mode|clip|size), mask-(repeat|origin), mask-position
    case 6391:
    case 5879:
    case 5623:
    case 6135:
    case 4599:
      return WEBKIT + value + value;
    // mask-composite
    case 4855:
      return WEBKIT + value.replace("add", "source-over").replace("substract", "source-out").replace("intersect", "source-in").replace("exclude", "xor") + value;
    // tab-size
    case 4789:
      return MOZ + value + value;
    // appearance, user-select, transform, hyphens, text-size-adjust
    case 5349:
    case 4246:
    case 4810:
    case 6968:
    case 2756:
      return WEBKIT + value + MOZ + value + MS + value + value;
    // writing-mode
    case 5936:
      switch (charat(value, length2 + 11)) {
        // vertical-l(r)
        case 114:
          return WEBKIT + value + MS + replace(value, /[svh]\w+-[tblr]{2}/, "tb") + value;
        // vertical-r(l)
        case 108:
          return WEBKIT + value + MS + replace(value, /[svh]\w+-[tblr]{2}/, "tb-rl") + value;
        // horizontal(-)tb
        case 45:
          return WEBKIT + value + MS + replace(value, /[svh]\w+-[tblr]{2}/, "lr") + value;
      }
    // flex, flex-direction, scroll-snap-type, writing-mode
    case 6828:
    case 4268:
    case 2903:
      return WEBKIT + value + MS + value + value;
    // order
    case 6165:
      return WEBKIT + value + MS + "flex-" + value + value;
    // align-items
    case 5187:
      return WEBKIT + value + replace(value, /(\w+).+(:[^]+)/, WEBKIT + "box-$1$2" + MS + "flex-$1$2") + value;
    // align-self
    case 5443:
      return WEBKIT + value + MS + "flex-item-" + replace(value, /flex-|-self/g, "") + (!match(value, /flex-|baseline/) ? MS + "grid-row-" + replace(value, /flex-|-self/g, "") : "") + value;
    // align-content
    case 4675:
      return WEBKIT + value + MS + "flex-line-pack" + replace(value, /align-content|flex-|-self/g, "") + value;
    // flex-shrink
    case 5548:
      return WEBKIT + value + MS + replace(value, "shrink", "negative") + value;
    // flex-basis
    case 5292:
      return WEBKIT + value + MS + replace(value, "basis", "preferred-size") + value;
    // flex-grow
    case 6060:
      return WEBKIT + "box-" + replace(value, "-grow", "") + WEBKIT + value + MS + replace(value, "grow", "positive") + value;
    // transition
    case 4554:
      return WEBKIT + replace(value, /([^-])(transform)/g, "$1" + WEBKIT + "$2") + value;
    // cursor
    case 6187:
      return replace(replace(replace(value, /(zoom-|grab)/, WEBKIT + "$1"), /(image-set)/, WEBKIT + "$1"), value, "") + value;
    // background, background-image
    case 5495:
    case 3959:
      return replace(value, /(image-set\([^]*)/, WEBKIT + "$1$`$1");
    // justify-content
    case 4968:
      return replace(replace(value, /(.+:)(flex-)?(.*)/, WEBKIT + "box-pack:$3" + MS + "flex-pack:$3"), /space-between/, "justify") + WEBKIT + value + value;
    // justify-self
    case 4200:
      if (!match(value, /flex-|baseline/)) return MS + "grid-column-align" + substr(value, length2) + value;
      break;
    // grid-template-(columns|rows)
    case 2592:
    case 3360:
      return MS + replace(value, "template-", "") + value;
    // grid-(row|column)-start
    case 4384:
    case 3616:
      if (children && children.some(function(element, index) {
        return length2 = index, match(element.props, /grid-\w+-end/);
      })) {
        return ~indexof(value + (children = children[length2].value), "span") ? value : MS + replace(value, "-start", "") + value + MS + "grid-row-span:" + (~indexof(children, "span") ? match(children, /\d+/) : +match(children, /\d+/) - +match(value, /\d+/)) + ";";
      }
      return MS + replace(value, "-start", "") + value;
    // grid-(row|column)-end
    case 4896:
    case 4128:
      return children && children.some(function(element) {
        return match(element.props, /grid-\w+-start/);
      }) ? value : MS + replace(replace(value, "-end", "-span"), "span ", "") + value;
    // (margin|padding)-inline-(start|end)
    case 4095:
    case 3583:
    case 4068:
    case 2532:
      return replace(value, /(.+)-inline(.+)/, WEBKIT + "$1$2") + value;
    // (min|max)?(width|height|inline-size|block-size)
    case 8116:
    case 7059:
    case 5753:
    case 5535:
    case 5445:
    case 5701:
    case 4933:
    case 4677:
    case 5533:
    case 5789:
    case 5021:
    case 4765:
      if (strlen(value) - 1 - length2 > 6)
        switch (charat(value, length2 + 1)) {
          // (m)ax-content, (m)in-content
          case 109:
            if (charat(value, length2 + 4) !== 45)
              break;
          // (f)ill-available, (f)it-content
          case 102:
            return replace(value, /(.+:)(.+)-([^]+)/, "$1" + WEBKIT + "$2-$3$1" + MOZ + (charat(value, length2 + 3) == 108 ? "$3" : "$2-$3")) + value;
          // (s)tretch
          case 115:
            return ~indexof(value, "stretch") ? prefix(replace(value, "stretch", "fill-available"), length2, children) + value : value;
        }
      break;
    // grid-(column|row)
    case 5152:
    case 5920:
      return replace(value, /(.+?):(\d+)(\s*\/\s*(span)?\s*(\d+))?(.*)/, function(_, a, b, c, d, e, f) {
        return MS + a + ":" + b + f + (c ? MS + a + "-span:" + (d ? e : +e - +b) + f : "") + value;
      });
    // position: sticky
    case 4949:
      if (charat(value, length2 + 6) === 121)
        return replace(value, ":", ":" + WEBKIT) + value;
      break;
    // display: (flex|inline-flex|grid|inline-grid)
    case 6444:
      switch (charat(value, charat(value, 14) === 45 ? 18 : 11)) {
        // (inline-)?fle(x)
        case 120:
          return replace(value, /(.+:)([^;\s!]+)(;|(\s+)?!.+)?/, "$1" + WEBKIT + (charat(value, 14) === 45 ? "inline-" : "") + "box$3$1" + WEBKIT + "$2$3$1" + MS + "$2box$3") + value;
        // (inline-)?gri(d)
        case 100:
          return replace(value, ":", ":" + MS) + value;
      }
      break;
    // scroll-margin, scroll-margin-(top|right|bottom|left)
    case 5719:
    case 2647:
    case 2135:
    case 3927:
    case 2391:
      return replace(value, "scroll-", "scroll-snap-") + value;
  }
  return value;
}

// ../../node_modules/.pnpm/stylis@4.4.0/node_modules/stylis/src/Serializer.js
function serialize(children, callback) {
  var output = "";
  for (var i = 0; i < children.length; i++)
    output += callback(children[i], i, children, callback) || "";
  return output;
}
function stringify(element, index, children, callback) {
  switch (element.type) {
    case LAYER:
      if (element.children.length) break;
    case IMPORT:
    case NAMESPACE:
    case DECLARATION:
      return element.return = element.return || element.value;
    case COMMENT:
      return "";
    case KEYFRAMES:
      return element.return = element.value + "{" + serialize(element.children, callback) + "}";
    case RULESET:
      if (!strlen(element.value = element.props.join(","))) return "";
  }
  return strlen(children = serialize(element.children, callback)) ? element.return = element.value + "{" + children + "}" : "";
}

// ../../node_modules/.pnpm/stylis@4.4.0/node_modules/stylis/src/Middleware.js
function middleware(collection) {
  var length2 = sizeof(collection);
  return function(element, index, children, callback) {
    var output = "";
    for (var i = 0; i < length2; i++)
      output += collection[i](element, index, children, callback) || "";
    return output;
  };
}
function prefixer(element, index, children, callback) {
  if (element.length > -1) {
    if (!element.return)
      switch (element.type) {
        case DECLARATION:
          element.return = prefix(element.value, element.length, children);
          return;
        case KEYFRAMES:
          return serialize([copy(element, { value: replace(element.value, "@", "@" + WEBKIT) })], callback);
        case RULESET:
          if (element.length)
            return combine(children = element.props, function(value) {
              switch (match(value, callback = /(::plac\w+|:read-\w+)/)) {
                // :read-(only|write)
                case ":read-only":
                case ":read-write":
                  lift(copy(element, { props: [replace(value, /:(read-\w+)/, ":" + MOZ + "$1")] }));
                  lift(copy(element, { props: [value] }));
                  assign(element, { props: filter(children, callback) });
                  break;
                // :placeholder
                case "::placeholder":
                  lift(copy(element, { props: [replace(value, /:(plac\w+)/, ":" + WEBKIT + "input-$1")] }));
                  lift(copy(element, { props: [replace(value, /:(plac\w+)/, ":" + MOZ + "$1")] }));
                  lift(copy(element, { props: [replace(value, /:(plac\w+)/, MS + "input-$1")] }));
                  lift(copy(element, { props: [value] }));
                  assign(element, { props: filter(children, callback) });
                  break;
              }
              return "";
            });
      }
  }
}

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/linters/utils.js
function lintWarning(message, info) {
  const {
    path,
    parentSelectors
  } = info;
  warning_default(false, `[Ant Design CSS-in-JS] ${path ? `Error in ${path}: ` : ""}${message}${parentSelectors.length ? ` Selector: ${parentSelectors.join(" | ")}` : ""}`);
}

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/linters/legacyNotSelectorLinter.js
function isConcatSelector(selector) {
  const notContent = selector.match(/:not\(([^)]*)\)/)?.[1] || "";
  const splitCells = notContent.split(/(\[[^[]*])|(?=[.#])/).filter((str) => str);
  return splitCells.length > 1;
}
function parsePath(info) {
  return info.parentSelectors.reduce((prev2, cur) => {
    if (!prev2) {
      return cur;
    }
    return cur.includes("&") ? cur.replace(/&/g, prev2) : `${prev2} ${cur}`;
  }, "");
}
var linter = (key, value, info) => {
  const parentSelectorPath = parsePath(info);
  const notList = parentSelectorPath.match(/:not\([^)]*\)/g) || [];
  if (notList.length > 0 && notList.some(isConcatSelector)) {
    lintWarning(`Concat ':not' selector not support in legacy browsers.`, info);
  }
};
var legacyNotSelectorLinter_default = linter;

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/linters/logicalPropertiesLinter.js
var linter2 = (key, value, info) => {
  switch (key) {
    case "marginLeft":
    case "marginRight":
    case "paddingLeft":
    case "paddingRight":
    case "left":
    case "right":
    case "borderLeft":
    case "borderLeftWidth":
    case "borderLeftStyle":
    case "borderLeftColor":
    case "borderRight":
    case "borderRightWidth":
    case "borderRightStyle":
    case "borderRightColor":
    case "borderTopLeftRadius":
    case "borderTopRightRadius":
    case "borderBottomLeftRadius":
    case "borderBottomRightRadius":
      lintWarning(`You seem to be using non-logical property '${key}' which is not compatible with RTL mode. Please use logical properties and values instead. For more information: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Logical_Properties.`, info);
      return;
    case "margin":
    case "padding":
    case "borderWidth":
    case "borderStyle":
      if (typeof value === "string") {
        const valueArr = value.split(" ").map((item) => item.trim());
        if (valueArr.length === 4 && valueArr[1] !== valueArr[3]) {
          lintWarning(`You seem to be using '${key}' property with different left ${key} and right ${key}, which is not compatible with RTL mode. Please use logical properties and values instead. For more information: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Logical_Properties.`, info);
        }
      }
      return;
    case "clear":
    case "textAlign":
      if (value === "left" || value === "right") {
        lintWarning(`You seem to be using non-logical value '${value}' of ${key}, which is not compatible with RTL mode. Please use logical properties and values instead. For more information: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Logical_Properties.`, info);
      }
      return;
    case "borderRadius":
      if (typeof value === "string") {
        const radiusGroups = value.split("/").map((item) => item.trim());
        const invalid = radiusGroups.reduce((result, group) => {
          if (result) {
            return result;
          }
          const radiusArr = group.split(" ").map((item) => item.trim());
          if (radiusArr.length >= 2 && radiusArr[0] !== radiusArr[1]) {
            return true;
          }
          if (radiusArr.length === 3 && radiusArr[1] !== radiusArr[2]) {
            return true;
          }
          if (radiusArr.length === 4 && radiusArr[2] !== radiusArr[3]) {
            return true;
          }
          return result;
        }, false);
        if (invalid) {
          lintWarning(`You seem to be using non-logical value '${value}' of ${key}, which is not compatible with RTL mode. Please use logical properties and values instead. For more information: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Logical_Properties.`, info);
        }
      }
      return;
    default:
  }
};
var logicalPropertiesLinter_default = linter2;

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/linters/NaNLinter.js
var linter3 = (key, value, info) => {
  if (typeof value === "string" && /NaN/g.test(value) || Number.isNaN(value)) {
    lintWarning(`Unexpected 'NaN' in property '${key}: ${value}'.`, info);
  }
};
var NaNLinter_default = linter3;

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/linters/parentSelectorLinter.js
var linter4 = (key, value, info) => {
  if (info.parentSelectors.some((selector) => {
    const selectors = selector.split(",");
    return selectors.some((item) => item.split("&").length > 2);
  })) {
    lintWarning("Should not use more than one `&` in a selector.", info);
  }
};
var parentSelectorLinter_default = linter4;

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/util/cacheMapUtil.js
var ATTR_CACHE_MAP = "data-ant-cssinjs-cache-path";
var CSS_FILE_STYLE = "_FILE_STYLE__";
function serialize2(cachePathMap2) {
  return Object.keys(cachePathMap2).map((path) => {
    const hash2 = cachePathMap2[path];
    return `${path}:${hash2}`;
  }).join(";");
}
var cachePathMap;
var fromCSSFile = true;
function prepare() {
  if (!cachePathMap) {
    cachePathMap = {};
    if (canUseDom()) {
      const div = document.createElement("div");
      div.className = ATTR_CACHE_MAP;
      div.style.position = "fixed";
      div.style.visibility = "hidden";
      div.style.top = "-9999px";
      document.body.appendChild(div);
      let content = getComputedStyle(div).content || "";
      content = content.replace(/^"/, "").replace(/"$/, "");
      content.split(";").forEach((item) => {
        const [path, hash2] = item.split(":");
        cachePathMap[path] = hash2;
      });
      const inlineMapStyle = document.querySelector(`style[${ATTR_CACHE_MAP}]`);
      if (inlineMapStyle) {
        fromCSSFile = false;
        inlineMapStyle.parentNode?.removeChild(inlineMapStyle);
      }
      document.body.removeChild(div);
    }
  }
}
function existPath(path) {
  prepare();
  return !!cachePathMap[path];
}
function getStyleAndHash(path) {
  const hash2 = cachePathMap[path];
  let styleStr = null;
  if (hash2 && canUseDom()) {
    if (fromCSSFile) {
      styleStr = CSS_FILE_STYLE;
    } else {
      const style = document.querySelector(`style[${ATTR_MARK}="${cachePathMap[path]}"]`);
      if (style) {
        styleStr = style.innerHTML;
      } else {
        delete cachePathMap[path];
      }
    }
  }
  return [styleStr, hash2];
}

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/hooks/useStyleRegister.js
var SKIP_CHECK = "_skip_check_";
var MULTI_VALUE = "_multi_value_";
function normalizeStyle(styleStr, autoPrefix) {
  const serialized = autoPrefix ? serialize(compile(styleStr), middleware([prefixer, stringify])) : serialize(compile(styleStr), stringify);
  return serialized.replace(/\{%%%\:[^;];}/g, ";");
}
function isCompoundCSSProperty(value) {
  return typeof value === "object" && value && (SKIP_CHECK in value || MULTI_VALUE in value);
}
function injectSelectorHash(key, hashId, hashPriority = "high") {
  if (!hashId) {
    return key;
  }
  const hashSelector = where({
    hashCls: hashId,
    hashPriority
  });
  const keys = key.split(",").map((k) => {
    const fullPath = k.trim().split(/\s+/);
    let firstPath = fullPath[0] || "";
    const htmlElement = firstPath.match(/^\w+/)?.[0] || "";
    firstPath = `${htmlElement}${hashSelector}${firstPath.slice(htmlElement.length)}`;
    return [firstPath, ...fullPath.slice(1)].join(" ");
  });
  return keys.join(",");
}
var parseStyle = (interpolation, config = {}, {
  root,
  injectHash,
  parentSelectors
} = {
  root: true,
  parentSelectors: []
}) => {
  const {
    hashId,
    layer,
    path,
    hashPriority,
    transformers = [],
    linters = []
  } = config;
  let styleStr = "";
  let effectStyle = {};
  function parseKeyframes(keyframes) {
    const animationName = keyframes.getName(hashId);
    if (!effectStyle[animationName]) {
      const [parsedStr] = parseStyle(keyframes.style, config, {
        root: false,
        parentSelectors
      });
      effectStyle[animationName] = `@keyframes ${keyframes.getName(hashId)}${parsedStr}`;
    }
  }
  function flattenList(list, fullList = []) {
    list.forEach((item) => {
      if (Array.isArray(item)) {
        flattenList(item, fullList);
      } else if (item) {
        fullList.push(item);
      }
    });
    return fullList;
  }
  const flattenStyleList = flattenList(Array.isArray(interpolation) ? interpolation : [interpolation]);
  flattenStyleList.forEach((originStyle) => {
    const style = typeof originStyle === "string" && !root ? {} : originStyle;
    if (typeof style === "string") {
      styleStr += `${style}
`;
    } else if (style._keyframe) {
      parseKeyframes(style);
    } else {
      const mergedStyle = transformers.reduce((prev2, trans) => trans?.visit?.(prev2) || prev2, style);
      Object.keys(mergedStyle).forEach((key) => {
        const value = mergedStyle[key];
        if (typeof value === "object" && value && (key !== "animationName" || !value._keyframe) && !isCompoundCSSProperty(value)) {
          let subInjectHash = false;
          let mergedKey = key.trim();
          let nextRoot = false;
          if ((root || injectHash) && hashId) {
            if (mergedKey.startsWith("@")) {
              subInjectHash = true;
            } else if (mergedKey === "&") {
              mergedKey = injectSelectorHash("", hashId, hashPriority);
            } else {
              mergedKey = injectSelectorHash(key, hashId, hashPriority);
            }
          } else if (root && !hashId && (mergedKey === "&" || mergedKey === "")) {
            mergedKey = "";
            nextRoot = true;
          }
          const [parsedStr, childEffectStyle] = parseStyle(value, config, {
            root: nextRoot,
            injectHash: subInjectHash,
            parentSelectors: [...parentSelectors, mergedKey]
          });
          effectStyle = {
            ...effectStyle,
            ...childEffectStyle
          };
          styleStr += `${mergedKey}${parsedStr}`;
        } else {
          let appendStyle = function(cssKey, cssValue) {
            if (false) {
              [contentQuotesLinter_default, hashedAnimationLinter_default, ...linters].forEach((linter5) => linter5(cssKey, cssValue, {
                path,
                hashId,
                parentSelectors
              }));
            }
            const styleName = cssKey.replace(/[A-Z]/g, (match2) => `-${match2.toLowerCase()}`);
            let formatValue = cssValue;
            if (!unitless_browser_esm_default[cssKey] && typeof formatValue === "number" && formatValue !== 0) {
              formatValue = `${formatValue}px`;
            }
            if (cssKey === "animationName" && cssValue?._keyframe) {
              parseKeyframes(cssValue);
              formatValue = cssValue.getName(hashId);
            }
            styleStr += `${styleName}:${formatValue};`;
          };
          const actualValue = value?.value ?? value;
          if (typeof value === "object" && value?.[MULTI_VALUE] && Array.isArray(actualValue)) {
            actualValue.forEach((item) => {
              appendStyle(key, item);
            });
          } else {
            if (isNonNullable(actualValue)) {
              appendStyle(key, actualValue);
            }
          }
        }
      });
    }
  });
  if (!root) {
    styleStr = `{${styleStr}}`;
  } else if (layer) {
    if (styleStr) {
      styleStr = `@layer ${layer.name} {${styleStr}}`;
    }
    if (layer.dependencies) {
      effectStyle[`@layer ${layer.name}`] = layer.dependencies.map((deps) => `@layer ${deps}, ${layer.name};`).join("\n");
    }
  }
  return [styleStr, effectStyle];
};
function uniqueHash(path, styleStr) {
  return hash_browser_esm_default(`${path.join("%")}${styleStr}`);
}
var STYLE_PREFIX = "style";
function useStyleRegister(info, styleFn) {
  const {
    path,
    hashId,
    layer,
    nonce,
    clientOnly,
    order = 0
  } = info;
  const {
    mock,
    hashPriority,
    container,
    transformers,
    linters,
    cache,
    layer: enableLayer,
    autoPrefix
  } = React4.useContext(StyleContext_default);
  const fullPath = [hashId || ""];
  if (enableLayer) {
    fullPath.push("layer");
  }
  fullPath.push(...path);
  let isMergedClientSide = isClientSide;
  if (false) {
    isMergedClientSide = mock === "client";
  }
  useGlobalCache(
    STYLE_PREFIX,
    fullPath,
    // Create cache if needed
    () => {
      const cachePath = fullPath.join("|");
      if (existPath(cachePath)) {
        const [inlineCacheStyleStr, styleHash] = getStyleAndHash(cachePath);
        if (inlineCacheStyleStr) {
          return [inlineCacheStyleStr, styleHash, {}, clientOnly, order];
        }
      }
      const styleObj = styleFn();
      const [parsedStyle, effectStyle] = parseStyle(styleObj, {
        hashId,
        hashPriority,
        layer: enableLayer ? layer : void 0,
        path: path.join("-"),
        transformers,
        linters
      });
      const styleStr = normalizeStyle(parsedStyle, autoPrefix || false);
      const styleId = uniqueHash(fullPath, styleStr);
      return [styleStr, styleId, effectStyle, clientOnly, order];
    },
    // Remove cache if no need
    (cacheValue, fromHMR) => {
      const [, styleId] = cacheValue;
      if (fromHMR && isClientSide) {
        removeCSS(styleId, {
          mark: ATTR_MARK,
          attachTo: container
        });
      }
    },
    // Effect: Inject style here
    (cacheValue) => {
      const [styleStr, styleId, effectStyle, , priority] = cacheValue;
      if (isMergedClientSide && styleStr !== CSS_FILE_STYLE) {
        let mergedCSSConfig = {
          mark: ATTR_MARK,
          prepend: enableLayer ? false : "queue",
          attachTo: container,
          priority
        };
        mergedCSSConfig = injectCSPNonce(mergedCSSConfig, nonce);
        const effectLayerKeys = [];
        const effectRestKeys = [];
        Object.keys(effectStyle).forEach((key) => {
          if (key.startsWith("@layer")) {
            effectLayerKeys.push(key);
          } else {
            effectRestKeys.push(key);
          }
        });
        effectLayerKeys.forEach((effectKey) => {
          updateCSS(normalizeStyle(effectStyle[effectKey], autoPrefix || false), `_layer-${effectKey}`, {
            ...mergedCSSConfig,
            prepend: true
          });
        });
        const style = updateCSS(styleStr, styleId, mergedCSSConfig);
        style[CSS_IN_JS_INSTANCE] = cache.instanceId;
        if (false) {
          style.setAttribute(ATTR_CACHE_PATH, fullPath.join("|"));
        }
        effectRestKeys.forEach((effectKey) => {
          updateCSS(normalizeStyle(effectStyle[effectKey], autoPrefix || false), `_effect-${effectKey}`, mergedCSSConfig);
        });
      }
    }
  );
}
var extract2 = (cache, effectStyles, options) => {
  const [styleStr, styleId, effectStyle, clientOnly, order] = cache;
  const {
    plain,
    autoPrefix
  } = options || {};
  if (clientOnly) {
    return null;
  }
  let keyStyleText = styleStr;
  const sharedAttrs = {
    "data-rc-order": "prependQueue",
    "data-rc-priority": `${order}`
  };
  keyStyleText = toStyleStr(styleStr, void 0, styleId, sharedAttrs, plain);
  if (effectStyle) {
    Object.keys(effectStyle).forEach((effectKey) => {
      if (!effectStyles[effectKey]) {
        effectStyles[effectKey] = true;
        const effectStyleStr = normalizeStyle(effectStyle[effectKey], autoPrefix || false);
        const effectStyleHTML = toStyleStr(effectStyleStr, void 0, `_effect-${effectKey}`, sharedAttrs, plain);
        if (effectKey.startsWith("@layer")) {
          keyStyleText = effectStyleHTML + keyStyleText;
        } else {
          keyStyleText += effectStyleHTML;
        }
      }
    });
  }
  return [order, styleId, keyStyleText];
};

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/hooks/useCSSVarRegister.js
var CSS_VAR_PREFIX = "cssVar";
var useCSSVarRegister = (config, fn) => {
  const {
    key,
    prefix: prefix2,
    unitless,
    ignore,
    token: token2,
    hashId,
    scope,
    nonce
  } = config;
  const {
    cache: {
      instanceId
    },
    container,
    hashPriority
  } = useContext5(StyleContext_default);
  const {
    _tokenKey: tokenKey
  } = token2;
  const scopeKey = Array.isArray(scope) ? scope.join("@@") : scope;
  const stylePath = [...config.path, key, scopeKey, tokenKey];
  const cache = useGlobalCache(CSS_VAR_PREFIX, stylePath, () => {
    const originToken = fn();
    const [mergedToken, cssVarsStr] = transformToken(originToken, key, {
      prefix: prefix2,
      unitless,
      ignore,
      scope,
      hashPriority,
      hashCls: hashId
    });
    const styleId = uniqueHash(stylePath, cssVarsStr);
    return [mergedToken, cssVarsStr, styleId, key];
  }, ([, , styleId]) => {
    if (isClientSide) {
      removeCSS(styleId, {
        mark: ATTR_MARK,
        attachTo: container
      });
    }
  }, ([, cssVarsStr, styleId]) => {
    if (!cssVarsStr) {
      return;
    }
    let mergedCSSConfig = {
      mark: ATTR_MARK,
      prepend: "queue",
      attachTo: container,
      priority: -999
    };
    mergedCSSConfig = injectCSPNonce(mergedCSSConfig, nonce);
    const style = updateCSS(cssVarsStr, styleId, mergedCSSConfig);
    style[CSS_IN_JS_INSTANCE] = instanceId;
    style.setAttribute(ATTR_TOKEN, key);
  });
  return cache;
};
var extract3 = (cache, effectStyles, options) => {
  const [, styleStr, styleId, cssVarKey] = cache;
  const {
    plain
  } = options || {};
  if (!styleStr) {
    return null;
  }
  const order = -999;
  const sharedAttrs = {
    "data-rc-order": "prependQueue",
    "data-rc-priority": `${order}`
  };
  const styleText = toStyleStr(styleStr, cssVarKey, styleId, sharedAttrs, plain);
  return [order, styleId, styleText];
};
var useCSSVarRegister_default = useCSSVarRegister;

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/extractStyle.js
var ExtractStyleFns = {
  [STYLE_PREFIX]: extract2,
  [TOKEN_PREFIX]: extract,
  [CSS_VAR_PREFIX]: extract3
};
function isNotNull(value) {
  return value !== null;
}
function extractStyle(cache, options) {
  const {
    plain = false,
    types = ["style", "token", "cssVar"],
    once = false
  } = typeof options === "boolean" ? {
    plain: options
  } : options || {};
  const matchPrefixRegexp = new RegExp(`^(${(typeof types === "string" ? [types] : types).join("|")})%`);
  const styleKeys = Array.from(cache.cache.keys()).filter((key) => matchPrefixRegexp.test(key));
  const effectStyles = {};
  const cachePathMap2 = {};
  let styleText = "";
  styleKeys.map((key) => {
    if (once && cache.extracted.has(key)) {
      return null;
    }
    const cachePath = key.replace(matchPrefixRegexp, "").replace(/%/g, "|");
    const [prefix2] = key.split("%");
    const extractFn = ExtractStyleFns[prefix2];
    const extractedStyle = extractFn(cache.cache.get(key)[1], effectStyles, {
      plain
    });
    if (!extractedStyle) {
      return null;
    }
    const updateTime = cache.updateTimes.get(key) || 0;
    const [order, styleId, styleStr] = extractedStyle;
    if (key.startsWith("style")) {
      cachePathMap2[cachePath] = styleId;
    }
    cache.extracted.add(key);
    return [order, styleStr, updateTime];
  }).filter(isNotNull).sort(([o1, , u1], [o2, , u2]) => {
    if (o1 !== o2) {
      return o1 - o2;
    }
    return u1 - u2;
  }).forEach(([, style]) => {
    styleText += style;
  });
  styleText += toStyleStr(`.${ATTR_CACHE_MAP}{content:"${serialize2(cachePathMap2)}";}`, void 0, void 0, {
    [ATTR_CACHE_MAP]: ATTR_CACHE_MAP
  }, plain);
  return styleText;
}

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/Keyframes.js
var Keyframe = class {
  constructor(name, style) {
    __publicField(this, "name");
    __publicField(this, "style");
    __publicField(this, "_keyframe", true);
    this.name = name;
    this.style = style;
  }
  getName(hashId = "") {
    return hashId ? `${hashId}-${this.name}` : this.name;
  }
};
var Keyframes_default = Keyframe;

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/transformers/legacyLogicalProperties.js
function splitValues(value) {
  if (typeof value === "number") {
    return [[value], false];
  }
  const rawStyle = String(value).trim();
  const importantCells = rawStyle.match(/(.*)(!important)/);
  const splitStyle = (importantCells ? importantCells[1] : rawStyle).trim().split(/\s+/);
  let temp = [];
  let brackets = 0;
  return [splitStyle.reduce((list, item) => {
    if (item.includes("(") || item.includes(")")) {
      const left = item.split("(").length - 1;
      const right = item.split(")").length - 1;
      brackets += left - right;
    }
    if (brackets >= 0) temp.push(item);
    if (brackets === 0) {
      list.push(temp.join(" "));
      temp = [];
    }
    return list;
  }, []), !!importantCells];
}
function noSplit(list) {
  list.notSplit = true;
  return list;
}
var keyMap = {
  // Inset
  inset: ["top", "right", "bottom", "left"],
  insetBlock: ["top", "bottom"],
  insetBlockStart: ["top"],
  insetBlockEnd: ["bottom"],
  insetInline: ["left", "right"],
  insetInlineStart: ["left"],
  insetInlineEnd: ["right"],
  // Margin
  marginBlock: ["marginTop", "marginBottom"],
  marginBlockStart: ["marginTop"],
  marginBlockEnd: ["marginBottom"],
  marginInline: ["marginLeft", "marginRight"],
  marginInlineStart: ["marginLeft"],
  marginInlineEnd: ["marginRight"],
  // Padding
  paddingBlock: ["paddingTop", "paddingBottom"],
  paddingBlockStart: ["paddingTop"],
  paddingBlockEnd: ["paddingBottom"],
  paddingInline: ["paddingLeft", "paddingRight"],
  paddingInlineStart: ["paddingLeft"],
  paddingInlineEnd: ["paddingRight"],
  // Border
  borderBlock: noSplit(["borderTop", "borderBottom"]),
  borderBlockStart: noSplit(["borderTop"]),
  borderBlockEnd: noSplit(["borderBottom"]),
  borderInline: noSplit(["borderLeft", "borderRight"]),
  borderInlineStart: noSplit(["borderLeft"]),
  borderInlineEnd: noSplit(["borderRight"]),
  // Border width
  borderBlockWidth: ["borderTopWidth", "borderBottomWidth"],
  borderBlockStartWidth: ["borderTopWidth"],
  borderBlockEndWidth: ["borderBottomWidth"],
  borderInlineWidth: ["borderLeftWidth", "borderRightWidth"],
  borderInlineStartWidth: ["borderLeftWidth"],
  borderInlineEndWidth: ["borderRightWidth"],
  // Border style
  borderBlockStyle: ["borderTopStyle", "borderBottomStyle"],
  borderBlockStartStyle: ["borderTopStyle"],
  borderBlockEndStyle: ["borderBottomStyle"],
  borderInlineStyle: ["borderLeftStyle", "borderRightStyle"],
  borderInlineStartStyle: ["borderLeftStyle"],
  borderInlineEndStyle: ["borderRightStyle"],
  // Border color
  borderBlockColor: ["borderTopColor", "borderBottomColor"],
  borderBlockStartColor: ["borderTopColor"],
  borderBlockEndColor: ["borderBottomColor"],
  borderInlineColor: ["borderLeftColor", "borderRightColor"],
  borderInlineStartColor: ["borderLeftColor"],
  borderInlineEndColor: ["borderRightColor"],
  // Border radius
  borderStartStartRadius: ["borderTopLeftRadius"],
  borderStartEndRadius: ["borderTopRightRadius"],
  borderEndStartRadius: ["borderBottomLeftRadius"],
  borderEndEndRadius: ["borderBottomRightRadius"]
};
function wrapImportantAndSkipCheck(value, important) {
  let parsedValue = value;
  if (important) {
    parsedValue = `${parsedValue} !important`;
  }
  return {
    _skip_check_: true,
    value: parsedValue
  };
}
var transform2 = {
  visit: (cssObj) => {
    const clone = {};
    Object.keys(cssObj).forEach((key) => {
      const value = cssObj[key];
      const matchValue = keyMap[key];
      if (matchValue && (typeof value === "number" || typeof value === "string")) {
        const [values, important] = splitValues(value);
        if (matchValue.length && matchValue.notSplit) {
          matchValue.forEach((matchKey) => {
            clone[matchKey] = wrapImportantAndSkipCheck(value, important);
          });
        } else if (matchValue.length === 1) {
          clone[matchValue[0]] = wrapImportantAndSkipCheck(values[0], important);
        } else if (matchValue.length === 2) {
          matchValue.forEach((matchKey, index) => {
            clone[matchKey] = wrapImportantAndSkipCheck(values[index] ?? values[0], important);
          });
        } else if (matchValue.length === 4) {
          matchValue.forEach((matchKey, index) => {
            clone[matchKey] = wrapImportantAndSkipCheck(values[index] ?? values[index - 2] ?? values[0], important);
          });
        } else {
          clone[key] = value;
        }
      } else {
        clone[key] = value;
      }
    });
    return clone;
  }
};
var legacyLogicalProperties_default = transform2;

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/transformers/px2rem.js
var pxRegex = /url\([^)]+\)|var\([^)]+\)|(\d*\.?\d+)px/g;
function toFixed(number, precision) {
  const multiplier = Math.pow(10, precision + 1), wholeNumber = Math.floor(number * multiplier);
  return Math.round(wholeNumber / 10) * 10 / multiplier;
}
var transform3 = (options = {}) => {
  const {
    rootValue = 16,
    precision = 5,
    mediaQuery = false
  } = options;
  const pxReplace = (m, $1) => {
    if (!$1) return m;
    const pixels = parseFloat($1);
    if (pixels <= 1) return m;
    const fixedVal = toFixed(pixels / rootValue, precision);
    return `${fixedVal}rem`;
  };
  const visit = (cssObj) => {
    const clone = {
      ...cssObj
    };
    Object.entries(cssObj).forEach(([key, value]) => {
      if (typeof value === "string" && value.includes("px")) {
        const newValue = value.replace(pxRegex, pxReplace);
        clone[key] = newValue;
      }
      if (!unitless_browser_esm_default[key] && typeof value === "number" && value !== 0) {
        clone[key] = `${value}px`.replace(pxRegex, pxReplace);
      }
      const mergedKey = key.trim();
      if (mergedKey.startsWith("@") && mergedKey.includes("px") && mediaQuery) {
        const newKey = key.replace(pxRegex, pxReplace);
        clone[newKey] = clone[key];
        delete clone[key];
      }
    });
    return clone;
  };
  return {
    visit
  };
};
var px2rem_default = transform3;

// ../../node_modules/.pnpm/@ant-design+cssinjs@2.1.2_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@ant-design/cssinjs/es/index.js
var _experimental = {
  supportModernCSS: () => supportWhere() && supportLogicProps()
};

// shell/.ram-shim-cssinjs.mjs
var ram_shim_cssinjs_default = void 0 ?? es_exports;
export {
  Keyframes_default as Keyframes,
  NaNLinter_default as NaNLinter,
  StyleContext_default as StyleContext,
  StyleProvider,
  Theme,
  _experimental,
  autoPrefix_default as autoPrefixTransformer,
  createCache,
  createTheme,
  ram_shim_cssinjs_default as default,
  extractStyle,
  calc_default as genCalc,
  getComputedToken,
  legacyLogicalProperties_default as legacyLogicalPropertiesTransformer,
  legacyNotSelectorLinter_default as legacyNotSelectorLinter,
  logicalPropertiesLinter_default as logicalPropertiesLinter,
  parentSelectorLinter_default as parentSelectorLinter,
  px2rem_default as px2remTransformer,
  token2CSSVar,
  unit2 as unit,
  useCSSVarRegister_default as useCSSVarRegister,
  useCacheToken,
  useStyleRegister
};
