var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/.pnpm/size-sensor@1.0.3/node_modules/size-sensor/lib/id.js
var require_id = __commonJS({
  "../../node_modules/.pnpm/size-sensor@1.0.3/node_modules/size-sensor/lib/id.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var id = 1;
    var _default = exports["default"] = function _default2() {
      return "".concat(id++);
    };
  }
});

// ../../node_modules/.pnpm/size-sensor@1.0.3/node_modules/size-sensor/lib/debounce.js
var require_debounce = __commonJS({
  "../../node_modules/.pnpm/size-sensor@1.0.3/node_modules/size-sensor/lib/debounce.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _default = exports["default"] = function _default2(fn) {
      var delay = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 60;
      var timer = null;
      return function() {
        var _this = this;
        for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
          args[_key] = arguments[_key];
        }
        clearTimeout(timer);
        timer = setTimeout(function() {
          fn.apply(_this, args);
        }, delay);
      };
    };
  }
});

// ../../node_modules/.pnpm/size-sensor@1.0.3/node_modules/size-sensor/lib/constant.js
var require_constant = __commonJS({
  "../../node_modules/.pnpm/size-sensor@1.0.3/node_modules/size-sensor/lib/constant.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.SizeSensorId = exports.SensorTabIndex = exports.SensorClassName = void 0;
    var SizeSensorId = exports.SizeSensorId = "size-sensor-id";
    var SensorClassName = exports.SensorClassName = "size-sensor-object";
    var SensorTabIndex = exports.SensorTabIndex = "-1";
  }
});

// ../../node_modules/.pnpm/size-sensor@1.0.3/node_modules/size-sensor/lib/sensors/object.js
var require_object = __commonJS({
  "../../node_modules/.pnpm/size-sensor@1.0.3/node_modules/size-sensor/lib/sensors/object.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.createSensor = void 0;
    var _debounce = _interopRequireDefault(require_debounce());
    var _constant = require_constant();
    function _interopRequireDefault(e) {
      return e && e.__esModule ? e : { "default": e };
    }
    var createSensor = exports.createSensor = function createSensor2(element, whenDestroy) {
      var sensor = void 0;
      var listeners = [];
      var newSensor = function newSensor2() {
        if (getComputedStyle(element).position === "static") {
          element.style.position = "relative";
        }
        var obj = document.createElement("object");
        obj.onload = function() {
          obj.contentDocument.defaultView.addEventListener("resize", resizeListener);
          resizeListener();
        };
        obj.style.display = "block";
        obj.style.position = "absolute";
        obj.style.top = "0";
        obj.style.left = "0";
        obj.style.height = "100%";
        obj.style.width = "100%";
        obj.style.overflow = "hidden";
        obj.style.pointerEvents = "none";
        obj.style.zIndex = "-1";
        obj.style.opacity = "0";
        obj.setAttribute("class", _constant.SensorClassName);
        obj.setAttribute("tabindex", _constant.SensorTabIndex);
        obj.type = "text/html";
        element.appendChild(obj);
        obj.data = "about:blank";
        return obj;
      };
      var resizeListener = (0, _debounce["default"])(function() {
        listeners.forEach(function(listener) {
          listener(element);
        });
      });
      var bind2 = function bind3(cb) {
        if (!sensor) {
          sensor = newSensor();
        }
        if (listeners.indexOf(cb) === -1) {
          listeners.push(cb);
        }
      };
      var destroy = function destroy2() {
        if (sensor && sensor.parentNode) {
          if (sensor.contentDocument) {
            sensor.contentDocument.defaultView.removeEventListener("resize", resizeListener);
          }
          sensor.parentNode.removeChild(sensor);
          element.removeAttribute(_constant.SizeSensorId);
          sensor = void 0;
          listeners = [];
          whenDestroy && whenDestroy();
        }
      };
      var unbind = function unbind2(cb) {
        var idx = listeners.indexOf(cb);
        if (idx !== -1) {
          listeners.splice(idx, 1);
        }
        if (listeners.length === 0 && sensor) {
          destroy();
        }
      };
      return {
        element,
        bind: bind2,
        destroy,
        unbind
      };
    };
  }
});

// ../../node_modules/.pnpm/size-sensor@1.0.3/node_modules/size-sensor/lib/sensors/resizeObserver.js
var require_resizeObserver = __commonJS({
  "../../node_modules/.pnpm/size-sensor@1.0.3/node_modules/size-sensor/lib/sensors/resizeObserver.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.createSensor = void 0;
    var _constant = require_constant();
    var _debounce = _interopRequireDefault(require_debounce());
    function _interopRequireDefault(e) {
      return e && e.__esModule ? e : { "default": e };
    }
    var createSensor = exports.createSensor = function createSensor2(element, whenDestroy) {
      var sensor = void 0;
      var listeners = [];
      var resizeListener = (0, _debounce["default"])(function() {
        listeners.forEach(function(listener) {
          listener(element);
        });
      });
      var newSensor = function newSensor2() {
        var s = new ResizeObserver(resizeListener);
        s.observe(element);
        resizeListener();
        return s;
      };
      var bind2 = function bind3(cb) {
        if (!sensor) {
          sensor = newSensor();
        }
        if (listeners.indexOf(cb) === -1) {
          listeners.push(cb);
        }
      };
      var destroy = function destroy2() {
        if (sensor) {
          sensor.disconnect();
        }
        listeners = [];
        sensor = void 0;
        element.removeAttribute(_constant.SizeSensorId);
        whenDestroy && whenDestroy();
      };
      var unbind = function unbind2(cb) {
        var idx = listeners.indexOf(cb);
        if (idx !== -1) {
          listeners.splice(idx, 1);
        }
        if (listeners.length === 0 && sensor) {
          destroy();
        }
      };
      return {
        element,
        bind: bind2,
        destroy,
        unbind
      };
    };
  }
});

// ../../node_modules/.pnpm/size-sensor@1.0.3/node_modules/size-sensor/lib/sensors/index.js
var require_sensors = __commonJS({
  "../../node_modules/.pnpm/size-sensor@1.0.3/node_modules/size-sensor/lib/sensors/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.createSensor = void 0;
    var _object = require_object();
    var _resizeObserver = require_resizeObserver();
    var createSensor = exports.createSensor = typeof ResizeObserver !== "undefined" ? _resizeObserver.createSensor : _object.createSensor;
  }
});

// ../../node_modules/.pnpm/size-sensor@1.0.3/node_modules/size-sensor/lib/sensorPool.js
var require_sensorPool = __commonJS({
  "../../node_modules/.pnpm/size-sensor@1.0.3/node_modules/size-sensor/lib/sensorPool.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.removeSensor = exports.getSensor = exports.Sensors = void 0;
    var _id = _interopRequireDefault(require_id());
    var _sensors = require_sensors();
    var _constant = require_constant();
    function _interopRequireDefault(e) {
      return e && e.__esModule ? e : { "default": e };
    }
    var Sensors = exports.Sensors = {};
    function clean(sensorId) {
      if (sensorId && Sensors[sensorId]) {
        delete Sensors[sensorId];
      }
    }
    var getSensor = exports.getSensor = function getSensor2(element) {
      var sensorId = element.getAttribute(_constant.SizeSensorId);
      if (sensorId && Sensors[sensorId]) {
        return Sensors[sensorId];
      }
      var newId = (0, _id["default"])();
      element.setAttribute(_constant.SizeSensorId, newId);
      var sensor = (0, _sensors.createSensor)(element, function() {
        return clean(newId);
      });
      Sensors[newId] = sensor;
      return sensor;
    };
    var removeSensor = exports.removeSensor = function removeSensor2(sensor) {
      var sensorId = sensor.element.getAttribute(_constant.SizeSensorId);
      sensor.destroy();
      clean(sensorId);
    };
  }
});

// ../../node_modules/.pnpm/size-sensor@1.0.3/node_modules/size-sensor/lib/index.js
var require_lib = __commonJS({
  "../../node_modules/.pnpm/size-sensor@1.0.3/node_modules/size-sensor/lib/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.ver = exports.clear = exports.bind = void 0;
    var _sensorPool = require_sensorPool();
    var bind2 = exports.bind = function bind3(element, cb) {
      var sensor = (0, _sensorPool.getSensor)(element);
      sensor.bind(cb);
      return function() {
        sensor.unbind(cb);
      };
    };
    var clear2 = exports.clear = function clear3(element) {
      var sensor = (0, _sensorPool.getSensor)(element);
      (0, _sensorPool.removeSensor)(sensor);
    };
    var ver = exports.ver = "1.0.3";
  }
});

// ../../node_modules/.pnpm/fast-deep-equal@3.1.3/node_modules/fast-deep-equal/index.js
var require_fast_deep_equal = __commonJS({
  "../../node_modules/.pnpm/fast-deep-equal@3.1.3/node_modules/fast-deep-equal/index.js"(exports, module) {
    "use strict";
    module.exports = function equal(a, b) {
      if (a === b) return true;
      if (a && b && typeof a == "object" && typeof b == "object") {
        if (a.constructor !== b.constructor) return false;
        var length, i, keys;
        if (Array.isArray(a)) {
          length = a.length;
          if (length != b.length) return false;
          for (i = length; i-- !== 0; )
            if (!equal(a[i], b[i])) return false;
          return true;
        }
        if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags;
        if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf();
        if (a.toString !== Object.prototype.toString) return a.toString() === b.toString();
        keys = Object.keys(a);
        length = keys.length;
        if (length !== Object.keys(b).length) return false;
        for (i = length; i-- !== 0; )
          if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false;
        for (i = length; i-- !== 0; ) {
          var key = keys[i];
          if (!equal(a[key], b[key])) return false;
        }
        return true;
      }
      return a !== a && b !== b;
    };
  }
});

// ../../node_modules/.pnpm/echarts-for-react@3.0.6_echarts@6.1.0_react@19.2.8/node_modules/echarts-for-react/esm/index.js
var esm_exports = {};
__export(esm_exports, {
  default: () => esm_default
});

// ../../node_modules/.pnpm/tslib@2.8.1/node_modules/tslib/tslib.es6.mjs
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
var __assign = function() {
  __assign = Object.assign || function __assign2(t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
      s = arguments[i];
      for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
    }
    return t;
  };
  return __assign.apply(this, arguments);
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
function __awaiter(thisArg, _arguments, P, generator) {
  function adopt(value) {
    return value instanceof P ? value : new P(function(resolve) {
      resolve(value);
    });
  }
  return new (P || (P = Promise))(function(resolve, reject) {
    function fulfilled(value) {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    }
    function rejected(value) {
      try {
        step(generator["throw"](value));
      } catch (e) {
        reject(e);
      }
    }
    function step(result) {
      result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
    }
    step((generator = generator.apply(thisArg, _arguments || [])).next());
  });
}
function __generator(thisArg, body) {
  var _ = { label: 0, sent: function() {
    if (t[0] & 1) throw t[1];
    return t[1];
  }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
  return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() {
    return this;
  }), g;
  function verb(n) {
    return function(v) {
      return step([n, v]);
    };
  }
  function step(op) {
    if (f) throw new TypeError("Generator is already executing.");
    while (g && (g = 0, op[0] && (_ = 0)), _) try {
      if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
      if (y = 0, t) op = [op[0] & 2, t.value];
      switch (op[0]) {
        case 0:
        case 1:
          t = op;
          break;
        case 4:
          _.label++;
          return { value: op[1], done: false };
        case 5:
          _.label++;
          y = op[1];
          op = [0];
          continue;
        case 7:
          op = _.ops.pop();
          _.trys.pop();
          continue;
        default:
          if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) {
            _ = 0;
            continue;
          }
          if (op[0] === 3 && (!t || op[1] > t[0] && op[1] < t[3])) {
            _.label = op[1];
            break;
          }
          if (op[0] === 6 && _.label < t[1]) {
            _.label = t[1];
            t = op;
            break;
          }
          if (t && _.label < t[2]) {
            _.label = t[2];
            _.ops.push(op);
            break;
          }
          if (t[2]) _.ops.pop();
          _.trys.pop();
          continue;
      }
      op = body.call(thisArg, _);
    } catch (e) {
      op = [6, e];
      y = 0;
    } finally {
      f = t = 0;
    }
    if (op[0] & 5) throw op[1];
    return { value: op[0] ? op[1] : void 0, done: true };
  }
}

// ../../node_modules/.pnpm/echarts-for-react@3.0.6_echarts@6.1.0_react@19.2.8/node_modules/echarts-for-react/esm/index.js
import * as echarts from "echarts";

// ../../node_modules/.pnpm/echarts-for-react@3.0.6_echarts@6.1.0_react@19.2.8/node_modules/echarts-for-react/esm/core.js
var import_size_sensor = __toESM(require_lib());
import React, { PureComponent } from "react";

// ../../node_modules/.pnpm/echarts-for-react@3.0.6_echarts@6.1.0_react@19.2.8/node_modules/echarts-for-react/esm/helper/pick.js
function pick(obj, keys) {
  var r = {};
  keys.forEach(function(key) {
    r[key] = obj[key];
  });
  return r;
}

// ../../node_modules/.pnpm/echarts-for-react@3.0.6_echarts@6.1.0_react@19.2.8/node_modules/echarts-for-react/esm/helper/is-function.js
function isFunction(v) {
  return typeof v === "function";
}

// ../../node_modules/.pnpm/echarts-for-react@3.0.6_echarts@6.1.0_react@19.2.8/node_modules/echarts-for-react/esm/helper/is-string.js
function isString(v) {
  return typeof v === "string";
}

// ../../node_modules/.pnpm/echarts-for-react@3.0.6_echarts@6.1.0_react@19.2.8/node_modules/echarts-for-react/esm/helper/is-equal.js
var import_fast_deep_equal = __toESM(require_fast_deep_equal());

// ../../node_modules/.pnpm/echarts-for-react@3.0.6_echarts@6.1.0_react@19.2.8/node_modules/echarts-for-react/esm/core.js
var EChartsReactCore = (
  /** @class */
  (function(_super) {
    __extends(EChartsReactCore2, _super);
    function EChartsReactCore2(props) {
      var _this = _super.call(this, props) || this;
      _this.echarts = props.echarts;
      _this.ele = null;
      _this.isInitialResize = true;
      _this.eventHandlerRefs = {};
      return _this;
    }
    EChartsReactCore2.prototype.componentDidMount = function() {
      this.renderNewEcharts();
    };
    EChartsReactCore2.prototype.componentDidUpdate = function(prevProps) {
      var shouldSetOption = this.props.shouldSetOption;
      if (isFunction(shouldSetOption) && !shouldSetOption(prevProps, this.props)) {
        return;
      }
      if (!(0, import_fast_deep_equal.default)(prevProps.theme, this.props.theme) || !(0, import_fast_deep_equal.default)(prevProps.opts, this.props.opts)) {
        this.dispose();
        this.renderNewEcharts();
        return;
      }
      var echartsInstance = this.getEchartsInstance();
      if (!(0, import_fast_deep_equal.default)(prevProps.onEvents, this.props.onEvents)) {
        this.unbindEvents(echartsInstance);
        this.bindEvents(echartsInstance, this.props.onEvents);
      }
      var pickKeys = ["option", "notMerge", "replaceMerge", "lazyUpdate", "showLoading", "loadingOption"];
      if (!(0, import_fast_deep_equal.default)(pick(this.props, pickKeys), pick(prevProps, pickKeys))) {
        this.updateEChartsOption();
      }
      if (!(0, import_fast_deep_equal.default)(prevProps.style, this.props.style) || !(0, import_fast_deep_equal.default)(prevProps.className, this.props.className)) {
        this.resize();
      }
    };
    EChartsReactCore2.prototype.componentWillUnmount = function() {
      this.dispose();
    };
    EChartsReactCore2.prototype.initEchartsInstance = function() {
      return __awaiter(this, void 0, void 0, function() {
        var _this = this;
        return __generator(this, function(_a) {
          return [2, new Promise(function(resolve) {
            _this.echarts.init(_this.ele, _this.props.theme, _this.props.opts);
            var echartsInstance = _this.getEchartsInstance();
            echartsInstance.on("finished", function() {
              var width = _this.ele.clientWidth;
              var height = _this.ele.clientHeight;
              _this.echarts.dispose(_this.ele);
              var opts = __assign({ width, height }, _this.props.opts);
              resolve(_this.echarts.init(_this.ele, _this.props.theme, opts));
            });
          })];
        });
      });
    };
    EChartsReactCore2.prototype.getEchartsInstance = function() {
      return this.echarts.getInstanceByDom(this.ele);
    };
    EChartsReactCore2.prototype.dispose = function() {
      if (this.ele) {
        try {
          (0, import_size_sensor.clear)(this.ele);
        } catch (e) {
          console.warn(e);
        }
        this.echarts.dispose(this.ele);
      }
    };
    EChartsReactCore2.prototype.renderNewEcharts = function() {
      return __awaiter(this, void 0, void 0, function() {
        var _a, onEvents, onChartReady, _b, autoResize, echartsInstance;
        var _this = this;
        return __generator(this, function(_c) {
          switch (_c.label) {
            case 0:
              _a = this.props, onEvents = _a.onEvents, onChartReady = _a.onChartReady, _b = _a.autoResize, autoResize = _b === void 0 ? true : _b;
              return [4, this.initEchartsInstance()];
            case 1:
              _c.sent();
              echartsInstance = this.updateEChartsOption();
              this.bindEvents(echartsInstance, onEvents || {});
              if (isFunction(onChartReady))
                onChartReady(echartsInstance);
              if (this.ele && autoResize) {
                (0, import_size_sensor.bind)(this.ele, function() {
                  _this.resize();
                });
              }
              return [
                2
                /*return*/
              ];
          }
        });
      });
    };
    EChartsReactCore2.prototype.bindEvents = function(instance, events) {
      var _this = this;
      var _bindEvent = function(eventName2, func) {
        if (isString(eventName2) && isFunction(func)) {
          var handler = function(param) {
            func(param, instance);
          };
          instance.on(eventName2, handler);
          _this.eventHandlerRefs[eventName2] = handler;
        }
      };
      for (var eventName in events) {
        if (Object.prototype.hasOwnProperty.call(events, eventName)) {
          _bindEvent(eventName, events[eventName]);
        }
      }
    };
    EChartsReactCore2.prototype.unbindEvents = function(instance) {
      for (var _i = 0, _a = Object.entries(this.eventHandlerRefs); _i < _a.length; _i++) {
        var _b = _a[_i], eventName = _b[0], listener = _b[1];
        instance.off(eventName, listener);
      }
      this.eventHandlerRefs = {};
    };
    EChartsReactCore2.prototype.updateEChartsOption = function() {
      var _a = this.props, option = _a.option, _b = _a.notMerge, notMerge = _b === void 0 ? false : _b, _c = _a.replaceMerge, replaceMerge = _c === void 0 ? null : _c, _d = _a.lazyUpdate, lazyUpdate = _d === void 0 ? false : _d, showLoading = _a.showLoading, _e = _a.loadingOption, loadingOption = _e === void 0 ? null : _e;
      var echartInstance = this.getEchartsInstance();
      echartInstance.setOption(option, { notMerge, replaceMerge, lazyUpdate });
      if (showLoading)
        echartInstance.showLoading(loadingOption);
      else
        echartInstance.hideLoading();
      return echartInstance;
    };
    EChartsReactCore2.prototype.resize = function() {
      var echartsInstance = this.getEchartsInstance();
      if (!this.isInitialResize) {
        try {
          echartsInstance.resize({
            width: "auto",
            height: "auto"
          });
        } catch (e) {
          console.warn(e);
        }
      }
      this.isInitialResize = false;
    };
    EChartsReactCore2.prototype.render = function() {
      var _this = this;
      var _a = this.props, style = _a.style, _b = _a.className, className = _b === void 0 ? "" : _b, echarts2 = _a.echarts, option = _a.option, theme = _a.theme, notMerge = _a.notMerge, replaceMerge = _a.replaceMerge, lazyUpdate = _a.lazyUpdate, showLoading = _a.showLoading, loadingOption = _a.loadingOption, opts = _a.opts, onChartReady = _a.onChartReady, onEvents = _a.onEvents, shouldSetOption = _a.shouldSetOption, autoResize = _a.autoResize, divHTMLAttributes = __rest(_a, ["style", "className", "echarts", "option", "theme", "notMerge", "replaceMerge", "lazyUpdate", "showLoading", "loadingOption", "opts", "onChartReady", "onEvents", "shouldSetOption", "autoResize"]);
      var newStyle = __assign({ height: 300 }, style);
      return React.createElement("div", __assign({ ref: function(e) {
        _this.ele = e;
      }, style: newStyle, className: "echarts-for-react ".concat(className) }, divHTMLAttributes));
    };
    return EChartsReactCore2;
  })(PureComponent)
);
var core_default = EChartsReactCore;

// ../../node_modules/.pnpm/echarts-for-react@3.0.6_echarts@6.1.0_react@19.2.8/node_modules/echarts-for-react/esm/index.js
var EChartsReact = (
  /** @class */
  (function(_super) {
    __extends(EChartsReact2, _super);
    function EChartsReact2(props) {
      var _this = _super.call(this, props) || this;
      _this.echarts = echarts;
      return _this;
    }
    return EChartsReact2;
  })(core_default)
);
var esm_default = EChartsReact;

// shell/.ojm-shim-echarts-for-react.mjs
var ojm_shim_echarts_for_react_default = esm_default ?? esm_exports;
export {
  ojm_shim_echarts_for_react_default as default
};
