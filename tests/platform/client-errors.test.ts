import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { clientErrorDetails, reportClientError } from "../../lib/client-errors.ts";
import { installPerformanceProbe } from "../../lib/performance/client.ts";
import { sanitizeClientRecord } from "../../lib/performance/shared.ts";

test("client diagnostics retain bundle positions while removing content and arbitrary URLs", () => {
  const error = Object.assign(new TypeError("secret quote and email@example.com"), {
    digest: "123456",
    stack: [
      "TypeError: private body",
      "at privateFunction (https://example.test/assets/reader-Ab123.js:12:34)",
      "render@https://example.test/_next/static/chunks/layout-A1.js:56:78",
      "at https://example.test/assets/private.js?token=secret:1:2",
      "at https://other.test/assets/external.js:1:2",
      "at https://example.test/uploads/private.js:1:2",
    ].join("\n"),
  });
  const details = clientErrorDetails(error, "https://example.test");
  assert.deepEqual(details, {
    errorName: "TypeError",
    errorCode: "UNEXPECTED_ERROR",
    frames: "reader-Ab123.js:12:34|layout-A1.js:56:78",
    renderDigest: "123456",
  });
  assert.equal(clientErrorDetails(new TypeError("Failed to fetch"), "").errorCode, "FETCH_FAILED");
  assert.equal(clientErrorDetails("secret rejection value", "").errorName, "Unknown");
  const incidentId = crypto.randomUUID();
  const clean = sanitizeClientRecord({
    kind: "client_error",
    incidentId,
    errorSource: "react",
    route: "/posts/private-id",
    ...details,
    message: error.message,
    stack: error.stack,
    formData: "private body",
  });
  assert.deepEqual(clean, {
    kind: "client_error",
    route: "/posts/:id",
    incidentId,
    errorSource: "react",
    ...details,
  });
  const hostile = sanitizeClientRecord({
    kind: "client_error",
    incidentId,
    errorSource: "action",
    errorName: "private",
    errorCode: "private",
    renderDigest: "private",
    frames: "https://example.test/private",
  });
  assert.deepEqual(hostile, {
    kind: "client_error",
    route: "/",
    incidentId,
    errorSource: "action",
  });
  assert.equal(
    sanitizeClientRecord({ kind: "client_error", incidentId: "private", errorSource: "react" }),
    null,
  );
  assert.equal(
    sanitizeClientRecord({ kind: "client_error", incidentId, errorSource: "private" }),
    null,
  );
});

test("global capture shares bounded transport, preserves browser behavior and survives telemetry failures", async (t) => {
  const browser = new Window({ url: "https://example.test/posts/private-id" });
  const globals: Record<string, unknown> = {
    window: browser,
    document: browser.document,
    location: browser.location,
    navigator: browser.navigator,
    ErrorEvent: browser.ErrorEvent,
    HTMLScriptElement: browser.HTMLScriptElement,
    HTMLLinkElement: browser.HTMLLinkElement,
    PerformanceObserver: undefined,
  };
  const original = Object.fromEntries(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const records: Array<Record<string, unknown>> = [];
  let failTransport = false;
  let sends = 0;
  const requestFailure = new TypeError("Failed to fetch");
  browser.fetch = async (url, init) => {
    if (url !== "/api/performance") throw requestFailure;
    sends++;
    if (failTransport) throw new Error("telemetry offline");
    records.push(...JSON.parse(String(init?.body)));
    return new browser.Response(null, { status: 204 });
  };
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  try {
    installPerformanceProbe();
    installPerformanceProbe();
    await t.test(
      "runtime, rejection, resource and React errors reach one sink without PerformanceObserver",
      async () => {
        const error = new ReferenceError("private body");
        const event = new browser.ErrorEvent("error", {
          error,
          message: error.message,
          cancelable: true,
        });
        browser.dispatchEvent(event);
        await settle();
        assert.equal(event.defaultPrevented, false);
        assert.equal(records.length, 1, "installing twice must not duplicate listeners");
        assert.equal(records[0].errorSource, "runtime");
        assert.equal(
          reportClientError(error, "react"),
          records[0].incidentId,
          "same exception keeps its reference across boundaries",
        );
        const rejection = new browser.Event("unhandledrejection", { cancelable: true });
        Object.assign(rejection, { reason: new RangeError("private") });
        browser.dispatchEvent(rejection);
        await settle();
        assert.equal(rejection.defaultPrevented, false);
        const script = browser.document.createElement("script");
        browser.document.body.appendChild(script);
        script.dispatchEvent(new browser.Event("error"));
        await settle();
        reportClientError(new SyntaxError("private"), "react");
        await settle();
        assert.deepEqual(
          records.map((row) => row.errorSource),
          ["runtime", "unhandledrejection", "resource", "react"],
        );
        assert.equal(records[2].errorCode, "RESOURCE_LOAD_FAILED");
        assert.ok(records.every((row) => row.route === "/posts/:id"));
        assert.doesNotMatch(JSON.stringify(records), /private/);
      },
    );
    await t.test("equivalent errors deduplicate and a flood is bounded", async () => {
      const a = reportClientError(new URIError("first private text"), "action");
      await settle();
      const count = records.length;
      assert.equal(reportClientError(new URIError("second private text"), "action"), a);
      await settle();
      assert.equal(records.length, count);
      for (let i = 0; i < 40; i++) {
        const error = new Error("private");
        error.stack = `at https://example.test/assets/app-abc.js:${i + 1}:2`;
        reportClientError(error, "runtime");
        await settle();
      }
      assert.equal(records.length, 20);
    });
    await t.test("failed reporting is dropped and fetch keeps the original rejection", async () => {
      failTransport = true;
      await assert.rejects(browser.fetch("/posts/x"), (error) => error === requestFailure);
      const before = sends;
      browser.dispatchEvent(new browser.Event("pagehide"));
      await settle();
      assert.equal(sends, before + 1);
      browser.dispatchEvent(new browser.Event("pagehide"));
      await settle();
      assert.equal(sends, before + 1, "telemetry failures do not replay or recursively report");
      assert.doesNotThrow(() =>
        reportClientError(
          {
            get stack() {
              throw new Error("hostile");
            },
          },
          "action",
        ),
      );
    });
  } finally {
    await browser.happyDOM.close();
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
