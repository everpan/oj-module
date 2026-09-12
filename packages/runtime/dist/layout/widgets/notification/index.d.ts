import type { ButtonProps } from "antd";
import type { NotificationItem } from "./types";
export type NotificationEventType = "viewAll" | "makeAll" | "clear" | "read";
interface Props extends ButtonProps {
    /**
     * 互动事件回调。存在即可互动；缺省（未注册 provider / provider 缺写方法的
     * 老 bundle 漂移）时整体只读——「全部已读」「清空」禁用、单条点击 no-op
     * （评审 A3：不加 disabled/readOnly 新 prop，由回调存在性推导）。
     */
    onEventChange?: (event: NotificationEventType, item?: NotificationItem) => void;
    /**
     * 显示圆点
     */
    dot?: boolean;
    /**
     * 消息列表
     */
    notifications?: NotificationItem[];
}
export declare const NotificationPopup: React.FC<Props>;
export {};
