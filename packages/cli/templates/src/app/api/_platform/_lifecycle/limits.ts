// 体积上限常量（REG-CS8 红队 F1，Q13 已拍板数值）。
//
// 全仓单源：下载闸 / 解压闸 / 上传侧（S4-2）三处共用同一组数字——改一处即可调，
// 杜绝「下载侧一个值、解压侧另一个值」的散落（红队 F1 原罪）。
//
// 语义分工：
// - MAX_PACKAGE_BYTES：分发包（.tgz，已压缩）体积上限。下载闸在 fetch 之前比对索引声明的
//   archive.size 直接拒，不发请求、不读入内存——先中毒后验毒的源头堵死。
// - MAX_UNPACKED_BYTES：解压后未压缩总体积上限。解压炸弹（1MB → 2GB）的主闸：tar -tvzf 清单
//   已含真实未压缩尺寸，校验阶段即拒，零解压零落盘；解压后再复核实际磁盘占用兜底。
// - MAX_ENTRIES：tar 成员条目数上限。海量小文件 / zip-bomb 的条目数维度封顶。
// - MAX_SINGLE_ENTRY_BYTES：单成员未压缩体积上限。单文件解压炸弹（一个 50MB+ 的成员）封顶。

/** 分发包（.tgz）体积上限 = 50MB */
export const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
/** 解压后未压缩总体积上限 = 200MB */
export const MAX_UNPACKED_BYTES = 200 * 1024 * 1024;
/** tar 成员条目数上限 = 5000 */
export const MAX_ENTRIES = 5000;
/** 单成员未压缩体积上限 = 50MB */
export const MAX_SINGLE_ENTRY_BYTES = 50 * 1024 * 1024;
