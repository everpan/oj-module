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
var __reExport = (target, mod, secondTarget) => (__copyProps(target, mod, "default"), secondTarget && __copyProps(secondTarget, mod, "default"));
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/.pnpm/dayjs@1.11.23/node_modules/dayjs/plugin/quarterOfYear.js
var require_quarterOfYear = __commonJS({
  "../../node_modules/.pnpm/dayjs@1.11.23/node_modules/dayjs/plugin/quarterOfYear.js"(exports, module) {
    !(function(t, n) {
      "object" == typeof exports && "undefined" != typeof module ? module.exports = n() : "function" == typeof define && define.amd ? define(n) : (t = "undefined" != typeof globalThis ? globalThis : t || self).dayjs_plugin_quarterOfYear = n();
    })(exports, (function() {
      "use strict";
      var t = "month", n = "quarter";
      return function(e, i) {
        var r = i.prototype;
        r.quarter = function(t2) {
          return this.$utils().u(t2) ? Math.ceil((this.month() + 1) / 3) : this.month(this.month() % 3 + 3 * (t2 - 1));
        };
        var s = r.add;
        r.add = function(e2, i2) {
          return e2 = Number(e2), this.$utils().p(i2) === n ? this.add(3 * e2, t) : s.bind(this)(e2, i2);
        };
        var u = r.startOf;
        r.startOf = function(e2, i2) {
          var r2 = this.$utils(), s2 = !!r2.u(i2) || i2;
          if (r2.p(e2) === n) {
            var o = this.quarter() - 1;
            return s2 ? this.month(3 * o).startOf(t).startOf("day") : this.month(3 * o + 2).endOf(t).endOf("day");
          }
          return u.bind(this)(e2, i2);
        };
      };
    }));
  }
});

// shell/.ojm-shim-dayjs-plugin-quarterOfYear.mjs
var ojm_shim_dayjs_plugin_quarterOfYear_exports = {};
__export(ojm_shim_dayjs_plugin_quarterOfYear_exports, {
  default: () => ojm_shim_dayjs_plugin_quarterOfYear_default
});
var __ns = __toESM(require_quarterOfYear(), 1);
__reExport(ojm_shim_dayjs_plugin_quarterOfYear_exports, __toESM(require_quarterOfYear(), 1));
var ojm_shim_dayjs_plugin_quarterOfYear_default = __ns.default ?? __ns;
export {
  ojm_shim_dayjs_plugin_quarterOfYear_default as default
};
