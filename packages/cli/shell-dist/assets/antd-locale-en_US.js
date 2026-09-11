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

// ../../node_modules/.pnpm/@babel+runtime@7.29.7/node_modules/@babel/runtime/helpers/interopRequireDefault.js
var require_interopRequireDefault = __commonJS({
  "../../node_modules/.pnpm/@babel+runtime@7.29.7/node_modules/@babel/runtime/helpers/interopRequireDefault.js"(exports, module) {
    function _interopRequireDefault(e) {
      return e && e.__esModule ? e : {
        "default": e
      };
    }
    module.exports = _interopRequireDefault, module.exports.__esModule = true, module.exports["default"] = module.exports;
  }
});

// ../../node_modules/.pnpm/@rc-component+pagination@1.4.0_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@rc-component/pagination/lib/locale/en_US.js
var require_en_US = __commonJS({
  "../../node_modules/.pnpm/@rc-component+pagination@1.4.0_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@rc-component/pagination/lib/locale/en_US.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.default = void 0;
    var locale = {
      // Options
      items_per_page: "/ page",
      jump_to: "Go to",
      jump_to_confirm: "confirm",
      page: "Page",
      // Pagination
      prev_page: "Previous Page",
      next_page: "Next Page",
      prev_5: "Previous 5 Pages",
      next_5: "Next 5 Pages",
      prev_3: "Previous 3 Pages",
      next_3: "Next 3 Pages",
      page_size: "Page Size"
    };
    var _default = exports.default = locale;
  }
});

// ../../node_modules/.pnpm/@rc-component+picker@1.12.0_dayjs@1.11.23_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@rc-component/picker/lib/locale/common.js
var require_common = __commonJS({
  "../../node_modules/.pnpm/@rc-component+picker@1.12.0_dayjs@1.11.23_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@rc-component/picker/lib/locale/common.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.commonLocale = void 0;
    var commonLocale = exports.commonLocale = {
      yearFormat: "YYYY",
      dayFormat: "D",
      cellMeridiemFormat: "A",
      monthBeforeYear: true
    };
  }
});

// ../../node_modules/.pnpm/@rc-component+picker@1.12.0_dayjs@1.11.23_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@rc-component/picker/lib/locale/en_US.js
var require_en_US2 = __commonJS({
  "../../node_modules/.pnpm/@rc-component+picker@1.12.0_dayjs@1.11.23_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@rc-component/picker/lib/locale/en_US.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.default = void 0;
    var _common = require_common();
    var locale = {
      ..._common.commonLocale,
      locale: "en_US",
      today: "Today",
      now: "Now",
      backToToday: "Back to today",
      ok: "OK",
      clear: "Clear",
      week: "Week",
      month: "Month",
      year: "Year",
      timeSelect: "select time",
      dateSelect: "select date",
      weekSelect: "Choose a week",
      monthSelect: "Choose a month",
      yearSelect: "Choose a year",
      decadeSelect: "Choose a decade",
      previousMonth: "Previous month",
      nextMonth: "Next month",
      previousYear: "Last year",
      nextYear: "Next year",
      previousDecade: "Last decade",
      nextDecade: "Next decade",
      previousCentury: "Last century",
      nextCentury: "Next century"
    };
    var _default = exports.default = locale;
  }
});

// ../../node_modules/.pnpm/antd@6.6.1_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/antd/lib/time-picker/locale/en_US.js
var require_en_US3 = __commonJS({
  "../../node_modules/.pnpm/antd@6.6.1_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/antd/lib/time-picker/locale/en_US.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.default = void 0;
    var locale = {
      placeholder: "Select time",
      rangePlaceholder: ["Start time", "End time"]
    };
    var _default = exports.default = locale;
  }
});

// ../../node_modules/.pnpm/antd@6.6.1_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/antd/lib/date-picker/locale/en_US.js
var require_en_US4 = __commonJS({
  "../../node_modules/.pnpm/antd@6.6.1_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/antd/lib/date-picker/locale/en_US.js"(exports) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault().default;
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.default = void 0;
    var _en_US = _interopRequireDefault(require_en_US2());
    var _en_US2 = _interopRequireDefault(require_en_US3());
    var locale = {
      lang: {
        placeholder: "Select date",
        yearPlaceholder: "Select year",
        quarterPlaceholder: "Select quarter",
        monthPlaceholder: "Select month",
        weekPlaceholder: "Select week",
        rangePlaceholder: ["Start date", "End date"],
        rangeYearPlaceholder: ["Start year", "End year"],
        rangeQuarterPlaceholder: ["Start quarter", "End quarter"],
        rangeMonthPlaceholder: ["Start month", "End month"],
        rangeWeekPlaceholder: ["Start week", "End week"],
        ..._en_US.default
      },
      timePickerLocale: {
        ..._en_US2.default
      }
    };
    var _default = exports.default = locale;
  }
});

// ../../node_modules/.pnpm/antd@6.6.1_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/antd/lib/calendar/locale/en_US.js
var require_en_US5 = __commonJS({
  "../../node_modules/.pnpm/antd@6.6.1_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/antd/lib/calendar/locale/en_US.js"(exports) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault().default;
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.default = void 0;
    var _en_US = _interopRequireDefault(require_en_US4());
    var _default = exports.default = _en_US.default;
  }
});

// ../../node_modules/.pnpm/antd@6.6.1_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/antd/lib/locale/en_US.js
var require_en_US6 = __commonJS({
  "../../node_modules/.pnpm/antd@6.6.1_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/antd/lib/locale/en_US.js"(exports) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault().default;
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.default = void 0;
    var _en_US = _interopRequireDefault(require_en_US());
    var _en_US2 = _interopRequireDefault(require_en_US5());
    var _en_US3 = _interopRequireDefault(require_en_US4());
    var _en_US4 = _interopRequireDefault(require_en_US3());
    var typeTemplate = "${label} is not a valid ${type}";
    var localeValues = {
      locale: "en",
      Pagination: _en_US.default,
      DatePicker: _en_US3.default,
      TimePicker: _en_US4.default,
      Calendar: _en_US2.default,
      global: {
        placeholder: "Please select",
        close: "Close",
        sortable: "sortable",
        show: "Show",
        hide: "Hide"
      },
      Table: {
        filterTitle: "Filter menu",
        filterConfirm: "OK",
        filterReset: "Reset",
        filterEmptyText: "No filters",
        filterCheckAll: "Select all items",
        filterSearchPlaceholder: "Search in filters",
        emptyText: "No data",
        selectAll: "Select current page",
        selectInvert: "Invert current page",
        selectNone: "Clear all data",
        selectionAll: "Select all data",
        sortTitle: "Sort",
        expand: "Expand row",
        collapse: "Collapse row",
        triggerDesc: "Click to sort descending",
        triggerAsc: "Click to sort ascending",
        cancelSort: "Click to cancel sorting"
      },
      Tour: {
        Next: "Next",
        Previous: "Previous",
        Finish: "Finish"
      },
      Modal: {
        okText: "OK",
        cancelText: "Cancel",
        justOkText: "OK"
      },
      Popconfirm: {
        okText: "OK",
        cancelText: "Cancel"
      },
      Transfer: {
        titles: ["", ""],
        searchPlaceholder: "Search here",
        itemUnit: "item",
        itemsUnit: "items",
        remove: "Remove",
        selectCurrent: "Select current page",
        removeCurrent: "Remove current page",
        selectAll: "Select all data",
        deselectAll: "Deselect all data",
        removeAll: "Remove all data",
        selectInvert: "Invert current page"
      },
      Upload: {
        uploading: "Uploading...",
        removeFile: "Remove file",
        uploadError: "Upload error",
        previewFile: "Preview file",
        downloadFile: "Download file"
      },
      Empty: {
        description: "No data"
      },
      Icon: {
        icon: "icon"
      },
      Text: {
        edit: "Edit",
        copy: "Copy",
        copied: "Copied",
        expand: "Expand",
        collapse: "Collapse"
      },
      Carousel: {
        prevSlide: "Previous slide",
        nextSlide: "Next slide"
      },
      Form: {
        optional: "(optional)",
        defaultValidateMessages: {
          default: "Field validation error for ${label}",
          required: "Please enter ${label}",
          enum: "${label} must be one of [${enum}]",
          whitespace: "${label} cannot be a blank character",
          date: {
            format: "${label} date format is invalid",
            parse: "${label} cannot be converted to a date",
            invalid: "${label} is an invalid date"
          },
          types: {
            string: typeTemplate,
            method: typeTemplate,
            array: typeTemplate,
            object: typeTemplate,
            number: typeTemplate,
            date: typeTemplate,
            boolean: typeTemplate,
            integer: typeTemplate,
            float: typeTemplate,
            regexp: typeTemplate,
            email: typeTemplate,
            url: typeTemplate,
            hex: typeTemplate
          },
          string: {
            len: "${label} must be ${len} characters",
            min: "${label} must be at least ${min} characters",
            max: "${label} must be up to ${max} characters",
            range: "${label} must be between ${min}-${max} characters"
          },
          number: {
            len: "${label} must be equal to ${len}",
            min: "${label} must be minimum ${min}",
            max: "${label} must be maximum ${max}",
            range: "${label} must be between ${min}-${max}"
          },
          array: {
            len: "Must be ${len} ${label}",
            min: "At least ${min} ${label}",
            max: "At most ${max} ${label}",
            range: "The amount of ${label} must be between ${min}-${max}"
          },
          pattern: {
            mismatch: "${label} does not match the pattern ${pattern}"
          }
        }
      },
      QRCode: {
        expired: "QR code expired",
        refresh: "Refresh",
        scanned: "Scanned"
      },
      ColorPicker: {
        presetEmpty: "Empty",
        transparent: "Transparent",
        singleColor: "Single",
        gradientColor: "Gradient"
      }
    };
    var _default = exports.default = localeValues;
  }
});

// ../../node_modules/.pnpm/antd@6.6.1_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/antd/locale/en_US.js
var require_en_US7 = __commonJS({
  "../../node_modules/.pnpm/antd@6.6.1_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/antd/locale/en_US.js"(exports, module) {
    module.exports = require_en_US6();
  }
});

// shell/.ojm-shim-antd-locale-en_US.mjs
var ojm_shim_antd_locale_en_US_exports = {};
__export(ojm_shim_antd_locale_en_US_exports, {
  default: () => ojm_shim_antd_locale_en_US_default
});
var __ns = __toESM(require_en_US7(), 1);
__reExport(ojm_shim_antd_locale_en_US_exports, __toESM(require_en_US7(), 1));
var ojm_shim_antd_locale_en_US_default = __ns.default ?? __ns;
export {
  ojm_shim_antd_locale_en_US_default as default
};
