import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { useQueryDatabase } from "../helpers/query-database.ts";

// Execute the production query module against migrated SQLite; only its D1 transport is replaced.
const root = new URL("../../", import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (
      specifier === "@/db" ||
      (specifier === "./index" && context.parentURL?.endsWith("/db/queries.ts"))
    )
      return {
        url: new URL("../helpers/query-database.ts", import.meta.url).href,
        shortCircuit: true,
      };
    if (specifier === "cloudflare:workers")
      return {
        url: "data:text/javascript,export const env = {};",
        shortCircuit: true,
      };
    const candidate = specifier.startsWith("@/")
      ? new URL(specifier.slice(2), root)
      : specifier.startsWith(".") && context.parentURL
        ? new URL(specifier, context.parentURL)
        : null;
    if (
      candidate?.protocol === "file:" &&
      !/\.[a-z]+$/.test(candidate.pathname) &&
      existsSync(new URL(`${candidate.href}.ts`))
    )
      return { url: `${candidate.href}.ts`, shortCircuit: true };
    return next(specifier, context);
  },
});
const queries = await import("../../db/queries.ts");
const annotations = await import("../../lib/annotations/queries.ts");
const annotationService = await import("../../lib/annotations/service.ts");
const posts = await import("../../lib/posts/service.ts");
const revisions = await import("../../lib/revisions/service.ts");
const purge = await import("../../lib/admin/purge-service.ts");
const gc = await import("../../lib/assets/gc.ts");
hooks.deregister();

test("large annotation and asset flows stay within D1 limits and preserve scope", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const file of (await readdir(new URL("../../drizzle/", import.meta.url)))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()) {
    for (const statement of (
      await readFile(new URL(`../../drizzle/${file}`, import.meta.url), "utf8")
    )
      .split("--> statement-breakpoint")
      .filter((value) => value.trim()))
      db.exec(statement);
  }
  let trips = 0;
  const prepare = (query: string, params: unknown[] = []) => {
    const execute = (raw = false, batch = false) => {
      assert.ok(params.length <= 100, `D1 bound parameter cap: ${params.length}`);
      const statement = db.prepare(query);
      assert.ok(statement.columns().length <= 100, "D1 selected column cap");
      if (batch) {
        const names = statement.columns().map((column) => column.name);
        assert.equal(new Set(names).size, names.length, "D1 batch needs unique SQL column names");
      }
      statement.setReturnArrays(raw);
      return statement.all(...(params as []));
    };
    return {
      bind: (...values: unknown[]) => prepare(query, values),
      raw: async () => {
        trips++;
        return execute(true);
      },
      all: async () => {
        trips++;
        return { results: execute(), success: true };
      },
      run: async () => {
        trips++;
        return { results: execute(), success: true };
      },
      batchResult: () => ({ results: execute(false, true), success: true }),
    };
  };
  const client = {
    prepare,
    batch: async (batch: ReturnType<typeof prepare>[]) => {
      trips++;
      db.exec("BEGIN");
      try {
        const result = batch.map((statement) => statement.batchResult());
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  // Use the production D1 driver: batch returns name-keyed objects, raw returns arrays.
  // Duplicate SQL column names must not be hidden by sqlite-proxy's array transport.
  useQueryDatabase(drizzle(client as unknown as D1Database));
  try {
    db.exec(
      "INSERT INTO users(id,email_key,display_name,bio,joined_at,updated_at) VALUES ('author','author@test','作者','',1,1),('reader','reader@test','读者','',1,1)",
    );
    db.exec(
      "INSERT INTO allowed_users(id,email,is_admin,added_at) VALUES ('author','author@test',1,1),('reader','reader@test',0,1)",
    );
    const ids = Array.from({ length: 100 }, () => `ann_${crypto.randomUUID()}`);
    const markdown =
      ids.map((id, i) => `:annotation[段落${i}]{#${id}}`).join("\n\n") + "\n\n新增文字";
    db.prepare(
      "INSERT INTO posts(id,author_id,title,markdown,search_text,published_at,last_activity_at,current_revision_id) VALUES ('p','author','标题',?,'正文',1000,1000,'r1')",
    ).run(markdown);
    db.prepare(
      "INSERT INTO post_revisions(id,post_id,revision_number,kind,title,markdown,created_at,created_by_user_id) VALUES ('r1','p',1,'CONTENT_EDIT','标题',?,1000,'author')",
    ).run(markdown);
    db.prepare(
      "INSERT INTO import_batches(id,importer_user_id,source_filename,source_sha256,post_id,revision_id,committed_at) VALUES ('batch','author','fixture.docx',?,'p','r1',1000)",
    ).run("0".repeat(64));
    for (const [i, id] of ids.entries()) {
      db.prepare(
        "INSERT INTO annotations(id,post_id,author_id,content_markdown,original_selected_text,created_at,created_on_revision_id,submission_key) VALUES (?,'p','author','批注','段落',?,'r1',?)",
      ).run(id, 1000 + i, id);
      db.prepare("INSERT INTO post_annotation_anchors VALUES ('p',?)").run(id);
      db.prepare(
        "INSERT INTO revision_annotation_states(revision_id,annotation_id) VALUES ('r1',?)",
      ).run(id);
    }
    const attachmentIds = Array.from({ length: 120 }, (_, i) => `asset-${i}`);
    for (const [i, id] of attachmentIds.entries()) {
      db.prepare(
        "INSERT INTO assets(id,owner_id,r2_key,kind,filename,mime_type,byte_size,status,created_at) VALUES (?,'author',?,'file','file.txt','text/plain',1,'permanent',1)",
      ).run(id, id);
      db.prepare(
        "INSERT INTO post_asset_refs(post_id,asset_id,usage) VALUES ('p',?,'attachment')",
      ).run(id);
      db.prepare(
        "INSERT INTO revision_asset_refs(revision_id,asset_id,usage) VALUES ('r1',?,'attachment')",
      ).run(id);
      db.prepare(
        "INSERT INTO annotation_replies(id,annotation_id,content_markdown,submission_key,created_at,source_type,source_author_name,source_comment_id,source_document_order,source_resolved,import_batch_id,imported_by_user_id) VALUES (?,?,'Word回复',?,1001,'DOCX_IMPORT','Word作者',?,?,0,'batch','author')",
      ).run(`reply-${i}`, ids[0], `docx:batch:${i}`, String(i), i);
      db.prepare(
        "INSERT INTO revision_imported_reply_states(revision_id,annotation_reply_id) VALUES ('r1',?)",
      ).run(`reply-${i}`);
    }
    db.exec("UPDATE annotation_replies SET attributed_user_id='reader' WHERE id='reply-0'");
    db.prepare(
      "INSERT INTO annotation_replies(id,annotation_id,author_id,content_markdown,submission_key,created_at,reply_to_user_id) VALUES ('native-reply',?,'reader','站内回复','native-key',1002,'author')",
    ).run(ids[0]);
    trips = 0;
    let threads = await annotations.listCurrentAnnotationThreads("p", "reader");
    assert.equal(threads.length, 100);
    assert.equal(threads[0].replies.length, 121);
    assert.equal(threads[0].annotation.id, ids[0]);
    assert.equal(threads[0].author.displayName, "作者");
    assert.ok(threads[0].annotation.createdAt instanceof Date);
    const imported = threads[0].replies.find((row) => row.reply.id === "reply-0")!;
    assert.equal(imported.author.displayName, "Word作者");
    assert.deepEqual(imported.author.attributedUser, { id: "reader", displayName: "读者" });
    assert.equal(imported.replyTo, null);
    assert.equal(
      threads[0].replies.find((row) => row.reply.id === "reply-1")!.author.attributedUser,
      null,
    );
    const native = threads[0].replies.find((row) => row.reply.id === "native-reply")!;
    assert.equal(native.author.id, "reader");
    assert.equal(native.author.displayName, "读者");
    assert.equal(native.replyTo?.id, "author");
    assert.equal(native.replyTo?.displayName, "作者");
    assert.ok(trips <= 2, `reading uses at most two trips, got ${trips}`);
    const newId = await annotationService.createAnnotation({
      postId: "p",
      authorId: "reader",
      baseRevisionId: "r1",
      submissionKey: crypto.randomUUID(),
      contentMarkdown: "第一百零一条",
      selection: {
        blockOrdinal: 100,
        endBlockOrdinal: 100,
        blockTextFrom: 0,
        blockTextTo: 4,
        selectedText: "新增文字",
      },
    });
    threads = await annotations.listCurrentAnnotationThreads("p", "reader");
    assert.equal(threads.length, 101);
    assert.equal(threads.at(-1)?.annotation.id, newId);
    assert.equal(threads.at(-1)?.author.id, "reader");
    const latest = (await queries.getPost("p", "author"))!.post.currentRevisionId!;
    trips = 0;
    const snapshot = await revisions.getRevisionSnapshot("p", latest);
    assert.equal(snapshot?.assets.length, 120);
    assert.equal(snapshot?.annotationStates.length, 101);
    assert.equal(snapshot?.importedReplyStates.length, 120);
    assert.ok(trips <= 2, `snapshot uses at most two trips, got ${trips}`);
    const restored = await revisions.restorePostRevision(
      "p",
      latest,
      "author",
      crypto.randomUUID(),
    );
    assert.equal(
      (await revisions.getRevisionSnapshot("p", restored))?.annotationStates.length,
      101,
    );
    assert.equal(await revisions.getRevisionSnapshot("other", restored), null);
    // Retired threads remain historical; replies must not leak into the current page.
    db.prepare("DELETE FROM post_annotation_anchors WHERE annotation_id=?").run(ids[0]);
    threads = await annotations.listCurrentAnnotationThreads("p", "reader");
    assert.equal(threads.length, 100);
    assert.ok(threads.every((thread) => thread.replies.length === 0));
    db.prepare("INSERT INTO post_annotation_anchors VALUES ('p',?)").run(ids[0]);
    db.prepare("UPDATE posts SET visibility_user_ids=? WHERE id='p'").run(
      JSON.stringify(["author"]),
    );
    assert.equal((await annotations.listCurrentAnnotationThreads("p", "reader")).length, 0);
    assert.equal((await annotations.listCurrentAnnotationThreads("p", "author")).length, 101);
    db.exec("UPDATE posts SET visibility_user_ids=NULL WHERE id='p'");

    const created = await posts.createPost("author", {
      title: "附件",
      markdown: "正文",
      tags: [],
      attachmentIds,
      submissionKey: crypto.randomUUID(),
    });
    const base = (await queries.getPost(created, "author"))!.post.currentRevisionId!;
    await posts.updatePost(created, "author", {
      title: "附件改",
      markdown: "修改正文",
      tags: [],
      attachmentIds,
      baseRevisionId: base,
    });
    await assert.rejects(
      posts.createPost("reader", {
        title: "越权",
        markdown: "正文",
        tags: [],
        attachmentIds,
        submissionKey: crypto.randomUUID(),
      }),
      /无权使用/,
    );
    await assert.rejects(
      posts.createPost("author", {
        title: "缺失资源",
        markdown: "正文",
        tags: [],
        attachmentIds: [...attachmentIds, "missing"],
        submissionKey: crypto.randomUUID(),
      }),
      /不存在/,
    );
    // Many event IDs are removed with the reply in a single transaction.
    for (let i = 0; i < 120; i++) {
      db.prepare(
        "INSERT INTO activity_events(id,actor_user_id,event_type,post_id,annotation_id,annotation_reply_id,created_at) VALUES (?,'author','ANNOTATION_REPLY_CREATED','p',?,'reply-0',1000)",
      ).run(`e-${i}`, ids[0]);
      db.prepare(
        "INSERT INTO notifications(id,recipient_user_id,actor_user_id,event_id,notification_type,post_id,annotation_id,annotation_reply_id,created_at) VALUES (?,'reader','author',?,'ANNOTATION_REPLY_RECEIVED','p',?,'reply-0',1000)",
      ).run(`n-${i}`, `e-${i}`, ids[0]);
    }
    assert.equal(
      await purge.purgeContentByAdmin(
        "annotation-replies",
        "reply-0",
        "author",
        crypto.randomUUID(),
      ),
      true,
    );
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM activity_events WHERE id LIKE 'e-%'").get()?.n,
      0,
    );
    assert.equal(db.prepare("SELECT count(*) AS n FROM annotation_replies").get()?.n, 120);
    assert.equal(
      await purge.purgeContentByAdmin("annotations", ids[0], "author", crypto.randomUUID()),
      true,
    );
    assert.equal((await annotations.listCurrentAnnotationThreads("p", "author")).length, 100);
    assert.equal(
      await purge.purgeContentByAdmin("posts", "p", "author", crypto.randomUUID()),
      true,
    );
    assert.equal(await queries.getPost("p", "author"), null);
    assert.ok(await queries.getPost(created, "author"), "unrelated post preserved");
    const dryRun = await gc.collectOrphanedAssets({ dryRun: true });
    assert.equal(dryRun.candidateCount, 0, "assets still referenced by another post are retained");
    db.exec(
      "INSERT INTO assets(id,owner_id,r2_key,kind,filename,mime_type,byte_size,status,created_at) VALUES ('orphan','author','orphan','file','file.txt','text/plain',1,'permanent',1)",
    );
    trips = 0;
    assert.equal((await gc.collectOrphanedAssets({ dryRun: true })).candidateCount, 1);
    assert.ok(trips <= 2, "orphan reference counts share one query");
  } finally {
    db.close();
  }
});
