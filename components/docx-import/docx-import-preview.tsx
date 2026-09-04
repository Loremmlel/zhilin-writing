"use client";

import { useRef } from "react";

import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { excerpt } from "@/lib/format";
import { markdownToPlainText } from "@/lib/markdown/render";
import {
  getImportedThreadSelectedText,
  type EditedImportPreview,
  type ImportPreviewValidationResult,
} from "@/lib/docx-import/preview-validation";
import { warningsWithoutSkippedThreadDuplicates } from "@/lib/docx-import/preview-warnings";
import type { ImportWarning, ImportedThread } from "@/lib/docx-import/types";

type SiteUser = { id: string; displayName: string };

const warningLabels: Record<ImportWarning["code"], string> = {
  HEADING_LEVEL_CLAMPED: "标题层级已收敛到四级",
  LIST_DEPTH_CLAMPED: "列表层级已收敛到三级",
  VISUAL_FORMATTING_DROPPED: "仅视觉格式未导入",
  HYPERLINK_UNSAFE_DROPPED: "不安全链接已移除",
  TOC_SKIPPED: "目录字段已跳过",
  TRACK_CHANGES_FLATTENED: "修订痕迹已合并到正文",
  TABLE_HEADER_SYNTHESIZED: "表格已补充表头",
  TABLE_CELL_FLATTENED: "复杂单元格已展平",
  TABLE_MERGED_CELLS_FLATTENED: "合并单元格已转为普通段落",
  FLOATING_IMAGE_FLATTENED: "浮动图片已转为行内图片",
  IMAGE_FORMAT_UNSUPPORTED: "不支持的图片已跳过",
  TEXTBOX_FLATTENED: "文本框内容已展平",
  EQUATION_SKIPPED: "公式已使用占位说明",
  SHAPE_CONTENT_SKIPPED: "无法读取的图形内容已跳过",
  NOTES_FLATTENED_TO_APPENDIX: "脚注与尾注已移到文末",
  ANNOTATION_EMPTY_RANGE: "空批注范围已跳过",
  ANNOTATION_CROSS_BLOCK: "跨段批注已跳过",
  ANNOTATION_NON_TEXT_RANGE: "非正文批注已跳过",
  ANNOTATION_TABLE_UNSUPPORTED: "表格内批注已跳过",
  ANNOTATION_OVERLAP_SKIPPED: "重叠批注已按顺序取舍",
  ANNOTATION_ORPHAN_DEFINITION: "未绑定正文的批注已跳过",
  ANNOTATION_THREAD_SKIPPED: "无法完整导入的批注讨论已跳过",
};

const validationLabels: Record<string, string> = {
  TITLE_REQUIRED: "标题不能为空。",
  TITLE_TOO_LONG: "标题不能超过 120 个字符。",
  MARKDOWN_REQUIRED: "正文不能为空。",
  MARKDOWN_SIZE_LIMIT: "正文超过 1.5 MB，需删减后再确认。",
  PREVIEW_EXPIRED: "这份预览已经超过 24 小时，请重新选择原文件。",
  PREVIEW_MARKDOWN_INVALID: "正文 Markdown 无法解析，请撤销最近修改。",
  ANNOTATION_ANCHOR_MISSING: "正文中有批注锚点被移除，请恢复对应文字。",
  ANNOTATION_ANCHOR_UNKNOWN: "正文中出现了不属于本次导入的批注锚点。",
  ANNOTATION_ANCHOR_DUPLICATE: "同一批注锚点在正文中出现了多次。",
  ANNOTATION_TEXT_CHANGED: "这条批注圈住的原文已被修改。",
  ANNOTATION_NESTED: "批注锚点不能互相嵌套。",
  ANNOTATION_NON_TEXT_RANGE: "批注锚点不能包含图片或其他非正文内容。",
  ANNOTATION_CROSS_BLOCK: "跨段批注必须覆盖连续的正文段落。",
  ANNOTATION_OVERLAP: "批注范围发生重叠，无法安全导入。",
  UNSAFE_EXTERNAL_URL: "正文包含不安全链接，请移除后再确认。",
  IMPORT_WARNING_ERROR: "源文件包含阻断导入的问题。",
  ASSET_UPLOAD_MISSING: "有图片尚未完成临时上传，请重新导入原文件。",
  ASSET_REFERENCE_INVALID: "预览中的图片引用已失效，请重新导入原文件。",
  AUTHOR_MAPPING_INVALID: "有 Word 作者关联已失效，请重新选择。",
};

export function DocxImportPreview({
  preview,
  users,
  validation,
  onTitleChange,
  onMarkdownChange,
  onMappingChange,
  onRestoreAnnotationText,
  editorResetRevision,
}: {
  preview: EditedImportPreview;
  users: SiteUser[];
  validation: ImportPreviewValidationResult;
  onTitleChange: (title: string) => void;
  onMarkdownChange: (markdown: string) => void;
  onMappingChange: (sourceAuthorName: string, userId: string) => void;
  onRestoreAnnotationText: (annotationId: string) => void;
  editorResetRevision: number;
}) {
  const editorRootRef = useRef<HTMLElement | null>(null);
  const summaryWarnings = warningsWithoutSkippedThreadDuplicates(
    preview.ir.warnings,
    preview.ir.skippedThreads,
  );
  const warningDetails = [
    ...summaryWarnings.map((warning) => ({
      key: `${warning.code}:${warning.sourceRef ?? ""}`,
      label: warningLabels[warning.code],
      detail: warning.sourceRef,
      count: warning.count ?? 1,
      severity: warning.severity,
    })),
    ...preview.ir.skippedThreads.map((thread) => ({
      key: `skipped:${thread.sourceCommentId}`,
      label: warningLabels[thread.warning.code],
      detail: `Word 批注 ${thread.sourceCommentId}${thread.sourceAuthorName ? ` · ${thread.sourceAuthorName}` : ""}`,
      count: 1,
      severity: thread.warning.severity,
    })),
  ];
  const visibleWarnings = warningDetails.slice(0, 50);
  const hiddenWarningCount = warningDetails
    .slice(50)
    .reduce((total, item) => total + item.count, 0);
  const hiddenWarningGroups = [
    ...warningDetails.slice(50).reduce((groups, item) => {
      groups.set(item.label, (groups.get(item.label) ?? 0) + item.count);
      return groups;
    }, new Map<string, number>()),
  ];
  const authors = importedAuthors(preview.ir.threads);
  const titleError = validation.ok
    ? undefined
    : validation.errors.find(
        (item) => item.code === "TITLE_REQUIRED" || item.code === "TITLE_TOO_LONG",
      );
  const threadsById = new Map(preview.ir.threads.map((thread) => [thread.annotationId, thread]));

  function locateAnnotation(annotationId: string) {
    const ranges = [
      ...(editorRootRef.current?.querySelectorAll<HTMLElement>("[data-annotation-id]") ?? []),
    ].filter((item) => item.dataset.annotationId === annotationId);
    const range = ranges[0];
    if (!range) return;
    ranges.forEach((item) => item.classList.add("is-active"));
    range.focus({ preventScroll: true });
    range.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "center",
    });
    window.setTimeout(() => ranges.forEach((item) => item.classList.remove("is-active")), 1800);
  }

  return (
    <div className="docx-import-preview">
      <section className="docx-import-document" aria-labelledby="docx-preview-heading">
        <div className="docx-import-preview-heading">
          <div>
            <span className="eyebrow">导入预览</span>
            <h2 id="docx-preview-heading">检查正文与批注位置</h2>
          </div>
          <span className="docx-import-source">{preview.ir.source.filename}</span>
        </div>
        <label className="field-label" htmlFor="docx-import-title">
          帖子标题
        </label>
        <input
          id="docx-import-title"
          className="title-input"
          value={preview.title}
          maxLength={120}
          aria-invalid={Boolean(titleError)}
          aria-describedby={titleError ? "docx-import-title-error" : undefined}
          onChange={(event) => onTitleChange(event.target.value)}
        />
        {titleError && (
          <p id="docx-import-title-error" className="form-error" role="alert">
            {validationLabels[titleError.code]}
          </p>
        )}
        {preview.ir.threads.length > 0 && (
          <div className="docx-import-lock-notice" role="status">
            此 DOCX 含正文批注。导入后可继续编辑正文；修改批注端点时系统会先要求确认。
          </div>
        )}
        <label className="field-label">正文</label>
        <MarkdownEditor
          initialMarkdown={preview.markdown}
          onMarkdownChange={onMarkdownChange}
          allowImageUploads={false}
          resetRevision={editorResetRevision}
          onEditorRootChange={(root) => {
            editorRootRef.current = root;
          }}
        />
      </section>

      <aside className="docx-import-rail" aria-label="导入检查信息">
        <section className="docx-import-panel">
          <div className="section-heading">
            <h2>Word 批注</h2>
            <span>{preview.ir.threads.length} 条</span>
          </div>
          {preview.ir.threads.length === 0 ? (
            <p className="empty-copy">没有可导入的正文批注。</p>
          ) : (
            <div className="docx-import-thread-list">
              {preview.ir.threads.map((thread) => (
                <ImportedThreadPreview
                  key={thread.annotationId}
                  thread={thread}
                  selectedText={getImportedThreadSelectedText(
                    preview.ir.blocks,
                    thread.blockId,
                    thread.blockLocalStart,
                    thread.blockLocalEnd,
                    thread.endBlockId,
                  )}
                />
              ))}
            </div>
          )}
        </section>

        <section className="docx-import-panel">
          <div className="section-heading">
            <h2>Word 作者关联</h2>
            <span>{authors.length} 位</span>
          </div>
          <p className="muted">关联只用于通知和说明，Word 原作者身份始终保留。</p>
          <div className="docx-import-author-list">
            {authors.map((author, index) => (
              <label key={author}>
                <span>
                  {author} <small>Word 导入</small>
                </span>
                {/* Native select is intentional: this small mapping list accepts the platform-owned popup. */}
                <select
                  value={preview.authorMappings[author] ?? ""}
                  aria-invalid={Boolean(
                    preview.authorMappings[author] &&
                    !users.some((user) => user.id === preview.authorMappings[author]),
                  )}
                  aria-describedby={
                    preview.authorMappings[author] &&
                    !users.some((user) => user.id === preview.authorMappings[author])
                      ? `docx-author-${index}-error`
                      : undefined
                  }
                  onChange={(event) => onMappingChange(author, event.target.value)}
                >
                  <option value="">不关联站内用户</option>
                  {preview.authorMappings[author] &&
                  !users.some((user) => user.id === preview.authorMappings[author]) ? (
                    <option value={preview.authorMappings[author]}>原关联用户已不可用</option>
                  ) : null}
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.displayName}
                    </option>
                  ))}
                </select>
                {preview.authorMappings[author] &&
                !users.some((user) => user.id === preview.authorMappings[author]) ? (
                  <small id={`docx-author-${index}-error`} className="form-error">
                    原关联用户已不可用，请重新选择。
                  </small>
                ) : null}
              </label>
            ))}
          </div>
        </section>

        <section className="docx-import-panel docx-import-warning-summary">
          <div className="section-heading">
            <h2>导入提醒</h2>
            <span>{warningDetails.reduce((total, item) => total + item.count, 0)} 项</span>
          </div>
          {visibleWarnings.length === 0 ? (
            <p className="docx-import-clear-state">没有需要处理的降级提醒。</p>
          ) : (
            <ul>
              {visibleWarnings.map((item) => (
                <li key={item.key} data-severity={item.severity}>
                  <strong>
                    {item.label}
                    {item.count > 1 ? ` × ${item.count}` : ""}
                  </strong>
                  {item.detail && <span>{item.detail}</span>}
                </li>
              ))}
            </ul>
          )}
          {hiddenWarningCount > 0 && (
            <details className="docx-import-warning-groups">
              <summary>另有 {hiddenWarningCount} 项，按类别汇总</summary>
              <ul>
                {hiddenWarningGroups.map(([label, count]) => (
                  <li key={label}>
                    <strong>
                      {label} × {count}
                    </strong>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        {!validation.ok && (
          <section
            className="docx-import-panel docx-import-validation"
            role="alert"
            aria-labelledby="docx-validation-heading"
          >
            <h2 id="docx-validation-heading">需要先修正</h2>
            <p className="docx-import-validation-help">
              批注必须继续对应 Word 中圈选的原文。你可以先定位检查，或只恢复受影响的原文范围。
            </p>
            <ul>
              {validation.errors.map((error, index) => {
                const thread = error.annotationId ? threadsById.get(error.annotationId) : undefined;
                const originalText = thread
                  ? getImportedThreadSelectedText(
                      preview.ir.blocks,
                      thread.blockId,
                      thread.blockLocalStart,
                      thread.blockLocalEnd,
                      thread.endBlockId,
                    )
                  : "";
                const canRestore = error.code === "ANNOTATION_TEXT_CHANGED" && thread;
                return (
                  <li key={`${error.code}:${error.annotationId ?? ""}:${index}`}>
                    <span>{validationLabels[error.code] ?? "预览内容不符合导入要求。"}</span>
                    {canRestore && (
                      <div className="docx-import-validation-detail">
                        <span>
                          {thread.sourceAuthorName} 的批注原文：<q>{excerpt(originalText, 80)}</q>
                        </span>
                        <div>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => locateAnnotation(thread.annotationId)}
                          >
                            定位到正文
                          </button>
                          <button
                            type="button"
                            className="button button--ghost button--small"
                            onClick={() => onRestoreAnnotationText(thread.annotationId)}
                          >
                            恢复这段原文
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}

function ImportedThreadPreview({
  thread,
  selectedText,
}: {
  thread: ImportedThread;
  selectedText: string;
}) {
  return (
    <article className="docx-import-thread">
      <header>
        <strong>{thread.sourceAuthorName}</strong>
        <span>Word 导入{thread.sourceResolved ? " · Word 中已解决" : ""}</span>
      </header>
      <blockquote>{selectedText}</blockquote>
      <p>{markdownToPlainText(thread.bodyMarkdown)}</p>
      {thread.replies.map((reply) => (
        <div className="docx-import-thread-reply" key={reply.replyId}>
          <strong>{reply.sourceAuthorName}</strong>
          <span>{markdownToPlainText(reply.bodyMarkdown)}</span>
        </div>
      ))}
    </article>
  );
}

function importedAuthors(threads: ImportedThread[]): string[] {
  return [
    ...new Set(
      threads.flatMap((thread) => [
        thread.sourceAuthorName,
        ...thread.replies.map((reply) => reply.sourceAuthorName),
      ]),
    ),
  ].sort((a, b) => a.localeCompare(b, "zh-CN"));
}
