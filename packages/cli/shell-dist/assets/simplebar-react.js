var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../../node_modules/.pnpm/simplebar-react@3.3.2_react@19.2.8/node_modules/simplebar-react/dist/index.mjs
var dist_exports = {};
__export(dist_exports, {
  default: () => SimpleBar
});
import * as React from "react";

// ../../node_modules/.pnpm/lodash-es@4.18.1/node_modules/lodash-es/isObject.js
function isObject(value) {
  var type = typeof value;
  return value != null && (type == "object" || type == "function");
}
var isObject_default = isObject;

// ../../node_modules/.pnpm/lodash-es@4.18.1/node_modules/lodash-es/_freeGlobal.js
var freeGlobal = typeof global == "object" && global && global.Object === Object && global;
var freeGlobal_default = freeGlobal;

// ../../node_modules/.pnpm/lodash-es@4.18.1/node_modules/lodash-es/_root.js
var freeSelf = typeof self == "object" && self && self.Object === Object && self;
var root = freeGlobal_default || freeSelf || Function("return this")();
var root_default = root;

// ../../node_modules/.pnpm/lodash-es@4.18.1/node_modules/lodash-es/now.js
var now = function() {
  return root_default.Date.now();
};
var now_default = now;

// ../../node_modules/.pnpm/lodash-es@4.18.1/node_modules/lodash-es/_trimmedEndIndex.js
var reWhitespace = /\s/;
function trimmedEndIndex(string) {
  var index = string.length;
  while (index-- && reWhitespace.test(string.charAt(index))) {
  }
  return index;
}
var trimmedEndIndex_default = trimmedEndIndex;

// ../../node_modules/.pnpm/lodash-es@4.18.1/node_modules/lodash-es/_baseTrim.js
var reTrimStart = /^\s+/;
function baseTrim(string) {
  return string ? string.slice(0, trimmedEndIndex_default(string) + 1).replace(reTrimStart, "") : string;
}
var baseTrim_default = baseTrim;

// ../../node_modules/.pnpm/lodash-es@4.18.1/node_modules/lodash-es/_Symbol.js
var Symbol2 = root_default.Symbol;
var Symbol_default = Symbol2;

// ../../node_modules/.pnpm/lodash-es@4.18.1/node_modules/lodash-es/_getRawTag.js
var objectProto = Object.prototype;
var hasOwnProperty = objectProto.hasOwnProperty;
var nativeObjectToString = objectProto.toString;
var symToStringTag = Symbol_default ? Symbol_default.toStringTag : void 0;
function getRawTag(value) {
  var isOwn = hasOwnProperty.call(value, symToStringTag), tag = value[symToStringTag];
  try {
    value[symToStringTag] = void 0;
    var unmasked = true;
  } catch (e) {
  }
  var result = nativeObjectToString.call(value);
  if (unmasked) {
    if (isOwn) {
      value[symToStringTag] = tag;
    } else {
      delete value[symToStringTag];
    }
  }
  return result;
}
var getRawTag_default = getRawTag;

// ../../node_modules/.pnpm/lodash-es@4.18.1/node_modules/lodash-es/_objectToString.js
var objectProto2 = Object.prototype;
var nativeObjectToString2 = objectProto2.toString;
function objectToString(value) {
  return nativeObjectToString2.call(value);
}
var objectToString_default = objectToString;

// ../../node_modules/.pnpm/lodash-es@4.18.1/node_modules/lodash-es/_baseGetTag.js
var nullTag = "[object Null]";
var undefinedTag = "[object Undefined]";
var symToStringTag2 = Symbol_default ? Symbol_default.toStringTag : void 0;
function baseGetTag(value) {
  if (value == null) {
    return value === void 0 ? undefinedTag : nullTag;
  }
  return symToStringTag2 && symToStringTag2 in Object(value) ? getRawTag_default(value) : objectToString_default(value);
}
var baseGetTag_default = baseGetTag;

// ../../node_modules/.pnpm/lodash-es@4.18.1/node_modules/lodash-es/isObjectLike.js
function isObjectLike(value) {
  return value != null && typeof value == "object";
}
var isObjectLike_default = isObjectLike;

// ../../node_modules/.pnpm/lodash-es@4.18.1/node_modules/lodash-es/isSymbol.js
var symbolTag = "[object Symbol]";
function isSymbol(value) {
  return typeof value == "symbol" || isObjectLike_default(value) && baseGetTag_default(value) == symbolTag;
}
var isSymbol_default = isSymbol;

// ../../node_modules/.pnpm/lodash-es@4.18.1/node_modules/lodash-es/toNumber.js
var NAN = 0 / 0;
var reIsBadHex = /^[-+]0x[0-9a-f]+$/i;
var reIsBinary = /^0b[01]+$/i;
var reIsOctal = /^0o[0-7]+$/i;
var freeParseInt = parseInt;
function toNumber(value) {
  if (typeof value == "number") {
    return value;
  }
  if (isSymbol_default(value)) {
    return NAN;
  }
  if (isObject_default(value)) {
    var other = typeof value.valueOf == "function" ? value.valueOf() : value;
    value = isObject_default(other) ? other + "" : other;
  }
  if (typeof value != "string") {
    return value === 0 ? value : +value;
  }
  value = baseTrim_default(value);
  var isBinary = reIsBinary.test(value);
  return isBinary || reIsOctal.test(value) ? freeParseInt(value.slice(2), isBinary ? 2 : 8) : reIsBadHex.test(value) ? NAN : +value;
}
var toNumber_default = toNumber;

// ../../node_modules/.pnpm/lodash-es@4.18.1/node_modules/lodash-es/debounce.js
var FUNC_ERROR_TEXT = "Expected a function";
var nativeMax = Math.max;
var nativeMin = Math.min;
function debounce(func, wait, options) {
  var lastArgs, lastThis, maxWait, result, timerId, lastCallTime, lastInvokeTime = 0, leading = false, maxing = false, trailing = true;
  if (typeof func != "function") {
    throw new TypeError(FUNC_ERROR_TEXT);
  }
  wait = toNumber_default(wait) || 0;
  if (isObject_default(options)) {
    leading = !!options.leading;
    maxing = "maxWait" in options;
    maxWait = maxing ? nativeMax(toNumber_default(options.maxWait) || 0, wait) : maxWait;
    trailing = "trailing" in options ? !!options.trailing : trailing;
  }
  function invokeFunc(time) {
    var args = lastArgs, thisArg = lastThis;
    lastArgs = lastThis = void 0;
    lastInvokeTime = time;
    result = func.apply(thisArg, args);
    return result;
  }
  function leadingEdge(time) {
    lastInvokeTime = time;
    timerId = setTimeout(timerExpired, wait);
    return leading ? invokeFunc(time) : result;
  }
  function remainingWait(time) {
    var timeSinceLastCall = time - lastCallTime, timeSinceLastInvoke = time - lastInvokeTime, timeWaiting = wait - timeSinceLastCall;
    return maxing ? nativeMin(timeWaiting, maxWait - timeSinceLastInvoke) : timeWaiting;
  }
  function shouldInvoke(time) {
    var timeSinceLastCall = time - lastCallTime, timeSinceLastInvoke = time - lastInvokeTime;
    return lastCallTime === void 0 || timeSinceLastCall >= wait || timeSinceLastCall < 0 || maxing && timeSinceLastInvoke >= maxWait;
  }
  function timerExpired() {
    var time = now_default();
    if (shouldInvoke(time)) {
      return trailingEdge(time);
    }
    timerId = setTimeout(timerExpired, remainingWait(time));
  }
  function trailingEdge(time) {
    timerId = void 0;
    if (trailing && lastArgs) {
      return invokeFunc(time);
    }
    lastArgs = lastThis = void 0;
    return result;
  }
  function cancel() {
    if (timerId !== void 0) {
      clearTimeout(timerId);
    }
    lastInvokeTime = 0;
    lastArgs = lastCallTime = lastThis = timerId = void 0;
  }
  function flush() {
    return timerId === void 0 ? result : trailingEdge(now_default());
  }
  function debounced() {
    var time = now_default(), isInvoking = shouldInvoke(time);
    lastArgs = arguments;
    lastThis = this;
    lastCallTime = time;
    if (isInvoking) {
      if (timerId === void 0) {
        return leadingEdge(lastCallTime);
      }
      if (maxing) {
        clearTimeout(timerId);
        timerId = setTimeout(timerExpired, wait);
        return invokeFunc(lastCallTime);
      }
    }
    if (timerId === void 0) {
      timerId = setTimeout(timerExpired, wait);
    }
    return result;
  }
  debounced.cancel = cancel;
  debounced.flush = flush;
  return debounced;
}
var debounce_default = debounce;

// ../../node_modules/.pnpm/lodash-es@4.18.1/node_modules/lodash-es/throttle.js
var FUNC_ERROR_TEXT2 = "Expected a function";
function throttle(func, wait, options) {
  var leading = true, trailing = true;
  if (typeof func != "function") {
    throw new TypeError(FUNC_ERROR_TEXT2);
  }
  if (isObject_default(options)) {
    leading = "leading" in options ? !!options.leading : leading;
    trailing = "trailing" in options ? !!options.trailing : trailing;
  }
  return debounce_default(func, wait, {
    "leading": leading,
    "maxWait": wait,
    "trailing": trailing
  });
}
var throttle_default = throttle;

// ../../node_modules/.pnpm/simplebar-core@1.3.2/node_modules/simplebar-core/dist/index.mjs
var __assign = function() {
  __assign = Object.assign || function __assign3(t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
      s = arguments[i];
      for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
    }
    return t;
  };
  return __assign.apply(this, arguments);
};
function getElementWindow$1(element) {
  if (!element || !element.ownerDocument || !element.ownerDocument.defaultView) {
    return window;
  }
  return element.ownerDocument.defaultView;
}
function getElementDocument$1(element) {
  if (!element || !element.ownerDocument) {
    return document;
  }
  return element.ownerDocument;
}
var getOptions$1 = function(obj) {
  var initialObj = {};
  var options = Array.prototype.reduce.call(obj, function(acc, attribute) {
    var option = attribute.name.match(/data-simplebar-(.+)/);
    if (option) {
      var key = option[1].replace(/\W+(.)/g, function(_, chr) {
        return chr.toUpperCase();
      });
      switch (attribute.value) {
        case "true":
          acc[key] = true;
          break;
        case "false":
          acc[key] = false;
          break;
        case void 0:
          acc[key] = true;
          break;
        default:
          acc[key] = attribute.value;
      }
    }
    return acc;
  }, initialObj);
  return options;
};
function addClasses$1(el, classes) {
  var _a;
  if (!el)
    return;
  (_a = el.classList).add.apply(_a, classes.split(" "));
}
function removeClasses$1(el, classes) {
  if (!el)
    return;
  classes.split(" ").forEach(function(className) {
    el.classList.remove(className);
  });
}
function classNamesToQuery$1(classNames) {
  return ".".concat(classNames.split(" ").join("."));
}
var canUseDOM = !!(typeof window !== "undefined" && window.document && window.document.createElement);
var helpers = /* @__PURE__ */ Object.freeze({
  __proto__: null,
  addClasses: addClasses$1,
  canUseDOM,
  classNamesToQuery: classNamesToQuery$1,
  getElementDocument: getElementDocument$1,
  getElementWindow: getElementWindow$1,
  getOptions: getOptions$1,
  removeClasses: removeClasses$1
});
var cachedScrollbarWidth = null;
var cachedDevicePixelRatio = null;
if (canUseDOM) {
  window.addEventListener("resize", function() {
    if (cachedDevicePixelRatio !== window.devicePixelRatio) {
      cachedDevicePixelRatio = window.devicePixelRatio;
      cachedScrollbarWidth = null;
    }
  });
}
function scrollbarWidth() {
  if (cachedScrollbarWidth === null) {
    if (typeof document === "undefined") {
      cachedScrollbarWidth = 0;
      return cachedScrollbarWidth;
    }
    var body = document.body;
    var box = document.createElement("div");
    box.classList.add("simplebar-hide-scrollbar");
    body.appendChild(box);
    var width = box.getBoundingClientRect().right;
    body.removeChild(box);
    cachedScrollbarWidth = width;
  }
  return cachedScrollbarWidth;
}
var getElementWindow = getElementWindow$1;
var getElementDocument = getElementDocument$1;
var getOptions = getOptions$1;
var addClasses = addClasses$1;
var removeClasses = removeClasses$1;
var classNamesToQuery = classNamesToQuery$1;
var SimpleBarCore = (
  /** @class */
  (function() {
    function SimpleBarCore2(element, options) {
      if (options === void 0) {
        options = {};
      }
      var _this = this;
      this.removePreventClickId = null;
      this.minScrollbarWidth = 20;
      this.stopScrollDelay = 175;
      this.isScrolling = false;
      this.isMouseEntering = false;
      this.isDragging = false;
      this.scrollXTicking = false;
      this.scrollYTicking = false;
      this.wrapperEl = null;
      this.contentWrapperEl = null;
      this.contentEl = null;
      this.offsetEl = null;
      this.maskEl = null;
      this.placeholderEl = null;
      this.heightAutoObserverWrapperEl = null;
      this.heightAutoObserverEl = null;
      this.rtlHelpers = null;
      this.scrollbarWidth = 0;
      this.resizeObserver = null;
      this.mutationObserver = null;
      this.elStyles = null;
      this.isRtl = null;
      this.mouseX = 0;
      this.mouseY = 0;
      this.onMouseMove = function() {
      };
      this.onWindowResize = function() {
      };
      this.onStopScrolling = function() {
      };
      this.onMouseEntered = function() {
      };
      this.onScroll = function() {
        var elWindow = getElementWindow(_this.el);
        if (!_this.scrollXTicking) {
          elWindow.requestAnimationFrame(_this.scrollX);
          _this.scrollXTicking = true;
        }
        if (!_this.scrollYTicking) {
          elWindow.requestAnimationFrame(_this.scrollY);
          _this.scrollYTicking = true;
        }
        if (!_this.isScrolling) {
          _this.isScrolling = true;
          addClasses(_this.el, _this.classNames.scrolling);
        }
        _this.showScrollbar("x");
        _this.showScrollbar("y");
        _this.onStopScrolling();
      };
      this.scrollX = function() {
        if (_this.axis.x.isOverflowing) {
          _this.positionScrollbar("x");
        }
        _this.scrollXTicking = false;
      };
      this.scrollY = function() {
        if (_this.axis.y.isOverflowing) {
          _this.positionScrollbar("y");
        }
        _this.scrollYTicking = false;
      };
      this._onStopScrolling = function() {
        removeClasses(_this.el, _this.classNames.scrolling);
        if (_this.options.autoHide) {
          _this.hideScrollbar("x");
          _this.hideScrollbar("y");
        }
        _this.isScrolling = false;
      };
      this.onMouseEnter = function() {
        if (!_this.isMouseEntering) {
          addClasses(_this.el, _this.classNames.mouseEntered);
          _this.showScrollbar("x");
          _this.showScrollbar("y");
          _this.isMouseEntering = true;
        }
        _this.onMouseEntered();
      };
      this._onMouseEntered = function() {
        removeClasses(_this.el, _this.classNames.mouseEntered);
        if (_this.options.autoHide) {
          _this.hideScrollbar("x");
          _this.hideScrollbar("y");
        }
        _this.isMouseEntering = false;
      };
      this._onMouseMove = function(e) {
        _this.mouseX = e.clientX;
        _this.mouseY = e.clientY;
        if (_this.axis.x.isOverflowing || _this.axis.x.forceVisible) {
          _this.onMouseMoveForAxis("x");
        }
        if (_this.axis.y.isOverflowing || _this.axis.y.forceVisible) {
          _this.onMouseMoveForAxis("y");
        }
      };
      this.onMouseLeave = function() {
        _this.onMouseMove.cancel();
        if (_this.axis.x.isOverflowing || _this.axis.x.forceVisible) {
          _this.onMouseLeaveForAxis("x");
        }
        if (_this.axis.y.isOverflowing || _this.axis.y.forceVisible) {
          _this.onMouseLeaveForAxis("y");
        }
        _this.mouseX = -1;
        _this.mouseY = -1;
      };
      this._onWindowResize = function() {
        _this.scrollbarWidth = _this.getScrollbarWidth();
        _this.hideNativeScrollbar();
      };
      this.onPointerEvent = function(e) {
        if (!_this.axis.x.track.el || !_this.axis.y.track.el || !_this.axis.x.scrollbar.el || !_this.axis.y.scrollbar.el)
          return;
        var isWithinTrackXBounds, isWithinTrackYBounds;
        _this.axis.x.track.rect = _this.axis.x.track.el.getBoundingClientRect();
        _this.axis.y.track.rect = _this.axis.y.track.el.getBoundingClientRect();
        if (_this.axis.x.isOverflowing || _this.axis.x.forceVisible) {
          isWithinTrackXBounds = _this.isWithinBounds(_this.axis.x.track.rect);
        }
        if (_this.axis.y.isOverflowing || _this.axis.y.forceVisible) {
          isWithinTrackYBounds = _this.isWithinBounds(_this.axis.y.track.rect);
        }
        if (isWithinTrackXBounds || isWithinTrackYBounds) {
          e.stopPropagation();
          if (e.type === "pointerdown" && e.pointerType !== "touch") {
            if (isWithinTrackXBounds) {
              _this.axis.x.scrollbar.rect = _this.axis.x.scrollbar.el.getBoundingClientRect();
              if (_this.isWithinBounds(_this.axis.x.scrollbar.rect)) {
                _this.onDragStart(e, "x");
              } else {
                _this.onTrackClick(e, "x");
              }
            }
            if (isWithinTrackYBounds) {
              _this.axis.y.scrollbar.rect = _this.axis.y.scrollbar.el.getBoundingClientRect();
              if (_this.isWithinBounds(_this.axis.y.scrollbar.rect)) {
                _this.onDragStart(e, "y");
              } else {
                _this.onTrackClick(e, "y");
              }
            }
          }
        }
      };
      this.drag = function(e) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
        if (!_this.draggedAxis || !_this.contentWrapperEl)
          return;
        var eventOffset;
        var track = _this.axis[_this.draggedAxis].track;
        var trackSize = (_b = (_a = track.rect) === null || _a === void 0 ? void 0 : _a[_this.axis[_this.draggedAxis].sizeAttr]) !== null && _b !== void 0 ? _b : 0;
        var scrollbar = _this.axis[_this.draggedAxis].scrollbar;
        var contentSize = (_d = (_c = _this.contentWrapperEl) === null || _c === void 0 ? void 0 : _c[_this.axis[_this.draggedAxis].scrollSizeAttr]) !== null && _d !== void 0 ? _d : 0;
        var hostSize = parseInt((_f = (_e = _this.elStyles) === null || _e === void 0 ? void 0 : _e[_this.axis[_this.draggedAxis].sizeAttr]) !== null && _f !== void 0 ? _f : "0px", 10);
        e.preventDefault();
        e.stopPropagation();
        if (_this.draggedAxis === "y") {
          eventOffset = e.pageY;
        } else {
          eventOffset = e.pageX;
        }
        var dragPos = eventOffset - ((_h = (_g = track.rect) === null || _g === void 0 ? void 0 : _g[_this.axis[_this.draggedAxis].offsetAttr]) !== null && _h !== void 0 ? _h : 0) - _this.axis[_this.draggedAxis].dragOffset;
        dragPos = _this.draggedAxis === "x" && _this.isRtl ? ((_k = (_j = track.rect) === null || _j === void 0 ? void 0 : _j[_this.axis[_this.draggedAxis].sizeAttr]) !== null && _k !== void 0 ? _k : 0) - scrollbar.size - dragPos : dragPos;
        var dragPerc = dragPos / (trackSize - scrollbar.size);
        var scrollPos = dragPerc * (contentSize - hostSize);
        if (_this.draggedAxis === "x" && _this.isRtl) {
          scrollPos = ((_l = SimpleBarCore2.getRtlHelpers()) === null || _l === void 0 ? void 0 : _l.isScrollingToNegative) ? -scrollPos : scrollPos;
        }
        _this.contentWrapperEl[_this.axis[_this.draggedAxis].scrollOffsetAttr] = scrollPos;
      };
      this.onEndDrag = function(e) {
        _this.isDragging = false;
        var elDocument = getElementDocument(_this.el);
        var elWindow = getElementWindow(_this.el);
        e.preventDefault();
        e.stopPropagation();
        removeClasses(_this.el, _this.classNames.dragging);
        _this.onStopScrolling();
        elDocument.removeEventListener("mousemove", _this.drag, true);
        elDocument.removeEventListener("mouseup", _this.onEndDrag, true);
        _this.removePreventClickId = elWindow.setTimeout(function() {
          elDocument.removeEventListener("click", _this.preventClick, true);
          elDocument.removeEventListener("dblclick", _this.preventClick, true);
          _this.removePreventClickId = null;
        });
      };
      this.preventClick = function(e) {
        e.preventDefault();
        e.stopPropagation();
      };
      this.el = element;
      this.options = __assign(__assign({}, SimpleBarCore2.defaultOptions), options);
      this.classNames = __assign(__assign({}, SimpleBarCore2.defaultOptions.classNames), options.classNames);
      this.axis = {
        x: {
          scrollOffsetAttr: "scrollLeft",
          sizeAttr: "width",
          scrollSizeAttr: "scrollWidth",
          offsetSizeAttr: "offsetWidth",
          offsetAttr: "left",
          overflowAttr: "overflowX",
          dragOffset: 0,
          isOverflowing: true,
          forceVisible: false,
          track: { size: null, el: null, rect: null, isVisible: false },
          scrollbar: { size: null, el: null, rect: null, isVisible: false }
        },
        y: {
          scrollOffsetAttr: "scrollTop",
          sizeAttr: "height",
          scrollSizeAttr: "scrollHeight",
          offsetSizeAttr: "offsetHeight",
          offsetAttr: "top",
          overflowAttr: "overflowY",
          dragOffset: 0,
          isOverflowing: true,
          forceVisible: false,
          track: { size: null, el: null, rect: null, isVisible: false },
          scrollbar: { size: null, el: null, rect: null, isVisible: false }
        }
      };
      if (typeof this.el !== "object" || !this.el.nodeName) {
        throw new Error("Argument passed to SimpleBar must be an HTML element instead of ".concat(this.el));
      }
      this.onMouseMove = throttle_default(this._onMouseMove, 64);
      this.onWindowResize = debounce_default(this._onWindowResize, 64, { leading: true });
      this.onStopScrolling = debounce_default(this._onStopScrolling, this.stopScrollDelay);
      this.onMouseEntered = debounce_default(this._onMouseEntered, this.stopScrollDelay);
      this.init();
    }
    SimpleBarCore2.getRtlHelpers = function() {
      if (SimpleBarCore2.rtlHelpers) {
        return SimpleBarCore2.rtlHelpers;
      }
      var dummyDiv = document.createElement("div");
      dummyDiv.innerHTML = '<div class="simplebar-dummy-scrollbar-size"><div></div></div>';
      var scrollbarDummyEl = dummyDiv.firstElementChild;
      var dummyChild = scrollbarDummyEl === null || scrollbarDummyEl === void 0 ? void 0 : scrollbarDummyEl.firstElementChild;
      if (!dummyChild)
        return null;
      document.body.appendChild(scrollbarDummyEl);
      scrollbarDummyEl.scrollLeft = 0;
      var dummyContainerOffset = SimpleBarCore2.getOffset(scrollbarDummyEl);
      var dummyChildOffset = SimpleBarCore2.getOffset(dummyChild);
      scrollbarDummyEl.scrollLeft = -999;
      var dummyChildOffsetAfterScroll = SimpleBarCore2.getOffset(dummyChild);
      document.body.removeChild(scrollbarDummyEl);
      SimpleBarCore2.rtlHelpers = {
        // determines if the scrolling is responding with negative values
        isScrollOriginAtZero: dummyContainerOffset.left !== dummyChildOffset.left,
        // determines if the origin scrollbar position is inverted or not (positioned on left or right)
        isScrollingToNegative: dummyChildOffset.left !== dummyChildOffsetAfterScroll.left
      };
      return SimpleBarCore2.rtlHelpers;
    };
    SimpleBarCore2.prototype.getScrollbarWidth = function() {
      try {
        if (this.contentWrapperEl && getComputedStyle(this.contentWrapperEl, "::-webkit-scrollbar").display === "none" || "scrollbarWidth" in document.documentElement.style || "-ms-overflow-style" in document.documentElement.style) {
          return 0;
        } else {
          return scrollbarWidth();
        }
      } catch (e) {
        return scrollbarWidth();
      }
    };
    SimpleBarCore2.getOffset = function(el) {
      var rect = el.getBoundingClientRect();
      var elDocument = getElementDocument(el);
      var elWindow = getElementWindow(el);
      return {
        top: rect.top + (elWindow.pageYOffset || elDocument.documentElement.scrollTop),
        left: rect.left + (elWindow.pageXOffset || elDocument.documentElement.scrollLeft)
      };
    };
    SimpleBarCore2.prototype.init = function() {
      if (canUseDOM) {
        this.initDOM();
        this.rtlHelpers = SimpleBarCore2.getRtlHelpers();
        this.scrollbarWidth = this.getScrollbarWidth();
        this.recalculate();
        this.initListeners();
      }
    };
    SimpleBarCore2.prototype.initDOM = function() {
      var _a, _b;
      this.wrapperEl = this.el.querySelector(classNamesToQuery(this.classNames.wrapper));
      this.contentWrapperEl = this.options.scrollableNode || this.el.querySelector(classNamesToQuery(this.classNames.contentWrapper));
      this.contentEl = this.options.contentNode || this.el.querySelector(classNamesToQuery(this.classNames.contentEl));
      this.offsetEl = this.el.querySelector(classNamesToQuery(this.classNames.offset));
      this.maskEl = this.el.querySelector(classNamesToQuery(this.classNames.mask));
      this.placeholderEl = this.findChild(this.wrapperEl, classNamesToQuery(this.classNames.placeholder));
      this.heightAutoObserverWrapperEl = this.el.querySelector(classNamesToQuery(this.classNames.heightAutoObserverWrapperEl));
      this.heightAutoObserverEl = this.el.querySelector(classNamesToQuery(this.classNames.heightAutoObserverEl));
      this.axis.x.track.el = this.findChild(this.el, "".concat(classNamesToQuery(this.classNames.track)).concat(classNamesToQuery(this.classNames.horizontal)));
      this.axis.y.track.el = this.findChild(this.el, "".concat(classNamesToQuery(this.classNames.track)).concat(classNamesToQuery(this.classNames.vertical)));
      this.axis.x.scrollbar.el = ((_a = this.axis.x.track.el) === null || _a === void 0 ? void 0 : _a.querySelector(classNamesToQuery(this.classNames.scrollbar))) || null;
      this.axis.y.scrollbar.el = ((_b = this.axis.y.track.el) === null || _b === void 0 ? void 0 : _b.querySelector(classNamesToQuery(this.classNames.scrollbar))) || null;
      if (!this.options.autoHide) {
        addClasses(this.axis.x.scrollbar.el, this.classNames.visible);
        addClasses(this.axis.y.scrollbar.el, this.classNames.visible);
      }
    };
    SimpleBarCore2.prototype.initListeners = function() {
      var _this = this;
      var _a;
      var elWindow = getElementWindow(this.el);
      this.el.addEventListener("mouseenter", this.onMouseEnter);
      this.el.addEventListener("pointerdown", this.onPointerEvent, true);
      this.el.addEventListener("mousemove", this.onMouseMove);
      this.el.addEventListener("mouseleave", this.onMouseLeave);
      (_a = this.contentWrapperEl) === null || _a === void 0 ? void 0 : _a.addEventListener("scroll", this.onScroll);
      elWindow.addEventListener("resize", this.onWindowResize);
      if (!this.contentEl)
        return;
      if (window.ResizeObserver) {
        var resizeObserverStarted_1 = false;
        var resizeObserver = elWindow.ResizeObserver || ResizeObserver;
        this.resizeObserver = new resizeObserver(function() {
          if (!resizeObserverStarted_1)
            return;
          elWindow.requestAnimationFrame(function() {
            _this.recalculate();
          });
        });
        this.resizeObserver.observe(this.el);
        this.resizeObserver.observe(this.contentEl);
        elWindow.requestAnimationFrame(function() {
          resizeObserverStarted_1 = true;
        });
      }
      this.mutationObserver = new elWindow.MutationObserver(function() {
        elWindow.requestAnimationFrame(function() {
          _this.recalculate();
        });
      });
      this.mutationObserver.observe(this.contentEl, {
        childList: true,
        subtree: true,
        characterData: true
      });
    };
    SimpleBarCore2.prototype.recalculate = function() {
      if (!this.heightAutoObserverEl || !this.contentEl || !this.contentWrapperEl || !this.wrapperEl || !this.placeholderEl)
        return;
      var elWindow = getElementWindow(this.el);
      this.elStyles = elWindow.getComputedStyle(this.el);
      this.isRtl = this.elStyles.direction === "rtl";
      var contentElOffsetWidth = this.contentEl.offsetWidth;
      var isHeightAuto = this.heightAutoObserverEl.offsetHeight <= 1;
      var isWidthAuto = this.heightAutoObserverEl.offsetWidth <= 1 || contentElOffsetWidth > 0;
      var contentWrapperElOffsetWidth = this.contentWrapperEl.offsetWidth;
      var elOverflowX = this.elStyles.overflowX;
      var elOverflowY = this.elStyles.overflowY;
      this.contentEl.style.padding = "".concat(this.elStyles.paddingTop, " ").concat(this.elStyles.paddingRight, " ").concat(this.elStyles.paddingBottom, " ").concat(this.elStyles.paddingLeft);
      this.wrapperEl.style.margin = "-".concat(this.elStyles.paddingTop, " -").concat(this.elStyles.paddingRight, " -").concat(this.elStyles.paddingBottom, " -").concat(this.elStyles.paddingLeft);
      var contentElScrollHeight = this.contentEl.scrollHeight;
      var contentElScrollWidth = this.contentEl.scrollWidth;
      this.contentWrapperEl.style.height = isHeightAuto ? "auto" : "100%";
      this.placeholderEl.style.width = isWidthAuto ? "".concat(contentElOffsetWidth || contentElScrollWidth, "px") : "auto";
      this.placeholderEl.style.height = "".concat(contentElScrollHeight, "px");
      var contentWrapperElOffsetHeight = this.contentWrapperEl.offsetHeight;
      this.axis.x.isOverflowing = contentElOffsetWidth !== 0 && contentElScrollWidth > contentElOffsetWidth;
      this.axis.y.isOverflowing = contentElScrollHeight > contentWrapperElOffsetHeight;
      this.axis.x.isOverflowing = elOverflowX === "hidden" ? false : this.axis.x.isOverflowing;
      this.axis.y.isOverflowing = elOverflowY === "hidden" ? false : this.axis.y.isOverflowing;
      this.axis.x.forceVisible = this.options.forceVisible === "x" || this.options.forceVisible === true;
      this.axis.y.forceVisible = this.options.forceVisible === "y" || this.options.forceVisible === true;
      this.hideNativeScrollbar();
      var offsetForXScrollbar = this.axis.x.isOverflowing ? this.scrollbarWidth : 0;
      var offsetForYScrollbar = this.axis.y.isOverflowing ? this.scrollbarWidth : 0;
      this.axis.x.isOverflowing = this.axis.x.isOverflowing && contentElScrollWidth > contentWrapperElOffsetWidth - offsetForYScrollbar;
      this.axis.y.isOverflowing = this.axis.y.isOverflowing && contentElScrollHeight > contentWrapperElOffsetHeight - offsetForXScrollbar;
      this.axis.x.scrollbar.size = this.getScrollbarSize("x");
      this.axis.y.scrollbar.size = this.getScrollbarSize("y");
      if (this.axis.x.scrollbar.el)
        this.axis.x.scrollbar.el.style.width = "".concat(this.axis.x.scrollbar.size, "px");
      if (this.axis.y.scrollbar.el)
        this.axis.y.scrollbar.el.style.height = "".concat(this.axis.y.scrollbar.size, "px");
      this.positionScrollbar("x");
      this.positionScrollbar("y");
      this.toggleTrackVisibility("x");
      this.toggleTrackVisibility("y");
    };
    SimpleBarCore2.prototype.getScrollbarSize = function(axis) {
      var _a, _b;
      if (axis === void 0) {
        axis = "y";
      }
      if (!this.axis[axis].isOverflowing || !this.contentEl) {
        return 0;
      }
      var contentSize = this.contentEl[this.axis[axis].scrollSizeAttr];
      var trackSize = (_b = (_a = this.axis[axis].track.el) === null || _a === void 0 ? void 0 : _a[this.axis[axis].offsetSizeAttr]) !== null && _b !== void 0 ? _b : 0;
      var scrollbarRatio = trackSize / contentSize;
      var scrollbarSize;
      scrollbarSize = Math.max(~~(scrollbarRatio * trackSize), this.options.scrollbarMinSize);
      if (this.options.scrollbarMaxSize) {
        scrollbarSize = Math.min(scrollbarSize, this.options.scrollbarMaxSize);
      }
      return scrollbarSize;
    };
    SimpleBarCore2.prototype.positionScrollbar = function(axis) {
      var _a, _b, _c;
      if (axis === void 0) {
        axis = "y";
      }
      var scrollbar = this.axis[axis].scrollbar;
      if (!this.axis[axis].isOverflowing || !this.contentWrapperEl || !scrollbar.el || !this.elStyles) {
        return;
      }
      var contentSize = this.contentWrapperEl[this.axis[axis].scrollSizeAttr];
      var trackSize = ((_a = this.axis[axis].track.el) === null || _a === void 0 ? void 0 : _a[this.axis[axis].offsetSizeAttr]) || 0;
      var hostSize = parseInt(this.elStyles[this.axis[axis].sizeAttr], 10);
      var scrollOffset = this.contentWrapperEl[this.axis[axis].scrollOffsetAttr];
      scrollOffset = axis === "x" && this.isRtl && ((_b = SimpleBarCore2.getRtlHelpers()) === null || _b === void 0 ? void 0 : _b.isScrollOriginAtZero) ? -scrollOffset : scrollOffset;
      if (axis === "x" && this.isRtl) {
        scrollOffset = ((_c = SimpleBarCore2.getRtlHelpers()) === null || _c === void 0 ? void 0 : _c.isScrollingToNegative) ? scrollOffset : -scrollOffset;
      }
      var scrollPourcent = scrollOffset / (contentSize - hostSize);
      var handleOffset = ~~((trackSize - scrollbar.size) * scrollPourcent);
      handleOffset = axis === "x" && this.isRtl ? -handleOffset + (trackSize - scrollbar.size) : handleOffset;
      scrollbar.el.style.transform = axis === "x" ? "translate3d(".concat(handleOffset, "px, 0, 0)") : "translate3d(0, ".concat(handleOffset, "px, 0)");
    };
    SimpleBarCore2.prototype.toggleTrackVisibility = function(axis) {
      if (axis === void 0) {
        axis = "y";
      }
      var track = this.axis[axis].track.el;
      var scrollbar = this.axis[axis].scrollbar.el;
      if (!track || !scrollbar || !this.contentWrapperEl)
        return;
      if (this.axis[axis].isOverflowing || this.axis[axis].forceVisible) {
        track.style.visibility = "visible";
        this.contentWrapperEl.style[this.axis[axis].overflowAttr] = "scroll";
        this.el.classList.add("".concat(this.classNames.scrollable, "-").concat(axis));
      } else {
        track.style.visibility = "hidden";
        this.contentWrapperEl.style[this.axis[axis].overflowAttr] = "hidden";
        this.el.classList.remove("".concat(this.classNames.scrollable, "-").concat(axis));
      }
      if (this.axis[axis].isOverflowing) {
        scrollbar.style.display = "block";
      } else {
        scrollbar.style.display = "none";
      }
    };
    SimpleBarCore2.prototype.showScrollbar = function(axis) {
      if (axis === void 0) {
        axis = "y";
      }
      if (this.axis[axis].isOverflowing && !this.axis[axis].scrollbar.isVisible) {
        addClasses(this.axis[axis].scrollbar.el, this.classNames.visible);
        this.axis[axis].scrollbar.isVisible = true;
      }
    };
    SimpleBarCore2.prototype.hideScrollbar = function(axis) {
      if (axis === void 0) {
        axis = "y";
      }
      if (this.isDragging)
        return;
      if (this.axis[axis].isOverflowing && this.axis[axis].scrollbar.isVisible) {
        removeClasses(this.axis[axis].scrollbar.el, this.classNames.visible);
        this.axis[axis].scrollbar.isVisible = false;
      }
    };
    SimpleBarCore2.prototype.hideNativeScrollbar = function() {
      if (!this.offsetEl)
        return;
      this.offsetEl.style[this.isRtl ? "left" : "right"] = this.axis.y.isOverflowing || this.axis.y.forceVisible ? "-".concat(this.scrollbarWidth, "px") : "0px";
      this.offsetEl.style.bottom = this.axis.x.isOverflowing || this.axis.x.forceVisible ? "-".concat(this.scrollbarWidth, "px") : "0px";
    };
    SimpleBarCore2.prototype.onMouseMoveForAxis = function(axis) {
      if (axis === void 0) {
        axis = "y";
      }
      var currentAxis = this.axis[axis];
      if (!currentAxis.track.el || !currentAxis.scrollbar.el)
        return;
      currentAxis.track.rect = currentAxis.track.el.getBoundingClientRect();
      currentAxis.scrollbar.rect = currentAxis.scrollbar.el.getBoundingClientRect();
      if (this.isWithinBounds(currentAxis.track.rect)) {
        this.showScrollbar(axis);
        addClasses(currentAxis.track.el, this.classNames.hover);
        if (this.isWithinBounds(currentAxis.scrollbar.rect)) {
          addClasses(currentAxis.scrollbar.el, this.classNames.hover);
        } else {
          removeClasses(currentAxis.scrollbar.el, this.classNames.hover);
        }
      } else {
        removeClasses(currentAxis.track.el, this.classNames.hover);
        if (this.options.autoHide) {
          this.hideScrollbar(axis);
        }
      }
    };
    SimpleBarCore2.prototype.onMouseLeaveForAxis = function(axis) {
      if (axis === void 0) {
        axis = "y";
      }
      removeClasses(this.axis[axis].track.el, this.classNames.hover);
      removeClasses(this.axis[axis].scrollbar.el, this.classNames.hover);
      if (this.options.autoHide) {
        this.hideScrollbar(axis);
      }
    };
    SimpleBarCore2.prototype.onDragStart = function(e, axis) {
      var _a;
      if (axis === void 0) {
        axis = "y";
      }
      this.isDragging = true;
      var elDocument = getElementDocument(this.el);
      var elWindow = getElementWindow(this.el);
      var scrollbar = this.axis[axis].scrollbar;
      var eventOffset = axis === "y" ? e.pageY : e.pageX;
      this.axis[axis].dragOffset = eventOffset - (((_a = scrollbar.rect) === null || _a === void 0 ? void 0 : _a[this.axis[axis].offsetAttr]) || 0);
      this.draggedAxis = axis;
      addClasses(this.el, this.classNames.dragging);
      elDocument.addEventListener("mousemove", this.drag, true);
      elDocument.addEventListener("mouseup", this.onEndDrag, true);
      if (this.removePreventClickId === null) {
        elDocument.addEventListener("click", this.preventClick, true);
        elDocument.addEventListener("dblclick", this.preventClick, true);
      } else {
        elWindow.clearTimeout(this.removePreventClickId);
        this.removePreventClickId = null;
      }
    };
    SimpleBarCore2.prototype.onTrackClick = function(e, axis) {
      var _this = this;
      var _a, _b, _c, _d;
      if (axis === void 0) {
        axis = "y";
      }
      var currentAxis = this.axis[axis];
      if (!this.options.clickOnTrack || !currentAxis.scrollbar.el || !this.contentWrapperEl)
        return;
      e.preventDefault();
      var elWindow = getElementWindow(this.el);
      this.axis[axis].scrollbar.rect = currentAxis.scrollbar.el.getBoundingClientRect();
      var scrollbar = this.axis[axis].scrollbar;
      var scrollbarOffset = (_b = (_a = scrollbar.rect) === null || _a === void 0 ? void 0 : _a[this.axis[axis].offsetAttr]) !== null && _b !== void 0 ? _b : 0;
      var hostSize = parseInt((_d = (_c = this.elStyles) === null || _c === void 0 ? void 0 : _c[this.axis[axis].sizeAttr]) !== null && _d !== void 0 ? _d : "0px", 10);
      var scrolled = this.contentWrapperEl[this.axis[axis].scrollOffsetAttr];
      var t = axis === "y" ? this.mouseY - scrollbarOffset : this.mouseX - scrollbarOffset;
      var dir = t < 0 ? -1 : 1;
      var scrollSize = dir === -1 ? scrolled - hostSize : scrolled + hostSize;
      var speed = 40;
      var scrollTo = function() {
        if (!_this.contentWrapperEl)
          return;
        if (dir === -1) {
          if (scrolled > scrollSize) {
            scrolled -= speed;
            _this.contentWrapperEl[_this.axis[axis].scrollOffsetAttr] = scrolled;
            elWindow.requestAnimationFrame(scrollTo);
          }
        } else {
          if (scrolled < scrollSize) {
            scrolled += speed;
            _this.contentWrapperEl[_this.axis[axis].scrollOffsetAttr] = scrolled;
            elWindow.requestAnimationFrame(scrollTo);
          }
        }
      };
      scrollTo();
    };
    SimpleBarCore2.prototype.getContentElement = function() {
      return this.contentEl;
    };
    SimpleBarCore2.prototype.getScrollElement = function() {
      return this.contentWrapperEl;
    };
    SimpleBarCore2.prototype.removeListeners = function() {
      var elWindow = getElementWindow(this.el);
      this.el.removeEventListener("mouseenter", this.onMouseEnter);
      this.el.removeEventListener("pointerdown", this.onPointerEvent, true);
      this.el.removeEventListener("mousemove", this.onMouseMove);
      this.el.removeEventListener("mouseleave", this.onMouseLeave);
      if (this.contentWrapperEl) {
        this.contentWrapperEl.removeEventListener("scroll", this.onScroll);
      }
      elWindow.removeEventListener("resize", this.onWindowResize);
      if (this.mutationObserver) {
        this.mutationObserver.disconnect();
      }
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
      }
      this.onMouseMove.cancel();
      this.onWindowResize.cancel();
      this.onStopScrolling.cancel();
      this.onMouseEntered.cancel();
    };
    SimpleBarCore2.prototype.unMount = function() {
      this.removeListeners();
    };
    SimpleBarCore2.prototype.isWithinBounds = function(bbox) {
      return this.mouseX >= bbox.left && this.mouseX <= bbox.left + bbox.width && this.mouseY >= bbox.top && this.mouseY <= bbox.top + bbox.height;
    };
    SimpleBarCore2.prototype.findChild = function(el, query) {
      var matches = el.matches || el.webkitMatchesSelector || el.mozMatchesSelector || el.msMatchesSelector;
      return Array.prototype.filter.call(el.children, function(child) {
        return matches.call(child, query);
      })[0];
    };
    SimpleBarCore2.rtlHelpers = null;
    SimpleBarCore2.defaultOptions = {
      forceVisible: false,
      clickOnTrack: true,
      scrollbarMinSize: 25,
      scrollbarMaxSize: 0,
      ariaLabel: "scrollable content",
      tabIndex: 0,
      classNames: {
        contentEl: "simplebar-content",
        contentWrapper: "simplebar-content-wrapper",
        offset: "simplebar-offset",
        mask: "simplebar-mask",
        wrapper: "simplebar-wrapper",
        placeholder: "simplebar-placeholder",
        scrollbar: "simplebar-scrollbar",
        track: "simplebar-track",
        heightAutoObserverWrapperEl: "simplebar-height-auto-observer-wrapper",
        heightAutoObserverEl: "simplebar-height-auto-observer",
        visible: "simplebar-visible",
        horizontal: "simplebar-horizontal",
        vertical: "simplebar-vertical",
        hover: "simplebar-hover",
        dragging: "simplebar-dragging",
        scrolling: "simplebar-scrolling",
        scrollable: "simplebar-scrollable",
        mouseEntered: "simplebar-mouse-entered"
      },
      scrollableNode: null,
      contentNode: null,
      autoHide: true
    };
    SimpleBarCore2.getOptions = getOptions;
    SimpleBarCore2.helpers = helpers;
    return SimpleBarCore2;
  })()
);

// ../../node_modules/.pnpm/simplebar-react@3.3.2_react@19.2.8/node_modules/simplebar-react/dist/index.mjs
var __assign2 = function() {
  __assign2 = Object.assign || function __assign3(t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
      s = arguments[i];
      for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
    }
    return t;
  };
  return __assign2.apply(this, arguments);
};
function __rest(s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
    t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function")
    for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
      if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
        t[p[i]] = s[p[i]];
    }
  return t;
}
var SimpleBar = React.forwardRef(function(_a, ref) {
  var children = _a.children, _b = _a.scrollableNodeProps, scrollableNodeProps = _b === void 0 ? {} : _b, otherProps = __rest(_a, ["children", "scrollableNodeProps"]);
  var elRef = React.useRef();
  var scrollableNodeRef = React.useRef();
  var contentNodeRef = React.useRef();
  var options = {};
  var rest = {};
  Object.keys(otherProps).forEach(function(key) {
    if (Object.prototype.hasOwnProperty.call(SimpleBarCore.defaultOptions, key)) {
      options[key] = otherProps[key];
    } else {
      rest[key] = otherProps[key];
    }
  });
  var classNames = __assign2(__assign2({}, SimpleBarCore.defaultOptions.classNames), options.classNames);
  var scrollableNodeFullProps = __assign2(__assign2({}, scrollableNodeProps), { className: "".concat(classNames.contentWrapper).concat(scrollableNodeProps.className ? " ".concat(scrollableNodeProps.className) : ""), tabIndex: options.tabIndex || SimpleBarCore.defaultOptions.tabIndex, role: "region", "aria-label": options.ariaLabel || SimpleBarCore.defaultOptions.ariaLabel });
  React.useEffect(function() {
    var instance;
    scrollableNodeRef.current = scrollableNodeFullProps.ref ? scrollableNodeFullProps.ref.current : scrollableNodeRef.current;
    if (elRef.current) {
      instance = new SimpleBarCore(elRef.current, __assign2(__assign2(__assign2({}, options), scrollableNodeRef.current && {
        scrollableNode: scrollableNodeRef.current
      }), contentNodeRef.current && {
        contentNode: contentNodeRef.current
      }));
      if (typeof ref === "function") {
        ref(instance);
      } else if (ref) {
        ref.current = instance;
      }
    }
    return function() {
      instance === null || instance === void 0 ? void 0 : instance.unMount();
      instance = null;
      if (typeof ref === "function") {
        ref(null);
      }
    };
  }, []);
  return React.createElement(
    "div",
    __assign2({ "data-simplebar": "init", ref: elRef }, rest),
    React.createElement(
      "div",
      { className: classNames.wrapper },
      React.createElement(
        "div",
        { className: classNames.heightAutoObserverWrapperEl },
        React.createElement("div", { className: classNames.heightAutoObserverEl })
      ),
      React.createElement(
        "div",
        { className: classNames.mask },
        React.createElement("div", { className: classNames.offset }, typeof children === "function" ? children({
          scrollableNodeRef,
          scrollableNodeProps: __assign2(__assign2({}, scrollableNodeFullProps), { ref: scrollableNodeRef }),
          contentNodeRef,
          contentNodeProps: {
            className: classNames.contentEl,
            ref: contentNodeRef
          }
        }) : React.createElement(
          "div",
          __assign2({}, scrollableNodeFullProps),
          React.createElement("div", { className: classNames.contentEl }, children)
        ))
      ),
      React.createElement("div", { className: classNames.placeholder })
    ),
    React.createElement(
      "div",
      { className: "".concat(classNames.track, " ").concat(classNames.horizontal) },
      React.createElement("div", { className: classNames.scrollbar })
    ),
    React.createElement(
      "div",
      { className: "".concat(classNames.track, " ").concat(classNames.vertical) },
      React.createElement("div", { className: classNames.scrollbar })
    )
  );
});
SimpleBar.displayName = "SimpleBar";

// shell/.ojm-shim-simplebar-react.mjs
var ojm_shim_simplebar_react_default = SimpleBar ?? dist_exports;
export {
  ojm_shim_simplebar_react_default as default
};
