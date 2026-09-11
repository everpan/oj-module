var __defProp = Object.defineProperty;
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);
var __privateWrapper = (obj, member, setter, getter) => ({
  set _(value) {
    __privateSet(obj, member, value, setter);
  },
  get _() {
    return __privateGet(obj, member, getter);
  }
});

// ../../node_modules/.pnpm/ky@2.0.2/node_modules/ky/distribution/index.js
var distribution_exports = {};
__export(distribution_exports, {
  ForceRetryError: () => ForceRetryError,
  HTTPError: () => HTTPError,
  KyError: () => KyError,
  NetworkError: () => NetworkError,
  SchemaValidationError: () => SchemaValidationError,
  TimeoutError: () => TimeoutError,
  default: () => distribution_default,
  isForceRetryError: () => isForceRetryError,
  isHTTPError: () => isHTTPError,
  isKyError: () => isKyError,
  isNetworkError: () => isNetworkError,
  isTimeoutError: () => isTimeoutError,
  replaceOption: () => replaceOption
});

// ../../node_modules/.pnpm/ky@2.0.2/node_modules/ky/distribution/errors/KyError.js
var KyError = class extends Error {
  constructor() {
    super(...arguments);
    __publicField(this, "name", "KyError");
  }
  get isKyError() {
    return true;
  }
};

// ../../node_modules/.pnpm/ky@2.0.2/node_modules/ky/distribution/errors/HTTPError.js
var HTTPError = class extends KyError {
  constructor(response, request, options) {
    const code = response.status || response.status === 0 ? response.status : "";
    const title = response.statusText ?? "";
    const status = `${code} ${title}`.trim();
    const reason = status ? `status code ${status}` : "an unknown error";
    super(`Request failed with ${reason}: ${request.method} ${request.url}`);
    __publicField(this, "name", "HTTPError");
    __publicField(this, "response");
    __publicField(this, "request");
    __publicField(this, "options");
    __publicField(this, "data");
    this.response = response;
    this.request = request;
    this.options = options;
  }
};

// ../../node_modules/.pnpm/ky@2.0.2/node_modules/ky/distribution/errors/NetworkError.js
var NetworkError = class extends KyError {
  constructor(request, options) {
    super(`Request failed due to a network error: ${request.method} ${request.url}`, options);
    __publicField(this, "name", "NetworkError");
    __publicField(this, "request");
    this.request = request;
  }
};

// ../../node_modules/.pnpm/ky@2.0.2/node_modules/ky/distribution/errors/NonError.js
var NonError = class extends Error {
  constructor(value) {
    let message = "Non-error value was thrown";
    try {
      if (typeof value === "string") {
        message = value;
      } else if (value && typeof value === "object" && "message" in value && typeof value.message === "string") {
        message = value.message;
      }
    } catch {
    }
    super(message);
    __publicField(this, "name", "NonError");
    __publicField(this, "value");
    this.value = value;
  }
};

// ../../node_modules/.pnpm/ky@2.0.2/node_modules/ky/distribution/errors/ForceRetryError.js
var ForceRetryError = class extends KyError {
  constructor(options) {
    const cause = options?.cause ? options.cause instanceof Error ? options.cause : new NonError(options.cause) : void 0;
    super(options?.code ? `Forced retry: ${options.code}` : "Forced retry", cause ? { cause } : void 0);
    __publicField(this, "name", "ForceRetryError");
    __publicField(this, "customDelay");
    __publicField(this, "code");
    __publicField(this, "customRequest");
    this.customDelay = options?.delay;
    this.code = options?.code;
    this.customRequest = options?.request;
  }
};

// ../../node_modules/.pnpm/ky@2.0.2/node_modules/ky/distribution/errors/SchemaValidationError.js
var SchemaValidationError = class extends Error {
  constructor(issues) {
    super("Response schema validation failed");
    __publicField(this, "name", "SchemaValidationError");
    __publicField(this, "issues");
    this.issues = issues;
  }
};

// ../../node_modules/.pnpm/ky@2.0.2/node_modules/ky/distribution/errors/TimeoutError.js
var TimeoutError = class extends KyError {
  constructor(request) {
    super(`Request timed out: ${request.method} ${request.url}`);
    __publicField(this, "name", "TimeoutError");
    __publicField(this, "request");
    this.request = request;
  }
};

// ../../node_modules/.pnpm/ky@2.0.2/node_modules/ky/distribution/core/constants.js
var supportsRequestStreams = (() => {
  let duplexAccessed = false;
  let hasContentType = false;
  const supportsReadableStream = typeof globalThis.ReadableStream === "function";
  const supportsRequest = typeof globalThis.Request === "function";
  if (supportsReadableStream && supportsRequest) {
    try {
      hasContentType = new globalThis.Request("https://empty.invalid", {
        body: new globalThis.ReadableStream(),
        method: "POST",
        // @ts-expect-error - Types are outdated.
        get duplex() {
          duplexAccessed = true;
          return "half";
        }
      }).headers.has("Content-Type");
    } catch (error) {
      if (error instanceof Error && error.message === "unsupported BodyInit type") {
        return false;
      }
      throw error;
    }
  }
  return duplexAccessed && !hasContentType;
})();
var supportsAbortController = typeof globalThis.AbortController === "function";
var supportsAbortSignal = typeof globalThis.AbortSignal === "function" && typeof globalThis.AbortSignal.any === "function";
var supportsResponseStreams = typeof globalThis.ReadableStream === "function";
var supportsFormData = typeof globalThis.FormData === "function";
var requestMethods = ["get", "post", "put", "patch", "head", "delete"];
var validate = () => void 0;
validate();
var responseTypes = {
  json: "application/json",
  text: "text/*",
  formData: "multipart/form-data",
  arrayBuffer: "*/*",
  blob: "*/*",
  // Supported in modern Fetch implementations (for example, browsers and recent Node.js/undici).
  // We still feature-check at runtime before exposing the shortcut.
  bytes: "*/*"
};
var maxSafeTimeout = 2147483647;
var usualFormBoundarySize = 40;
var stop = /* @__PURE__ */ Symbol("stop");
var RetryMarker = class {
  constructor(options) {
    __publicField(this, "options");
    this.options = options;
  }
};
var retry = (options) => new RetryMarker(options);
var kyOptionKeys = {
  json: true,
  parseJson: true,
  stringifyJson: true,
  searchParams: true,
  baseUrl: true,
  prefix: true,
  retry: true,
  timeout: true,
  totalTimeout: true,
  hooks: true,
  throwHttpErrors: true,
  onDownloadProgress: true,
  onUploadProgress: true,
  fetch: true,
  context: true
};
var requestOptionsRegistry = {
  method: true,
  headers: true,
  body: true,
  mode: true,
  credentials: true,
  cache: true,
  redirect: true,
  referrer: true,
  referrerPolicy: true,
  integrity: true,
  keepalive: true,
  signal: true,
  window: true,
  duplex: true
};

// ../../node_modules/.pnpm/ky@2.0.2/node_modules/ky/distribution/utils/body.js
var encoder = new TextEncoder();
var getBodySize = (body) => {
  if (!body) {
    return 0;
  }
  if (body instanceof FormData) {
    let size = 0;
    for (const [key, value] of body) {
      size += usualFormBoundarySize;
      size += encoder.encode(`Content-Disposition: form-data; name="${key}"`).byteLength;
      size += typeof value === "string" ? encoder.encode(value).byteLength : value.size;
    }
    return size;
  }
  if (body instanceof Blob) {
    return body.size;
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return body.byteLength;
  }
  if (typeof body === "string") {
    return encoder.encode(body).byteLength;
  }
  if (body instanceof URLSearchParams) {
    return encoder.encode(body.toString()).byteLength;
  }
  return 0;
};
var withProgress = (stream, totalBytes, onProgress) => {
  let previousChunk;
  let transferredBytes = 0;
  return stream.pipeThrough(new TransformStream({
    transform(currentChunk, controller) {
      controller.enqueue(currentChunk);
      if (previousChunk) {
        transferredBytes += previousChunk.byteLength;
        let percent = totalBytes === 0 ? 0 : transferredBytes / totalBytes;
        if (percent >= 1) {
          percent = 1 - Number.EPSILON;
        }
        onProgress?.({ percent, totalBytes: Math.max(totalBytes, transferredBytes), transferredBytes }, previousChunk);
      }
      previousChunk = currentChunk;
    },
    flush() {
      if (previousChunk) {
        transferredBytes += previousChunk.byteLength;
        onProgress?.({ percent: 1, totalBytes: Math.max(totalBytes, transferredBytes), transferredBytes }, previousChunk);
      }
    }
  }));
};
var streamResponse = (response, onDownloadProgress) => {
  if (!response.body) {
    return response;
  }
  const responseInit = {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  };
  if (response.status === 204) {
    return new Response(null, responseInit);
  }
  const totalBytes = Math.max(0, Number(response.headers.get("content-length")) || 0);
  return new Response(withProgress(response.body, totalBytes, onDownloadProgress), responseInit);
};
var streamRequest = (request, onUploadProgress, originalBody) => {
  if (!request.body) {
    return request;
  }
  const totalBytes = getBodySize(originalBody ?? request.body);
  return new Request(request, {
    // @ts-expect-error - Types are outdated.
    duplex: "half",
    body: withProgress(request.body, totalBytes, onUploadProgress)
  });
};

// ../../node_modules/.pnpm/ky@2.0.2/node_modules/ky/distribution/utils/is.js
var isObject = (value) => value !== null && typeof value === "object";

// ../../node_modules/.pnpm/ky@2.0.2/node_modules/ky/distribution/utils/merge.js
var replaceSymbol = /* @__PURE__ */ Symbol("replaceOption");
var getReplaceState = (value) => isObject(value) && value[replaceSymbol] === true ? {
  isReplace: true,
  value: value.value
} : {
  isReplace: false,
  value
};
var replaceOption = (value) => {
  const markedValue = { [replaceSymbol]: true, value };
  return markedValue;
};
var validateAndMerge = (...sources) => {
  for (const source of sources) {
    if ((!isObject(source) || Array.isArray(source)) && source !== void 0) {
      throw new TypeError("The `options` argument must be an object");
    }
  }
  return deepMerge({}, ...sources);
};
var mergeHeaders = (source1 = {}, source2 = {}) => {
  const result = new globalThis.Headers(source1);
  const isHeadersInstance = source2 instanceof globalThis.Headers;
  const source = new globalThis.Headers(source2);
  for (const [key, value] of source.entries()) {
    if (isHeadersInstance && value === "undefined" || value === void 0) {
      result.delete(key);
    } else {
      result.set(key, value);
    }
  }
  return result;
};
var isPlainObject = (value) => {
  if (!isObject(value) || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
var cloneShallow = (value) => {
  if (value instanceof URLSearchParams) {
    const copy = new URLSearchParams(value);
    const deleted = value[deletedParametersSymbol];
    if (deleted) {
      copy[deletedParametersSymbol] = new Set(deleted);
    }
    return copy;
  }
  if (value instanceof globalThis.Headers) {
    return new globalThis.Headers(value);
  }
  if (Array.isArray(value)) {
    return [...value];
  }
  if (isPlainObject(value)) {
    const copy = { ...value };
    return copy;
  }
  return value;
};
var normalizeHeaderObject = (headers) => Object.fromEntries(Object.entries(headers).filter((entry) => entry[1] !== void 0));
var mergeHeaderContainers = (source1, source2) => {
  if (isPlainObject(source1) && isPlainObject(source2)) {
    return normalizeHeaderObject({ ...source1, ...source2 });
  }
  return mergeHeaders(source1, source2);
};
function newHookValue(original, incoming, property) {
  return Object.hasOwn(incoming, property) && incoming[property] === void 0 ? [] : deepMerge(original[property] ?? [], incoming[property] ?? []);
}
var mergeHooks = (original = {}, incoming = {}) => ({
  init: newHookValue(original, incoming, "init"),
  beforeRequest: newHookValue(original, incoming, "beforeRequest"),
  beforeRetry: newHookValue(original, incoming, "beforeRetry"),
  beforeError: newHookValue(original, incoming, "beforeError"),
  afterResponse: newHookValue(original, incoming, "afterResponse")
});
var deletedParametersSymbol = /* @__PURE__ */ Symbol("deletedParameters");
var appendSearchParameters = (target, source) => {
  const result = new URLSearchParams();
  const deleted = /* @__PURE__ */ new Set();
  for (const input of [target, source]) {
    if (input === void 0) {
      continue;
    }
    if (input instanceof URLSearchParams) {
      for (const [key, value] of input.entries()) {
        result.append(key, value);
        deleted.delete(key);
      }
      const inputDeleted = input[deletedParametersSymbol];
      if (inputDeleted) {
        for (const key of inputDeleted) {
          result.delete(key);
          deleted.add(key);
        }
      }
    } else if (Array.isArray(input)) {
      for (const pair of input) {
        if (!Array.isArray(pair) || pair.length !== 2) {
          throw new TypeError("Array search parameters must be provided in [[key, value], ...] format");
        }
        result.append(String(pair[0]), String(pair[1]));
        deleted.delete(String(pair[0]));
      }
    } else if (isObject(input)) {
      for (const [key, value] of Object.entries(input)) {
        if (value === void 0) {
          result.delete(key);
          deleted.add(key);
        } else {
          result.append(key, String(value));
          deleted.delete(key);
        }
      }
    } else {
      const parameters = new URLSearchParams(input);
      for (const [key, value] of parameters.entries()) {
        result.append(key, value);
        deleted.delete(key);
      }
    }
  }
  if (deleted.size > 0) {
    result[deletedParametersSymbol] = deleted;
  }
  return result;
};
var deepMerge = (...sources) => {
  let returnValue = {};
  let headers = {};
  let hooks = {};
  let searchParameters;
  const signals = [];
  for (const source of sources) {
    if (Array.isArray(source)) {
      if (!Array.isArray(returnValue)) {
        returnValue = [];
      }
      returnValue = [...returnValue, ...source];
    } else if (isObject(source)) {
      for (let [key, value] of Object.entries(source)) {
        if (key === "signal" && value instanceof globalThis.AbortSignal) {
          signals.push(value);
          continue;
        }
        const replaceState = getReplaceState(value);
        const { isReplace } = replaceState;
        value = replaceState.value;
        if (key === "context") {
          if (value !== void 0 && value !== null && (!isObject(value) || Array.isArray(value))) {
            throw new TypeError("The `context` option must be an object");
          }
          returnValue = {
            ...returnValue,
            context: value === void 0 || value === null ? {} : isReplace ? { ...value } : { ...returnValue.context, ...value }
          };
          continue;
        }
        if (key === "searchParams") {
          if (value === void 0 || value === null) {
            searchParameters = void 0;
          } else if (isReplace) {
            searchParameters = value;
          } else {
            searchParameters = searchParameters === void 0 ? value : appendSearchParameters(searchParameters, value);
          }
          continue;
        }
        if (isObject(value) && !isReplace && key in returnValue) {
          value = deepMerge(returnValue[key], value);
        }
        returnValue = { ...returnValue, [key]: value };
      }
      if (isObject(source.hooks)) {
        const { value: hookValue, isReplace } = getReplaceState(source.hooks);
        hooks = isReplace ? mergeHooks({}, hookValue) : mergeHooks(hooks, hookValue);
        returnValue.hooks = hooks;
      }
      if (isObject(source.headers)) {
        const { value: headerValue, isReplace } = getReplaceState(source.headers);
        headers = isReplace ? cloneShallow(headerValue) : mergeHeaderContainers(headers, headerValue);
        returnValue.headers = headers;
      }
    }
  }
  if (searchParameters !== void 0) {
    returnValue.searchParams = searchParameters;
  }
  if (signals.length > 0) {
    if (signals.length === 1) {
      returnValue.signal = signals[0];
    } else if (supportsAbortSignal) {
      returnValue.signal = AbortSignal.any(signals);
    } else {
      returnValue.signal = signals.at(-1);
    }
  }
  return returnValue;
};

// ../../node_modules/.pnpm/ky@2.0.2/node_modules/ky/distribution/utils/normalize.js
var normalizeRequestMethod = (input) => requestMethods.includes(input) ? input.toUpperCase() : input;
var retryMethods = ["get", "put", "head", "delete", "options", "trace"];
var retryStatusCodes = [408, 413, 429, 500, 502, 503, 504];
var retryAfterStatusCodes = [413, 429, 503];
var defaultRetryOptions = {
  limit: 2,
  methods: retryMethods,
  statusCodes: retryStatusCodes,
  afterStatusCodes: retryAfterStatusCodes,
  maxRetryAfter: Number.POSITIVE_INFINITY,
  backoffLimit: Number.POSITIVE_INFINITY,
  delay: (attemptCount) => 0.3 * 2 ** (attemptCount - 1) * 1e3,
  jitter: void 0,
  retryOnTimeout: false
};
var normalizeRetryOptions = (retry2 = {}) => {
  if (typeof retry2 === "number") {
    return {
      ...defaultRetryOptions,
      limit: retry2
    };
  }
  if (retry2.methods && !Array.isArray(retry2.methods)) {
    throw new Error("retry.methods must be an array");
  }
  if (retry2.statusCodes && !Array.isArray(retry2.statusCodes)) {
    throw new Error("retry.statusCodes must be an array");
  }
  const normalizedRetry = Object.fromEntries(Object.entries({
    ...retry2,
    methods: retry2.methods?.map((method) => method.toLowerCase())
  }).filter(([, value]) => value !== void 0));
  return {
    ...defaultRetryOptions,
    ...normalizedRetry
  };
};

// ../../node_modules/.pnpm/ky@2.0.2/node_modules/ky/distribution/utils/timeout.js
async function timeout(request, init, abortController, options) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (abortController) {
        abortController.abort();
      }
      reject(new TimeoutError(request));
    }, options.timeout);
    void options.fetch(request, init).then(resolve).catch(reject).then(() => {
      clearTimeout(timeoutId);
    });
  });
}

// ../../node_modules/.pnpm/ky@2.0.2/node_modules/ky/distribution/utils/delay.js
async function delay(ms, { signal }) {
  return new Promise((resolve, reject) => {
    if (signal) {
      signal.throwIfAborted();
      signal.addEventListener("abort", abortHandler, { once: true });
    }
    function abortHandler() {
      clearTimeout(timeoutId);
      reject(signal.reason);
    }
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", abortHandler);
      resolve();
    }, ms);
  });
}

// ../../node_modules/.pnpm/ky@2.0.2/node_modules/ky/distribution/utils/options.js
var findUnknownOptions = (options) => {
  const unknownOptions = {};
  for (const key in options) {
    if (!Object.hasOwn(options, key)) {
      continue;
    }
    if (!(key in requestOptionsRegistry) && !(key in kyOptionKeys)) {
      unknownOptions[key] = options[key];
    }
  }
  return unknownOptions;
};
var hasSearchParameters = (search) => {
  if (search === void 0) {
    return false;
  }
  if (Array.isArray(search)) {
    return search.length > 0;
  }
  if (search instanceof URLSearchParams) {
    return search.size > 0 || Boolean(search[deletedParametersSymbol]?.size);
  }
  if (typeof search === "object") {
    return Object.keys(search).length > 0;
  }
  if (typeof search === "string") {
    return search.trim().length > 0;
  }
  return Boolean(search);
};

// ../../node_modules/.pnpm/ky@2.0.2/node_modules/ky/distribution/utils/is-network-error.js
var objectToString = Object.prototype.toString;
var isError = (value) => objectToString.call(value) === "[object Error]";
var errorMessages = /* @__PURE__ */ new Set([
  "network error",
  // Chrome
  "NetworkError when attempting to fetch resource.",
  // Firefox
  "The Internet connection appears to be offline.",
  // Safari 16
  "Network request failed",
  // `cross-fetch`
  "fetch failed",
  // Undici (Node.js)
  "terminated",
  // Undici (Node.js)
  " A network error occurred.",
  // Bun (WebKit) - leading space is intentional
  "Network connection lost"
  // Cloudflare Workers (fetch)
]);
function isRawNetworkError(error) {
  const isValid = error && isError(error) && error.name === "TypeError" && typeof error.message === "string";
  if (!isValid) {
    return false;
  }
  const { message, stack } = error;
  if (message === "Load failed") {
    return stack === void 0 || "__sentry_captured__" in error;
  }
  if (message.startsWith("error sending request for url")) {
    return true;
  }
  if (message === "Failed to fetch" || message.startsWith("Failed to fetch (") && message.endsWith(")")) {
    return true;
  }
  return errorMessages.has(message);
}

// ../../node_modules/.pnpm/ky@2.0.2/node_modules/ky/distribution/utils/type-guards.js
var isErrorType = (error, cls) => error instanceof cls || error?.name === cls.name;
function isKyError(error) {
  return error?.isKyError === true || isHTTPError(error) || isNetworkError(error) || isTimeoutError(error) || isForceRetryError(error);
}
function isHTTPError(error) {
  return isErrorType(error, HTTPError);
}
function isNetworkError(error) {
  return isErrorType(error, NetworkError);
}
function isTimeoutError(error) {
  return isErrorType(error, TimeoutError);
}
function isForceRetryError(error) {
  return isErrorType(error, ForceRetryError);
}

// ../../node_modules/.pnpm/ky@2.0.2/node_modules/ky/distribution/core/Ky.js
var maxErrorResponseBodySize = 10 * 1024 * 1024;
var prefixUrlRenamedErrorMessage = "The `prefixUrl` option has been renamed `prefix` in v2 and enhanced to allow slashes in input. See also the new `baseUrl` option for improved flexibility with standard URL resolution: https://github.com/sindresorhus/ky#baseurl";
var timedOutResponseData = /* @__PURE__ */ Symbol("timedOutResponseData");
var createTextDecoder = (contentType) => {
  const match = /;\s*charset\s*=\s*(?:"([^"]+)"|([^;,\s]+))/i.exec(contentType);
  const charset = match?.[1] ?? match?.[2];
  if (charset) {
    try {
      return new TextDecoder(charset);
    } catch {
    }
  }
  return new TextDecoder();
};
var invalidSchemaMessage = "The `schema` argument must follow the Standard Schema specification";
var cloneRetryOptions = (retry2) => {
  if (typeof retry2 !== "object") {
    return retry2;
  }
  return {
    ...retry2,
    ...retry2.methods && { methods: [...retry2.methods] },
    ...retry2.statusCodes && { statusCodes: [...retry2.statusCodes] },
    ...retry2.afterStatusCodes && { afterStatusCodes: [...retry2.afterStatusCodes] }
  };
};
var objectToString2 = Object.prototype.toString;
var isRequestInstance = (value) => value instanceof globalThis.Request || objectToString2.call(value) === "[object Request]";
var isResponseInstance = (value) => value instanceof globalThis.Response || objectToString2.call(value) === "[object Response]";
var cloneSearchParametersForInitHook = (searchParameters) => {
  if (Array.isArray(searchParameters)) {
    return searchParameters.map((parameter) => [...parameter]);
  }
  return cloneShallow(searchParameters);
};
function cloneInitHookOptions(options) {
  const clonedOptions = {
    ...options,
    json: cloneShallow(options.json),
    context: cloneShallow(options.context),
    headers: cloneShallow(options.headers),
    searchParams: cloneSearchParametersForInitHook(options.searchParams)
  };
  if (options.retry !== void 0) {
    clonedOptions.retry = cloneRetryOptions(options.retry);
  }
  return clonedOptions;
}
var validateJsonWithSchema = async (jsonValue, schema) => {
  if (typeof schema !== "object" && typeof schema !== "function" || schema === null) {
    throw new TypeError(invalidSchemaMessage);
  }
  const standardSchema = schema["~standard"];
  if (typeof standardSchema !== "object" || standardSchema === null || typeof standardSchema.validate !== "function") {
    throw new TypeError(invalidSchemaMessage);
  }
  const validationResult = await standardSchema.validate(jsonValue);
  if (validationResult.issues) {
    throw new SchemaValidationError(validationResult.issues);
  }
  return validationResult.value;
};
var _Ky_static, normalizeSearchParams_fn, _abortController, _retryCount, _input, _options, _originalRequest, _userProvidedAbortSignal, _beforeRetryHookErrors, _cachedNormalizedOptions, _startTime, _returnedResponseFromBeforeRetryHook, _responseRequests, _Ky_instances, calculateDelay_fn, calculateRetryDelay_fn, decorateResponse_fn, getResponseData_fn, getErrorDataTimeout_fn, isJsonContentType_fn, readResponseText_fn, parseJson_fn, cancelBody_fn, cancelResponseBody_fn, createManagedSignal_fn, throwIfTotalTimeoutExhausted_fn, runBeforeRequestHooks_fn, runAfterResponseHooks_fn, retry_fn, retryFromError_fn, consumeReturnedResponseFromBeforeRetryHook_fn, fetch_fn, getRemainingTotalTimeout_fn, getCurrentTime_fn, getNormalizedOptions_fn, assignRequest_fn, getResponseRequest_fn, setResponseRequest_fn, wrapRequestWithUploadProgress_fn;
var _Ky = class _Ky {
  // eslint-disable-next-line complexity
  constructor(input, options = {}) {
    __privateAdd(this, _Ky_instances);
    __publicField(this, "request");
    __privateAdd(this, _abortController);
    __privateAdd(this, _retryCount, 0);
    // eslint-disable-next-line @typescript-eslint/prefer-readonly -- False positive: #input is reassigned on line 202
    __privateAdd(this, _input);
    __privateAdd(this, _options);
    __privateAdd(this, _originalRequest);
    __privateAdd(this, _userProvidedAbortSignal);
    __privateAdd(this, _beforeRetryHookErrors, /* @__PURE__ */ new WeakSet());
    __privateAdd(this, _cachedNormalizedOptions);
    __privateAdd(this, _startTime);
    __privateAdd(this, _returnedResponseFromBeforeRetryHook, false);
    __privateAdd(this, _responseRequests, /* @__PURE__ */ new WeakMap());
    var _a;
    __privateSet(this, _input, input);
    if (Object.hasOwn(options, "prefixUrl")) {
      throw new Error(prefixUrlRenamedErrorMessage);
    }
    __privateSet(this, _options, {
      ...options,
      headers: mergeHeaders(__privateGet(this, _input).headers, options.headers),
      hooks: mergeHooks({}, options.hooks),
      method: normalizeRequestMethod(options.method ?? __privateGet(this, _input).method ?? "GET"),
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      prefix: String(options.prefix || ""),
      retry: normalizeRetryOptions(options.retry),
      throwHttpErrors: options.throwHttpErrors ?? true,
      timeout: options.timeout ?? 1e4,
      totalTimeout: options.totalTimeout ?? false,
      fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
      context: options.context ?? {}
    });
    if (typeof __privateGet(this, _input) !== "string" && !(__privateGet(this, _input) instanceof URL || __privateGet(this, _input) instanceof globalThis.Request)) {
      throw new TypeError("`input` must be a string, URL, or Request");
    }
    if (typeof __privateGet(this, _input) === "string") {
      if (__privateGet(this, _options).prefix) {
        const normalizedPrefix = __privateGet(this, _options).prefix.replace(/\/+$/, "");
        const normalizedInput = __privateGet(this, _input).replace(/^\/+/, "");
        __privateSet(this, _input, `${normalizedPrefix}/${normalizedInput}`);
      }
      if (__privateGet(this, _options).baseUrl) {
        let absoluteInput;
        try {
          absoluteInput = new URL(__privateGet(this, _input));
        } catch {
        }
        if (!absoluteInput) {
          __privateSet(this, _input, new URL(__privateGet(this, _input), new Request(__privateGet(this, _options).baseUrl).url));
        }
      }
    }
    if (supportsAbortController && supportsAbortSignal) {
      __privateSet(this, _userProvidedAbortSignal, __privateGet(this, _options).signal ?? __privateGet(this, _input).signal);
      __privateSet(this, _abortController, new globalThis.AbortController());
      __privateGet(this, _options).signal = __privateMethod(this, _Ky_instances, createManagedSignal_fn).call(this);
    }
    if (supportsRequestStreams) {
      __privateGet(this, _options).duplex = "half";
    }
    if (__privateGet(this, _options).json !== void 0) {
      __privateGet(this, _options).body = __privateGet(this, _options).stringifyJson?.(__privateGet(this, _options).json) ?? JSON.stringify(__privateGet(this, _options).json);
      __privateGet(this, _options).headers.set("content-type", __privateGet(this, _options).headers.get("content-type") ?? "application/json");
    }
    const userProvidedContentType = options.headers && new globalThis.Headers(options.headers).has("content-type");
    if (__privateGet(this, _input) instanceof globalThis.Request && (supportsFormData && __privateGet(this, _options).body instanceof globalThis.FormData || __privateGet(this, _options).body instanceof URLSearchParams) && !userProvidedContentType) {
      __privateGet(this, _options).headers.delete("content-type");
    }
    this.request = new globalThis.Request(__privateGet(this, _input), __privateGet(this, _options));
    if (hasSearchParameters(__privateGet(this, _options).searchParams)) {
      const url = new URL(this.request.url);
      const deleted = __privateGet(this, _options).searchParams?.[deletedParametersSymbol];
      if (deleted) {
        for (const key of deleted) {
          url.searchParams.delete(key);
        }
      }
      if (typeof __privateGet(this, _options).searchParams === "string") {
        const stringSearchParameters = __privateGet(this, _options).searchParams.replace(/^\?/, "");
        if (stringSearchParameters !== "") {
          url.search = url.search ? `${url.search}&${stringSearchParameters}` : `?${stringSearchParameters}`;
        }
      } else {
        const optionsSearchParameters = new URLSearchParams(__privateMethod(_a = _Ky, _Ky_static, normalizeSearchParams_fn).call(_a, __privateGet(this, _options).searchParams));
        for (const [key, value] of optionsSearchParameters.entries()) {
          url.searchParams.append(key, value);
        }
      }
      if (__privateGet(this, _options).searchParams && typeof __privateGet(this, _options).searchParams === "object" && !Array.isArray(__privateGet(this, _options).searchParams) && !(__privateGet(this, _options).searchParams instanceof URLSearchParams)) {
        for (const [key, value] of Object.entries(__privateGet(this, _options).searchParams)) {
          if (value === void 0) {
            url.searchParams.delete(key);
          }
        }
      }
      this.request = new globalThis.Request(url, __privateGet(this, _options));
    }
    if (__privateGet(this, _options).onUploadProgress && typeof __privateGet(this, _options).onUploadProgress !== "function") {
      throw new TypeError("The `onUploadProgress` option must be a function");
    }
    __privateSet(this, _startTime, typeof __privateGet(this, _options).totalTimeout === "number" ? __privateMethod(this, _Ky_instances, getCurrentTime_fn).call(this) : void 0);
  }
  static create(input, options) {
    const initHooks = options.hooks?.init ?? [];
    const initHookOptions = initHooks.length > 0 ? cloneInitHookOptions(options) : options;
    for (const hook of initHooks) {
      hook(initHookOptions);
    }
    const ky2 = new _Ky(input, initHookOptions);
    const function_ = async () => {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m;
      if (typeof __privateGet(ky2, _options).timeout === "number" && __privateGet(ky2, _options).timeout > maxSafeTimeout) {
        throw new RangeError(`The \`timeout\` option cannot be greater than ${maxSafeTimeout}`);
      }
      if (typeof __privateGet(ky2, _options).totalTimeout === "number" && __privateGet(ky2, _options).totalTimeout > maxSafeTimeout) {
        throw new RangeError(`The \`totalTimeout\` option cannot be greater than ${maxSafeTimeout}`);
      }
      await Promise.resolve();
      const beforeRequestResponse = await __privateMethod(_a = ky2, _Ky_instances, runBeforeRequestHooks_fn).call(_a);
      let response = beforeRequestResponse ?? await __privateMethod(_b = ky2, _Ky_instances, retry_fn).call(_b, async () => {
        var _a2;
        return __privateMethod(_a2 = ky2, _Ky_instances, fetch_fn).call(_a2);
      });
      let responseFromHook = beforeRequestResponse !== void 0 || __privateMethod(_c = ky2, _Ky_instances, consumeReturnedResponseFromBeforeRetryHook_fn).call(_c);
      for (; ; ) {
        if (response === void 0) {
          return response;
        }
        if (isResponseInstance(response)) {
          try {
            response = await __privateMethod(_d = ky2, _Ky_instances, runAfterResponseHooks_fn).call(_d, response);
          } catch (error) {
            if (!(error instanceof ForceRetryError)) {
              throw error;
            }
            const retriedResponse = await __privateMethod(_e = ky2, _Ky_instances, retryFromError_fn).call(_e, error, async () => {
              var _a2;
              return __privateMethod(_a2 = ky2, _Ky_instances, fetch_fn).call(_a2);
            });
            if (retriedResponse === void 0) {
              return retriedResponse;
            }
            response = retriedResponse;
            responseFromHook = __privateMethod(_f = ky2, _Ky_instances, consumeReturnedResponseFromBeforeRetryHook_fn).call(_f);
            continue;
          }
        }
        const currentResponse = response;
        if (!currentResponse.ok && currentResponse.type !== "opaque" && (typeof __privateGet(ky2, _options).throwHttpErrors === "function" ? __privateGet(ky2, _options).throwHttpErrors(currentResponse.status) : __privateGet(ky2, _options).throwHttpErrors)) {
          const httpError = new HTTPError(currentResponse, __privateMethod(_g = ky2, _Ky_instances, getResponseRequest_fn).call(_g, currentResponse), __privateMethod(_h = ky2, _Ky_instances, getNormalizedOptions_fn).call(_h));
          const errorToThrow = httpError;
          httpError.data = await __privateMethod(_i = ky2, _Ky_instances, getResponseData_fn).call(_i, currentResponse);
          if (responseFromHook) {
            throw errorToThrow;
          }
          const retriedResponse = await __privateMethod(_j = ky2, _Ky_instances, retryFromError_fn).call(_j, httpError, async () => {
            var _a2;
            return __privateMethod(_a2 = ky2, _Ky_instances, fetch_fn).call(_a2);
          });
          if (retriedResponse === void 0) {
            return retriedResponse;
          }
          response = retriedResponse;
          responseFromHook = __privateMethod(_k = ky2, _Ky_instances, consumeReturnedResponseFromBeforeRetryHook_fn).call(_k);
          continue;
        }
        break;
      }
      if (!isResponseInstance(response)) {
        return response;
      }
      __privateMethod(_l = ky2, _Ky_instances, decorateResponse_fn).call(_l, response);
      if (__privateGet(ky2, _options).onDownloadProgress) {
        if (typeof __privateGet(ky2, _options).onDownloadProgress !== "function") {
          throw new TypeError("The `onDownloadProgress` option must be a function");
        }
        if (!supportsResponseStreams) {
          throw new Error("Streams are not supported in your environment. `ReadableStream` is missing.");
        }
        const progressResponse = response.clone();
        __privateMethod(_m = ky2, _Ky_instances, cancelResponseBody_fn).call(_m, response);
        return streamResponse(progressResponse, __privateGet(ky2, _options).onDownloadProgress);
      }
      return response;
    };
    const result = (async () => {
      var _a, _b, _c;
      try {
        return await function_();
      } catch (error) {
        if (!(error instanceof Error)) {
          throw error;
        }
        if (__privateGet(ky2, _beforeRetryHookErrors).has(error)) {
          throw error;
        }
        let processedError = error;
        for (const hook of __privateGet(ky2, _options).hooks.beforeError) {
          const hookResult = await hook({
            request: ky2.request,
            options: __privateMethod(_a = ky2, _Ky_instances, getNormalizedOptions_fn).call(_a),
            error: processedError,
            retryCount: __privateGet(ky2, _retryCount)
          });
          if (hookResult instanceof Error) {
            processedError = hookResult;
          }
        }
        throw processedError;
      } finally {
        const originalRequest = __privateGet(ky2, _originalRequest);
        __privateMethod(_b = ky2, _Ky_instances, cancelBody_fn).call(_b, originalRequest?.body ?? void 0);
        if (ky2.request !== originalRequest) {
          __privateMethod(_c = ky2, _Ky_instances, cancelBody_fn).call(_c, ky2.request.body ?? void 0);
        }
      }
    })();
    for (const [type, mimeType] of Object.entries(responseTypes)) {
      if (type === "bytes" && typeof globalThis.Response?.prototype?.bytes !== "function") {
        continue;
      }
      result[type] = async (schema) => {
        var _a;
        ky2.request.headers.set("accept", ky2.request.headers.get("accept") || mimeType);
        const response = await result;
        if (type !== "json") {
          return response[type]();
        }
        const text = await response.text();
        if (text === "") {
          if (schema !== void 0) {
            return validateJsonWithSchema(void 0, schema);
          }
          return JSON.parse(text);
        }
        const jsonValue = initHookOptions.parseJson ? await initHookOptions.parseJson(text, { request: __privateMethod(_a = ky2, _Ky_instances, getResponseRequest_fn).call(_a, response), response }) : JSON.parse(text);
        return schema === void 0 ? jsonValue : validateJsonWithSchema(jsonValue, schema);
      };
    }
    return result;
  }
};
_Ky_static = new WeakSet();
normalizeSearchParams_fn = function(searchParams) {
  if (searchParams && typeof searchParams === "object" && !Array.isArray(searchParams) && !(searchParams instanceof URLSearchParams)) {
    return Object.fromEntries(Object.entries(searchParams).filter(([, value]) => value !== void 0));
  }
  return searchParams;
};
_abortController = new WeakMap();
_retryCount = new WeakMap();
_input = new WeakMap();
_options = new WeakMap();
_originalRequest = new WeakMap();
_userProvidedAbortSignal = new WeakMap();
_beforeRetryHookErrors = new WeakMap();
_cachedNormalizedOptions = new WeakMap();
_startTime = new WeakMap();
_returnedResponseFromBeforeRetryHook = new WeakMap();
_responseRequests = new WeakMap();
_Ky_instances = new WeakSet();
calculateDelay_fn = function() {
  const retryDelay = __privateGet(this, _options).retry.delay(__privateGet(this, _retryCount) + 1);
  let jitteredDelay = retryDelay;
  if (__privateGet(this, _options).retry.jitter === true) {
    jitteredDelay = Math.random() * retryDelay;
  } else if (typeof __privateGet(this, _options).retry.jitter === "function") {
    jitteredDelay = __privateGet(this, _options).retry.jitter(retryDelay);
    if (!Number.isFinite(jitteredDelay) || jitteredDelay < 0) {
      jitteredDelay = retryDelay;
    }
  }
  return Math.min(__privateGet(this, _options).retry.backoffLimit, jitteredDelay);
};
calculateRetryDelay_fn = async function(error) {
  if (__privateGet(this, _retryCount) >= __privateGet(this, _options).retry.limit) {
    throw error;
  }
  const errorObject = error instanceof Error ? error : new NonError(error);
  if (errorObject instanceof ForceRetryError) {
    return errorObject.customDelay ?? __privateMethod(this, _Ky_instances, calculateDelay_fn).call(this);
  }
  if (!__privateGet(this, _options).retry.methods.includes(this.request.method.toLowerCase())) {
    throw error;
  }
  if (__privateGet(this, _options).retry.shouldRetry !== void 0) {
    const result = await __privateGet(this, _options).retry.shouldRetry({ error: errorObject, retryCount: __privateGet(this, _retryCount) + 1 });
    if (result === false) {
      throw error;
    }
    if (result === true) {
      return __privateMethod(this, _Ky_instances, calculateDelay_fn).call(this);
    }
  }
  if (isTimeoutError(error)) {
    if (!__privateGet(this, _options).retry.retryOnTimeout) {
      throw error;
    }
    return __privateMethod(this, _Ky_instances, calculateDelay_fn).call(this);
  }
  if (isHTTPError(error)) {
    if (!__privateGet(this, _options).retry.statusCodes.includes(error.response.status)) {
      throw error;
    }
    const retryAfter = error.response.headers.get("Retry-After") ?? error.response.headers.get("RateLimit-Reset") ?? error.response.headers.get("X-RateLimit-Retry-After") ?? error.response.headers.get("X-RateLimit-Reset") ?? error.response.headers.get("X-Rate-Limit-Reset");
    if (retryAfter && __privateGet(this, _options).retry.afterStatusCodes.includes(error.response.status)) {
      let after = Number(retryAfter) * 1e3;
      if (Number.isNaN(after)) {
        after = Date.parse(retryAfter) - Date.now();
      } else if (after >= Date.parse("2024-01-01")) {
        after -= Date.now();
      }
      if (!Number.isFinite(after)) {
        return Math.min(__privateGet(this, _options).retry.maxRetryAfter, __privateMethod(this, _Ky_instances, calculateDelay_fn).call(this));
      }
      after = Math.max(0, after);
      return Math.min(__privateGet(this, _options).retry.maxRetryAfter, after);
    }
    if (error.response.status === 413) {
      throw error;
    }
    return __privateMethod(this, _Ky_instances, calculateDelay_fn).call(this);
  }
  if (!isNetworkError(error)) {
    throw error;
  }
  return __privateMethod(this, _Ky_instances, calculateDelay_fn).call(this);
};
decorateResponse_fn = function(response) {
  const request = __privateMethod(this, _Ky_instances, getResponseRequest_fn).call(this, response);
  if (__privateGet(this, _options).parseJson) {
    response.json = async () => {
      const text = await response.text();
      if (text === "") {
        return JSON.parse(text);
      }
      return __privateGet(this, _options).parseJson(text, { request, response });
    };
  }
  return response;
};
getResponseData_fn = async function(response) {
  const text = await __privateMethod(this, _Ky_instances, readResponseText_fn).call(this, response, __privateMethod(this, _Ky_instances, getErrorDataTimeout_fn).call(this));
  if (text === timedOutResponseData) {
    __privateMethod(this, _Ky_instances, throwIfTotalTimeoutExhausted_fn).call(this);
    return void 0;
  }
  if (!text) {
    return void 0;
  }
  if (!__privateMethod(this, _Ky_instances, isJsonContentType_fn).call(this, response.headers.get("content-type") ?? "")) {
    return text;
  }
  const data = await __privateMethod(this, _Ky_instances, parseJson_fn).call(this, text, response, __privateMethod(this, _Ky_instances, getErrorDataTimeout_fn).call(this), __privateMethod(this, _Ky_instances, getResponseRequest_fn).call(this, response));
  if (data === timedOutResponseData) {
    __privateMethod(this, _Ky_instances, throwIfTotalTimeoutExhausted_fn).call(this);
    return void 0;
  }
  return data;
};
getErrorDataTimeout_fn = function() {
  const errorDataTimeout = __privateGet(this, _options).timeout === false ? 1e4 : __privateGet(this, _options).timeout;
  const remainingTotal = __privateMethod(this, _Ky_instances, getRemainingTotalTimeout_fn).call(this);
  if (remainingTotal === void 0) {
    return errorDataTimeout;
  }
  if (remainingTotal <= 0) {
    throw new TimeoutError(this.request);
  }
  return Math.min(errorDataTimeout, remainingTotal);
};
isJsonContentType_fn = function(contentType) {
  const mimeType = (contentType.split(";", 1)[0] ?? "").trim().toLowerCase();
  return /\/(?:.*[.+-])?json$/.test(mimeType);
};
readResponseText_fn = async function(response, timeoutMs) {
  const { body } = response;
  if (!body) {
    try {
      return await response.text();
    } catch {
      return void 0;
    }
  }
  let reader;
  try {
    reader = body.getReader();
  } catch {
    return void 0;
  }
  const decoder = createTextDecoder(response.headers.get("content-type") ?? "");
  const chunks = [];
  let totalBytes = 0;
  const readAll = (async () => {
    try {
      for (; ; ) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        totalBytes += value.byteLength;
        if (totalBytes > maxErrorResponseBodySize) {
          void reader.cancel().catch(() => void 0);
          return void 0;
        }
        chunks.push(decoder.decode(value, { stream: true }));
      }
    } catch {
      return void 0;
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  })();
  const timeoutPromise = new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      resolve(timedOutResponseData);
    }, timeoutMs);
    void readAll.finally(() => {
      clearTimeout(timeoutId);
    });
  });
  const result = await Promise.race([readAll, timeoutPromise]);
  if (result === timedOutResponseData) {
    void reader.cancel().catch(() => void 0);
  }
  return result;
};
parseJson_fn = async function(text, response, timeoutMs, request) {
  let timeoutId;
  try {
    return await Promise.race([
      Promise.resolve().then(() => __privateGet(this, _options).parseJson ? __privateGet(this, _options).parseJson(text, { request, response }) : JSON.parse(text)),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => {
          resolve(timedOutResponseData);
        }, timeoutMs);
      })
    ]);
  } catch {
    return void 0;
  } finally {
    clearTimeout(timeoutId);
  }
};
cancelBody_fn = function(body) {
  if (!body) {
    return;
  }
  void body.cancel().catch(() => void 0);
};
cancelResponseBody_fn = function(response) {
  __privateMethod(this, _Ky_instances, cancelBody_fn).call(this, response.body ?? void 0);
};
createManagedSignal_fn = function() {
  return __privateGet(this, _userProvidedAbortSignal) ? AbortSignal.any([__privateGet(this, _userProvidedAbortSignal), __privateGet(this, _abortController).signal]) : __privateGet(this, _abortController).signal;
};
throwIfTotalTimeoutExhausted_fn = function() {
  const remaining = __privateMethod(this, _Ky_instances, getRemainingTotalTimeout_fn).call(this);
  if (remaining !== void 0 && remaining <= 0) {
    throw new TimeoutError(this.request);
  }
};
runBeforeRequestHooks_fn = async function() {
  for (const hook of __privateGet(this, _options).hooks.beforeRequest) {
    const result = await hook({
      request: this.request,
      options: __privateMethod(this, _Ky_instances, getNormalizedOptions_fn).call(this),
      retryCount: 0
    });
    if (isRequestInstance(result)) {
      __privateMethod(this, _Ky_instances, assignRequest_fn).call(this, result);
    } else if (isResponseInstance(result)) {
      return result;
    }
  }
  return void 0;
};
runAfterResponseHooks_fn = async function(response) {
  const responseRequest = __privateMethod(this, _Ky_instances, getResponseRequest_fn).call(this, response);
  for (const hook of __privateGet(this, _options).hooks.afterResponse) {
    const hookResponse = __privateMethod(this, _Ky_instances, setResponseRequest_fn).call(this, response.clone(), responseRequest);
    __privateMethod(this, _Ky_instances, decorateResponse_fn).call(this, hookResponse);
    let modifiedResponse;
    try {
      modifiedResponse = await hook({
        request: this.request,
        options: __privateMethod(this, _Ky_instances, getNormalizedOptions_fn).call(this),
        response: hookResponse,
        retryCount: __privateGet(this, _retryCount)
      });
    } catch (error) {
      if (hookResponse !== response) {
        __privateMethod(this, _Ky_instances, cancelResponseBody_fn).call(this, hookResponse);
      }
      __privateMethod(this, _Ky_instances, cancelResponseBody_fn).call(this, response);
      throw error;
    }
    if (modifiedResponse instanceof RetryMarker) {
      if (hookResponse !== response) {
        __privateMethod(this, _Ky_instances, cancelResponseBody_fn).call(this, hookResponse);
      }
      __privateMethod(this, _Ky_instances, cancelResponseBody_fn).call(this, response);
      throw new ForceRetryError(modifiedResponse.options);
    }
    const nextResponse = isResponseInstance(modifiedResponse) ? __privateMethod(this, _Ky_instances, setResponseRequest_fn).call(this, modifiedResponse, responseRequest) : response;
    if (hookResponse !== response && hookResponse !== nextResponse && hookResponse.body !== nextResponse.body) {
      __privateMethod(this, _Ky_instances, cancelResponseBody_fn).call(this, hookResponse);
    }
    if (response !== nextResponse && response.body !== nextResponse.body) {
      __privateMethod(this, _Ky_instances, cancelResponseBody_fn).call(this, response);
    }
    response = nextResponse;
  }
  return response;
};
retry_fn = async function(function_) {
  try {
    return await function_();
  } catch (error) {
    return __privateMethod(this, _Ky_instances, retryFromError_fn).call(this, error, function_);
  }
};
retryFromError_fn = async function(error, function_) {
  __privateSet(this, _returnedResponseFromBeforeRetryHook, false);
  const retryDelay = Math.min(await __privateMethod(this, _Ky_instances, calculateRetryDelay_fn).call(this, error), maxSafeTimeout);
  const delayOptions = { signal: __privateGet(this, _userProvidedAbortSignal) };
  const remainingTimeout = __privateMethod(this, _Ky_instances, getRemainingTotalTimeout_fn).call(this);
  if (remainingTimeout !== void 0) {
    if (remainingTimeout <= 0) {
      throw new TimeoutError(this.request);
    }
    if (retryDelay >= remainingTimeout) {
      await delay(remainingTimeout, delayOptions);
      throw new TimeoutError(this.request);
    }
  }
  await delay(retryDelay, delayOptions);
  __privateMethod(this, _Ky_instances, throwIfTotalTimeoutExhausted_fn).call(this);
  if (error instanceof ForceRetryError && error.customRequest) {
    const customRequest = new globalThis.Request(error.customRequest, __privateGet(this, _options).signal ? { signal: __privateGet(this, _options).signal } : void 0);
    __privateMethod(this, _Ky_instances, assignRequest_fn).call(this, customRequest);
  }
  for (const hook of __privateGet(this, _options).hooks.beforeRetry) {
    let hookResult;
    try {
      hookResult = await hook({
        request: this.request,
        options: __privateMethod(this, _Ky_instances, getNormalizedOptions_fn).call(this),
        error,
        retryCount: __privateGet(this, _retryCount) + 1
      });
    } catch (hookError) {
      if (hookError instanceof Error && hookError !== error) {
        __privateGet(this, _beforeRetryHookErrors).add(hookError);
      }
      throw hookError;
    }
    if (isRequestInstance(hookResult)) {
      __privateMethod(this, _Ky_instances, assignRequest_fn).call(this, hookResult);
      break;
    }
    if (isResponseInstance(hookResult)) {
      __privateSet(this, _returnedResponseFromBeforeRetryHook, true);
      __privateWrapper(this, _retryCount)._++;
      return hookResult;
    }
    if (hookResult === stop) {
      return;
    }
  }
  __privateMethod(this, _Ky_instances, throwIfTotalTimeoutExhausted_fn).call(this);
  __privateWrapper(this, _retryCount)._++;
  return __privateMethod(this, _Ky_instances, retry_fn).call(this, function_);
};
consumeReturnedResponseFromBeforeRetryHook_fn = function() {
  const value = __privateGet(this, _returnedResponseFromBeforeRetryHook);
  __privateSet(this, _returnedResponseFromBeforeRetryHook, false);
  return value;
};
fetch_fn = async function() {
  if (__privateGet(this, _abortController)?.signal.aborted) {
    __privateSet(this, _abortController, new globalThis.AbortController());
    __privateGet(this, _options).signal = __privateMethod(this, _Ky_instances, createManagedSignal_fn).call(this);
    this.request = new globalThis.Request(this.request, { signal: __privateGet(this, _options).signal });
  }
  const nonRequestOptions = findUnknownOptions(__privateGet(this, _options));
  const retryRequest = __privateGet(this, _options).retry.limit > 0 ? this.request.clone() : void 0;
  const request = __privateMethod(this, _Ky_instances, wrapRequestWithUploadProgress_fn).call(this, this.request, __privateGet(this, _options).body ?? void 0);
  __privateSet(this, _originalRequest, request);
  if (retryRequest) {
    this.request = retryRequest;
  }
  try {
    const remainingTotal = __privateMethod(this, _Ky_instances, getRemainingTotalTimeout_fn).call(this);
    if (remainingTotal !== void 0 && remainingTotal <= 0) {
      throw new TimeoutError(this.request);
    }
    const effectiveTimeout = __privateGet(this, _options).timeout === false ? remainingTotal : remainingTotal === void 0 ? __privateGet(this, _options).timeout : Math.min(__privateGet(this, _options).timeout, remainingTotal);
    const response = effectiveTimeout === void 0 ? await __privateGet(this, _options).fetch(request, nonRequestOptions) : await timeout(request, nonRequestOptions, __privateGet(this, _abortController), {
      timeout: effectiveTimeout,
      fetch: __privateGet(this, _options).fetch
    });
    return __privateMethod(this, _Ky_instances, setResponseRequest_fn).call(this, response, request);
  } catch (error) {
    if (isRawNetworkError(error)) {
      throw new NetworkError(this.request, { cause: error });
    }
    throw error;
  }
};
getRemainingTotalTimeout_fn = function() {
  if (__privateGet(this, _startTime) === void 0) {
    return void 0;
  }
  const elapsed = __privateMethod(this, _Ky_instances, getCurrentTime_fn).call(this) - __privateGet(this, _startTime);
  return Math.max(0, __privateGet(this, _options).totalTimeout - elapsed);
};
getCurrentTime_fn = function() {
  return globalThis.performance?.now() ?? Date.now();
};
getNormalizedOptions_fn = function() {
  if (!__privateGet(this, _cachedNormalizedOptions)) {
    const { hooks, json, parseJson, stringifyJson, searchParams, timeout: timeout2, totalTimeout, throwHttpErrors, fetch, ...normalizedOptions } = __privateGet(this, _options);
    __privateSet(this, _cachedNormalizedOptions, Object.freeze(normalizedOptions));
  }
  return __privateGet(this, _cachedNormalizedOptions);
};
assignRequest_fn = function(request) {
  __privateSet(this, _cachedNormalizedOptions, void 0);
  this.request = request;
};
getResponseRequest_fn = function(response) {
  return __privateGet(this, _responseRequests).get(response) ?? this.request;
};
setResponseRequest_fn = function(response, request) {
  __privateGet(this, _responseRequests).set(response, request);
  return response;
};
wrapRequestWithUploadProgress_fn = function(request, originalBody) {
  if (!__privateGet(this, _options).onUploadProgress || !request.body || !supportsRequestStreams) {
    return request;
  }
  return streamRequest(request, __privateGet(this, _options).onUploadProgress, originalBody ?? __privateGet(this, _options).body ?? void 0);
};
__privateAdd(_Ky, _Ky_static);
var Ky = _Ky;

// ../../node_modules/.pnpm/ky@2.0.2/node_modules/ky/distribution/index.js
var createInstance = (defaults) => {
  const ky2 = (input, options) => Ky.create(input, validateAndMerge(defaults, options));
  for (const method of requestMethods) {
    ky2[method] = (input, options) => Ky.create(input, validateAndMerge(defaults, options, { method }));
  }
  ky2.create = (newDefaults) => createInstance(validateAndMerge(newDefaults));
  ky2.extend = (newDefaults) => {
    if (typeof newDefaults === "function") {
      newDefaults = newDefaults(defaults ?? {});
    }
    return createInstance(validateAndMerge(defaults, newDefaults));
  };
  ky2.stop = stop;
  ky2.retry = retry;
  return ky2;
};
var ky = createInstance();
var distribution_default = ky;

// shell/.ojm-shim-ky.mjs
var ojm_shim_ky_default = distribution_default ?? distribution_exports;
export {
  ForceRetryError,
  HTTPError,
  KyError,
  NetworkError,
  SchemaValidationError,
  TimeoutError,
  ojm_shim_ky_default as default,
  isForceRetryError,
  isHTTPError,
  isKyError,
  isNetworkError,
  isTimeoutError,
  replaceOption
};
/*! Bundled license information:

ky/distribution/index.js:
  (*! MIT License © Sindre Sorhus *)
*/
