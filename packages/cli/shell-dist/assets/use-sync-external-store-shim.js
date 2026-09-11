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

// ../../node_modules/.pnpm/use-sync-external-store@1.6.0_react@19.2.8/node_modules/use-sync-external-store/cjs/use-sync-external-store-shim.production.js
var require_use_sync_external_store_shim_production = __commonJS({
  "../../node_modules/.pnpm/use-sync-external-store@1.6.0_react@19.2.8/node_modules/use-sync-external-store/cjs/use-sync-external-store-shim.production.js"(exports) {
    "use strict";
    var React = __require("react");
    function is(x, y) {
      return x === y && (0 !== x || 1 / x === 1 / y) || x !== x && y !== y;
    }
    var objectIs = "function" === typeof Object.is ? Object.is : is;
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useLayoutEffect = React.useLayoutEffect;
    var useDebugValue = React.useDebugValue;
    function useSyncExternalStore$2(subscribe, getSnapshot) {
      var value = getSnapshot(), _useState = useState({ inst: { value, getSnapshot } }), inst = _useState[0].inst, forceUpdate = _useState[1];
      useLayoutEffect(
        function() {
          inst.value = value;
          inst.getSnapshot = getSnapshot;
          checkIfSnapshotChanged(inst) && forceUpdate({ inst });
        },
        [subscribe, value, getSnapshot]
      );
      useEffect(
        function() {
          checkIfSnapshotChanged(inst) && forceUpdate({ inst });
          return subscribe(function() {
            checkIfSnapshotChanged(inst) && forceUpdate({ inst });
          });
        },
        [subscribe]
      );
      useDebugValue(value);
      return value;
    }
    function checkIfSnapshotChanged(inst) {
      var latestGetSnapshot = inst.getSnapshot;
      inst = inst.value;
      try {
        var nextValue = latestGetSnapshot();
        return !objectIs(inst, nextValue);
      } catch (error) {
        return true;
      }
    }
    function useSyncExternalStore$1(subscribe, getSnapshot) {
      return getSnapshot();
    }
    var shim = "undefined" === typeof window || "undefined" === typeof window.document || "undefined" === typeof window.document.createElement ? useSyncExternalStore$1 : useSyncExternalStore$2;
    exports.useSyncExternalStore = void 0 !== React.useSyncExternalStore ? React.useSyncExternalStore : shim;
  }
});

// ../../node_modules/.pnpm/use-sync-external-store@1.6.0_react@19.2.8/node_modules/use-sync-external-store/shim/index.js
var require_shim = __commonJS({
  "../../node_modules/.pnpm/use-sync-external-store@1.6.0_react@19.2.8/node_modules/use-sync-external-store/shim/index.js"(exports, module) {
    "use strict";
    if (true) {
      module.exports = require_use_sync_external_store_shim_production();
    } else {
      module.exports = null;
    }
  }
});

// shell/.ojm-shim-use-sync-external-store-shim.mjs
var __m = __toESM(require_shim(), 1);
var useSyncExternalStore2 = __m["useSyncExternalStore"];
var ojm_shim_use_sync_external_store_shim_default = __m.default ?? __m;
export {
  ojm_shim_use_sync_external_store_shim_default as default,
  useSyncExternalStore2 as useSyncExternalStore
};
/*! Bundled license information:

use-sync-external-store/cjs/use-sync-external-store-shim.production.js:
  (**
   * @license React
   * use-sync-external-store-shim.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)
*/
