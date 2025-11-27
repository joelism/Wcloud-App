// Wcloud Tracker – robuster Login (Form onsubmit), kein Show-PIN
// + Startscreen & wcloud-wheel (Drive-Bilder)

// ---------- IndexedDB ----------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("PrivateTrackerDB", 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sessions")) {
        const store = db.createObjectStore("sessions", { keyPath: "id", autoIncrement: true });
        store.createIndex("isoDate", "isoDate", { unique: false });
        store.createIndex("content", "content", { unique: false });
        store.createIndex("gender", "gender", { unique: false });
        store.createIndex("porn", "porn", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("name", "name", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode = "readonly") {
  return db.transaction("sessions", mode).objectStore("sessions");
}
function addSession(db, obj) {
  return new Promise((res, rej) => {
    const r = tx(db, "readwrite").add(obj);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function getAllSessions(db) {
  return new Promise((res, rej) => {
    const r = tx(db, "readonly").getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}
function deleteSession(db, id) {
  return new Promise((res, rej) => {
    const r = tx(db, "readwrite").delete(id);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function nowLocalInputValue() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toIsoDate(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function weekdayIndex(ts) { return new Date(ts).getDay(); }
function weekdayName(i) { return ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][i]; }

// ---------- Login (Form onsubmit) ----------
const PIN = "544221";
function doLogin(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  try {
    var pinEl = document.getElementById("pinInput");
    var overlay = document.getElementById("login");
    var app = document.getElementById("app");
    var err = document.getElementById("loginError");
    var val = (pinEl && pinEl.value) ? pinEl.value.replace(/\D/g, "") : "";
    if (val === PIN) {
      overlay.style.display = "none";
      if (app) app.hidden = false;
      return false;
    } else {
      if (err) {
        err.hidden = false;
        setTimeout(() => { err.hidden = true; }, 1800);
      }
      return false;
    }
  } catch (e) {
    return false;
  }
}

// ---------- Tabs & Startscreen ----------

// zentrale Funktion, um Tabs zu aktivieren (wird auch vom Startscreen benutzt)
function activateTab(tabId) {
  const tabs = $$(".tab");
  const panels = $$(".tabPanel");

  if (!tabs.length || !panels.length) return;

  tabs.forEach(b => {
    const isActive = (b.dataset.tab === tabId);
    if (isActive) b.classList.add("active");
    else b.classList.remove("active");
  });

  panels.forEach(p => {
    const shouldShow = (p.id === tabId);
    if (shouldShow) p.classList.remove("hidden");
    else p.classList.add("hidden");
  });

  // bekannte Tabs: bei Wechsel History/Analyse neu rendern
  if (tabId === "analysis") renderAnalysis();
  if (tabId === "history") renderHistory();
}

// normale Tab-Buttons (oben) wie bisher
function setupTabs() {
  $$(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (!tab) return;
      // wenn man per Tab klickt, ist man automatisch aus dem Startscreen „raus“
      const startScreen = $("#startScreen");
      if (startScreen) startScreen.classList.add("hidden");
      const mainShell = $("#mainShell");
      if (mainShell) mainShell.classList.remove("hidden");

      activateTab(tab);
    });
  });
}

// neuer Startbildschirm mit zwei Optionen:
// 1) Einträge & Analyse  2) wcloud-wheel
function setupStartScreen() {
  const startScreen = $("#startScreen");
  if (!startScreen) return; // falls du (noch) keinen Startscreen im HTML hast

  const mainShell = $("#mainShell"); // Container, in dem Tabs/Content liegen
  const entriesBtn = $("#startEntriesAnalyse");
  const wheelBtn = $("#startWcloudWheel");

  // Standard: nur Startscreen sichtbar
  if (mainShell) mainShell.classList.add("hidden");
  startScreen.classList.remove("hidden");

  if (entriesBtn) {
    entriesBtn.addEventListener("click", () => {
      // Startscreen ausblenden, Hauptbereich einblenden
      startScreen.classList.add("hidden");
      if (mainShell) mainShell.classList.remove("hidden");
      // „Einträge & Analyse“ bedeutet: die bisherigen Sachen (Neuer Eintrag / Verlauf / Analyse).
      // Wir öffnen standardmässig den „Neuer Eintrag“-Tab (id: "new" o.ä.)
      // Falls dein Tab für neue Einträge anders heisst, hier anpassen.
      if ($('.tab[data-tab="new"]')) {
        activateTab("new");
      } else if ($('.tab[data-tab="history"]')) {
        activateTab("history");
      } else if ($('.tab[data-tab="analysis"]')) {
        activateTab("analysis");
      }
    });
  }

  if (wheelBtn) {
    wheelBtn.addEventListener("click", () => {
      startScreen.classList.add("hidden");
      if (mainShell) mainShell.classList.remove("hidden");
      // direkt auf den wcloud-wheel-Tab springen (Panel-ID: "wheel")
      activateTab("wheel");
    });
  }
}

// ---------- wcloud-wheel (Google-Drive-Bilder) ----------

// Hier werden die Bild-URLs gespeichert, die du z.B. über die Drive-API lädst.
let wcloudImageUrls = [];

/**
 * Kann von deinem Drive-Code aufgerufen werden:
 *   window.setWcloudImageUrls(arrayMitBildUrls)
 */
function setWcloudImageUrls(urls) {
  if (Array.isArray(urls)) {
    wcloudImageUrls = urls.slice();
  } else {
    wcloudImageUrls = [];
  }
}
window.setWcloudImageUrls = setWcloudImageUrls;

// zieht bis zu n zufällige, eindeutige Bilder aus der Liste
function pickRandomImages(n) {
  const source = wcloudImageUrls.slice();
  const result = [];
  if (!source.length) return result;

  while (source.length && result.length < n) {
    const idx = Math.floor(Math.random() * source.length);
    result.push(source.splice(idx, 1)[0]);
  }
  return result;
}

function renderWcloudWheelRandom() {
  const grid = $("#wheelGrid");
  if (!grid) return;

  grid.innerHTML = "";

  if (!wcloudImageUrls.length) {
    grid.innerHTML = "<p class='muted'>Noch keine Bilder geladen. Bitte zuerst in den Einstellungen/über die API Drive-Bilder hinzufügen.</p>";
    return;
  }

  const images = pickRandomImages(60);
  if (!images.length) {
    grid.innerHTML = "<p class='muted'>Es konnten keine zufälligen Bilder ausgewählt werden.</p>";
    return;
  }

  const info = document.createElement("p");
  info.className = "muted";
  info.textContent = `Zufällig ausgewählte Bilder: ${images.length}`;
  grid.appendChild(info);

  const list = document.createElement("div");
  list.className = "wheelGridInner";
  grid.appendChild(list);

  images.forEach(url => {
    const wrapper = document.createElement("div");
    wrapper.className = "wheelItem";

    const img = document.createElement("img");
    img.src = url;
    img.loading = "lazy";
    img.alt = "wcloud-wheel Bild";
    img.className = "wheelImage";

    wrapper.appendChild(img);
    list.appendChild(wrapper);
  });
}

function setupWcloudWheel() {
  const btn = $("#wheelRandomBtn");   // Button "60 zufällige Bilder"
  if (!btn) return;

  btn.addEventListener("click", () => {
    renderWcloudWheelRandom();
  });

  // Optional: beim ersten Öffnen des Tabs direkt etwas anzeigen
  const wheelPanel = $("#wheel");
  if (wheelPanel) {
    // Wenn der Tab aktiv wird, kannst du bei Bedarf auch hier hooken.
    // In activateTab() könntest du zusätzlich:
    // if (tabId === "wheel") renderWcloudWheelRandom();
  }
}

// ---------- Form Capture ----------
async function setupForm(db) {
  const dt = $("#dt");
  if (dt) dt.value = nowLocalInputValue();

  const form = $("#sessionForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const dtEl = $("#dt");
    const dtVal = dtEl ? dtEl.value : "";
    const fd = new FormData(e.target);
    const wet = fd.get("wet");
    const gender = fd.get("gender");
    const porn = fd.get("porn");
    const contentEl = $("#content");
    const personNameEl = $("#personName");
    const content = contentEl ? contentEl.value : "";
    const personName = personNameEl ? personNameEl.value.trim() : "";

    const createdAt = Date.parse(dtVal);
    if (isNaN(createdAt)) {
      alert("Ungültiges Datum/Uhrzeit.");
      return;
    }
    const obj = { createdAt, isoDate: toIsoDate(createdAt), wet, gender, porn, content, name: personName };
    await addSession(db, obj);
    e.target.reset();
    if (dtEl) dtEl.value = nowLocalInputValue();
    renderHistory();
    alert("Gespeichert.");
  });
}

// ---------- History ----------
let _allSessionsCache = [];

async function loadAll(db) {
  _allSessionsCache = await getAllSessions(db);
  return _allSessionsCache;
}
function passesFilters(s) {
  const d = $("#searchDate") ? $("#searchDate").value : "";
  const c = $("#filterContent") ? $("#filterContent").value : "";
  const g = $("#filterGender") ? $("#filterGender").value : "";
  const p = $("#filterPorn") ? $("#filterPorn").value : "";
  if (d && s.isoDate !== d) return false;
  if (c && s.content !== c) return false;
  if (g && s.gender !== g) return false;
  if (p && s.porn !== p) return false;
  return true;
}
function renderHistoryList(list) {
  const cont = $("#historyList");
  if (!cont) return;
  cont.innerHTML = "";
  if (!list.length) {
    cont.innerHTML = "<p class='muted'>Noch keine Einträge.</p>";
    return;
  }
  list.sort((a, b) => b.createdAt - a.createdAt);
  list.forEach(s => {
    const d = new Date(s.createdAt);
    const div = document.createElement("div");
    div.className = "entry";
    const main = document.createElement("div");
    main.innerHTML = `<div><strong>${s.isoDate}</strong> ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      <div class="meta">${s.content} · ${s.gender} · ${s.porn} · ${s.wet}${s.name ? " · " + s.name : ""}</div>`;
    const actions = document.createElement("div");
    const del = document.createElement("button");
    del.textContent = "Löschen";
    del.className = "small danger";
    del.addEventListener("click", async () => {
      const db = await openDB();
      await deleteSession(db, s.id);
      renderHistory();
    });
    actions.appendChild(del);
    div.appendChild(main);
    div.appendChild(actions);
    cont.appendChild(div);
  });
}
async function renderHistory() {
  const db = await openDB();
  const all = await loadAll(db);
  renderHistoryList(all.filter(passesFilters));
}

// ---------- Analysis ----------
function countBy(list, keyFn) {
  const m = new Map();
  list.forEach(it => {
    const k = keyFn(it);
    m.set(k, (m.get(k) || 0) + 1);
  });
  return m;
}
function maxVal(map) {
  let m = 0;
  map.forEach(v => { if (v > m) m = v; });
  return m;
}
function makeBarRow(label, value, max) {
  const row = document.createElement("div");
  row.className = "barRow";
  const lab = document.createElement("div");
  lab.className = "barLabel";
  lab.textContent = label;
  const track = document.createElement("div");
  track.className = "barTrack";
  const fill = document.createElement("div");
  fill.className = "barFill";
  const pct = max ? (value / max) * 100 : 0;
  fill.style.width = Math.max(1, pct) + "%";
  track.appendChild(fill);
  const val = document.createElement("div");
  val.className = "barVal";
  val.textContent = String(value);
  row.appendChild(lab);
  row.appendChild(track);
  row.appendChild(val);
  return row;
}
function renderBars(sel, map, order = null, labelFn = (k) => k) {
  const cont = $(sel);
  if (!cont) return;
  cont.innerHTML = "";
  let entries = Array.from(map.entries());
  if (order) {
    const ord = new Map(order.map((k, i) => [k, i]));
    entries.sort((a, b) => (ord.get(a[0]) ?? 999) - (ord.get(b[0]) ?? 999));
  } else {
    entries.sort((a, b) => b[1] - a[1]);
  }
  const mx = maxVal(map);
  entries.forEach(([k, v]) => cont.appendChild(makeBarRow(labelFn(k), v, mx)));
  if (!entries.length) cont.innerHTML = "<p class='muted'>Noch keine Daten.</p>";
}
function renderPerDayTable(list) {
  const cont = $("#perDay");
  if (!cont) return;
  cont.innerHTML = "";
  if (!list.length) {
    cont.innerHTML = "<p class='muted'>Noch keine Daten.</p>";
    return;
  }
  const byDay = countBy(list, s => s.isoDate);
  const arr = Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  arr.forEach(([day, n]) => {
    const row = document.createElement("div");
    row.className = "tableRow";
    const l = document.createElement("div");
    l.textContent = day;
    const r = document.createElement("div");
    r.textContent = n;
    row.appendChild(l);
    row.appendChild(r);
    cont.appendChild(row);
  });
}
async function renderAnalysis() {
  const db = await openDB();
  const all = await getAllSessions(db);
  const sum = $("#statsSummary");
  if (!sum) return;
  sum.innerHTML = "";
  const total = all.length;
  const last = all.slice().sort((a, b) => b.createdAt - a.createdAt)[0];
  const pill = (t) => {
    const s = document.createElement("span");
    s.className = "pill";
    s.textContent = t;
    return s;
  };
  sum.appendChild(pill(`Gesamt: ${total}`));
  if (last) {
    const d = new Date(last.createdAt);
    sum.appendChild(pill(`Letzter Eintrag: ${last.isoDate} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`));
  }
  renderPerDayTable(all);
  renderBars("#weekdayBars", countBy(all, s => weekdayIndex(s.createdAt)), [1, 2, 3, 4, 5, 6, 0], (k) => weekdayName(k));
  renderBars("#genderBars", countBy(all, s => s.gender || "—"));
  renderBars("#pornBars", countBy(all, s => s.porn || "—"), ["Mit", "Ohne"]);
  renderBars("#contentBars", countBy(all, s => s.content || "—"), ["Wcloud112", "Wcloud113", "Wcloud114", "Wcloud115", "Wcloud116", "Wcloud117"]);
  renderBars("#nameBars", countBy(all.filter(s => (s.name || "").trim() !== ""), s => s.name.trim()));
  renderBars("#wetBars", countBy(all, s => s.wet || "—"), ["Sehr feucht", "Feucht", "Weniger feucht", "Trocken"]);
  const thisYear = (new Date()).getFullYear();
  const listThisYear = all.filter(s => (new Date(s.createdAt)).getFullYear() === thisYear && (s.name || "").trim() !== "");
  const byNameYear = countBy(listThisYear, s => s.name.trim());
  if (byNameYear.size) {
    const parts = Array.from(byNameYear.entries()).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${c}× ${n}`);
    sum.appendChild(pill(`Dieses Jahr: ${parts.join(", ")}`));
  }
}

// ---------- Export CSV ----------
function toCsv(rows) {
  return rows.map(r => r.map(v => {
    const s = (v == null ? "" : String(v)).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  }).join(",")).join("\n");
}
async function setupExport() {
  const btn = $("#exportCsv");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const db = await openDB();
    const all = await getAllSessions(db);
    const rows = [["ISO Datum", "Zeit", "Wochentag", "Inhalt", "Geschlecht", "Porno", "Feuchtigkeit", "Name"]];
    all.sort((a, b) => a.createdAt - b.createdAt).forEach(s => {
      const d = new Date(s.createdAt);
      rows.push([
        s.isoDate,
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        weekdayName(weekdayIndex(s.createdAt)),
        s.content || "",
        s.gender || "",
        s.porn || "",
        s.wet || "",
        s.name || ""
      ]);
    });
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "protokoll.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

// ---------- Filters ----------
function setupHistoryFilters() {
  const clearBtn = $("#clearFilters");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if ($("#searchDate")) $("#searchDate").value = "";
      if ($("#filterContent")) $("#filterContent").value = "";
      if ($("#filterGender")) $("#filterGender").value = "";
      if ($("#filterPorn")) $("#filterPorn").value = "";
      renderHistory();
    });
  }
  ["searchDate", "filterContent", "filterGender", "filterPorn"].forEach(id => {
    const el = $("#" + id);
    if (el) el.addEventListener("change", renderHistory);
  });
}

// ---------- Einstellungen ----------
async function setupSettings() {
  const clearAllBtn = document.getElementById("clearAll");
  if (clearAllBtn) {
    clearAllBtn.addEventListener("click", async () => {
      if (confirm("Willst du wirklich ALLE Daten löschen?")) {
        indexedDB.deleteDatabase("PrivateTrackerDB");
        alert("Alle Daten wurden gelöscht. Bitte lade die Seite neu.");
      }
    });
  }
}

// ---------- Boot ----------
(async function boot() {
  setupTabs();
  setupStartScreen();   // neuer Startbildschirm
  setupWcloudWheel();   // wcloud-wheel (Random-Bilder)
  const db = await openDB();
  await setupForm(db);
  setupHistoryFilters();
  await setupExport();
  await setupSettings();
  await renderHistory();
})();
