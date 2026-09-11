import type { GlobalToken } from "antd";
/**
 * 16 进制颜色值转 RGB 颜色值，因为 16 进制的颜色值在 tailwind 中不支持透明度，比如无法使用 bg-blue-500/20
 * @see https://tailwindcss.com/docs/customizing-colors#using-css-variables
 */
export declare function hexToRGB(hex: string): string;
export declare function isRGBColor(color: string): boolean;
export declare function getCSSVariablesByTokens(tokens: GlobalToken): string;
