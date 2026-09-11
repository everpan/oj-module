import * as __rad_ext_0 from "react";
var __rad_require = {
  "react": __rad_ext_0
};
var require = function (id) {
  if (Object.prototype.hasOwnProperty.call(__rad_require, id)) return __rad_require[id];
  throw new Error("Dynamic require of " + JSON.stringify(id) + " is not supported（该说明符未在共享表内登记）");
};
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
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

// ../../node_modules/.pnpm/spin-delay@2.0.1_react@19.2.8/node_modules/spin-delay/dist/index.js
var require_dist = __commonJS({
  "../../node_modules/.pnpm/spin-delay@2.0.1_react@19.2.8/node_modules/spin-delay/dist/index.js"(exports, module) {
    (function(global, factory) {
      typeof exports === "object" && typeof module !== "undefined" ? factory(exports, __require("react")) : typeof define === "function" && define.amd ? define(["exports", "react"], factory) : (global = global || self, factory(global.spinDelay = {}, global.react));
    })(exports, (function(exports2, react) {
      const defaultOptions3 = {
        delay: 500,
        minDuration: 200,
        ssr: true
      };
      function useIsSSR() {
        const [isSSR, setIsSSR] = react.useState(true);
        react.useEffect(() => {
          setIsSSR(false);
        }, []);
        return isSSR;
      }
      function useSpinDelay3(loading, options) {
        options = Object.assign({}, defaultOptions3, options);
        const isSSR = useIsSSR() && options.ssr;
        const initialState = isSSR && loading ? "DISPLAY" : "IDLE";
        const [state, setState] = react.useState(initialState);
        const timeout = react.useRef(null);
        react.useEffect(() => {
          if (loading && (state === "IDLE" || isSSR)) {
            clearTimeout(timeout.current);
            const delay = isSSR ? 0 : options.delay;
            timeout.current = setTimeout(() => {
              if (!loading) {
                return setState("IDLE");
              }
              timeout.current = setTimeout(() => {
                setState("EXPIRE");
              }, options.minDuration);
              setState("DISPLAY");
            }, delay);
            if (!isSSR) {
              setState("DELAY");
            }
          }
          if (!loading && state !== "DISPLAY") {
            clearTimeout(timeout.current);
            setState("IDLE");
          }
        }, [loading, state, options.delay, options.minDuration, isSSR]);
        react.useEffect(() => {
          return () => clearTimeout(timeout.current);
        }, []);
        return state === "DISPLAY" || state === "EXPIRE";
      }
      exports2.defaultOptions = defaultOptions3;
      exports2.useSpinDelay = useSpinDelay3;
    }));
  }
});

// shell/.ram-shim-spin-delay.mjs
var __m = __toESM(require_dist(), 1);
var defaultOptions2 = __m["defaultOptions"];
var useSpinDelay2 = __m["useSpinDelay"];
var ram_shim_spin_delay_default = __m.default ?? __m;
export {
  ram_shim_spin_delay_default as default,
  defaultOptions2 as defaultOptions,
  useSpinDelay2 as useSpinDelay
};
