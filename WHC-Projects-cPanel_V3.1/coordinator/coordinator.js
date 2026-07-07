// ============================================================
//  Winner Holistic Consultants – Coordinator Module
//  coordinator/coordinator.js
//  Depends on: shared/shared.js loaded first
// ============================================================

const STAGE_NAMES = [
  "Project Scope Analysis and Requirement Collection","Project Registration",
  "ADM and CD-FLS – Drawing Preparation","ADM & CD-FLS Approval",
  "TAQA Drawing Preparation","TAQA Drawing Approval",
  "ADCD Shop Drawing Preparation","ADCD Shop Drawing Approval",
  "Work Start Notice Approval","Commencement of Site Work",
  "TAQA Inspection Approval","Hassantuk & AMC Application Submission Initiation",
  "ADCD Inspection","ADM Completion Inspection","GIS Approval","Project Fully Completed"
];

// ── Stage helpers ─────────────────────────────────────────────
function needsAppNum(type, status) {
  if (type === "registration" && status === "submitted") return true;
  if (type === "approval_meps" && status === "under-review-meps") return true;
  if ((type === "approval_portal" || type === "inspection") && status === "under-review-portal") return true;
  if (type === "gis" && status === "submitted-meps") return true;
  return false;
}
function hasDateFields(type) { return !["scope", "awarded_scope", "site_work", "completed"].includes(type); }
function dateLabelA(type) { return type === "drawing_prep" ? "Drawing/Document Received" : "Submission Date"; }
function dateLabelB(type) { return type === "drawing_prep" ? "Document/Drawing Completed" : "Approved Date"; }

function actDotCls(status) {
  if (["received","approved","completed","completed-signed","approved-bcc"].includes(status)) return "act-dot-approved";
  if (["under-review","under-review-meps","under-review-portal","submitted","submitted-meps","under-preparation","sent-client-review","work-in-progress","inspection-scheduled"].includes(status)) return "act-dot-authority";
  if (["rejected","not-received","not-approved"].includes(status)) return "act-dot-rejected";
  if (["hold","comments-shared","waiting-applicant"].includes(status)) return "act-dot-hold";
  return "act-dot-default";
}

// ── Drag state ────────────────────────────────────────────────
let _dragSrc = null;
function dragStart(e, i) {
  if (["INPUT","SELECT","TEXTAREA","BUTTON"].includes(e.target.tagName)) { e.preventDefault(); return; }
  _dragSrc = i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i));
  setTimeout(() => { const rows = document.querySelectorAll(".se"); if (rows[i]) rows[i].classList.add("dragging"); }, 0);
}
function dragOver(e, i) {
  e.preventDefault(); e.dataTransfer.dropEffect = "move";
  document.querySelectorAll(".se").forEach((el, idx) => { el.classList.toggle("drag-over", idx === i && _dragSrc !== null && _dragSrc !== i); });
}
function dragLeave(e) { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove("drag-over"); }
function dragDrop(e, i) {
  e.preventDefault(); e.stopPropagation(); _clearDrag();
  if (_dragSrc !== null && _dragSrc !== i && PROJ) { const [moved] = PROJ.stages.splice(_dragSrc, 1); PROJ.stages.splice(i, 0, moved); S.selectedStages = []; S.bulkStatus = ""; render(); }
  _dragSrc = null;
}
function dragEnd() { _clearDrag(); _dragSrc = null; }
function _clearDrag() { document.querySelectorAll(".se").forEach(el => el.classList.remove("dragging", "drag-over")); }

// ── Stage select / bulk ───────────────────────────────────────
function toggleStageSelect(i) {
  const idx = S.selectedStages.indexOf(i);
  if (idx > -1) S.selectedStages.splice(idx, 1); else S.selectedStages.push(i);
  S.bulkStatus = ""; render();
}
function clearStageSelection() { S.selectedStages = []; S.bulkStatus = ""; render(); }
function commonStageOptions() {
  if (!PROJ || !S.selectedStages.length) return [];
  const types = S.selectedStages.map(i => (PROJ.stages[i] && PROJ.stages[i].type) || "scope");
  const optSets = types.map(t => STAGE_OPTIONS[t] || STAGE_OPTIONS.scope);
  return optSets[0].filter(o => optSets.every(set => set.some(o2 => o2.v === o.v)));
}
function applyBulkStatus(newStatus) {
  if (!PROJ || !S.selectedStages.length || newStatus === undefined) return;
  if (!PROJ.activityLog) PROJ.activityLog = [];
  S.selectedStages.forEach(i => {
    const st = PROJ.stages[i]; if (!st) return;
    const old = st.status || "";
    if (old !== newStatus) PROJ.activityLog.push({ stageName: st.name || "Stage " + (i + 1), oldStatus: old, newStatus, by: S.coordName || "Coordinator", note: st.note || "", at: new Date().toISOString() });
    st.status = newStatus;
  });
  S.selectedStages = []; S.bulkStatus = ""; render();
}
function moveStageUp(i) {
  if (!PROJ || i <= 0) return;
  [PROJ.stages[i - 1], PROJ.stages[i]] = [PROJ.stages[i], PROJ.stages[i - 1]];
  S.selectedStages = S.selectedStages.map(s => s === i ? i - 1 : s === i - 1 ? i : s); render();
}
function moveStageDown(i) {
  if (!PROJ || i >= PROJ.stages.length - 1) return;
  [PROJ.stages[i + 1], PROJ.stages[i]] = [PROJ.stages[i], PROJ.stages[i + 1]];
  S.selectedStages = S.selectedStages.map(s => s === i ? i + 1 : s === i + 1 ? i : s); render();
}
function stageStatusChange(i, newStatus) {
  if (!PROJ) return;
  const st = PROJ.stages[i]; const old = st.status || "";
  if (!PROJ.activityLog) PROJ.activityLog = [];
  if (old !== newStatus) PROJ.activityLog.push({ stageName: st.name || "Stage " + (i + 1), oldStatus: old, newStatus, by: S.coordName || "Coordinator", note: st.note || "", at: new Date().toISOString() });
  PROJ.stages[i].status = newStatus; render();
}
function addDrawingPrepStage() { PROJ.stages.push({ name: "New Drawing Preparation Stage", type: "drawing_prep", status: "", note: "", time: "", appNum: "", dateA: "", dateB: "" }); render(); }
function addDrawingApprovalStage() { PROJ.stages.push({ name: "New Drawing Approval Stage", type: "approval_portal", status: "", note: "", time: "", appNum: "", dateA: "", dateB: "" }); render(); }

// ── Save & load ───────────────────────────────────────────────
let _projSnapshot = null;   // pristine copy taken when a project is opened (for diffing)
async function saveProj() {
  if (!PROJ) return; S.saving = true; render();
  const isEdit = !!PROJ.createdAt;
  const snapshot = _projSnapshot;
  stampAudit(PROJ, isEdit);
  const ok = await fbSet(coPath("projects/" + PROJ.id), PROJ);
  if (ok) {
    await logProjectChanges("Coordinator", isEdit ? snapshot : null, PROJ, PROJ.project?.title || PROJ.id);
    _projSnapshot = JSON.parse(JSON.stringify(PROJ));
  }
  S.saving = false; S.saved = ok; render();
  setTimeout(() => { S.saved = false; render(); }, 2500);
}
async function openProject(id) {
  document.getElementById("app").innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const data = await fbGet(coPath("projects/" + id));
  if (data) { PROJ = migrateProject(data); _projSnapshot = JSON.parse(JSON.stringify(PROJ)); S.authedCoord = true; S.mode = "coord"; S.tab = "proj"; render(); }
}
async function confirmDelete() {
  if (!PROJ) return;
  const title = PROJ.project?.title || PROJ.id;
  await fbDelete(coPath("projects/" + PROJ.id));
  logActivity("Coordinator", "Deleted project", title, "");
  PROJ = null; S.modal = null; S.mode = "coord"; S.tab = "list"; render();
}

// ── Stage row renderer ────────────────────────────────────────
function seRow(st, i, total) {
  const type = st.type || "scope";
  const opts = STAGE_OPTIONS[type] || STAGE_OPTIONS.scope;
  const curStatus = st.status || "";
  const checked = S.selectedStages.includes(i);
  return `<div class="se ${checked ? "se-selected" : ""}" draggable="true"
    ondragstart="dragStart(event,${i})" ondragover="dragOver(event,${i})"
    ondragleave="dragLeave(event)" ondrop="dragDrop(event,${i})" ondragend="dragEnd()">
    <input type="checkbox" class="se-check" ${checked ? "checked" : ""} onchange="toggleStageSelect(${i})"/>
    <div class="se-drag-handle" title="Drag to reorder">⠿</div>
    <div class="se-reorder">
      <button class="se-reorder-btn" ${i === 0 ? "disabled" : ""} onclick="moveStageUp(${i})">▲</button>
      <button class="se-reorder-btn" ${i === (total - 1) ? "disabled" : ""} onclick="moveStageDown(${i})">▼</button>
    </div>
    <div class="se-num">${i + 1}</div>
    <div class="se-body">
      <input class="se-ni" value="${esc(st.name || "")}" oninput="PROJ.stages[${i}].name=this.value" placeholder="Stage name"/>
      <div class="se-r">
        <select class="se-sel" onchange="stageStatusChange(${i},this.value)">
          ${opts.map(o => `<option value="${o.v}" ${curStatus === o.v ? "selected" : ""}>${o.label}</option>`).join("")}
        </select>
        <input class="se-time" value="${esc(st.time || "")}" oninput="PROJ.stages[${i}].time=this.value" placeholder="e.g. 5 working days"/>
      </div>
      ${needsAppNum(type, curStatus) ? `<div class="se-appnum-row">
        <span class="se-label">Application No. <span class="req-star">*</span></span>
        <input class="se-appnum-fi" value="${esc(st.appNum || "")}" oninput="PROJ.stages[${i}].appNum=this.value" placeholder="Enter application number"/>
      </div>` : ""}
      ${hasDateFields(type) ? `<div class="se-date-row">
        <div class="se-date-field">
          <span class="se-label">${dateLabelA(type)}</span>
          <input type="date" class="se-date-fi" value="${esc(st.dateA || "")}" oninput="PROJ.stages[${i}].dateA=this.value"/>
        </div>
        <div class="se-date-field">
          <span class="se-label">${dateLabelB(type)}</span>
          <input type="date" class="se-date-fi" value="${esc(st.dateB || "")}" oninput="PROJ.stages[${i}].dateB=this.value"/>
        </div>
      </div>` : ""}
      <input class="se-note" value="${esc(st.note || "")}" oninput="PROJ.stages[${i}].note=this.value" placeholder="Status note for client..."/>
    </div>
    <button class="btn-del" onclick="PROJ.stages.splice(${i},1);S.selectedStages=[];render()">✕</button>
  </div>`;
}

// ── Document group row ────────────────────────────────────────
function degRow(g, gi, fbRow) {
  let h = `<div class="deg ${fbRow ? "deg-fb" : ""}">
    <div class="deg-h">
      <input class="deg-name" value="${esc(g.group)}" oninput="PROJ.docs[${gi}].group=this.value"/>
      <button class="btn-del-sm" onclick="PROJ.docs.splice(${gi},1);render()">✕ Remove</button>
    </div>`;
  g.items.forEach((item, ii) => {
    h += `<div class="die-r">
      <select class="die-sel" onchange="PROJ.docs[${gi}].items[${ii}].status=this.value;render()">
        <option value="required" ${item.status === "required" || item.status === "pending" ? "selected" : ""}>Required</option>
        <option value="received" ${item.status === "received" || item.status === "done" ? "selected" : ""}>Received</option>
        <option value="not-received" ${item.status === "not-received" ? "selected" : ""}>Not Received</option>
        <option value="correction" ${item.status === "correction" ? "selected" : ""}>Correction Required</option>
        <option value="na" ${item.status === "na" ? "selected" : ""}>N/A</option>
      </select>
      <input class="die-n" value="${esc(item.name)}" oninput="PROJ.docs[${gi}].items[${ii}].name=this.value"/>
      <button class="btn-del" onclick="PROJ.docs[${gi}].items.splice(${ii},1);render()">✕</button>
    </div>`;
  });
  h += `<div class="btn-add" style="margin-top:4px${fbRow ? ";border-color:#e8a060;color:#a04800" : ""}"
    onclick="PROJ.docs[${gi}].items.push({name:'',status:'pending'});render()">+ Add Document</div></div>`;
  return h;
}

// ── Save scope from RTE ───────────────────────────────────────
function saveCoordScope() {
  if (!PROJ) return;
  const scopeEl = document.getElementById("coord-scope-editor");
  if (scopeEl) PROJ.proposal.scopeHtml = scopeEl.innerHTML;
  (PROJ.proposal.reapprovals || []).forEach((_, ri) => {
    const ed = document.getElementById("coord-reapp-editor-" + ri);
    if (ed) PROJ.proposal.reapprovals[ri].scopeHtml = ed.innerHTML;
  });
  saveProj();
}

// ── Render coordinator project list ──────────────────────────
function renderCoordList() {
  const isSuper = (CURRENT_USER && CURRENT_USER.role === "super_admin");
  // Coordinators (and super admin) see ALL projects; they narrow down with the
  // owner / status / type filters below. No per-user lock.
  const myProjects = Object.values(ALL_PROJECTS);

  let filtered = myProjects.filter(p => {
    const pr = p.project || {}, prop = p.proposal || {}, st = projStatus(p);
    if (S.coordFilterStatus !== "all" && st !== S.coordFilterStatus) return false;
    if (S.coordFilterOwner && S.coordFilterOwner !== "all") {
      const oc = (pr.coordinator || "");
      // Match whether the filter holds an email or a name.
      const meEmail = (CURRENT_USER && CURRENT_USER.email) || "";
      const meName  = (CURRENT_USER && CURRENT_USER.name) || "";
      const wantsMe = (S.coordFilterOwner === meEmail || S.coordFilterOwner === meName);
      if (wantsMe) { if (oc !== meEmail && oc !== meName) return false; }
      else if (oc !== S.coordFilterOwner) return false;
    }
    if (S.coordFilterProjType !== "all" && !natureArr(pr.unitType).includes(S.coordFilterProjType)) return false;
    if (S.coordFilterReapp === "yes" && (!prop.reapprovals || !prop.reapprovals.length)) return false;
    if (S.coordFilterReapp === "no" && prop.reapprovals && prop.reapprovals.length > 0) return false;
    if (S.coordFilterQuot && !(prop.quotationNumber || "").toLowerCase().includes(S.coordFilterQuot.toLowerCase())) return false;
    if (S.coordFilterStage !== "all") {
      if (!(p.stages || []).some(s => s.name === S.coordFilterStage && (s.status || "") !== "")) return false;
    }
    const q = (S.coordSearch || "").toLowerCase();
    if (q && !["title","client","unit","location"].some(k => (pr[k] || "").toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  const totalMy  = myProjects.length;
  const activeMy = myProjects.filter(p => projStatus(p) === "active").length;
  const doneMy   = myProjects.filter(p => projStatus(p) === "done").length;
  const allocMy  = myProjects.filter(p => projStatus(p) === "allocated").length;
  const attnMy   = myProjects.reduce((acc, p) => acc + (p.stages || []).filter(s => ["hold","waiting-applicant","rejected","not-received","comments-shared"].includes(s.status || "")).length, 0);

  return `
  <div class="cbar">
    <div class="clabel">⚙ ${(CURRENT_USER&&CURRENT_USER.role==="super_admin") ? "All Projects – Coordinator" : "All Projects – Coordinator" + (S.coordName ? ` (${esc(S.coordName)})` : "")}</div>
    ${(CURRENT_USER&&CURRENT_USER.role==="super_admin")?`<button class="btn btn-sm" style="background:rgba(227,196,104,0.25);color:#e3c468;font-weight:600;margin-left:auto"
      onclick="openActivityLog('Coordinator')">🕘 Log</button>`:""}
  </div>
  <div style="background:#fff;padding:12px 18px;border-bottom:1px solid #e5e5e5">
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:10px">
      ${[
        { n: totalMy,  l: "Total",     c: "#0d2137", f: "all" },
        { n: allocMy,  l: "Allocated", c: "#0369a1", f: "allocated" },
        { n: activeMy, l: "Active",    c: "#a06b00", f: "active" },
        { n: doneMy,   l: "Done",      c: "#166a3f", f: "done" },
        { n: attnMy,   l: "Attention", c: "#e24b4a", f: "all" }
      ].map(k => `<div style="background:#f7f7f7;border-radius:8px;padding:8px;text-align:center;cursor:pointer"
        onclick="S.coordFilterStatus='${k.f}';render()">
        <div style="font-size:18px;font-weight:700;color:${k.c}">${k.n}</div>
        <div style="font-size:9px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px">${k.l}</div>
      </div>`).join("")}
    </div>
  </div>
  <div class="coord-search-bar">
    <div style="display:inline-flex;border:1px solid #d6d9e2;border-radius:8px;overflow:hidden;flex-shrink:0">
      <button onclick="S.coordFilterOwner='all';render()" style="border:none;padding:7px 12px;font-size:12px;font-weight:600;cursor:pointer;background:${(!S.coordFilterOwner||S.coordFilterOwner==='all')?'#0d2137':'#fff'};color:${(!S.coordFilterOwner||S.coordFilterOwner==='all')?'#fff':'#555'}">All</button>
      ${S.coordName ? `<button onclick="S.coordFilterOwner='${esc(S.coordName)}';render()" style="border:none;border-left:1px solid #d6d9e2;padding:7px 12px;font-size:12px;font-weight:600;cursor:pointer;background:${S.coordFilterOwner===S.coordName?'#0d2137':'#fff'};color:${S.coordFilterOwner===S.coordName?'#fff':'#555'}">Owned by me</button>` : ""}
    </div>
    <input class="coord-search-input" id="coord-search" placeholder="Search by project, client, unit, location..."
      value="${esc(S.coordSearch || "")}" oninput="S.coordSearch=this.value;render();_refocusSearch('coord-search')"/>
    <select class="coord-filter-sel" onchange="S.coordFilterOwner=this.value;render()" title="Filter by owner / coordinator">
      <option value="all">All Owners</option>
      ${(!isSuper && S.coordName) ? `<option value="${esc(S.coordName)}" ${S.coordFilterOwner === S.coordName ? "selected" : ""}>My projects (${esc(S.coordName)})</option>` : ""}
      ${Array.from(new Set(Object.values(ALL_PROJECTS).map(p => (p.project&&p.project.coordinator)||"").filter(Boolean))).sort((a,b)=>a.localeCompare(b)).map(o =>
        `<option value="${esc(o)}" ${S.coordFilterOwner === o ? "selected" : ""}>${esc(_coordLabel(o))}</option>`).join("")}
    </select>
    <select class="coord-filter-sel" onchange="S.coordFilterStatus=this.value;render()">
      <option value="all">All Status</option>
      ${["proposal","allocated","new","active","done"].map(v =>
        `<option value="${v}" ${S.coordFilterStatus === v ? "selected" : ""}>${{proposal:"Proposal",allocated:"Allocated",new:"Not Started",active:"In Progress",done:"Completed"}[v]}</option>`
      ).join("")}
    </select>
    <select class="coord-filter-sel" onchange="S.coordFilterProjType=this.value;render()">
      <option value="all">All Natures</option>
      ${PROJECT_TYPES_NEW.map(t => `<option value="${t}" ${S.coordFilterProjType === t ? "selected" : ""}>${t}</option>`).join("")}
    </select>
    <select class="coord-filter-sel" onchange="S.coordFilterReapp=this.value;render()">
      <option value="all">All</option>
      <option value="yes" ${S.coordFilterReapp === "yes" ? "selected" : ""}>Has Re-approvals</option>
      <option value="no"  ${S.coordFilterReapp === "no"  ? "selected" : ""}>No Re-approvals</option>
    </select>
    <select class="coord-filter-sel" onchange="S.coordFilterStage=this.value;render()">
      <option value="all">All Stages</option>
      ${STAGE_NAMES.map(sn => `<option value="${esc(sn)}" ${S.coordFilterStage === sn ? "selected" : ""}>${esc(sn)}</option>`).join("")}
    </select>
    <input class="coord-filter-sel" placeholder="Quotation No." value="${esc(S.coordFilterQuot || "")}"
      oninput="S.coordFilterQuot=this.value;render()" style="min-width:120px"/>
  </div>
  <div style="padding:8px 18px 2px;font-size:12px;color:#888">
    ${(CURRENT_USER&&CURRENT_USER.role==="super_admin") ? ((S.coordFilterOwner&&S.coordFilterOwner!=="all") ? `Projects for <strong>${esc(S.coordFilterOwner)}</strong>` : "All projects") : (S.coordName ? `Projects for <strong>${esc(S.coordName)}</strong>` : "All projects")} — ${filtered.length} found
  </div>
  <div style="padding:0 18px 16px">
    ${!filtered.length ? `<div style="padding:24px;text-align:center;color:#aaa;font-size:13px">No projects match your filters.</div>` : ""}
    ${filtered.map(p => {
      const pr = p.project || {}, pc = projPct(p), st = projStatus(p);
      const cCls = { done:"chip-done", active:"chip-active", allocated:"chip-allocated" }[st] || "chip-new";
      const cTxt = { done:"Completed", active:"In Progress", allocated:"Allocated" }[st] || "Not Started";
      const activeStage = (p.stages || []).find(s => { const sv = s.status || ""; return sv && !["received","approved","completed","completed-signed","approved-bcc"].includes(sv); });
      const reapps = (p.proposal && p.proposal.reapprovals) || [];
      const attnCount = (p.stages || []).filter(s => ["hold","waiting-applicant","rejected","not-received","comments-shared"].includes(s.status || "")).length;
      return `<div class="proj-row" style="margin-top:8px" onclick="openProject('${p.id}')">
        <div class="proj-row-top">
          <div>
            <div class="proj-row-title">${esc(projTitle(p) || "Unnamed")}</div>
            <div class="proj-row-meta">${esc(pr.client || "—")} · ${esc(pr.location || "—")} · Unit: ${esc(pr.unit || "—")}</div>
            <div style="margin-top:5px;display:flex;gap:5px;flex-wrap:wrap">
              <span class="status-chip ${cCls}">${cTxt}</span>
              <span class="status-chip chip-new">${esc(p.createdAt || "")}</span>
              <span class="status-chip" style="background:#f0f0f0;color:#666">${esc(natureDisplay(pr.unitType))}</span>
              ${activeStage ? `<span class="status-chip" style="background:#eef4ff;color:#1a3a5c;font-size:10px">📍 ${esc(activeStage.name)}</span>` : ""}
              ${reapps.length ? `<span class="status-chip" style="background:#fde8d8;color:#a04800">🔄 ${reapps.length} Re-approval(s)</span>` : ""}
              ${attnCount ? `<span class="status-chip" style="background:#fde8e8;color:#a32d2d">⚠ ${attnCount} blocked</span>` : ""}
            </div>
          </div>
          <div class="proj-row-right">
            <div class="proj-pct">${pc}%</div>
            <div class="mini-bar-bg"><div class="mini-bar-fill" style="width:${pc}%"></div></div>
          </div>
        </div>
      </div>`;
    }).join("")}
  </div>
  <div class="footer">Winner Holistic Consultants · Coordinator · <a href="#" style="color:#888" onclick="event.preventDefault();serverLogout().then(()=>window.location.href='/auth/')">Logout</a></div>`;
}

// ── Render coordinator project editor ─────────────────────────
function awardedScopeProgress(proj) {
  // Payment progress = total CREDITED LPO amount ÷ the project's quotation
  // (contract) value. Only credited milestones count — raising an LPO does
  // not move this. Returns null when there's no contract value to divide by.
  if (!proj) return null;
  const contract = parseFloat(String((proj.proposal && proj.proposal.estimatedValue) || "").replace(/[^0-9.]/g, "")) || 0;
  if (contract <= 0) return null;
  const credited = (proj.lpos || [])
    .filter(l => l.status === "credited")
    .reduce((a, l) => a + (Number(l.amount) || 0), 0);
  return Math.min(100, Math.round((credited / contract) * 100));
}

function renderCoordEditor() {
  const d = PROJ, fb = natureArr(d.project.unitType).includes("F&B");
  const link = projectLink(d);
  const prop = d.proposal || {}, reapps = prop.reapprovals || [], ptypes = prop.projectTypes || [];
  const pct = awardedScopeProgress(d);

  let h = `
  <div class="cbar">
    <div class="clabel" style="cursor:pointer" onclick="PROJ=null;S.tab='list';render()">← ${S.coordName ? esc(S.coordName) : "Coordinator"}</div>
    <div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap">
      ${pct !== null ? `<span class="saved-chip" style="background:#1d9e75;color:#fff" title="Credited ÷ quotation value">${pct}% paid</span>` : ""}
      ${S.saving ? `<span style="font-size:11px;color:#c9a752">Saving...</span>` : ""}
      ${S.saved  ? `<span class="saved-chip">✓ Saved</span>` : ""}
      <button class="btn btn-sm" style="background:#1a3a5c;color:#c9a752;border:none" onclick="S.modal='showlink';render()">Share</button>
      <button class="btn btn-out btn-sm" onclick="S.mode='client';S.tab='stages';render()">Preview</button>
      <button class="btn btn-gold btn-sm" onclick="saveProj()">Save</button>
    </div>
  </div>
  <div class="linkbox" style="margin:0;border-radius:0;border-left:none;border-right:none">
    <div class="linkbox-title">Client Link</div>
    <div class="linkbox-url">${link}</div>
    <div class="linkbox-btns">
      <button class="btn btn-sm btn-navy" onclick="copyText('${link}')">Copy Link</button>
      <button class="btn btn-sm" style="background:#f0f0f0;color:#555" onclick="window.open('${link}','_blank')">Open Tab</button>
      <button class="btn btn-sm btn-red" onclick="S.modal='delproj';render()">Delete</button>
    </div>
  </div>
  <div class="tabs">
    <div class="tab ${S.tab==="proj"?"on":""}"      onclick="S.tab='proj';render()">Project Info</div>
    <div class="tab ${S.tab==="scope"?"on":""}"     onclick="S.tab='scope';render()">Scope &amp; Quotations${(PROJ.revisions||[]).filter(r=>r.status==="Requested").length?` <span style="background:#e67e22;color:#fff;font-size:9px;font-weight:700;padding:1px 6px;border-radius:9px">${(PROJ.revisions||[]).filter(r=>r.status==="Requested").length}</span>`:""}</div>
    <div class="tab ${S.tab==="docs"?"on":""}"      onclick="S.tab='docs';render()">Documents</div>
    <div class="tab ${S.tab==="lpo"?"on":""}"       onclick="S.tab='lpo';render()">Milestones</div>
    <div class="tab ${S.tab==="activity"?"on":""}"  onclick="S.tab='activity';render()">Activity Log</div>
  </div>
  <div class="body">`;

  // ── Project Info tab (coordinator landing; editable) ──────
  if (S.tab === "proj") {
    const canEdit = ["coordinator","super_admin"].includes(_role());
    const roField = (label, val) => `<div><div class="fl">${label}</div><div style="font-size:13px;color:#222;padding:6px 0">${val}</div></div>`;
    h += `<div class="sbox">
      <div class="sbox-title">Project Information ${canEdit ? `<span style="font-size:10px;font-weight:400;color:#9061e8;margin-left:6px">(editable)</span>` : `<span style="font-size:10px;font-weight:400;color:#bbb;margin-left:6px">(read-only)</span>`}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="ff"><div class="fl">Project Folder</div><div style="font-size:13px;color:#222;padding:6px 0">${esc(projTitle(d) || "—")}</div></div>
        ${roField("Client Name", esc(d.project.client || "—"))}
        <div><div class="fl">Project Coordinator ${_canAssignCoord() ? `<span style="font-size:9px;color:#9061e8;font-weight:600">(assign)</span>` : ""}</div>
          ${_canAssignCoord()
            ? `<select class="fi" style="padding:6px 8px;font-size:13px"
                 onchange="PROJ.project.coordinator=this.value; render()">
                 <option value="">— Assign a coordinator —</option>
                 ${(typeof COORDINATOR_USERS!=="undefined"?COORDINATOR_USERS:[]).map(u => {
                    const val = u.email || u.name;
                    return `<option value="${esc(val)}" ${d.project.coordinator===val?"selected":""}>${esc(u.name)}</option>`;
                 }).join("")}
                 ${d.project.coordinator && !(typeof COORDINATOR_USERS!=="undefined"?COORDINATOR_USERS:[]).some(u=>(u.email||u.name)===d.project.coordinator)
                    ? `<option value="${esc(d.project.coordinator)}" selected>${esc(_coordLabel(d.project.coordinator))} (inactive)</option>` : ""}
               </select>`
            : `<div style="font-size:13px;color:#222;padding:6px 0">${esc(_coordLabel(d.project.coordinator) || "— Unassigned")}</div>`}
        </div>
        <div><div class="fl">Unit / Shop No.</div>${canEdit
          ? `<input class="fi" style="font-size:13px" value="${esc(d.project.unit||"")}" oninput="PROJ.project.unit=this.value"/>`
          : `<div style="font-size:13px;color:#222;padding:6px 0">${esc(d.project.unit || "—")}</div>`}</div>
        <div class="ff"><div class="fl">Location / Mall</div>${canEdit
          ? `<input class="fi" style="font-size:13px" value="${esc(d.project.location||"")}" oninput="PROJ.project.location=this.value"/>`
          : `<div style="font-size:13px;color:#222;padding:6px 0">${esc(d.project.location || "—")}</div>`}</div>
        <div><div class="fl">Expected Start</div>${canEdit
          ? `<input class="fi" type="date" style="font-size:13px" value="${esc(prop.expectedStartDate||"")}" oninput="PROJ.proposal.expectedStartDate=this.value"/>`
          : `<div style="font-size:13px;color:#222;padding:6px 0">${fmtDate(prop.expectedStartDate) || "—"}</div>`}</div>
        <div><div class="fl">Expected End</div>${canEdit
          ? `<input class="fi" type="date" style="font-size:13px" value="${esc(d.project.expectedEnd || d.project.deadline || "")}" oninput="PROJ.project.expectedEnd=this.value"/>`
          : `<div style="font-size:13px;color:#222;padding:6px 0">${fmtDate(d.project.expectedEnd || d.project.deadline) || "—"}</div>`}</div>
        ${roField("Submitted By", esc(prop.submittedBy || "—"))}
        ${roField("Quotation No.", `<span style="color:#1a5276;font-weight:600">${esc(prop.quotationNumber || "—")}</span>`)}
        ${roField("Quotation Value", prop.estimatedValue ? "AED " + esc(prop.estimatedValue) : "—")}
      </div>
      ${ptypes.length ? `<div style="margin-top:8px"><div class="fl" style="margin-bottom:5px">Folder Categories</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap">${ptypes.map(t => `<span class="proj-type-tag">${esc(t)}</span>`).join("")}</div></div>` : ""}
      ${canEdit ? `<div style="font-size:11px;color:#aaa;margin-top:8px">Remember to press <b>Save</b> (top right) to store changes.</div>` : ""}
    </div>
    <div class="nb">Coordinators can update unit, location, and the expected start/end dates here.</div>`;

  // ── Scope tab (read-only for coordinator) ─────────────────
  } else if (S.tab === "scope") {
    h += `<div class="nb" style="margin-bottom:12px">📋 Each quotation's Scope of Work and Payment Milestones are shown together as one set. Additional scope enters only via a new quotation request (below).</div>`;
    h += renderQuotationGroups(d);
    // Approval Stages (drawing prep/approval workflow).
    h += renderApprovalStages(d);
    // New Quotation / Revision requests — the ONLY way to add scope/milestones.
    h += renderRevisionsBlock();

  // ── Milestones tab (LPO payments only) ──
  } else if (S.tab === "lpo") {
    h += renderPaymentStatus(d);

  // ── Docs tab ──────────────────────────────────────────────
  } else if (S.tab === "docs") {
    h += `<div class="sbox"><div class="sbox-title">📎 Project Proof / Attachment</div>
      ${attachmentWidget(PROJ.attachment, "project", PROJ.id, "_setProjectAttachment")}
    </div>`;
    h += `<div class="sbox"><div class="sbox-title">Standard Document Groups</div>`;
    d.docs.forEach((g, gi) => { if (g.fb) return; h += degRow(g, gi, false); });
    h += `<div class="btn-add" onclick="PROJ.docs.push({group:'New Group',fb:false,items:[]});render()">+ Add Document Group</div></div>`;
    h += `<div class="sbox sbox-fb"><div class="sbox-title sbox-title-fb">F&amp;B / Gas Documents
      <span style="font-size:9px;background:#fde8d8;color:#a04800;padding:1px 7px;border-radius:8px;margin-left:4px">${fb ? "VISIBLE TO CLIENT" : "HIDDEN"}</span>
    </div>`;
    d.docs.forEach((g, gi) => { if (!g.fb) return; h += degRow(g, gi, true); });
    h += `<div class="btn-add" style="border-color:#e8a060;color:#a04800"
      onclick="PROJ.docs.push({group:'New F&amp;B/Gas Group',fb:true,items:[]});render()">+ Add F&amp;B/Gas Group</div></div>`;

  // ── Proposal Revisions tab ────────────────────────────────
  // ── Activity Log tab ──────────────────────────────────────
  } else if (S.tab === "activity") {
    // Per-project log is loaded from the central table (single source),
    // filtered to this project, with a module filter.
    h += `<div class="sbox">
      <div class="sbox-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <span>Activity Log</span>
        <span style="display:flex;gap:8px;align-items:center">
          <select class="fi" style="width:150px;margin:0;font-size:12px" onchange="S.projLogModule=this.value;loadProjectLog()">
            ${["all","Coordinator","Account","Proposals"].map(m=>`<option value="${m}" ${(S.projLogModule||"all")===m?"selected":""}>${m==="all"?"All modules":m}</option>`).join("")}
          </select>
          ${(CURRENT_USER&&CURRENT_USER.role==="super_admin") ? `<button class="btn btn-sm btn-red" style="font-weight:400" onclick="clearProjectLog()">Clear Log</button>` : ""}
        </span>
      </div>
      <div id="proj-log-body" style="font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:12px">
        <div style="text-align:center;padding:20px;color:#bbb;font-size:13px">Loading…</div>
      </div>
    </div>`;
    // Kick off async load after render paints.
    setTimeout(() => { if (typeof loadProjectLog === "function") loadProjectLog(); }, 0);
  }

  h += `</div>`;
  return h;
}

// Load this project's entries from the central activity_log table and render
// them into the per-project log body, honoring the module filter.
async function loadProjectLog() {
  if (!PROJ) return;
  const body = document.getElementById("proj-log-body");
  if (!body) return;
  const mod = S.projLogModule || "all";
  let rows = [];
  try { rows = await getActivityLog(mod, 300, PROJ.id); } catch (e) { rows = []; }
  if (!rows.length) { body.innerHTML = `<div style="text-align:center;padding:20px;color:#bbb;font-size:13px">No activity recorded yet.</div>`; return; }
  body.innerHTML = rows.map((log, idx) => {
    const ts = (typeof fmtLogTime === "function") ? fmtLogTime(log.at) : log.at;
    let changesHtml = "";
    if (Array.isArray(log.changes) && log.changes.length) {
      changesHtml = `<div style="margin:3px 0 2px 14px;border-left:2px solid #eee;padding-left:10px">` +
        log.changes.map(c => {
          if (c.added)   return `<div style="color:#1d7a4d">＋ ${esc(c.field)}: <b>${esc(c.to)}</b></div>`;
          if (c.removed) return `<div style="color:#a33">－ ${esc(c.field)}: <s>${esc(c.from)}</s></div>`;
          return `<div style="color:#555">• ${esc(c.field)}: <span style="color:#a33">${esc(c.from)}</span> → <span style="color:#1d7a4d">${esc(c.to)}</span></div>`;
        }).join("") + `</div>`;
    }
    return `<div style="padding:6px 4px;${idx%2?'background:#fafafa':''};border-bottom:1px solid #f2f2f2">
      <span style="color:#888">${esc(ts)}</span> <span style="color:#bbb">[${esc(log.module||"-")}]</span> <span style="color:#1a3a5c;font-weight:700">${esc(log.byName||resolveUserName(log.by)||"—")}</span> <span style="color:#333">${esc(log.action||"")}</span>${log.detail?` <span style="color:#888">— ${esc(log.detail)}</span>`:""}
      ${changesHtml}
    </div>`;
  }).join("");
}

// ── Modals ────────────────────────────────────────────────────
function renderModals() {
  let overlay = "";
  if (S.modal === "revapprove" && PROJ && S.revIndex != null && PROJ.revisions && PROJ.revisions[S.revIndex]) {
    const rev = PROJ.revisions[S.revIndex];
    overlay = `<div class="overlay"><div class="modal" data-vo-safe style="max-width:560px;text-align:left">
      <h3>Review Revision Request</h3>
      <div style="background:#f7f8fa;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;line-height:1.7">
        <div><b>Title:</b> ${esc(rev.title||"—")}</div>
        <div><b>Reason:</b> ${esc(rev.reason||"—")}</div>
        <div><b>Requested scope:</b> ${esc(rev.scope||"—")}</div>
        <div><b>Value:</b> AED ${esc(rev.value||0)} &nbsp; <b>Quotation No:</b> ${esc(rev.quotationNo||"—")}</div>
        <div style="color:#999;margin-top:4px">Raised by ${esc(resolveUserName(rev.raisedBy)||"—")}</div>
      </div>

      <div style="font-weight:600;font-size:13px;margin-bottom:6px">New Scope Stages to add</div>
      ${(S.revNewStages||[]).map((s,si)=>`<div style="display:flex;gap:6px;margin-bottom:5px">
        <input class="fi" style="flex:2;margin:0" placeholder="Stage name" value="${esc(s.name||"")}" oninput="S.revNewStages[${si}].name=this.value"/>
        <input class="fi" type="number" style="width:80px;margin:0" placeholder="%" value="${esc(s.pct||0)}" oninput="S.revNewStages[${si}].pct=Number(this.value)||0"/>
      </div>`).join("")}
      <div class="btn-add" style="margin-bottom:12px" onclick="_revAddStageRow()">+ Add Stage</div>

      <div style="font-weight:600;font-size:13px;margin-bottom:6px">New LPO Milestones to add</div>
      ${(S.revNewLpos||[]).map((l,li)=>`<div style="display:flex;gap:6px;margin-bottom:5px">
        <input class="fi" style="flex:2;margin:0" placeholder="Milestone name" value="${esc(l.name||"")}" oninput="S.revNewLpos[${li}].name=this.value"/>
        <input class="fi" type="number" style="width:100px;margin:0" placeholder="AED" value="${esc(l.amount||0)}" oninput="S.revNewLpos[${li}].amount=Number(this.value)||0"/>
      </div>`).join("")}
      <div class="btn-add" style="margin-bottom:14px" onclick="_revAddLpoRow()">+ Add LPO Milestone</div>

      <div class="modal-btns">
        <button class="btn vo-allow" style="background:#f0f0f0;color:#666" onclick="S.modal=null;render()">Cancel</button>
        <button class="btn btn-red vo-allow" onclick="approveRevision('reject')">Reject</button>
        <button class="btn btn-gold vo-allow" onclick="approveRevision('approve')">Approve &amp; Add</button>
      </div>
    </div></div>`;
    return overlay;
  }
  if (S.modal === "showlink" && PROJ) {
    const link = projectLink(PROJ);
    overlay = `<div class="overlay"><div class="modal">
      <h3>Project Link Ready</h3>
      <p>Share this link with your client. They can open it on any device.</p>
      <div style="font-size:11px;color:#555;font-family:monospace;background:#f7f7f7;padding:10px;border-radius:8px;word-break:break-all;margin-bottom:12px">${link}</div>
      <div class="modal-btns">
        <button class="btn btn-gold" onclick="copyText('${link}')">Copy Link</button>
        <button class="btn btn-green" onclick="S.modal=null;render()">Done</button>
      </div>
    </div></div>`;
  }
  if (S.modal === "delproj") {
    overlay = `<div class="overlay"><div class="modal">
      <h3>Delete Project?</h3>
      <p>This will permanently delete <strong>${esc(PROJ ? PROJ.project.title : "this project")}</strong>. Cannot be undone.</p>
      <div class="modal-btns">
        <button class="btn" style="background:#f0f0f0;color:#666" onclick="S.modal=null;render()">Cancel</button>
        <button class="btn btn-red" onclick="confirmDelete()">Delete Permanently</button>
      </div>
    </div></div>`;
  }
  return overlay;
}

// ============================================================
//  LPO / Payments tab — shared by Coordinator & Account
//  Role behaviour:
//   - Proposals / Coordinator / Super Admin: can add LPOs and edit
//     name / amount / date / invoice.
//   - Account / Super Admin: can edit credited status, credited date,
//     payment reference (and amounts).
//  Everyone can view. Edits save with the rest of the project (Save button).
// ============================================================
function _role() { return (typeof CURRENT_USER !== "undefined" && CURRENT_USER && CURRENT_USER.role) || (getSession() && getSession().role) || ""; }
// Both Coordinator and Account can ADD milestones. Only Account (+ super_admin)
// can fill the invoice value / credited status.
function _canAddLpo()  { return ["coordinator","account","super_admin"].includes(_role()); }
function _canCredit()  { return ["account","super_admin"].includes(_role()); }
// Resolve an owner value (email or legacy name) to a friendly display name.
function _ownerLabel(ownerVal) {
  if (!ownerVal) return "";
  const list = (typeof ACCOUNT_USERS !== "undefined") ? ACCOUNT_USERS : [];
  const u = list.find(x => (x.email || "") === ownerVal || x.name === ownerVal);
  return u ? u.name : ownerVal;   // fall back to the raw value (email/name)
}
// The coordinator lead (super_admin) or a coordinator can assign ownership.
function _canAssignCoord() { return ["super_admin","coordinator"].includes(_role()); }
// Build a datalist of coordinator names: those already used on projects,
// plus any users with the coordinator role if that list is loaded.
function _coordNameOptions() {
  // Pull live from coordinator-role users (label = name, value = email),
  // plus any coordinator names already present on existing projects.
  const opts = [];
  const seen = new Set();
  try {
    (typeof COORDINATOR_USERS !== "undefined" ? COORDINATOR_USERS : []).forEach(u => {
      const val = u.email || u.name;
      if (val && !seen.has(val)) { seen.add(val); opts.push(`<option value="${esc(val)}">${esc(u.name)}</option>`); }
    });
  } catch (e) {}
  try {
    Object.values(ALL_PROJECTS || {}).forEach(p => {
      const c = p && p.project && p.project.coordinator;
      if (c && !seen.has(c)) { seen.add(c); opts.push(`<option value="${esc(c)}"></option>`); }
    });
  } catch (e) {}
  return opts.join("");
}
// Resolve a coordinator value (email or legacy name) to a display name.
function _coordLabel(val) {
  if (!val) return "";
  const u = (typeof COORDINATOR_USERS !== "undefined" ? COORDINATOR_USERS : []).find(x => (x.email||"")===val || x.name===val);
  return u ? u.name : val;
}

// Payment Status view (Milestones tab) — read-only status the coordinator can
// follow up on. Crediting stays Account-only; coordinator can add a note.
// Post a follow-up thread entry from the coordinator's Payment Status view.
async function _postFollowup(projectId, gi, mi, inputId) {
  const el = document.getElementById(inputId);
  const text = el ? el.value : "";
  if (!(text || "").trim()) return;
  const ok = await postMilestoneFollowup(projectId, gi, mi, text);
  if (ok) { if (el) el.value = ""; render(); }
  else alert("Could not post the follow-up. Please try again.");
}

function renderPaymentStatus(d) {
  const groups = d.quotationGroups || [];
  let totalContract = 0, totalCredited = 0, totalPending = 0, count = 0;
  groups.forEach(g => {
    const gt = g.contractTotal || 0;
    (g.milestones || []).forEach(m => {
      const val = m.amount || Math.round(gt * (Number(m.pct) || 0) / 100);
      totalContract += val; count++;
      if (m.status === "credited") totalCredited += val; else totalPending += val;
    });
  });
  const pctCollected = totalContract ? Math.round((totalCredited / totalContract) * 100) : 0;

  let h = `<div class="sbox">
    <div class="sbox-title">💰 Payment Status <span style="font-size:10px;color:#bbb;font-weight:400;margin-left:8px">${["account","super_admin"].includes(_role())?"enter invoice/payment details & credit below":"read-only · crediting is done by Accounts"}</span></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:8px 0">
      <div class="lpo-kpi"><div class="lpo-kpi-n">${fmtAED(totalContract)}</div><div class="lpo-kpi-l">Total (${count})</div></div>
      <div class="lpo-kpi"><div class="lpo-kpi-n" style="color:#27ae60">${fmtAED(totalCredited)}</div><div class="lpo-kpi-l">Credited</div></div>
      <div class="lpo-kpi"><div class="lpo-kpi-n" style="color:#e0a000">${fmtAED(totalPending)}</div><div class="lpo-kpi-l">Pending</div></div>
      <div class="lpo-kpi"><div class="lpo-kpi-n" style="color:#1a5fb4">${pctCollected}%</div><div class="lpo-kpi-l">Collected</div></div>
    </div>
  </div>`;

  if (!count) {
    return h + `<div class="sbox" style="margin-top:12px"><div style="font-size:12px;color:#aaa;padding:16px;text-align:center">No payment milestones yet.</div></div>`;
  }

  groups.forEach((g, gi) => {
    const gt = g.contractTotal || 0;
    if (!(g.milestones || []).length) return;
    h += `<div class="sbox" style="margin-top:12px">
      <div class="sbox-title" style="font-size:12px">${g.isRevision?'🔄 Revision ':''}Quotation ${esc(g.quotationNo || "—")}</div>`;
    g.milestones.forEach((m, mi) => {
      const val = m.amount || Math.round(gt * (Number(m.pct) || 0) / 100);
      const credited = m.status === "credited";
      const done = m.stageStatus === "Done";
      const statusChip = credited
        ? `<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;background:#e3f6ee;color:#0f6e56">✓ Credited${m.creditedDate?` · ${fmtLogTime(m.creditedDate)}`:""}${m.creditedBy?` · ${esc(resolveUserName(m.creditedBy))}`:""}</span>`
        : done
          ? `<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;background:#fdf3df;color:#8a5a00">⏳ Awaiting Accounts</span>`
          : `<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;background:#eef0f3;color:#777">${esc(m.stageStatus||"Not started")}</span>`;
      h += `<div style="border-bottom:1px solid #f0f0f3;padding:8px 0">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
          <div style="flex:1"><span style="font-size:13px;color:#1a2740;font-weight:600">${esc(m.name || "Milestone")}</span>
            <span style="font-size:11px;color:#999;margin-left:6px">${esc(m.pct||0)}%</span></div>
          <div style="font-weight:700;color:#0d2137;font-size:13px">${fmtAED(val)}</div>
          <div style="width:200px;text-align:right">${statusChip}</div>
        </div>
        <div style="margin-top:6px;background:#fafbfc;border-radius:6px;padding:6px 8px">
          <div style="font-size:10px;color:#aaa;font-weight:600;margin-bottom:2px">📣 Follow-up with Accounts</div>
          ${renderFollowupThread(m)}
          <div style="display:flex;gap:6px;align-items:center;margin-top:4px">
            <input class="fi" id="ftin_${gi}_${mi}" style="flex:1;margin:0;font-size:11px" placeholder="Write a follow-up to Accounts…"/>
            <button class="btn btn-sm btn-gold" onclick="_postFollowup('${d.id}',${gi},${mi},'ftin_${gi}_${mi}')">Post</button>
          </div>
        </div>
        ${_acctMilestoneForm(d.id, gi, mi, m, credited)}
      </div>`;
    });
    h += `</div>`;
  });
  return h;
}

// Account-team users (for the milestone assignee dropdown).
function _accountUsers() {
  if (typeof ACCOUNT_USERS !== "undefined" && Array.isArray(ACCOUNT_USERS) && ACCOUNT_USERS.length) return ACCOUNT_USERS;
  const list = (typeof WHC_USERS !== "undefined" && Array.isArray(WHC_USERS)) ? WHC_USERS : [];
  return list.filter(u => u.role === "account" || u.role === "super_admin");
}

// Account-only detailed milestone form (assignee/owner, invoice, dates,
// pending/credited status, payment ref). Rendered per group milestone.
function _acctMilestoneForm(projectId, gi, mi, m, credited) {
  if (!["account", "super_admin"].includes(_role())) return "";
  const P = `PROJ.quotationGroups[${gi}].milestones[${mi}]`;
  const accUsers = _accountUsers();
  return `<div style="margin-top:6px;background:#f4f8ff;border:1px solid #dce7fb;border-radius:6px;padding:10px">
    <div style="font-size:10px;color:#1a5fb4;font-weight:700;margin-bottom:6px">🧾 Accounts — Payment Details</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">
      <div>
        <div class="fl">Assignee (Owner)</div>
        <select class="fi" style="font-size:12px" onchange="${P}.owner=this.value;render()">
          <option value="">— Unassigned —</option>
          ${accUsers.map(u => `<option value="${esc(u.email||u.name)}" ${m.owner===(u.email||u.name)?"selected":""}>${esc(u.name)}${u.email?` · ${esc(u.email)}`:""}</option>`).join("")}
          ${m.owner && !accUsers.some(u=>(u.email||u.name)===m.owner) ? `<option value="${esc(m.owner)}" selected>${esc(m.owner)} (inactive)</option>` : ""}
        </select>
      </div>
      <div>
        <div class="fl">Invoice No.</div>
        <input class="fi" style="font-size:12px" value="${esc(m.invoiceNo||"")}" placeholder="INV-…" oninput="${P}.invoiceNo=this.value"/>
      </div>
      <div>
        <div class="fl">Date Raised</div>
        <input class="fi" type="date" style="font-size:12px" value="${esc(m.dateRaised||"")}" oninput="${P}.dateRaised=this.value"/>
      </div>
      <div>
        <div class="fl">Status</div>
        <select class="fi" style="font-size:12px" onchange="_setGroupMilestonePayStatus('${projectId}',${gi},${mi},this.value)">
          <option value="pending" ${!credited?"selected":""}>⏳ Pending</option>
          <option value="credited" ${credited?"selected":""}>✓ Credited</option>
        </select>
      </div>
      <div>
        <div class="fl">Credited Date</div>
        <input class="fi" type="date" style="font-size:12px" value="${esc((m.creditedDate||"").split('T')[0])}" oninput="${P}.creditedDate=this.value"/>
      </div>
      <div>
        <div class="fl">Payment Ref</div>
        <input class="fi" style="font-size:12px" value="${esc(m.paymentRef||"")}" placeholder="TT / Cheque no." oninput="${P}.paymentRef=this.value"/>
      </div>
    </div>
    <div style="margin-top:6px;text-align:right">
      <button class="btn btn-sm" style="background:#1a5fb4;color:#fff" onclick="_acctSaveMilestone('${projectId}')">💾 Save Payment Details</button>
    </div>
  </div>`;
}

// Toggle a group milestone's credited/pending status (account) and persist.
async function _setGroupMilestonePayStatus(projectId, gi, mi, value) {
  const g = PROJ.quotationGroups && PROJ.quotationGroups[gi];
  const ms = g && g.milestones && g.milestones[mi];
  if (!ms) return;
  if (value === "credited") {
    if (!confirm(`Mark "${ms.name || "this milestone"}" as credited?`)) { render(); return; }
    ms.status = "credited";
    if (!ms.creditedDate) ms.creditedDate = new Date().toISOString();
    const who = (typeof currentActor === "function") ? currentActor() : {};
    ms.creditedBy = who.email || who.name || "";
  } else {
    ms.status = "pending";
  }
  const ok = await fbSet(coPath("projects/" + projectId + "/quotationGroups"), PROJ.quotationGroups);
  if (!ok) alert("Could not save. Try again.");
  render();
}

// Save all edited payment fields on the milestones (account) in one write.
async function _acctSaveMilestone(projectId) {
  const ok = await fbSet(coPath("projects/" + projectId + "/quotationGroups"), PROJ.quotationGroups);
  S.saved = ok; render();
  if (!ok) alert("Could not save. Try again.");
  setTimeout(() => { S.saved = false; render(); }, 2000);
}

function renderLpoTab() {
  if (!PROJ) return "";
  if (!Array.isArray(PROJ.lpos)) PROJ.lpos = [];
  const t = lpoTotals(PROJ.lpos);

  let h = `<div class="sbox">
    <div class="sbox-title">Milestones / Payments
      <span style="font-size:10px;font-weight:400;color:#bbb;margin-left:6px">Coordinator or Account can add milestones · invoice value &amp; credited status set by Accounts</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin:6px 0 16px">
      <div class="lpo-kpi"><div class="lpo-kpi-n">${fmtAED(t.raised)}</div><div class="lpo-kpi-l">Total Raised (${t.count})</div></div>
      <div class="lpo-kpi"><div class="lpo-kpi-n" style="color:#27ae60">${fmtAED(t.credited)}</div><div class="lpo-kpi-l">Credited (${t.creditedCount})</div></div>
      <div class="lpo-kpi"><div class="lpo-kpi-n" style="color:#e0a000">${fmtAED(t.pending)}</div><div class="lpo-kpi-l">Pending</div></div>
    </div>`;

  if (!PROJ.lpos.length) {
    h += `<div style="padding:24px;text-align:center;color:#aaa;font-size:13px">No LPOs raised yet.</div>`;
  }

  PROJ.lpos.forEach((l, i) => {
    const credited = l.status === "credited";
    h += `<div class="lpo-card ${credited?"lpo-credited":""}">
      <div class="lpo-row">
        <div class="lpo-field" style="flex:2">
          <div class="fl">Milestone / Description</div>
          <input class="fi" value="${esc(l.name||"")}" ${_canAddLpo()?"":"disabled"}
            oninput="PROJ.lpos[${i}].name=this.value" placeholder="e.g. Advance, On Approval"/>
        </div>
        <div class="lpo-field">
          <div class="fl">Amount (AED)</div>
          <input class="fi" type="number" min="0" step="any" value="${esc(l.amount||0)}"
            ${(_canAddLpo()||_canCredit())?"":"disabled"}
            oninput="PROJ.lpos[${i}].amount=parseFloat(this.value)||0"/>
        </div>
        <div class="lpo-field">
          <div class="fl">Date Raised</div>
          <input class="fi" type="date" value="${esc(l.dateRaised||"")}" ${_canAddLpo()?"":"disabled"}
            oninput="PROJ.lpos[${i}].dateRaised=this.value"/>
        </div>
      </div>
      <div class="lpo-row">
        <div class="lpo-field" style="flex:2">
          <div class="fl">Owner (Account) <span style="color:#aaa;font-weight:400;font-size:10px">— responsible for crediting</span></div>
          <select class="fi" ${(_canAddLpo()||_canCredit())?"":"disabled"}
            onchange="PROJ.lpos[${i}].owner=this.value;render()">
            <option value="">— Unassigned —</option>
            ${(typeof ACCOUNT_USERS!=="undefined"?ACCOUNT_USERS:[]).map(u =>
              `<option value="${esc(u.email||u.name)}" ${l.owner===(u.email||u.name)?"selected":""}>${esc(u.name)}${u.email?` · ${esc(u.email)}`:""}</option>`).join("")}
            ${l.owner && !(typeof ACCOUNT_USERS!=="undefined"?ACCOUNT_USERS:[]).some(u=>(u.email||u.name)===l.owner)
              ? `<option value="${esc(l.owner)}" selected>${esc(l.owner)} (inactive)</option>` : ""}
          </select>
        </div>
      </div>
      <div class="lpo-row">
        <div class="lpo-field">
          <div class="fl">Invoice No.</div>
          <input class="fi" value="${esc(l.invoiceNo||"")}" ${(_canAddLpo()||_canCredit())?"":"disabled"}
            oninput="PROJ.lpos[${i}].invoiceNo=this.value" placeholder="INV-..."/>
        </div>
        <div class="lpo-field">
          <div class="fl">Status</div>
          <select class="fi" ${_canCredit()?"":"disabled"}
            onchange="creditLpoStatus(${i}, this.value)">
            <option value="pending" ${!credited?"selected":""}>⏳ Pending</option>
            <option value="credited" ${credited?"selected":""}>✓ Credited</option>
          </select>
        </div>
        <div class="lpo-field">
          <div class="fl">Credited Date</div>
          <input class="fi" type="date" value="${esc(l.creditedDate||"")}" ${_canCredit()?"":"disabled"}
            oninput="PROJ.lpos[${i}].creditedDate=this.value"/>
        </div>
        <div class="lpo-field">
          <div class="fl">Payment Ref</div>
          <input class="fi" value="${esc(l.paymentRef||"")}" ${_canCredit()?"":"disabled"}
            oninput="PROJ.lpos[${i}].paymentRef=this.value" placeholder="TT / Cheque no."/>
        </div>
      </div>
      <div style="margin-top:8px">
        ${attachmentWidget(l.attachment, "lpo", l.id, "_setLpoAttachment")}
      </div>
      <div class="lpo-foot">
        <span class="lpo-meta">
          ${l.raisedBy?`Added by ${esc(resolveUserName(l.raisedBy))}${l.raisedByRole?` (${esc(l.raisedByRole)})`:""}`:""}
          <span style="display:inline-block;margin-left:8px;font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;background:${credited?"#e3f6ee":"#eef0ff"};color:${credited?"#0f6e56":"#3730a3"}">
            ${credited
              ? `✓ Credited by Accounts${l.creditedBy?` · ${esc(resolveUserName(l.creditedBy))}`:""}${l.creditedDate?` · ${esc(l.creditedDate)}`:""}`
              : (l.owner ? `Owner: ${esc(_ownerLabel(l.owner))} (Accounts)` : `Owned by Accounts — assign an owner`)}
          </span>
        </span>
        ${_canAddLpo()||_canCredit()?`<button class="btn btn-sm btn-red" onclick="removeLpo(${i})">Remove</button>`:""}
      </div>
    </div>`;
  });

  if (_canAddLpo()) {
    const isFirst = PROJ.lpos.length === 0;
    h += `<button class="btn btn-gold" style="margin-top:12px" onclick="addLpo()">
      + Add ${isFirst ? "First Milestone (Advance)" : "Milestone"}</button>`;
  }
  h += `<div style="margin-top:10px;font-size:11px;color:#999">Remember to press <b>Save</b> (top right) to store changes.</div>`;
  h += `</div>`;
  return h;
}

function addLpo() {
  if (!_canAddLpo()) { alert("You don't have permission to add LPOs."); return; }
  if (!Array.isArray(PROJ.lpos)) PROJ.lpos = [];
  const seed = PROJ.lpos.length === 0 ? "Advance" : "";
  const lpo = blankLPO(seed);
  // If an Account user is adding it, they take ownership by default (by email).
  const who = (typeof CURRENT_USER !== "undefined" && CURRENT_USER) || getSession() || {};
  if (who.role === "account" && (who.email || who.name)) lpo.owner = who.email || who.name;
  PROJ.lpos.push(lpo);
  render();
}
function removeLpo(i) {
  if (!confirm("Remove this LPO entry?")) return;
  PROJ.lpos.splice(i, 1);
  render();
}

// ── Proposal Revisions: roles ─────────────────────────────────
// Coordinator (or super admin) raises requests; Proposal In-charge
// (proposals role, or super admin) reviews/approves.
// The project's contract value (Total incl. VAT & Govt Fees from the quotation).
function _contractValue() {
  if (!PROJ) return 0;
  return parseFloat(String((PROJ.proposal && PROJ.proposal.estimatedValue) || "").replace(/[^0-9.]/g, "")) || 0;
}
// Value of a milestone stage = its % of the project's quotation value.
function _stageValue(s) {
  if (!PROJ) return 0;
  const contract = parseFloat(String((PROJ.proposal && PROJ.proposal.estimatedValue) || "").replace(/[^0-9.]/g, "")) || 0;
  return Math.round((contract * (Number(s.pct) || 0)) / 100);
}

// Render each quotation group (scope + milestones as one coupled set).
// Coordinators cannot add scope/milestones directly — only via a new quotation.
function renderQuotationGroups(d) {
  const groups = d.quotationGroups || [];
  if (!groups.length) return `<div class="sbox"><div style="font-size:12px;color:#aaa;padding:16px;text-align:center">No quotation scope yet. It appears here once the quotation is awarded.</div></div>`;
  let h = "";
  groups.forEach((g, gi) => {
    const total = g.contractTotal || 0;
    h += `<div class="sbox" style="margin-top:12px;border-left:3px solid ${g.isRevision?'#e67e22':'#5b3df5'}">
      <div class="sbox-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>${g.isRevision?'🔄 Revision':'📄'} Quotation ${esc(g.quotationNo||"—")}</span>
        <span style="font-size:11px;color:#166a3f;font-weight:700">${fmtAED(total)}</span>
      </div>
      <div style="font-size:10px;color:#999;font-weight:600;margin:8px 0 4px">Scope of Work</div>
      ${(g.scope||[]).length ? g.scope.map(s=>`
        <div style="display:flex;gap:8px;margin-bottom:4px">
          <div style="flex:2;font-size:12px;color:#333">${esc(s.name||"—")}</div>
          <div style="width:120px;text-align:right;font-size:12px;color:#166a3f;font-weight:600">${fmtAED(s.value||0)}</div>
        </div>`).join("") : `<div style="font-size:12px;color:#aaa">No scope items.</div>`}
      <div style="font-size:11px;color:#777;text-align:right;border-top:1px solid #eee;padding-top:4px;margin-top:4px">
        Sub-Total ${fmtAED(g.subtotal||0)} · VAT ${fmtAED(g.vat||0)} · Govt ${fmtAED(g.govtTotal||0)} · <b>Total ${fmtAED(total)}</b></div>

      <div style="font-size:10px;color:#999;font-weight:600;margin:12px 0 4px">Payment Milestones <span style="font-weight:400">(% of ${fmtAED(total)} · Done → Account)</span></div>
      <div style="display:flex;gap:8px;margin-bottom:4px;font-size:10px;color:#aaa;font-weight:600">
        <span style="flex:2">Description</span><span style="width:60px;text-align:right">%</span><span style="width:100px;text-align:right">Value</span><span style="width:130px;text-align:center">Status</span>
      </div>
      ${(g.milestones||[]).map((m,mi)=>`
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:5px">
          <div style="flex:2;font-size:12px;color:#333">${esc(m.name||"—")}</div>
          <div style="width:60px;text-align:right;font-size:12px">${esc(m.pct||0)}%</div>
          <div style="width:100px;text-align:right;font-size:12px;color:#166a3f;font-weight:600">${fmtAED(Math.round(total*(Number(m.pct)||0)/100))}</div>
          ${m.status==="credited"
            ? `<div style="width:130px;text-align:center;font-size:11px;color:#166a3f;font-weight:600">✓ Credited by Accounts</div>`
            : `<select class="fi" style="width:130px;margin:0" onchange="_setGroupMilestoneStatus(${gi},${mi},this.value)">
                ${["Not started","In progress","Done"].map(v=>`<option value="${v}" ${(m.stageStatus||"Not started")===v?"selected":""}>${v}</option>`).join("")}
              </select>`}
          ${m.status==="credited"?"":m.stageStatus==="Done"?`<span style="font-size:10px;color:#a06b00">⏳ awaiting Accounts</span>`:""}
        </div>`).join("")}
    </div>`;
  });
  return h;
}

// Set a milestone's stage status within a quotation group; Done marks it as a
// pending payment item for the Account team (unless already credited).
async function _setGroupMilestoneStatus(gi, mi, val) {
  const g = PROJ.quotationGroups && PROJ.quotationGroups[gi];
  if (!g || !g.milestones || !g.milestones[mi]) return;
  g.milestones[mi].stageStatus = val;
  if (val === "Done" && g.milestones[mi].status !== "credited") g.milestones[mi].status = "pending";
  render();
  // Persist immediately so the Account team's Awaiting list picks it up without
  // the coordinator having to press Save separately.
  try { await fbSet(coPath("projects/" + PROJ.id + "/quotationGroups"), PROJ.quotationGroups); }
  catch (e) {}
}

// Approval Stages block — moved out of the Milestones tab into Scope & Quotations.
function renderApprovalStages(d) {
  const commonOpts = commonStageOptions();
  let h = `<div class="sbox" style="margin-top:12px">
    <div class="sbox-title">Approval Stages <span style="font-size:10px;color:#bbb;font-weight:400;margin-left:8px">⠿ Drag or ↑↓ to reorder</span></div>`;
  if (S.selectedStages.length > 0) {
    h += `<div class="bulk-bar">
      <span class="bulk-bar-count">${S.selectedStages.length} stage(s) selected</span>
      <select class="se-sel" style="flex:1;min-width:160px" onchange="S.bulkStatus=this.value;render()">
        <option value="">— Set status for selected —</option>
        ${commonOpts.map(o => `<option value="${o.v}" ${S.bulkStatus === o.v ? "selected" : ""}>${o.label}</option>`).join("")}
      </select>
      <button class="btn btn-sm btn-gold" ${S.bulkStatus === "" ? "disabled" : ""} onclick="applyBulkStatus(S.bulkStatus)">Apply</button>
      <button class="btn btn-sm" style="background:#f0f0f0;color:#666" onclick="clearStageSelection()">Clear</button>
    </div>
    ${!commonOpts.length ? `<div style="font-size:11px;color:#a04800;margin-bottom:8px">Selected stages have no common status options.</div>` : ""}`;
  }
  (d.stages || []).forEach((st, i) => { if ((st.type||"") !== "awarded_scope") h += seRow(st, i, d.stages.length); });
  h += `<div class="btn-add btn-add-prep" onclick="addDrawingPrepStage()">+ Add Drawing Preparation Stage</div>
  <div class="btn-add btn-add-approval" onclick="addDrawingApprovalStage()">+ Add Drawing Approval Stage</div></div>`;
  return h;
}

function _canRaiseRevision() { return ["coordinator","super_admin"].includes(_role()); }
function _canApproveRevision() { return ["proposals","super_admin"].includes(_role()); }

// Revision-request table — shown under Scope & Quotations. Coordinators raise
// requests for a new quotation (same folder); the Proposal In-charge reviews
// and, on approval, adds the new scope stages + LPO milestones to the project.
function renderRevisionsBlock() {
  if (!PROJ) return "";
  if (!Array.isArray(PROJ.revisions)) PROJ.revisions = [];
  const canApprove = _canApproveRevision();
  const revs = PROJ.revisions;
  return `<div class="nb" style="margin:16px 0 12px">🔄 New Quotation Requests — raise a request for the Proposals team to create a new quotation under the same folder (variations, additional scope). On approval, the new scope &amp; milestones are added below and flow into this project as history.</div>
    <div class="sbox">
      <div class="sbox-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>New Quotation / Revision Requests</span>
        ${_canRaiseRevision() ? `<button class="btn btn-sm btn-gold" onclick="addRevision()">+ New Request</button>` : ""}
      </div>
      ${!revs.length ? `<div style="text-align:center;padding:20px;color:#bbb;font-size:13px">No revision requests yet.</div>` : `
      <div style="overflow-x:auto">
      <table class="rev-table" style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#f5f6fa;text-align:left">
            <th style="padding:8px 10px">Title</th>
            <th style="padding:8px 10px">Reason</th>
            <th style="padding:8px 10px">Requested Scope</th>
            <th style="padding:8px 10px">Value (AED)</th>
            <th style="padding:8px 10px">Quotation No.</th>
            <th style="padding:8px 10px">Status</th>
            <th style="padding:8px 10px"></th>
          </tr>
        </thead>
        <tbody>
        ${revs.map((r,i)=>{
          const st = r.status || "Requested";
          const stColor = st==="Approved"?"#166a3f":st==="Rejected"?"#a33":"#a06b00";
          const stBg = st==="Approved"?"#e3f6ee":st==="Rejected"?"#fdecec":"#fdf3df";
          const editable = _canRaiseRevision() && st==="Requested";
          return `<tr style="border-bottom:1px solid #eef0f3;vertical-align:top">
            <td style="padding:8px 10px">${editable?`<input class="fi" style="margin:0;min-width:110px" value="${esc(r.title||"")}" oninput="PROJ.revisions[${i}].title=this.value"/>`:esc(r.title||"—")}</td>
            <td style="padding:8px 10px">${editable?`<input class="fi" style="margin:0;min-width:120px" value="${esc(r.reason||"")}" oninput="PROJ.revisions[${i}].reason=this.value"/>`:esc(r.reason||"—")}</td>
            <td style="padding:8px 10px">${editable?`<input class="fi" style="margin:0;min-width:140px" value="${esc(r.scope||"")}" oninput="PROJ.revisions[${i}].scope=this.value"/>`:esc(r.scope||"—")}</td>
            <td style="padding:8px 10px">${editable?`<input class="fi" type="number" style="margin:0;width:90px" value="${esc(r.value||0)}" oninput="PROJ.revisions[${i}].value=parseFloat(this.value)||0"/>`:("AED "+esc(r.value||0))}</td>
            <td style="padding:8px 10px"><span style="font-weight:600;color:#1a5276">${esc(r.quotationNo||"—")}</span></td>
            <td style="padding:8px 10px"><span style="font-weight:600;padding:2px 9px;border-radius:10px;background:${stBg};color:${stColor}">${esc(st)}</span></td>
            <td style="padding:8px 10px;white-space:nowrap">
              ${(st==="Requested" && canApprove) ? `<button class="btn btn-sm btn-gold vo-allow" onclick="openRevisionApproval(${i})">Review</button>` : ""}
              ${(st==="Requested" && _canRaiseRevision()) ? `<button class="btn btn-sm btn-red" onclick="PROJ.revisions.splice(${i},1);render()">✕</button>` : ""}
              ${st!=="Requested" ? `<span style="font-size:10px;color:#999">${esc(resolveUserName(r.actionedBy)||"")}${r.actionedAt?` · ${fmtLogTime(r.actionedAt)}`:""}</span>` : ""}
            </td>
          </tr>
          ${r.status==="Approved" && (r.addedStages||r.addedLpos) ? `<tr><td colspan="7" style="padding:2px 10px 10px 10px">
            <div style="font-size:11px;color:#166a3f;background:#f2fbf6;border-radius:6px;padding:6px 10px">
              ✓ Added ${r.addedStages||0} stage(s) and ${r.addedLpos||0} milestone(s) to this project.
            </div></td></tr>` : ""}`;
        }).join("")}
        </tbody>
      </table></div>`}
      ${_canRaiseRevision()&&revs.some(r=>r.status==="Requested") ? `<div style="font-size:11px;color:#aaa;margin-top:8px">Remember to Save the project after adding or editing requests.</div>` : ""}
    </div>`;
}

async function addRevision() {
  if (!_canRaiseRevision()) { alert("Only a Coordinator can raise a revision request."); return; }
  if (!Array.isArray(PROJ.revisions)) PROJ.revisions = [];
  const who = (typeof CURRENT_USER!=="undefined" && CURRENT_USER) || getSession() || {};
  const rev = {
    id: "rev_" + Date.now(),
    title: "", reason: "", scope: "", value: 0, quotationNo: "(assigning…)",
    status: "Requested",
    raisedBy: who.email || who.name || "", raisedAt: new Date().toISOString()
  };
  PROJ.revisions.push(rev);
  render();
  // Mint a REAL new quotation (next number from the parent's category counter,
  // same folder, Open state) that appears in the Proposals list.
  if (typeof mintRevisionQuotation === "function") {
    const qtnNo = await mintRevisionQuotation(PROJ, rev);
    rev.quotationNo = qtnNo || "(pending)";
    render();
    saveProj();   // persist the linked quotation number on the project
  }
}

// Open the approval modal for a revision — the In-charge fills the new
// stages and LPO milestones that this revision adds, then approves.
function openRevisionApproval(i) {
  if (!_canApproveRevision()) { alert("Only the Proposal In-charge can review this."); return; }
  S.revIndex = i;
  // Working buffers for the stages/LPOs to add on approval.
  S.revNewStages = [{ name: "", pct: 0 }];
  S.revNewLpos = [{ name: "", amount: 0 }];
  S.modal = "revapprove";
  render();
}

function _revAddStageRow() { (S.revNewStages = S.revNewStages||[]).push({name:"",pct:0}); render(); }
function _revAddLpoRow()   { (S.revNewLpos = S.revNewLpos||[]).push({name:"",amount:0}); render(); }

// Approve: attach the new stages + LPO milestones to the project, mark the
// revision approved, and record who/when.
async function approveRevision(decision) {
  const i = S.revIndex;
  if (i == null || !PROJ.revisions[i]) { S.modal=null; render(); return; }
  const who = (typeof CURRENT_USER!=="undefined" && CURRENT_USER) || getSession() || {};
  const rev = PROJ.revisions[i];

  if (decision === "reject") {
    rev.status = "Rejected";
    rev.actionedBy = who.email || who.name || ""; rev.actionedAt = new Date().toISOString();
    S.modal = null; render(); saveProj(); return;
  }

  // Approve: append the filled stages and LPOs.
  if (!Array.isArray(PROJ.stages)) PROJ.stages = [];
  if (!Array.isArray(PROJ.lpos)) PROJ.lpos = [];
  const stages = (S.revNewStages||[]).filter(s => (s.name||"").trim());
  const lpos   = (S.revNewLpos||[]).filter(l => (l.name||"").trim());
  stages.forEach(s => PROJ.stages.push({ name: s.name, type: "awarded_scope", pct: Number(s.pct)||0, status: "Not started", _fromRevision: rev.id }));
  lpos.forEach((l,idx) => PROJ.lpos.push({
    id: "lpo_rev_" + rev.id + "_" + idx, name: l.name, amount: Number(l.amount)||0,
    dateRaised: "", raisedBy: who.email||who.name||"", status: "pending", owner: "", creditedDate: "", _fromRevision: rev.id
  }));

  rev.status = "Approved";
  rev.actionedBy = who.email || who.name || ""; rev.actionedAt = new Date().toISOString();
  rev.addedStages = stages.length; rev.addedLpos = lpos.length;

  S.modal = null; S.revIndex = null; S.revNewStages = null; S.revNewLpos = null;
  render();
  saveProj();   // persist and log the change
}

// Super-admin only: permanently clear this project's activity log entries
// from the central table.
async function clearProjectLog() {
  if (!CURRENT_USER || CURRENT_USER.role !== "super_admin") { alert("Only a Super Admin can clear the log."); return; }
  if (!PROJ) return;
  if (!confirm("Permanently clear ALL activity log entries for this project? This cannot be undone.")) return;
  try {
    const all = await fbGet("activity_log", { fresh: true }) || {};
    const keys = Object.keys(all).filter(k => all[k] && all[k].projectId === PROJ.id);
    for (let i = 0; i < keys.length; i += 20) {
      await Promise.all(keys.slice(i, i+20).map(k => fbDelete("activity_log/" + k)));
    }
    await logActivity("Coordinator", "Cleared project activity log", PROJ.project?.title || PROJ.id, "", null, PROJ.id);
  } catch (e) { alert("Could not clear the log. Please try again."); }
  if (typeof loadProjectLog === "function") loadProjectLog();
}

// Account team sets credited/pending status. Records who credited it and when,
// so the ownership label can show "Credited by Accounts · <name>".
function creditLpoStatus(i, value) {
  if (!PROJ || !PROJ.lpos[i]) return;
  const who = (typeof CURRENT_USER !== "undefined" && CURRENT_USER) || getSession() || {};
  const l = PROJ.lpos[i];
  l.status = value;
  if (value === "credited") {
    if (!l.creditedDate) l.creditedDate = new Date().toISOString().slice(0, 10);
    l.creditedBy = who.email || who.name || "";
  } else {
    // Reverting to pending clears the crediting stamp.
    l.creditedBy = "";
  }
  render();
}

// Attach an uploaded proof to the LPO with this id, then re-render.
function _setLpoAttachment(att, lpoId) {
  if (!PROJ || !Array.isArray(PROJ.lpos)) return;
  const lpo = PROJ.lpos.find(l => l.id === lpoId);
  if (lpo) { lpo.attachment = att; render(); }
}

// Attach an uploaded proof to the whole project, then re-render.
function _setProjectAttachment(att) {
  if (!PROJ) return;
  PROJ.attachment = att;
  render();
}
