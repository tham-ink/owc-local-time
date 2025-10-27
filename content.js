// ==============================
// OWC 2025 Local Time Injector
// ==============================

// -------- Utilities --------
function normalize(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}
function toUTCDate(ymd, hh = "00", mm = "00") {
  return new Date(`${ymd}T${hh}:${mm}:00Z`);
}

// -------- Storage (timezone + panel visibility) --------
const DEFAULT_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      { owcLocalTZ: DEFAULT_TZ, owcShowMenu: true },
      (v) => resolve({ tz: v.owcLocalTZ || DEFAULT_TZ, show: v.owcShowMenu !== false })
    );
  });
}
async function setTZ(tz) {
  return new Promise((resolve) => chrome.storage.sync.set({ owcLocalTZ: tz }, () => resolve()));
}
async function setShowMenu(show) {
  return new Promise((resolve) => chrome.storage.sync.set({ owcShowMenu: !!show }, () => resolve()));
}

// -------- Parsing: Tournament schedule (ISO-like) --------
function parseTimestampCell(text) {
  const t = normalize(text);

  // "YYYY-MM-DD (HH:MM UTC) / YYYY-MM-DD (HH:MM UTC)"
  let m = t.match(
    /(\d{4}-\d{2}-\d{2}).*?\((\d{2}):(\d{2})\s*UTC\)\s*\/\s*(\d{4}-\d{2}-\d{2}).*?\((\d{2}):(\d{2})\s*UTC\)/i
  );
  if (m) {
    const [, sYMD, sH, sM, eYMD, eH, eM] = m;
    return { type: "range", start: toUTCDate(sYMD, sH, sM), end: toUTCDate(eYMD, eH, eM) };
  }

  // "YYYY-MM-DD (HH:MM UTC)"
  m = t.match(/(\d{4}-\d{2}-\d{2}).*?\((\d{2}):(\d{2})\s*UTC\)/i);
  if (m) {
    const [, ymd, hh, mm] = m;
    return { type: "instant", start: toUTCDate(ymd, hh, mm) };
  }

  // "YYYY-MM-DD / YYYY-MM-DD"
  m = t.match(/(\d{4}-\d{2}-\d{2})\s*\/\s*(\d{4}-\d{2}-\d{2})/);
  if (m) {
    const [, sYMD, eYMD] = m;
    return { type: "range", start: toUTCDate(sYMD), end: toUTCDate(eYMD) };
  }

  return null;
}

// -------- Parsing: Match schedule ("Nov 01 (Sat) 08:00 UTC") --------
function inferYearFromSection(node) {
  let cur = node;
  while (cur && cur !== document.body) {
    let p = cur.previousElementSibling;
    while (p) {
      const t = (p.textContent || "").trim();
      const m = t.match(/(20\d{2})/);
      if (m) return +m[1];
      p = p.previousElementSibling;
    }
    cur = cur.parentElement;
  }
  return new Date().getUTCFullYear();
}

function parseMatchTimeCell(text, refNode) {
  const t = normalize(text);
  const m = t.match(/^([A-Za-z]{3})\s+(\d{2})\s*\(.*?\)\s+(\d{2}):(\d{2})\s*UTC$/i);
  if (!m) return null;
  const [, monStr, dd, hh, mm] = m;

  const months = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
  };
  const mo = months[monStr.toLowerCase()];
  if (!mo) return null;

  const year = inferYearFromSection(refNode);
  const ymd = `${year}-${mo}-${dd}`;
  return { type: "instant", start: new Date(`${ymd}T${hh}:${mm}:00Z`) };
}

function parseAnyTimestamp(text, refNode) {
  return parseTimestampCell(text) || parseMatchTimeCell(text, refNode);
}

// -------- Formatting --------
function makeFormatter(timeZone) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short"
  });
}
function formatRange(s, e, tz) {
  const dateFmt = new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    year: "numeric",
    month: "short",
    day: "2-digit"
  });
  const timeFmt = new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
  const sDay = dateFmt.format(s);
  const eDay = dateFmt.format(e);
  if (sDay === eDay) return `${sDay}, ${timeFmt.format(s)} – ${timeFmt.format(e)}`;
  return `${sDay} – ${eDay}`;
}

// -------- UI: toggle + panel --------
function ensureUI(currentTZ, onChange, initialShow) {
  if (document.getElementById("owc-local-time-toggle")) return;

  // Toggle button
  const toggle = document.createElement("button");
  toggle.id = "owc-local-time-toggle";
  toggle.textContent = "TZ";
  Object.assign(toggle.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    width: "40px",
    height: "40px",
    borderRadius: "20px",
    border: "1px solid #888",
    background: "#fff",
    color: "#000",
    fontWeight: "700",
    cursor: "pointer",
    zIndex: "100000"
  });
  document.body.appendChild(toggle);

  // Panel
  const wrap = document.createElement("div");
  wrap.id = "owc-local-time-menu";
  Object.assign(wrap.style, {
    position: "fixed",
    right: "64px",
    bottom: "16px",
    padding: "10px 12px",
    borderRadius: "8px",
    background: "rgba(0,0,0,0.75)",
    color: "#fff",
    fontSize: "12px",
    backdropFilter: "blur(4px)",
    boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
    zIndex: "99999",
    display: initialShow ? "block" : "none"
  });

  const label = document.createElement("div");
  label.textContent = "Local time zone:";
  label.style.marginBottom = "6px";
  label.style.fontWeight = "600";
  wrap.appendChild(label);

  const select = document.createElement("select");
  select.style.minWidth = "260px";
  select.style.padding = "6px";
  select.style.borderRadius = "6px";
  select.style.background = "#fff";
  select.style.color = "#000";
  select.style.border = "1px solid #888";

  const candidates = [
    DEFAULT_TZ,
    "UTC", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York",
    "Europe/London", "Europe/Berlin", "Europe/Paris", "Europe/Moscow",
    "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo",
    "Australia/Sydney"
  ];
  const unique = [...new Set(candidates)];
  for (const tz of unique) {
    const opt = document.createElement("option");
    opt.value = tz;
    opt.textContent = tz === DEFAULT_TZ ? `${tz} (device)` : tz;
    if (tz === currentTZ) opt.selected = true;
    select.appendChild(opt);
  }

  select.addEventListener("change", async () => {
    const tz = select.value;
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: tz });
      await setTZ(tz);
      onChange(tz);
    } catch {
      alert("Invalid time zone");
      select.value = currentTZ;
    }
  });

  wrap.appendChild(select);

  const hint = document.createElement("div");
  hint.textContent = "Saved to browser sync storage.";
  hint.style.marginTop = "6px";
  hint.style.opacity = "0.8";
  wrap.appendChild(hint);

  document.body.appendChild(wrap);

  // Toggle behavior
  toggle.addEventListener("click", async () => {
    const visible = wrap.style.display !== "none";
    wrap.style.display = visible ? "none" : "block";
    await setShowMenu(!visible);
  });
}

// -------- Table logic --------
function tableAlreadyPatched(table) {
  return !!table.querySelector("th.__owc_local_time__");
}
function addLocalTimeHeader(table, afterIdx) {
  const thead = table.querySelector("thead") || table.createTHead();
  let headerRow = thead.querySelector("tr");
  if (!headerRow) headerRow = thead.insertRow();
  const th = document.createElement("th");
  th.className = "__owc_local_time__";
  th.textContent = "Local time";
  const ref = headerRow.children[afterIdx];
  if (ref && ref.nextSibling) headerRow.insertBefore(th, ref.nextSibling);
  else headerRow.appendChild(th);
}
function insertLocalCell(row, afterIdx, text) {
  const td = document.createElement("td");
  td.textContent = text || "—";
  const cells = Array.from(row.children);
  const ref = cells[Math.min(afterIdx, cells.length - 1)];
  if (ref && ref.nextSibling) row.insertBefore(td, ref.nextSibling);
  else row.appendChild(td);
}

function identifyTimestampColumn(table) {
  const headerRow = table.querySelector("thead tr") || table.querySelector("tr");
  if (!headerRow) return 1;
  const headers = Array.from(headerRow.children).map((c) => normalize(c.textContent).toLowerCase());
  let idx = headers.findIndex((h) => h.includes("timestamp"));
  if (idx === -1) idx = headers.length - 1;
  return Math.max(0, idx);
}
function isMatchScheduleTable(table) {
  const headerRow = table.querySelector("thead tr") || table.querySelector("tr");
  if (!headerRow) return false;
  const headers = Array.from(headerRow.children).map((c) => normalize(c.textContent).toLowerCase());
  return headers.some((h) => h.includes("match time"));
}
function identifyMatchTimeColumn(table) {
  const headerRow = table.querySelector("thead tr") || table.querySelector("tr");
  const headers = Array.from(headerRow.children).map((c) => normalize(c.textContent).toLowerCase());
  let idx = headers.findIndex((h) => h.includes("match time"));
  if (idx === -1) idx = headers.length - 1;
  return idx;
}

function findAllScheduleTables() {
  const tables = Array.from(document.querySelectorAll("table"));
  const wanted = [];
  for (const table of tables) {
    const headerRow = table.querySelector("thead tr") || table.querySelector("tr");
    const headerText = headerRow ? normalize(headerRow.textContent).toLowerCase() : "";
    const hasTimestamp = headerText.includes("timestamp") || headerText.includes("event");
    const hasMatchTime = headerText.includes("match time");
    if (hasTimestamp || hasMatchTime) {
      wanted.push(table);
      continue;
    }
    // Heuristic for date ranges
    const sampleCells = Array.from(table.querySelectorAll("tbody td, td")).slice(0, 8);
    const hasDates = sampleCells.some((td) =>
      /(\d{4}-\d{2}-\d{2})(\s*\/\s*\d{4}-\d{2}-\d{2})?/.test(td.textContent || "")
    );
    if (hasDates) wanted.push(table);
  }
  return wanted;
}

function processTable(table, tz) {
  if (tableAlreadyPatched(table)) return;

  const isMatch = isMatchScheduleTable(table);
  const idx = isMatch ? identifyMatchTimeColumn(table) : identifyTimestampColumn(table);

  addLocalTimeHeader(table, idx);

  const formatter = makeFormatter(tz);
  const tbody = table.querySelector("tbody") || table;
  const rows = Array.from(tbody.querySelectorAll("tr"));
  for (const tr of rows) {
    if (tr.querySelector("th")) continue;
    const cells = Array.from(tr.children);
    if (!cells.length) continue;

    const tsCell = cells[Math.min(idx, cells.length - 1)];
    const parsed = isMatch
      ? parseMatchTimeCell(tsCell.textContent || "", tsCell)
      : parseAnyTimestamp(tsCell.textContent || "", tsCell);

    let display = "—";
    if (parsed) {
      if (parsed.type === "instant") display = formatter.format(parsed.start);
      else if (parsed.type === "range") display = formatRange(parsed.start, parsed.end, tz);
    }
    insertLocalCell(tr, idx, display);
  }
}

// -------- Orchestration --------
async function renderAll() {
  const { tz, show } = await getSettings();

  for (const table of findAllScheduleTables()) processTable(table, tz);

  ensureUI(tz, () => rerender(), show);
}

async function rerender() {
  for (const th of document.querySelectorAll("th.__owc_local_time__")) {
    const colIndex = Array.from(th.parentElement.children).indexOf(th);
    const table = th.closest("table");
    th.remove();
    const rows = table.querySelectorAll("tr");
    rows.forEach((tr) => {
      const tds = tr.querySelectorAll("td, th");
      if (tds[colIndex]) tds[colIndex].remove();
    });
  }
  await renderAll();
}

function boot() {
  renderAll();
  const obs = new MutationObserver((muts) => {
    if (muts.some((m) => Array.from(m.addedNodes).some((n) => n.nodeType === 1))) {
      renderAll();
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
