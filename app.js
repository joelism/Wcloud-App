// Wcloud App – komplette Logik mit Einträgen, Analyse, wcloud-wheel & Backups (nur lokale Daten)

const PIN_CODE = "544221";
const DB_NAME = "wcloudPrivateTracker";
const DB_VERSION = 1;
const STORE_NAME = "sessions";
const IMAGE_URLS_KEY = "wcloudImageUrls";
const DEFAULT_IMAGE_NAME = "Wcloud-Star";
const IMAGE_TAGS_KEY = "wcloudImageTags";

function $(sel){ return document.querySelector(sel); }
function $all(sel){ return Array.from(document.querySelectorAll(sel)); }

function normalizeName(name){
  const n = (name || "").trim();
  return n || DEFAULT_IMAGE_NAME;
}

// IndexedDB ------------------------------------------------------------------

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

// Image URLs -----------------------------------------------------------------

let imageUrls = [];
let wheelDisplayed = [];
let wheelRemaining = [];
let wheelBatchSize = 5;
let imageTags = [];
let selectedTags = new Set();

// ✅ FIX: Tags werden jetzt mitgeladen & ältere Daten bleiben kompatibel
function loadImageUrls(){
  try{
    const raw = localStorage.getItem(IMAGE_URLS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(item=>{
        // Alte Struktur: nur String-URL
        if (typeof item === "string"){
          const url = item.trim();
          return url ? { url, name: DEFAULT_IMAGE_NAME, tags: [] } : null;
        }
        // Objekt-Struktur: url + name (+ optional tags)
        if (item && typeof item === "object"){
          const url = String(item.url || "").trim();
          const name = normalizeName(item.name);
          const tags = Array.isArray(item.tags) ? item.tags : [];
          return url ? { url, name, tags } : null;
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

function loadImageTags(){
  try{
    const raw = localStorage.getItem(IMAGE_TAGS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(t => String(t || "").trim()).filter(Boolean);
  }catch{
    return [];
  }
}

function saveImageTags(){
  localStorage.setItem(IMAGE_TAGS_KEY, JSON.stringify(imageTags));
}

function rebuildTagsFromImages(){
  const set = new Set();
  imageUrls.forEach(entry=>{
    if (Array.isArray(entry.tags)){
      entry.tags.forEach(t=>{
        const v = String(t || "").trim();
        if (v) set.add(v);
      });
    }
  });
  imageTags = Array.from(set).sort((a,b)=>a.localeCompare(b,"de"));
  saveImageTags();
}

function getBaseImagesForWheel(){
  if (!selectedTags || !selectedTags.size) return imageUrls.slice();
  return imageUrls.filter(entry=>{
    const tags = Array.isArray(entry.tags) ? entry.tags : [];
    return tags.some(t => selectedTags.has(t));
  });
}

function rebuildWheelPool(){
  wheelRemaining = getBaseImagesForWheel();
  wheelDisplayed = [];
}

function syncImagePoolFromStorage(){
  imageUrls = loadImageUrls();
  imageTags = loadImageTags();
  rebuildTagsFromImages();
  selectedTags = new Set();
  rebuildWheelPool();
  renderImagePool();
  renderTagManagement();
  renderWheelReset();
  syncWheelNamesFromImages();
  renderWheelTagFilter();
}

// Login ----------------------------------------------------------------------

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

// Tabs + Startscreen ---------------------------------------------------------

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

// Capture --------------------------------------------------------------------

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

// History --------------------------------------------------------------------

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

// Analyse --------------------------------------------------------------------

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

  renderBars(
    "#genderBars",
    groupBy(all, s => {
      if (s.gender === "Divers / Unklar") return "—";
      return s.gender || "—";
    }),
    ["Männlich","Weiblich","—"]
  );
  renderBars("#pornBars", groupBy(all, s=>s.porn || "—"), ["Mit","Ohne","—"]);
  renderBars("#contentBars", groupBy(all, s=>s.content || "—"), ["Wcloud112","Wcloud113","Wcloud114","Wcloud115","Wcloud116","Wcloud117","Wcloud App","—"]);

  const nameMap = groupBy(all.filter(s=>(s.name || "").trim()!==""), s=>s.name.trim());
  renderBars("#nameBars", nameMap);

  renderBars("#wetBars", groupBy(all, s=>s.wet || "—"), ["Sehr feucht","Feucht","Weniger feucht","Trocken","—"]);
}

// CSV Export -----------------------------------------------------------------

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

// wcloud-wheel ---------------------------------------------------------------

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
let selectedWheelName = "";
let wheelRotation = 0;

function renderWheelReset(){
  const grid = $("#wheelGrid");
  if (!grid) return;
  rebuildWheelPool();
  if (!wheelRemaining.length){
    grid.innerHTML = "<p class='muted'>Keine Bilder für die aktuelle Tag-Auswahl. Passe den Tag-Filter oder den Bild-Pool an.</p>";
  } else {
    grid.innerHTML = "<p class='muted'>Noch keine Bilder angezeigt. Klicke auf „Mehr Bilder laden“ oder benutze das Namen-Wheel.</p>";
  }
}

function updateVisualWheel(){
  const circle = $("#wheelCircle");
  if (!circle) return;
  const n = wheelNamesAll.length || 0;

  if (!n){
    circle.style.background = "#020617";
    const labelsOld = circle.querySelector(".wheelLabels");
    if (labelsOld) labelsOld.innerHTML = "";
    return;
  }

  const colors = ["#0f766e","#2563eb","#7c3aed","#db2777","#f97316","#84cc16","#22c55e","#06b6d4"];
  const step = 360 / n;
  const parts = [];
  for (let i = 0; i < n; i++){
    const c = colors[i % colors.length];
    const a1 = i * step;
    const a2 = (i + 1) * step;
    parts.push(`${c} ${a1}deg ${a2}deg`);
  }
  circle.style.background = `conic-gradient(${parts.join(",")})`;

  let labels = circle.querySelector(".wheelLabels");
  if (!labels){
    labels = document.createElement("div");
    labels.className = "wheelLabels";
    circle.appendChild(labels);
  }
  labels.innerHTML = "";

  const radiusPercent = 38;

  for (let i = 0; i < n; i++){
    const name = wheelNamesAll[i];
    const stepMid = i * step + step / 2;
    const rad = (stepMid - 90) * Math.PI / 180;

    const label = document.createElement("div");
    label.className = "wheelNameSlice";
    if (name === selectedWheelName){
      label.classList.add("wheelNameSlice-active");
    }
    label.textContent = name;

    const x = 50 + radiusPercent * Math.cos(rad);
    const y = 50 + radiusPercent * Math.sin(rad);
    label.style.left = x + "%";
    label.style.top = y + "%";

    labels.appendChild(label);
  }
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
  selectedWheelName = "";
  renderWheelNamesList();
  updateVisualWheel();
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
    span.className = "tagChip" + (name === selectedWheelName ? " tagChip-active" : "");
    span.textContent = name;
    list.appendChild(span);
  });
}

function resetNameWheel(){
  wheelNamesRemaining = wheelNamesAll.slice();
  selectedWheelName = "";
  const current = $("#wheelCurrentName");
  if (current) current.textContent = "";
  const circle = $("#wheelCircle");
  if (circle){
    circle.style.transition = "";
    circle.style.transform = "rotate(0deg)";
  }
  wheelRotation = 0;
  updateVisualWheel();
  renderWheelNamesList();
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
    del.textContent = "×";
    del.title = "Link löschen";
    del.style.border = "none";
    del.style.background = "transparent";
    del.style.color = "#f97373";
    del.style.fontSize = "0.9rem";
    del.style.cursor = "pointer";
    del.style.padding = "0 0.25rem";

    del.addEventListener("click",(ev)=>{
      ev.stopPropagation();
      if (!confirm("Diesen Bild-Link wirklich löschen?")) return;
      const idxInPool = imageUrls.findIndex(e => e.url === entry.url && e.name === entry.name);
      if (idxInPool >= 0){
        imageUrls.splice(idxInPool,1);
        saveImageUrls();
        rebuildTagsFromImages();
        renderImagePool();
        renderTagManagement();
        renderWheelTagFilter();
        rebuildWheelPool();
        renderWheelReset();
        syncWheelNamesFromImages();
      }
      const idxInDisplayed = wheelDisplayed.indexOf(entry);
      if (idxInDisplayed >= 0){
        wheelDisplayed.splice(idxInDisplayed,1);
        item.remove();
      }
    });

    actions.appendChild(editBtn);
    actions.appendChild(del);

    topRow.appendChild(label);
    topRow.appendChild(actions);
    item.appendChild(topRow);

    const tagsLabel = document.createElement("div");
    tagsLabel.className = "muted";
    tagsLabel.style.fontSize = "0.7rem";
    tagsLabel.style.marginTop = "0.25rem";
    tagsLabel.textContent = "Tags für dieses Bild:";
    item.appendChild(tagsLabel);

    const select = document.createElement("select");
    select.multiple = true;
    select.style.marginTop = "0.15rem";
    select.style.width = "100%";
    select.size = Math.min(4, Math.max(2, imageTags.length || 2));

    imageTags.forEach(tag=>{
      const opt = document.createElement("option");
      opt.value = tag;
      opt.textContent = tag;
      if (entry.tags && entry.tags.includes(tag)) opt.selected = true;
      select.appendChild(opt);
    });

    select.addEventListener("change", ()=>{
      const selected = Array.from(select.selectedOptions).map(o => o.value);
      entry.tags = selected;
      saveImageUrls();
      rebuildTagsFromImages();
      renderTagManagement();
      renderWheelTagFilter();
      rebuildWheelPool();
      renderWheelReset();
    });

    item.appendChild(select);

    const img = document.createElement("img");
    img.src = entry.url;
    img.alt = entry.name ? `Bild-URL – ${entry.name}` : "Bild-URL";
    img.loading = "lazy";
    img.className = "wheelImage";
    item.appendChild(img);

    // Klick auf das Item öffnet die Lightbox mit Swipe-Navigation
    item.addEventListener("click", () => {
      const idxInDisplayed = wheelDisplayed.indexOf(entry);
      if (idxInDisplayed >= 0) {
        openLightboxAt(idxInDisplayed);
      }
    });

    wrapper.appendChild(item);
  });
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
    if (!Array.isArray(entry.tags)) entry.tags = [];

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
    del.textContent = "×";
    del.title = "Link löschen";
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
      rebuildTagsFromImages();
      renderImagePool();
      renderTagManagement();
      renderWheelTagFilter();
      rebuildWheelPool();
      renderWheelReset();
      syncWheelNamesFromImages();
    });

    actions.appendChild(editBtn);
    actions.appendChild(del);

    topRow.appendChild(label);
    topRow.appendChild(actions);
    item.appendChild(topRow);

    const tagsLabel = document.createElement("div");
    tagsLabel.className = "muted";
    tagsLabel.style.fontSize = "0.7rem";
    tagsLabel.style.marginTop = "0.25rem";
    tagsLabel.textContent = "Tags für dieses Bild:";
    item.appendChild(tagsLabel);

    const select = document.createElement("select");
    select.multiple = true;
    select.style.marginTop = "0.15rem";
    select.style.width = "100%";
    select.size = Math.min(4, Math.max(2, imageTags.length || 2));

    imageTags.forEach(tag=>{
      const opt = document.createElement("option");
      opt.value = tag;
      opt.textContent = tag;
      if (entry.tags && entry.tags.includes(tag)) opt.selected = true;
      select.appendChild(opt);
    });

    select.addEventListener("change", ()=>{
      const selected = Array.from(select.selectedOptions).map(o => o.value);
      entry.tags = selected;
      saveImageUrls();
      rebuildTagsFromImages();
      renderTagManagement();
      renderWheelTagFilter();
      rebuildWheelPool();
      renderWheelReset();
    });

    item.appendChild(select);

    const img = document.createElement("img");
    img.src = entry.url;
    img.alt = entry.name ? `Bild-URL – ${entry.name}` : "Bild-URL";
    img.loading = "lazy";
    img.className = "wheelImage";
    item.appendChild(img);

    grid.appendChild(item);
  });
}

function renderTagManagement(){
  const list = $("#tagListManage");
  if (!list) return;
  list.innerHTML = "";
  if (!imageTags.length){
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Noch keine Tags definiert. Du kannst unten neue Tags hinzufügen oder Tags aus Bildern übernehmen.";
    list.appendChild(p);
    return;
  }
  imageTags.forEach(tag=>{
    const row = document.createElement("div");
    row.className = "tagRow";

    const span = document.createElement("span");
    span.className = "tagChip";
    span.textContent = tag;

    const count = imageUrls.filter(e => Array.isArray(e.tags) && e.tags.includes(tag)).length;
    const countSpan = document.createElement("span");
    countSpan.className = "tagCount";
    countSpan.textContent = `(${count})`;

    const del = document.createElement("button");
    del.textContent = "×";
    del.title = "Tag löschen";
    del.className = "iconButton";
    del.addEventListener("click", ()=>{
      if (!confirm(`Tag „${tag}“ wirklich löschen? Er wird bei allen Bildern entfernt.`)) return;
      imageTags = imageTags.filter(t => t !== tag);
      imageUrls.forEach(entry=>{
        if (!Array.isArray(entry.tags)) return;
        entry.tags = entry.tags.filter(t => t !== tag);
      });
      saveImageUrls();
      saveImageTags();
      renderImagePool();
      renderTagManagement();
      renderWheelTagFilter();
      rebuildWheelPool();
      renderWheelReset();
    });

    row.appendChild(span);
    row.appendChild(countSpan);
    row.appendChild(del);
    list.appendChild(row);
  });
}

function renderWheelTagFilter(){
  const container = $("#wheelTagFilter");
  if (!container) return;
  container.innerHTML = "";
  if (!imageTags.length){
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Keine Tags vorhanden. Es werden alle Bilder verwendet.";
    container.appendChild(p);
    return;
  }
  const hint = document.createElement("p");
  hint.className = "muted";
  hint.textContent = "Tags für das Wheel auswählen (leer = alle Bilder):";
  container.appendChild(hint);

  imageTags.forEach(tag=>{
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tagChip";
    btn.textContent = tag;
    if (selectedTags.has(tag)) btn.classList.add("tagChip-active");
    btn.addEventListener("click", ()=>{
      if (selectedTags.has(tag)) selectedTags.delete(tag);
      else selectedTags.add(tag);
      renderWheelTagFilter();
      rebuildWheelPool();
      renderWheelReset();
    });
    container.appendChild(btn);
  });

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "tagChip tagChip-clear";
  clearBtn.textContent = "Alle Tags zurücksetzen";
  clearBtn.addEventListener("click", ()=>{
    selectedTags.clear();
    renderWheelTagFilter();
    rebuildWheelPool();
    renderWheelReset();
  });
  container.appendChild(clearBtn);
}

// Wheel Logik ----------------------------------------------------------------

function handleWheelMoreClick(){
  if (!wheelRemaining.length){
    updateWheelInfo("Keine weiteren Bilder in der aktuellen Auswahl.");
    return;
  }
  const entries = pickRandomFromRemaining(wheelBatchSize);
  appendWheelImages(entries, false);
}

function handleWheelBatchChange(ev){
  const val = parseInt(ev.target.value,10);
  if (!isNaN(val) && val > 0){
    wheelBatchSize = val;
  }
}

function spinNameWheel(){
  // Einfacher Namengenerator: wählt ein zufälliges Bild aus der aktuellen Auswahl
  const base = getBaseImagesForWheel();
  if (!base.length){
    updateWheelInfo("Keine Bilder für die aktuelle Tag-Auswahl.");
    return;
  }

  // Zufälliges Bild aus der aktuellen Auswahl
  const idx = Math.floor(Math.random() * base.length);
  const entry = base[idx];

  // Aktuellen Namen anzeigen
  const currentName = $("#wheelCurrentName");
  if (currentName) currentName.textContent = entry.name || DEFAULT_IMAGE_NAME;

  // Bild unten anhängen
  appendWheelImages([entry], false);

  // Zum Bildbereich scrollen
  const grid = $("#wheelGrid");
  if (grid){
    try{
      grid.scrollIntoView({ behavior: "smooth", block: "end" });
    }catch{
      grid.scrollIntoView();
    }
  }
}

function setupWcloudWheel(){
  const moreBtn = $("#wheelMoreBtn");
  const resetBtn = $("#wheelResetBtn");
  const sizeSel = $("#wheelBatchSize");
  const spinBtn = $("#wheelSpinBtn");
  const resetNamesBtn = $("#wheelResetNamesBtn");
  const modeRadios = $all("input[name='wheelMode']");
  const regularControls = $("#wheelRegularControls");
  const nameControls = $("#wheelNameControls");

  if (moreBtn)  moreBtn.addEventListener("click", handleWheelMoreClick);
  if (resetBtn) resetBtn.addEventListener("click", renderWheelReset);
  if (sizeSel)  sizeSel.addEventListener("change", handleWheelBatchChange);
  if (spinBtn)  spinBtn.addEventListener("click", spinNameWheel);
  if (resetNamesBtn) resetNamesBtn.addEventListener("click", resetNameWheel);

  if (modeRadios && modeRadios.length){
    modeRadios.forEach(radio=>{
      radio.addEventListener("change",(ev)=>{
        wheelMode = ev.target.value || "regular";

        if (wheelMode === "regular"){
          if (regularControls) regularControls.style.display = "flex";
          if (nameControls) nameControls.style.display = "none";
          const base = getBaseImagesForWheel();
          wheelRemaining = base.slice();
          wheelDisplayed = [];
          renderWheelReset();
        } else if (wheelMode === "nameWheel"){
          if (regularControls) regularControls.style.display = "none";
          if (nameControls) nameControls.style.display = "block";
          renderWheelReset();
        }
      });
    });

    const checked = modeRadios.find(r => r.checked);
    if (checked && checked.value === "nameWheel"){
      if (regularControls) regularControls.style.display = "none";
      if (nameControls) nameControls.style.display = "block";
    } else {
      if (regularControls) regularControls.style.display = "flex";
      if (nameControls) nameControls.style.display = "none";
    }
  }
}

// Settings / Backup / Image-Management --------------------------------------

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
      rebuildTagsFromImages();
      renderImagePool();
      renderTagManagement();
      renderWheelTagFilter();
      rebuildWheelPool();
      renderWheelReset();
      syncWheelNamesFromImages();
    });
  }

  const editAllTagsBtn = $("#editAllTagsBtn");
  if (editAllTagsBtn){
    editAllTagsBtn.addEventListener("click", ()=>{
      const current = imageTags.join(", ");
      const input = prompt("Alle Tags (kommasepariert). Tags, die entfernt werden, werden auch bei Bildern gelöscht.", current);
      if (input === null) return;
      const list = input.split(",").map(t=>t.trim()).filter(Boolean);
      imageTags = Array.from(new Set(list)).sort((a,b)=>a.localeCompare(b,"de"));
      imageUrls.forEach(entry=>{
        if (!Array.isArray(entry.tags)) entry.tags = [];
        entry.tags = entry.tags.filter(t => imageTags.includes(t));
      });
      saveImageUrls();
      saveImageTags();
      rebuildWheelPool();
      renderImagePool();
      renderTagManagement();
      renderWheelTagFilter();
      renderWheelReset();
      syncWheelNamesFromImages();
    });
  }

  const newTagInput = $("#newTagInput");
  const addTagBtn = $("#addTagBtn");
  if (addTagBtn && newTagInput){
    addTagBtn.addEventListener("click", ()=>{
      const val = (newTagInput.value || "").trim();
      if (!val) return;
      if (!imageTags.includes(val)){
        imageTags.push(val);
        imageTags.sort((a,b)=>a.localeCompare(b,"de"));
        saveImageTags();
      }
      newTagInput.value = "";
      renderTagManagement();
      renderWheelTagFilter();
      renderImagePool();
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
      const entry = { url: val, name: normalizeName(nameVal), tags: [] };
      imageUrls.push(entry);
      saveImageUrls();
      rebuildTagsFromImages();
      renderImagePool();
      renderTagManagement();
      renderWheelTagFilter();
      rebuildWheelPool();
      renderWheelReset();
      syncWheelNamesFromImages();
      input.value = "";
      if (nameInput) nameInput.value = "";
    });
  }
}

// Backup-Export/Import -------------------------------------------------------

async function exportBackup(){
  const db = await openDB();
  const sessions = await getAllSessions(db);
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    sessions,
    imageUrls,
    imageTags
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
          return url ? { url, name: DEFAULT_IMAGE_NAME, tags: [] } : null;
        }
        if (item && typeof item === "object"){
          const url = String(item.url || "").trim();
          const name = normalizeName(item.name);
          const tags = Array.isArray(item.tags) ? item.tags : [];
          return url ? { url, name, tags } : null;
        }
        return null;
      })
      .filter(Boolean);
    saveImageUrls();
  }

  if (Array.isArray(data.imageTags)){
    imageTags = data.imageTags.map(t => String(t || "").trim()).filter(Boolean);
  } else {
    rebuildTagsFromImages();
  }
  saveImageTags();
  renderImagePool();
  renderTagManagement();
  renderWheelTagFilter();
  renderWheelReset();
  syncWheelNamesFromImages();
}

// Lightbox -------------------------------------------------------------------

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
      showLightboxDelta(-1);
    } else if (dy < -threshold) {
      showLightboxDelta(1);
    }
    touchStartY = null;
  });
}

// Boot -----------------------------------------------------------------------

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
