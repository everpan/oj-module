var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../../node_modules/.pnpm/zustand@5.0.15_@types+react@19.2.18_react@19.2.8_use-sync-external-store@1.6.0_react@19.2.8_/node_modules/zustand/esm/react.mjs
var react_exports = {};
__export(react_exports, {
  create: () => create,
  useStore: () => useStore
});
import React from "react";
import { createStore } from "zustand/vanilla";
var identity = (arg) => arg;
function useStore(api, selector = identity) {
  const slice = React.useSyncExternalStore(
    api.subscribe,
    React.useCallback(() => selector(api.getState()), [api, selector]),
    React.useCallback(() => selector(api.getInitialState()), [api, selector])
  );
  React.useDebugValue(slice);
  return slice;
}
var createImpl = (createState) => {
  const api = createStore(createState);
  const useBoundStore = (selector) => useStore(api, selector);
  Object.assign(useBoundStore, api);
  return useBoundStore;
};
var create = ((createState) => createState ? createImpl(createState) : createImpl);

// shell/.ojm-shim-zustand-react.mjs
var ojm_shim_zustand_react_default = void 0 ?? react_exports;
export {
  create,
  ojm_shim_zustand_react_default as default,
  useStore
};
