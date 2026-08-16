import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { bumpVersion, releaseParts } from "../tools/bump-version.mjs";

const read = async (file) =>
  readFile(new URL(`../${file}`, import.meta.url), "utf8");

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener, options = {}) {
    const entries = this.listeners.get(type) || [];
    entries.push({ listener, once: Boolean(options?.once) });
    this.listeners.set(type, entries);
  }

  removeEventListener(type, listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) || []).filter((entry) => entry.listener !== listener),
    );
  }

  dispatchEvent(event) {
    const entries = [...(this.listeners.get(event.type) || [])];
    for (const entry of entries) {
      entry.listener.call(this, event);
      if (entry.once) this.removeEventListener(event.type, entry.listener);
    }
    return true;
  }
}

async function runUpdateManager({
  controllerVersion = null,
  waitingVersion = null,
  skipThrows = false,
  updateRejects = false,
  online = true,
} = {}) {
  const source = await read("js/pwa-update.js");
  const elements = new Map(
    ["update-banner", "update-title", "update-detail", "update-reload", "update-dismiss"]
      .map((id) => [id, Object.assign(new FakeEventTarget(), {
        id,
        hidden: false,
        disabled: false,
        textContent: "",
      })]),
  );
  const bodyClasses = new Set();
  const document = Object.assign(new FakeEventTarget(), {
    readyState: "loading",
    visibilityState: "visible",
    body: {
      classList: {
        toggle: (name, on) => (on ? bodyClasses.add(name) : bodyClasses.delete(name)),
      },
    },
    querySelector: (selector) => elements.get(selector.replace(/^#/, "")) || null,
  });
  const messages = [];
  const serviceWorker = new FakeEventTarget();
  const registration = Object.assign(new FakeEventTarget(), {
    installing: null,
    waiting: null,
    update: async () => {
      if (updateRejects) throw new Error("offline");
    },
  });

  function makeWorker(version, state) {
    const worker = Object.assign(new FakeEventTarget(), {
      version,
      state,
      postMessage(data, ports = []) {
        messages.push(data.type);
        if (data.type === "ECHO_GET_VERSION") {
          ports[0]?.postMessage({ type: "ECHO_VERSION", version, cache: "v-test" });
        }
        if (data.type === "ECHO_SKIP_WAITING") {
          if (skipThrows) throw new Error("worker is no longer available");
          registration.waiting = null;
          worker.state = "activated";
          serviceWorker.controller = worker;
          serviceWorker.dispatchEvent({ type: "controllerchange" });
        }
      },
    });
    return worker;
  }

  serviceWorker.controller = controllerVersion
    ? makeWorker(controllerVersion, "activated")
    : null;
  registration.waiting = waitingVersion
    ? makeWorker(waitingVersion, "installed")
    : null;
  if (!controllerVersion && !waitingVersion) {
    registration.installing = makeWorker("2026.08.16.1", "installing");
  }
  serviceWorker.register = async () => registration;

  let reloads = 0;
  const location = {
    protocol: "https:",
    reload: () => { reloads += 1; },
  };
  const window = Object.assign(new FakeEventTarget(), {
    ECHO_VERSION: { app: "2026.08.16.1", cache: "v202608161" },
    location,
  });
  const navigator = { serviceWorker, onLine: online };

  class FakeMessageChannel {
    constructor() {
      this.port1 = { onmessage: null };
      this.port2 = {
        postMessage: (data) => this.port1.onmessage?.({ data }),
      };
    }
  }

  class FakeCustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }

  runInNewContext(source, {
    window,
    document,
    navigator,
    location,
    CustomEvent: FakeCustomEvent,
    MessageChannel: FakeMessageChannel,
    WeakSet,
    Promise,
    setTimeout,
    clearTimeout,
  });
  window.dispatchEvent({ type: "load" });
  await new Promise((resolve) => setTimeout(resolve, 10));

  return {
    bodyClasses,
    document,
    elements,
    manager: window.EchoUpdate,
    messages,
    registration,
    serviceWorker,
    changeController(version) {
      serviceWorker.controller = makeWorker(version, "activated");
      serviceWorker.dispatchEvent({ type: "controllerchange" });
    },
    get reloads() { return reloads; },
  };
}

test("App, package and cache versions follow the release contract", async () => {
  const [source, packageSource] = await Promise.all([
    read("js/version.js"),
    read("package.json"),
  ]);
  const context = {};
  runInNewContext(source, context);
  const version = context.ECHO_VERSION;
  const packageJson = JSON.parse(packageSource);

  assert.match(version.app, /^\d{4}\.\d{2}\.\d{2}\.\d+$/);
  assert.match(version.cache, /^v\d+$/);
  assert.equal(version.cache, `v${version.app.replace(/\D/g, "")}`);
  assert.equal(
    packageJson.version,
    version.app.split(".").slice(0, 3).map(Number).join("."),
    "package version tracks the PWA release date",
  );
  assert.equal(packageJson.scripts["version:bump"], "node tools/bump-version.mjs");
  assert.deepEqual(releaseParts("2026.08.17.2"), {
    year: "2026",
    month: "08",
    day: "17",
    sequence: "2",
  });
  assert.throws(() => releaseParts("2026.02.30.1"), /日期不存在/);
});

test("the bump command updates release and package metadata together", async () => {
  const root = await mkdtemp(join(tmpdir(), "echo-version-test-"));
  try {
    await mkdir(join(root, "js"));
    await Promise.all([
      writeFile(join(root, "js", "version.js"), 'const app = "2026.08.16.1";\n'),
      writeFile(
        join(root, "package.json"),
        `${JSON.stringify({ name: "echo", version: "2026.8.16" }, null, 2)}\n`,
      ),
    ]);

    assert.deepEqual(await bumpVersion("2026.08.17.2", root), {
      app: "2026.08.17.2",
      package: "2026.8.17",
    });
    assert.match(
      await readFile(join(root, "js", "version.js"), "utf8"),
      /const app = "2026\.08\.17\.2";/,
    );
    assert.equal(
      JSON.parse(await readFile(join(root, "package.json"), "utf8")).version,
      "2026.8.17",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the page wires the visible update manager and persistent settings entry", async () => {
  const [index, settings, styles] = await Promise.all([
    read("index.html"),
    read("js/views/settings.js"),
    read("css/style.css"),
  ]);
  const versionAt = index.indexOf('src="./js/version.js"');
  const appAt = index.indexOf('src="./js/app.js"');
  const updateAt = index.indexOf('src="./js/pwa-update.js"');

  assert.ok(versionAt >= 0);
  assert.ok(appAt > versionAt);
  assert.ok(updateAt > appAt);
  for (const id of ["update-banner", "update-reload", "update-dismiss"]) {
    assert.match(index, new RegExp(`id="${id}"`));
  }
  assert.match(styles, /\.update-banner/);
  assert.match(settings, /App 與更新/);
  assert.match(settings, /window\.EchoUpdate/);
  assert.match(settings, /echo:update-status/);
});

test("the Service Worker and page manager share the version message protocol", async () => {
  const [worker, manager] = await Promise.all([
    read("sw.js"),
    read("js/pwa-update.js"),
  ]);

  assert.match(worker, /importScripts\("\.\/js\/version\.js"\)/);
  assert.match(worker, /self\.ECHO_VERSION\.cache/);
  assert.match(worker, /`echo-\$\{VERSION\}`/);
  assert.match(worker, /"\.\/js\/version\.js"/);
  assert.match(worker, /"\.\/js\/pwa-update\.js"/);
  assert.match(manager, /updateViaCache:\s*"none"/);

  for (const message of [
    "ECHO_GET_VERSION",
    "ECHO_VERSION",
    "ECHO_UPDATE_READY",
    "ECHO_SKIP_WAITING",
  ]) {
    assert.match(worker, new RegExp(message));
    assert.match(manager, new RegExp(message));
  }

  const installBlock = worker.slice(
    worker.indexOf('self.addEventListener("install"'),
    worker.indexOf('self.addEventListener("activate"'),
  );
  assert.doesNotMatch(installBlock, /skipWaiting/);
  assert.doesNotMatch(worker, /BOOTSTRAP_RELEASE|client\.navigate/);
});

test("deployment headers do not let HTTP cache hide a release", async () => {
  const firebase = JSON.parse(await read("firebase.json"));
  for (const source of ["/", "/sw.js", "/js/version.js"]) {
    const rule = firebase.hosting.headers.find((entry) => entry.source === source);
    assert.ok(rule, `${source} has an explicit cache rule`);
    assert.ok(
      rule.headers.some(
        (header) =>
          header.key === "Cache-Control" &&
          header.value.includes("no-cache") &&
          header.value.includes("no-store"),
      ),
      `${source} bypasses persistent HTTP caches`,
    );
  }
  const indexRule = firebase.hosting.headers.find(
    (entry) => entry.source === "/index.html",
  );
  assert.ok(
    indexRule?.headers.some(
      (header) =>
        header.key === "Cache-Control" && header.value.includes("no-cache"),
    ),
    "/index.html revalidates before use",
  );
});

test("first install stays quiet while a waiting upgrade is actionable", async () => {
  const firstInstall = await runUpdateManager();
  assert.equal(firstInstall.manager.getStatus().phase, "installing");
  assert.equal(firstInstall.manager.getStatus().updateReady, false);
  assert.equal(firstInstall.elements.get("update-banner").hidden, true);

  const upgrade = await runUpdateManager({
    controllerVersion: "2026.08.16.1",
    waitingVersion: "2026.08.17.1",
  });
  assert.equal(upgrade.manager.getStatus().phase, "ready");
  assert.equal(upgrade.manager.getStatus().availableVersion, "2026.08.17.1");
  assert.equal(upgrade.elements.get("update-banner").hidden, false);
  assert.match(upgrade.elements.get("update-detail").textContent, /2026\.08\.17\.1/);

  upgrade.elements.get("update-dismiss").dispatchEvent({ type: "click" });
  assert.equal(upgrade.manager.getStatus().dismissed, true);
  assert.equal(upgrade.elements.get("update-banner").hidden, true);
  upgrade.manager.showPrompt();
  assert.equal(upgrade.elements.get("update-banner").hidden, false);

  await upgrade.manager.applyUpdate();
  assert.ok(upgrade.messages.includes("ECHO_SKIP_WAITING"));
  assert.equal(upgrade.reloads, 1);
});

test("peer tabs reload once when another tab activates the release", async () => {
  const peer = await runUpdateManager({ controllerVersion: "2026.08.16.1" });
  assert.equal(peer.manager.getStatus().phase, "current");

  peer.changeController("2026.08.17.1");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(peer.reloads, 1);
  peer.serviceWorker.dispatchEvent({ type: "controllerchange" });
  assert.equal(peer.reloads, 1, "controller changes cannot start a reload loop");
});

test("failed activation and failed checks stay honest and retryable", async () => {
  const failedActivation = await runUpdateManager({
    controllerVersion: "2026.08.16.1",
    waitingVersion: "2026.08.17.1",
    skipThrows: true,
  });
  assert.equal(await failedActivation.manager.applyUpdate(), false);
  assert.equal(failedActivation.reloads, 0);
  assert.equal(failedActivation.manager.getStatus().phase, "ready");
  assert.equal(failedActivation.manager.getStatus().activationFailed, true);
  assert.equal(
    failedActivation.elements.get("update-reload").textContent,
    "再試一次",
  );

  const offline = await runUpdateManager({
    controllerVersion: "2026.08.16.1",
    updateRejects: true,
    online: false,
  });
  assert.equal(offline.manager.getStatus().phase, "error");

  const brokenInstall = await runUpdateManager();
  brokenInstall.registration.installing.state = "redundant";
  brokenInstall.registration.installing.dispatchEvent({ type: "statechange" });
  assert.equal(brokenInstall.manager.getStatus().phase, "error");
});
