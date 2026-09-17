/**
 * `@plane/editor` 的**最小手写声明**（M3 G1 补，此前该包只有 `default` 无 `types`）。
 *
 * ## 为什么是手写而不是生成
 * 真实类型在 **plane 仓** `packages/editor/src/types/editor.ts`（`IEditorProps` /
 * `CoreEditorRefApi`），依赖 `@tiptap/*`、`prosemirror-*`、`@plane/types` 等 oj-app 侧
 * 并不安装的包 → 生成 d.ts 会带一堆无法解析的 import（oj-app 开了 `skipLibCheck`，
 * 不会报错，但消费侧这些类型会退化成 error 类型）。
 *
 * 本文件因此是**真实签名的子集**：字段名与签名逐条照抄上游，但
 * ① 只列 M3/M5 会用到的成员；② **全部标可选**（避免消费侧被"必填"卡住）。
 *
 * ## 消费侧必须知道的「运行时必需项」
 * 上游 `IEditorProps` 有几项是**运行时必需**（缺失会在编辑器内部崩或在挂载期抛），
 * 本声明因标注可选而**不会**在类型层拦住你，请自觉提供：
 * `id`、`initialValue`、`disabledExtensions`、`flaggedExtensions`、`fileHandler`、
 * `mentionHandler`、`getEditorMetaData`、`extendedEditorProps`。
 * 需要完整面时请查上游 `packages/editor/src/types/editor.ts`。
 *
 * ## 已知差异（照抄时易错，故写明）
 * - `onChange` 的参数顺序是 **`(json, html, opts?)`** —— json 在前，不是 (html, json)。
 * - `onChange` 的第二参 `html` 才是要落库的 `description_html`。
 * - `setEditorValue(content, emitUpdate?)` 是**替换全文**；`insertText` 是插入。
 *
 * ## 后续（框架待办）
 * 正解是从上游生成 d.ts 并随包发布（需把 tiptap/prosemirror 类型作为 peer 或内联）。
 * 记在 M3 报告里作为待办，不在本阶段做。
 */

import type * as React from "react";

/** 编辑器实例句柄（`CoreEditorRefApi` 的子集，成员名与签名照抄上游） */
export interface EditorRefApi {
  blur: () => void;
  /** 清空内容；`emitUpdate=false` 时不触发 onChange */
  clearEditor: (emitUpdate?: boolean) => void;
  focus: (args?: unknown) => void;
  getDocument: () => {
    binary: Uint8Array | null;
    html: string;
    json: object | null;
  };
  getDocumentInfo: () => { characters: number; words: number; paragraphs: number };
  getHeadings: () => unknown[];
  getMarkDown: () => string;
  getSelectedText: () => string | null;
  /** 在当前光标处插入 HTML 片段 */
  insertText: (contentHTML: string, insertOnNextLine?: boolean) => void;
  /** 编辑器是否已无未落库内容（可安全离开） */
  isEditorReadyToDiscard: () => boolean;
  onDocumentInfoChange: (callback: (documentInfo: unknown) => void) => () => void;
  onHeadingChange: (callback: (headings: unknown[]) => void) => () => void;
  onStateChange: (callback: () => void) => () => void;
  redo: () => void;
  /** **替换全文**（不是追加） */
  setEditorValue: (content: string, emitUpdate?: boolean) => void;
  setEditorValueAtCursorPosition: (content: string) => void;
  setFocusAtPosition: (position: number) => void;
  undo: () => void;
}

/**
 * 编辑器通用 props。**全部可选**（见文件头「运行时必需项」）。
 * 允许额外键（`[key: string]: unknown`）以免上游出现新 prop 时消费侧报错。
 */
export interface IEditorProps {
  [key: string]: unknown;
  id?: string;
  /** 初值（HTML 字符串）。与 `value` 的区别：`initialValue` 只在首挂载生效 */
  initialValue?: string;
  /** 受控值（HTML 字符串） */
  value?: string | null;
  /**
   * 内容变更回调。**注意参数顺序：json 在前、html 在后**
   * （`description_html` 落库取第二参）。
   */
  onChange?: (json: object, html: string, options?: { isMigrationUpdate?: boolean }) => void;
  placeholder?: string | ((isFocused: boolean, value: string) => string);
  editable?: boolean;
  disabled?: boolean;
  autofocus?: boolean;
  containerClassName?: string;
  editorClassName?: string;
  bubbleMenuEnabled?: boolean;
  showPlaceholderOnEmpty?: boolean;
  tabIndex?: number;
  /** 附件/图片上传等文件回调（运行时必需） */
  fileHandler?: unknown;
  /** @ 提及候选（运行时必需） */
  mentionHandler?: unknown;
  /** 编辑器元数据（运行时必需） */
  getEditorMetaData?: (htmlContent: string) => unknown;
  /** 禁用/标记的扩展名（运行时必需） */
  disabledExtensions?: unknown[];
  flaggedExtensions?: unknown[];
  /** 扩展属性（运行时必需） */
  extendedEditorProps?: unknown;
  /** 资产变化（上传/删除）回调 */
  onAssetChange?: (assets: unknown[]) => void;
  onEditorFocus?: () => void;
  onEnterKeyPress?: (e?: unknown) => void;
  handleEditorReady?: (value: boolean) => void;
  workItemIdentifier?: string | null;
  /** 是否处于触屏设备 */
  isTouchDevice?: boolean;
}

export type ILiteTextEditorProps = IEditorProps;
export type IRichTextEditorProps = IEditorProps & { dragDropEnabled?: boolean };
export type IDocumentEditorProps = IEditorProps;

type RefComponent<P> = React.ForwardRefExoticComponent<
  P & React.RefAttributes<EditorRefApi>
>;

/** 富文本编辑器（描述、评论富文本） */
export declare const RichTextEditorWithRef: RefComponent<IRichTextEditorProps>;
/** 轻量文本编辑器（评论、回复） */
export declare const LiteTextEditorWithRef: RefComponent<ILiteTextEditorProps>;
/** 文档编辑器（pages 模块用，M5 才接协作） */
export declare const DocumentEditorWithRef: RefComponent<IDocumentEditorProps>;
