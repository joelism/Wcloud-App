// Wcloud App – lokale Version ohne externe APIs
// - Einträge in IndexedDB (alter Name -> alte Daten bleiben)
// - Bild-Pool per Bild-URL im localStorage
// - Wheel-Bilder 4:3 + Lightbox + Dropbox-Link-Support

// -------- Service Worker deaktivieren --------
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(r => r.unregister());
  }).catch(() => {});
}

// -------- Helpers --------
const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function pad2(n) { return String(n).padStart(2, "0"); }
function nowLocalInputValue() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function toIsoDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function weekdayIndex(ts) { return new Date(ts).getDay(); }
function weekdayName(i) { return ["So","Mo","Di","Mi","Do","Fr","Sa"][i]; }

// Dropbox-Links in "direkte" Bild-Links umwandeln
function normalizeImageUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("dropbox.com")) {
      // z.B. https://www.dropbox.com/s/xxxx/datei.jpg?dl=0
      u.hostname = "dl.dropboxusercontent.com";
      if (u.searchParams.has("dl")) {
        u.searchParams.set("dl", "1");
      }
      return u.toString();
    }
  } catch {
    // ignore
  }
  return url;
}

// -------- Login (PIN) --------
const PIN = "544221";

function setupLogin() {
  const loginForm = $("#loginForm");
  if (!loginForm) return;
  loginForm.addEventListener("submit", ev => {
    ev.preventDefault();
    const inp = $("#pinInput");
    const err = $("#loginError");
    const val = (inp?.value || "").replace(/\D/g, "");
    if (val === PIN) {
      $("#login").style.display = "none";
      $("#app").hidden = false;
    } else {
      if (err) {
        err.hidden = false;
        setTimeout(() => { err.hidden = true; }, 1800);
      }
    }
  });
}

// -------- IndexedDB --------
const DB_NAME = "PrivateTrackerDB"; // alter Name
const DB_VERSION = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sessions")) {
        const store = db.createObjectStore("sessions", { keyPath: "id", autoIncrement: true });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("isoDate",   "isoDate",   { unique: false });
        store.createIndex("content",   "content",   { unique: false });
        store.createIndex("gender",    "gender",    { unique: false });
        store.createIndex("porn",      "porn",      { unique: false });
        store.createIndex("wet",       "wet",       { unique: false });
        store.createIndex("name",      "name",      { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode="readonly") {
  return db.transaction("sessions", mode).objectStore("sessions");
}
function addSession(db, s) {
  return new Promise((res, rej) => {
    const r = tx(db, "readwrite").add(s);
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
}
function getAllSessions(db) {
  return new Promise((res, rej) => {
    const r = tx(db, "readonly").getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror   = () => rej(r.error);
  });
}
function deleteSession(db, id) {
  return new Promise((res, rej) => {
    const r = tx(db, "readwrite").delete(id);
    r.onsuccess = () => res();
    r.onerror   = () => rej(r.error);
  });
}

// -------- Tabs & Startscreen --------
function activateTab(id) {
  $$(".tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === id);
  });
  $$(".tabPanel").forEach(p => {
    p.classList.toggle("activePanel", p.id === id);
  });
  if (id === "history")  renderHistory();
  if (id === "analysis") renderAnalysis();
}

function setupTabs() {
  const mainTabs = $("#mainTabs");
  $$(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      activateTab(btn.dataset.tab);
    });
  });

  const startScreen  = $("#startScreen");
  const startEntries = $("#startEntries");
  const startWheel   = $("#startWheel");
  const startSettings= $("#startSettings");

  function leaveStart(toTab) {
    if (startScreen) startScreen.style.display = "none";
    if (mainTabs)    mainTabs.style.display    = "flex";
    activateTab(toTab);
  }

  if (startEntries)  startEntries.addEventListener("click", () => leaveStart("capture"));
  if (startWheel)    startWheel.addEventListener("click", () => leaveStart("wheel"));
  if (startSettings) startSettings.addEventListener("click", () => leaveStart("settings"));

  activateTab("capture");
}

// -------- Neuer Eintrag --------
async function setupForm(db) {
  const dt = $("#dt");
  if (dt) dt.value = nowLocalInputValue();

  const form = $("#sessionForm");
  if (!form) return;

  form.addEventListener("submit", async ev => {
    ev.preventDefault();

    const dtEl = $("#dt");
    const fd = new FormData(form);
    const createdAt = Date.parse(dtEl.value);
    if (Number.isNaN(createdAt)) {
      alert("Ungültiges Datum/Uhrzeit.");
      return;
    }

    const session = {
      createdAt,
      isoDate: toIsoDate(createdAt),
      content: $("#content")?.value || "",
      name: ($("#personName")?.value || "").trim(),
      wet: fd.get("wet") || "",
      gender: fd.get("gender") || "",
      porn: fd.get("porn") || ""
    };

    await addSession(db, session);
    form.reset();
    if (dt) dt.value = nowLocalInputValue();
    renderHistory();
    alert("Eintrag gespeichert.");
  });
}

// -------- Verlauf --------
async function renderHistory() {
  const db = await openDB();
  const all = await getAllSessions(db);

  const list = $("#historyList");
  list.innerHTML = "";

  const d = $("#searchDate")?.value || "";
  const c = $("#filterContent")?.value || "";
  const g = $("#filterGender")?.value || "";
  const p = $("#filterPorn")?.value || "";

  const filtered = all.filter(s => {
    if (d && s.isoDate !== d) return false;
    if (c && s.content !== c) return false;
    if (g && s.gender  !== g) return false;
    if (p && s.porn    !== p) return false;
    return true;
  }).sort((a,b) => b.createdAt - a.createdAt);

  if (!filtered.length) {
    list.innerHTML = "<p class='muted'>Noch keine Einträge.</p>";
    return;
  }

  filtered.forEach(s => {
    const date = new Date(s.createdAt);
    const row = document.createElement("div");
    row.className = "entry";

    const main = document.createElement("div");
    main.className = "entry-main";
    main.innerHTML = `
      <div><strong>${s.isoDate}</strong> ${date.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</div>
      <div class="entry-meta">
        ${s.content || ""}${s.gender ? " · "+s.gender : ""}${s.porn ? " · "+s.porn : ""}${s.wet ? " · "+s.wet : ""}${s.name ? " · "+s.name : ""}
      </div>
    `;

    const actions = document.createElement("div");
    const del = document.createElement("button");
    del.className = "btn btn-danger btn-small";
    del.textContent = "Löschen";
    del.addEventListener("click", async () => {
      await deleteSession(db, s.id);
      renderHistory();
    });
    actions.appendChild(del);

    row.appendChild(main);
    row.appendChild(actions);
    list.appendChild(row);
  });
}

function setupHistoryFilters() {
  const clear = $("#clearFilters");
  if (clear) {
    clear.addEventListener("click", () => {
      if ($("#searchDate"))   $("#searchDate").value   = "";
      if ($("#filterContent"))$("#filterContent").value= "";
      if ($("#filterGender")) $("#filterGender").value = "";
      if ($("#filterPorn"))   $("#filterPorn").value   = "";
      renderHistory();
    });
  }
  ["searchDate","filterContent","filterGender","filterPorn"].forEach(id => {
    const el = $("#"+id);
    if (el) el.addEventListener("change", renderHistory);
  });
}

// -------- Analyse --------
function countBy(list, keyFn) {
  const m = new Map();
  list.forEach(item => {
    const k = keyFn(item);
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
  const l = document.createElement("div");
  l.className = "barLabel";
  l.textContent = label;
  const track = document.createElement("div");
  track.className = "barTrack";
  const fill = document.createElement("div");
  fill.className = "barFill";
  const pct = max ? (value / max) * 100 : 0;
  fill.style.width = Math.max(4, pct) + "%";
  track.appendChild(fill);
  const val = document.createElement("div");
  val.className = "barVal";
  val.textContent = String(value);
  row.appendChild(l);
  row.appendChild(track);
  row.appendChild(val);
  return row;
}
function renderBars(selector, map, order = null, labelFn = k => k) {
  const cont = $(selector);
  cont.innerHTML = "";
  const entries = Array.from(map.entries());
  if (!entries.length) {
    cont.innerHTML = "<p class='muted'>Noch keine Daten.</p>";
    return;
  }
  if (order) {
    const ord = new Map(order.map((k, i) => [k, i]));
    entries.sort((a, b) => (ord.get(a[0]) ?? 999) - (ord.get(b[0]) ?? 999));
  } else {
    entries.sort((a, b) => b[1] - a[1]);
  }
  const mx = maxVal(map);
  entries.forEach(([k, v]) => cont.appendChild(makeBarRow(labelFn(k), v, mx)));
}

function renderPerDayTable(list) {
  const cont = $("#perDay");
  cont.innerHTML = "";
  if (!list.length) {
    cont.innerHTML = "<p class='muted'>Noch keine Daten.</p>";
    return;
  }
  const byDay = countBy(list, s => s.isoDate);
  const arr = Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  arr.forEach(([day, n]) => {
    const row = document.createElement("div");
    row.className = "barRow";
    const l = document.createElement("div");
    l.className = "barLabel";
    l.textContent = day;
    const v = document.createElement("div");
    v.textContent = n;
    row.appendChild(l);
    row.appendChild(v);
    cont.appendChild(row);
  });
}

async function renderAnalysis() {
  const db = await openDB();
  const all = await getAllSessions(db);
  const sum = $("#statsSummary");
  sum.innerHTML = "";

  const pill = txt => {
    const span = document.createElement("span");
    span.textContent = txt;
    span.style.display = "inline-block";
    span.style.padding = "0.15rem 0.6rem";
    span.style.margin = "0 0.4rem 0.35rem 0";
    span.style.borderRadius = "999px";
    span.style.background = "#020617";
    span.style.fontSize = "0.8rem";
    return span;
  };

  const total = all.length;
  sum.appendChild(pill(`Gesamt: ${total}`));

  if (total) {
    const last = all.slice().sort((a, b) => b.createdAt - a.createdAt)[0];
    const d = new Date(last.createdAt);
    sum.appendChild(pill(`Letzter Eintrag: ${last.isoDate} ${d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`));
  }

  renderPerDayTable(all);
  renderBars("#weekdayBars", countBy(all, s => weekdayIndex(s.createdAt)), [1,2,3,4,5,6,0], weekdayName);
  renderBars("#genderBars", countBy(all, s => s.gender || "—"));
  renderBars("#pornBars",   countBy(all, s => s.porn || "—"), ["Mit","Ohne"]);
  renderBars("#contentBars",countBy(all, s => s.content || "—"), ["Wcloud112","Wcloud113","Wcloud114","Wcloud115","Wcloud116","Wcloud117"]);
  renderBars("#nameBars",   countBy(all.filter(s => (s.name || "").trim() !== ""), s => s.name.trim()));
  renderBars("#wetBars",    countBy(all, s => s.wet || "—"), ["Sehr feucht","Feucht","Weniger feucht","Trocken"]);
}

// -------- CSV Export --------
function toCsv(rows) {
  return rows.map(r => r.map(v => {
    const s = (v == null ? "" : String(v)).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  }).join(",")).join("\n");
}
async function setupCsvExport() {
  const btn = $("#exportCsv");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const db = await openDB();
    const all = (await getAllSessions(db)).slice().sort((a, b) => a.createdAt - b.createdAt);
    const rows = [["ISO Datum","Zeit","Wochentag","Inhalt","Geschlecht","Porno","Feuchtigkeit","Name"]];
    all.forEach(s => {
      const d = new Date(s.createdAt);
      rows.push([
        s.isoDate,
        d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}),
        weekdayName(weekdayIndex(s.createdAt)),
        s.content || "",
        s.gender  || "",
        s.porn    || "",
        s.wet     || "",
        s.name    || ""
      ]);
    });
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "wcloud_protokoll.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

// -------- Bild-Pool & Wheel --------
const IMAGE_URLS_KEY = "wcloudImageUrls";

let imageUrls = [];
let wheelRemaining = [];
let wheelBatchSize = 5;
let lightboxIndex = -1;

function loadImageUrls() {
  try {
    const raw = localStorage.getItem(IMAGE_URLS_KEY);
    if (!raw) {
      imageUrls = [];
    } else {
      const parsed = JSON.parse(raw);
      imageUrls = Array.isArray(parsed) ? parsed.filter(u => typeof u === "string" && u.trim() !== "") : [];
    }
  } catch {
    imageUrls = [];
  }
  wheelRemaining = imageUrls.slice();
}

function saveImageUrls() {
  try {
    localStorage.setItem(IMAGE_URLS_KEY, JSON.stringify(imageUrls));
  } catch (e) {
    console.error("Fehler beim Speichern der Bild-URLs:", e);
  }
}

function renderImagePool() {
  const info = $("#imagePoolInfo");
  const grid = $("#imagePoolGrid");
  if (!info || !grid) return;

  info.textContent = imageUrls.length
    ? `Bilder im Pool: ${imageUrls.length}`
    : "Noch keine Bild-URLs gespeichert.";

  grid.innerHTML = "";
  if (!imageUrls.length) return;

  imageUrls.forEach((url, idx) => {
    const item = document.createElement("div");
    item.className = "wheelItem";

    const img = document.createElement("img");
    img.src = url;
    img.alt = "Bild im Pool";
    img.loading = "lazy";
    img.className = "wheelImage";
    img.addEventListener("click", () => openLightbox(idx));

    item.appendChild(img);
    grid.appendChild(item);
  });
}

function setupImagePool() {
  loadImageUrls();
  renderImagePool();

  const addBtn   = $("#addImageUrlBtn");
  const clearBtn = $("#clearImageUrlsBtn");
  const input    = $("#imageUrlInput");

  if (addBtn && input) {
    addBtn.addEventListener("click", () => {
      let url = (input.value || "").trim();
      if (!url) {
        alert("Bitte eine Bild-URL eingeben.");
        return;
      }
      try {
        const u = new URL(url);
        if (!/^https?:/i.test(u.protocol)) throw new Error();
      } catch {
        alert("Bitte eine gültige http/https-URL eingeben.");
        return;
      }
      url = normalizeImageUrl(url); // Dropbox-Fix
      imageUrls.push(url);
      saveImageUrls();
      wheelRemaining = imageUrls.slice();
      input.value = "";
      renderImagePool();
      renderWheelReset();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (!imageUrls.length) return;
      if (confirm("Wirklich alle Bild-URLs löschen?")) {
        imageUrls = [];
        saveImageUrls();
        wheelRemaining = [];
        renderImagePool();
        renderWheelReset();
      }
    });
  }
}

function renderWheelReset() {
  const grid = $("#wheelGrid");
  if (!grid) return;
  wheelRemaining = imageUrls.slice();
  grid.innerHTML = imageUrls.length
    ? "<p class='muted'>Noch keine Bilder angezeigt. Klicke auf „Mehr Bilder laden“.</p>"
    : "<p class='muted'>Noch keine Bild-URLs im Pool. Lege welche im Tab „Einstellungen“ an.</p>";
}

function pickRandomFromRemaining(count) {
  const picked = [];
  while (wheelRemaining.length && picked.length < count) {
    const idx = Math.floor(Math.random() * wheelRemaining.length);
    picked.push(wheelRemaining.splice(idx, 1)[0]);
  }
  return picked;
}

function appendWheelImages(urls) {
  const grid = $("#wheelGrid");
  if (!grid || !urls.length) return;
  if (grid.querySelector("p")) grid.innerHTML = "";
  urls.forEach(url => {
    const idx = imageUrls.indexOf(url);
    const item = document.createElement("div");
    item.className = "wheelItem";
    const img = document.createElement("img");
    img.src = url;
    img.alt = "Wheel Bild";
    img.loading = "lazy";
    img.className = "wheelImage";
    img.addEventListener("click", () => {
      if (idx >= 0) openLightbox(idx);
    });
    item.appendChild(img);
    grid.appendChild(item);
  });
}

function setupWheel() {
  const moreBtn  = $("#wheelMoreBtn");
  const resetBtn = $("#wheelResetBtn");
  const sizeSel  = $("#wheelBatchSize");

  loadImageUrls();
  renderWheelReset();

  if (sizeSel) {
    sizeSel.addEventListener("change", ev => {
      const n = parseInt(ev.target.value, 10);
      if (!Number.isNaN(n)) wheelBatchSize = n;
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      renderWheelReset();
    });
  }
  if (moreBtn) {
    moreBtn.addEventListener("click", () => {
      if (!imageUrls.length) {
        renderWheelReset();
        return;
      }
      if (!wheelRemaining.length) {
        alert("Alle Bilder wurden bereits angezeigt. Mit „Zurücksetzen“ startest du neu.");
        return;
      }
      const batch = pickRandomFromRemaining(wheelBatchSize);
      appendWheelImages(batch);
    });
  }
}

// -------- Lightbox --------
function openLightbox(idx) {
  if (!imageUrls.length) return;
  lightboxIndex = idx;
  const lb = $("#imageLightbox");
  const img = $("#lightboxImage");
  if (!lb || !img) return;
  img.src = imageUrls[lightboxIndex];
  lb.classList.add("active");
}

function closeLightbox() {
  const lb = $("#imageLightbox");
  const img = $("#lightboxImage");
  if (lb) lb.classList.remove("active");
  if (img) img.src = "";
  lightboxIndex = -1;
}

function nextLightbox(delta) {
  if (!imageUrls.length || lightboxIndex < 0) return;
  lightboxIndex = (lightboxIndex + delta + imageUrls.length) % imageUrls.length;
  const img = $("#lightboxImage");
  if (img) img.src = imageUrls[lightboxIndex];
}

function setupLightbox() {
  const lb     = $("#imageLightbox");
  const inner  = $("#lightboxInner");
  const closeB = $("#lightboxClose");
  const prevB  = $("#lightboxPrev");
  const nextB  = $("#lightboxNext");

  if (closeB) closeB.addEventListener("click", closeLightbox);
  if (prevB)  prevB.addEventListener("click", () => nextLightbox(-1));
  if (nextB)  nextB.addEventListener("click", () => nextLightbox(1));

  if (lb) {
    lb.addEventListener("click", ev => {
      if (ev.target === lb) closeLightbox();
    });
  }

  if (inner) {
    let startX = 0;
    inner.addEventListener("touchstart", ev => {
      startX = ev.touches[0].clientX;
    });
    inner.addEventListener("touchend", ev => {
      const dx = ev.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 50) {
        if (dx < 0) nextLightbox(1);
        else        nextLightbox(-1);
      }
    });
  }

  document.addEventListener("keydown", ev => {
    if (ev.key === "Escape") closeLightbox();
    if (ev.key === "ArrowRight") nextLightbox(1);
    if (ev.key === "ArrowLeft")  nextLightbox(-1);
  });
}

// -------- Einstellungen --------
function setupSettings() {
  const btn = $("#clearAllEntries");
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (!confirm("Wirklich ALLE Einträge löschen?")) return;
    indexedDB.deleteDatabase(DB_NAME);
    alert("Alle Einträge wurden gelöscht. Bitte die Seite neu laden.");
  });
}

// -------- Boot --------
(async function init() {
  setupLogin();
  setupTabs();
  setupHistoryFilters();
  setupImagePool();
  setupWheel();
  setupLightbox();
  setupSettings();
  await setupCsvExport();

  const db = await openDB();
  await setupForm(db);
  await renderHistory();
})();
