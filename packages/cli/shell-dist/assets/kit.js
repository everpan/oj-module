var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../kit/src/index.ts
var src_exports = {};
__export(src_exports, {
  AvatarInput: () => AvatarInput,
  DEFAULT_CRITERIA: () => DEFAULT_CRITERIA,
  PasswordStrength: () => PasswordStrength
});

// ../kit/src/avatar-input.tsx
import { Avatar, Upload } from "antd";
import { jsx } from "react/jsx-runtime";
function AvatarInput({
  value,
  onChange,
  onError,
  size = 96,
  shape = "circle",
  disabled = false,
  accept = "image/*",
  maxSizeMB = 2,
  placeholder
}) {
  const handleBeforeUpload = (file) => {
    const isImage = file.type.startsWith("image/");
    if (!isImage) {
      onError?.("type");
      return Upload.LIST_IGNORE;
    }
    const isWithinSize = file.size / 1024 / 1024 <= maxSizeMB;
    if (!isWithinSize) {
      onError?.("size");
      return Upload.LIST_IGNORE;
    }
    onChange?.(file);
    return false;
  };
  return /* @__PURE__ */ jsx(
    Upload,
    {
      accept,
      beforeUpload: handleBeforeUpload,
      disabled,
      maxCount: 1,
      showUploadList: false,
      children: /* @__PURE__ */ jsx(
        Avatar,
        {
          shape,
          size,
          src: value,
          style: { cursor: disabled ? "not-allowed" : "pointer" },
          children: placeholder ?? "\u4E0A\u4F20"
        }
      )
    }
  );
}

// ../kit/src/criteria.ts
var DEFAULT_CRITERIA = [
  { key: "length", label: "\u81F3\u5C11 8 \u4E2A\u5B57\u7B26", test: (p) => p.length >= 8 },
  { key: "lower", label: "\u5305\u542B\u5C0F\u5199\u5B57\u6BCD", test: (p) => /[a-z]/.test(p) },
  { key: "upper", label: "\u5305\u542B\u5927\u5199\u5B57\u6BCD", test: (p) => /[A-Z]/.test(p) },
  { key: "digit", label: "\u5305\u542B\u6570\u5B57", test: (p) => /\d/.test(p) },
  { key: "symbol", label: "\u5305\u542B\u7B26\u53F7", test: (p) => /[^A-Z0-9]/i.test(p) }
];

// ../kit/src/password-strength.tsx
import { Flex, theme, Typography } from "antd";
import { useMemo } from "react";
import { jsx as jsx2, jsxs } from "react/jsx-runtime";
function PasswordStrength({ password, showCriteria = true, criteria = DEFAULT_CRITERIA }) {
  const { token } = theme.useToken();
  const level = useMemo(() => {
    if (!password)
      return { activeBars: 0, message: "", color: token.colorFillTertiary };
    const passed = criteria.filter((c) => c.test(password)).length;
    if (passed <= 2)
      return { activeBars: 1, message: "\u5BC6\u7801\u5F3A\u5EA6\uFF1A\u5F31", color: token.colorError };
    if (passed <= 4)
      return { activeBars: 2, message: "\u5BC6\u7801\u5F3A\u5EA6\uFF1A\u4E2D", color: token.colorWarning };
    return { activeBars: 3, message: "\u5BC6\u7801\u5F3A\u5EA6\uFF1A\u5F3A", color: token.colorSuccess };
  }, [password, criteria, token]);
  if (!password && !showCriteria)
    return null;
  return /* @__PURE__ */ jsxs(Flex, { vertical: true, gap: 8, children: [
    password && /* @__PURE__ */ jsxs(Flex, { vertical: true, gap: 4, children: [
      /* @__PURE__ */ jsx2(Flex, { gap: 4, children: [0, 1, 2].map((i) => /* @__PURE__ */ jsx2(
        "div",
        {
          style: {
            height: 4,
            flex: 1,
            borderRadius: 2,
            backgroundColor: i < level.activeBars ? level.color : token.colorFillTertiary
          }
        },
        i
      )) }),
      /* @__PURE__ */ jsx2(Typography.Text, { style: { color: level.color, fontSize: 12 }, children: level.message })
    ] }),
    showCriteria && /* @__PURE__ */ jsx2(Flex, { wrap: true, gap: 8, children: criteria.map((c) => {
      const valid = c.test(password);
      return /* @__PURE__ */ jsxs(Typography.Text, { style: { fontSize: 12, color: valid ? token.colorSuccess : token.colorTextTertiary }, children: [
        valid ? "\u2713 " : "\xB7 ",
        c.label
      ] }, c.key);
    }) })
  ] });
}

// shell/.ojm-shim-kit.mjs
var ojm_shim_kit_default = void 0 ?? src_exports;
export {
  AvatarInput,
  DEFAULT_CRITERIA,
  PasswordStrength,
  ojm_shim_kit_default as default
};
