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

// ../../node_modules/.pnpm/react@19.2.8/node_modules/react/cjs/react-jsx-dev-runtime.production.js
var require_react_jsx_dev_runtime_production = __commonJS({
  "../../node_modules/.pnpm/react@19.2.8/node_modules/react/cjs/react-jsx-dev-runtime.production.js"(exports) {
    "use strict";
    var REACT_FRAGMENT_TYPE = /* @__PURE__ */ Symbol.for("react.fragment");
    exports.Fragment = REACT_FRAGMENT_TYPE;
    exports.jsxDEV = void 0;
  }
});

// ../../node_modules/.pnpm/react@19.2.8/node_modules/react/jsx-dev-runtime.js
var require_jsx_dev_runtime = __commonJS({
  "../../node_modules/.pnpm/react@19.2.8/node_modules/react/jsx-dev-runtime.js"(exports, module) {
    "use strict";
    if (true) {
      module.exports = require_react_jsx_dev_runtime_production();
    } else {
      module.exports = null;
    }
  }
});

// shell/.ojm-shim-jsx-dev-runtime.mjs
var __m = __toESM(require_jsx_dev_runtime(), 1);
var Fragment2 = __m["Fragment"];
var jsxDEV2 = __m["jsxDEV"];
var ojm_shim_jsx_dev_runtime_default = __m.default ?? __m;
export {
  Fragment2 as Fragment,
  ojm_shim_jsx_dev_runtime_default as default,
  jsxDEV2 as jsxDEV
};
/*! Bundled license information:

react/cjs/react-jsx-dev-runtime.production.js:
  (**
   * @license React
   * react-jsx-dev-runtime.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)
*/
