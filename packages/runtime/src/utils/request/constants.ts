// 定义 HTTP 请求头中用于传递授权信息的字段名
export const AUTH_HEADER = "Authorization";

// 定义 HTTP 请求头中用于指定语言偏好的字段名
export const LANG_HEADER = "X-Lang";

// 定义 HTTP 请求头中用于指定应用名称的字段名
export const APP_NAME_HEADER = "X-App-Name";

// 定义 HTTP 请求路径中用于刷新访问令牌的路径
// （oj devkit 手册 §8：auth 端点是业务路由而非内置路由，login/refresh/logout
// 由后端模块实现，路径约定沿用 sample 的 /auth/*；无模块前缀）
export const REFRESH_TOKEN_PATH = "auth/refresh";

// 定义 HTTP 请求路径中用于登录的路径（P0：白名单按接口路径判定，与页面路径 loginPath 脱钩）
export const AUTH_LOGIN_PATH = "auth/login";
