/* Tiny DOM helpers. No framework — this app ships as plain files with no build step. */

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function")
      node.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

/**
 * Replace a host's children, dropping conditional blanks.
 * Native replaceChildren() stringifies null into the literal text "null",
 * so every `cond ? node : null` in a view has to be filtered out first.
 */
export function mount(host, ...children) {
  host.replaceChildren(
    ...children
      .flat(Infinity)
      .filter((c) => c != null && c !== false && c !== ""),
  );
  return host;
}

let toastTimer = null;
export function toast(msg, ms = 2600) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("is-on"), ms);
}

export function backButton(label = "返回", href = null) {
  return el(
    "button",
    {
      class: "back",
      onclick: () => (href ? (location.hash = href) : history.back()),
    },
    [
      el("span", { html: "&#8249;", style: "font-size:20px;line-height:1" }),
      label,
    ],
  );
}

export function emptyState(text, sub = "") {
  return el("div", { class: "empty" }, [
    el("div", {
      html: '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01M9 15c.8-.7 1.8-1 3-1s2.2.3 3 1"/></svg>',
    }),
    el("div", { text }),
    sub
      ? el("div", { class: "muted", style: "margin-top:6px", text: sub })
      : null,
  ]);
}

export function levelBadge(level) {
  return el("span", { class: `badge badge-l${level}`, text: `L${level}` });
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Focus-trapping-free confirm dialog built from the app's own styles. */
export function confirmBox(message, confirmLabel = "確定") {
  return new Promise((resolve) => {
    const wrap = el("div", {
      style: `position:fixed;inset:0;z-index:80;display:grid;place-items:center;
              background:rgba(0,0,0,.55);padding:24px`,
    });
    const box = el(
      "div",
      { class: "card", style: "max-width:340px;width:100%;margin:0" },
      [
        el("p", {
          style: "color:var(--text);margin-bottom:16px",
          text: message,
        }),
        el("div", { class: "btn-row" }, [
          el("button", { class: "btn", onclick: () => close(false) }, ["取消"]),
          el(
            "button",
            { class: "btn btn-danger", onclick: () => close(true) },
            [confirmLabel],
          ),
        ]),
      ],
    );
    const close = (v) => {
      wrap.remove();
      resolve(v);
    };
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) close(false);
    });
    wrap.append(box);
    document.body.append(wrap);
  });
}
