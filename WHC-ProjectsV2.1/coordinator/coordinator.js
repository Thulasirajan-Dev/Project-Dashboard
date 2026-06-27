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
function hasDateFields(type) { return !["scope", "site_work", "completed"].includes(type); }
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
  const isEdit = !!PROJ.createdAt;           // first save = create, later saves = edit
  const summary = isEdit ? diffProjectSummary(_projSnapshot, PROJ) : "";
  stampAudit(PROJ, isEdit);
  const ok = await fbSet("projects/" + PROJ.id, PROJ);
  if (ok) {
    logActivity("Coordinator", isEdit ? "Updated project" : "Created project",
      PROJ.project?.title || PROJ.id, summary);
    _projSnapshot = JSON.parse(JSON.stringify(PROJ));  // reset baseline after save
  }
  S.saving = false; S.saved = ok; render();
  setTimeout(() => { S.saved = false; render(); }, 2500);
}
async function openProject(id) {
  document.getElementById("app").innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const data = await fbGet("projects/" + id);
  if (data) { PROJ = migrateProject(data); _projSnapshot = JSON.parse(JSON.stringify(PROJ)); S.authedCoord = true; S.mode = "coord"; S.tab = "stages"; render(); }
}
async function confirmDelete() {
  if (!PROJ) return;
  const title = PROJ.project?.title || PROJ.id;
  await fbDelete("projects/" + PROJ.id);
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
  const myProjects = Object.values(ALL_PROJECTS).filter(p => {
    const coord = (p.project && p.project.coordinator) || "";
    return S.coordName ? coord.toLowerCase().includes(S.coordName.toLowerCase()) : true;
  });

  let filtered = myProjects.filter(p => {
    const pr = p.project || {}, prop = p.proposal || {}, st = projStatus(p);
    if (S.coordFilterStatus !== "all" && st !== S.coordFilterStatus) return false;
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
    <div class="clabel">⚙ ${S.coordName ? esc(S.coordName) + " – Coordinator" : "Coordinator Mode"}</div>
    ${(CURRENT_USER&&CURRENT_USER.role==="super_admin")?`<button class="btn btn-sm" style="background:rgba(227,196,104,0.25);color:#e3c468;font-weight:600;margin-left:auto"
      onclick="openActivityLog('Coordinator')">🕓 Log</button>`:""}
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
    <input class="coord-search-input" placeholder="Search by project, client, unit, location..."
      value="${esc(S.coordSearch || "")}" oninput="S.coordSearch=this.value;render()"/>
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
    ${S.coordName ? `Projects for <strong>${esc(S.coordName)}</strong>` : "All projects"} — ${filtered.length} found
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
            <div class="proj-row-title">${esc(pr.title || "Unnamed")}</div>
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
  <div class="footer">Winner Holistic Consultants · Coordinator · <a href="." style="color:#888">Logout</a></div>`;
}

// ── Render coordinator project editor ─────────────────────────
function renderCoordEditor() {
  const d = PROJ, fb = natureArr(d.project.unitType).includes("F&B");
  const link = projectLink(d.id);
  const prop = d.proposal || {}, reapps = prop.reapprovals || [], ptypes = prop.projectTypes || [];

  let h = `
  <div class="cbar">
    <div class="clabel" style="cursor:pointer" onclick="PROJ=null;S.tab='list';render()">← ${S.coordName ? esc(S.coordName) : "Coordinator"}</div>
    <div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap">
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
    <div class="tab ${S.tab==="scope"?"on":""}"     onclick="S.tab='scope';render()">Scope & Quotations</div>
    <div class="tab ${S.tab==="stages"?"on":""}"    onclick="S.tab='stages';render()">Stages</div>
    <div class="tab ${S.tab==="lpo"?"on":""}"       onclick="S.tab='lpo';render()">💰 LPO / Payments</div>
    <div class="tab ${S.tab==="docs"?"on":""}"      onclick="S.tab='docs';render()">Documents</div>
    <div class="tab ${S.tab==="activity"?"on":""}"  onclick="S.tab='activity';render()">Activity Log</div>
  </div>
  <div class="body">`;

  // ── Project Info tab ──────────────────────────────────────
  if (S.tab === "proj") {
    h += `<div class="sbox">
      <div class="sbox-title">Project Information <span style="font-size:10px;font-weight:400;color:#bbb;margin-left:6px">(set by Proposals Team)</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="ff"><div class="fl">Project Folder</div><div style="font-size:13px;color:#222;padding:6px 0">${esc(d.project.title || "—")}</div></div>
        <div><div class="fl">Client Name</div><div style="font-size:13px;color:#222;padding:6px 0">${esc(d.project.client || "—")}</div></div>
        <div><div class="fl">Project Coordinator</div><div style="font-size:13px;color:#222;padding:6px 0">${esc(d.project.coordinator || "—")}</div></div>
        <div><div class="fl">Unit / Shop No.</div><div style="font-size:13px;color:#222;padding:6px 0">${esc(d.project.unit || "—")}</div></div>
        <div class="ff"><div class="fl">Location / Mall</div><div style="font-size:13px;color:#222;padding:6px 0">${esc(d.project.location || "—")}</div></div>
        <div><div class="fl">Nature of the Project</div><div style="font-size:13px;color:#222;padding:6px 0">${esc(natureDisplay(d.project.unitType))}</div></div>
        <div><div class="fl">Expected Start</div><div style="font-size:13px;color:#222;padding:6px 0">${fmtDate(prop.expectedStartDate) || "—"}</div></div>
        <div><div class="fl">Quotation No.</div><div style="font-size:13px;color:#1a5276;font-weight:600;padding:6px 0">${esc(prop.quotationNumber || "—")}</div></div>
        <div><div class="fl">Quotation Value</div><div style="font-size:13px;color:#166a3f;font-weight:600;padding:6px 0">${prop.estimatedValue ? "AED " + esc(prop.estimatedValue) : "—"}</div></div>
        <div><div class="fl">Submitted By</div><div style="font-size:13px;color:#222;padding:6px 0">${esc(prop.submittedBy || "—")}</div></div>
      </div>
      ${ptypes.length ? `<div style="margin-top:8px"><div class="fl" style="margin-bottom:5px">Folder Categories</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap">${ptypes.map(t => `<span class="proj-type-tag">${esc(t)}</span>`).join("")}</div></div>` : ""}
    </div>
    ${reapps.length ? `<div class="reapp-box">
      <div class="reapp-box-title">🔄 Re-approval Quotations (${reapps.length})</div>
      ${reapps.map((r, ri) => `<div class="reapp-entry">
        <div class="reapp-entry-num">RE-APPROVAL #${ri + 1}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
          <div><div class="fl">Title</div><div style="font-size:12px">${esc(r.title || "—")}</div></div>
          <div><div class="fl">Quotation No.</div><div style="font-size:12px;color:#1a5276;font-weight:600">${esc(r.quotationNumber || "—")}</div></div>
          <div><div class="fl">Value (AED)</div><div style="font-size:12px;color:#166a3f;font-weight:600">${r.value ? "AED " + esc(r.value) : "—"}</div></div>
        </div>
      </div>`).join("")}
    </div>` : ""}
    <div class="nb">Project information is managed by the Proposals Team.</div>`;

  // ── Scope tab (read-only for coordinator) ─────────────────
  } else if (S.tab === "scope") {
    h += `<div class="nb" style="margin-bottom:12px">📋 Managed by the Proposals Team. Contact them to update scope or quotations.</div>
    <div class="sbox">
      <div class="sbox-title">Scope of Work</div>
      <div style="font-size:13px;color:#222;line-height:1.8;min-height:60px">${prop.scopeHtml || "<span style='color:#aaa;font-size:12px'>No scope entered yet.</span>"}</div>
    </div>
    ${reapps.length ? `<div class="reapp-box">
      <div class="reapp-box-title">🔄 Re-approval Quotations</div>
      ${reapps.map((r, ri) => `<div class="reapp-entry">
        <div class="reapp-entry-num">RE-APPROVAL #${ri + 1}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:8px">
          <div><div class="fl">Title</div><div style="font-size:12px">${esc(r.title || "—")}</div></div>
          <div><div class="fl">Quotation No.</div><div style="font-size:12px;color:#1a5276;font-weight:600">${esc(r.quotationNumber || "—")}</div></div>
          <div><div class="fl">Value (AED)</div><div style="font-size:12px;color:#166a3f;font-weight:600">${r.value ? "AED " + esc(r.value) : "—"}</div></div>
        </div>
        ${r.scopeHtml ? `<div style="font-size:12px;color:#333;line-height:1.7;background:#fdf8f5;padding:10px 12px;border-radius:8px">${r.scopeHtml}</div>` : ""}
      </div>`).join("")}
    </div>` : ""}`;

  // ── Stages tab ────────────────────────────────────────────
  } else if (S.tab === "stages") {
    const commonOpts = commonStageOptions();
    h += `<div class="sbox">
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
    d.stages.forEach((st, i) => { h += seRow(st, i, d.stages.length); });
    h += `<div class="btn-add btn-add-prep" onclick="addDrawingPrepStage()">+ Add Drawing Preparation Stage</div>
    <div class="btn-add btn-add-approval" onclick="addDrawingApprovalStage()">+ Add Drawing Approval Stage</div></div>`;

  // ── LPO / Payments tab ────────────────────────────────────
  } else if (S.tab === "lpo") {
    h += renderLpoTab();

  // ── Docs tab ──────────────────────────────────────────────
  } else if (S.tab === "docs") {
    h += `<div class="sbox"><div class="sbox-title">Standard Document Groups</div>`;
    d.docs.forEach((g, gi) => { if (g.fb) return; h += degRow(g, gi, false); });
    h += `<div class="btn-add" onclick="PROJ.docs.push({group:'New Group',fb:false,items:[]});render()">+ Add Document Group</div></div>`;
    h += `<div class="sbox sbox-fb"><div class="sbox-title sbox-title-fb">F&amp;B / Gas Documents
      <span style="font-size:9px;background:#fde8d8;color:#a04800;padding:1px 7px;border-radius:8px;margin-left:4px">${fb ? "VISIBLE TO CLIENT" : "HIDDEN"}</span>
    </div>`;
    d.docs.forEach((g, gi) => { if (!g.fb) return; h += degRow(g, gi, true); });
    h += `<div class="btn-add" style="border-color:#e8a060;color:#a04800"
      onclick="PROJ.docs.push({group:'New F&amp;B/Gas Group',fb:true,items:[]});render()">+ Add F&amp;B/Gas Group</div></div>`;

  // ── Activity Log tab ──────────────────────────────────────
  } else if (S.tab === "activity") {
    const logs = [...(d.activityLog || []).map(l => ({ ...l, _kind: "stage" })),
                  ...(d.proposalLog || []).map(l => ({ ...l, _kind: "proposal" }))]
                  .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
    h += `<div class="sbox">
      <div class="sbox-title">Activity Log <span style="font-size:10px;color:#bbb;font-weight:400;margin-left:6px">${logs.length} entries</span></div>
      ${!logs.length ? `<div style="text-align:center;padding:20px;color:#bbb;font-size:13px">No activity recorded yet.</div>` : ""}
      ${logs.map(log => {
        if (log._kind === "proposal") return `<div class="act-row">
          <div class="act-dot" style="background:#7c3aed"></div>
          <div class="act-body">
            <div class="act-stage">📋 ${esc(log.action || "Proposal Update")}</div>
            <div class="act-detail">${log.by ? `<strong>${esc(log.by)}</strong>` : ""}${log.detail ? ` · ${esc(log.detail)}` : ""}</div>
          </div>
          <div class="act-time">${fmtDateTime(log.at)}</div>
        </div>`;
        const disp = STATUS_DISPLAY[log.newStatus || ""] || STATUS_DISPLAY[""];
        return `<div class="act-row">
          <div class="act-dot ${actDotCls(log.newStatus || "")}"></div>
          <div class="act-body">
            <div class="act-stage">${esc(log.stageName || "")}</div>
            <div class="act-detail">→ <span class="badge ${disp.cls}">${disp.label}</span>${log.by ? ` · <strong>${esc(log.by)}</strong>` : ""}</div>
            ${log.note ? `<div class="act-detail" style="font-style:italic">"${esc(log.note)}"</div>` : ""}
          </div>
          <div class="act-time">${fmtDateTime(log.at)}</div>
        </div>`;
      }).join("")}
    </div>`;
  }

  h += `</div>`;
  return h;
}

// ── Modals ────────────────────────────────────────────────────
function renderModals() {
  let overlay = "";
  if (S.modal === "showlink" && PROJ) {
    const link = projectLink(PROJ.id);
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
function _canAddLpo()  { return ["coordinator","super_admin"].includes(_role()); }
function _canCredit()  { return ["account","super_admin"].includes(_role()); }

function renderLpoTab() {
  if (!PROJ) return "";
  if (!Array.isArray(PROJ.lpos)) PROJ.lpos = [];
  const t = lpoTotals(PROJ.lpos);

  let h = `<div class="sbox">
    <div class="sbox-title">LPO / Milestone Payments
      <span style="font-size:10px;font-weight:400;color:#bbb;margin-left:6px">Coordinator enters all LPOs (first = advance, as advised by Proposals) · credited status by Accounts</span>
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
            oninput="PROJ.lpos[${i}].amount=parseFloat(this.value)||0;render()"/>
        </div>
        <div class="lpo-field">
          <div class="fl">Date Raised</div>
          <input class="fi" type="date" value="${esc(l.dateRaised||"")}" ${_canAddLpo()?"":"disabled"}
            oninput="PROJ.lpos[${i}].dateRaised=this.value"/>
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
            onchange="PROJ.lpos[${i}].status=this.value; if(this.value==='credited'&&!PROJ.lpos[${i}].creditedDate){PROJ.lpos[${i}].creditedDate=new Date().toISOString().slice(0,10);} render()">
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
      <div class="lpo-foot">
        <span class="lpo-meta">${l.raisedBy?`Raised by ${esc(l.raisedBy)}${l.raisedByRole?` (${esc(l.raisedByRole)})`:""}`:""}</span>
        ${_canAddLpo()||_canCredit()?`<button class="btn btn-sm btn-red" onclick="removeLpo(${i})">Remove</button>`:""}
      </div>
    </div>`;
  });

  if (_canAddLpo()) {
    const isFirst = PROJ.lpos.length === 0;
    h += `<button class="btn btn-gold" style="margin-top:12px" onclick="addLpo()">
      + Add ${isFirst ? "First LPO (Advance)" : "LPO"}</button>`;
  }
  h += `<div style="margin-top:10px;font-size:11px;color:#999">Remember to press <b>Save</b> (top right) to store changes.</div>`;
  h += `</div>`;
  return h;
}

function addLpo() {
  if (!_canAddLpo()) { alert("You don't have permission to add LPOs."); return; }
  if (!Array.isArray(PROJ.lpos)) PROJ.lpos = [];
  const seed = PROJ.lpos.length === 0 ? "Advance" : "";
  PROJ.lpos.push(blankLPO(seed));
  render();
}
function removeLpo(i) {
  if (!confirm("Remove this LPO entry?")) return;
  PROJ.lpos.splice(i, 1);
  render();
}
