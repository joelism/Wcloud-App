// Wcloud – App mit Startscreen, wcloud-wheel & Google-Drive-Anbindung
// Service Worker werden deaktiviert, es wird nur app.js verwendet.

// --- Service Worker deaktivieren (alte Caches loswerden) ---
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(r => r.unregister());
  }).catch(() => {});
}

// --- Google Drive Konfiguration ---
const GOOGLE_API_KEY   = "AIzaSyDPaWLmPk-CWIecaQ1TPkhW1SruU4y5DrA";
const GOOGLE_CLIENT_ID = "524696082748-vqdq7udo242e4l287fvd6vh6fmlsoone.apps.googleusercontent.com";
const GOOGLE_SCOPES    = "https://www.googleapis.com/auth/drive.readonly";

// wird vom Google-Script in index.html aufgerufen
function gapiLoaded() {
  if (window.gapi) {
    window.gapi.load("client:auth2", initGoogleClient);
  }
}

async function initGoogleClient() {
  const status = document.getElementById("driveStatus");
  try {
    await gapi.client.init({
      apiKey: GOOGLE_API_KEY,
      clientId: GOOGLE_CLIENT_ID,
      discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
      scope: GOOGLE_SCOPES
    });

    const auth = gapi.auth2.getAuthInstance();
    auth.isSignedIn.listen(updateDriveSigninStatus);
    updateDriveSigninStatus(auth.isSignedIn.get());
  } catch (err) {
    console.error("Fehler bei initGoogleClient:", err);
    if (status) status.textContent = "Google Drive konnte nicht initialisiert werden.";
  }
}

function updateDriveSigninStatus(isSignedIn) {
  const status    = document.getElementById("driveStatus");
  const signInBtn = document.getElementById("driveSignInBtn");
  const loadBtn   = document.getElementById("driveLoadImagesBtn");

  if (status) {
    status.textContent = isSignedIn
      ? "Mit Google Drive verbunden."
      : "Noch nicht mit Google Drive angemeldet.";
  }
  if (signInBtn) signInBtn.textContent = isSignedIn ? "Abmelden" : "Mit Google anmelden";
  if (loadBtn)   loadBtn.disabled      = !isSignedIn;
}

function handleDriveSignInClick() {
  const auth = gapi.auth2 ? gapi.auth2.getAuthInstance() : null;
  if (!auth) return;

  if (auth.isSignedIn.get()) auth.signOut();
  else auth.signIn();
}

async function loadDriveImagesForWcloud() {
  const status = document.getElementById("driveStatus");
  if (status) status.textContent = "Lade Bilder aus Google Drive...";

  try {
    const response = await gapi.client.drive.files.list({
      pageSize: 200,
      fields: "files(id, name, mimeType, thumbnailLink)",
      q: "mimeType contains 'image/' and trashed = false"
    });

    const files = response.result.files || [];
    if (!files.length) {
      if (status) status.textContent = "Keine Bilder gefunden.";
      window.setWcloudImageUrls([]);
      return;
    }

    const urls = files
      .filter(f => !!f.thumbnailLink)
      .map(f => f.thumbnailLink);

    window.setWcloudImageUrls(urls);
    if (status) status.textContent = `Es wurden ${urls.length} Bilder geladen.`;
    renderWcloudWheelReset();
    renderDrivePreview(); // direkt kleine Vorschau aktualisieren
  } catch (err) {
    console.error("Fehler beim Laden der Drive-Bilder:", err);
    if (status) status.textContent = "Fehler beim Laden der Bilder aus Drive.";
  }
}

// ---------- IndexedDB ----------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("PrivateTrackerDB", 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sessions")) {
        const store = db.createObjectStore("sessions", {
          keyPath: "id",
          autoIncrement: true
        });
        store.createIndex("isoDate", "isoDate",   { unique: false });
        store.createIndex("content", "content",   { unique: false });
        store.createIndex("gender",  "gender",    { unique: false });
        store.createIndex("porn",    "porn",      { unique: false });
        store.createIndex("createdAt","createdAt",{ unique: false });
        store.createIndex("name",    "name",      { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function tx(db, mode="readonly") {
  return db.transaction("sessions", mode).objectStore("sessions");
}
function addSession(db, obj) {
  return new Promise((res, rej) => {
    const r = tx(db,"readwrite").add(obj);
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
}
function getAllSessions(db) {
  return new Promise((res, rej) => {
    const r = tx(db,"readonly").getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror   = () => rej(r.error);
  });
}
function deleteSession(db, id) {
  return new Promise((res, rej) => {
    const r = tx(db,"readwrite").delete(id);
    r.onsuccess = () => res();
    r.onerror   = () => rej(r.error);
  });
}

// ---------- Helpers ----------
const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function nowLocalInputValue() {
  const d = new Date();
  const pad = n => String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toIsoDate(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function weekdayIndex(ts){ return new Date(ts).getDay(); }
function weekdayName(i){ return ["So","Mo","Di","Mi","Do","Fr","Sa"][i]; }

// ---------- Login ----------
const PIN = "544221";

function doLogin(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  try {
    const pinEl   = $("#pinInput");
    const overlay = $("#login");
    const app     = $("#app");
    const err     = $("#loginError");
    const info    = $("#loginInfo");

    const val = (pinEl && pinEl.value) ? pinEl.value.replace(/\D/g,"") : "";
    if (val === PIN) {
      overlay.style.display = "none";
      if (app) app.hidden = false;    // Startscreen wird sichtbar
      if (info) {
        info.hidden = false;
        setTimeout(() => { info.hidden = true; }, 2000);
      }
      return false;
    } else {
      if (err) {
        err.hidden = false;
        setTimeout(() => { err.hidden = true; }, 1800);
      }
      return false;
    }
  } catch {
    return false;
  }
}

// ---------- Tabs & Startscreen ----------
function activateTab(tabId) {
  const tabs   = $$(".tab");
  const panels = $$(".tabPanel");

  tabs.forEach(btn => {
    if (btn.dataset.tab === tabId) btn.classList.add("active");
    else btn.classList.remove("active");
  });

  panels.forEach(panel => {
    if (panel.id === "startScreen") return; // Startscreen separat
    if (panel.id === tabId) panel.classList.remove("hidden");
    else                    panel.classList.add("hidden");
  });

  if (tabId === "history")  renderHistory();
  if (tabId === "analysis") renderAnalysis();
}

function setupTabs() {
  const startScreen = $("#startScreen");

  $$(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (startScreen) startScreen.classList.add("hidden");
      activateTab(tab);
    });
  });
}

function setupStartScreen() {
  const startScreen = $("#startScreen");
  if (!startScreen) return;

  const btnEntries = $("#startEntriesAnalyse");
  const btnWheel   = $("#startWcloudWheel");

  // Beim Start: Startscreen sichtbar, alle anderen Panels sind im HTML hidden
  startScreen.classList.remove("hidden");

  if (btnEntries) {
    btnEntries.addEventListener("click", () => {
      startScreen.classList.add("hidden");
      activateTab("capture"); // „Neuer Eintrag“
    });
  }

  if (btnWheel) {
    btnWheel.addEventListener("click", () => {
      startScreen.classList.add("hidden");
      activateTab("wheel");
    });
  }
}

// ---------- Formular ----------
async function setupForm(db) {
  const dt = $("#dt");
  if (dt) dt.value = nowLocalInputValue();

  const form = $("#sessionForm");
  if (!form) return;

  form.addEventListener("submit", async e => {
    e.preventDefault();

    const dtEl = $("#dt");
    const dtVal = dtEl.value;

    const fd      = new FormData(form);
    const wet     = fd.get("wet");
    const gender  = fd.get("gender");
    const porn    = fd.get("porn");
    const content = $("#content")?.value || "";
    const name    = $("#personName")?.value.trim() || "";

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
      name
    };

    await addSession(db, obj);
    form.reset();
    dtEl.value = nowLocalInputValue();
    renderHistory();
    alert("Gespeichert.");
  });
}

// ---------- Verlauf ----------
let _allSessionsCache = [];

async function loadAll(db){ _allSessionsCache = await getAllSessions(db); return _allSessionsCache; }

function passesFilters(s){
  const d=$("#searchDate").value;
  const c=$("#filterContent").value;
  const g=$("#filterGender").value;
  const p=$("#filterPorn").value;
  if(d && s.isoDate!==d) return false;
  if(c && s.content!==c) return false;
  if(g && s.gender!==g) return false;
  if(p && s.porn  !==p) return false;
  return true;
}

function renderHistoryList(list){
  const cont=$("#historyList");
  cont.innerHTML="";
  if(!list.length){
    cont.innerHTML="<p class='muted'>Noch keine Einträge.</p>";
    return;
  }
  list.sort((a,b)=>b.createdAt-a.createdAt);
  list.forEach(s=>{
    const d=new Date(s.createdAt);
    const div=document.createElement("div");
    div.className="entry";

    const main=document.createElement("div");
    main.innerHTML =
      `<div><strong>${s.isoDate}</strong> ${d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</div>
       <div class="meta">${s.content} · ${s.gender} · ${s.porn} · ${s.wet}${s.name? " · "+s.name:""}</div>`;

    const actions=document.createElement("div");
    const del=document.createElement("button");
    del.textContent="Löschen";
    del.className="small danger";
    del.addEventListener("click", async ()=>{
      const db=await openDB();
      await deleteSession(db, s.id);
      renderHistory();
    });
    actions.appendChild(del);

    div.appendChild(main);
    div.appendChild(actions);
    cont.appendChild(div);
  });
}

async function renderHistory(){
  const db=await openDB();
  const all=await loadAll(db);
  renderHistoryList(all.filter(passesFilters));
}

// ---------- Analyse ----------
function countBy(list,keyFn){
  const m=new Map();
  list.forEach(it=>{
    const k=keyFn(it);
    m.set(k,(m.get(k)||0)+1);
  });
  return m;
}
function maxVal(map){
  let m=0;
  map.forEach(v=>{ if(v>m)m=v; });
  return m;
}
function makeBarRow(label,value,max){
  const row=document.createElement("div");
  row.className="barRow";
  const lab=document.createElement("div");
  lab.className="barLabel";
  lab.textContent=label;
  const track=document.createElement("div");
  track.className="barTrack";
  const fill=document.createElement("div");
  fill.className="barFill";
  const pct=max?(value/max)*100:0;
  fill.style.width=Math.max(1,pct)+"%";
  track.appendChild(fill);
  const val=document.createElement("div");
  val.className="barVal";
  val.textContent=String(value);
  row.appendChild(lab);
  row.appendChild(track);
  row.appendChild(val);
  return row;
}
function renderBars(sel,map,order=null,labelFn=k=>k){
  const cont=$(sel);
  cont.innerHTML="";
  let entries=Array.from(map.entries());
  if(order){
    const ord=new Map(order.map((k,i)=>[k,i]));
    entries.sort((a,b)=>(ord.get(a[0])??999)-(ord.get(b[0])??999));
  }else{
    entries.sort((a,b)=>b[1]-a[1]);
  }
  const mx=maxVal(map);
  entries.forEach(([k,v])=>cont.appendChild(makeBarRow(labelFn(k),v,mx)));
  if(!entries.length) cont.innerHTML="<p class='muted'>Noch keine Daten.</p>";
}

function renderPerDayTable(list){
  const cont=$("#perDay");
  cont.innerHTML="";
  if(!list.length){
    cont.innerHTML="<p class='muted'>Noch keine Daten.</p>";
    return;
  }
  const byDay=countBy(list,s=>s.isoDate);
  const arr=Array.from(byDay.entries()).sort((a,b)=>a[0].localeCompare(b[0]));
  arr.forEach(([day,n])=>{
    const row=document.createElement("div");
    row.className="tableRow";
    const l=document.createElement("div");
    l.textContent=day;
    const r=document.createElement("div");
    r.textContent=n;
    row.appendChild(l);
    row.appendChild(r);
    cont.appendChild(row);
  });
}

async function renderAnalysis(){
  const db=await openDB();
  const all=await getAllSessions(db);
  const sum=$("#statsSummary");
  sum.innerHTML="";
  const total=all.length;
  const last=all.slice().sort((a,b)=>b.createdAt-a.createdAt)[0];

  const pill=t=>{
    const s=document.createElement("span");
    s.className="pill";
    s.textContent=t;
    return s;
  };

  sum.appendChild(pill(`Gesamt: ${total}`));
  if(last){
    const d=new Date(last.createdAt);
    sum.appendChild(pill(`Letzter Eintrag: ${last.isoDate} ${d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`));
  }

  renderPerDayTable(all);
  renderBars("#weekdayBars",countBy(all,s=>weekdayIndex(s.createdAt)),[1,2,3,4,5,6,0],k=>weekdayName(k));
  renderBars("#genderBars", countBy(all,s=>s.gender||"—"));
  renderBars("#pornBars",   countBy(all,s=>s.porn  ||"—"),["Mit","Ohne"]);
  renderBars("#contentBars",countBy(all,s=>s.content||"—"),["Wcloud112","Wcloud113","Wcloud114","Wcloud115","Wcloud116","Wcloud117"]);
  renderBars("#nameBars",   countBy(all.filter(s=>(s.name||"").trim()!==""),s=>s.name.trim()));
  renderBars("#wetBars",    countBy(all,s=>s.wet||"—"),["Sehr feucht","Feucht","Weniger feucht","Trocken"]);

  const thisYear=(new Date()).getFullYear();
  const listThisYear=all.filter(s=>
    (new Date(s.createdAt)).getFullYear()===thisYear &&
    (s.name||"").trim()!==""
  );
  const byNameYear=countBy(listThisYear,s=>s.name.trim());
  if(byNameYear.size){
    const parts=Array.from(byNameYear.entries())
      .sort((a,b)=>b[1]-a[1])
      .map(([n,c])=>`${c}× ${n}`);
    sum.appendChild(pill(`Dieses Jahr: ${parts.join(", ")}`));
  }
}

// ---------- CSV Export ----------
function toCsv(rows){
  return rows.map(r=>r.map(v=>{
    const s=(v==null?"":String(v)).replace(/"/g,'""');
    return /[",\n]/.test(s)?`"${s}"`:s;
  }).join(",")).join("\n");
}
async function setupExport(){
  const btn=$("#exportCsv");
  if(!btn) return;
  btn.addEventListener("click", async ()=>{
    const db=await openDB();
    const all=await getAllSessions(db);
    const rows=[["ISO Datum","Zeit","Wochentag","Inhalt","Geschlecht","Porno","Feuchtigkeit","Name"]];
    all.sort((a,b)=>a.createdAt-b.createdAt).forEach(s=>{
      const d=new Date(s.createdAt);
      rows.push([
        s.isoDate,
        d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}),
        weekdayName(weekdayIndex(s.createdAt)),
        s.content||"",
        s.gender||"",
        s.porn  ||"",
        s.wet   ||"",
        s.name  ||""
      ]);
    });
    const blob=new Blob([toCsv(rows)],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;
    a.download="protokoll.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

// ---------- Filter ----------
function setupHistoryFilters(){
  const clearBtn=$("#clearFilters");
  if(clearBtn){
    clearBtn.addEventListener("click", ()=>{
      $("#searchDate").value="";
      $("#filterContent").value="";
      $("#filterGender").value="";
      $("#filterPorn").value="";
      renderHistory();
    });
  }
  ["searchDate","filterContent","filterGender","filterPorn"].forEach(id=>{
    const el=$("#"+id);
    if(el) el.addEventListener("change", renderHistory);
  });
}

// ---------- wcloud-wheel ----------
let wcloudImageUrls = [];
let wheelRemaining = [];
let wheelBatchSize = 5;

window.setWcloudImageUrls = function(urls){
  if(Array.isArray(urls)) {
    wcloudImageUrls = urls.slice();
    wheelRemaining  = urls.slice();
  } else {
    wcloudImageUrls = [];
    wheelRemaining  = [];
  }
};

function updateWheelInfo(message){
  const grid=$("#wheelGrid");
  if(!grid) return;
  const info=document.createElement("p");
  info.className="muted";
  info.textContent=message;
  grid.appendChild(info);
}

function renderWcloudWheelReset(){
  const grid=$("#wheelGrid");
  if(!grid) return;
  wheelRemaining = wcloudImageUrls.slice();
  grid.innerHTML = "<p class='muted'>Noch keine Bilder angezeigt. Klicke auf „Mehr Bilder laden“.</p>";
}

function pickRandomFromRemaining(count){
  const out=[];
  while(wheelRemaining.length && out.length<count){
    const idx=Math.floor(Math.random()*wheelRemaining.length);
    out.push(wheelRemaining.splice(idx,1)[0]);
  }
  return out;
}

function appendWheelImages(urls){
  const grid=$("#wheelGrid");
  if(!grid || !urls.length) return;
  let wrapper=grid.querySelector(".wheelGridInner");
  if(!wrapper){
    grid.innerHTML="";
    wrapper=document.createElement("div");
    wrapper.className="wheelGridInner";
    grid.appendChild(wrapper);
  }
  urls.forEach(url=>{
    const item=document.createElement("div");
    item.className="wheelItem";
    const img=document.createElement("img");
    img.src=url;
    img.alt="wcloud-wheel Bild";
    img.loading="lazy";
    img.className="wheelImage";
    item.appendChild(img);
    wrapper.appendChild(item);
  });
}

function handleWheelMoreClick(){
  const grid=$("#wheelGrid");
  if(!wcloudImageUrls.length){
    if(grid) grid.innerHTML="<p class='muted'>Noch keine Bilder im Pool. Melde dich in den Einstellungen bei Google Drive an und lade Bilder.</p>";
    return;
  }
  if(!wheelRemaining.length){
    updateWheelInfo("Alle Bilder wurden bereits angezeigt. Mit „Zurücksetzen“ kannst du neu mischen.");
    return;
  }
  const batch=pickRandomFromRemaining(wheelBatchSize);
  appendWheelImages(batch);
}

function handleWheelBatchChange(ev){
  const val=parseInt(ev.target.value,10);
  if(!isNaN(val)) wheelBatchSize=val;
}

function setupWcloudWheel(){
  const moreBtn=$("#wheelMoreBtn");
  const resetBtn=$("#wheelResetBtn");
  const sizeSel=$("#wheelBatchSize");

  if(moreBtn)  moreBtn.addEventListener("click", handleWheelMoreClick);
  if(resetBtn) resetBtn.addEventListener("click", renderWcloudWheelReset);
  if(sizeSel)  sizeSel.addEventListener("change", handleWheelBatchChange);
}

// ---------- Drive-Preview im Einstellungs-Tab ----------
function renderDrivePreview(){
  const prev=$("#drivePreview");
  if(!prev) return;
  prev.innerHTML="";
  if(!wcloudImageUrls.length){
    prev.innerHTML="<p class='muted'>Noch keine Bilder geladen.</p>";
    return;
  }
  const wrapper=document.createElement("div");
  wrapper.className="wheelGridInner";
  prev.appendChild(wrapper);

  const sample=wcloudImageUrls.slice(0,40); // max. 40 Vorschaubilder
  sample.forEach(url=>{
    const item=document.createElement("div");
    item.className="wheelItem";
    const img=document.createElement("img");
    img.src=url;
    img.alt="Drive Vorschau";
    img.loading="lazy";
    img.className="wheelImage";
    item.appendChild(img);
    wrapper.appendChild(item);
  });
}

// ---------- Einstellungen ----------

const IMAGE_URLS_KEY = "wcloudImageUrls";

function loadStoredImageUrls(){
  try{
    const raw = localStorage.getItem(IMAGE_URLS_KEY);
    if(!raw) return [];
    const parsed = JSON.parse(raw);
    if(!Array.isArray(parsed)) return [];
    return parsed.filter(u => typeof u === "string" && u.trim());
  }catch(e){
    console.error("Fehler beim Laden der Bild-URLs:", e);
    return [];
  }
}

function saveStoredImageUrls(urls){
  const clean = Array.from(new Set(
    (urls || []).filter(u => typeof u === "string" && u.trim())
  ));
  try{
    localStorage.setItem(IMAGE_URLS_KEY, JSON.stringify(clean));
  }catch(e){
    console.error("Fehler beim Speichern der Bild-URLs:", e);
  }
  setWcloudImageUrls(clean);
  renderImagePool(clean);
}

function renderImagePool(urls){
  const grid = $("#imagePoolGrid");
  const info = $("#imagePoolInfo");
  if(!grid) return;
  urls = urls || loadStoredImageUrls();

  grid.innerHTML = "";
  if(!urls.length){
    if(info) info.textContent = "Aktuell sind keine Bild-URLs gespeichert.";
    return;
  }
  if(info) info.textContent = `Gespeicherte Bild-URLs: ${urls.length}`;

  const wrapper = document.createElement("div");
  wrapper.className = "wheelGridInner";
  grid.appendChild(wrapper);

  urls.forEach(url => {
    const item = document.createElement("div");
    item.className = "wheelItem";
    const img = document.createElement("img");
    img.src = url;
    img.alt = "wcloud Bild";
    img.loading = "lazy";
    img.className = "wheelImage";
    item.appendChild(img);
    wrapper.appendChild(item);
  });
}

function syncImagePoolFromStorage(){
  const urls = loadStoredImageUrls();
  setWcloudImageUrls(urls);
  renderImagePool(urls);
}

async function exportBackup(){
  const db = await openDB();
  const sessions = await getAllSessions(db);
  const imageUrls = loadStoredImageUrls();

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    sessions,
    imageUrls
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `wcloud-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}

async function importBackup(file){
  const text = await file.text();
  let data;
  try{
    data = JSON.parse(text);
  }catch(e){
    throw new Error("Backup-Datei ist kein gültiges JSON.");
  }
  if(!data || (typeof data !== "object")){
    throw new Error("Backup-Datei hat ein ungültiges Format.");
  }

  const db = await openDB();

  if(Array.isArray(data.sessions)){
    for(const s of data.sessions){
      const { id, ...rest } = s || {};
      // nur hinzufügen, wenn mindestens Datum & Inhalt vorhanden sind
      if(rest && rest.isoDate && rest.content){
        await addSession(db, rest);
      }
    }
  }

  if(Array.isArray(data.imageUrls)){
    saveStoredImageUrls(data.imageUrls);
    renderWcloudWheelReset();
  }
}

async function setupSettings(){
  const clearAllBtn = $("#clearAllEntries");
  if(clearAllBtn){
    clearAllBtn.addEventListener("click", async ()=>{
      if(confirm("Willst du wirklich ALLE Eintragsdaten löschen?")){
        indexedDB.deleteDatabase("PrivateTrackerDB");
        alert("Alle Daten wurden gelöscht. Bitte lade die Seite neu.");
      }
    });
  }

  // Bild-URL-Verwaltung
  const urlInput   = $("#imageUrlInput");
  const addUrlBtn  = $("#addImageUrlBtn");
  const clearUrlsBtn = $("#clearImageUrlsBtn");

  if(addUrlBtn && urlInput){
    addUrlBtn.addEventListener("click", ()=>{
      const value = (urlInput.value || "").trim();
      if(!value) return;
      const urls = loadStoredImageUrls();
      urls.push(value);
      saveStoredImageUrls(urls);
      renderWcloudWheelReset();
      urlInput.value = "";
    });
  }

  if(clearUrlsBtn){
    clearUrlsBtn.addEventListener("click", ()=>{
      if(!confirm("Alle gespeicherten Bild-URLs wirklich löschen?")) return;
      saveStoredImageUrls([]);
      renderWcloudWheelReset();
    });
  }

  // Backup Import/Export
  const exportBtn = $("#exportBackupBtn");
  const importInput = $("#importBackupInput");
  const backupInfo = $("#backupInfo");

  if(exportBtn){
    exportBtn.addEventListener("click", async ()=>{
      try{
        await exportBackup();
        if(backupInfo) backupInfo.textContent = "Backup wurde exportiert.";
      }catch(e){
        console.error(e);
        if(backupInfo) backupInfo.textContent = "Fehler beim Export.";
      }
    });
  }

  if(importInput){
    importInput.addEventListener("change", async (ev)=>{
      const file = ev.target.files && ev.target.files[0];
      if(!file) return;
      try{
        await importBackup(file);
        if(backupInfo) backupInfo.textContent = "Backup wurde importiert.";
      }catch(e){
        console.error(e);
        if(backupInfo) backupInfo.textContent = "Fehler beim Import.";
      }finally{
        ev.target.value = "";
      }
    });
  }

  // initiales Rendering des Bild-Pools
  syncImagePoolFromStorage();
}


// ---------- Boot ----------
(async function boot(){
  setupTabs();
  setupStartScreen();
  setupWcloudWheel();
  syncImagePoolFromStorage();

  const db=await openDB();
  await setupForm(db);
  setupHistoryFilters();
  await setupExport();
  await setupSettings();
  await renderHistory();
})();
