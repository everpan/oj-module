var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../../node_modules/.pnpm/zustand@5.0.15_@types+react@19.2.18_react@19.2.8_use-sync-external-store@1.6.0_react@19.2.8_/node_modules/zustand/esm/react/shallow.mjs
var shallow_exports = {};
__export(shallow_exports, {
  useShallow: () => useShallow
});
import React from "react";
import { shallow } from "zustand/vanilla/shallow";
function useShallow(selector) {
  const prev = React.useRef(void 0);
  return (state) => {
    const next = selector(state);
    return shallow(prev.current, next) ? prev.current : prev.current = next;
  };
}

// shell/.ojm-shim-zustand-react-shallow.mjs
var ojm_shim_zustand_react_shallow_default = void 0 ?? shallow_exports;
export {
  ojm_shim_zustand_react_shallow_default as default,
  useShallow
};
