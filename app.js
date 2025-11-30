// Wcloud App – komplette Logik mit Einträgen, Analyse, Wheel & Backups (nur lokale Daten)

const PIN_CODE = "544221";
const DB_NAME = "wcloudPrivateTracker";
const DB_VERSION = 1;
const STORE_NAME = "sessions";
const IMAGE_URLS_KEY = "wcloudImageUrls";
const DEFAULT_IMAGE_NAME = "Wcloud-Star";

// Helpers
function $(sel){ return document.querySelector(sel); }
function $all(sel){ return Array.from(document.querySelectorAll(sel)); }

function normalizeName(name) {
  const n = (name || "").trim();
  return n || DEFAULT_IMAGE_NAME;
}

// ---------- IndexedDB ----------
function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (ev)=>{
      const db = ev.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)){
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
        store.createIndex("isoDate", "isoDate", { unique:false });
      }
    };
  });
}

function addSession(db, session){
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE_NAME).add(session);
  });
}

function getAllSessions(db){
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function clearAllSessions(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ---------- Image URLs (localStorage) ----------
let imageUrls = [];
let wheelDisplayed = [];
let wheelRemaining = [];
let wheelBatchSize = 5;

function loadImageUrls(){
  try{
    const raw = localStorage.getItem(IMAGE_URLS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(item=>{
        if (typeof item === "string"){
          const url = item.trim();
          return url ? { url, name: DEFAULT_IMAGE_NAME } : null;
        }
        if (item && typeof item === "object"){
          const url = String(item.url || "").trim();
          const name = normalizeName(item.name);
          return url ? { url, name } : null;
        }
        return null;
      })
      .filter(Boolean);
  }catch{
    return [];
  }
}

function saveImageUrls(){
  localStorage.setItem(IMAGE_URLS_KEY, JSON.stringify(imageUrls));
}

function syncImagePoolFromStorage(){
  imageUrls = loadImageUrls();
  wheelRemaining = imageUrls.slice();
  wheelDisplayed = [];
  renderImagePool();
  renderWheelReset();
  syncWheelNamesFromImages();
}

// ---------- Login ----------
function setupLogin(){
  const form = $("#loginForm");
  const input = $("#pinInput");
  const error = $("#loginError");
  const overlay = $("#login");
  const app = $("#app");
  if (!form || !input || !overlay || !app) return;

  form.addEventListener("submit",(ev)=>{
    ev.preventDefault();
    const val = (input.value || "").trim();
    if (val === PIN_CODE){
      error.hidden = true;
      overlay.style.display = "none";
      app.hidden = false;
    } else {
      error.hidden = false;
    }
  });
}

// ---------- Tabs + Startscreen ----------
function activateTab(tabId){
  const tabs = $all(".tab");
  const panels = $all(".tabPanel");
  tabs.forEach(btn=>{
    if (btn.dataset.tab === tabId) btn.classList.add("active");
    else btn.classList.remove("active");
  });
  panels.forEach(panel=>{
    if (panel.id === tabId) panel.classList.add("activePanel");
    else panel.classList.remove("activePanel");
  });
  const mainTabs = $("#mainTabs");
  if (mainTabs) mainTabs.style.display = "flex";
}

function setupTabs(){
  const tabs = $all(".tab");
  tabs.forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.dataset.tab;
      if (id) activateTab(id);
    });
  });
}

function setupStartScreen(){
  const start = $("#startScreen");
  const btnEntries = $("#startEntries");
  const btnWheel = $("#startWheel");
  const btnSettings = $("#startSettings");
  if (!start) return;

  start.style.display = "flex";

  if (btnEntries){
    btnEntries.addEventListener("click", ()=>{
      start.style.display = "none";
      activateTab("capture");
    });
  }
  if (btnWheel){
    btnWheel.addEventListener("click", ()=>{
      start.style.display = "none";
      activateTab("wheel");
    });
  }
  if (btnSettings){
    btnSettings.addEventListener("click", ()=>{
      start.style.display = "none";
      activateTab("settings");
    });
  }
}

// ---------- Eintrag erfassen ----------
async function setupForm(db){
  const form = $("#sessionForm");
  const dt = $("#dt");
  const contentSel = $("#content");
  const nameInput = $("#personName");
  if (!form || !dt || !contentSel) return;

  const now = new Date();
  dt.value = new Date(now.getTime() - now.getTimezoneOffset()*60000).toISOString().slice(0,16);

  form.addEventListener("submit", async (ev)=>{
    ev.preventDefault();

    const iso = dt.value ? new Date(dt.value).toISOString() : new Date().toISOString();
    const content = contentSel.value;
    const personName = (nameInput && nameInput.value || "").trim();

    const wet = (form.querySelector("input[name='wet']:checked") || {}).value || "";
    const gender = (form.querySelector("input[name='gender']:checked") || {}).value || "";
    const porn = (form.querySelector("input[name='porn']:checked") || {}).value || "";

    const session = {
      isoDate: iso,
      content,
      name: personName,
      wet,
      gender,
      porn,
      createdAt: new Date().toISOString()
    };

    try {
      await addSession(db, session);
      form.reset();
      dt.value = new Date().toISOString().slice(0,16);
      await renderHistory();
      await renderAnalysis();
      alert("Eintrag gespeichert.");
    } catch (e) {
      console.error(e);
      alert("Fehler beim Speichern.");
    }
  });
}

// ---------- Verlauf ----------
let cachedSessions = [];

async function reloadSessions(){
  const db = await openDB();
  cachedSessions = await getAllSessions(db);
  cachedSessions.sort((a,b)=> (a.isoDate || "").localeCompare(b.isoDate || ""));
}

function formatDateTime(iso){
  try{
    const d = new Date(iso);
    return d.toLocaleString("de-CH", { dateStyle:"short", timeStyle:"short" });
  }catch{
    return iso || "";
  }
}

function applyHistoryFilters(list){
  const dateInput = $("#searchDate");
  const filterContent = $("#filterContent");
  const filterGender = $("#filterGender");
  const filterPorn = $("#filterPorn");

  const dateVal = dateInput && dateInput.value ? dateInput.value : "";
  const contentVal = filterContent && filterContent.value ? filterContent.value : "";
  const genderVal = filterGender && filterGender.value ? filterGender.value : "";
  const pornVal = filterPorn && filterPorn.value ? filterPorn.value : "";

  return list.filter(s=>{
    if (dateVal){
      const d = (s.isoDate || "").slice(0,10);
      if (d !== dateVal) return false;
    }
    if (contentVal && s.content !== contentVal) return false;
    if (genderVal && s.gender !== genderVal) return false;
    if (pornVal && s.porn !== pornVal) return false;
    return true;
  });
}

async function renderHistory(){
  const container = $("#historyList");
  if (!container) return;
  await reloadSessions();
  const filtered = applyHistoryFilters(cachedSessions);
  if (!filtered.length){
    container.innerHTML = "<p class='muted'>Noch keine Einträge.</p>";
    return;
  }
  container.innerHTML = "";
  filtered.forEach(s=>{
    const div = document.createElement("div");
    div.className = "entry";
    const main = document.createElement("div");
    main.className = "entry-main";
    main.textContent = s.content || "—";
    const meta = document.createElement("div");
    meta.className = "entry-meta";
    const parts = [];
    parts.push(formatDateTime(s.isoDate));
    if (s.name) parts.push("Name: " + s.name);
    if (s.gender) parts.push("Geschlecht: " + s.gender);
    if (s.porn) parts.push("Porno: " + s.porn);
    if (s.wet) parts.push("Feuchtigkeit: " + s.wet);
    meta.textContent = parts.join(" · ");
    div.appendChild(main);
    div.appendChild(meta);
    container.appendChild(div);
  });
}

function setupHistoryFilters(){
  const dateInput = $("#searchDate");
  const filterContent = $("#filterContent");
  const filterGender = $("#filterGender");
  const filterPorn = $("#filterPorn");
  const clear = $("#clearFilters");

  [dateInput, filterContent, filterGender, filterPorn].forEach(el=>{
    if (!el) return;
    el.addEventListener("change", ()=>{ renderHistory(); });
  });
  if (clear){
    clear.addEventListener("click", ()=>{
      if (dateInput) dateInput.value = "";
      if (filterContent) filterContent.value = "";
      if (filterGender) filterGender.value = "";
      if (filterPorn) filterPorn.value = "";
      renderHistory();
    });
  }
}

// ---------- Analyse ----------
function groupBy(list, fnKey){
  const map = new Map();
  list.forEach(item=>{
    const k = fnKey(item);
    map.set(k, (map.get(k) || 0) + 1);
  });
  return map;
}

function renderBars(containerSel, mapOrList, order){
  const container = $(containerSel);
  if (!container) return;
  container.innerHTML = "";
  let entries;
  if (mapOrList instanceof Map){
    entries = Array.from(mapOrList.entries());
  } else if (Array.isArray(mapOrList)){
    entries = mapOrList;
  } else {
    return;
  }
  if (order && Array.isArray(order)){
    const orderMap = new Map(order.map((k,i)=>[k,i]));
    entries.sort((a,b)=> (orderMap.get(a[0]) ?? 999) - (orderMap.get(b[0]) ?? 999));
  } else {
    entries.sort((a,b)=> b[1] - a[1]);
  }
  const max = entries.reduce((m, [,v])=>Math.max(m,v), 0) || 1;
  entries.forEach(([label, value])=>{
    const row = document.createElement("div");
    row.className = "barRow";
    const lbl = document.createElement("div");
    lbl.className = "barLabel";
    lbl.textContent = label;
    const track = document.createElement("div");
    track.className = "barTrack";
    const fill = document.createElement("div");
    fill.className = "barFill";
    fill.style.width = (value / max * 100).toFixed(0) + "%";
    track.appendChild(fill);
    const val = document.createElement("div");
    val.className = "barVal";
    val.textContent = String(value);
    row.appendChild(lbl);
    row.appendChild(track);
    row.appendChild(val);
    container.appendChild(row);
  });
}

async function renderAnalysis(){
  const container = $("#statsSummary");
  if (!container) return;
  await reloadSessions();
  const all = cachedSessions.slice();
  if (!all.length){
    container.innerHTML = "<p class='muted'>Noch keine Daten für die Analyse.</p>";
    ["#perDay","#weekdayBars","#genderBars","#pornBars","#contentBars","#nameBars","#wetBars"].forEach(sel=>{
      const el = $(sel);
      if (el) el.innerHTML = "";
    });
    return;
  }
  const first = all[0];
  const last = all[all.length-1];
  const daysSpan = Math.max(1, Math.round((new Date(last.isoDate) - new Date(first.isoDate)) / 86400000) + 1);
  const avgPerDay = (all.length / daysSpan).toFixed(2);

  container.innerHTML = `<p>Gesamt: <strong>${all.length}</strong> Einträge über <strong>${daysSpan}</strong> Tage (Ø ${avgPerDay} pro Tag).</p>`;

  const perDayMap = groupBy(all, s=>(s.isoDate || "").slice(0,10) || "—");
  renderBars("#perDay", perDayMap);

  const weekdayNames = ["So","Mo","Di","Mi","Do","Fr","Sa"];
  const weekdayMap = groupBy(all, s=>{
    try { return weekdayNames[new Date(s.isoDate).getDay()] || "—"; }
    catch { return "—"; }
  });
  renderBars("#weekdayBars", weekdayMap, weekdayNames);

  renderBars("#genderBars", groupBy(all, s=>s.gender || "—"), ["Männlich","Weiblich","—"]);
  renderBars("#pornBars", groupBy(all, s=>s.porn || "—"), ["Mit","Ohne","—"]);
  renderBars("#contentBars", groupBy(all, s=>s.content || "—"), ["Wcloud112","Wcloud113","Wcloud114","Wcloud115","Wcloud116","Wcloud117","Wcloud App","—"]);

  const nameMap = groupBy(all.filter(s=>(s.name || "").trim()!==""), s=>s.name.trim());
  renderBars("#nameBars", nameMap);

  renderBars("#wetBars", groupBy(all, s=>s.wet || "—"), ["Sehr feucht","Feucht","Weniger feucht","Trocken","—"]);
}

// ---------- CSV Export ----------
function setupExport(){
  const btn = $("#exportCsv");
  if (!btn) return;
  btn.addEventListener("click", async ()=>{
    await reloadSessions();
    if (!cachedSessions.length){
      alert("Keine Daten zum Exportieren.");
      return;
    }
    const header = ["isoDate","content","name","wet","gender","porn","createdAt"];
    const lines = [header.join(";")];
    cachedSessions.forEach(s=>{
      const row = header.map(k => `"${String(s[k] ?? "").replace(/"/g,'""')}"`).join(";");
      lines.push(row);
    });
    const blob = new Blob([lines.join("\n")], { type:"text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "wcloud-export.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

// ---------- wcloud-wheel + Lightbox ----------
function updateWheelInfo(message){
  const grid = $("#wheelGrid");
  if (!grid) return;
  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = message;
  grid.appendChild(p);
}

let wheelMode = "regular";

let wheelNamesAll = [];
let wheelNamesRemaining = [];

function renderWheelReset(){
  const grid = $("#wheelGrid");
  if (!grid) return;
  wheelRemaining = imageUrls.slice();
  wheelDisplayed = [];
  grid.innerHTML = "<p class='muted'>Noch keine Bilder angezeigt. Klicke auf „Mehr Bilder laden“ oder benutze das Namen-Wheel.</p>";
}

function syncWheelNamesFromImages(){
  const names = Array.from(
    new Set(
      imageUrls
        .map(e => normalizeName(e.name))
        .filter(Boolean)
    )
  );
  wheelNamesAll = names;
  wheelNamesRemaining = names.slice();
  renderWheelNamesList();
  const current = $("#wheelCurrentName");
  if (current) current.textContent = names.length ? "" : "(keine Namen hinterlegt)";
}

function renderWheelNamesList(){
  const list = $("#wheelNamesList");
  if (!list) return;
  list.innerHTML = "";
  if (!wheelNamesAll.length){
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Noch keine Namen im Bild-Pool. Füge in den Einstellungen Name + URL hinzu.";
    list.appendChild(p);
    return;
  }
  wheelNamesAll.forEach(name=>{
    const span = document.createElement("span");
    span.className = "tagChip";
    span.textContent = name;
    list.appendChild(span);
  });
}

function resetNameWheel(){
  wheelNamesRemaining = wheelNamesAll.slice();
  const current = $("#wheelCurrentName");
  if (current) current.textContent = "";
}

function pickRandomFromRemaining(count){
  const out = [];
  while (wheelRemaining.length && out.length < count){
    const idx = Math.floor(Math.random()*wheelRemaining.length);
    out.push(wheelRemaining.splice(idx,1)[0]);
  }
  return out;
}

function appendWheelImages(entries, replace){
  const grid = $("#wheelGrid");
  if (!grid || !entries.length) return;

  if (replace){
    grid.innerHTML = "";
    wheelDisplayed = [];
  } else if (wheelDisplayed.length === 0){
    grid.innerHTML = "";
  }

  let wrapper = grid.querySelector(".wheelGridInner");
  if (!wrapper){
    wrapper = document.createElement("div");
    wrapper.className = "wheelGridInner";
    grid.appendChild(wrapper);
  }
  entries.forEach(entry=>{
    const index = wheelDisplayed.length;
    wheelDisplayed.push(entry);
    const item = document.createElement("div");
    item.className = "wheelItem";

    if (entry.name){
      const label = document.createElement("div");
      label.className = "wheelLabel";
      label.textContent = entry.name;
      item.appendChild(label);
    }

    const img = document.createElement("img");
    img.src = entry.url;
    img.alt = entry.name ? `wcloud-wheel Bild – ${entry.name}` : "wcloud-wheel Bild";
    img.loading = "lazy";
    img.className = "wheelImage";
    img.addEventListener("click", ()=>{
      openLightboxAt(index);
    });
    item.appendChild(img);
    wrapper.appendChild(item);
  });
}

function handleWheelMoreClick(){
  const grid = $("#wheelGrid");
  if (!imageUrls.length){
    if (grid) grid.innerHTML = "<p class='muted'>Noch keine Bilder im Pool. Füge im Tab „Einstellungen“ Bild-URLs hinzu.</p>";
    return;
  }
  if (!wheelRemaining.length){
    updateWheelInfo("Alle Bilder wurden bereits angezeigt. Mit „Zurücksetzen“ kannst du neu mischen.");
    return;
  }
  const batch = pickRandomFromRemaining(wheelBatchSize);
  appendWheelImages(batch, false);
}

function spinNameWheel(){
  const grid = $("#wheelGrid");
  if (!imageUrls.length){
    if (grid) grid.innerHTML = "<p class='muted'>Noch keine Bilder im Pool. Füge im Tab „Einstellungen“ Bild-URLs hinzu.</p>";
    return;
  }
  if (!wheelNamesAll.length){
    updateWheelInfo("Es sind keine Namen hinterlegt. Füge in den Einstellungen Name + URL hinzu.");
    return;
  }
  if (!wheelNamesRemaining.length){
    updateWheelInfo("Alle Namen wurden bereits gezogen. Mit „Zurücksetzen“ kannst du neu starten.");
    return;
  }

  const idx = Math.floor(Math.random() * wheelNamesRemaining.length);
  const name = wheelNamesRemaining.splice(idx, 1)[0];

  const current = $("#wheelCurrentName");
  if (current) current.textContent = "Ausgewählt: " + name;

  const matchingEntries = imageUrls.filter(e => normalizeName(e.name) === name);
  if (!matchingEntries.length){
    updateWheelInfo("Für den Namen „" + name + "“ sind aktuell keine Bilder hinterlegt.");
    return;
  }

  const usedUrls = new Set(wheelDisplayed.map(e => e.url));
  const unused = matchingEntries.filter(e => !usedUrls.has(e.url));
  const pool = unused.length ? unused : matchingEntries;

  const imgIdx = Math.floor(Math.random() * pool.length);
  const chosenEntry = pool[imgIdx];

  appendWheelImages([chosenEntry], false);
}

function handleWheelBatchChange(ev){
  const val = parseInt(ev.target.value, 10);
  if (!isNaN(val)) wheelBatchSize = val;
}

function updateWheelModeUI(){
  const regular = $("#wheelRegularControls");
  const nameControls = $("#wheelNameControls");
  if (regular) regular.style.display = (wheelMode === "regular" ? "flex" : "none");
  if (nameControls) nameControls.style.display = (wheelMode === "nameWheel" ? "block" : "none");
}

function setupWcloudWheel(){
  const moreBtn = $("#wheelMoreBtn");
  const resetBtn = $("#wheelResetBtn");
  const sizeSel = $("#wheelBatchSize");
  const spinBtn = $("#wheelSpinBtn");
  const resetNamesBtn = $("#wheelResetNamesBtn");
  const modeRadios = $all("input[name='wheelMode']");

  if (moreBtn)  moreBtn.addEventListener("click", handleWheelMoreClick);
  if (resetBtn) resetBtn.addEventListener("click", renderWheelReset);
  if (sizeSel)  sizeSel.addEventListener("change", handleWheelBatchChange);
  if (spinBtn) spinBtn.addEventListener("click", spinNameWheel);
  if (resetNamesBtn) resetNamesBtn.addEventListener("click", resetNameWheel);

  if (modeRadios && modeRadios.length){
    modeRadios.forEach(radio=>{
      radio.addEventListener("change",(ev)=>{
        wheelMode = ev.target.value || "regular";
        updateWheelModeUI();
      });
      if (radio.checked){
        wheelMode = radio.value || "regular";
      }
    });
  }
  updateWheelModeUI();
}

// Lightbox (vertikal swipen)
let lightboxIndex = -1;
let touchStartY = null;

function openLightboxAt(index){
  if (index < 0 || index >= wheelDisplayed.length) return;
  lightboxIndex = index;
  const overlay = $("#imageLightbox");
  const img = $("#lightboxImage");
  if (!overlay || !img) return;
  const entry = wheelDisplayed[index];
  img.src = entry && entry.url ? entry.url : "";
  overlay.classList.add("active");
}

function closeLightbox(){
  const overlay = $("#imageLightbox");
  if (!overlay) return;
  overlay.classList.remove("active");
  lightboxIndex = -1;
}

function showLightboxDelta(delta){
  if (lightboxIndex < 0) return;
  let idx = lightboxIndex + delta;
  if (idx < 0) idx = wheelDisplayed.length - 1;
  if (idx >= wheelDisplayed.length) idx = 0;
  openLightboxAt(idx);
}

function setupLightbox(){
  const overlay = $("#imageLightbox");
  const closeBtn = $("#lightboxClose");
  const prevBtn = $("#lightboxPrev");
  const nextBtn = $("#lightboxNext");
  const inner = $("#lightboxInner");
  if (!overlay || !inner) return;

  if (closeBtn) closeBtn.addEventListener("click", closeLightbox);
  if (prevBtn) prevBtn.addEventListener("click", ()=>showLightboxDelta(-1));
  if (nextBtn) nextBtn.addEventListener("click", ()=>showLightboxDelta(1));

  overlay.addEventListener("click",(ev)=>{
    if (ev.target === overlay) closeLightbox();
  });

  overlay.addEventListener("touchstart",(ev)=>{
    if (ev.touches && ev.touches.length === 1){
      touchStartY = ev.touches[0].clientY;
    }
  });
  overlay.addEventListener("touchend",(ev)=>{
    if (touchStartY == null || !ev.changedTouches || !ev.changedTouches.length) return;
    const dy = ev.changedTouches[0].clientY - touchStartY;
    const threshold = 40;
    if (dy > threshold) {
      showLightboxDelta(-1); // nach unten wischen -> vorheriges Bild
    } else if (dy < -threshold) {
      showLightboxDelta(1); // nach oben wischen -> nächstes Bild
    }
    touchStartY = null;
  });
}

// ---------- Settings + Backups + Image-Pool ----------
async function exportBackup(){
  const db = await openDB();
  const sessions = await getAllSessions(db);
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    sessions,
    imageUrls
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `wcloud-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importBackupFile(file){
  const text = await file.text();
  let data;
  try{
    data = JSON.parse(text);
  }catch{
    throw new Error("Backup-Datei ist kein gültiges JSON.");
  }
  if (!data || typeof data !== "object"){
    throw new Error("Backup-Datei hat ein ungültiges Format.");
  }

  if (Array.isArray(data.sessions)){
    const db = await openDB();
    for (const s of data.sessions){
      if (!s) continue;
      const { id, ...rest } = s;
      if (rest.isoDate){
        try{ await addSession(db, rest); }
        catch(e){ console.warn("Konnte Session aus Backup nicht importieren:", e); }
      }
    }
    await renderHistory();
    await renderAnalysis();
  }

  if (Array.isArray(data.imageUrls)){
    imageUrls = data.imageUrls
      .map(item=>{
        if (typeof item === "string"){
          const url = item.trim();
          return url ? { url, name: DEFAULT_IMAGE_NAME } : null;
        }
        if (item && typeof item === "object"){
          const url = String(item.url || "").trim();
          const name = normalizeName(item.name);
          return url ? { url, name } : null;
        }
        return null;
      })
      .filter(Boolean);
    saveImageUrls();
    renderImagePool();
    renderWheelReset();
    syncWheelNamesFromImages();
  }
}


function renderImagePool(){
  const info = $("#imagePoolInfo");
  const grid = $("#imagePoolGrid");
  if (info){
    info.textContent = imageUrls.length
      ? `${imageUrls.length} Bild-URLs im Pool.`
      : "Aktuell sind keine Bild-URLs im Pool gespeichert.";
  }
  if (!grid) return;
  grid.innerHTML = "";
  if (!imageUrls.length) return;
  imageUrls.forEach((entry, idx)=>{
    const item = document.createElement("div");
    item.className = "wheelItem";

    const topRow = document.createElement("div");
    topRow.style.display = "flex";
    topRow.style.alignItems = "center";
    topRow.style.justifyContent = "space-between";
    topRow.style.columnGap = "0.25rem";

    const label = document.createElement("div");
    label.className = "wheelLabel";
    label.textContent = entry.name || DEFAULT_IMAGE_NAME;
    label.style.flex = "1 1 auto";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.alignItems = "center";
    actions.style.gap = "0.15rem";

    const editBtn = document.createElement("button");
    editBtn.className = "wheelEdit";
    editBtn.textContent = "✎";
    editBtn.title = "Namen bearbeiten";
    editBtn.style.border = "none";
    editBtn.style.background = "transparent";
    editBtn.style.color = "#9ca3af";
    editBtn.style.fontSize = "0.75rem";
    editBtn.style.cursor = "pointer";
    editBtn.style.padding = "0 0.25rem";

    editBtn.addEventListener("click",(ev)=>{
      ev.stopPropagation();
      const currentName = entry.name || "";
      const newNameRaw = prompt("Neuer Name für dieses Bild (leer = Wcloud-Star)", currentName);
      if (newNameRaw === null) return;
      const finalName = normalizeName(newNameRaw);
      entry.name = finalName;
      saveImageUrls();
      renderImagePool();
      renderWheelReset();
      syncWheelNamesFromImages();
    });

    const del = document.createElement("button");
    del.className = "wheelDelete";
    del.textContent = "×";
    del.title = "Link löschen";
    del.style.position = "static";
    del.style.border = "none";
    del.style.background = "transparent";
    del.style.color = "#f97373";
    del.style.fontSize = "0.9rem";
    del.style.cursor = "pointer";
    del.style.padding = "0 0.25rem";

    del.addEventListener("click",(ev)=>{
      ev.stopPropagation();
      if (!confirm("Diesen Bild-Link wirklich löschen?")) return;
      imageUrls.splice(idx,1);
      saveImageUrls();
      renderImagePool();
      wheelRemaining = imageUrls.slice();
      wheelDisplayed = [];
      renderWheelReset();
      syncWheelNamesFromImages();
    });

    actions.appendChild(editBtn);
    actions.appendChild(del);

    topRow.appendChild(label);
    topRow.appendChild(actions);
    item.appendChild(topRow);

    const img = document.createElement("img");
    img.src = entry.url;
    img.alt = entry.name ? `Bild-URL – ${entry.name}` : "Bild-URL";
    img.loading = "lazy";
    img.className = "wheelImage";

    item.appendChild(img);
    grid.appendChild(item);
  });
}
function setupSettings(){
  const clearBtn = $("#clearAllEntries");
  const exportBtn = $("#exportBackupBtn");
  const importInput = $("#importBackupInput");
  const info = $("#backupInfo");
  const dangerToggle = $("#toggleDangerZone");
  const dangerZone = $("#dangerZone");

  if (dangerToggle && dangerZone){
    dangerToggle.addEventListener("click", ()=>{
      const visible = dangerZone.style.display !== "none";
      dangerZone.style.display = visible ? "none" : "block";
    });
  }

  if (clearBtn){
    clearBtn.addEventListener("click", async ()=>{
      if (!confirm("Wirklich ALLE Einträge löschen?")) return;
      try{
        await clearAllSessions();
        await renderHistory();
        await renderAnalysis();
        alert("Alle Einträge wurden gelöscht.");
      }catch(e){
        console.error(e);
        alert("Fehler beim Löschen der Einträge.");
      }
    });
  }

  const clearUrlsBtn = $("#clearImageUrlsBtn");
  if (clearUrlsBtn){
    clearUrlsBtn.addEventListener("click", ()=>{
      if (!confirm("Wirklich ALLE Bild-URLs löschen?")) return;
      imageUrls = [];
      saveImageUrls();
      renderImagePool();
      renderWheelReset();
      syncWheelNamesFromImages();
    });
  }

  if (exportBtn){
    exportBtn.addEventListener("click", async ()=>{
      if (info) info.textContent = "Backup wird erstellt …";
      try{
        await exportBackup();
        if (info) info.textContent = "Backup wurde exportiert.";
      }catch(e){
        console.error(e);
        if (info) info.textContent = "Fehler beim Exportieren des Backups.";
        alert("Fehler beim Exportieren des Backups.");
      }
    });
  }

  if (importInput){
    importInput.addEventListener("change", async (ev)=>{
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      if (info) info.textContent = "Backup wird importiert …";
      try{
        await importBackupFile(file);
        if (info) info.textContent = "Backup wurde importiert.";
      }catch(e){
        console.error(e);
        if (info) info.textContent = e.message || "Fehler beim Importieren des Backups.";
        alert(e.message || "Fehler beim Importieren des Backups.");
      }finally{
        ev.target.value = "";
      }
    });
  }

  const addBtn = $("#addImageUrlBtn");
  const input = $("#imageUrlInput");
  const nameInput = $("#imageNameInput");
  if (addBtn && input){
    addBtn.addEventListener("click", ()=>{
      const val = (input.value || "").trim();
      const nameVal = (nameInput && nameInput.value || "").trim();
      if (!val) return;
      if (!/^https?:\/\//i.test(val)){
        alert("Bitte eine gültige URL mit http/https eingeben.");
        return;
      }
      const entry = { url: val, name: normalizeName(nameVal) };
      imageUrls.push(entry);
      saveImageUrls();
      input.value = "";
      if (nameInput) nameInput.value = "";
      renderImagePool();
      renderWheelReset();
      syncWheelNamesFromImages();
    });
  }
}

// ---------- Boot ----------
(async function boot(){
  setupLogin();
  setupTabs();
  setupStartScreen();
  setupWcloudWheel();
  setupLightbox();
  syncImagePoolFromStorage();

  const db = await openDB();
  await setupForm(db);
  setupHistoryFilters();
  await renderHistory();
  await renderAnalysis();
  setupExport();
  setupSettings();
})();
