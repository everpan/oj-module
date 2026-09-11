var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/index.js
var es_exports = {};
__export(es_exports, {
  I18nContext: () => I18nContext,
  I18nextProvider: () => I18nextProvider,
  IcuTrans: () => IcuTrans,
  IcuTransWithoutContext: () => IcuTransWithoutContext,
  Trans: () => Trans2,
  TransWithoutContext: () => Trans,
  Translation: () => Translation,
  composeInitialProps: () => composeInitialProps,
  date: () => date,
  getDefaults: () => getDefaults,
  getI18n: () => getI18n,
  getInitialProps: () => getInitialProps,
  initReactI18next: () => initReactI18next,
  nodesToString: () => nodesToString,
  number: () => number,
  plural: () => plural,
  select: () => select,
  selectOrdinal: () => selectOrdinal,
  setDefaults: () => setDefaults,
  setI18n: () => setI18n,
  time: () => time,
  useSSR: () => useSSR,
  useTranslation: () => useTranslation,
  withSSR: () => withSSR,
  withTranslation: () => withTranslation
});

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/Trans.js
import { useContext } from "react";

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/TransWithoutContext.js
import { Fragment, isValidElement, cloneElement, createElement, Children } from "react";
import { keyFromSelector } from "i18next";

// ../../node_modules/.pnpm/html-parse-stringify@4.0.1/node_modules/html-parse-stringify/dist/esm/html-parse-stringify.js
var voidElements = {
  area: true,
  base: true,
  br: true,
  col: true,
  embed: true,
  hr: true,
  img: true,
  input: true,
  link: true,
  meta: true,
  param: true,
  source: true,
  track: true,
  wbr: true,
  "!doctype": true,
  "!DOCTYPE": true
};
var attrRE = /\s([^'"/\s><]+?)[\s/>]|([^\s=]+)=\s?("[^"]*"|'[^']*')/g;
function parseTag(tag) {
  const res = {
    type: "tag",
    name: "",
    voidElement: false,
    attrs: {},
    children: []
  };
  const tagMatch = tag.match(/<\/?([^\s]+?)[/\s>]/);
  if (tagMatch) {
    res.name = tagMatch[1];
    if (voidElements[tagMatch[1]] || tag.charAt(tag.length - 2) === "/") {
      res.voidElement = true;
    }
    if (res.name.startsWith("!--")) {
      const endIndex = tag.indexOf("-->");
      return {
        type: "comment",
        comment: endIndex !== -1 ? tag.slice(4, endIndex) : ""
      };
    }
  }
  const reg = new RegExp(attrRE);
  let result = null;
  for (; ; ) {
    result = reg.exec(tag);
    if (result === null) {
      break;
    }
    if (!result[0].trim()) {
      continue;
    }
    if (result[1]) {
      const attr = result[1].trim();
      let arr = [attr, null];
      const eq = attr.indexOf("=");
      if (eq > -1) {
        arr = [attr.slice(0, eq), attr.slice(eq + 1)];
      }
      res.attrs[arr[0]] = arr[1];
      reg.lastIndex--;
    } else if (result[2]) {
      res.attrs[result[2]] = result[3].trim().substring(1, result[3].length - 1);
    }
  }
  return res;
}
var tagRE = /<!--[\s\S]*?-->|<[a-zA-Z0-9\-!/](?:"[^"]*"|'[^']*'|[^'">])*>/g;
var tagNameRE = /<\/?([^\s]+?)[/\s>]/;
var whitespaceRE = /^\s*$/;
var rawTextRE = /^(script|style)$/i;
var sentinel = "\0";
var empty = /* @__PURE__ */ Object.create(null);
function restoreSentinels(nodes) {
  nodes.forEach(function(node) {
    if (node.type === "text") {
      node.content = node.content.split(sentinel).join("<");
      return;
    }
    if (node.type === "comment") {
      node.comment = node.comment.split(sentinel).join("<");
      return;
    }
    for (const key in node.attrs) {
      const value = node.attrs[key];
      if (typeof value === "string" && value.indexOf(sentinel) > -1) {
        node.attrs[key] = value.split(sentinel).join("<");
      }
    }
    if (node.children.length) {
      restoreSentinels(node.children);
    }
  });
}
function parse(html, options) {
  const components = options && options.components || empty;
  const allowedTags = options && options.allowedTags;
  let restoreNeeded = false;
  if (allowedTags) {
    const isAllowed = typeof allowedTags === "function" ? allowedTags : function(name) {
      return allowedTags.indexOf(name) > -1;
    };
    let out = "";
    let pos = 0;
    tagRE.lastIndex = 0;
    let am;
    while (am = tagRE.exec(html)) {
      const tag = am[0];
      out += html.slice(pos, am.index);
      const nameMatch = tag.match(tagNameRE);
      if (tag.startsWith("<!--") || nameMatch && isAllowed(nameMatch[1])) {
        out += tag;
        pos = am.index + tag.length;
      } else {
        restoreNeeded = true;
        out += sentinel;
        pos = am.index + 1;
        tagRE.lastIndex = pos;
      }
    }
    html = out + html.slice(pos);
  }
  const result = [];
  const arr = [];
  let current;
  let level = -1;
  let inComponent = false;
  let rawUntil = 0;
  let htmlLower;
  if (html.indexOf("<") !== 0) {
    const end = html.indexOf("<");
    result.push({
      type: "text",
      content: end === -1 ? html : html.substring(0, end)
    });
  }
  const matches = [];
  let m;
  while (m = tagRE.exec(html)) {
    matches.push(m);
  }
  matches.forEach(function(match, i) {
    const tag = match[0];
    if (!tag) return;
    if (tag.startsWith("<!--")) return;
    let lts = 0;
    let gts = 0;
    let secondLt = -1;
    let quote = null;
    for (let j = 0; j < tag.length; j++) {
      const c = tag.charAt(j);
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === "<") {
        lts++;
        if (lts === 2) secondLt = j;
      } else if (c === ">") {
        gts++;
      }
    }
    const validSplit = secondLt > -1 && /[a-zA-Z0-9\-!/]/.test(tag.charAt(secondLt + 1));
    if (lts > gts && validSplit) {
      const firstPart = tag.substring(0, secondLt);
      const secondPart = tag.substring(firstPart.length);
      matches[i][0] = secondPart;
      matches[i].index += firstPart.length;
    }
  });
  matches.forEach(function(match, i) {
    const tag = match[0];
    if (!tag) return;
    const index2 = match.index;
    if (index2 < rawUntil) return;
    if (inComponent) {
      if (tag !== "</" + current.name + ">") {
        return;
      } else {
        inComponent = false;
      }
    }
    const isOpen = tag.charAt(1) !== "/";
    const isComment = tag.startsWith("<!--");
    const start = index2 + tag.length;
    const nextChar = html.charAt(start);
    const nextMatch = matches[i + 1];
    let isText;
    if (nextChar === "<" && nextMatch) {
      const nextTag = html.substring(start, nextMatch.index);
      isText = nextTag.split("<").length > nextTag.split(">").length;
    }
    let parent;
    if (isComment) {
      const comment = parseTag(tag);
      if (level < 0) {
        result.push(comment);
        return result;
      }
      parent = arr[level];
      parent.children.push(comment);
      const text = html.slice(start, nextMatch ? nextMatch.index : void 0);
      if (text.length > 0) {
        parent.children.push({
          type: "text",
          content: text
        });
      }
      return result;
    }
    if (isOpen) {
      level++;
      current = parseTag(tag);
      if (current.type === "tag" && components[current.name]) {
        current.type = "component";
        inComponent = true;
      }
      let isRawText = false;
      if (!inComponent && !current.voidElement && rawTextRE.test(current.name)) {
        isRawText = true;
        htmlLower || (htmlLower = html.toLowerCase());
        const closeIndex = htmlLower.indexOf(
          "</" + current.name.toLowerCase() + ">",
          start
        );
        const contentEnd = closeIndex === -1 ? html.length : closeIndex;
        const content = html.slice(start, contentEnd);
        if (content) {
          current.children.push({
            type: "text",
            content
          });
        }
        rawUntil = contentEnd;
      }
      if (!current.voidElement && !inComponent && !isRawText && nextChar && nextChar !== "<") {
        current.children.push({
          type: "text",
          content: html.slice(start, nextMatch ? nextMatch.index : void 0)
        });
      }
      if (level === 0) {
        result.push(current);
      }
      parent = arr[level - 1];
      if (parent) {
        parent.children.push(current);
      }
      arr[level] = current;
    }
    if (!isOpen || current.voidElement) {
      if (level > -1 && (current.voidElement || current.name === tag.slice(2, -1))) {
        level--;
        current = level === -1 ? result : arr[level];
      }
      if (!inComponent && (nextChar !== "<" || isText) && nextChar) {
        parent = level === -1 ? result : arr[level].children;
        const end = nextMatch ? nextMatch.index : -1;
        let content = html.slice(start, end === -1 ? void 0 : end);
        if (whitespaceRE.test(content)) {
          content = " ";
        }
        if (end > -1 && level + parent.length >= 0 || content !== " ") {
          parent.push({
            type: "text",
            content
          });
        }
      }
    }
  });
  if (restoreNeeded) {
    restoreSentinels(result);
  }
  return result;
}
function attrString(attrs) {
  const buff = [];
  for (const key in attrs) {
    if (attrs[key] === null) {
      buff.push(key);
    } else {
      buff.push(key + '="' + String(attrs[key]).replace(/"/g, "&quot;") + '"');
    }
  }
  if (!buff.length) {
    return "";
  }
  return " " + buff.join(" ");
}
function stringifyNode(buff, doc) {
  switch (doc.type) {
    case "text":
      return buff + doc.content;
    case "tag": {
      const tagEnd = doc.voidElement && doc.name.toLowerCase() !== "!doctype" ? "/>" : ">";
      buff += "<" + doc.name + (doc.attrs ? attrString(doc.attrs) : "") + tagEnd;
      if (doc.voidElement) {
        return buff;
      }
      return buff + doc.children.reduce(stringifyNode, "") + "</" + doc.name + ">";
    }
    case "comment":
      buff += "<!--" + doc.comment + "-->";
      return buff;
  }
}
function stringify(doc) {
  return doc.reduce(function(token, rootEl) {
    return token + stringifyNode("", rootEl);
  }, "");
}
var index = {
  parse,
  stringify
};

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/utils.js
var warn = (i18n, code, msg, rest) => {
  const args = [msg, {
    code,
    ...rest || {}
  }];
  if (i18n?.services?.logger?.forward) {
    return i18n.services.logger.forward(args, "warn", "react-i18next::", true);
  }
  if (isString(args[0])) args[0] = `react-i18next:: ${args[0]}`;
  if (i18n?.services?.logger?.warn) {
    i18n.services.logger.warn(...args);
  } else if (console?.warn) {
    console.warn(...args);
  }
};
var alreadyWarned = {};
var warnOnce = (i18n, code, msg, rest) => {
  if (isString(msg) && alreadyWarned[msg]) return;
  if (isString(msg)) alreadyWarned[msg] = /* @__PURE__ */ new Date();
  warn(i18n, code, msg, rest);
};
var loadedClb = (i18n, cb) => () => {
  if (i18n.isInitialized) {
    cb();
  } else {
    const initialized = () => {
      setTimeout(() => {
        i18n.off("initialized", initialized);
      }, 0);
      cb();
    };
    i18n.on("initialized", initialized);
  }
};
var loadNamespaces = (i18n, ns, cb) => {
  i18n.loadNamespaces(ns, loadedClb(i18n, cb));
};
var loadLanguages = (i18n, lng, ns, cb) => {
  if (isString(ns)) ns = [ns];
  if (i18n.options.preload && i18n.options.preload.indexOf(lng) > -1) return loadNamespaces(i18n, ns, cb);
  ns.forEach((n) => {
    if (i18n.options.ns.indexOf(n) < 0) i18n.options.ns.push(n);
  });
  i18n.loadLanguages(lng, loadedClb(i18n, cb));
};
var hasLoadedNamespace = (ns, i18n, options = {}) => {
  if (!i18n.languages || !i18n.languages.length) {
    warnOnce(i18n, "NO_LANGUAGES", "i18n.languages were undefined or empty", {
      languages: i18n.languages
    });
    return true;
  }
  return i18n.hasLoadedNamespace(ns, {
    lng: options.lng,
    precheck: (i18nInstance2, loadNotPending) => {
      if (options.bindI18n && options.bindI18n.indexOf("languageChanging") > -1 && i18nInstance2.services.backendConnector.backend && i18nInstance2.isLanguageChangingTo && !loadNotPending(i18nInstance2.isLanguageChangingTo, ns)) return false;
    }
  });
};
var getDisplayName = (Component) => Component.displayName || Component.name || (isString(Component) && Component.length > 0 ? Component : "Unknown");
var isString = (obj) => typeof obj === "string";
var isObject = (obj) => typeof obj === "object" && obj !== null;

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/unescape.js
var matchHtmlEntity = /&(?:amp|#38|lt|#60|gt|#62|apos|#39|quot|#34|nbsp|#160|copy|#169|reg|#174|hellip|#8230|#x2F|#47);/g;
var htmlEntities = {
  "&amp;": "&",
  "&#38;": "&",
  "&lt;": "<",
  "&#60;": "<",
  "&gt;": ">",
  "&#62;": ">",
  "&apos;": "'",
  "&#39;": "'",
  "&quot;": '"',
  "&#34;": '"',
  "&nbsp;": " ",
  "&#160;": " ",
  "&copy;": "\xA9",
  "&#169;": "\xA9",
  "&reg;": "\xAE",
  "&#174;": "\xAE",
  "&hellip;": "\u2026",
  "&#8230;": "\u2026",
  "&#x2F;": "/",
  "&#47;": "/"
};
var unescapeHtmlEntity = (m) => htmlEntities[m];
var unescape = (text) => text.replace(matchHtmlEntity, unescapeHtmlEntity);

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/defaults.js
var defaultOptions = {
  bindI18n: "languageChanged",
  bindI18nStore: "",
  transEmptyNodeValue: "",
  transSupportBasicHtmlNodes: true,
  transWrapTextNodes: "",
  transKeepBasicHtmlNodesFor: ["br", "strong", "i", "p"],
  useSuspense: true,
  unescape,
  transDefaultProps: void 0
};
var setDefaults = (options = {}) => {
  defaultOptions = {
    ...defaultOptions,
    ...options
  };
};
var getDefaults = () => defaultOptions;

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/i18nInstance.js
var i18nInstance;
var setI18n = (instance) => {
  i18nInstance = instance;
};
var getI18n = () => i18nInstance;

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/TransWithoutContext.js
var hasChildren = (node, checkLength) => {
  if (!node) return false;
  const base = node.props?.children ?? node.children;
  if (checkLength) return base.length > 0;
  return !!base;
};
var getChildren = (node) => {
  if (!node) return [];
  const children = node.props?.children ?? node.children;
  return node.props?.i18nIsDynamicList ? getAsArray(children) : children;
};
var hasValidReactChildren = (children) => Array.isArray(children) && children.every(isValidElement);
var getAsArray = (data) => Array.isArray(data) ? data : [data];
var mergeProps = (source, target) => {
  const newTarget = {
    ...target
  };
  newTarget.props = {
    ...target.props,
    ...source.props
  };
  return newTarget;
};
var getValuesFromChildren = (children) => {
  const values = {};
  if (!children) return values;
  const getData = (childs) => {
    const childrenArray = getAsArray(childs);
    childrenArray.forEach((child) => {
      if (isString(child)) return;
      if (hasChildren(child)) getData(getChildren(child));
      else if (isObject(child) && !isValidElement(child)) Object.assign(values, child);
    });
  };
  getData(children);
  return values;
};
var nodesToString = (children, i18nOptions, i18n, i18nKey) => {
  if (!children) return "";
  let stringNode = "";
  const childrenArray = getAsArray(children);
  const keepArray = i18nOptions?.transSupportBasicHtmlNodes ? i18nOptions.transKeepBasicHtmlNodesFor ?? [] : [];
  childrenArray.forEach((child, childIndex) => {
    if (isString(child)) {
      stringNode += `${child}`;
      return;
    }
    if (isValidElement(child)) {
      const {
        props,
        type
      } = child;
      const childPropsCount = Object.keys(props).length;
      const shouldKeepChild = keepArray.indexOf(type) > -1;
      const childChildren = props.children;
      if (!childChildren && shouldKeepChild && !childPropsCount) {
        stringNode += `<${type}/>`;
        return;
      }
      if (!childChildren && (!shouldKeepChild || childPropsCount) || props.i18nIsDynamicList) {
        stringNode += `<${childIndex}></${childIndex}>`;
        return;
      }
      if (shouldKeepChild && childPropsCount <= 1) {
        const cnt = isString(childChildren) ? childChildren : nodesToString(childChildren, i18nOptions, i18n, i18nKey);
        stringNode += `<${type}>${cnt}</${type}>`;
        return;
      }
      const content = nodesToString(childChildren, i18nOptions, i18n, i18nKey);
      stringNode += `<${childIndex}>${content}</${childIndex}>`;
      return;
    }
    if (child === null) {
      warn(i18n, "TRANS_NULL_VALUE", `Passed in a null value as child`, {
        i18nKey
      });
      return;
    }
    if (isObject(child)) {
      const {
        format,
        ...clone
      } = child;
      const keys = Object.keys(clone);
      if (keys.length === 1) {
        const value = format ? `${keys[0]}, ${format}` : keys[0];
        stringNode += `{{${value}}}`;
        return;
      }
      warn(i18n, "TRANS_INVALID_OBJ", `Invalid child - Object should only have keys {{ value, format }} (format is optional).`, {
        i18nKey,
        child
      });
      return;
    }
    warn(i18n, "TRANS_INVALID_VAR", `Passed in a variable like {number} - pass variables for interpolation as full objects like {{number}}.`, {
      i18nKey,
      child
    });
  });
  return stringNode;
};
var renderNodes = (children, knownComponentsMap, targetString, i18n, i18nOptions, combinedTOpts, shouldUnescape) => {
  if (targetString === "") return [];
  const keepArray = i18nOptions.transKeepBasicHtmlNodesFor || [];
  const emptyChildrenButNeedsHandling = targetString && new RegExp(keepArray.map((keep) => `<${keep}`).join("|")).test(targetString);
  if (!children && !knownComponentsMap && !emptyChildrenButNeedsHandling && !shouldUnescape) return [targetString];
  const data = knownComponentsMap ?? {};
  const getData = (childs) => {
    const childrenArray = getAsArray(childs);
    childrenArray.forEach((child) => {
      if (isString(child)) return;
      if (hasChildren(child)) getData(getChildren(child));
      else if (isObject(child) && !isValidElement(child)) Object.assign(data, child);
    });
  };
  getData(children);
  const knownNames = Object.keys(data);
  const allowedTags = (name) => /^\d+$/.test(name) || keepArray.indexOf(name) > -1 || knownNames.indexOf(name) > -1;
  const ast = index.parse(`<0>${targetString}</0>`, {
    allowedTags
  });
  const opts = {
    ...data,
    ...combinedTOpts
  };
  const renderInner = (child, node, rootReactNode) => {
    const childs = getChildren(child);
    const mappedChildren = mapAST(childs, node.children, rootReactNode);
    return hasValidReactChildren(childs) && mappedChildren.length === 0 || child.props?.i18nIsDynamicList ? childs : mappedChildren;
  };
  const pushTranslatedJSX = (child, inner, mem, i, isVoid) => {
    if (child.dummy) {
      child.children = inner;
      mem.push(cloneElement(child, {
        key: i
      }, isVoid ? void 0 : inner));
    } else {
      mem.push(...Children.map([child], (c) => {
        if (c.type === Fragment || c.props?.i18nIsDynamicList !== void 0) {
          const freshProps = {
            key: i
          };
          if (c && c.props) {
            Object.keys(c.props).forEach((k) => {
              if (k === "children" || k === "i18nIsDynamicList") return;
              freshProps[k] = c.props[k];
            });
          }
          return createElement(c.type, freshProps, isVoid ? null : inner);
        }
        const override = {
          key: i
        };
        if (c && c.props) {
          Object.keys(c.props).forEach((k) => {
            if (k === "ref" || k === "children") return;
            override[k] = c.props[k];
          });
        }
        return cloneElement(c, override, isVoid ? null : inner);
      }));
    }
  };
  const mapAST = (reactNode, astNode, rootReactNode) => {
    const reactNodes = getAsArray(reactNode);
    const astNodes = getAsArray(astNode);
    const keepTagOccurrence = {};
    return astNodes.reduce((mem, node, i) => {
      const translationContent = node.children?.[0]?.content && i18n.services.interpolator.interpolate(node.children[0].content, opts, i18n.language);
      if (node.type === "tag") {
        let tmp = reactNodes[parseInt(node.name, 10)];
        if (!tmp && knownComponentsMap) tmp = knownComponentsMap[node.name];
        if (rootReactNode.length === 1 && !tmp) tmp = rootReactNode[0][node.name];
        if (!tmp) tmp = {};
        const props = {
          ...node.attrs
        };
        if (shouldUnescape) {
          Object.keys(props).forEach((p) => {
            const val = props[p];
            if (isString(val)) {
              props[p] = unescape(val);
            }
          });
        }
        const child = Object.keys(props).length !== 0 ? mergeProps({
          props
        }, tmp) : tmp;
        const isElement = isValidElement(child);
        const isValidTranslationWithChildren = isElement && hasChildren(node, true) && !node.voidElement;
        const isEmptyTransWithHTML = emptyChildrenButNeedsHandling && isObject(child) && child.dummy && !isElement;
        const isKnownComponent = isObject(knownComponentsMap) && Object.hasOwnProperty.call(knownComponentsMap, node.name);
        if (isString(child)) {
          const value = i18n.services.interpolator.interpolate(child, opts, i18n.language);
          mem.push(value);
        } else if (hasChildren(child) || isValidTranslationWithChildren) {
          const inner = renderInner(child, node, rootReactNode);
          pushTranslatedJSX(child, inner, mem, i);
        } else if (isEmptyTransWithHTML) {
          const inner = mapAST(reactNodes, node.children, rootReactNode);
          pushTranslatedJSX(child, inner, mem, i);
        } else if (Number.isNaN(parseFloat(node.name))) {
          if (isKnownComponent) {
            const inner = renderInner(child, node, rootReactNode);
            pushTranslatedJSX(child, inner, mem, i, node.voidElement);
          } else if (i18nOptions.transSupportBasicHtmlNodes && keepArray.indexOf(node.name) > -1) {
            if (node.voidElement) {
              mem.push(createElement(node.name, {
                key: `${node.name}-${i}`
              }));
            } else {
              const occurrence = keepTagOccurrence[node.name] || 0;
              keepTagOccurrence[node.name] = occurrence + 1;
              let matched;
              let seen = 0;
              for (let r = 0; r < reactNodes.length; r += 1) {
                const rn = reactNodes[r];
                if (isValidElement(rn) && rn.type === node.name) {
                  if (seen === occurrence) {
                    matched = rn;
                    break;
                  }
                  seen += 1;
                }
              }
              const innerScope = matched ? getAsArray(getChildren(matched)) : reactNodes;
              const inner = mapAST(innerScope, node.children, rootReactNode);
              mem.push(createElement(node.name, {
                key: `${node.name}-${i}`
              }, inner));
            }
          } else if (node.voidElement) {
            mem.push(`<${node.name} />`);
          } else {
            const inner = mapAST(reactNodes, node.children, rootReactNode);
            mem.push(`<${node.name}>${inner}</${node.name}>`);
          }
        } else if (isObject(child) && !isElement) {
          const content = node.children[0] ? translationContent : null;
          if (content) mem.push(content);
        } else {
          pushTranslatedJSX(child, translationContent, mem, i, node.children.length !== 1 || !translationContent);
        }
      } else if (node.type === "text") {
        const wrapTextNodes = i18nOptions.transWrapTextNodes;
        const unescapeFn = typeof i18nOptions.unescape === "function" ? i18nOptions.unescape : getDefaults().unescape;
        const content = shouldUnescape ? unescapeFn(i18n.services.interpolator.interpolate(node.content, opts, i18n.language)) : i18n.services.interpolator.interpolate(node.content, opts, i18n.language);
        if (wrapTextNodes) {
          mem.push(createElement(wrapTextNodes, {
            key: `${node.name}-${i}`
          }, content));
        } else {
          mem.push(content);
        }
      }
      return mem;
    }, []);
  };
  const result = mapAST([{
    dummy: true,
    children: children || []
  }], ast, getAsArray(children || []));
  return getChildren(result[0]);
};
var fixComponentProps = (component, index2, translation) => {
  const componentKey = component.key || index2;
  const comp = cloneElement(component, {
    key: componentKey
  });
  if (!comp.props || !comp.props.children || translation.indexOf(`${index2}/>`) < 0 && translation.indexOf(`${index2} />`) < 0) {
    return comp;
  }
  function Componentized() {
    return createElement(Fragment, null, comp);
  }
  return createElement(Componentized, {
    key: componentKey
  });
};
var generateArrayComponents = (components, translation) => components.map((c, index2) => fixComponentProps(c, index2, translation));
var generateObjectComponents = (components, translation) => {
  const componentMap = {};
  Object.keys(components).forEach((c) => {
    Object.assign(componentMap, {
      [c]: fixComponentProps(components[c], c, translation)
    });
  });
  return componentMap;
};
var generateComponents = (components, translation, i18n, i18nKey) => {
  if (!components) return null;
  if (Array.isArray(components)) {
    return generateArrayComponents(components, translation);
  }
  if (isObject(components)) {
    return generateObjectComponents(components, translation);
  }
  warnOnce(i18n, "TRANS_INVALID_COMPONENTS", `<Trans /> "components" prop expects an object or array`, {
    i18nKey
  });
  return null;
};
var isComponentsMap = (object) => {
  if (!isObject(object)) return false;
  if (Array.isArray(object)) return false;
  return Object.keys(object).reduce((acc, key) => acc && Number.isNaN(Number.parseFloat(key)), true);
};
function Trans({
  children,
  count,
  parent,
  i18nKey,
  context,
  tOptions = {},
  values,
  defaults,
  components,
  ns,
  i18n: i18nFromProps,
  t: tFromProps,
  shouldUnescape,
  ...additionalProps
}) {
  const i18n = i18nFromProps || getI18n();
  if (!i18n) {
    warnOnce(i18n, "NO_I18NEXT_INSTANCE", `Trans: You need to pass in an i18next instance using initReactI18next or by passing it via props or context. In monorepo setups, make sure there is only one instance of react-i18next.`, {
      i18nKey
    });
    return children;
  }
  const t = tFromProps || i18n.t.bind(i18n) || ((k) => k);
  const reactI18nextOptions = {
    ...getDefaults(),
    ...i18n.options?.react
  };
  let namespaces = ns || t.ns || i18n.options?.defaultNS;
  namespaces = isString(namespaces) ? [namespaces] : namespaces || ["translation"];
  const {
    transDefaultProps
  } = reactI18nextOptions;
  const mergedTOptions = transDefaultProps?.tOptions ? {
    ...transDefaultProps.tOptions,
    ...tOptions
  } : tOptions;
  const mergedShouldUnescape = shouldUnescape ?? transDefaultProps?.shouldUnescape;
  const mergedValues = transDefaultProps?.values ? {
    ...transDefaultProps.values,
    ...values
  } : values;
  const mergedComponents = transDefaultProps?.components ? {
    ...transDefaultProps.components,
    ...components
  } : components;
  const nodeAsString = nodesToString(children, reactI18nextOptions, i18n, i18nKey);
  const defaultValue = defaults || mergedTOptions?.defaultValue || nodeAsString || reactI18nextOptions.transEmptyNodeValue || (typeof i18nKey === "function" ? keyFromSelector(i18nKey) : i18nKey);
  const {
    hashTransKey
  } = reactI18nextOptions;
  const key = i18nKey || (hashTransKey ? hashTransKey(nodeAsString || defaultValue) : nodeAsString || defaultValue);
  if (i18n.options?.interpolation?.defaultVariables) {
    values = mergedValues && Object.keys(mergedValues).length > 0 ? {
      ...mergedValues,
      ...i18n.options.interpolation.defaultVariables
    } : {
      ...i18n.options.interpolation.defaultVariables
    };
  } else {
    values = mergedValues;
  }
  const valuesFromChildren = getValuesFromChildren(children);
  if (valuesFromChildren && typeof valuesFromChildren.count === "number" && count === void 0) {
    count = valuesFromChildren.count;
  }
  const interpolationOverride = values || count !== void 0 && !i18n.options?.interpolation?.alwaysFormat || !children ? mergedTOptions.interpolation : {
    interpolation: {
      ...mergedTOptions.interpolation,
      prefix: "#$?",
      suffix: "?$#"
    }
  };
  const combinedTOpts = {
    ...mergedTOptions,
    context: context || mergedTOptions.context,
    count,
    ...values,
    ...interpolationOverride,
    defaultValue,
    ns: namespaces
  };
  let translation = key ? t(key, combinedTOpts) : defaultValue;
  if (translation === key && defaultValue) translation = defaultValue;
  const generatedComponents = generateComponents(mergedComponents, translation, i18n, i18nKey);
  let indexedChildren = generatedComponents || children;
  let componentsMap = null;
  if (isComponentsMap(generatedComponents)) {
    componentsMap = generatedComponents;
    indexedChildren = children;
  }
  const content = renderNodes(indexedChildren, componentsMap, translation, i18n, reactI18nextOptions, combinedTOpts, mergedShouldUnescape);
  const useAsParent = parent ?? reactI18nextOptions.defaultTransParent;
  return useAsParent ? createElement(useAsParent, additionalProps, content) : content;
}

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/context.js
import { createContext } from "react";

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/initReactI18next.js
var initReactI18next = {
  type: "3rdParty",
  init(instance) {
    setDefaults(instance.options.react);
    setI18n(instance);
  }
};

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/context.js
var I18nContext = createContext();
var ReportNamespaces = class {
  constructor() {
    this.usedNamespaces = {};
  }
  addUsedNamespaces(namespaces) {
    namespaces.forEach((ns) => {
      if (!this.usedNamespaces[ns]) this.usedNamespaces[ns] = true;
    });
  }
  getUsedNamespaces() {
    return Object.keys(this.usedNamespaces);
  }
};
var composeInitialProps = (ForComponent) => async (ctx) => {
  const componentsInitialProps = await ForComponent.getInitialProps?.(ctx) ?? {};
  const i18nInitialProps = getInitialProps();
  return {
    ...componentsInitialProps,
    ...i18nInitialProps
  };
};
var getInitialProps = () => {
  const i18n = getI18n();
  if (!i18n) {
    console.warn("react-i18next:: getInitialProps: You will need to pass in an i18next instance by using initReactI18next");
    return {};
  }
  const namespaces = i18n.reportNamespaces?.getUsedNamespaces() ?? [];
  const ret = {};
  const initialI18nStore = {};
  i18n.languages.forEach((l) => {
    initialI18nStore[l] = {};
    namespaces.forEach((ns) => {
      initialI18nStore[l][ns] = i18n.getResourceBundle(l, ns) || {};
    });
  });
  ret.initialI18nStore = initialI18nStore;
  ret.initialLanguage = i18n.language;
  return ret;
};

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/Trans.js
function Trans2({
  children,
  count,
  parent,
  i18nKey,
  context,
  tOptions = {},
  values,
  defaults,
  components,
  ns,
  i18n: i18nFromProps,
  t: tFromProps,
  shouldUnescape,
  ...additionalProps
}) {
  const {
    i18n: i18nFromContext,
    defaultNS: defaultNSFromContext
  } = useContext(I18nContext) || {};
  const i18n = i18nFromProps || i18nFromContext || getI18n();
  const t = tFromProps || i18n?.t.bind(i18n);
  return Trans({
    children,
    count,
    parent,
    i18nKey,
    context,
    tOptions,
    values,
    defaults,
    components,
    ns: ns || t?.ns || defaultNSFromContext || i18n?.options?.defaultNS,
    i18n,
    t: tFromProps,
    shouldUnescape,
    ...additionalProps
  });
}

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/IcuTrans.js
import { useContext as useContext2 } from "react";

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/IcuTransWithoutContext.js
import React2 from "react";

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/IcuTransUtils/TranslationParserError.js
var TranslationParserError = class _TranslationParserError extends Error {
  constructor(message, position, translationString) {
    super(message);
    this.name = "TranslationParserError";
    this.position = position;
    this.translationString = translationString;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, _TranslationParserError);
    }
  }
};

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/IcuTransUtils/htmlEntityDecoder.js
var commonEntities = {
  "&nbsp;": "\xA0",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&copy;": "\xA9",
  "&reg;": "\xAE",
  "&trade;": "\u2122",
  "&hellip;": "\u2026",
  "&ndash;": "\u2013",
  "&mdash;": "\u2014",
  "&lsquo;": "\u2018",
  "&rsquo;": "\u2019",
  "&sbquo;": "\u201A",
  "&ldquo;": "\u201C",
  "&rdquo;": "\u201D",
  "&bdquo;": "\u201E",
  "&dagger;": "\u2020",
  "&Dagger;": "\u2021",
  "&bull;": "\u2022",
  "&prime;": "\u2032",
  "&Prime;": "\u2033",
  "&lsaquo;": "\u2039",
  "&rsaquo;": "\u203A",
  "&sect;": "\xA7",
  "&para;": "\xB6",
  "&middot;": "\xB7",
  "&ensp;": "\u2002",
  "&emsp;": "\u2003",
  "&thinsp;": "\u2009",
  "&euro;": "\u20AC",
  "&pound;": "\xA3",
  "&yen;": "\xA5",
  "&cent;": "\xA2",
  "&curren;": "\xA4",
  "&times;": "\xD7",
  "&divide;": "\xF7",
  "&minus;": "\u2212",
  "&plusmn;": "\xB1",
  "&ne;": "\u2260",
  "&le;": "\u2264",
  "&ge;": "\u2265",
  "&asymp;": "\u2248",
  "&equiv;": "\u2261",
  "&infin;": "\u221E",
  "&int;": "\u222B",
  "&sum;": "\u2211",
  "&prod;": "\u220F",
  "&radic;": "\u221A",
  "&part;": "\u2202",
  "&permil;": "\u2030",
  "&deg;": "\xB0",
  "&micro;": "\xB5",
  "&larr;": "\u2190",
  "&uarr;": "\u2191",
  "&rarr;": "\u2192",
  "&darr;": "\u2193",
  "&harr;": "\u2194",
  "&crarr;": "\u21B5",
  "&lArr;": "\u21D0",
  "&uArr;": "\u21D1",
  "&rArr;": "\u21D2",
  "&dArr;": "\u21D3",
  "&hArr;": "\u21D4",
  "&alpha;": "\u03B1",
  "&beta;": "\u03B2",
  "&gamma;": "\u03B3",
  "&delta;": "\u03B4",
  "&epsilon;": "\u03B5",
  "&zeta;": "\u03B6",
  "&eta;": "\u03B7",
  "&theta;": "\u03B8",
  "&iota;": "\u03B9",
  "&kappa;": "\u03BA",
  "&lambda;": "\u03BB",
  "&mu;": "\u03BC",
  "&nu;": "\u03BD",
  "&xi;": "\u03BE",
  "&omicron;": "\u03BF",
  "&pi;": "\u03C0",
  "&rho;": "\u03C1",
  "&sigma;": "\u03C3",
  "&tau;": "\u03C4",
  "&upsilon;": "\u03C5",
  "&phi;": "\u03C6",
  "&chi;": "\u03C7",
  "&psi;": "\u03C8",
  "&omega;": "\u03C9",
  "&Alpha;": "\u0391",
  "&Beta;": "\u0392",
  "&Gamma;": "\u0393",
  "&Delta;": "\u0394",
  "&Epsilon;": "\u0395",
  "&Zeta;": "\u0396",
  "&Eta;": "\u0397",
  "&Theta;": "\u0398",
  "&Iota;": "\u0399",
  "&Kappa;": "\u039A",
  "&Lambda;": "\u039B",
  "&Mu;": "\u039C",
  "&Nu;": "\u039D",
  "&Xi;": "\u039E",
  "&Omicron;": "\u039F",
  "&Pi;": "\u03A0",
  "&Rho;": "\u03A1",
  "&Sigma;": "\u03A3",
  "&Tau;": "\u03A4",
  "&Upsilon;": "\u03A5",
  "&Phi;": "\u03A6",
  "&Chi;": "\u03A7",
  "&Psi;": "\u03A8",
  "&Omega;": "\u03A9",
  "&Agrave;": "\xC0",
  "&Aacute;": "\xC1",
  "&Acirc;": "\xC2",
  "&Atilde;": "\xC3",
  "&Auml;": "\xC4",
  "&Aring;": "\xC5",
  "&AElig;": "\xC6",
  "&Ccedil;": "\xC7",
  "&Egrave;": "\xC8",
  "&Eacute;": "\xC9",
  "&Ecirc;": "\xCA",
  "&Euml;": "\xCB",
  "&Igrave;": "\xCC",
  "&Iacute;": "\xCD",
  "&Icirc;": "\xCE",
  "&Iuml;": "\xCF",
  "&ETH;": "\xD0",
  "&Ntilde;": "\xD1",
  "&Ograve;": "\xD2",
  "&Oacute;": "\xD3",
  "&Ocirc;": "\xD4",
  "&Otilde;": "\xD5",
  "&Ouml;": "\xD6",
  "&Oslash;": "\xD8",
  "&Ugrave;": "\xD9",
  "&Uacute;": "\xDA",
  "&Ucirc;": "\xDB",
  "&Uuml;": "\xDC",
  "&Yacute;": "\xDD",
  "&THORN;": "\xDE",
  "&szlig;": "\xDF",
  "&agrave;": "\xE0",
  "&aacute;": "\xE1",
  "&acirc;": "\xE2",
  "&atilde;": "\xE3",
  "&auml;": "\xE4",
  "&aring;": "\xE5",
  "&aelig;": "\xE6",
  "&ccedil;": "\xE7",
  "&egrave;": "\xE8",
  "&eacute;": "\xE9",
  "&ecirc;": "\xEA",
  "&euml;": "\xEB",
  "&igrave;": "\xEC",
  "&iacute;": "\xED",
  "&icirc;": "\xEE",
  "&iuml;": "\xEF",
  "&eth;": "\xF0",
  "&ntilde;": "\xF1",
  "&ograve;": "\xF2",
  "&oacute;": "\xF3",
  "&ocirc;": "\xF4",
  "&otilde;": "\xF5",
  "&ouml;": "\xF6",
  "&oslash;": "\xF8",
  "&ugrave;": "\xF9",
  "&uacute;": "\xFA",
  "&ucirc;": "\xFB",
  "&uuml;": "\xFC",
  "&yacute;": "\xFD",
  "&thorn;": "\xFE",
  "&yuml;": "\xFF",
  "&iexcl;": "\xA1",
  "&iquest;": "\xBF",
  "&fnof;": "\u0192",
  "&circ;": "\u02C6",
  "&tilde;": "\u02DC",
  "&OElig;": "\u0152",
  "&oelig;": "\u0153",
  "&Scaron;": "\u0160",
  "&scaron;": "\u0161",
  "&Yuml;": "\u0178",
  "&ordf;": "\xAA",
  "&ordm;": "\xBA",
  "&macr;": "\xAF",
  "&acute;": "\xB4",
  "&cedil;": "\xB8",
  "&sup1;": "\xB9",
  "&sup2;": "\xB2",
  "&sup3;": "\xB3",
  "&frac14;": "\xBC",
  "&frac12;": "\xBD",
  "&frac34;": "\xBE",
  "&spades;": "\u2660",
  "&clubs;": "\u2663",
  "&hearts;": "\u2665",
  "&diams;": "\u2666",
  "&loz;": "\u25CA",
  "&oline;": "\u203E",
  "&frasl;": "\u2044",
  "&weierp;": "\u2118",
  "&image;": "\u2111",
  "&real;": "\u211C",
  "&alefsym;": "\u2135"
};
var entityPattern = new RegExp(Object.keys(commonEntities).map((entity) => entity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
var decodeHtmlEntities = (text) => text.replace(entityPattern, (match) => commonEntities[match]).replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10))).replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/IcuTransUtils/tokenizer.js
var tokenize = (translation) => {
  const tokens = [];
  let position = 0;
  let currentText = "";
  const flushText = () => {
    if (currentText) {
      tokens.push({
        type: "Text",
        value: currentText,
        position: position - currentText.length
      });
      currentText = "";
    }
  };
  while (position < translation.length) {
    const char = translation[position];
    if (char === "<") {
      const tagMatch = translation.slice(position).match(/^<(\d+)>/);
      if (tagMatch) {
        flushText();
        tokens.push({
          type: "TagOpen",
          value: tagMatch[0],
          position,
          tagNumber: parseInt(tagMatch[1], 10)
        });
        position += tagMatch[0].length;
      } else {
        const closeTagMatch = translation.slice(position).match(/^<\/(\d+)>/);
        if (closeTagMatch) {
          flushText();
          tokens.push({
            type: "TagClose",
            value: closeTagMatch[0],
            position,
            tagNumber: parseInt(closeTagMatch[1], 10)
          });
          position += closeTagMatch[0].length;
        } else {
          currentText += char;
          position += 1;
        }
      }
    } else {
      currentText += char;
      position += 1;
    }
  }
  flushText();
  return tokens;
};

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/IcuTransUtils/renderTranslation.js
import React from "react";
var renderDeclarationNode = (declaration, children, childDeclarations) => {
  const {
    type,
    props = {}
  } = declaration;
  if (props.children && Array.isArray(props.children) && childDeclarations) {
    const {
      children: _childrenToRemove,
      ...propsWithoutChildren
    } = props;
    return React.createElement(type, propsWithoutChildren, ...children);
  }
  if (children.length === 0) {
    return React.createElement(type, props);
  }
  if (children.length === 1) {
    return React.createElement(type, props, children[0]);
  }
  return React.createElement(type, props, ...children);
};
var renderTranslation = (translation, declarations = []) => {
  if (!translation) {
    return [];
  }
  const tokens = tokenize(translation);
  const result = [];
  const stack = [];
  const literalTagNumbers = /* @__PURE__ */ new Set();
  const getCurrentDeclarations = () => {
    if (stack.length === 0) {
      return declarations;
    }
    const parentFrame = stack[stack.length - 1];
    if (parentFrame.declaration.props?.children && Array.isArray(parentFrame.declaration.props.children)) {
      return parentFrame.declaration.props.children;
    }
    return parentFrame.declarations;
  };
  tokens.forEach((token) => {
    switch (token.type) {
      case "Text":
        {
          const decoded = decodeHtmlEntities(token.value);
          const targetArray = stack.length > 0 ? stack[stack.length - 1].children : result;
          targetArray.push(decoded);
        }
        break;
      case "TagOpen":
        {
          const {
            tagNumber
          } = token;
          const currentDeclarations = getCurrentDeclarations();
          const declaration = currentDeclarations[tagNumber];
          if (!declaration) {
            literalTagNumbers.add(tagNumber);
            const literalText = `<${tagNumber}>`;
            const targetArray = stack.length > 0 ? stack[stack.length - 1].children : result;
            targetArray.push(literalText);
            break;
          }
          stack.push({
            tagNumber,
            children: [],
            position: token.position,
            declaration,
            declarations: currentDeclarations
          });
        }
        break;
      case "TagClose":
        {
          const {
            tagNumber
          } = token;
          if (literalTagNumbers.has(tagNumber)) {
            const literalText = `</${tagNumber}>`;
            const literalTargetArray = stack.length > 0 ? stack[stack.length - 1].children : result;
            literalTargetArray.push(literalText);
            literalTagNumbers.delete(tagNumber);
            break;
          }
          if (stack.length === 0) {
            throw new TranslationParserError(`Unexpected closing tag </${tagNumber}> at position ${token.position}`, token.position, translation);
          }
          const frame = stack.pop();
          if (frame.tagNumber !== tagNumber) {
            throw new TranslationParserError(`Mismatched tags: expected </${frame.tagNumber}> but got </${tagNumber}> at position ${token.position}`, token.position, translation);
          }
          const element = renderDeclarationNode(frame.declaration, frame.children, frame.declarations);
          const elementTargetArray = stack.length > 0 ? stack[stack.length - 1].children : result;
          elementTargetArray.push(element);
        }
        break;
    }
  });
  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1];
    throw new TranslationParserError(`Unclosed tag <${unclosed.tagNumber}> at position ${unclosed.position}`, unclosed.position, translation);
  }
  return result;
};

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/IcuTransWithoutContext.js
function IcuTransWithoutContext({
  i18nKey,
  defaultTranslation,
  content,
  ns,
  values = {},
  i18n: i18nFromProps,
  t: tFromProps
}) {
  const i18n = i18nFromProps || getI18n();
  if (!i18n) {
    warnOnce(i18n, "NO_I18NEXT_INSTANCE", `IcuTrans: You need to pass in an i18next instance using i18nextReactModule`, {
      i18nKey
    });
    return React2.createElement(React2.Fragment, {}, defaultTranslation);
  }
  const t = tFromProps || i18n.t?.bind(i18n) || ((k) => k);
  let namespaces = ns || t.ns || i18n.options?.defaultNS;
  namespaces = isString(namespaces) ? [namespaces] : namespaces || ["translation"];
  let mergedValues = values;
  if (i18n.options?.interpolation?.defaultVariables) {
    mergedValues = values && Object.keys(values).length > 0 ? {
      ...values,
      ...i18n.options.interpolation.defaultVariables
    } : {
      ...i18n.options.interpolation.defaultVariables
    };
  }
  const translation = t(i18nKey || defaultTranslation, {
    defaultValue: defaultTranslation,
    ...mergedValues,
    ns: namespaces
  });
  try {
    const rendered = renderTranslation(translation, content);
    return React2.createElement(React2.Fragment, {}, ...rendered);
  } catch (error) {
    warn(i18n, "ICU_TRANS_RENDER_ERROR", `IcuTrans component error for key "${i18nKey}": ${error.message}`, {
      i18nKey,
      error
    });
    return React2.createElement(React2.Fragment, {}, translation);
  }
}
IcuTransWithoutContext.displayName = "IcuTransWithoutContext";

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/IcuTrans.js
function IcuTrans({
  i18nKey,
  defaultTranslation,
  content,
  ns,
  values = {},
  i18n: i18nFromProps,
  t: tFromProps
}) {
  const {
    i18n: i18nFromContext,
    defaultNS: defaultNSFromContext
  } = useContext2(I18nContext) || {};
  const i18n = i18nFromProps || i18nFromContext || getI18n();
  const t = tFromProps || i18n?.t.bind(i18n);
  return IcuTransWithoutContext({
    i18nKey,
    defaultTranslation,
    content,
    ns: ns || t?.ns || defaultNSFromContext || i18n?.options?.defaultNS,
    values,
    i18n,
    t: tFromProps
  });
}
IcuTrans.displayName = "IcuTrans";

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/useTranslation.js
import { useContext as useContext3, useCallback, useMemo, useEffect, useRef, useState } from "react";
import { useSyncExternalStore } from "use-sync-external-store/shim";
var notReadyT = (k, optsOrDefaultValue) => {
  if (isString(optsOrDefaultValue)) return optsOrDefaultValue;
  if (isObject(optsOrDefaultValue) && isString(optsOrDefaultValue.defaultValue)) return optsOrDefaultValue.defaultValue;
  if (typeof k === "function") return "";
  if (Array.isArray(k)) {
    const last = k[k.length - 1];
    return typeof last === "function" ? "" : last;
  }
  return k;
};
var notReadySnapshot = {
  t: notReadyT,
  ready: false
};
var dummySubscribe = () => () => {
};
var useTranslation = (ns, props = {}) => {
  const {
    i18n: i18nFromProps
  } = props;
  const {
    i18n: i18nFromContext,
    defaultNS: defaultNSFromContext
  } = useContext3(I18nContext) || {};
  const i18n = i18nFromProps || i18nFromContext || getI18n();
  if (i18n && !i18n.reportNamespaces) i18n.reportNamespaces = new ReportNamespaces();
  if (!i18n) {
    warnOnce(i18n, "NO_I18NEXT_INSTANCE", "useTranslation: You will need to pass in an i18next instance by using initReactI18next or by passing it via props or context. In monorepo setups, make sure there is only one instance of react-i18next.");
  }
  const i18nOptions = useMemo(() => ({
    ...getDefaults(),
    ...i18n?.options?.react,
    ...props
  }), [i18n, props]);
  const {
    useSuspense,
    keyPrefix
  } = i18nOptions;
  const nsOrContext = ns || defaultNSFromContext || i18n?.options?.defaultNS;
  const unstableNamespaces = isString(nsOrContext) ? [nsOrContext] : nsOrContext || ["translation"];
  const namespaces = useMemo(() => unstableNamespaces, unstableNamespaces);
  i18n?.reportNamespaces?.addUsedNamespaces?.(namespaces);
  const revisionRef = useRef(0);
  const subscribe = useCallback((callback) => {
    if (!i18n) return dummySubscribe;
    const {
      bindI18n,
      bindI18nStore
    } = i18nOptions;
    const wrappedCallback = () => {
      revisionRef.current += 1;
      callback();
    };
    if (bindI18n) i18n.on(bindI18n, wrappedCallback);
    if (bindI18nStore) i18n.store.on(bindI18nStore, wrappedCallback);
    return () => {
      if (bindI18n) bindI18n.split(" ").forEach((e) => i18n.off(e, wrappedCallback));
      if (bindI18nStore) bindI18nStore.split(" ").forEach((e) => i18n.store.off(e, wrappedCallback));
    };
  }, [i18n, i18nOptions]);
  const snapshotRef = useRef();
  const getSnapshot = useCallback(() => {
    if (!i18n) {
      return notReadySnapshot;
    }
    const calculatedReady = !!(i18n.isInitialized || i18n.initializedStoreOnce) && namespaces.every((n) => hasLoadedNamespace(n, i18n, i18nOptions));
    const currentLng = props.lng || i18n.language;
    const currentRevision = revisionRef.current;
    const lastSnapshot = snapshotRef.current;
    if (lastSnapshot && lastSnapshot.ready === calculatedReady && lastSnapshot.lng === currentLng && lastSnapshot.keyPrefix === keyPrefix && lastSnapshot.revision === currentRevision) {
      return lastSnapshot;
    }
    const calculatedT = i18n.getFixedT(currentLng, i18nOptions.nsMode === "fallback" ? namespaces : namespaces[0], keyPrefix, {
      scopeNs: namespaces
    });
    const newSnapshot = {
      t: calculatedT,
      ready: calculatedReady,
      lng: currentLng,
      keyPrefix,
      revision: currentRevision
    };
    snapshotRef.current = newSnapshot;
    return newSnapshot;
  }, [i18n, namespaces, keyPrefix, i18nOptions, props.lng]);
  const [loadCount, setLoadCount] = useState(0);
  const {
    t,
    ready
  } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    if (i18n && !ready && !useSuspense) {
      const onLoaded = () => setLoadCount((c) => c + 1);
      if (props.lng) {
        loadLanguages(i18n, props.lng, namespaces, onLoaded);
      } else {
        loadNamespaces(i18n, namespaces, onLoaded);
      }
    }
  }, [i18n, props.lng, namespaces, ready, useSuspense, loadCount]);
  const finalI18n = i18n || {};
  const wrapperRef = useRef(null);
  const wrapperLangRef = useRef();
  const createI18nWrapper = (original) => {
    const descriptors = Object.getOwnPropertyDescriptors(original);
    if (descriptors.__original) delete descriptors.__original;
    const wrapper = Object.create(Object.getPrototypeOf(original), descriptors);
    if (!Object.prototype.hasOwnProperty.call(wrapper, "__original")) {
      try {
        Object.defineProperty(wrapper, "__original", {
          value: original,
          writable: false,
          enumerable: false,
          configurable: false
        });
      } catch (_) {
      }
    }
    return wrapper;
  };
  const ret = useMemo(() => {
    const original = finalI18n;
    const lang = original?.language;
    let i18nWrapper = original;
    if (original) {
      if (wrapperRef.current && wrapperRef.current.__original === original) {
        if (wrapperLangRef.current !== lang) {
          i18nWrapper = createI18nWrapper(original);
          wrapperRef.current = i18nWrapper;
          wrapperLangRef.current = lang;
        } else {
          i18nWrapper = wrapperRef.current;
        }
      } else {
        i18nWrapper = createI18nWrapper(original);
        wrapperRef.current = i18nWrapper;
        wrapperLangRef.current = lang;
      }
    }
    const effectiveT = !ready && !useSuspense ? (...args) => {
      warnOnce(i18n, "USE_T_BEFORE_READY", "useTranslation: t was called before ready. When using useSuspense: false, make sure to check the ready flag before using t.");
      return t(...args);
    } : t;
    const arr = [effectiveT, i18nWrapper, ready];
    arr.t = effectiveT;
    arr.i18n = i18nWrapper;
    arr.ready = ready;
    return arr;
  }, [t, finalI18n, ready, finalI18n.resolvedLanguage, finalI18n.language, finalI18n.languages]);
  if (i18n && useSuspense && !ready) {
    let inDevelopment = false;
    try {
      inDevelopment = false;
    } catch (e) {
    }
    if (inDevelopment) {
      warnOnce(i18n, "SUSPENDED_WHILE_LOADING", "useTranslation: suspended while translations are loading (useSuspense is true by default). Add a <Suspense> boundary above this component, or set react.useSuspense: false in the i18next init options. https://react.i18next.com/latest/usetranslation-hook");
    }
    throw new Promise((resolve) => {
      const onLoaded = () => resolve();
      if (props.lng) {
        loadLanguages(i18n, props.lng, namespaces, onLoaded);
      } else {
        loadNamespaces(i18n, namespaces, onLoaded);
      }
    });
  }
  return ret;
};

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/withTranslation.js
import { createElement as createElement2, forwardRef as forwardRefReact } from "react";
var withTranslation = (ns, options = {}) => function Extend(WrappedComponent) {
  function I18nextWithTranslation({
    forwardedRef,
    ...rest
  }) {
    const [t, i18n, ready] = useTranslation(ns, {
      ...rest,
      keyPrefix: options.keyPrefix
    });
    const passDownProps = {
      ...rest,
      t,
      i18n,
      tReady: ready
    };
    if (options.withRef && forwardedRef) {
      passDownProps.ref = forwardedRef;
    } else if (!options.withRef && forwardedRef) {
      passDownProps.forwardedRef = forwardedRef;
    }
    return createElement2(WrappedComponent, passDownProps);
  }
  I18nextWithTranslation.displayName = `withI18nextTranslation(${getDisplayName(WrappedComponent)})`;
  I18nextWithTranslation.WrappedComponent = WrappedComponent;
  const forwardRef = (props, ref) => createElement2(I18nextWithTranslation, Object.assign({}, props, {
    forwardedRef: ref
  }));
  return options.withRef ? forwardRefReact(forwardRef) : I18nextWithTranslation;
};

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/Translation.js
var Translation = ({
  ns,
  children,
  ...options
}) => {
  const [t, i18n, ready] = useTranslation(ns, options);
  return children(t, {
    i18n,
    lng: i18n?.language
  }, ready);
};

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/I18nextProvider.js
import { createElement as createElement3, useMemo as useMemo2 } from "react";
function I18nextProvider({
  i18n,
  defaultNS,
  children
}) {
  const value = useMemo2(() => ({
    i18n,
    defaultNS
  }), [i18n, defaultNS]);
  return createElement3(I18nContext.Provider, {
    value
  }, children);
}

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/withSSR.js
import { createElement as createElement4 } from "react";

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/useSSR.js
import { useContext as useContext4 } from "react";
var useSSR = (initialI18nStore, initialLanguage, props = {}) => {
  const {
    i18n: i18nFromProps
  } = props;
  const {
    i18n: i18nFromContext
  } = useContext4(I18nContext) || {};
  const i18n = i18nFromProps || i18nFromContext || getI18n();
  if (!i18n) {
    warnOnce(i18n, "NO_I18NEXT_INSTANCE", "useSSR: You will need to pass in an i18next instance by using initReactI18next or by passing it via props or context. In monorepo setups, make sure there is only one instance of react-i18next.");
    return;
  }
  if (i18n.options?.isClone) return;
  if (initialI18nStore && !i18n.initializedStoreOnce) {
    if (!i18n.services?.resourceStore) {
      warnOnce(i18n, "I18N_NOT_INITIALIZED", "useSSR: i18n instance was found but not initialized (services.resourceStore is missing). Make sure you call i18next.init() before using useSSR \u2014 e.g. at module level, not only in getStaticProps/getServerSideProps.");
      return;
    }
    i18n.services.resourceStore.data = initialI18nStore;
    i18n.options.ns = Object.values(initialI18nStore).reduce((mem, lngResources) => {
      Object.keys(lngResources).forEach((ns) => {
        if (mem.indexOf(ns) < 0) mem.push(ns);
      });
      return mem;
    }, i18n.options.ns);
    i18n.initializedStoreOnce = true;
    i18n.isInitialized = true;
  }
  if (initialLanguage && !i18n.initializedLanguageOnce) {
    i18n.changeLanguage(initialLanguage);
    i18n.initializedLanguageOnce = true;
  }
};

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/withSSR.js
var withSSR = () => function Extend(WrappedComponent) {
  function I18nextWithSSR({
    initialI18nStore,
    initialLanguage,
    ...rest
  }) {
    useSSR(initialI18nStore, initialLanguage);
    return createElement4(WrappedComponent, {
      ...rest
    });
  }
  I18nextWithSSR.getInitialProps = composeInitialProps(WrappedComponent);
  I18nextWithSSR.displayName = `withI18nextSSR(${getDisplayName(WrappedComponent)})`;
  I18nextWithSSR.WrappedComponent = WrappedComponent;
  return I18nextWithSSR;
};

// ../../node_modules/.pnpm/react-i18next@17.0.12_i18next@26.4.0_typescript@6.0.3__react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@6.0.3/node_modules/react-i18next/dist/es/index.js
var date = () => "";
var time = () => "";
var number = () => "";
var select = () => "";
var plural = () => "";
var selectOrdinal = () => "";

// shell/.ojm-shim-react-i18next.mjs
var ojm_shim_react_i18next_default = void 0 ?? es_exports;
export {
  I18nContext,
  I18nextProvider,
  IcuTrans,
  IcuTransWithoutContext,
  Trans2 as Trans,
  Trans as TransWithoutContext,
  Translation,
  composeInitialProps,
  date,
  ojm_shim_react_i18next_default as default,
  getDefaults,
  getI18n,
  getInitialProps,
  initReactI18next,
  nodesToString,
  number,
  plural,
  select,
  selectOrdinal,
  setDefaults,
  setI18n,
  time,
  useSSR,
  useTranslation,
  withSSR,
  withTranslation
};
