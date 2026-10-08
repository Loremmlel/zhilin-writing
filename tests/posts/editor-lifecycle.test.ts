import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "fake-indexeddb/auto";

test("autosaved Markdown changes preserve the active editor session", async () => {
  const lifecycleModule = await import("../../lib/editor/lifecycle.ts").catch(() => null);
  assert.ok(lifecycleModule, "the editor lifecycle policy must exist");

  const beforeSave = lifecycleModule.editorSessionKey({
    compact: false,
    resetRevision: 0,
    markdown: "正在输入",
  });
  const afterSave = lifecycleModule.editorSessionKey({
    compact: false,
    resetRevision: 0,
    markdown: "正在输入更多内容",
  });

  assert.equal(afterSave, beforeSave);
});

test("an explicit reset creates a new editor session", async () => {
  const lifecycleModule = await import("../../lib/editor/lifecycle.ts").catch(() => null);
  assert.ok(lifecycleModule, "the editor lifecycle policy must exist");

  const current = lifecycleModule.editorSessionKey({
    compact: false,
    resetRevision: 0,
    markdown: "正文",
  });
  const reset = lifecycleModule.editorSessionKey({
    compact: false,
    resetRevision: 1,
    markdown: "正文\n\n[附件](/api/assets/a1)",
  });

  assert.notEqual(reset, current);
});

test("post editing mounts one editor only after local draft hydration", async () => {
  const source = await readFile(
    new URL("../../components/editor/post-editor-form.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const editor = hydrated \? \(/);
  assert.doesNotMatch(source, /hydrated \? "ready" : "initial"/);
});

test("editor initialization keeps a visible loading and retry state", async () => {
  const source = await readFile(
    new URL("../../components/editor/markdown-editor.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /initializationState/);
  assert.match(source, /\.create\(\)[\s\S]*?\.catch\(/);
  assert.match(source, /正文编辑器加载失败，帖子内容没有丢失。/);
});

test("exiting an edited post saves the current local draft before navigation", async () => {
  const source = await readFile(
    new URL("../../components/editor/post-editor-form.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /async function exitEditor\(\)/);
  assert.match(source, /await saveDraft\([\s\S]*?router\.push\(cancelHref\)/);
  assert.match(source, /catch \{[\s\S]*?setDraftStatus\("failed"\)/);
  assert.match(source, /exitPending \? "正在保存到本地…" : "退出编辑"/);
});

test("the actual Milkdown textbox receives the visible editor label", async () => {
  const source = await readFile(
    new URL("../../components/editor/markdown-editor.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /view\.dom\.setAttribute\("aria-label", compact \? "回复正文" : "正文"\)/);
  assert.match(source, /view\.dom\.setAttribute\("aria-multiline", "true"\)/);
});

test("post publication validates locally, keeps failed drafts, and separates changed submissions", async () => {
  // Run the production form in React DOM with a controlled editor and router.
  // This verifies form state and IndexedDB, not a real-browser end-to-end journey.
  const { Window } = await import("happy-dom");
  const { saveDraft, loadDraft, removeDraft } = await import("../../lib/drafts/indexed-db.ts");
  const browser = new Window({ url: "https://example.test/posts/new" });
  const harness = { routes: [] as string[], changeMarkdown: (_value: string) => {} };
  const globals = {
    window: browser,
    document: browser.document,
    navigator: browser.navigator,
    HTMLElement: browser.HTMLElement,
    FormData: browser.FormData,
    IS_REACT_ACT_ENVIRONMENT: true,
    __postEditorTest: harness,
  };
  const original = Object.fromEntries(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  browser.fetch = async () => new browser.Response(null, { status: 204 });
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const ts = await import("typescript");
  const moduleUrl = (source: string) =>
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const reactImport = `import React from ${JSON.stringify(import.meta.resolve("react"))};`;
  const mocks: Record<string, string> = {
    "next/link": `${reactImport} export default p => React.createElement("a", {href:p.href}, p.children);`,
    "next/navigation": `const router={push:p=>globalThis.__postEditorTest.routes.push(p)}; export const useRouter=()=>router;`,
    "@/components/pending/pending-submit-button": `${reactImport} import {useFormStatus} from ${JSON.stringify(import.meta.resolve("react-dom"))}; export function PendingSubmitButton(p){return React.createElement("button", {type:"submit", disabled:p.disabled||useFormStatus().pending},p.children);}`,
    "@/components/modal-dialog": `export const ModalDialog=()=>null;`,
    "./annotated-editor-layout": `${reactImport} export const AnnotatedEditorLayout=p=>React.createElement("div",null,p.children);`,
    "./post-visibility-field": `${reactImport} export const PostVisibilityField=p=>React.createElement("input",{type:"hidden",name:"visibilityUserIds",value:JSON.stringify(p.value)});`,
    "./markdown-editor": `${reactImport} export function MarkdownEditor(p){
      const ref=React.useRef(null); globalThis.__postEditorTest.changeMarkdown=p.onMarkdownChange;
      React.useEffect(()=>{p.onEditorRootChange(ref.current);return ()=>p.onEditorRootChange(null)},[p.onEditorRootChange]);
      return React.createElement("div", {ref}, React.createElement("div",{contentEditable:true,role:"textbox",suppressContentEditableWarning:true},p.initialMarkdown));
    }`,
  };
  async function compile(relative: string): Promise<string> {
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    const code = ts.transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    }).outputText;
    return moduleUrl(
      code.replace(/from (["'])([^"']+)\1/g, (_match, _quote, specifier: string) => {
        const url = mocks[specifier]
          ? moduleUrl(mocks[specifier])
          : specifier.startsWith("@/")
            ? new URL(`../../${specifier.slice(2)}.ts`, import.meta.url).href
            : import.meta.resolve(specifier);
        return `from ${JSON.stringify(url)}`;
      }),
    );
  }
  mocks["@/components/action-error-message"] =
    `export {ActionErrorMessage} from ${JSON.stringify(await compile("../../components/action-error-message.tsx"))};`;
  const { PostEditorForm } = await import(
    await compile("../../components/editor/post-editor-form.tsx")
  );
  const host = document.createElement("div");
  document.body.appendChild(host);
  const escaped: unknown[] = [];
  let root = createRoot(host as unknown as HTMLElement, {
    onUncaughtError: (error) => escaped.push(error),
  });
  const userId = crypto.randomUUID();
  const submissions: FormData[] = [];
  const action = async (_previous: unknown, data: FormData) => {
    submissions.push(data);
    if (submissions.length === 1)
      return { error: "旧发布编号已被使用", code: "POST_CREATION_CONFLICT" };
    if (submissions.length === 2) throw new TypeError("Failed to fetch");
    return { postId: "new-post" };
  };
  const mount = async () => {
    await React.act(async () => {
      root.render(
        React.createElement(PostEditorForm, {
          userId,
          draftId: "new",
          action,
          visibilityUsers: [],
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  };
  const publish = async () => {
    await React.act(async () => {
      host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 35));
    });
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 35));
    });
  };
  try {
    await mount();
    await publish();
    assert.equal(submissions.length, 0);
    assert.match(host.textContent, /标题不能为空/);
    assert.equal(browser.document.activeElement, host.querySelector('[name="title"]'));
    await React.act(async () => root.unmount());
    const oldKey = crypto.randomUUID();
    await saveDraft(userId, "new", {
      title: "讨论意识归属",
      markdown: "旧正文",
      tags: "",
      attachmentIds: [],
      baseRevisionId: null,
      creationSubmissionKey: oldKey,
      updatedAt: 1,
    });
    root = createRoot(host as unknown as HTMLElement);
    await mount();
    await publish();
    assert.equal(submissions[0].get("creationSubmissionKey"), oldKey);
    assert.deepEqual(harness.routes, []);
    assert.ok(await loadDraft(userId, "new"));
    assert.notEqual(
      host.querySelector<HTMLInputElement>('[name="creationSubmissionKey"]')!.value,
      oldKey,
    );
    await React.act(async () => harness.changeMarkdown("　\n "));
    await publish();
    assert.equal(submissions.length, 1);
    assert.match(host.textContent, /正文不能为空/);
    assert.equal(browser.document.activeElement, host.querySelector('[contenteditable="true"]'));
    await React.act(async () => harness.changeMarkdown("新正文，最后一次输入"));
    const textbox = host.querySelector('[contenteditable="true"]');
    await publish();
    assert.equal(submissions.length, 2);
    assert.equal((await loadDraft(userId, "new"))?.markdown, "新正文，最后一次输入");
    assert.equal(host.querySelector('[contenteditable="true"]'), textbox);
    assert.match(host.textContent, /帖子内容仍保留/);
    assert.deepEqual(harness.routes, []);
    assert.notEqual(submissions[1].get("creationSubmissionKey"), oldKey);
    await publish();
    assert.equal(
      submissions[2].get("creationSubmissionKey"),
      submissions[1].get("creationSubmissionKey"),
    );
    assert.equal(submissions[2].get("markdown"), "新正文，最后一次输入");
    assert.deepEqual(harness.routes, ["/posts/new-post"]);
    assert.equal(await loadDraft(userId, "new"), null);
    assert.deepEqual(escaped, []);
    await React.act(async () => root.unmount());
    root = createRoot(host as unknown as HTMLElement);
    await mount();
    assert.equal(host.querySelector<HTMLInputElement>('[name="title"]')!.value, "");
    assert.equal(host.querySelector<HTMLInputElement>('[name="markdown"]')!.value, "");
  } finally {
    await React.act(async () => root.unmount());
    await removeDraft(userId, "new");
    await browser.happyDOM.close();
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
