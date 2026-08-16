/* Echo PWA — visible, user-controlled Service Worker updates. */
(() => {
  "use strict";

  const pageVersion = window.ECHO_VERSION || {
    app: "unknown",
    cache: "unknown",
  };
  const observedRegistrations = new WeakSet();
  const observedWorkers = new WeakSet();
  let hadController =
    "serviceWorker" in navigator && Boolean(navigator.serviceWorker.controller);
  let controllerChangeCount = 0;
  let reloadStarted = false;
  const state = {
    phase: "idle",
    pageVersion: pageVersion.app,
    workerVersion: null,
    availableVersion: null,
    registration: null,
    dismissed: false,
    activationFailed: false,
  };

  const $ = (selector) => document.querySelector(selector);

  function getStatus() {
    return {
      phase: state.phase,
      pageVersion: state.pageVersion,
      workerVersion: state.workerVersion,
      availableVersion: state.availableVersion,
      updateReady: state.phase === "ready" || state.phase === "applying",
      dismissed: state.dismissed,
      activationFailed: state.activationFailed,
    };
  }

  function renderBanner() {
    const banner = $("#update-banner");
    if (!banner) return;

    const visible =
      (state.phase === "ready" || state.phase === "applying") &&
      !state.dismissed;
    banner.hidden = !visible;
    document.body.classList.toggle("update-ready", visible);
    if (!visible) return;

    const applying = state.phase === "applying";
    const failed = state.activationFailed;
    $("#update-title").textContent = applying
      ? "正在套用新版…"
      : failed
        ? "新版尚未套用"
        : "新版已就緒";
    $("#update-detail").textContent = failed
      ? "目前版本仍可繼續使用,請再試一次。"
      : state.availableVersion
        ? `目前 v${state.pageVersion},新版 v${state.availableVersion} 已下載完成。`
        : `目前 v${state.pageVersion},新版已下載完成。`;
    const reloadButton = $("#update-reload");
    reloadButton.disabled = applying;
    reloadButton.textContent = applying
      ? "更新中…"
      : failed
        ? "再試一次"
        : "重新載入更新";
  }

  function emitStatus() {
    renderBanner();
    window.dispatchEvent(
      new CustomEvent("echo:update-status", { detail: getStatus() }),
    );
  }

  function setPhase(phase, patch = {}) {
    Object.assign(state, patch, { phase });
    emitStatus();
  }

  function reloadOnce() {
    if (reloadStarted) return false;
    reloadStarted = true;
    window.location.reload();
    return true;
  }

  function markWorkerVersion(workerVersion) {
    if (typeof workerVersion !== "string" || !workerVersion) return;
    state.workerVersion = workerVersion;
    if (state.phase === "applying") {
      emitStatus();
      return;
    }
    if (workerVersion !== state.pageVersion) {
      const sameUpdate = state.availableVersion === workerVersion;
      const pendingUnknownVersion =
        state.phase === "ready" && state.availableVersion == null;
      setPhase("ready", {
        availableVersion: workerVersion,
        dismissed:
          sameUpdate || pendingUnknownVersion ? state.dismissed : false,
        activationFailed:
          sameUpdate || pendingUnknownVersion ? state.activationFailed : false,
      });
    } else if (state.phase === "ready") {
      // The current controller can answer while a newer worker is waiting.
      // Keep the pending update instead of incorrectly reporting "current".
      emitStatus();
    } else {
      setPhase("current", {
        availableVersion: null,
        dismissed: false,
        activationFailed: false,
      });
    }
  }

  function handleWorkerMessage(event) {
    const data = event.data || {};
    if (data.type === "ECHO_VERSION" || data.type === "ECHO_UPDATE_READY") {
      markWorkerVersion(data.version);
    }
  }

  function requestWorkerVersion(worker = navigator.serviceWorker.controller) {
    return new Promise((resolve) => {
      if (!worker) {
        resolve(null);
        return;
      }

      const channel = new MessageChannel();
      let settled = false;
      const finish = (version) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (version) markWorkerVersion(version);
        resolve(version || null);
      };
      const timer = setTimeout(() => finish(null), 1500);
      channel.port1.onmessage = (event) => {
        const data = event.data || {};
        finish(data.type === "ECHO_VERSION" ? data.version : null);
      };
      try {
        worker.postMessage({ type: "ECHO_GET_VERSION" }, [channel.port2]);
      } catch {
        finish(null);
      }
    });
  }

  function watchWorker(worker, replacingExisting) {
    if (!worker || observedWorkers.has(worker)) return;
    observedWorkers.add(worker);
    const handleState = () => {
      if (worker.state === "installed" && replacingExisting) {
        setPhase("ready", {
          availableVersion: null,
          dismissed: false,
          activationFailed: false,
        });
        requestWorkerVersion(worker);
      }
      if (worker.state === "activated") {
        setTimeout(
          () => requestWorkerVersion(navigator.serviceWorker.controller || worker),
          0,
        );
      }
      if (
        worker.state === "redundant" &&
        state.phase !== "ready" &&
        state.phase !== "applying"
      ) {
        setPhase("error", { activationFailed: false });
      }
    };
    worker.addEventListener("statechange", handleState);
    handleState();
  }

  function observeRegistration(registration) {
    state.registration = registration;
    if (observedRegistrations.has(registration)) return;
    observedRegistrations.add(registration);

    watchWorker(
      registration.installing,
      Boolean(navigator.serviceWorker.controller || state.workerVersion),
    );
    registration.addEventListener("updatefound", () => {
      watchWorker(
        registration.installing,
        Boolean(navigator.serviceWorker.controller || state.workerVersion),
      );
    });
    if (registration.waiting && navigator.serviceWorker.controller) {
      setPhase("ready", { availableVersion: null, dismissed: false });
      requestWorkerVersion(registration.waiting);
    }
  }

  async function checkNow() {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") {
      setPhase("unsupported");
      return;
    }
    if (state.phase !== "ready" && state.phase !== "applying") {
      setPhase("checking", { activationFailed: false });
    }

    try {
      const registration = await navigator.serviceWorker.register("./sw.js", {
        updateViaCache: "none",
      });
      observeRegistration(registration);
      await requestWorkerVersion();
      try {
        await registration.update();
      } catch {
        // The installed version remains usable, but a failed server check is
        // not proof that it is the latest release.
        if (state.phase !== "ready" && state.phase !== "applying") {
          setPhase("error");
        }
        return;
      }
      if (registration.waiting && navigator.serviceWorker.controller) {
        setPhase("ready", {
          availableVersion: state.availableVersion,
          dismissed: state.dismissed,
        });
        await requestWorkerVersion(registration.waiting);
      }
      await requestWorkerVersion();

      if (state.phase === "checking") {
        if (registration.installing || !navigator.serviceWorker.controller) {
          setPhase("installing");
        } else if (!state.workerVersion) {
          setPhase("unknown");
        } else {
          setPhase("current");
        }
      }
    } catch {
      const version = await requestWorkerVersion();
      if (state.phase !== "ready") {
        setPhase("error", { workerVersion: version || state.workerVersion });
      }
    }
  }

  function showPrompt() {
    if (state.phase !== "ready") return;
    state.dismissed = false;
    emitStatus();
  }

  function dismissPrompt() {
    if (state.phase !== "ready") return;
    state.dismissed = true;
    emitStatus();
  }

  async function applyUpdate() {
    if (state.phase !== "ready") return false;
    setPhase("applying", { dismissed: false, activationFailed: false });
    const controllerChangesBeforeApply = controllerChangeCount;

    const waiting = state.registration && state.registration.waiting;
    if (waiting) {
      const changed = await new Promise((resolve) => {
        let settled = false;
        const finish = (didChange) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          navigator.serviceWorker.removeEventListener("controllerchange", onChange);
          resolve(didChange);
        };
        const onChange = () => finish(true);
        const timer = setTimeout(() => finish(false), 2500);
        navigator.serviceWorker.addEventListener("controllerchange", onChange);
        try {
          waiting.postMessage({ type: "ECHO_SKIP_WAITING" });
        } catch {
          finish(false);
        }
      });
      if (changed || controllerChangeCount > controllerChangesBeforeApply) {
        reloadOnce();
        return true;
      }
    }

    const activeVersion = await requestWorkerVersion();
    if (
      controllerChangeCount > controllerChangesBeforeApply ||
      (activeVersion && activeVersion !== state.pageVersion)
    ) {
      reloadOnce();
      return true;
    }
    setPhase("ready", { dismissed: false, activationFailed: true });
    return false;
  }

  window.EchoUpdate = Object.freeze({
    applyUpdate,
    checkNow,
    getStatus,
    showPrompt,
  });

  $("#update-reload")?.addEventListener("click", applyUpdate);
  $("#update-dismiss")?.addEventListener("click", dismissPrompt);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", handleWorkerMessage);
    navigator.serviceWorker.addEventListener("controllerchange", async () => {
      controllerChangeCount += 1;
      const upgradedExistingPage = hadController;
      hadController = true;
      // If another tab accepted the release, this tab must not keep running
      // old app.js while the new worker serves its lazy route modules.
      if (upgradedExistingPage && state.phase !== "applying") {
        reloadOnce();
        return;
      }
      await requestWorkerVersion();
    });
  }
  window.addEventListener("online", () => {
    if (state.phase === "error" || state.phase === "unknown") checkNow();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.phase !== "applying") {
      checkNow();
    }
  });

  emitStatus();
  if (document.readyState === "complete") checkNow();
  else window.addEventListener("load", checkNow, { once: true });
})();
