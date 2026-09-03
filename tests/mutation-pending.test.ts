import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(new URL(path, import.meta.url), "utf8").catch(() => "");
}

test("shared submit feedback is immediate, duplicate-safe, and accessible", async () => {
  const button = await source("../components/pending/pending-submit-button.tsx");

  assert.match(button, /useFormStatus\(\)/);
  assert.match(button, /disabled=\{pending/);
  assert.match(button, /aria-busy=\{pending\}/);
  assert.match(button, /pending-submit-labels/);
  assert.match(button, /aria-hidden=\{pending\}/);
  assert.match(button, /aria-hidden=\{!pending\}/);
  assert.match(button, /role="status"/);
});

test("post, annotation, reply, delete, and moderation mutations expose their existing pending state", async () => {
  const contracts = [
    [
      "../components/editor/post-editor-form.tsx",
      /pending\s*\?\s*"保存中…"/,
      /aria-busy=\{pending\}/,
    ],
    [
      "../components/annotations/annotation-reading-layout.tsx",
      /pending\s*\?\s*"发布中…"/,
      /aria-busy=\{pending\}/,
    ],
    ["../components/reply-form.tsx", /pending\s*\?\s*"发布中…"/, /aria-busy=\{pending\}/],
    [
      "../components/annotations/annotation-reply-form.tsx",
      /pending\s*\?\s*"发布中…"/,
      /aria-busy=\{pending\}/,
    ],
    [
      "../components/lifecycle/delete-content-control.tsx",
      /pending\s*\?\s*pendingLabel/,
      /aria-busy=\{pending\}/,
    ],
    [
      "../components/admin/content-lifecycle-control.tsx",
      /pending\s*\?\s*"正在更新…"/,
      /aria-busy=\{pending\}/,
    ],
  ] as const;

  for (const [path, label, busy] of contracts) {
    const contents = await source(path);
    assert.match(contents, /disabled=\{pending/, `${path} should reject duplicate submission`);
    assert.match(contents, label, `${path} should change its visible label immediately`);
    assert.match(contents, busy, `${path} should expose busy state`);
  }
});

test("reply drafts clear only after a successful server result", async () => {
  const [postReply, annotationReply, annotationComposer] = await Promise.all([
    source("../components/reply-form.tsx"),
    source("../components/annotations/annotation-reply-form.tsx"),
    source("../components/annotations/annotation-reading-layout.tsx"),
  ]);

  assert.match(postReply, /if\s*\(!state\.replyId\)\s*return/);
  assert.match(annotationReply, /if\s*\(!annotationReplyId\)\s*return/);
  assert.match(
    annotationReply,
    /replyMarkdownAfterResult\(current,\s*\{\s*annotationReplyId\s*\}\)/,
  );
  assert.match(annotationComposer, /state\.annotationId/);
  assert.match(annotationComposer, /else if\s*\(state\.error\)/);
});

test("profile, notification, and revision forms keep context while showing pending feedback", async () => {
  const [
    profilePage,
    profileForm,
    profileAction,
    notificationsPage,
    notificationForm,
    restoreForm,
  ] = await Promise.all([
    source("../app/(site)/settings/profile/page.tsx"),
    source("../components/profile/profile-form.tsx"),
    source("../app/(site)/settings/profile/actions.ts"),
    source("../app/(site)/notifications/page.tsx"),
    source("../components/notifications/mark-all-notifications-form.tsx"),
    source("../components/admin/restore-revision-form.tsx"),
  ]);

  assert.match(profilePage, /<ProfileForm/);
  assert.match(profileForm, /useActionState/);
  assert.match(profileForm, /startTransition/);
  assert.match(profileForm, /event\.preventDefault\(\)/);
  assert.match(profileForm, /new FormData\(event\.currentTarget\)/);
  assert.doesNotMatch(profileForm, /<form\s+action=\{formAction\}/);
  assert.match(profileForm, /pending\s*\?\s*"保存中…"/);
  assert.match(profileForm, /aria-busy=\{pending\}/);
  assert.match(profileAction, /return\s+\{\s*error/);
  assert.match(notificationsPage, /MarkAllNotificationsForm/);
  assert.match(notificationForm, /useActionState/);
  assert.match(notificationForm, /pendingLabel="标记中…"/);
  assert.match(notificationForm, /aria-busy=\{pending\}/);
  assert.match(restoreForm, /PendingSubmitButton/);
  assert.match(restoreForm, /pendingLabel="正在恢复…"/);
  assert.match(restoreForm, /state\.error/);
});

test("pending editors and moderation fields cannot diverge from the submitted snapshot", async () => {
  const [editor, post, postReply, annotationReply, annotationCreate, moderation] =
    await Promise.all([
      source("../components/editor/markdown-editor.tsx"),
      source("../components/editor/post-editor-form.tsx"),
      source("../components/reply-form.tsx"),
      source("../components/annotations/annotation-reply-form.tsx"),
      source("../components/annotations/annotation-reading-layout.tsx"),
      source("../components/admin/content-lifecycle-control.tsx"),
    ]);

  assert.match(editor, /disabled\?: boolean/);
  assert.match(editor, /rootRef\.current\.inert/);
  assert.match(post, /<MarkdownEditor[\s\S]*?disabled=\{pending \|\| accessBlocked\}/);
  assert.match(post, /id="post-title"[\s\S]*?disabled=\{pending \|\| accessBlocked\}/);
  assert.match(
    postReply,
    /<(?:Lazy)?MarkdownEditor[\s\S]*?disabled=\{pending \|\| accessBlocked\}/,
  );
  assert.match(
    annotationReply,
    /<(?:Lazy)?MarkdownEditor[\s\S]*?disabled=\{pending \|\| accessBlocked\}/,
  );
  assert.match(
    annotationCreate,
    /<(?:Lazy)?MarkdownEditor[\s\S]*?disabled=\{pending \|\| accessBlocked\}/,
  );
  assert.match(moderation, /value=\{reason\}/);
  assert.match(moderation, /setReason/);
});

test("image and attachment uploads report real request-body byte progress", async () => {
  const [uploader, editor, postForm] = await Promise.all([
    source("../lib/assets/browser-upload.ts"),
    source("../components/editor/markdown-editor.tsx"),
    source("../components/editor/post-editor-form.tsx"),
  ]);

  assert.match(uploader, /new XMLHttpRequest\(\)/);
  assert.match(uploader, /request\.upload\.addEventListener\("progress"/);
  assert.match(uploader, /event\.lengthComputable/);
  assert.match(uploader, /signal\?\.addEventListener\("abort"/);
  assert.match(editor, /imageUploadTasks/);
  assert.match(editor, /图片上传状态/);
  assert.match(editor, /onUploadStateChange/);
  assert.match(editor, /uploadAbortRef/);
  assert.match(editor, /createSerialUploadQueue/);
  assert.match(editor, /Promise\.allSettled/);
  assert.match(editor, />\s*重试\s*</);
  assert.match(editor, />\s*移除\s*</);
  assert.match(postForm, /attachmentUploadTasks/);
  assert.match(postForm, /附件上传状态/);
  assert.match(postForm, /type="file"\s+multiple/);
  assert.match(postForm, /imageUploadPending/);
  assert.match(
    postForm,
    /disabled=\{\s*pending\s*\|\|\s*accessBlocked\s*\|\|\s*saveBlocked\s*\|\|\s*!hydrated\s*\|\|\s*uploadPending\s*\}/,
  );
});

test("asset upload progress is calculated from the browser request body bytes", async () => {
  const originalRequest = globalThis.XMLHttpRequest;
  const progress: number[] = [];

  class FakeUploadTarget {
    listener: EventListenerOrEventListenerObject | null = null;

    addEventListener(_type: string, listener: EventListenerOrEventListenerObject) {
      this.listener = listener;
    }

    emit(loaded: number, total: number) {
      const event = { lengthComputable: true, loaded, total } as ProgressEvent;
      if (typeof this.listener === "function") this.listener(event);
      else this.listener?.handleEvent(event);
    }
  }

  class FakeRequest {
    upload = new FakeUploadTarget();
    responseType = "";
    response: unknown = null;
    status = 0;
    listeners = new Map<string, EventListenerOrEventListenerObject>();

    open() {}
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      this.listeners.set(type, listener);
    }
    send() {
      this.upload.emit(5, 10);
      this.upload.emit(10, 10);
      this.status = 201;
      this.response = {
        asset: { id: "asset-1", filename: "photo.png", kind: "image", url: "/api/assets/asset-1" },
        markdown: "![photo.png](/api/assets/asset-1)",
      };
      const listener = this.listeners.get("load");
      const event = new Event("load");
      if (typeof listener === "function") listener(event);
      else listener?.handleEvent(event);
    }
  }

  Object.defineProperty(globalThis, "XMLHttpRequest", {
    configurable: true,
    writable: true,
    value: FakeRequest,
  });
  try {
    const { uploadAsset } = await import("../lib/assets/browser-upload.ts");
    const result = await uploadAsset(
      new File(["1234567890"], "photo.png", { type: "image/png" }),
      (value) => progress.push(value),
    );
    assert.deepEqual(progress, [0, 50, 100]);
    assert.equal(result.asset.id, "asset-1");
  } finally {
    Object.defineProperty(globalThis, "XMLHttpRequest", {
      configurable: true,
      writable: true,
      value: originalRequest,
    });
  }
});

test("asset uploads abort when their editor session is discarded", async () => {
  const originalRequest = globalThis.XMLHttpRequest;

  class AbortableRequest {
    upload = { addEventListener() {} };
    responseType = "";
    listeners = new Map<string, EventListenerOrEventListenerObject>();

    open() {}
    send() {}
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      this.listeners.set(type, listener);
    }
    abort() {
      const listener = this.listeners.get("abort");
      const event = new Event("abort");
      if (typeof listener === "function") listener(event);
      else listener?.handleEvent(event);
    }
  }

  Object.defineProperty(globalThis, "XMLHttpRequest", {
    configurable: true,
    writable: true,
    value: AbortableRequest,
  });
  try {
    const { uploadAsset } = await import("../lib/assets/browser-upload.ts");
    const controller = new AbortController();
    const result = uploadAsset(
      new File(["image"], "photo.png", { type: "image/png" }),
      () => {},
      controller.signal,
    );
    controller.abort();
    await assert.rejects(
      result,
      (error: unknown) => error instanceof DOMException && error.name === "AbortError",
    );
  } finally {
    Object.defineProperty(globalThis, "XMLHttpRequest", {
      configurable: true,
      writable: true,
      value: originalRequest,
    });
  }
});

test("multi-image uploads are serialized in source order", async () => {
  const { createSerialUploadQueue } = await import("../lib/assets/browser-upload.ts");
  const enqueue = createSerialUploadQueue();
  const started: string[] = [];
  let releaseFirst: (() => void) | undefined;

  const first = enqueue(async () => {
    started.push("first");
    await new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    return "first-result";
  });
  const second = enqueue(async () => {
    started.push("second");
    return "second-result";
  });

  await Promise.resolve();
  assert.deepEqual(started, ["first"]);
  releaseFirst?.();
  assert.deepEqual(await Promise.all([first, second]), ["first-result", "second-result"]);
  assert.deepEqual(started, ["first", "second"]);
});

test("DOCX import keeps staged, cancellable progress and its recoverable source file", async () => {
  const workspace = await source("../components/docx-import/docx-import-workspace.tsx");

  for (const label of [
    "检查 DOCX 文件结构",
    "解析正文、表格与图片",
    "生成 Markdown 预览",
    "上传预览图片",
    "正在保存帖子",
  ]) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /setLastFile\(file\)/);
  assert.match(workspace, /lastFile/);
  assert.match(
    workspace,
    /aria-busy=\{phase === "parsing" \|\| phase === "uploading" \|\| phase === "committing"\}/,
  );
  assert.match(workspace, /cancelActiveImport/);
});
