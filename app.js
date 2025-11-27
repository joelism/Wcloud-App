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
    // Optional: direkt was anzeigen
    renderWcloudWheelRandom();
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

    const val = (pinEl && pinEl.value) ? pinEl.value.replace(/\D/g,"") : "";
    if (val === PIN) {
      overlay.style.display = "none";
      if (app) app.hidden = false;    // Startscreen wird sichtbar
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
    if (panel.id === "startScreen") return; // Startscreen per hidden, nicht über Klassen
    if (panel.id === tabId) panel.classList.remove("hidden");
    else                    panel.classList.add("hidden");
  });

  if (tabId === "history")  renderHistory();
  if (tabId === "analysis") renderAnalysis();
}

function setupTabs() {
  $$(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      const startScreen = $("#startScreen");
      const mainShell   = $("#mainShell");
      if (startScreen) startScreen.hidden = true;
      if (mainShell)   mainShell.hidden   = false;
      activateTab(tab);
    });
  });
}

function setupStartScreen() {
  const startScreen = $("#startScreen");
  const mainShell   = $("#mainShell");
  if (!startScreen || !mainShell) return;

  const btnEntries = $("#startEntriesAnalyse");
  const btnWheel   = $("#startWcloudWheel");

  // Initial: nur Startscreen sichtbar
  startScreen.hidden = false;
  mainShell.hidden   = true;

  if (btnEntries) {
    btnEntries.addEventListener("click", () => {
      startScreen.hidden = true;
      mainShell.hidden   = false;
      activateTab("capture");
    });
  }
  if (btnWheel) {
    btnWheel.addEventListener("click", () => {
      startScreen.hidden = true;
      mainShell.hidden   = false;
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

window.setWcloudImageUrls = function(urls){
  if(Array.isArray(urls)) wcloudImageUrls = urls.slice();
  else wcloudImageUrls = [];
};

function pickRandomWcloudImages(n){
  const src=wcloudImageUrls.slice();
  const out=[];
  if(!src.length) return out;
  while(src.length && out.length<n){
    const idx=Math.floor(Math.random()*src.length);
    out.push(src.splice(idx,1)[0]);
  }
  return out;
}

function renderWcloudWheelRandom(){
  const grid=$("#wheelGrid");
  if(!grid) return;
  grid.innerHTML="";

  if(!wcloudImageUrls.length){
    grid.innerHTML="<p class='muted'>Noch keine Bilder im Pool. Melde dich in den Einstellungen bei Google Drive an und lade Bilder.</p>";
    return;
  }

  const images=pickRandomWcloudImages(60);
  const info=document.createElement("p");
  info.className="muted";
  info.textContent=`Zufällig ausgewählte Bilder: ${images.length}`;
  grid.appendChild(info);

  const wrapper=document.createElement("div");
  wrapper.className="wheelGridInner";
  grid.appendChild(wrapper);

  images.forEach(url=>{
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

function setupWcloudWheel(){
  const btn=$("#wheelRandomBtn");
  if(!btn) return;
  btn.addEventListener("click", renderWcloudWheelRandom);
}

// ---------- Einstellungen ----------
async function setupSettings(){
  const clearAllBtn=$("#clearAll");
  if(clearAllBtn){
    clearAllBtn.addEventListener("click", async ()=>{
      if(confirm("Willst du wirklich ALLE Daten löschen?")){
        indexedDB.deleteDatabase("PrivateTrackerDB");
        alert("Alle Daten wurden gelöscht. Bitte lade die Seite neu.");
      }
    });
  }

  const signInBtn=$("#driveSignInBtn");
  if(signInBtn){
    signInBtn.addEventListener("click", handleDriveSignInClick);
  }
  const loadBtn=$("#driveLoadImagesBtn");
  if(loadBtn){
    loadBtn.addEventListener("click", loadDriveImagesForWcloud);
  }
}

// ---------- Boot ----------
(async function boot(){
  setupTabs();
  setupStartScreen();
  setupWcloudWheel();

  const db=await openDB();
  await setupForm(db);
  setupHistoryFilters();
  await setupExport();
  await setupSettings();
  await renderHistory();
})();
