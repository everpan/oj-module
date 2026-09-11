/**
 * 处理错误响应
 *
 * 错误体不保证是 JSON（ojm dev 404 纯文本、网关 502 HTML 都是常态），
 * 故对齐 ky 自家的 text-first 模式：先取文本再显式 JSON.parse，
 * 解析不出对象就静默回退状态文本——非 JSON 不再当异常刷 console.error。
 * 经 clone 读取，保持原 body 对下游（ky .json() 链）可读。
 *
 * @param response 响应对象
 * @returns 响应对象
 */
export declare function handleErrorResponse(response: Response): Promise<Response>;
