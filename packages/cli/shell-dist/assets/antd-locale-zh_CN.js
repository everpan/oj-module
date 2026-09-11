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

// ../../node_modules/.pnpm/@rc-component+pagination@1.4.0_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@rc-component/pagination/lib/locale/zh_CN.js
var require_zh_CN = __commonJS({
  "../../node_modules/.pnpm/@rc-component+pagination@1.4.0_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@rc-component/pagination/lib/locale/zh_CN.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.default = void 0;
    var locale = {
      // Options
      items_per_page: "\u6761/\u9875",
      jump_to: "\u8DF3\u81F3",
      jump_to_confirm: "\u786E\u5B9A",
      page: "\u9875",
      // Pagination
      prev_page: "\u4E0A\u4E00\u9875",
      next_page: "\u4E0B\u4E00\u9875",
      prev_5: "\u5411\u524D 5 \u9875",
      next_5: "\u5411\u540E 5 \u9875",
      prev_3: "\u5411\u524D 3 \u9875",
      next_3: "\u5411\u540E 3 \u9875",
      page_size: "\u9875\u7801"
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

// ../../node_modules/.pnpm/@rc-component+picker@1.12.0_dayjs@1.11.23_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@rc-component/picker/lib/locale/zh_CN.js
var require_zh_CN2 = __commonJS({
  "../../node_modules/.pnpm/@rc-component+picker@1.12.0_dayjs@1.11.23_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@rc-component/picker/lib/locale/zh_CN.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.default = void 0;
    var _common = require_common();
    var locale = {
      ..._common.commonLocale,
      locale: "zh_CN",
      today: "\u4ECA\u5929",
      now: "\u6B64\u523B",
      backToToday: "\u8FD4\u56DE\u4ECA\u5929",
      ok: "\u786E\u5B9A",
      timeSelect: "\u9009\u62E9\u65F6\u95F4",
      dateSelect: "\u9009\u62E9\u65E5\u671F",
      weekSelect: "\u9009\u62E9\u5468",
      clear: "\u6E05\u9664",
      week: "\u5468",
      month: "\u6708",
      year: "\u5E74",
      previousMonth: "\u4E0A\u4E2A\u6708",
      nextMonth: "\u4E0B\u4E2A\u6708",
      monthSelect: "\u9009\u62E9\u6708\u4EFD",
      yearSelect: "\u9009\u62E9\u5E74\u4EFD",
      decadeSelect: "\u9009\u62E9\u5E74\u4EE3",
      previousYear: "\u4E0A\u4E00\u5E74",
      nextYear: "\u4E0B\u4E00\u5E74",
      previousDecade: "\u4E0A\u4E00\u5E74\u4EE3",
      nextDecade: "\u4E0B\u4E00\u5E74\u4EE3",
      previousCentury: "\u4E0A\u4E00\u4E16\u7EAA",
      nextCentury: "\u4E0B\u4E00\u4E16\u7EAA",
      yearFormat: "YYYY\u5E74",
      cellDateFormat: "D",
      monthBeforeYear: false
    };
    var _default = exports.default = locale;
  }
});

// ../../node_modules/.pnpm/antd@6.6.1_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/antd/lib/time-picker/locale/zh_CN.js
var require_zh_CN3 = __commonJS({
  "../../node_modules/.pnpm/antd@6.6.1_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/antd/lib/time-picker/locale/zh_CN.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.default = void 0;
    var locale = {
      placeholder: "\u8BF7\u9009\u62E9\u65F6\u95F4",
      rangePlaceholder: ["\u5F00\u59CB\u65F6\u95F4", "\u7ED3\u675F\u65F6\u95F4"]
    };
    var _default = exports.default = locale;
  }
});

// ../../node_modules/.pnpm/antd@6.6.1_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/antd/lib/date-picker/locale/zh_CN.js
var require_zh_CN4 = __commonJS({
  "../../node_modules/.pnpm/antd@6.6.1_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/antd/lib/date-picker/locale/zh_CN.js"(exports) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault().default;
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.default = void 0;
    var _zh_CN = _interopRequireDefault(require_zh_CN2());
    var _zh_CN2 = _interopRequireDefault(require_zh_CN3());
    var locale = {
      lang: {
        placeholder: "\u8BF7\u9009\u62E9\u65E5\u671F",
        yearPlaceholder: "\u8BF7\u9009\u62E9\u5E74\u4EFD",
        quarterPlaceholder: "\u8BF7\u9009\u62E9\u5B63\u5EA6",
        monthPlaceholder: "\u8BF7\u9009\u62E9\u6708\u4EFD",
        weekPlaceholder: "\u8BF7\u9009\u62E9\u5468",
        rangePlaceholder: ["\u5F00\u59CB\u65E5\u671F", "\u7ED3\u675F\u65E5\u671F"],
        rangeYearPlaceholder: ["\u5F00\u59CB\u5E74\u4EFD", "\u7ED3\u675F\u5E74\u4EFD"],
        rangeMonthPlaceholder: ["\u5F00\u59CB\u6708\u4EFD", "\u7ED3\u675F\u6708\u4EFD"],
        rangeQuarterPlaceholder: ["\u5F00\u59CB\u5B63\u5EA6", "\u7ED3\u675F\u5B63\u5EA6"],
        rangeWeekPlaceholder: ["\u5F00\u59CB\u5468", "\u7ED3\u675F\u5468"],
        ..._zh_CN.default
      },
      timePickerLocale: {
        ..._zh_CN2.default
      }
    };
    locale.lang.ok = "\u786E\u5B9A";
    var _default = exports.default = locale;
  }
});

// ../../node_modules/.pnpm/antd@6.6.1_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/antd/lib/calendar/locale/zh_CN.js
var require_zh_CN5 = __commonJS({
  "../../node_modules/.pnpm/antd@6.6.1_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/antd/lib/calendar/locale/zh_CN.js"(exports) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault().default;
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.default = void 0;
    var _zh_CN = _interopRequireDefault(require_zh_CN4());
    var _default = exports.default = _zh_CN.default;
  }
});

// ../../node_modules/.pnpm/antd@6.6.1_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/antd/lib/locale/zh_CN.js
var require_zh_CN6 = __commonJS({
  "../../node_modules/.pnpm/antd@6.6.1_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/antd/lib/locale/zh_CN.js"(exports) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault().default;
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.default = void 0;
    var _zh_CN = _interopRequireDefault(require_zh_CN());
    var _zh_CN2 = _interopRequireDefault(require_zh_CN5());
    var _zh_CN3 = _interopRequireDefault(require_zh_CN4());
    var _zh_CN4 = _interopRequireDefault(require_zh_CN3());
    var typeTemplate = "${label}\u4E0D\u662F\u4E00\u4E2A\u6709\u6548\u7684${type}";
    var localeValues = {
      locale: "zh-cn",
      Pagination: _zh_CN.default,
      DatePicker: _zh_CN3.default,
      TimePicker: _zh_CN4.default,
      Calendar: _zh_CN2.default,
      // locales for all components
      global: {
        placeholder: "\u8BF7\u9009\u62E9",
        close: "\u5173\u95ED",
        sortable: "\u53EF\u6392\u5E8F",
        show: "\u663E\u793A",
        hide: "\u9690\u85CF"
      },
      Table: {
        filterTitle: "\u7B5B\u9009",
        filterConfirm: "\u786E\u5B9A",
        filterReset: "\u91CD\u7F6E",
        filterEmptyText: "\u65E0\u7B5B\u9009\u9879",
        filterCheckAll: "\u5168\u9009",
        filterSearchPlaceholder: "\u5728\u7B5B\u9009\u9879\u4E2D\u641C\u7D22",
        emptyText: "\u6682\u65E0\u6570\u636E",
        selectAll: "\u5168\u9009\u5F53\u9875",
        selectInvert: "\u53CD\u9009\u5F53\u9875",
        selectNone: "\u6E05\u7A7A\u6240\u6709",
        selectionAll: "\u5168\u9009\u6240\u6709",
        sortTitle: "\u6392\u5E8F",
        expand: "\u5C55\u5F00\u884C",
        collapse: "\u5173\u95ED\u884C",
        triggerDesc: "\u70B9\u51FB\u964D\u5E8F",
        triggerAsc: "\u70B9\u51FB\u5347\u5E8F",
        cancelSort: "\u53D6\u6D88\u6392\u5E8F"
      },
      Modal: {
        okText: "\u786E\u5B9A",
        cancelText: "\u53D6\u6D88",
        justOkText: "\u77E5\u9053\u4E86"
      },
      Tour: {
        Next: "\u4E0B\u4E00\u6B65",
        Previous: "\u4E0A\u4E00\u6B65",
        Finish: "\u7ED3\u675F\u5BFC\u89C8"
      },
      Popconfirm: {
        cancelText: "\u53D6\u6D88",
        okText: "\u786E\u5B9A"
      },
      Transfer: {
        titles: ["", ""],
        searchPlaceholder: "\u8BF7\u8F93\u5165\u641C\u7D22\u5185\u5BB9",
        itemUnit: "\u9879",
        itemsUnit: "\u9879",
        remove: "\u5220\u9664",
        selectCurrent: "\u5168\u9009\u5F53\u9875",
        removeCurrent: "\u5220\u9664\u5F53\u9875",
        selectAll: "\u5168\u9009\u6240\u6709",
        deselectAll: "\u53D6\u6D88\u5168\u9009",
        removeAll: "\u5220\u9664\u5168\u90E8",
        selectInvert: "\u53CD\u9009\u5F53\u9875"
      },
      Upload: {
        uploading: "\u6587\u4EF6\u4E0A\u4F20\u4E2D",
        removeFile: "\u5220\u9664\u6587\u4EF6",
        uploadError: "\u4E0A\u4F20\u9519\u8BEF",
        previewFile: "\u9884\u89C8\u6587\u4EF6",
        downloadFile: "\u4E0B\u8F7D\u6587\u4EF6"
      },
      Empty: {
        description: "\u6682\u65E0\u6570\u636E"
      },
      Icon: {
        icon: "\u56FE\u6807"
      },
      Text: {
        edit: "\u7F16\u8F91",
        copy: "\u590D\u5236",
        copied: "\u590D\u5236\u6210\u529F",
        expand: "\u5C55\u5F00",
        collapse: "\u6536\u8D77"
      },
      Carousel: {
        prevSlide: "\u4E0A\u4E00\u5F20\u5E7B\u706F\u7247",
        nextSlide: "\u4E0B\u4E00\u5F20\u5E7B\u706F\u7247"
      },
      Form: {
        optional: "\uFF08\u53EF\u9009\uFF09",
        defaultValidateMessages: {
          default: "\u5B57\u6BB5\u9A8C\u8BC1\u9519\u8BEF${label}",
          required: "\u8BF7\u8F93\u5165${label}",
          enum: "${label}\u5FC5\u987B\u662F\u5176\u4E2D\u4E00\u4E2A[${enum}]",
          whitespace: "${label}\u4E0D\u80FD\u4E3A\u7A7A\u5B57\u7B26",
          date: {
            format: "${label}\u65E5\u671F\u683C\u5F0F\u65E0\u6548",
            parse: "${label}\u4E0D\u80FD\u8F6C\u6362\u4E3A\u65E5\u671F",
            invalid: "${label}\u662F\u4E00\u4E2A\u65E0\u6548\u65E5\u671F"
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
            len: "${label}\u987B\u4E3A${len}\u4E2A\u5B57\u7B26",
            min: "${label}\u6700\u5C11${min}\u4E2A\u5B57\u7B26",
            max: "${label}\u6700\u591A${max}\u4E2A\u5B57\u7B26",
            range: "${label}\u987B\u5728${min}-${max}\u5B57\u7B26\u4E4B\u95F4"
          },
          number: {
            len: "${label}\u5FC5\u987B\u7B49\u4E8E${len}",
            min: "${label}\u6700\u5C0F\u503C\u4E3A${min}",
            max: "${label}\u6700\u5927\u503C\u4E3A${max}",
            range: "${label}\u987B\u5728${min}-${max}\u4E4B\u95F4"
          },
          array: {
            len: "\u987B\u4E3A${len}\u4E2A${label}",
            min: "\u6700\u5C11${min}\u4E2A${label}",
            max: "\u6700\u591A${max}\u4E2A${label}",
            range: "${label}\u6570\u91CF\u987B\u5728${min}-${max}\u4E4B\u95F4"
          },
          pattern: {
            mismatch: "${label}\u4E0E\u6A21\u5F0F\u4E0D\u5339\u914D${pattern}"
          }
        }
      },
      QRCode: {
        expired: "\u4E8C\u7EF4\u7801\u8FC7\u671F",
        refresh: "\u70B9\u51FB\u5237\u65B0",
        scanned: "\u5DF2\u626B\u63CF"
      },
      ColorPicker: {
        presetEmpty: "\u6682\u65E0",
        transparent: "\u65E0\u8272",
        singleColor: "\u5355\u8272",
        gradientColor: "\u6E10\u53D8\u8272"
      }
    };
    var _default = exports.default = localeValues;
  }
});

// ../../node_modules/.pnpm/antd@6.6.1_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/antd/locale/zh_CN.js
var require_zh_CN7 = __commonJS({
  "../../node_modules/.pnpm/antd@6.6.1_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/antd/locale/zh_CN.js"(exports, module) {
    module.exports = require_zh_CN6();
  }
});

// shell/.ojm-shim-antd-locale-zh_CN.mjs
var ojm_shim_antd_locale_zh_CN_exports = {};
__export(ojm_shim_antd_locale_zh_CN_exports, {
  default: () => ojm_shim_antd_locale_zh_CN_default
});
var __ns = __toESM(require_zh_CN7(), 1);
__reExport(ojm_shim_antd_locale_zh_CN_exports, __toESM(require_zh_CN7(), 1));
var ojm_shim_antd_locale_zh_CN_default = __ns.default ?? __ns;
export {
  ojm_shim_antd_locale_zh_CN_default as default
};
