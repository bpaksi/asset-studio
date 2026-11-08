// The whole page: HTML, CSS and a small plain script. Nothing is built or
// fetched from elsewhere. Dynamic text is only ever set with textContent.
// The script never uses backticks or dollar-brace, so it can sit in this string.

const css = `
:root { color-scheme: dark; --bg:#14161a; --panel:#1d2026; --line:#2f343d; --fg:#e6e8ec; --dim:#9aa3b2; --accent:#6aa7ff; --bad:#ff7a7a; --ok:#6fd08c; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.45 system-ui, sans-serif; }
header { display:flex; gap:16px; align-items:center; padding:10px 16px; border-bottom:1px solid var(--line); }
header h1 { font-size:16px; margin:0; }
header a { color:var(--accent); cursor:pointer; text-decoration:none; }
main { padding:16px; }
form { display:flex; gap:8px; align-items:end; flex-wrap:wrap; margin-bottom:12px; }
label { display:flex; flex-direction:column; gap:4px; color:var(--dim); }
input[type=text], select, textarea { background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:4px; padding:6px 8px; font:inherit; }
input[type=text] { min-width:420px; }
button { background:var(--accent); color:#06101f; border:0; border-radius:4px; padding:7px 14px; font:inherit; cursor:pointer; }
button:disabled { opacity:.4; cursor:not-allowed; }
button.secondary { background:var(--panel); color:var(--fg); border:1px solid var(--line); }
#error { border:1px solid var(--bad); color:var(--bad); background:#2a1717; padding:8px 12px; border-radius:4px; margin:0 0 12px; white-space:pre-wrap; }
#error[hidden] { display:none; }
#layout { display:grid; grid-template-columns:520px minmax(0,1fr); gap:20px; align-items:start; }
table { border-collapse:collapse; width:100%; }
th, td { text-align:left; padding:5px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
tbody tr { cursor:pointer; }
tbody tr[aria-selected=true] { background:#243049; }
.status { font-weight:600; }
.status-final { color:var(--ok); } .status-rejected { color:var(--bad); } .status-draft { color:var(--accent); } .status-missing { color:var(--dim); }
.dim { color:var(--dim); }
#filters { display:flex; gap:12px; margin-bottom:8px; }
#empty { padding:12px; color:var(--dim); }
#detail { min-width:0; }
#detail h2 { margin:0 0 6px; font-size:16px; }
dl { display:grid; grid-template-columns:max-content 1fr; gap:2px 12px; margin:0 0 10px; }
dt { color:var(--dim); } dd { margin:0; overflow-wrap:anywhere; }
#stage { position:relative; display:inline-block; line-height:0; outline:1px solid var(--line); }
#stage img { display:block; }
#stage img.mask { position:absolute; left:0; top:0; mix-blend-mode:screen; }
#preview { display:block; outline:1px solid var(--line); }
#caption { font-size:16px; margin:8px 0; padding:8px; background:var(--panel); border-left:3px solid var(--accent); }
#actions { margin-top:12px; display:flex; gap:12px; align-items:start; }
#reject-note { width:320px; height:54px; }
`;

const script = String.raw`
"use strict";
var $ = function (s) { return document.querySelector(s); };
var app = $("#app");
var S = { folder: null, saved: null, fromFlag: false, jobPath: null, review: null, kind: "", status: "", selected: null, busy: false, decoded: {} };

function h(tag, attrs) {
  var el = document.createElement(tag);
  for (var k in (attrs || {})) {
    if (k === "text") el.textContent = attrs[k];
    else if (k === "on") { for (var ev in attrs.on) el.addEventListener(ev, attrs.on[ev]); }
    else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) el.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
  }
  for (var i = 2; i < arguments.length; i++) {
    var c = arguments[i];
    if (c === null || c === undefined) continue;
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

function ApiError(code, message, lines) { this.code = code; this.message = message; this.lines = lines || []; }

function errorFrom(data, status) {
  var e = data && data.error;
  var code = e && typeof e.code === "string" && e.code ? e.code : "AS-STUDIO-11";
  var message = e && typeof e.message === "string" && e.message ? e.message : "The studio answered with an error it could not explain (HTTP " + status + ").";
  return new ApiError(code, message, e && Array.isArray(e.lines) ? e.lines : []);
}

function api(path, body) {
  var opts = body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  return fetch(path, opts).then(function (res) {
    return res.json().then(function (data) {
      if (!res.ok) throw errorFrom(data, res.status);
      return data;
    }, function () { throw errorFrom(null, res.status); });
  }, function (err) { throw new ApiError("AS-STUDIO-11", "The studio could not be reached: " + err.message); });
}

function showError(err, alsoLog) {
  var box = $("#error");
  if (!box) return;
  if (!err) { box.hidden = true; box.textContent = ""; box.removeAttribute("data-code"); return; }
  box.hidden = false;
  box.setAttribute("data-code", err.code);
  box.textContent = err.code + ": " + err.message;
  if (alsoLog) api("/api/client-error", { code: err.code, message: err.message }).catch(function (e) { box.textContent += "\n" + e.code + ": " + e.message; });
}

function shell(view) {
  app.textContent = "";
  var nav = h("header", {}, h("h1", { text: "asset-studio" }));
  if (view !== "setup") {
    nav.appendChild(h("a", { id: "nav-review", href: "#", text: "Review" }));
    nav.appendChild(h("a", { id: "nav-settings", href: "#settings", text: "Settings" }));
  }
  app.appendChild(nav);
  var main = h("main", {}, h("p", { id: "error", role: "alert", hidden: true }));
  app.appendChild(main);
  return main;
}

function pathForm(id, label, value, onSave) {
  var input = h("input", { type: "text", id: id + "-input", name: "workFolder", value: value || "", autocomplete: "off", spellcheck: "false" });
  var save = h("button", { type: "submit", id: id + "-save", text: "Save" });
  return h("form", { id: id, on: { submit: function (ev) {
    ev.preventDefault();
    showError(null);
    save.disabled = true;
    onSave(input.value).then(function () { save.disabled = false; }, function (err) { save.disabled = false; showError(err, true); });
  } } }, h("label", {}, label, input), save);
}

function saveFolder(value) {
  return api("/api/config", { workFolder: value }).then(function (r) { return refreshState().then(function () { return r; }); });
}

function refreshState() {
  return api("/api/state").then(function (s) {
    S.folder = s.workFolder; S.saved = s.saved; S.fromFlag = s.fromFlag;
    if (!S.jobPath) S.jobPath = new URLSearchParams(location.search).get("job") || s.job || "";
  });
}

function viewSetup() {
  var main = shell("setup");
  main.appendChild(h("h2", { text: "Choose the work folder" }));
  main.appendChild(h("p", { class: "dim", text: "Where asset-studio keeps each story's index, notes and files." }));
  main.appendChild(pathForm("setup-form", "Work folder path", "", function (v) { return saveFolder(v).then(route); }));
}

function viewSettings() {
  var main = shell("settings");
  main.appendChild(h("h2", { text: "Settings" }));
  main.appendChild(h("p", { id: "current-folder", text: "Work folder in use: " + S.folder }));
  if (S.fromFlag) main.appendChild(h("p", { class: "dim", id: "flag-note", text: "This run uses --work-folder. Saving changes the saved setting for later runs." }));
  main.appendChild(pathForm("settings-form", "Work folder path", S.saved || S.folder, function (v) {
    return saveFolder(v).then(function () {
      $("#current-folder").textContent = "Work folder in use: " + S.folder;
      main.appendChild(h("p", { id: "saved-note", text: "Saved." }));
    });
  }));
}

function sizeText(size) {
  if (!size) return "unavailable";
  if (size.seconds !== undefined) return size.seconds + " s";
  return size.width + "×" + size.height;
}

function viewReview() {
  var main = shell("review");
  var input = h("input", { type: "text", id: "job-input", value: S.jobPath || "", autocomplete: "off", spellcheck: "false" });
  main.appendChild(h("form", { id: "job-form", on: { submit: function (ev) {
    ev.preventDefault();
    S.jobPath = input.value; S.selected = null;
    var q = new URLSearchParams(); q.set("job", S.jobPath);
    history.replaceState(null, "", "?" + q.toString());
    loadReview();
  } } }, h("label", {}, "Job file (asset-job.json)", input), h("button", { type: "submit", id: "job-open", text: "Open" })));
  if (S.fromFlag) main.appendChild(h("p", { id: "pinned-note", class: "dim", text: "Work folder pinned by --work-folder for this run: " + S.folder }));
  main.appendChild(h("div", { id: "review" }));
  if (S.jobPath) loadReview();
}

function loadReview() {
  showError(null);
  var host = $("#review");
  if (!host) return Promise.resolve();
  return api("/api/review?job=" + encodeURIComponent(S.jobPath)).then(function (r) {
    S.review = r; S.decoded = {}; renderReview();
  }, function (err) { S.review = null; host.textContent = ""; showError(err, true); });
}

function rowMatches(r) {
  return (!S.kind || r.kind === S.kind) && (!S.status || r.status === S.status);
}

function renderReview() {
  var host = $("#review"); host.textContent = "";
  var r = S.review;
  var kinds = []; r.rows.forEach(function (x) { if (kinds.indexOf(x.kind) < 0) kinds.push(x.kind); });
  if (S.kind && kinds.indexOf(S.kind) < 0) S.kind = "";
  var kindSel = h("select", { id: "filter-kind", on: { change: function (e) { S.kind = e.target.value; renderReview(); } } }, h("option", { value: "", text: "All kinds" }));
  kinds.forEach(function (k) { kindSel.appendChild(h("option", { value: k, text: k })); });
  kindSel.value = S.kind;
  var statusSel = h("select", { id: "filter-status", on: { change: function (e) { S.status = e.target.value; renderReview(); } } }, h("option", { value: "", text: "All statuses" }));
  r.statuses.forEach(function (s) { statusSel.appendChild(h("option", { value: s, text: s })); });
  statusSel.value = S.status;
  var shown = r.rows.filter(rowMatches);
  host.appendChild(h("h2", { id: "story", text: "Story: " + r.story }));
  host.appendChild(h("div", { id: "filters" }, h("label", {}, "Kind", kindSel), h("label", {}, "Status", statusSel),
    h("span", { id: "count", class: "dim", text: shown.length + " of " + r.rows.length + " assets" })));
  var layout = h("div", { id: "layout" });
  var left = h("div", {});
  if (r.rows.length === 0) left.appendChild(h("p", { id: "empty", text: "This job needs no assets." }));
  else if (shown.length === 0) left.appendChild(h("p", { id: "empty", text: "No assets match these filters." }));
  else {
    var body = h("tbody", {});
    shown.forEach(function (x) {
      body.appendChild(h("tr", { "data-key": x.key, "aria-selected": S.selected === x.key ? "true" : "false", on: { click: function () { S.selected = x.key; renderReview(); } } },
        h("td", { text: x.key }), h("td", { text: x.kind }),
        h("td", { class: "status status-" + x.status, "data-status": x.status, text: x.status }),
        h("td", { class: "dim", text: sizeText(x.size) })));
    });
    left.appendChild(h("table", { id: "needs" }, h("thead", {}, h("tr", {}, h("th", { text: "ID" }), h("th", { text: "Kind" }), h("th", { text: "Status" }), h("th", { text: "Size" }))), body));
  }
  var detail = h("div", { id: "detail" });
  layout.appendChild(left); layout.appendChild(detail);
  host.appendChild(layout);
  var sel = r.rows.filter(function (x) { return x.key === S.selected && rowMatches(x); })[0];
  if (sel) renderDetail(detail, sel);
  else detail.appendChild(h("p", { class: "dim", id: "pick", text: "Pick an asset to look at it." }));
}

function mediaFailed(row, what, err, el) {
  // The server explains a bad file with its own code; ask it.
  var url = el.currentSrc || el.src;
  return fetch(url).then(function (res) {
    if (!res.ok) return res.json().then(function (d) { var e = errorFrom(d, res.status); return { code: e.code, message: e.message }; }, function () { var e = errorFrom(null, res.status); return { code: e.code, message: e.message }; });
    return { code: "AS-STUDIO-5", message: what + " for " + row.key + " could not be decoded by the browser." };
  }, function (e) { return { code: "AS-STUDIO-11", message: "The studio could not be reached: " + e.message }; })
  .then(function (e) {
    S.decoded[row.key] = "failed";
    showError(new ApiError(e.code, e.message), true);
    var a = $("#approve"); if (a) a.disabled = true;
    var d = $("#decoded"); if (d) d.textContent = "failed: " + e.code;
  });
}

function imageEl(row, url, cls) {
  var img = h("img", { src: url, alt: row.key, class: cls || null });
  img.addEventListener("load", function () {
    S.decoded[row.key] = "ok";
    var d = $("#decoded");
    if (d) {
      var txt = img.naturalWidth + "×" + img.naturalHeight;
      if (row.declared && (row.declared.width !== img.naturalWidth || row.declared.height !== img.naturalHeight)) txt += " (declared " + row.declared.width + "×" + row.declared.height + ")";
      d.textContent = txt;
    }
  });
  img.addEventListener("error", function () { mediaFailed(row, "The image", null, img); });
  return img;
}

function renderDetail(detail, row) {
  detail.appendChild(h("h2", { id: "detail-title", text: row.key }));
  var dl = h("dl", {});
  function add(k, v, id) { dl.appendChild(h("dt", { text: k })); dl.appendChild(h("dd", { id: id || null, text: v })); }
  add("Kind", row.kind, "d-kind");
  add("Status", row.status, "d-status");
  add("Profile", row.profile || "none", "d-profile");
  add("File", row.file || "unavailable", "d-file");
  add("Recorded size", sizeText(row.size), "d-size");
  add("Declared size", row.declared ? row.declared.width + "×" + row.declared.height : "unavailable", "d-declared");
  add("Decoded", row.media ? "loading" : "nothing to decode", "decoded");
  if (row.speaker) add("Speaker", row.speaker, "d-speaker");
  add("Notes", row.notes.length ? row.notes.join(" | ") : "none", "d-notes");
  detail.appendChild(dl);

  if (row.mediaError) {
    showError(new ApiError(row.mediaError.code, row.mediaError.message), true);
    $("#decoded") && ($("#decoded").textContent = "failed: " + row.mediaError.code);
  }
  var blocked = !!row.mediaError || S.decoded[row.key] === "failed";
  var note = h("textarea", { id: "reject-note", placeholder: "Why? (needed to reject)", "aria-label": "Rejection note" });
  var approve = h("button", { id: "approve", type: "button", text: "Approve", disabled: S.busy || blocked || row.status === "final" || row.status === "missing", on: { click: function () { decide(row, "approve", {}); } } });
  var reject = h("button", { id: "reject", type: "button", class: "secondary", text: "Reject", disabled: S.busy || row.status === "rejected" || row.status === "missing", on: { click: function () { decide(row, "reject", { note: note.value }); } } });
  detail.appendChild(h("div", { id: "actions" }, approve, h("div", {}, note), reject));
  if (row.media === "image" && row.mediaUrl && !row.mediaError) {
    if (row.kind === "glow") {
      var stage = h("div", { id: "stage" });
      if (row.overlay && row.overlay.mediaUrl) stage.appendChild(h("img", { id: "painting-img", src: row.overlay.mediaUrl, alt: row.overlay.key }));
      var mask = imageEl(row, row.mediaUrl, "mask"); mask.id = "mask-img";
      stage.appendChild(mask);
      detail.appendChild(h("label", {}, h("span", {}, "Show glow mask"), h("input", { type: "checkbox", id: "mask-toggle", checked: true, on: { change: function (e) { mask.style.display = e.target.checked ? "" : "none"; } } })));
      if (!(row.overlay && row.overlay.mediaUrl)) detail.appendChild(h("p", { id: "overlay-missing", class: "dim", text: "The painting for this mask (" + (row.overlay ? row.overlay.key : "unknown") + ") has no file yet; the mask is shown alone." }));
      detail.appendChild(stage);
    } else {
      var img = imageEl(row, row.mediaUrl); img.id = "preview";
      detail.appendChild(img);
    }
  } else if (row.media === "audio" && row.mediaUrl && !row.mediaError) {
    var audio = h("audio", { id: "player", controls: true, preload: "metadata", src: row.mediaUrl });
    audio.addEventListener("loadedmetadata", function () {
      S.decoded[row.key] = "ok";
      var d = $("#decoded"); if (d) d.textContent = "audio, " + audio.duration.toFixed(2) + " s";
    });
    audio.addEventListener("error", function () { mediaFailed(row, "The audio", null, audio); });
    var state = h("span", { id: "play-state", class: "dim", text: "stopped" });
    audio.addEventListener("playing", function () { state.textContent = "playing"; });
    audio.addEventListener("ended", function () { state.textContent = "ended"; });
    audio.addEventListener("pause", function () { if (!audio.ended) state.textContent = "stopped"; });
    var play = h("button", { id: "play", type: "button", class: "secondary", text: "Play", on: { click: function () {
      audio.currentTime = 0;
      audio.play().catch(function (e) { showError(new ApiError("AS-STUDIO-5", "The audio for " + row.key + " could not be played: " + e.message), true); });
    } } });
    detail.appendChild(h("div", {}, play, " ", state));
    detail.appendChild(audio);
    if (row.caption !== null) detail.appendChild(h("p", { id: "caption", text: row.caption }));
  } else if (!row.media && row.status !== "missing" && !row.mediaError) {
    detail.appendChild(h("p", { id: "no-preview", class: "dim", text: "No preview for this file type." }));
  } else if (row.status === "missing") {
    detail.appendChild(h("p", { id: "missing-note", class: "dim", text: "No file yet. Render this asset first." }));
    if (row.caption !== null) detail.appendChild(h("p", { id: "caption", text: row.caption }));
  }

}

function decide(row, action, extra) {
  if (S.busy) return;
  S.busy = true;
  ["#approve", "#reject"].forEach(function (s) { var b = $(s); if (b) b.disabled = true; });
  showError(null);
  var body = { job: S.jobPath, id: row.key, file: row.file, status: row.status };
  for (var k in extra) body[k] = extra[k];
  return api("/api/" + action, body).then(function () { return null; }, function (err) { return err; })
    .then(function (err) {
      S.busy = false;
      return loadReview().then(function () { if (err) showError(err, true); });
    });
}

function route() {
  if (!S.folder) return viewSetup();
  if (location.hash === "#settings") return viewSettings();
  return viewReview();
}

window.addEventListener("unhandledrejection", function (ev) {
  var r = ev.reason;
  showError(r instanceof ApiError ? r : new ApiError("AS-STUDIO-12", "Something went wrong in the page: " + (r && r.message ? r.message : String(r))), true);
});
window.addEventListener("hashchange", function () { if (S.folder) route(); });
refreshState().then(route, function (err) {
  app.textContent = "";
  app.appendChild(h("main", {}, h("p", { id: "error", role: "alert", "data-code": err.code, text: err.code + ": " + err.message })));
});
`;

export const pageHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>asset-studio</title>
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script>${script}</script>
</body>
</html>
`;
