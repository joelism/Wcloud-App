// Privates Protokoll (18+) – lokaler Tracker
// Daten in IndexedDB, keine externen Abhängigkeiten

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

function tx(db, mode="readonly") { return db.transaction("sessions", mode).objectStore("sessions"); }

function addSession(db, obj) {
  return new Promise((resolve, reject) => {
    const r = tx(db, "readwrite").add(obj);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function getAllSessions(db) {
  return new Promise((resolve, reject) => {
    const r = tx(db, "readonly").getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}

function deleteSession(db, id) {
  return new Promise((resolve, reject) => {
    const r = tx(db, "readwrite").delete(id);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function nowLocalInputValue() {
  const d = new Date();
  const pad = (n)=> String(n).padStart(2,"0");
  const y = d.getFullYear();
  const m = pad(d.getMonth()+1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${y}-${m}-${day}T${h}:${mi}`;
}
function toIsoDate(ts) {
  const d = new Date(ts);
  const pad = (n)=> String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function weekdayIndex(ts){ return new Date(ts).getDay(); } // 0=So
function weekdayName(i){
  return ["So","Mo","Di","Mi","Do","Fr","Sa"][i];
}

// ---------- Login ----------
const PIN = "544221";
function setupLogin() {
  const overlay = document.getElementById("login");
  const app = document.getElementById("app");
  const pinInput = document.getElementById("pinInput");
  const loginBtn = document.getElementById("loginBtn");
  const err = document.getElementById("loginError");
  const toggle = document.getElementById("togglePinVis");

  function unlock(){
    overlay.style.display = "none";
    app.hidden = false;
  }

  // immer PIN abfragen
  overlay.style.display = "flex";

  loginBtn.addEventListener("click", () => {
    if (pinInput.value.replace(/\D/g, "") === PIN) {
      unlock();
    } else {
      err.hidden = false;
      setTimeout(() => { err.hidden = true; }, 1800);
    }
  });

  pinInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loginBtn.click();
  });

  if (toggle) {
    toggle.addEventListener("click", ()=>{
      pinInput.type = (pinInput.type === "password" ? "text" : "password");
    });
  }
}

// ---------- Tabs ----------
function setupTabs() {
  $$(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      $$(".tabPanel").forEach(p => p.classList.add("hidden"));
      $("#" + tab).classList.remove("hidden");
      if (tab === "analysis") renderAnalysis();
      if (tab === "history") renderHistory();
    });
  });
}

// ---------- Form Capture ----------
async function setupForm(db) {
  const dt = $("#dt");
  dt.value = nowLocalInputValue();

  $("#sessionForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const dtVal = $("#dt").value;
    const wet = (new FormData(e.target).get("wet"));
    const gender = (new FormData(e.target).get("gender"));
    const porn = (new FormData(e.target).get("porn"));
    const content = $("#content").value;
    const personName = $("#personName").value.trim();

    const createdAt = Date.parse(dtVal);
    if (isNaN(createdAt)) {
      alert("Ungültiges Datum/Uhrzeit.");
      return;
    }
    const obj = {
      createdAt,
      isoDate: toIsoDate(createdAt),
      wet,
      gender,
      porn,
      content,
      name: personName
    };
    await addSession(db, obj);
    e.target.reset();
    dt.value = nowLocalInputValue();
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
  const d = $("#searchDate").value;
  const c = $("#filterContent").value;
  const g = $("#filterGender").value;
  const p = $("#filterPorn").value;
  if (d && s.isoDate !== d) return false;
  if (c && s.content !== c) return false;
  if (g && s.gender !== g) return false;
  if (p && s.porn !== p) return false;
  return true;
}

function renderHistoryList(list) {
  const cont = $("#historyList");
  cont.innerHTML = "";
  if (!list.length) {
    cont.innerHTML = "<p class='muted'>Noch keine Einträge.</p>";
    return;
  }
  list.sort((a,b)=> b.createdAt - a.createdAt);
  list.forEach(s => {
    const d = new Date(s.createdAt);
    const div = document.createElement("div");
    div.className = "entry";
    const main = document.createElement("div");
    main.innerHTML = `<div><strong>${s.isoDate}</strong> ${d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
      <div class="meta">${s.content} · ${s.gender} · ${s.porn} · ${s.wet}${s.name? " · " + s.name : ""}</div>`;
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
  const filtered = all.filter(passesFilters);
  renderHistoryList(filtered);
}

// ---------- Analysis ----------
function countBy(list, keyFn) {
  const m = new Map();
  list.forEach(it => {
    const k = keyFn(it);
    m.set(k, (m.get(k)||0) + 1);
  });
  return m;
}

function maxVal(map) { let m=0; map.forEach(v => { if (v>m) m=v; }); return m; }

function makeBarRow(label, value, max) {
  const row = document.createElement("div");
  row.className = "barRow";
  const lab = document.createElement("div"); lab.className = "barLabel"; lab.textContent = label;
  const track = document.createElement("div"); track.className = "barTrack";
  const fill = document.createElement("div"); fill.className = "barFill";
  const pct = max ? (value/max)*100 : 0;
  fill.style.width = Math.max(1, pct) + "%";
  track.appendChild(fill);
  const val = document.createElement("div"); val.className = "barVal"; val.textContent = String(value);
  row.appendChild(lab); row.appendChild(track); row.appendChild(val);
  return row;
}

function renderBars(containerSel, map, orderList=null, labelFormat=(k)=>k) {
  const cont = $(containerSel);
  cont.innerHTML = "";
  let entries = Array.from(map.entries());
  if (orderList) {
    const ordIdx = new Map(orderList.map((k,i)=>[k,i]));
    entries.sort((a,b)=> (ordIdx.get(a[0])??999) - (ordIdx.get(b[0])??999));
  } else {
    entries.sort((a,b)=> b[1]-a[1]);
  }
  const mx = maxVal(map);
  entries.forEach(([k,v]) => cont.appendChild(makeBarRow(labelFormat(k), v, mx)));
  if (!entries.length) cont.innerHTML = "<p class='muted'>Noch keine Daten.</p>";
}

function renderPerDayTable(list) {
  const cont = $("#perDay");
  cont.innerHTML = "";
  if (!list.length) { cont.innerHTML = "<p class='muted'>Noch keine Daten.</p>"; return; }
  const byDay = countBy(list, s => s.isoDate);
  const arr = Array.from(byDay.entries()).sort((a,b)=> a[0].localeCompare(b[0]));
  arr.forEach(([day, n]) => {
    const row = document.createElement("div");
    row.className = "tableRow";
    const left = document.createElement("div"); left.textContent = day;
    const right = document.createElement("div"); right.textContent = n;
    row.appendChild(left); row.appendChild(right);
    cont.appendChild(row);
  });
}

async function renderAnalysis() {
  const db = await openDB();
  const all = await getAllSessions(db);
  const sum = $("#statsSummary");
  sum.innerHTML = "";
  const total = all.length;
  const last = all.slice().sort((a,b)=> b.createdAt-a.createdAt)[0];
  const pill = (txt) => { const s=document.createElement("span"); s.className="pill"; s.textContent = txt; return s; };
  sum.appendChild(pill(`Gesamt: ${total}`));
  if (last) {
    const d = new Date(last.createdAt);
    sum.appendChild(pill(`Letzter Eintrag: ${last.isoDate} ${d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`));
  }

  renderPerDayTable(all);

  const byWd = countBy(all, s => weekdayIndex(s.createdAt));
  renderBars("#weekdayBars", byWd, [1,2,3,4,5,6,0], (k)=> weekdayName(k));

  const byGender = countBy(all, s => s.gender || "—");
  renderBars("#genderBars", byGender);

  const byPorn = countBy(all, s => s.porn || "—");
  renderBars("#pornBars", byPorn, ["Mit","Ohne"]);

  const byContent = countBy(all, s => s.content || "—");
  renderBars("#contentBars", byContent, ["Wcloud112","Wcloud113","Wcloud114","Wcloud115","Wcloud116","Wcloud117"]);

  const byWet = countBy(all, s => s.wet || "—");
  renderBars("#wetBars", byWet, ["Sehr feucht","Feucht","Weniger feucht","Trocken"]);

  const byName = countBy(all.filter(s=> (s.name||"").trim() !== ""), s => s.name.trim());
  renderBars("#nameBars", byName);

  const thisYear = (new Date()).getFullYear();
  const listThisYear = all.filter(s => (new Date(s.createdAt)).getFullYear() === thisYear && (s.name||"").trim() !== "");
  const byNameYear = countBy(listThisYear, s => s.name.trim());
  if (byNameYear.size) {
    const parts = Array.from(byNameYear.entries()).sort((a,b)=> b[1]-a[1]).map(([n,c]) => `${c}× ${n}`);
    sum.appendChild(pill(`Dieses Jahr: ${parts.join(", ")}`));
  }
}

// ---------- Export CSV ----------
function toCsv(rows) {
  return rows.map(r => r.map(v => {
    const s = (v==null? "": String(v)).replace(/"/g,'""');
    if (/[",\n]/.test(s)) return `"${s}"`;
    return s;
  }).join(",")).join("\n");
}
async function setupExport() {
  $("#exportCsv").addEventListener("click", async () => {
    const db = await openDB();
    const all = await getAllSessions(db);
    const rows = [["ISO Datum","Zeit","Wochentag","Inhalt","Geschlecht","Porno","Feuchtigkeit","Name"]];
    all.sort((a,b)=> a.createdAt - b.createdAt).forEach(s => {
      const d = new Date(s.createdAt);
      rows.push([
        s.isoDate,
        d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
        weekdayName(weekdayIndex(s.createdAt)),
        s.content || "",
        s.gender || "",
        s.porn || "",
        s.wet || "",
        s.name || ""
      ]);
    });
    const blob = new Blob([toCsv(rows)], {type:"text/csv;charset=utf-8"});
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
  $("#clearFilters").addEventListener("click", () => {
    $("#searchDate").value = "";
    $("#filterContent").value = "";
    $("#filterGender").value = "";
    $("#filterPorn").value = "";
    renderHistory();
  });
  ["searchDate","filterContent","filterGender","filterPorn"].forEach(id => {
    $("#" + id).addEventListener("change", renderHistory);
  });
}

// ---------- Einstellungen ----------
async function setupSettings() {
  document.getElementById("clearAll").addEventListener("click", async () => {
    if (confirm("Willst du wirklich ALLE Daten löschen?")) {
      indexedDB.deleteDatabase("PrivateTrackerDB");
      alert("Alle Daten wurden gelöscht. Bitte lade die Seite neu.");
    }
  });
}

// ---------- Boot ----------
(async function boot(){
  setupLogin();
  setupTabs();
  const db = await openDB();
  await setupForm(db);
  setupHistoryFilters();
  await setupExport();
  await setupSettings();
  await renderHistory();
})();
