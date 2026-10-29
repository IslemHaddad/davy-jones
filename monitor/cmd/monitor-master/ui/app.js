"use strict";

// The admin token lives in sessionStorage: it survives a reload but not
// closing the tab. Every value from the server is rendered with textContent,
// never innerHTML, because check names, commands and output are free text.
const TOKEN_KEY = "monitor_admin_token";
let token = "";
try { token = sessionStorage.getItem(TOKEN_KEY) || ""; } catch (_) {}

const $ = (id) => document.getElementById(id);
let workers = [];
let editingCheckId = null;
let refreshTimer = null;

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401) {
    signOut();
    throw new Error("Signed out: the admin token was rejected.");
  }
  if (!res.ok) throw new Error((data && data.error) || res.statusText);
  return data;
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") node.textContent = v;
    else if (k === "onclick") node.addEventListener("click", v);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

function fmtTime(iso) {
  if (!iso || iso.startsWith("0001-")) return "—";
  return new Date(iso).toLocaleString();
}

function flash(message, ok = false) {
  const f = $("flash");
  f.textContent = message;
  f.className = ok ? "flash ok" : "flash";
  f.hidden = false;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => (f.hidden = true), 5000);
}

async function guarded(fn) {
  try { await fn(); } catch (e) { flash(e.message); }
}

// ---- auth ----

function signOut() {
  token = "";
  try { sessionStorage.removeItem(TOKEN_KEY); } catch (_) {}
  clearInterval(refreshTimer);
  $("app").hidden = true;
  $("login").hidden = false;
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  token = $("login-token").value.trim();
  try {
    await api("GET", "/api/admin/workers");
  } catch (err) {
    $("login-error").textContent = "Invalid admin token.";
    return;
  }
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch (_) {}
  $("login-error").textContent = "";
  $("login-token").value = "";
  start();
});

$("logout").addEventListener("click", signOut);

// ---- tabs ----

function showTab(name) {
  document.querySelectorAll("nav button").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll("[data-panel]").forEach((p) =>
    (p.hidden = p.dataset.panel !== name));
  if (name === "status") guarded(loadStatus);
  if (name === "checks") guarded(loadChecks);
  if (name === "workers") guarded(loadWorkers);
  if (name === "settings") guarded(loadSettings);
}
document.querySelectorAll("nav button").forEach((b) =>
  b.addEventListener("click", () => showTab(b.dataset.tab)));

// ---- status ----

async function loadStatus() {
  const rows = await api("GET", "/api/admin/status");
  const body = $("status-body");
  body.replaceChildren();
  $("status-empty").hidden = rows.length > 0;
  for (const r of rows) {
    const s = r.status;
    let pill;
    if (!r.check.enabled) pill = el("span", { class: "pill pending", text: "disabled" });
    else if (!s.known) pill = el("span", { class: "pill pending", text: "pending" });
    else if (s.ok) pill = el("span", { class: "pill ok", text: "true" });
    else pill = el("span", { class: "pill bad", text: "false" });
    body.append(el("tr", {}, [
      el("td", {}, [pill]),
      el("td", { text: r.workerName }),
      el("td", { text: r.check.name }),
      el("td", { text: s.known ? String(s.exitCode) : "—" }),
      el("td", { text: fmtTime(s.lastRun) }),
      el("td", { text: s.known ? fmtTime(s.since) : "—" }),
      el("td", { class: "out", text: s.output || "" }),
    ]));
  }
}

// ---- workers ----

async function loadWorkers() {
  workers = await api("GET", "/api/admin/workers");
  const body = $("workers-body");
  body.replaceChildren();
  for (const w of workers) {
    const state = w.lastSeen.startsWith("0001-")
      ? el("span", { class: "pill pending", text: "never seen" })
      : w.silent
        ? el("span", { class: "pill bad", text: "silent" })
        : el("span", { class: "pill ok", text: "reporting" });
    body.append(el("tr", {}, [
      el("td", { text: w.name }),
      el("td", { text: fmtTime(w.lastSeen) }),
      el("td", {}, [state]),
      el("td", { class: "btns" }, [
        el("button", { class: "ghost small", text: "Rotate token", onclick: () => guarded(async () => {
          if (!confirm(`Rotate the token for ${w.name}? The current one stops working immediately.`)) return;
          const res = await api("POST", `/api/admin/workers/${encodeURIComponent(w.id)}/rotate`);
          showToken(w.name, res.token);
        }) }),
        el("button", { class: "danger small", text: "Delete", onclick: () => guarded(async () => {
          if (!confirm(`Delete worker ${w.name} and all of its checks?`)) return;
          await api("DELETE", `/api/admin/workers/${encodeURIComponent(w.id)}`);
          await loadWorkers();
        }) }),
      ]),
    ]));
  }
}

function showToken(name, value) {
  $("token-worker").textContent = name;
  $("token-value").textContent = value;
  $("token-master").textContent = location.origin;
  $("token-box").hidden = false;
}
$("token-dismiss").addEventListener("click", () => {
  $("token-value").textContent = "";
  $("token-box").hidden = true;
});

$("worker-form").addEventListener("submit", (e) => {
  e.preventDefault();
  guarded(async () => {
    const res = await api("POST", "/api/admin/workers", { name: $("worker-name").value });
    $("worker-name").value = "";
    showToken(res.worker.name, res.token);
    await loadWorkers();
  });
});

// ---- checks ----

function workerName(id) {
  const w = workers.find((x) => x.id === id);
  return w ? w.name : id;
}

async function loadChecks() {
  workers = await api("GET", "/api/admin/workers");
  const select = $("check-worker");
  const current = select.value;
  select.replaceChildren(...workers.map((w) => el("option", { value: w.id, text: w.name })));
  if (current) select.value = current;

  const checks = await api("GET", "/api/admin/checks");
  const body = $("checks-body");
  body.replaceChildren();
  for (const c of checks) {
    body.append(el("tr", {}, [
      el("td", { text: workerName(c.workerId) }),
      el("td", { text: c.name }),
      el("td", { class: "cmd", text: c.command }),
      el("td", { text: c.intervalSeconds + "s" }),
      el("td", { text: c.enabled ? "yes" : "no" }),
      el("td", { class: "btns" }, [
        el("button", { class: "ghost small", text: "Edit", onclick: () => editCheck(c) }),
        el("button", { class: "danger small", text: "Delete", onclick: () => guarded(async () => {
          if (!confirm(`Delete check "${c.name}"?`)) return;
          await api("DELETE", `/api/admin/checks/${encodeURIComponent(c.id)}`);
          if (editingCheckId === c.id) resetCheckForm();
          await loadChecks();
        }) }),
      ]),
    ]));
  }
}

function editCheck(c) {
  editingCheckId = c.id;
  $("check-worker").value = c.workerId;
  $("check-name").value = c.name;
  $("check-command").value = c.command;
  $("check-interval").value = c.intervalSeconds;
  $("check-timeout").value = c.timeoutSeconds;
  $("check-enabled").checked = c.enabled;
  $("check-form-title").textContent = "Edit check";
  $("check-submit").textContent = "Save check";
  $("check-cancel").hidden = false;
  $("check-form").scrollIntoView({ behavior: "smooth" });
}

function resetCheckForm() {
  editingCheckId = null;
  $("check-form").reset();
  $("check-form-title").textContent = "New check";
  $("check-submit").textContent = "Add check";
  $("check-cancel").hidden = true;
}
$("check-cancel").addEventListener("click", resetCheckForm);

$("check-form").addEventListener("submit", (e) => {
  e.preventDefault();
  guarded(async () => {
    if (!$("check-worker").value) throw new Error("Add a worker first.");
    const body = {
      workerId: $("check-worker").value,
      name: $("check-name").value,
      command: $("check-command").value,
      intervalSeconds: Number($("check-interval").value),
      timeoutSeconds: Number($("check-timeout").value),
      enabled: $("check-enabled").checked,
    };
    if (editingCheckId) {
      await api("PUT", `/api/admin/checks/${encodeURIComponent(editingCheckId)}`, body);
      flash("Check saved.", true);
    } else {
      await api("POST", "/api/admin/checks", body);
      flash("Check added. The worker picks it up on its next poll.", true);
    }
    resetCheckForm();
    await loadChecks();
  });
});

// ---- settings ----

async function loadSettings() {
  const s = await api("GET", "/api/admin/settings");
  $("webhook-url").value = s.webhookUrl || "";
  const config = await api("GET", "/api/admin/config");
  $("config-json").textContent = JSON.stringify(config, null, 2);
}

$("settings-form").addEventListener("submit", (e) => {
  e.preventDefault();
  guarded(async () => {
    await api("PUT", "/api/admin/settings", { webhookUrl: $("webhook-url").value });
    flash("Webhook saved.", true);
    await loadSettings();
  });
});

$("webhook-test").addEventListener("click", () => guarded(async () => {
  await api("POST", "/api/admin/settings/test");
  flash("Test notification delivered.", true);
}));

// ---- boot ----

function start() {
  $("login").hidden = true;
  $("app").hidden = false;
  showTab("status");
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (!$("app").hidden && !document.querySelector('[data-panel="status"]').hidden) {
      loadStatus().catch(() => {});
    }
  }, 10000);
}

if (token) {
  api("GET", "/api/admin/workers").then(start, signOut);
} else {
  signOut();
}
