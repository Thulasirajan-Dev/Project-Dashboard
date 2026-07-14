// ============================================================
//  Winner Holistic Consultants – Coordinator Module
//  coordinator/coordinator.js
//  Depends on: shared/shared.js loaded first
// ============================================================

var STAGE_NAMES = [
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


// ── Drag state ────────────────────────────────────────────────
var _dragSrc = null;
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
var _projSnapshot = null;   // pristine copy taken when a project is opened (for diffing)
async function saveProj() {
  if (!PROJ) return; S.saving = true; render();
  const isEdit = !!PROJ.createdAt;
  const snapshot = _projSnapshot;
  stampAudit(PROJ, isEdit);
  syncWorkflowStatus(PROJ);
  const ok = await saveProjectDiff(PROJ.id, snapshot, PROJ);
  if (ok) {
    await logProjectChanges("Coordinator", isEdit ? snapshot : null, PROJ, PROJ.project?.title || PROJ.id);
    _projSnapshot = JSON.parse(JSON.stringify(PROJ));
    ALL_PROJECTS[PROJ.id] = PROJ;
  }
  S.saving = false; S.saved = ok; render();
  setTimeout(() => { S.saved = false; render(); }, 2500);
}
async function openProject(id) {
  document.getElementById("app").innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  // Fetch fresh (bypass the 15s client cache) so the snapshot used for the
  // diff-based save above reflects the true current state, not something
  // another user may have already changed moments ago.
  const data = await fbGet(coPath("projects/" + id), { fresh: true });
  if (data) {
    PROJ = migrateProject(data);
    _projSnapshot = JSON.parse(JSON.stringify(PROJ));
    ALL_PROJECTS[id] = PROJ; // keep the list view in sync with what we just fetched
    S.authedCoord = true; S.mode = "coord"; S.tab = "proj"; render();
  }
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
  const curColor = stageStatusColor(curStatus);
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
        <select class="se-sel" style="background:${curColor.bg};color:${curColor.color};border-color:${curColor.border};font-weight:600" onchange="stageStatusChange(${i},this.value)">
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
    const dc = documentStatusColor(item.status);
    h += `<div class="die-r">
      <select class="die-sel" style="background:${dc.bg};color:${dc.color};border-color:${dc.border};font-weight:600" onchange="PROJ.docs[${gi}].items[${ii}].status=this.value;render()">
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

// Manual refresh — ALL_PROJECTS is otherwise only loaded once at boot and
// never updated again for the rest of the session, so anything another
// user (Proposals/Account/another Coordinator) changes elsewhere won't
// show up here until this runs (or the page is reloaded).
async function reloadAllProjects() {
  S.refreshing = true; render();
  try {
    ALL_PROJECTS = (await fbGet(coPath("projects"), { fresh: true })) || {};
    Object.keys(ALL_PROJECTS).forEach(id => { ALL_PROJECTS[id] = migrateProject(ALL_PROJECTS[id]); });
  } catch (e) {}
  S.refreshing = false; render();
}

// ── Coordinator top-menu stat definitions ───────────────────────
// Total: every project. Open: no coordinator assigned yet. Allocated: has
// one. Hold: manually marked On Hold or Cancelled, overriding normal
// progress. Attention: a stage's own "N working days" estimate has elapsed
// without being completed. Completed: EVERY approval stage AND EVERY
// payment milestone is done — not just stages, which is what "done" used
// to mean.
function _projIsUnassigned(p) {
  return !(((p.project && p.project.coordinator) || "").trim());
}
// A stage is overdue if its free-text "time" estimate (e.g. "5 working
// days") has elapsed since dateA (when that stage started) and it still
// isn't complete. Working days = calendar days excluding Saturday/Sunday
// — the app has no holiday calendar, so that's the best approximation
// available.
function _stageIsOverdue(st) {
  if (!st || !st.dateA || !st.time || isStageComplete(st)) return false;
  const m = String(st.time).match(/(\d+)/);
  const days = m ? parseInt(m[1], 10) : 0;
  if (!days) return false;
  const start = new Date(st.dateA + "T00:00:00");
  if (isNaN(start.getTime())) return false;
  let counted = 0, d = new Date(start);
  while (counted < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay(); // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) counted++;
  }
  return new Date() > d;
}
function _projNeedsAttention(p) {
  return (p.stages || []).some(_stageIsOverdue);
}
// Fully complete = every approval stage done AND every payment milestone
// credited. A project with no stages, or no milestones yet, can't be
// "Completed" — there's nothing to confirm as finished. On-hold/cancelled
// projects have their own tile and don't also count here.
function _projIsFullyComplete(p) {
  if (isProjectOnHold(p)) return false;
  const stages = p.stages || [];
  const stagesDone = stages.length > 0 && stages.every(s => isStageComplete(s));
  const allMs = [];
  (p.quotationGroups || []).forEach(g => (g.milestones || []).forEach(m => { if (!m.isCompletedScopePayment) allMs.push(m); }));
  const milestonesDone = allMs.length > 0 && allMs.every(m => accountStatus(m) === "Credited");
  return stagesDone && milestonesDone;
}
function _matchesCoordStatusFilter(p, key) {
  switch (key) {
    case "open":       return _projIsUnassigned(p);
    case "allocated":  return !_projIsUnassigned(p);
    case "hold":        return isProjectOnHold(p);
    case "attention":  return _projNeedsAttention(p);
    case "completed":  return _projIsFullyComplete(p);
    default:           return true; // "all"
  }
}

// ── Render coordinator project list ──────────────────────────
function renderCoordList() {
  const role = _role();
  const isSuper = (CURRENT_USER && CURRENT_USER.role === "super_admin");
  const isTeamLead = (role === "team_lead");
  // Team Lead and Super Admin see EVERY project (including unassigned "open"
  // items) and can narrow down with the filters below. A plain Coordinator
  // only ever sees projects assigned to them — never another coordinator's
  // work, and never the unassigned pool (that's Team Lead's job to triage
  // and assign). See CAPABILITIES["coordinator.viewAllProjects"] in
  // shared/permissions.js.
  const canSeeAll = can("coordinator.viewAllProjects", role);
  const meEmail = (CURRENT_USER && CURRENT_USER.email) || "";
  const meName  = (CURRENT_USER && CURRENT_USER.name) || "";
  const myProjects = canSeeAll
    ? Object.values(ALL_PROJECTS)
    : Object.values(ALL_PROJECTS).filter(p => {
        const oc = (p.project && p.project.coordinator) || "";
        return oc && (oc === meEmail || oc === meName);
      });

  let filtered = myProjects.filter(p => {
    const pr = p.project || {}, prop = p.proposal || {};
    if (S.coordFilterStatus !== "all" && !_matchesCoordStatusFilter(p, S.coordFilterStatus)) return false;
    if (canSeeAll && S.coordFilterOwner && S.coordFilterOwner !== "all") {
      const oc = (pr.coordinator || "");
      // Match whether the filter holds an email or a name.
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

  const totalMy = myProjects.length;
  const openMy       = myProjects.filter(_projIsUnassigned).length;
  const allocMy       = myProjects.filter(p => !_projIsUnassigned(p)).length;
  const holdMy         = myProjects.filter(isProjectOnHold).length;
  const attnMy         = myProjects.filter(_projNeedsAttention).length;
  const completedMy    = myProjects.filter(_projIsFullyComplete).length;

  return `
  <div class="cbar">
    <div class="clabel">⚙ ${canSeeAll ? (isTeamLead ? "All Projects – Team Lead" : role==="management" ? "All Projects – Management (view only)" : "All Projects – Coordinator") : "My Projects" + (S.coordName ? ` (${esc(S.coordName)})` : "")}</div>
    <button class="btn btn-sm" style="background:rgba(255,255,255,0.12);color:#fff;margin-left:auto" onclick="reloadAllProjects()" title="Pull the latest data — e.g. after Proposals submits an edit elsewhere" ${S.refreshing?"disabled":""}>${S.refreshing?"⏳":"↻"} Refresh</button>
    ${(CURRENT_USER&&CURRENT_USER.role==="super_admin")?`<button class="btn btn-sm" style="background:rgba(227,196,104,0.25);color:#e3c468;font-weight:600;margin-left:8px"
      onclick="openActivityLog('Coordinator')">🕘 Log</button>`:""}
  </div>
  <div style="background:var(--surface);padding:14px 18px;border-bottom:1px solid var(--border)">
    ${renderStatTiles([
      { n: totalMy,     l: "Total",     icon: "📁", c: "#0d2137", f: "all",       title: "Every project",       active: S.coordFilterStatus==="all",       onclick: "S.coordFilterStatus='all';render()" },
      { n: openMy,      l: "Open",      icon: "🔓", c: "#e0a000", f: "open",      title: "No coordinator assigned yet", active: S.coordFilterStatus==="open",      onclick: "S.coordFilterStatus='open';render()" },
      { n: allocMy,     l: "Allocated", icon: "👤", c: "#0369a1", f: "allocated", title: "Assigned to a coordinator",   active: S.coordFilterStatus==="allocated", onclick: "S.coordFilterStatus='allocated';render()" },
      { n: attnMy,      l: "Attention", icon: "⚠️", c: "#e24b4a", f: "attention", title: "A stage's working-days estimate has elapsed", active: S.coordFilterStatus==="attention", onclick: "S.coordFilterStatus='attention';render()" },
      { n: holdMy,      l: "Hold",      icon: "⏸️", c: "#a32d2d", f: "hold",      title: "On Hold or Cancelled", active: S.coordFilterStatus==="hold",      onclick: "S.coordFilterStatus='hold';render()" },
      { n: completedMy, l: "Completed", icon: "✅", c: "#166a3f", f: "completed", title: "Every stage AND every milestone is done", active: S.coordFilterStatus==="completed", onclick: "S.coordFilterStatus='completed';render()" }
    ])}
  </div>
  <div class="coord-search-bar">
    ${canSeeAll ? `<div style="display:inline-flex;border:1px solid #d6d9e2;border-radius:8px;overflow:hidden;flex-shrink:0">
      <button onclick="S.coordFilterOwner='all';render()" style="border:none;padding:7px 12px;font-size:12px;font-weight:600;cursor:pointer;background:${(!S.coordFilterOwner||S.coordFilterOwner==='all')?'#0d2137':'#fff'};color:${(!S.coordFilterOwner||S.coordFilterOwner==='all')?'#fff':'#555'}">All (incl. unassigned)</button>
      ${S.coordName ? `<button onclick="S.coordFilterOwner='${esc(S.coordName)}';render()" style="border:none;border-left:1px solid #d6d9e2;padding:7px 12px;font-size:12px;font-weight:600;cursor:pointer;background:${S.coordFilterOwner===S.coordName?'#0d2137':'#fff'};color:${S.coordFilterOwner===S.coordName?'#fff':'#555'}">Owned by me</button>` : ""}
    </div>` : ""}
    <input class="coord-search-input" id="coord-search" placeholder="Search by project, client, unit, location..."
      value="${esc(S.coordSearch || "")}" oninput="S.coordSearch=this.value;render();_refocusSearch('coord-search')"/>
    ${canSeeAll ? `<select class="coord-filter-sel" onchange="S.coordFilterOwner=this.value;render()" title="Filter by owner / coordinator">
      <option value="all">All Owners</option>
      ${(!isSuper && !isTeamLead && S.coordName) ? `<option value="${esc(S.coordName)}" ${S.coordFilterOwner === S.coordName ? "selected" : ""}>My projects (${esc(S.coordName)})</option>` : ""}
      ${Array.from(new Set(Object.values(ALL_PROJECTS).map(p => (p.project&&p.project.coordinator)||"").filter(Boolean))).sort((a,b)=>a.localeCompare(b)).map(o =>
        `<option value="${esc(o)}" ${S.coordFilterOwner === o ? "selected" : ""}>${esc(_coordLabel(o))}</option>`).join("")}
    </select>` : ""}
    <select class="coord-filter-sel" onchange="S.coordFilterStatus=this.value;render()">
      <option value="all">All Status</option>
      ${["open","allocated","hold","attention","completed"].map(v =>
        `<option value="${v}" ${S.coordFilterStatus === v ? "selected" : ""}>${{open:"Open",allocated:"Allocated",hold:"Hold",attention:"Attention",completed:"Completed"}[v]}</option>`
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
  <div style="padding:8px 18px 2px;font-size:12px;color:var(--text-muted)">
    ${canSeeAll ? ((S.coordFilterOwner&&S.coordFilterOwner!=="all") ? `Projects for <strong>${esc(S.coordFilterOwner)}</strong>` : "All projects (including unassigned)") : (S.coordName ? `Your assigned projects (<strong>${esc(S.coordName)}</strong>)` : "Your assigned projects")} — ${filtered.length} found
  </div>
  <div style="padding:0 18px 16px">
    ${!filtered.length ? `<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px">${canSeeAll ? "No projects match your filters." : "No projects are assigned to you yet."}</div>` : ""}
    ${filtered.map(p => {
      const pr = p.project || {}, pc = projPct(p), st = projStatus(p);
      const msPct = awardedScopeProgress(p);
      const cCls = { done:"chip-done", active:"chip-active", allocated:"chip-allocated", hold:"chip-not-approved", cancelled:"chip-not-approved" }[st] || "chip-new";
      const cTxt = { done:"Completed", active:"In Progress", allocated:"Allocated", hold:"On Hold", cancelled:"Cancelled" }[st] || "Not Started";
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
              <span class="status-chip" style="background:var(--surface-2);color:#666">${esc(natureDisplay(pr.unitType))}</span>
              ${activeStage ? `<span class="status-chip" style="background:#eef4ff;color:#1a3a5c;font-size:10px">📍 ${esc(activeStage.name)}</span>` : ""}
              ${reapps.length ? `<span class="status-chip" style="background:#fde8d8;color:#a04800">🔄 ${reapps.length} Re-approval(s)</span>` : ""}
              ${attnCount ? `<span class="status-chip" style="background:#fde8e8;color:#a32d2d">⚠ ${attnCount} blocked</span>` : ""}
            </div>
          </div>
          <div style="display:flex;gap:14px;align-items:flex-start">
            <div class="proj-row-right">
              <div class="proj-pct" title="Approval stage progress">${pc}%</div>
              <div class="mini-bar-bg"><div class="mini-bar-fill" style="width:${pc}%"></div></div>
              <div style="font-size:8px;color:var(--text-muted);text-align:right;margin-top:1px">STAGES</div>
            </div>
            ${msPct !== null ? `<div class="proj-row-right">
              <div class="proj-pct" style="color:#1d9e75" title="Milestone value credited">${msPct}%</div>
              <div class="mini-bar-bg"><div class="mini-bar-fill" style="width:${msPct}%;background:#1d9e75"></div></div>
              <div style="font-size:8px;color:var(--text-muted);text-align:right;margin-top:1px">MILESTONES</div>
            </div>` : ""}
          </div>
        </div>
      </div>`;
    }).join("")}
  </div>
  <div class="footer">Winner Holistic Consultants · Coordinator · <a href="#" style="color:var(--text-muted)" onclick="event.preventDefault();serverLogout().then(()=>window.location.href='/auth/')">Logout</a></div>`;
}

// ── Render coordinator project editor ─────────────────────────
function awardedScopeProgress(proj) {
  // Milestone value progress = total CREDITED milestone value ÷ total
  // milestone value across every quotation group, both computed live from
  // contractTotal × pct (same as everywhere else) — not the legacy p.lpos
  // array, which the real award/submission pipeline never populates.
  // Completed Scope Payment rows are deliberately excluded — they're a
  // closeout payment for Hold/Cancelled projects, not part of normal
  // progress, and would distort this percentage.
  if (!proj || !Array.isArray(proj.quotationGroups) || !proj.quotationGroups.length) return null;
  let total = 0, credited = 0;
  proj.quotationGroups.forEach(g => {
    const gt = g.contractTotal || 0;
    (g.milestones || []).forEach(m => {
      if (m.isCompletedScopePayment) return;
      const amt = milestoneAmount(m, gt);
      total += amt;
      if (accountStatus(m) === "Credited") credited += amt;
    });
  });
  if (total <= 0) return null;
  return Math.min(100, Math.round((credited / total) * 100));
}

// Put a project on Hold or Cancelled, or clear it back to normal workflow —
// a manual override independent of stage/milestone progress. If there's
// completed but unbilled work, the coordinator should raise a "Completed
// Scope Payment" (see _addSpecialInvoiceRow) BEFORE marking it Hold/
// Cancelled, but this doesn't hard-block the status change either way —
// it's a workflow enabler, not a gate.
async function setProjectHoldStatus(value) {
  if (!PROJ) return;
  if (value) {
    const label = value === "hold" ? "On Hold" : "Cancelled";
    if (!confirm(`Mark this project as ${label}?\n\nThis is independent of stage/milestone progress — if there's completed work that hasn't been invoiced yet, consider raising a "Completed Scope Payment" first (Scope & Quotations tab).`)) { render(); return; }
  }
  PROJ.holdStatus = value || null;
  const who = (typeof currentActor === "function") ? currentActor() : {};
  PROJ.holdStatusAt = value ? new Date().toISOString() : null;
  PROJ.holdStatusBy = value ? (who.name || who.email || "") : "";
  render();
  try {
    await fbSet(coPath("projects/" + PROJ.id + "/holdStatus"), PROJ.holdStatus);
    await fbSet(coPath("projects/" + PROJ.id + "/holdStatusAt"), PROJ.holdStatusAt);
    await fbSet(coPath("projects/" + PROJ.id + "/holdStatusBy"), PROJ.holdStatusBy);
  } catch (e) {}
}

// ── Dependent Tasks ───────────────────────────────────────────
async function loadDependentTasks() {
  S.tab = "deptasks"; render();
  S._depTasks = await getDependentTasksForProject(PROJ.id);
  render();
}

function _dtToggleExpand(i) {
  S._dtExpandedIdx = (S._dtExpandedIdx === i) ? null : i;
  render();
}

function renderDependentTasksTab(d) {
  const tasks = S._depTasks || [];
  const canRaise = ["coordinator", "team_lead", "proposals", "super_admin"].includes(_role());
  let h = `<div class="sbox">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px">
      <div class="sbox-title" style="margin-bottom:0">Dependent Tasks <span style="font-weight:400;color:var(--text-muted);text-transform:none;letter-spacing:0">— cross-department items this project is waiting on</span></div>
      ${canRaise ? `<button class="btn btn-sm btn-gold" onclick="openDepTaskModal()">+ Raise Task</button>` : ""}
    </div>
  </div>`;

  if (!tasks.length) {
    h += `<div class="sbox" style="text-align:center;padding:30px;color:var(--text-muted);font-size:13px">No dependent tasks raised for this project yet.</div>`;
    return h;
  }

  h += `<div class="sbox" style="padding:0">`;
  tasks.forEach((t, i) => {
    const sty = DEP_TASK_STATUS_STYLE[t.status] || DEP_TASK_STATUS_STYLE.New;
    const psty = DEP_TASK_PRIORITY_STYLE[t.priority] || DEP_TASK_PRIORITY_STYLE.Medium;
    const overdue = t.dueDate && t.status !== "Resolved" && t.status !== "Closed" && new Date(t.dueDate) < new Date(new Date().toDateString());
    const expanded = S._dtExpandedIdx === i;
    h += `<div style="border-bottom:1px solid #f0f0f3">
      <div style="padding:14px 16px;cursor:pointer" onclick="_dtToggleExpand(${i})">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
          <div style="flex:1;min-width:220px">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-family:'SF Mono',Consolas,Menlo,monospace;font-size:11px;font-weight:700;color:#5b3df5;background:#eef0ff;padding:1px 8px;border-radius:6px">${esc(t.taskNumber||"—")}</span>
              <span style="font-weight:700;font-size:13.5px;color:#1a2740">${esc(t.title||"Untitled task")}</span>
              <span style="font-size:10px;color:var(--text-muted)">${expanded?"▾":"▸"}</span>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:6px">
              🏢 ${esc(t.assignmentGroup || t.assignee || "—")}${t.assignedTo?` → 👤 ${esc(_coordLabel?_coordLabel(t.assignedTo):t.assignedTo)}`:""}
              <span style="margin:0 5px">·</span>
              <span style="font-weight:600;padding:1px 7px;border-radius:8px;background:${psty.bg};color:${psty.color}">${esc(t.priority||"Medium")}</span>
              ${t.dueDate ? `<span style="margin:0 5px">·</span><span style="color:${overdue?'#a32d2d':'#999'};font-weight:${overdue?700:400}">${overdue?'⚠ Overdue: ':'Due '}${esc(fmtDate(t.dueDate))}</span>` : ""}
              <span style="margin:0 5px">·</span>
              <span>Raised by ${esc(t.raisedByName || t.raisedBy || "—")}${t.raisedModule ? " (" + esc(t.raisedModule) + ")" : ""}</span>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0" onclick="event.stopPropagation()">
            <select class="fi" style="width:150px;margin:0;font-size:12px;background:${sty.bg};color:${sty.color};border-color:${sty.color};font-weight:600" onchange="_dtUpdateStatus(${i},this.value)">
              ${DEP_TASK_STATUSES.map(s => `<option value="${s}" ${t.status===s?"selected":""}>${sty.icon&&s===t.status?sty.icon+" ":""}${s}</option>`).join("")}
            </select>
            <div style="width:150px;display:flex;align-items:center;gap:6px">
              <div style="flex:1;height:6px;background:#eef0f3;border-radius:4px;overflow:hidden"><div style="height:100%;width:${t.progressPct||0}%;background:${sty.color}"></div></div>
              <span style="font-size:10px;color:var(--text-muted);width:28px;text-align:right">${t.progressPct||0}%</span>
            </div>
          </div>
        </div>
      </div>
      ${expanded ? renderDepTaskDetail(t, i) : ""}
    </div>`;
  });
  h += `</div>`;
  return h;
}

// Expanded ticket detail — description, reassignment, and the work notes
// thread (ServiceNow-style activity feed on the ticket).
function renderDepTaskDetail(t, i) {
  const notes = Array.isArray(t.workNotes) ? t.workNotes : [];
  const history = Array.isArray(t.statusHistory) ? t.statusHistory : [];
  const users = (typeof COORDINATOR_USERS !== "undefined" ? COORDINATOR_USERS : []);
  return `<div style="background:var(--surface-2);padding:16px;border-top:1px solid var(--border-soft)" onclick="event.stopPropagation()">
    ${t.description ? `<div style="font-size:12.5px;color:#444;margin-bottom:14px;line-height:1.5">${esc(t.description)}</div>` : ""}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div>
        <div class="fl">Assignment Group</div>
        <select class="fi" style="font-size:12px" onchange="_dtReassignGroup(${i},this.value)">
          ${DEP_TASK_DEPARTMENTS.map(dep => `<option value="${esc(dep)}" ${(t.assignmentGroup||t.assignee)===dep?"selected":""}>${esc(dep)}</option>`).join("")}
        </select>
      </div>
      <div>
        <div class="fl">Assigned To</div>
        <select class="fi" style="font-size:12px" onchange="_dtReassignTo(${i},this.value)">
          <option value="">— Unassigned —</option>
          ${users.map(u => `<option value="${esc(u.email||u.name)}" ${t.assignedTo===(u.email||u.name)?"selected":""}>${esc(u.name)}</option>`).join("")}
        </select>
      </div>
    </div>
    <div style="font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Work Notes</div>
    <div style="max-height:180px;overflow-y:auto;margin-bottom:8px">
      ${notes.length ? notes.slice().reverse().map(n => `<div style="background:var(--surface);border:1px solid var(--border-soft);border-radius:8px;padding:8px 10px;margin-bottom:6px">
        <div style="font-size:11px;color:#5b3df5;font-weight:700">${esc(n.by||"—")} <span style="color:var(--text-muted);font-weight:400">· ${esc(fmtLogTime?fmtLogTime(n.at):n.at||"")}</span></div>
        <div style="font-size:12px;color:var(--text);margin-top:3px">${esc(n.note||"")}</div>
      </div>`).join("") : `<div style="font-size:11px;color:var(--text-muted);padding:8px 0">No notes yet.</div>`}
    </div>
    <div style="display:flex;gap:6px;margin-bottom:14px">
      <input class="fi" id="dt-note-${i}" style="font-size:12px" placeholder="Add a work note…" onkeydown="if(event.key==='Enter'){event.preventDefault();_dtAddNote(${i})}"/>
      <button class="btn btn-sm btn-gold" onclick="_dtAddNote(${i})">Post</button>
    </div>
    ${history.length ? `<div style="font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Status History</div>
      <div style="font-size:11px;color:var(--text-muted)">
        ${history.map(hh => `<div style="padding:2px 0">${esc(fmtLogTime?fmtLogTime(hh.at):hh.at||"")} — <b>${esc(hh.status)}</b> by ${esc(hh.by||"—")}</div>`).join("")}
      </div>` : ""}
  </div>`;
}

async function _dtReassignGroup(idx, group) {
  const t = (S._depTasks || [])[idx];
  if (!t) return;
  try {
    const existing = await _dataCall("get", "dependent_tasks/" + t.id, null);
    if (existing) {
      existing.assignmentGroup = group; existing.assignee = group;
      await fbSet("dependent_tasks/" + t.id, existing);
    }
  } catch (e) {}
  S._depTasks = await getDependentTasksForProject(PROJ.id);
  render();
}
async function _dtReassignTo(idx, userVal) {
  const t = (S._depTasks || [])[idx];
  if (!t) return;
  await assignDependentTaskTo(t.id, userVal);
  S._depTasks = await getDependentTasksForProject(PROJ.id);
  render();
}
async function _dtAddNote(idx) {
  const t = (S._depTasks || [])[idx];
  const el = document.getElementById("dt-note-" + idx);
  const note = el?.value || "";
  if (!t || !note.trim()) return;
  const ok = await addDependentTaskNote(t.id, note);
  if (!ok) { alert("Could not post note. Try again."); return; }
  S._depTasks = await getDependentTasksForProject(PROJ.id);
  render();
}

async function _dtUpdateStatus(idx, newStatus) {
  const t = (S._depTasks || [])[idx];
  if (!t) return;
  const progressPct = (newStatus === "Resolved" || newStatus === "Closed") ? 100
    : (t.progressPct || (newStatus === "In Progress" ? 50 : t.progressPct));
  const ok = await updateDependentTaskStatus(t.id, newStatus, progressPct);
  if (!ok) { alert("Could not update. Try again."); }
  S._depTasks = await getDependentTasksForProject(PROJ.id);
  render();
}

// ── Raise Dependent Task modal (ServiceNow-style: Assignment Group +
// optional Assigned To) ──────────────────────────────────────
function openDepTaskModal() {
  S._dtGroup = "";
  S.modal = "deptask"; render();
}
function closeDepTaskModal() { S.modal = null; render(); }
function _dtSetGroup(g) { S._dtGroup = g; render(); }

function renderDepTaskModal() {
  const group = S._dtGroup || "";
  const users = (typeof COORDINATOR_USERS !== "undefined" ? COORDINATOR_USERS : []);
  // Suggest people tagged with this team first (see the Team field added to
  // Manage Users), but don't hard-block picking anyone else — the team tag
  // is a helpful default, not a strict boundary.
  const teamUsers = group ? users.filter(u => u.team === group) : [];
  const otherUsers = group ? users.filter(u => u.team !== group) : users;
  return `<div class="overlay" onclick="if(event.target===this)closeDepTaskModal()">
    <div class="modal" data-vo-safe style="max-width:460px;text-align:left;max-height:88vh;overflow-y:auto">
      <div style="font-weight:700;font-size:15px;margin-bottom:14px">🔗 Raise Dependent Task</div>
      <div class="fl">Task Title <span class="req-star">*</span></div>
      <input class="fi" id="dt-title" placeholder="e.g. Confirm structural loading calculation" style="margin-bottom:10px"/>
      <div class="fl">Description</div>
      <textarea class="fi" id="dt-desc" rows="3" style="margin-bottom:10px" placeholder="Optional — what's needed and why"></textarea>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div><div class="fl">Priority</div>
          <select class="fi" id="dt-priority">${DEP_TASK_PRIORITIES.map(p => `<option ${p==="Medium"?"selected":""}>${p}</option>`).join("")}</select>
        </div>
        <div><div class="fl">Due Date</div><input class="fi" type="date" id="dt-due"/></div>
      </div>
      <div class="fl">Assignment Group <span class="req-star">*</span></div>
      <select class="fi" id="dt-group" style="margin-bottom:10px" onchange="_dtSetGroup(this.value)">
        <option value="">— Select a team —</option>
        ${DEP_TASK_DEPARTMENTS.map(dep => `<option value="${esc(dep)}" ${group===dep?"selected":""}>${esc(dep)}</option>`).join("")}
      </select>
      <div class="fl">Assigned To <span style="font-weight:400;color:var(--text-muted)">— optional, a specific person on that team</span></div>
      <select class="fi" id="dt-assignedto" style="margin-bottom:6px">
        <option value="">— Unassigned (goes to the whole team) —</option>
        ${teamUsers.length ? `<optgroup label="${esc(group)} team">${teamUsers.map(u => `<option value="${esc(u.email||u.name)}">${esc(u.name)}</option>`).join("")}</optgroup>` : ""}
        ${otherUsers.length ? `<optgroup label="${teamUsers.length?"Other people":"People"}">${otherUsers.map(u => `<option value="${esc(u.email||u.name)}">${esc(u.name)}</option>`).join("")}</optgroup>` : ""}
      </select>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button type="button" class="btn" style="flex:1;background:#f3f3f7;color:var(--text)" onclick="closeDepTaskModal()">Cancel</button>
        <button type="button" class="btn btn-gold" style="flex:1" onclick="_submitDepTask()">Raise Task</button>
      </div>
    </div>
  </div>`;
}

async function _submitDepTask() {
  const title = (document.getElementById("dt-title")?.value || "").trim();
  if (!title) { alert("Give the task a title."); return; }
  const assignmentGroup = document.getElementById("dt-group")?.value || "";
  if (!assignmentGroup) { alert("Choose an Assignment Group."); return; }
  const fields = {
    title,
    description: document.getElementById("dt-desc")?.value || "",
    priority: document.getElementById("dt-priority")?.value || "Medium",
    dueDate: document.getElementById("dt-due")?.value || "",
    assignmentGroup,
    assignedTo: document.getElementById("dt-assignedto")?.value || "",
    raisedModule: "Coordinator",
  };
  const id = await createDependentTask(PROJ.id, fields);
  if (!id) { alert("Could not save. Try again."); return; }
  S.modal = null;
  S._depTasks = await getDependentTasksForProject(PROJ.id);
  render();
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
      ${["coordinator","team_lead","super_admin"].includes(_role())
        ? `<select class="fi" style="width:135px;margin:0;font-size:11px" onchange="setProjectHoldStatus(this.value)" title="Put this project on hold or mark it cancelled, independent of stage/milestone progress">
            <option value="" ${!d.holdStatus?"selected":""}>▶ Active workflow</option>
            <option value="hold" ${d.holdStatus==="hold"?"selected":""}>⏸ On Hold</option>
            <option value="cancelled" ${d.holdStatus==="cancelled"?"selected":""}>🚫 Cancelled</option>
          </select>`
        : (d.holdStatus ? `<span class="status-chip" style="background:#fde8e8;color:#a32d2d">${d.holdStatus==='hold'?'⏸ On Hold':'🚫 Cancelled'}</span>` : "")}
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
      <button class="btn btn-sm" style="background:var(--surface-2);color:var(--text-muted)" onclick="window.open('${link}','_blank')">Open Tab</button>
      <button class="btn btn-sm btn-red" onclick="S.modal='delproj';render()">Delete</button>
    </div>
  </div>
  <div class="tabs">
    <div class="tab ${S.tab==="proj"?"on":""}"      onclick="S.tab='proj';render()">Project Info</div>
    <div class="tab ${S.tab==="scope"?"on":""}"     onclick="S.tab='scope';render()">Scope &amp; Quotations${(PROJ.revisions||[]).filter(r=>r.status==="Requested").length?` <span style="background:#e67e22;color:#fff;font-size:9px;font-weight:700;padding:1px 6px;border-radius:9px">${(PROJ.revisions||[]).filter(r=>r.status==="Requested").length}</span>`:""}</div>
    <div class="tab ${S.tab==="approval"?"on":""}"  onclick="S.tab='approval';render()">Approval Stages</div>
    <div class="tab ${S.tab==="docs"?"on":""}"      onclick="S.tab='docs';render()">Documents</div>
    <div class="tab ${S.tab==="lpo"?"on":""}"       onclick="S.tab='lpo';render()">Milestones</div>
    <div class="tab ${S.tab==="deptasks"?"on":""}"  onclick="S.tab='deptasks';loadDependentTasks()">Dependent Tasks${(S._depTasks||[]).filter(t=>t.status!=="Resolved"&&t.status!=="Closed").length?` <span style="background:#e67e22;color:#fff;font-size:9px;font-weight:700;padding:1px 6px;border-radius:9px">${(S._depTasks||[]).filter(t=>t.status!=="Resolved"&&t.status!=="Closed").length}</span>`:""}</div>
    <div class="tab ${S.tab==="activity"?"on":""}"  onclick="S.tab='activity';render()">Activity Log</div>
  </div>
  <div class="body">`;

  // ── Project Info tab (coordinator landing; editable) ──────
  if (S.tab === "proj") {
    const canEdit = ["coordinator","super_admin"].includes(_role());
    const roField = (label, val) => `<div><div class="fl">${label}</div><div style="font-size:13px;color:var(--text);padding:6px 0">${val}</div></div>`;
    h += `<div class="sbox">
      <div class="sbox-title">Project Information ${canEdit ? `<span style="font-size:10px;font-weight:400;color:#9061e8;margin-left:6px">(editable)</span>` : `<span style="font-size:10px;font-weight:400;color:var(--text-muted);margin-left:6px">(read-only)</span>`}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="ff"><div class="fl">Project Folder</div><div style="font-size:13px;color:var(--text);padding:6px 0">${esc(projTitle(d) || "—")}</div></div>
        ${roField("Client Name", esc(d.project.client || "—"))}
        <div><div class="fl">Project Coordinator ${_canAssignCoord() ? `<span style="font-size:9px;color:#9061e8;font-weight:600">(assign)</span>` : ""}</div>
          ${_canAssignCoord()
            ? `<select class="fi" style="padding:6px 8px;font-size:13px"
                 onchange="PROJ.project.coordinator=this.value; render()">
                 <option value="">— Assign a coordinator —</option>
                 <optgroup label="Assign to Person">
                 ${(typeof COORDINATOR_USERS!=="undefined"?COORDINATOR_USERS:[]).map(u => {
                    const val = u.email || u.name;
                    return `<option value="${esc(val)}" ${d.project.coordinator===val?"selected":""}>${esc(u.name)}</option>`;
                 }).join("")}
                 ${d.project.coordinator && !d.project.coordinator.startsWith("dept:") && !(typeof COORDINATOR_USERS!=="undefined"?COORDINATOR_USERS:[]).some(u=>(u.email||u.name)===d.project.coordinator)
                    ? `<option value="${esc(d.project.coordinator)}" selected>${esc(_coordLabel(d.project.coordinator))} (inactive)</option>` : ""}
                 </optgroup>
                 <optgroup label="Assign to Team">
                 ${(typeof DEP_TASK_DEPARTMENTS!=="undefined"?DEP_TASK_DEPARTMENTS:[]).map(dep => `<option value="dept:${esc(dep)}" ${d.project.coordinator===("dept:"+dep)?"selected":""}>${esc(dep)}</option>`).join("")}
                 </optgroup>
               </select>`
            : `<div style="font-size:13px;color:var(--text);padding:6px 0">${esc(_coordLabel(d.project.coordinator) || "— Unassigned")}</div>`}
        </div>
        <div><div class="fl">Unit / Shop No.</div>${canEdit
          ? `<input class="fi" style="font-size:13px" value="${esc(d.project.unit||"")}" oninput="PROJ.project.unit=this.value"/>`
          : `<div style="font-size:13px;color:var(--text);padding:6px 0">${esc(d.project.unit || "—")}</div>`}</div>
        <div><div class="fl">MEPS Project ID</div>${canEdit
          ? `<input class="fi" style="font-size:13px;font-family:'SF Mono',Consolas,Menlo,monospace" placeholder="e.g. MEPS-2026-00123" value="${esc(d.project.mepsProjectId||"")}" oninput="PROJ.project.mepsProjectId=this.value"/>`
          : `<div style="font-size:13px;color:var(--text);padding:6px 0;font-family:'SF Mono',Consolas,Menlo,monospace">${esc(d.project.mepsProjectId || "—")}</div>`}</div>
        <div class="ff"><div class="fl">Location / Mall</div>${canEdit
          ? `<input class="fi" style="font-size:13px" value="${esc(d.project.location||"")}" oninput="PROJ.project.location=this.value"/>`
          : `<div style="font-size:13px;color:var(--text);padding:6px 0">${esc(d.project.location || "—")}</div>`}</div>
        <div><div class="fl">Expected Start</div>${canEdit
          ? `<input class="fi" type="date" style="font-size:13px" value="${esc(prop.expectedStartDate||"")}" oninput="PROJ.proposal.expectedStartDate=this.value"/>`
          : `<div style="font-size:13px;color:var(--text);padding:6px 0">${fmtDate(prop.expectedStartDate) || "—"}</div>`}</div>
        <div><div class="fl">Expected End</div>${canEdit
          ? `<input class="fi" type="date" style="font-size:13px" value="${esc(d.project.expectedEnd || d.project.deadline || "")}" oninput="PROJ.project.expectedEnd=this.value"/>`
          : `<div style="font-size:13px;color:var(--text);padding:6px 0">${fmtDate(d.project.expectedEnd || d.project.deadline) || "—"}</div>`}</div>
        ${roField("Submitted By", esc(prop.submittedBy || "—"))}
        ${roField("Quotation No.", `<span style="color:#1a5276;font-weight:600">${esc(prop.quotationNumber || "—")}</span>`)}
        ${roField("Quotation Value", prop.estimatedValue ? "AED " + esc(prop.estimatedValue) : "—")}
      </div>
      ${ptypes.length ? `<div style="margin-top:8px"><div class="fl" style="margin-bottom:5px">Folder Categories</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap">${ptypes.map(t => `<span class="proj-type-tag">${esc(t)}</span>`).join("")}</div></div>` : ""}
      ${canEdit ? `<div style="font-size:11px;color:var(--text-muted);margin-top:8px">Remember to press <b>Save</b> (top right) to store changes.</div>` : ""}
    </div>
    <div class="nb">Coordinators can update unit, location, and the expected start/end dates here.</div>`;

  // ── Scope tab (read-only for coordinator) ─────────────────
  } else if (S.tab === "scope") {
    h += `<div class="nb" style="margin-bottom:12px">📋 Each quotation's Scope of Work and Payment Milestones are shown together as one set. Additional scope enters only via a new quotation request (below).</div>`;
    h += renderQuotationGroups(d);
    // New Quotation / Revision requests — the ONLY way to add scope/milestones.
    h += renderRevisionsBlock();

  // ── Approval Stages tab (drawing prep/approval workflow) ──
  } else if (S.tab === "approval") {
    h += `<div class="nb" style="margin-bottom:12px">🗂️ Track drawing preparation and approval submissions here — separate from the Scope &amp; Quotations financial record.</div>`;
    h += renderApprovalStages(d);

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

  // ── Dependent Tasks tab ────────────────────────────────────
  } else if (S.tab === "deptasks") {
    h += renderDependentTasksTab(d);

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
        <div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">Loading…</div>
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
  if (!rows.length) { body.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">No activity recorded yet.</div>`; return; }
  body.innerHTML = rows.map((log, idx) => {
    const ts = (typeof fmtLogTime === "function") ? fmtLogTime(log.at) : log.at;
    let changesHtml = "";
    if (Array.isArray(log.changes) && log.changes.length) {
      changesHtml = `<div style="margin:3px 0 2px 14px;border-left:2px solid var(--border);padding-left:10px">` +
        log.changes.map(c => {
          if (c.added)   return `<div style="color:#1d7a4d">＋ ${esc(c.field)}: <b>${esc(c.to)}</b></div>`;
          if (c.removed) return `<div style="color:#a33">－ ${esc(c.field)}: <s>${esc(c.from)}</s></div>`;
          return `<div style="color:var(--text-muted)">• ${esc(c.field)}: <span style="color:#a33">${esc(c.from)}</span> → <span style="color:#1d7a4d">${esc(c.to)}</span></div>`;
        }).join("") + `</div>`;
    }
    return `<div style="padding:6px 4px;${idx%2?'background:var(--surface-3)':''};border-bottom:1px solid #f2f2f2">
      <span style="color:var(--text-muted)">${esc(ts)}</span> <span style="color:var(--text-muted)">[${esc(log.module||"-")}]</span> <span style="color:#1a3a5c;font-weight:700">${esc(log.byName||resolveUserName(log.by)||"—")}</span> <span style="color:var(--text)">${esc(log.action||"")}</span>${log.detail?` <span style="color:var(--text-muted)">— ${esc(log.detail)}</span>`:""}
      ${changesHtml}
    </div>`;
  }).join("");
}

// ── Modals ────────────────────────────────────────────────────
function renderModals() {
  let overlay = "";
  if (S.modal === "revapprove" && PROJ && S.revIndex != null && PROJ.revisions && PROJ.revisions[S.revIndex]) {
    const rev = PROJ.revisions[S.revIndex];
    const qv = S._revViewQuotation; // fetched read-only snapshot, or null while loading / not yet filled
    overlay = `<div class="overlay"><div class="modal" data-vo-safe style="max-width:900px;text-align:left;max-height:85vh;overflow-y:auto">
      <h3>Review Revision Request</h3>
      <div style="background:var(--surface-2);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;line-height:1.7">
        <div><b>Title:</b> ${esc(rev.title||"—")}</div>
        <div><b>Requested Additional Scope:</b> ${esc(rev.additionalScope||rev.scope||"—")}</div>
        <div><b>Quotation No:</b> ${esc(rev.quotationNo||"—")}</div>
        <div style="color:var(--text-muted);margin-top:4px">Raised by ${esc(resolveUserName(rev.raisedBy)||"—")}</div>
      </div>

      <div style="font-weight:600;font-size:13px;margin-bottom:6px">Data entered in the quotation (read-only — Proposals fills this in)</div>
      ${S._revViewLoading ? `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px">Loading quotation data…</div>` :
        !qv ? `<div style="font-size:12px;color:#a06b00;background:#fff7e6;border:1px solid #ffe1a8;border-radius:8px;padding:10px">Proposals hasn't opened/filled this quotation yet — nothing to show until they do.</div>` :
        `<div style="border:1px solid #e6e8ef;border-radius:10px;padding:10px 12px;font-size:12px">
          <div style="display:flex;justify-content:space-between;color:var(--text-muted);margin-bottom:6px">
            <span>Status: <b style="color:var(--text)">${esc(qv.open_status||"Open")}</b></span>
            <span>LPO Received: <b style="color:var(--text)">${esc(qv.lpo_received||"N")}</b></span>
          </div>
          <div style="font-weight:600;color:var(--text-muted);margin:8px 0 4px">Scope of Works</div>
          ${(qv.scope && qv.scope.length) ? qv.scope.map(s=>`
            <div style="padding:4px 0;border-bottom:1px solid #f2f2f2">
              <div><b style="color:#5b3df5">${esc(s.code||"—")}</b> ${esc(s.name||"")}</div>
              ${s.desc?`<div style="font-size:11px;color:var(--text-muted)">${esc(s.desc)}</div>`:""}
            </div>`).join("") : `<div style="color:var(--text-muted)">Not filled in yet.</div>`}
          <div style="font-weight:600;color:var(--text-muted);margin:8px 0 4px">Payment Milestones</div>
          ${(qv.lpo && qv.lpo.length) ? qv.lpo.map(m=>`
            <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #f2f2f2">
              <span>${esc(m.name||"—")}</span><span>${esc(m.pct||0)}%</span>
            </div>`).join("") : `<div style="color:var(--text-muted)">Not filled in yet.</div>`}
          <div style="display:flex;justify-content:space-between;margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-weight:700">
            <span>Total incl. VAT</span><span style="color:var(--money-color)">AED ${fmtAED(qv.gross_amount||qv.net_amount||0)}</span>
          </div>
        </div>`}

      <div class="modal-btns" style="margin-top:14px">
        <button class="btn vo-allow" style="background:var(--surface-2);color:#666" onclick="S.modal=null;S._revViewQuotation=null;render()">Close</button>
        <button class="btn btn-red vo-allow" onclick="approveRevision('reject')">Reject</button>
        <button class="btn btn-gold vo-allow" onclick="approveRevision('approve')">Approve</button>
      </div>
    </div></div>`;
    return overlay;
  }
  if (S.modal === "showlink" && PROJ) {
    const link = projectLink(PROJ);
    overlay = `<div class="overlay"><div class="modal">
      <h3>Project Link Ready</h3>
      <p>Share this link with your client. They can open it on any device.</p>
      <div style="font-size:11px;color:var(--text-muted);font-family:monospace;background:var(--surface-2);padding:10px;border-radius:8px;word-break:break-all;margin-bottom:12px">${link}</div>
      <div class="modal-btns">
        <button class="btn btn-gold" onclick="copyText('${link}')">Copy Link</button>
        <button class="btn btn-green" onclick="S.modal=null;render()">Done</button>
      </div>
    </div></div>`;
  }
  if (S.modal === "deptask" && PROJ) {
    overlay = renderDepTaskModal();
  }
  if (S.modal === "delproj") {
    overlay = `<div class="overlay"><div class="modal">
      <h3>Delete Project?</h3>
      <p>This will permanently delete <strong>${esc(PROJ ? PROJ.project.title : "this project")}</strong>. Cannot be undone.</p>
      <div class="modal-btns">
        <button class="btn" style="background:var(--surface-2);color:#666" onclick="S.modal=null;render()">Cancel</button>
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
// Resolve an owner value (email or legacy name) to a friendly display name.
function _ownerLabel(ownerVal) {
  if (!ownerVal) return "";
  const list = (typeof ACCOUNT_USERS !== "undefined") ? ACCOUNT_USERS : [];
  const u = list.find(x => (x.email || "") === ownerVal || x.name === ownerVal);
  return u ? u.name : ownerVal;   // fall back to the raw value (email/name)
}
// The coordinator lead (super_admin) or a coordinator can assign ownership.
function _canAssignCoord() { return can("coordinator.assignCoordinator", _role()); }
// Build a datalist of coordinator names: those already used on projects,
// plus any users with the coordinator role if that list is loaded.
// Resolve a coordinator value (email or legacy name) to a display name.
function _coordLabel(val) {
  if (!val) return "";
  if (val.startsWith("dept:")) return "🏢 " + val.slice(5) + " (team)";
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
      const val = milestoneAmount(m, gt);
      totalContract += val; count++;
      if (m.status === "credited") totalCredited += val; else totalPending += val;
    });
  });
  const pctCollected = totalContract ? Math.round((totalCredited / totalContract) * 100) : 0;

  let h = `<div class="sbox">
    <div class="sbox-title">💰 Payment Status <span style="font-size:10px;color:var(--text-muted);font-weight:400;margin-left:8px">${["account","super_admin"].includes(_role())?"enter invoice/payment details & credit below":"read-only · crediting is done by Accounts"}</span></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:8px 0">
      <div class="lpo-kpi"><div class="lpo-kpi-n">${fmtAED(totalContract)}</div><div class="lpo-kpi-l">Total (${count})</div></div>
      <div class="lpo-kpi"><div class="lpo-kpi-n" style="color:#27ae60">${fmtAED(totalCredited)}</div><div class="lpo-kpi-l">Credited</div></div>
      <div class="lpo-kpi"><div class="lpo-kpi-n" style="color:#e0a000">${fmtAED(totalPending)}</div><div class="lpo-kpi-l">Pending</div></div>
      <div class="lpo-kpi"><div class="lpo-kpi-n" style="color:#1a5fb4">${pctCollected}%</div><div class="lpo-kpi-l">Collected</div></div>
    </div>
  </div>`;

  if (!count) {
    return h + `<div class="sbox" style="margin-top:12px"><div style="font-size:12px;color:var(--text-muted);padding:16px;text-align:center">No payment milestones yet.</div></div>`;
  }

  groups.forEach((g, gi) => {
    const gt = g.contractTotal || 0;
    if (!(g.milestones || []).length) return;
    h += `<div class="sbox" style="margin-top:12px">
      <div class="sbox-title" style="font-size:12px">${g.isRevision?'🔄 Revision ':''}Quotation ${esc(g.quotationNo || "—")}</div>`;
    g.milestones.forEach((m, mi) => {
      const val = milestoneAmount(m, gt);
      const credited = accountStatus(m) === "Credited";
      const stName = accountStatus(m);
      const stSty = ACCOUNT_STATUS_STYLE[stName];
      const statusChip = `<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;background:${stSty.bg};color:${stSty.color}">${stSty.icon} ${stName}${credited && m.creditedDate?` · ${fmtLogTime(m.creditedDate)}`:""}${credited && m.creditedBy?` · ${esc(resolveUserName(m.creditedBy))}`:""}</span>`;
      h += `<div style="border-bottom:1px solid #f0f0f3;padding:8px 0">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
          <div style="flex:1"><span style="font-size:13px;color:#1a2740;font-weight:600">${esc(m.name || "Milestone")}</span>
            <span style="font-size:11px;color:var(--text-muted);margin-left:6px">${esc(m.pct||0)}%</span></div>
          <div style="font-weight:700;color:var(--text);font-size:13px">${fmtAED(val)}</div>
          <div style="width:200px;text-align:right">${statusChip}</div>
        </div>
        <div style="margin-top:6px;background:var(--surface-2);border-radius:6px;padding:6px 8px">
          <div style="font-size:10px;color:var(--text-muted);font-weight:600;margin-bottom:2px">📣 Follow-up with Accounts</div>
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
  const stName = accountStatus(m);
  const stSty = ACCOUNT_STATUS_STYLE[stName];
  return `<div style="margin-top:6px;background:#f4f8ff;border:1px solid #dce7fb;border-radius:6px;padding:10px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <div style="font-size:10px;color:#1a5fb4;font-weight:700">🧾 Accounts — Payment Details</div>
      <span style="font-size:10px;font-weight:700;padding:2px 9px;border-radius:10px;background:${stSty.bg};color:${stSty.color}">${stSty.icon} ${stName}</span>
    </div>
    ${isFixedAmountRow(m) && m.remarks ? `<div style="font-size:11px;color:var(--text-muted);background:var(--surface);border:1px solid #e6ebf7;border-radius:6px;padding:6px 8px;margin-bottom:8px"><b style="color:#1a5fb4">Description/Remarks:</b> ${esc(m.remarks)}</div>` : ""}
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
        <select class="fi" style="font-size:12px;background:${stSty.bg};color:${stSty.color};border-color:${stSty.color};font-weight:600" onchange="_setGroupMilestonePayStatus('${projectId}',${gi},${mi},this.value)">
          <option value="Open" ${stName==="Open"?"selected":""}>Open</option>
          <option value="Invoice Pending" ${stName==="Invoice Pending"?"selected":""}>⏳ Invoice Pending</option>
          <option value="Invoice Raised" ${stName==="Invoice Raised"?"selected":""}>📨 Invoice Raised</option>
          <option value="credited" ${stName==="Credited"?"selected":""}>✓ Credited</option>
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
    // Crediting a Completed Scope Payment is the specific trigger that
    // pushes the project into Hold — this payment type exists precisely
    // to bypass normal milestone completion and close out a project once
    // payment for the completed work is in hand, regardless of what
    // stages/other milestones are still incomplete.
    const willHold = !!ms.isCompletedScopePayment && !isProjectOnHold(PROJ);
    const confirmMsg = willHold
      ? `Mark "${ms.name || "this payment"}" as credited?\n\nThis is a Completed Scope Payment — crediting it will automatically move this project to Hold.`
      : `Mark "${ms.name || "this milestone"}" as credited?`;
    if (!confirm(confirmMsg)) { render(); return; }
    ms.status = "credited";
    if (!ms.creditedDate) ms.creditedDate = new Date().toISOString();
    const who = (typeof currentActor === "function") ? currentActor() : {};
    ms.creditedBy = who.email || who.name || "";
    if (willHold) {
      PROJ.holdStatus = "hold";
      PROJ.holdStatusAt = new Date().toISOString();
      PROJ.holdStatusBy = who.name || who.email || "";
      try { await fbSet(coPath("projects/" + projectId + "/holdStatus"), PROJ.holdStatus); } catch (e) {}
      try { await fbSet(coPath("projects/" + projectId + "/holdStatusAt"), PROJ.holdStatusAt); } catch (e) {}
      try { await fbSet(coPath("projects/" + projectId + "/holdStatusBy"), PROJ.holdStatusBy); } catch (e) {}
    }
  } else {
    // "Open" | "Invoice Pending" | "Invoice Raised" — Account's own
    // progression, independent of Coordinator's stageStatus.
    ms.status = value;
    ms.creditedDate = ""; ms.creditedBy = "";
  }
  // Track when the status actually changed — used for the Attention rule
  // (flag anything sitting in Invoice Pending/Invoice Raised too long).
  ms.statusSince = new Date().toISOString();
  const ok = await fbSet(coPath("projects/" + projectId + "/quotationGroups"), PROJ.quotationGroups);
  if (!ok) { alert("Could not save. Try again."); render(); return; }
  if (typeof logActivity === "function") {
    const who = (typeof currentActor === "function") ? currentActor() : {};
    const amt = (typeof milestoneAmount === "function") ? milestoneAmount(ms, g.contractTotal || 0) : (ms.amount || 0);
    const projName = (typeof projTitle === "function" ? projTitle(PROJ) : "") || (PROJ.quotationGroups && PROJ.quotationGroups[0] && PROJ.quotationGroups[0].quotationNo) || "Untitled project";
    logActivity("Account", value === "credited" ? "Credited milestone" : "Updated milestone status",
      projName, `${ms.name || "Milestone"} · ${fmtAED(amt)} · ${value === "credited" ? "Credited" : value}`,
      null, projectId);
  }
  render();
}

// Save all edited payment fields on the milestones (account) in one write.
async function _acctSaveMilestone(projectId) {
  const ok = await fbSet(coPath("projects/" + projectId + "/quotationGroups"), PROJ.quotationGroups);
  S.saved = ok; render();
  if (!ok) { alert("Could not save. Try again."); return; }
  if (typeof logActivity === "function") {
    const projName = (typeof projTitle === "function" ? projTitle(PROJ) : "") || (PROJ.quotationGroups && PROJ.quotationGroups[0] && PROJ.quotationGroups[0].quotationNo) || "Untitled project";
    logActivity("Account", "Updated payment details", projName, "Invoice/owner/reference fields", null, projectId);
  }
  setTimeout(() => { S.saved = false; render(); }, 2000);
}



// ── Proposal Revisions: roles ─────────────────────────────────
// Coordinator (or super admin) raises requests; Proposal In-charge
// (proposals role, or super admin) reviews/approves.
// The project's contract value (Total incl. VAT & Govt Fees from the quotation).
// Value of a milestone stage = its % of the project's quotation value.

// Render each quotation group (scope + milestones as one coupled set).
// Coordinators cannot add scope/milestones directly — only via a new quotation.
function renderQuotationGroups(d) {
  const groups = d.quotationGroups || [];
  if (!groups.length) return `<div class="sbox"><div style="font-size:12px;color:var(--text-muted);padding:16px;text-align:center">No quotation scope yet. It appears here once the quotation is awarded.</div></div>`;

  // Each quotation (original + every revision) is a fully separate set of
  // scope + milestones, shown as its own tab — never merged together.
  if (S.qtnTabIndex == null || S.qtnTabIndex >= groups.length || S.qtnTabIndex < 0) S.qtnTabIndex = groups.length - 1;
  const gi = S.qtnTabIndex;
  const g = groups[gi];
  const total = g.contractTotal || 0;

  let h = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
    ${groups.map((gg,i) => `<button type="button" onclick="S.qtnTabIndex=${i};render()"
      style="padding:6px 14px;border-radius:16px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid ${i===gi?'#5b3df5':'#dcdfe8'};background:${i===gi?'#5b3df5':'#fff'};color:${i===gi?'#fff':'#555'}">
      ${gg.isRevision?'🔄 ':'📄 '}${esc(gg.quotationNo||('Quotation '+(i+1)))}${gg.createdAt?` <span style="opacity:0.75;font-weight:400">· ${fmtDate(gg.createdAt)}</span>`:''}
    </button>`).join("")}
  </div>`;

  h += `<div class="sbox" style="border-left:3px solid ${g.isRevision?'#e67e22':'#5b3df5'}">
    <div class="sbox-title" style="display:flex;justify-content:space-between;align-items:center">
      <span>${g.isRevision?'🔄 Revision':'📄'} Quotation ${esc(g.quotationNo||"—")}</span>
      <span style="font-size:11px;color:var(--money-color);font-weight:700">${fmtAED(total)}</span>
    </div>
    <div style="font-size:10px;color:var(--text-muted);font-weight:600;margin:8px 0 4px">Scope of Work</div>
    ${(g.scope||[]).length ? `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
      <colgroup><col style="width:44px"/><col/><col style="width:110px"/></colgroup>
      <thead><tr style="background:var(--surface-3)">
        <th style="text-align:left;padding:5px 8px;font-size:10px;color:var(--text-muted)">No.</th>
        <th style="text-align:left;padding:5px 8px;font-size:10px;color:var(--text-muted)">Section / Description</th>
        <th style="text-align:right;padding:5px 8px;font-size:10px;color:var(--text-muted)">Value (AED)</th>
      </tr></thead><tbody>
      ${g.scope.map(s=>`
        <tr style="border-bottom:1px solid var(--border-soft)">
          <td style="padding:6px 8px;vertical-align:top;font-weight:700;color:#5b3df5">${esc(s.code||"—")}</td>
          <td style="padding:6px 8px;vertical-align:top">
            <div style="font-weight:600;color:var(--text)">${esc(s.name||"—")}</div>
            ${s.desc ? `<div style="font-size:11px;color:var(--text);opacity:0.8;margin-top:2px">${esc(s.desc)}</div>` : ""}
          </td>
          <td style="padding:6px 8px;vertical-align:top;text-align:right;color:var(--money-color);font-weight:600">${fmtAED(s.value||0)}</td>
        </tr>`).join("")}
      </tbody></table></div>` : `<div style="font-size:12px;color:var(--text-muted)">No scope items.</div>`}
    <div style="font-size:11px;color:var(--text-muted);text-align:right;border-top:1px solid var(--border);padding-top:4px;margin-top:4px">
      Sub-Total ${fmtAED(g.subtotal||0)} · VAT ${fmtAED(g.vat||0)} · Sub-Contractor/Provision ${fmtAED(g.subTotal||0)} · Govt ${fmtAED(g.govtTotal||0)}<br/>
      Net Amount (WHC) ${fmtAED(g.netAmount||0)} · <b>Total incl. VAT ${fmtAED(total)}</b></div>

    <div style="font-size:10px;color:var(--text-muted);font-weight:600;margin:12px 0 4px">Payment Milestones <span style="font-weight:400">(% of ${fmtAED(total)} · Raise Invoice → Account)</span></div>
    <div style="display:flex;gap:8px;margin-bottom:4px;font-size:10px;color:var(--text-muted);font-weight:600">
      <span style="flex:2">Description</span><span style="width:60px;text-align:right">%</span><span style="width:100px;text-align:right">Value</span><span style="width:130px;text-align:center">Status</span>
    </div>
    ${(g.milestones||[]).map((m,mi)=>{
      const fixed = isFixedAmountRow(m);
      const credited = accountStatus(m)==="Credited";
      const curLabel = coordStatusLabel(m.stageStatus);
      const curColor = COORD_STATUS_STYLE[curLabel] || COORD_STATUS_STYLE.Open;
      const statusControl = credited
        ? `<div style="width:130px;text-align:center;font-size:12px;font-weight:600;padding:calc(8px * var(--pad-scale)) 0;border-radius:8px;border:1.5px solid ${ACCOUNT_STATUS_STYLE.Credited.color};background:${ACCOUNT_STATUS_STYLE.Credited.bg};color:${ACCOUNT_STATUS_STYLE.Credited.color};box-sizing:border-box;line-height:1.2">${ACCOUNT_STATUS_STYLE.Credited.icon} Credited</div>`
        : `<select class="fi" style="width:130px;margin:0;background:${curColor.bg};color:${curColor.color};border-color:${curColor.color};font-weight:600" onchange="_setGroupMilestoneStatus(${gi},${mi},this.value)">
            <option value="Not started" ${curLabel==="Open"?"selected":""}>Open</option>
            <option value="In progress" ${curLabel==="In progress"?"selected":""}>In progress</option>
            <option value="Raise Invoice" ${curLabel==="Raise Invoice"?"selected":""}>Raise Invoice</option>
          </select>`;
      const hint = (() => { const ast = accountStatus(m); return ast==="Credited" ? "" : ast==="Invoice Raised" ? `<span style="font-size:10px;color:#1a3a5c">📨 invoice raised — awaiting payment</span>` : ast==="Invoice Pending" ? `<span style="font-size:10px;color:#a06b00">⏳ awaiting Accounts</span>` : ""; })();

      if (fixed) {
        return `<div style="margin-bottom:5px">
          <div style="display:flex;gap:8px;align-items:center">
            <div style="flex:2;font-size:12px;color:var(--text)">${m.isGovtFee?'🏛️':'📦'} ${esc(m.name||"—")}${m.isGovtFee&&m.estimatedAmount?`<span style="color:var(--text-muted);font-size:10px"> (Est. ${fmtAED(m.estimatedAmount)})</span>`:""}</div>
            <input class="fi" type="number" min="0" step="any" style="width:100px;margin:0;text-align:right;font-size:12px" value="${esc(m.actualAmount||0)}" placeholder="Amount"
              oninput="PROJ.quotationGroups[${gi}].milestones[${mi}].actualAmount=parseFloat(this.value)||0" onblur="_persistGroupMilestones()"/>
            ${statusControl}
            ${hint}
            ${m.isCompletedScopePayment ? `<button type="button" class="btn btn-sm" style="background:#fdecec;color:#a32d2d;padding:3px 8px" onclick="_removeSpecialInvoiceRow(${gi},${mi})" title="Remove this row">✕</button>` : ""}
          </div>
          <input class="fi" style="margin-top:3px;width:100%;font-size:11px" placeholder="Description / Remarks"
            value="${esc(m.remarks||"")}"
            oninput="PROJ.quotationGroups[${gi}].milestones[${mi}].remarks=this.value" onblur="_persistGroupMilestones()"/>
        </div>`;
      }
      return `<div style="display:flex;gap:8px;align-items:center;margin-bottom:5px">
        <div style="flex:2;font-size:12px;color:var(--text)">${esc(m.name||"—")}</div>
        <div style="width:60px;text-align:right;font-size:12px">${esc(m.pct||0)}%</div>
        <div style="width:100px;text-align:right;font-size:12px;color:var(--money-color);font-weight:600">${fmtAED(milestoneAmount(m,total))}</div>
        ${statusControl}
        ${hint}
      </div>`;
    }).join("")}
    <div style="margin-top:8px">
      <button type="button" class="btn btn-sm" style="background:#f3f0ff;color:#5b3df5" onclick="_addSpecialInvoiceRow(${gi})">📦 + Completed Scope Payment <span style="font-weight:400;opacity:0.8">(Hold/Cancelled projects)</span></button>
    </div>
  </div>`;
  return h;
}

// Add a Completed Scope Payment row to a quotation group's milestones —
// for invoicing whatever work is done when a project is going to Hold/
// Cancelled. Follows the exact same workflow as a regular payment
// milestone (Raise Invoice → Account's Invoice Pending / Invoice Raised /
// Credited); the amount is a directly-entered actual figure rather than a
// % of the contract total. (Government Fees Invoice is added automatically
// — see _buildQuotationGroup in shared.js — not via this manual button.)
async function _addSpecialInvoiceRow(gi) {
  const g = PROJ.quotationGroups && PROJ.quotationGroups[gi];
  if (!g) return;
  if (!Array.isArray(g.milestones)) g.milestones = [];
  g.milestones.push({
    id: "cshold_" + Date.now(),
    name: "Completed Scope Payment",
    isCompletedScopePayment: true,
    actualAmount: 0, remarks: "", pct: 0,
    stageStatus: "Not started", status: "Open",
    owner: "", invoiceNo: "", creditedDate: "", paymentRef: ""
  });
  render();
  await _persistGroupMilestones();
}
async function _removeSpecialInvoiceRow(gi, mi) {
  const g = PROJ.quotationGroups && PROJ.quotationGroups[gi];
  if (!g || !g.milestones || !g.milestones[mi]) return;
  if (!confirm(`Remove "${g.milestones[mi].name || "this row"}"? This can't be undone.`)) return;
  g.milestones.splice(mi, 1);
  render();
  await _persistGroupMilestones();
}
async function _persistGroupMilestones() {
  if (!PROJ) return;
  try { await fbSet(coPath("projects/" + PROJ.id + "/quotationGroups"), PROJ.quotationGroups); } catch (e) {}
}

// Set a milestone's stage status within a quotation group; "Raise Invoice"
// marks it as a pending payment item for the Account team (unless already credited).
async function _setGroupMilestoneStatus(gi, mi, val) {
  const g = PROJ.quotationGroups && PROJ.quotationGroups[gi];
  if (!g || !g.milestones || !g.milestones[mi]) return;
  const m = g.milestones[mi];
  m.stageStatus = val;
  // Raising the invoice notifies Account: auto-advance their status from
  // Open to "Invoice Pending" so it appears in their Awaiting list. Never
  // regress it if Account has already moved it further along (Invoice
  // Raised / Credited) or already started working it.
  if (val === "Raise Invoice" && accountStatus(m) === "Open") {
    m.status = "Invoice Pending";
    m.statusSince = new Date().toISOString();
  }
  render();
  // Persist immediately so the Account team's Awaiting list picks it up without
  // the coordinator having to press Save separately.
  try { await fbSet(coPath("projects/" + PROJ.id + "/quotationGroups"), PROJ.quotationGroups); }
  catch (e) {}
}

// Predefined Approval Stage templates — bulk-add the standard ADM/TAQA/ADCD
// approval workflow instead of adding stages one at a time. Loading a
// template APPENDS to the current list; remove any stage you don't need.
// Built-in ones live in shared.js (APPROVAL_STAGE_TEMPLATES) so the
// Templates module can browse them too.

// Custom Approval Stage templates — saved by users FROM a real project's
// stage list, stored server-side under options/ so they're shared across
// every Coordinator/Proposals user, alongside the built-in ones.
var CUSTOM_APPROVAL_TEMPLATES = {};
async function loadCustomApprovalTemplates() {
  try { CUSTOM_APPROVAL_TEMPLATES = (await fbGet(coPath("options/approval_stage_templates"))) || {}; }
  catch (e) { CUSTOM_APPROVAL_TEMPLATES = {}; }
  return CUSTOM_APPROVAL_TEMPLATES;
}

function _loadApprovalStageTemplate(name) {
  const custom = CUSTOM_APPROVAL_TEMPLATES[name];
  const tpl = APPROVAL_STAGE_TEMPLATES[name] || (custom && custom.items);
  if (!tpl || !PROJ) return;
  if (!Array.isArray(PROJ.stages)) PROJ.stages = [];
  tpl.forEach(s => {
    PROJ.stages.push({ name: s.name, type: s.type, status: "", note: "", time: s.time || "", appNum: "", dateA: "", dateB: "" });
  });
  render();
}

// Approval Stage templates are created/edited exclusively in the Templates
// module now — Coordinator only LOADS them here (see approval-tpl-pick
// below), matching how Scope templates work.

// Approval Stages block — moved out of the Milestones tab into Scope & Quotations.
function renderApprovalStages(d) {
  const commonOpts = commonStageOptions();
  let h = `<div class="sbox" style="margin-top:12px">
    <div class="sbox-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <span>Approval Stages <span style="font-size:10px;color:var(--text-muted);font-weight:400;margin-left:8px">⠿ Drag or ↑↓ to reorder</span></span>
      <span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <select id="approval-tpl-pick" class="fi" style="margin:0;font-size:11px;width:auto;max-width:220px">
          <option value="">Load Template…</option>
          ${Object.keys(APPROVAL_STAGE_TEMPLATES).length ? `<optgroup label="Built-in">${Object.keys(APPROVAL_STAGE_TEMPLATES).map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join("")}</optgroup>` : ""}
          ${Object.keys(CUSTOM_APPROVAL_TEMPLATES).length ? `<optgroup label="Saved by team">${Object.keys(CUSTOM_APPROVAL_TEMPLATES).map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join("")}</optgroup>` : ""}
        </select>
        <button type="button" class="btn btn-sm" style="background:#eef0ff;color:#5b3df5" onclick="const v=document.getElementById('approval-tpl-pick').value;if(v)_loadApprovalStageTemplate(v)">+ Load</button>
      </span>
    </div>`;
  if (S.selectedStages.length > 0) {
    h += `<div class="bulk-bar">
      <span class="bulk-bar-count">${S.selectedStages.length} stage(s) selected</span>
      <select class="se-sel" style="flex:1;min-width:160px" onchange="S.bulkStatus=this.value;render()">
        <option value="">— Set status for selected —</option>
        ${commonOpts.map(o => `<option value="${o.v}" ${S.bulkStatus === o.v ? "selected" : ""}>${o.label}</option>`).join("")}
      </select>
      <button class="btn btn-sm btn-gold" ${S.bulkStatus === "" ? "disabled" : ""} onclick="applyBulkStatus(S.bulkStatus)">Apply</button>
      <button class="btn btn-sm" style="background:var(--surface-2);color:#666" onclick="clearStageSelection()">Clear</button>
    </div>
    ${!commonOpts.length ? `<div style="font-size:11px;color:#a04800;margin-bottom:8px">Selected stages have no common status options.</div>` : ""}`;
  }
  (d.stages || []).forEach((st, i) => { if ((st.type||"") !== "awarded_scope") h += seRow(st, i, d.stages.length); });
  h += `<div class="btn-add btn-add-prep" onclick="addDrawingPrepStage()">+ Add Drawing Preparation Stage</div>
  <div class="btn-add btn-add-approval" onclick="addDrawingApprovalStage()">+ Add Drawing Approval Stage</div></div>`;
  return h;
}

function _canRaiseRevision() { return can("coordinator.raiseRevisionRequest", _role()); }
function _canApproveRevision() { return can("coordinator.reviewRevisionRequest", _role()); }

// Revision-request table — shown under Scope & Quotations. Coordinators only
// RAISE a request (title + what additional scope is needed); they never
// enter scope items or values themselves — Proposals fills those into the
// actual quotation. Quotation No. and Value auto-populate once that happens.
function renderRevisionsBlock() {
  if (!PROJ) return "";
  if (!Array.isArray(PROJ.revisions)) PROJ.revisions = [];
  const canApprove = _canApproveRevision();
  const revs = PROJ.revisions;
  return `<div class="nb" style="margin:16px 0 12px">🔄 New Quotation Requests — raise a request for the Proposals team to create a new quotation under the same folder (variations, additional scope). Quotation No. is assigned once it's sent to Proposals; Value (AED) fills in once Proposals completes the quotation.</div>
    <div class="sbox">
      <div class="sbox-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>New Quotation / Revision Requests</span>
        ${_canRaiseRevision() ? `<button class="btn btn-sm btn-gold" onclick="addRevision()">+ New Request</button>` : ""}
      </div>
      ${!revs.length ? `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">No revision requests yet.</div>` : `
      <div style="overflow-x:auto">
      <table class="rev-table" style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:var(--surface-3);text-align:left">
            <th style="padding:8px 10px">Title</th>
            <th style="padding:8px 10px">Requested Additional Scope</th>
            <th style="padding:8px 10px">Quotation Number</th>
            <th style="padding:8px 10px">Value (AED)</th>
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
          const valueDisplay = (r.value != null && r.value !== "")
            ? ("AED " + fmtAED(r.value))
            : `<span style="color:var(--text-muted);font-style:italic">Pending Proposal</span>`;
          return `<tr style="border-bottom:1px solid var(--border-soft);vertical-align:top">
            <td style="padding:8px 10px">${editable?`<input class="fi" style="margin:0;min-width:110px" value="${esc(r.title||"")}" oninput="PROJ.revisions[${i}].title=this.value"/>`:esc(r.title||"—")}</td>
            <td style="padding:8px 10px">${editable?`<textarea class="fi" rows="2" style="margin:0;min-width:200px;resize:vertical" placeholder="Describe the additional scope being requested..." oninput="PROJ.revisions[${i}].additionalScope=this.value">${esc(r.additionalScope||r.scope||"")}</textarea>`:`<div style="max-width:280px;white-space:pre-wrap">${esc(r.additionalScope||r.scope||"—")}</div>`}</td>
            <td style="padding:8px 10px"><span style="font-weight:600;color:#1a5276">${esc(r.quotationNo||"—")}</span></td>
            <td style="padding:8px 10px">${valueDisplay}</td>
            <td style="padding:8px 10px"><span style="font-weight:600;padding:2px 9px;border-radius:10px;background:${stBg};color:${stColor}">${esc(st)}</span></td>
            <td style="padding:8px 10px;white-space:nowrap">
              ${canApprove ? `<button class="btn btn-sm btn-gold vo-allow" onclick="openRevisionApproval(${i})">Review</button>` : ""}
              ${(st==="Requested" && _canRaiseRevision()) ? `<button class="btn btn-sm btn-red" onclick="PROJ.revisions.splice(${i},1);render()">✕</button>` : ""}
              ${st!=="Requested" ? `<div style="font-size:10px;color:var(--text-muted);margin-top:3px">${esc(resolveUserName(r.actionedBy)||"")}${r.actionedAt?` · ${fmtLogTime(r.actionedAt)}`:""}</div>` : ""}
            </td>
          </tr>`;
        }).join("")}
        </tbody>
      </table></div>`}
      ${_canRaiseRevision()&&revs.some(r=>r.status==="Requested") ? `<div style="font-size:11px;color:var(--text-muted);margin-top:8px">Remember to Save the project after adding or editing requests.</div>` : ""}
    </div>`;
}

async function addRevision() {
  if (!_canRaiseRevision()) { alert("Only a Coordinator can raise a revision request."); return; }
  if (!Array.isArray(PROJ.revisions)) PROJ.revisions = [];
  const who = (typeof CURRENT_USER!=="undefined" && CURRENT_USER) || getSession() || {};
  const rev = {
    id: "rev_" + Date.now(),
    title: "", additionalScope: "", value: null, quotationNo: "(assigning…)",
    status: "Requested",
    raisedBy: who.email || who.name || "", raisedAt: new Date().toISOString()
  };
  PROJ.revisions.push(rev);
  render();
  // Mint a REAL new quotation (next number from the parent's category counter,
  // same folder, Open state) that appears in the Proposals list — this IS
  // "sending it to Proposals"; the quotation number fills in automatically
  // once minted, and Value (AED) fills in once Proposals completes the
  // quotation's Scope & Fees.
  if (typeof mintRevisionQuotation === "function") {
    const minted = await mintRevisionQuotation(PROJ, rev);
    rev.quotationNo = (minted && minted.qtnNo) || "(pending)";
    rev.mintedQuotationId = (minted && minted.id) || "";
    rev.category = (PROJ.proposal && PROJ.proposal.category) || "";
    render();
    saveProj();   // persist the linked quotation number on the project
  }
}

// Open the Review modal for a revision — READ-ONLY. Coordinators never
// author scope or values; this just shows whatever Proposals has entered
// into the actual minted quotation so far. There is no way to add or edit
// scope/milestones from here — that only ever happens in Proposals.
async function openRevisionApproval(i) {
  if (!_canApproveRevision()) { alert("Only the Proposal In-charge can review this."); return; }
  S.revIndex = i;
  S.modal = "revapprove";
  S._revViewQuotation = null;
  S._revViewLoading = true;
  render();
  const rev = PROJ.revisions[i];
  const category = rev.category || (PROJ.proposal && PROJ.proposal.category) || "";
  const path = (typeof _CATEGORY_PATH !== "undefined" && _CATEGORY_PATH[category]) || "";
  if (path && rev.mintedQuotationId) {
    try {
      const qv = await fbGet(coPath(path + "/" + rev.mintedQuotationId), { fresh: true });
      S._revViewQuotation = qv || null;
      // Keep the request's own Value column in sync with what's actually
      // in the quotation, so the table reflects reality without anyone
      // having to type a number in.
      if (qv) { rev.value = qv.gross_amount != null ? qv.gross_amount : (qv.net_amount || 0); }
    } catch (e) {}
  }
  S._revViewLoading = false;
  render();
}

// Approve/Reject: this is just an acknowledgment of the request itself.
// It never creates a project or a quotation-group tab directly — that only
// ever happens through the normal Proposals pipeline (Save & Submit to
// Coordinator), which already correctly resolves back to this SAME project
// via parent_project_id, so nothing here can duplicate anything.
async function approveRevision(decision) {
  const i = S.revIndex;
  if (i == null || !PROJ.revisions[i]) { S.modal=null; render(); return; }
  const who = (typeof CURRENT_USER!=="undefined" && CURRENT_USER) || getSession() || {};
  const rev = PROJ.revisions[i];
  rev.status = decision === "reject" ? "Rejected" : "Approved";
  rev.actionedBy = who.email || who.name || ""; rev.actionedAt = new Date().toISOString();
  S.modal = null; S.revIndex = null; S._revViewQuotation = null;
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
    await _dataCall("delete", coPath("activity_log"), { projectId: PROJ.id });
    await logActivity("Coordinator", "Cleared project activity log", PROJ.project?.title || PROJ.id, "", null, PROJ.id);
  } catch (e) { alert("Could not clear the log. Please try again."); }
  if (typeof loadProjectLog === "function") loadProjectLog();
}

// Account team sets credited/pending status. Records who credited it and when,
// so the ownership label can show "Credited by Accounts · <name>".

// Attach an uploaded proof to the LPO with this id, then re-render.

// Attach an uploaded proof to the whole project, then re-render.
function _setProjectAttachment(att) {
  if (!PROJ) return;
  PROJ.attachment = att;
  render();
}
