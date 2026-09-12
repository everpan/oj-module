import type { ButtonProps } from "antd";
/**
 * 通知容器（G4）：拉取列表 + 接线互动事件。
 *
 * - 互动可用的前提：注册了 provider 且四方法齐全；否则降级只读
 *   （popup 按 onEventChange 是否存在推导，评审 A3——不加新 prop）；
 * - 写操作成功后重拉刷新；**重拉失败不清空现有列表**（评审 b4）；
 * - 20x 复制残留已删除（评审 b4，同一 id 复制 20 份会让 markRead 语义失真）；
 * - viewAll 不接线（N3，模板无通知中心页）。
 */
export declare function NotificationContainer({ ...restProps }: ButtonProps): import("#node_modules/@types/react").JSX.Element;
