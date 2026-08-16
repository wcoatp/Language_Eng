/* Echo PWA — App and Service Worker shared release version. */
(function exposeEchoVersion(root) {
  "use strict";

  const app = "2026.08.16.1";
  const version = Object.freeze({
    app,
    // Derive the shell generation from the visible release. It is impossible
    // to bump one without the other and overwrite a cache still in use.
    cache: `v${app.replace(/\D/g, "")}`,
  });

  root.ECHO_VERSION = version;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = version;
  }
})(typeof self !== "undefined" ? self : globalThis);
