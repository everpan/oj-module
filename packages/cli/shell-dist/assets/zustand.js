var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __reExport = (target, mod, secondTarget) => (__copyProps(target, mod, "default"), secondTarget && __copyProps(secondTarget, mod, "default"));

// ../../node_modules/.pnpm/zustand@5.0.15_@types+react@19.2.18_react@19.2.8_use-sync-external-store@1.6.0_react@19.2.8_/node_modules/zustand/esm/index.mjs
var esm_exports = {};
__reExport(esm_exports, vanilla_star);
__reExport(esm_exports, react_star);
import * as vanilla_star from "zustand/vanilla";
import * as react_star from "zustand/react";

// shell/.ram-shim-zustand.mjs
var create2 = esm_exports["create"];
var createStore2 = esm_exports["createStore"];
var useStore2 = esm_exports["useStore"];
var ram_shim_zustand_default = esm_exports.default ?? esm_exports;
export {
  create2 as create,
  createStore2 as createStore,
  ram_shim_zustand_default as default,
  useStore2 as useStore
};
