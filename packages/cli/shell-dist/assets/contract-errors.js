var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// ../runtime/dist/contract/errors.js
var errors_exports = {};
__export(errors_exports, {
  ContractApiError: () => ContractApiError
});
var ContractApiError = class extends Error {
  constructor(code, msg) {
    super(msg);
    __publicField(this, "code");
    __publicField(this, "msg");
    this.name = "ContractApiError";
    this.code = code;
    this.msg = msg;
  }
};

// shell/.ram-shim-contract-errors.mjs
var ram_shim_contract_errors_default = void 0 ?? errors_exports;
export {
  ContractApiError,
  ram_shim_contract_errors_default as default
};
