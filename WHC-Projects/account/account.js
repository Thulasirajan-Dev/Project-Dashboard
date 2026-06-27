// ============================================================
//  Winner Holistic Consultants – Account / Admin Module
//  account/account.js
//  Depends on: shared/shared.js
// ============================================================

let _lastFilteredProjects = [];

// ── Load all projects ─────────────────────────────────────────
async function loadAll() {
  document.getElementById("app").innerHTML = `<div class="loading"><div class="spinner"></div><div style="font-size:13px;color:#888">Loading all projects...</div></div>`;
  ALL_PROJECTS = (await fbGet("projects")) || {};
  S.mode = "admin"; render();
}

async function openProject(id) {
  document.getElementById("app").innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const data = await fbGet("projects/" + id);
  if (data) { PROJ = migrateProject(data); _projSnapshot = JSON.parse(JSON.stringify(PROJ)); S.mode = "project"; render(); }
}

let _projSnapshot = null;   // pristine copy taken when a project is opened (for diffing)
async function saveProj() {
  if (!PROJ) return; S.saving = true; render();
  const isEdit = !!PROJ.createdAt;
  const summary = isEdit ? diffProjectSummary(_projSnapshot, PROJ) : "";
  stampAudit(PROJ, isEdit);
  const ok = await fbSet("projects/" + PROJ.id, PROJ);
  if (ok) {
    logActivity("Account", isEdit ? "Updated project" : "Created project",
      PROJ.project?.title || PROJ.id, summary);
    _projSnapshot = JSON.parse(JSON.stringify(PROJ));
  }
  S.saving = false; S.saved = ok; render();
  setTimeout(() => { S.saved = false; render(); }, 2500);
}

async function confirmDelete() {
  if (!PROJ) return;
  const title = PROJ.project?.title || PROJ.id;
  await fbDelete("projects/" + PROJ.id);
  logActivity("Account", "Deleted project", title, "");
  delete ALL_PROJECTS[PROJ.id];
  PROJ = null; S.modal = null; S.mode = "admin"; render();
}

// ── Admin popup helpers ───────────────────────────────────────
function showAdminPopup(title, subtitle, projects) {
  S.adminPopup = { title, subtitle, projects: projects || [] }; render();
}
function closeAdminPopup() { S.adminPopup = null; render(); }

function openAdminPopupById(id) {
  const all = Object.values(ALL_PROJECTS);
  const proposals = all.filter(p => p.workflowStatus === "proposal" || p.workflowStatus === "allocated");
  const projects  = all.filter(p => p.workflowStatus !== "proposal" && p.workflowStatus !== "allocated");
  const attention = [];
  projects.forEach(p => (p.stages || []).forEach(st => {
    if (["hold","waiting-applicant","rejected","not-received","comments-shared"].includes(st.status || ""))
      attention.push(p);
  }));
  const uniqueAttn = [...new Map(attention.map(p => [p.id, p])).values()];
  const map = {
    "prop-all":      { title:"All Proposals",            sub:`${proposals.length} total`,                list: proposals },
    "prop-pending":  { title:"Pending Allocation",        sub:"Not yet assigned",                        list: proposals.filter(p => p.workflowStatus === "proposal") },
    "prop-alloc":    { title:"Allocated Proposals",       sub:"Assigned to coordinators",                list: proposals.filter(p => p.workflowStatus === "allocated") },
    "prop-reapp":    { title:"Proposals with Re-approvals",sub:"",                                       list: proposals.filter(p => p.proposal?.reapprovals?.length > 0) },
    "proj-all":      { title:"All Projects",              sub:`${projects.length} total`,                list: projects },
    "proj-active":   { title:"In Progress Projects",      sub:"Currently active",                        list: projects.filter(p => projStatus(p) === "active") },
    "proj-done":     { title:"Completed Projects",        sub:"",                                        list: projects.filter(p => projStatus(p) === "done") },
    "proj-new":      { title:"Not Started Projects",      sub:"No activity yet",                         list: projects.filter(p => projStatus(p) === "new") },
    "proj-attention":{ title:"Blocked Stages",            sub:"Hold / Rejected / Waiting on Applicant",  list: uniqueAttn },
    "proj-reapp":    { title:"Projects with Re-approvals",sub:"",                                        list: projects.filter(p => p.proposal?.reapprovals?.length > 0) },
  };
  const entry = map[id]; if (!entry) return;
  showAdminPopup(entry.title, entry.sub, entry.list);
}

function openAdminPopupByType(_, val) {
  const all = Object.values(ALL_PROJECTS);
  showAdminPopup(val + " Proposals", "Proposals with this project type",
    all.filter(p => (p.workflowStatus === "proposal" || p.workflowStatus === "allocated") && natureArr(p.project?.unitType).includes(val)));
}
function openAdminPopupByCategory(cat) {
  const all = Object.values(ALL_PROJECTS);
  showAdminPopup(cat, "Proposals in this folder category",
    all.filter(p => (p.workflowStatus === "proposal" || p.workflowStatus === "allocated") && (p.proposal?.projectTypes || []).includes(cat)));
}
function openAdminPopupByCoord(name) {
  const projects = Object.values(ALL_PROJECTS).filter(p => p.workflowStatus !== "proposal" && p.workflowStatus !== "allocated");
  showAdminPopup(name + " — Projects", "All projects assigned to this coordinator",
    projects.filter(p => p.project?.coordinator === name));
}
function openAdminPopupByProjType(t) {
  const projects = Object.values(ALL_PROJECTS).filter(p => p.workflowStatus !== "proposal" && p.workflowStatus !== "allocated");
  showAdminPopup(t + " Projects", "", projects.filter(p => natureArr(p.project?.unitType).includes(t)));
}

// ── CSV export ────────────────────────────────────────────────
function exportFilteredCSV() {
  const rows = _lastFilteredProjects || [];
  if (!rows.length) { alert("No records to export."); return; }
  const headers = ["Project Folder","Client","Location","Unit","Nature","Coordinator","Status","Quotation Number","Quotation Value (AED)","Re-approvals","Stages Completed","Total Stages","Progress %","Active Stage","Created Date","Client Link"];
  const lines = [headers.map(csvEsc).join(",")];
  rows.forEach(p => {
    const pr = p.project || {}, prop = p.proposal || {}, st = projStatus(p), pc = projPct(p);
    const stTxt = { done:"Completed", active:"In Progress", proposal:"Proposal", allocated:"Allocated", new:"Not Started" }[st] || st;
    const stages = p.stages || [];
    const doneN = stages.filter(s => isStageComplete(s)).length;
    const activeStage = stages.find(s => { const sv=s.status||""; return sv&&!["received","approved","completed","completed-signed","approved-bcc"].includes(sv); });
    lines.push([
      pr.title||"", pr.client||"", pr.location||"", pr.unit||"", natureCSV(pr.unitType), pr.coordinator||"",
      stTxt, prop.quotationNumber||"", prop.estimatedValue||"",
      (prop.reapprovals||[]).length, doneN, stages.length, pc,
      activeStage?activeStage.name:"", p.createdAt||"", projectLink(p.id)
    ].map(csvEsc).join(","));
  });
  const csv = lines.join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type:"text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url; a.download = `WHC_Projects_${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ── Admin popup overlay ───────────────────────────────────────
function renderAdminPopup() {
  const pop = S.adminPopup; if (!pop) return "";
  return `<div class="admin-popup-overlay" onclick="if(event.target===this)closeAdminPopup()">
    <div class="admin-popup">
      <div class="admin-popup-hdr">
        <div>
          <div class="admin-popup-title">${esc(pop.title)}</div>
          ${pop.subtitle ? `<div class="admin-popup-sub">${esc(pop.subtitle)}</div>` : ""}
        </div>
        <button class="admin-popup-close" onclick="closeAdminPopup()">✕</button>
      </div>
      <div class="admin-popup-body">
        ${pop.projects && pop.projects.length ? pop.projects.map(p => {
          const pr = p.project||{}, prop = p.proposal||{};
          const st = projStatus(p), pc = projPct(p);
          const cCls = { done:"chip-done", active:"chip-active", proposal:"chip-proposal", allocated:"chip-allocated" }[st] || "chip-new";
          const cTxt = { done:"Completed", active:"In Progress", proposal:"Proposal", allocated:"Allocated" }[st] || "Not Started";
          return `<div class="admin-popup-proj-row" onclick="closeAdminPopup();openProject('${p.id}')">
            <div style="flex:1">
              <div style="font-size:13px;font-weight:600;color:#1a1a1a;margin-bottom:3px">${esc(pr.title||"Unnamed")}</div>
              <div style="font-size:11px;color:#888;margin-bottom:5px">${esc(pr.client||"—")} · ${esc(pr.location||"—")} · Unit: ${esc(pr.unit||"—")}${pr.coordinator?" · <strong>"+esc(pr.coordinator)+"</strong>":""}</div>
              <div style="display:flex;gap:5px;flex-wrap:wrap">
                <span class="status-chip ${cCls}">${cTxt}</span>
                ${prop.quotationNumber?`<span class="status-chip" style="background:#e8f4ff;color:#1a5276">📄 ${esc(prop.quotationNumber)}</span>`:""}
              </div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:13px;font-weight:700;color:#0d2137">${pc}%</div>
              <div class="mini-bar-bg" style="margin-top:4px"><div class="mini-bar-fill" style="width:${pc}%"></div></div>
              <div style="font-size:10px;color:#aaa;margin-top:3px">Tap to open →</div>
            </div>
          </div>`;
        }).join("") : `<div class="admin-popup-empty">No entries in this category.</div>`}
      </div>
    </div>
  </div>`;
}

// ── Modals ────────────────────────────────────────────────────
function renderModals() {
  let overlay = renderAdminPopup();
  if (S.modal === "showlink" && PROJ) {
    const link = projectLink(PROJ.id);
    overlay += `<div class="overlay"><div class="modal">
      <h3>Project Link</h3>
      <div style="font-size:11px;font-family:monospace;background:#f7f7f7;padding:10px;border-radius:8px;word-break:break-all;margin-bottom:12px">${link}</div>
      <div class="modal-btns">
        <button class="btn btn-gold" onclick="copyText('${link}')">Copy Link</button>
        <button class="btn btn-green" onclick="S.modal=null;render()">Done</button>
      </div>
    </div></div>`;
  }
  if (S.modal === "delproj") {
    overlay += `<div class="overlay"><div class="modal">
      <h3>Delete Project?</h3>
      <p>This will permanently delete <strong>${esc(PROJ?PROJ.project.title:"this project")}</strong>. Cannot be undone.</p>
      <div class="modal-btns">
        <button class="btn" style="background:#f0f0f0;color:#666" onclick="S.modal=null;render()">Cancel</button>
        <button class="btn btn-red" onclick="confirmDelete()">Delete Permanently</button>
      </div>
    </div></div>`;
  }
  return overlay;
}

// ── Main admin dashboard render ───────────────────────────────
function renderAdmin() {
  const all = Object.values(ALL_PROJECTS);
  const proposals = all.filter(p => p.workflowStatus === "proposal" || p.workflowStatus === "allocated");
  const projects  = all.filter(p => p.workflowStatus !== "proposal" && p.workflowStatus !== "allocated");
  const active    = projects.filter(p => projStatus(p) === "active").length;
  const done      = projects.filter(p => projStatus(p) === "done").length;
  const notStarted= projects.filter(p => projStatus(p) === "new").length;
  const totalReapprovals = all.reduce((s, p) => s + (p.proposal?.reapprovals?.length || 0), 0);
  const coordinators = [...new Set(all.map(p => p.project?.coordinator).filter(Boolean))].sort();

  const attention = [];
  projects.forEach(p => (p.stages || []).forEach(st => {
    if (["hold","waiting-applicant","rejected","not-received","comments-shared"].includes(st.status || ""))
      attention.push({ proj: p, stage: st });
  }));

  const coordLoad = {};
  projects.forEach(p => {
    const c = (p.project?.coordinator) || "Unassigned";
    if (!coordLoad[c]) coordLoad[c] = { total:0, active:0, done:0 };
    coordLoad[c].total++;
    const st = projStatus(p);
    if (st === "active") coordLoad[c].active++;
    if (st === "done")   coordLoad[c].done++;
  });

  // Filtered list for "All Records" tab
  let filtered = all.filter(p => {
    const pr = p.project || {}, q = S.search.toLowerCase();
    if (q && !["title","client","location","coordinator","unit"].some(k => (pr[k]||"").toLowerCase().includes(q))) return false;
    if (S.filterStatus !== "all" && projStatus(p) !== S.filterStatus) return false;
    if (S.filterType !== "all" && !natureArr(pr.unitType).includes(S.filterType)) return false;
    if (S.filterCoord !== "all" && pr.coordinator !== S.filterCoord) return false;
    if (S.filterProjType !== "all" && !(p.proposal?.projectTypes || []).includes(S.filterProjType)) return false;
    if (S.filterStage && S.filterStage !== "all" && !(p.stages||[]).some(st => st.name === S.filterStage && (st.status||"") !== "")) return false;
    return true;
  }).sort((a, b) => (b.createdAt||"").localeCompare(a.createdAt||""));

  let h = `
  <div class="admin-hdr">
    <div class="hdr-logo">Winner Holistic Consultants</div>
    <div class="admin-title">Admin Dashboard</div>
    <div class="admin-sub">Live data · All projects & proposals</div>
  </div>
  <div class="admin-nav-tabs">
    <div class="admin-nav-tab ${S.adminTab==="proposals"?"on":""}" onclick="S.adminTab='proposals';render()">📋 Proposals</div>
    <div class="admin-nav-tab ${S.adminTab==="projects"?"on":""}"  onclick="S.adminTab='projects';render()">🏗️ Projects</div>
    <div class="admin-nav-tab ${S.adminTab==="all"?"on":""}"       onclick="S.adminTab='all';render()">📁 All Records</div>
    <div class="admin-nav-tab ${S.adminTab==="activity"?"on":""}"  onclick="S.adminTab='activity';loadActivity()">🕓 Activity Log</div>
  </div>`;

  // ── Proposals tab ─────────────────────────────────────────
  if (S.adminTab === "proposals") {
    const pendingAlloc   = proposals.filter(p => p.workflowStatus === "proposal").length;
    const allocated      = proposals.filter(p => p.workflowStatus === "allocated").length;
    const propWithReapp  = proposals.filter(p => p.proposal?.reapprovals?.length > 0).length;
    const totalPropReapp = proposals.reduce((s,p) => s + (p.proposal?.reapprovals?.length||0), 0);

    h += `<div class="dash-body">
      <div class="kpi-grid">
        ${[
          { n:proposals.length, l:"Total Proposals",   id:"prop-all",     c:"" },
          { n:pendingAlloc,     l:"Pending Alloc.",     id:"prop-pending",  c:"#e24b4a" },
          { n:allocated,        l:"Allocated",          id:"prop-alloc",    c:"#0369a1" },
          { n:propWithReapp,    l:"With Re-approvals",  id:"prop-reapp",    c:"#a04800" },
          { n:totalPropReapp,   l:"Total Re-approvals", id:"",             c:"#a04800" }
        ].map(k => `<div class="kpi-card ${k.id?"kpi-proposal":""}" ${k.id?`style="cursor:pointer" onclick="openAdminPopupById('${k.id}')"`:""}>`+
          `<div class="kpi-num" ${k.c?`style="color:${k.c}"`:""}>${k.n}</div>`+
          `<div class="kpi-label">${k.l}</div>`+
          `${k.id?`<div class="kpi-click-hint">Tap to view →</div>`:""}`+
        `</div>`).join("")}
      </div>

      <div class="dash-card" style="margin-bottom:12px">
        <div class="dash-card-title">Nature Breakdown — Proposals</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${PROJECT_TYPES_NEW.map(t => {
            const cnt = proposals.filter(p => natureArr(p.project?.unitType).includes(t)).length;
            return `<div style="background:#fff8e6;border:1px solid #e8c96a;border-radius:10px;padding:10px 14px;text-align:center;min-width:70px;cursor:pointer"
              onclick="openAdminPopupByType('projtype','${t}')">
              <div style="font-size:20px;font-weight:700;color:#a06b00">${cnt}</div>
              <div style="font-size:10px;color:#888;margin-top:2px">${t}</div>
            </div>`;
          }).join("")}
        </div>
      </div>

      <div class="dash-card" style="margin-bottom:12px">
        <div class="dash-card-title">Folder Category Breakdown</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${FOLDER_CATEGORIES.map(t => {
            const cnt = proposals.filter(p => (p.proposal?.projectTypes||[]).includes(t)).length;
            return `<div style="background:#ede8fe;border:1px solid #c4b5fd;border-radius:10px;padding:10px 14px;text-align:center;min-width:70px;cursor:pointer"
              onclick="openAdminPopupByCategory('${t}')">
              <div style="font-size:20px;font-weight:700;color:#4a1fb8">${cnt}</div>
              <div style="font-size:10px;color:#7c3aed;margin-top:2px">${t.replace(" Folder","")}</div>
            </div>`;
          }).join("")}
        </div>
      </div>

      <div class="dash-card">
        <div class="dash-card-title">🔄 Re-approval Summary</div>
        ${!proposals.filter(p => p.proposal?.reapprovals?.length).length
          ? `<div class="dash-empty">No re-approvals recorded yet.</div>`
          : proposals.filter(p => p.proposal?.reapprovals?.length).map(p => {
            const pr = p.project||{};
            return `<div class="attn-row" onclick="openProject('${p.id}')">
              <div class="attn-stage">${esc(pr.title||"Unnamed")}</div>
              <div class="attn-proj">${esc(pr.coordinator||"")}</div>
              <div style="display:flex;gap:5px;flex-wrap:wrap">
                ${(p.proposal.reapprovals||[]).map(r => `<span style="background:#fde8d8;color:#a04800;font-size:10px;font-weight:600;padding:2px 8px;border-radius:8px">
                  ${esc(r.title||"Re-approval")}${r.quotationNumber?" · "+esc(r.quotationNumber):""}
                </span>`).join("")}
              </div>
            </div>`;
          }).join("")}
      </div>
    </div>`;

  // ── Projects tab ──────────────────────────────────────────
  } else if (S.adminTab === "projects") {
    h += `<div class="dash-body">
      <div class="kpi-grid">
        ${[
          { n:projects.length, l:"Total Projects",   id:"proj-all",       cls:"" },
          { n:active,          l:"In Progress",       id:"proj-active",    cls:"kpi-active" },
          { n:done,            l:"Completed",         id:"proj-done",      cls:"kpi-done" },
          { n:notStarted,      l:"Not Started",       id:"proj-new",       cls:"" },
          { n:attention.length,l:"Blocked Stages",    id:"proj-attention", cls:"kpi-warn" },
          { n:totalReapprovals,l:"Re-approvals",      id:"proj-reapp",     cls:"kpi-reapp" }
        ].map(k => `<div class="kpi-card ${k.cls}" style="cursor:pointer" onclick="openAdminPopupById('${k.id}')">
          <div class="kpi-num">${k.n}</div><div class="kpi-label">${k.l}</div>
          <div class="kpi-click-hint">Tap to view →</div>
        </div>`).join("")}
      </div>

      <div class="dash-row">
        <div class="dash-card">
          <div class="dash-card-title">Status Breakdown</div>
          ${[{label:"In Progress",cnt:active,cls:"bar-active",f:"proj-active"},
             {label:"Completed",cnt:done,cls:"bar-done",f:"proj-done"},
             {label:"Not Started",cnt:notStarted,cls:"bar-new",f:"proj-new"}].map(({label,cnt,cls,f}) => {
            const p2 = projects.length ? Math.round(cnt/projects.length*100) : 0;
            return `<div class="bar-row" onclick="openAdminPopupById('${f}')">
              <div class="bar-label">${label}</div>
              <div class="bar-track"><div class="bar-fill ${cls}" style="width:${p2}%"></div></div>
              <div class="bar-count">${cnt}</div>
            </div>`;
          }).join("")}
        </div>
        <div class="dash-card">
          <div class="dash-card-title">Nature of the Project</div>
          ${PROJECT_TYPES_NEW.map(t => {
            const cnt = projects.filter(p => natureArr(p.project?.unitType).includes(t)).length;
            const p2 = projects.length ? Math.round(cnt/projects.length*100) : 0;
            return `<div class="bar-row" onclick="openAdminPopupByProjType('${t}')">
              <div class="bar-label" style="width:100px;font-size:11px">${t}</div>
              <div class="bar-track"><div class="bar-fill bar-active" style="width:${p2}%"></div></div>
              <div class="bar-count">${cnt}</div>
            </div>`;
          }).join("")}
        </div>
      </div>

      <div class="dash-card" style="margin-top:12px">
        <div class="dash-card-title">Coordinator Workload</div>
        ${!Object.keys(coordLoad).length ? `<div class="dash-empty">No coordinators assigned yet.</div>` : ""}
        <div class="coord-table">
          <div class="coord-thead"><div>Coordinator</div><div>Total</div><div>Active</div><div>Done</div><div>Progress</div></div>
          ${Object.entries(coordLoad).map(([name, dl]) => {
            const p2 = dl.total ? Math.round(dl.done/dl.total*100) : 0;
            const safe = name.replace(/\\/g,"\\\\").replace(/'/g,"\\'");
            return `<div class="coord-row" onclick="openAdminPopupByCoord('${safe}')">
              <div class="coord-name">${esc(name)}</div><div>${dl.total}</div>
              <div><span class="status-chip chip-active">${dl.active}</span></div>
              <div><span class="status-chip chip-done">${dl.done}</span></div>
              <div style="display:flex;align-items:center;gap:6px">
                <div class="bar-track" style="flex:1"><div class="bar-fill bar-done" style="width:${p2}%"></div></div>
                <span style="font-size:11px;color:#666;width:28px">${p2}%</span>
              </div>
            </div>`;
          }).join("")}
        </div>
      </div>

      <div class="dash-card" style="margin-top:12px">
        <div class="dash-card-title">⚠ Stages Needing Attention</div>
        ${!attention.length ? `<div class="dash-empty" style="color:#166a3f">✓ No stages currently blocked.</div>` : ""}
        ${attention.map(({proj,stage}) => {
          const disp = STATUS_DISPLAY[stage.status||""] || STATUS_DISPLAY[""];
          return `<div class="attn-row" onclick="openProject('${proj.id}')">
            <div class="attn-stage">${esc(stage.name)}</div>
            <div class="attn-proj">${esc(proj.project?.title||"")}</div>
            <div><span class="badge ${disp.cls}">${disp.label}</span></div>
            <span style="font-size:10px;color:#888">${esc(proj.project?.coordinator||"")}</span>
          </div>`;
        }).join("")}
      </div>
    </div>`;

  // ── All Records tab ───────────────────────────────────────
  } else if (S.adminTab === "all") {
    const stageNames = ["Project Scope Analysis and Requirement Collection","Project Registration","ADM and CD-FLS – Drawing Preparation","ADM & CD-FLS Approval","TAQA Drawing Preparation","TAQA Drawing Approval","ADCD Shop Drawing Preparation","ADCD Shop Drawing Approval","Work Start Notice Approval","Commencement of Site Work","TAQA Inspection Approval","Hassantuk & AMC Application Submission Initiation","ADCD Inspection","ADM Completion Inspection","GIS Approval","Project Fully Completed"];
    _lastFilteredProjects = filtered;

    h += `<div class="search-bar">
      <input class="search-input" placeholder="Search project, client, unit, coordinator..."
        value="${esc(S.search)}" oninput="S.search=this.value;render()"/>
      <select class="filter-sel" onchange="S.filterStatus=this.value;render()">
        <option value="all">All Status</option>
        ${["proposal","allocated","new","active","done"].map(v =>
          `<option value="${v}" ${S.filterStatus===v?"selected":""}>${{proposal:"Proposal",allocated:"Allocated",new:"Not Started",active:"In Progress",done:"Completed"}[v]}</option>`
        ).join("")}
      </select>
      <select class="filter-sel" onchange="S.filterType=this.value;render()">
        <option value="all">All Natures</option>
        ${PROJECT_TYPES_NEW.map(t => `<option value="${t}" ${S.filterType===t?"selected":""}>${t}</option>`).join("")}
      </select>
      <select class="filter-sel" onchange="S.filterCoord=this.value;render()">
        <option value="all">All Coordinators</option>
        ${coordinators.map(c => `<option value="${esc(c)}" ${S.filterCoord===c?"selected":""}>${esc(c)}</option>`).join("")}
      </select>
      <select class="filter-sel" onchange="S.filterProjType=this.value;render()">
        <option value="all">All Folder Categories</option>
        ${FOLDER_CATEGORIES.map(t => `<option value="${t}" ${S.filterProjType===t?"selected":""}>${t}</option>`).join("")}
      </select>
      <select class="filter-sel" onchange="S.filterStage=this.value;render()">
        <option value="all">All Stages</option>
        ${stageNames.map(sn => `<option value="${esc(sn)}" ${S.filterStage===sn?"selected":""}>${esc(sn)}</option>`).join("")}
      </select>
      <button class="btn btn-gold btn-sm" onclick="loadAll()">↻ Refresh</button>
      <button class="btn btn-sm" style="background:#d4f0e3;color:#166a3f" onclick="exportFilteredCSV()">⬇ Export CSV</button>
    </div>
    <div style="padding:8px 18px 0;font-size:12px;color:#888">Showing ${filtered.length} of ${all.length} records</div>
    <div class="proj-table">
      ${!filtered.length ? `<div style="padding:40px;text-align:center;color:#aaa;font-size:13px">No records match the selected filters.</div>` : ""}
      ${filtered.map(p => {
        const pc = projPct(p), st = projStatus(p), pr = p.project||{}, prop = p.proposal||{};
        const cCls = { done:"chip-done", active:"chip-active", proposal:"chip-proposal", allocated:"chip-allocated" }[st] || "chip-new";
        const cTxt = { done:"Completed", active:"In Progress", proposal:"Proposal", allocated:"Allocated" }[st] || "Not Started";
        const link = projectLink(p.id);
        const activeStage = (p.stages||[]).find(s => { const sv=s.status||""; return sv&&!["received","approved","completed","completed-signed","approved-bcc"].includes(sv); });
        const stageDisp = activeStage ? (STATUS_DISPLAY[activeStage.status||""]||STATUS_DISPLAY[""]) : null;
        const reapps = prop.reapprovals||[];
        return `<div class="proj-row" onclick="openProject('${p.id}')">
          <div class="proj-row-top">
            <div>
              <div class="proj-row-title">${esc(pr.title||"Unnamed Project")}</div>
              <div class="proj-row-meta">${esc(pr.client||"No client")} &nbsp;·&nbsp; ${esc(pr.location||"—")} &nbsp;·&nbsp; Unit: ${esc(pr.unit||"—")}${pr.coordinator?" &nbsp;·&nbsp; <strong>"+esc(pr.coordinator)+"</strong>":""}</div>
              <div style="margin-top:5px;display:flex;gap:5px;flex-wrap:wrap">
                <span class="status-chip ${cCls}">${cTxt}</span>
                <span class="status-chip chip-new">${esc(p.createdAt||"")}</span>
                ${activeStage?`<span class="status-chip" style="background:#eef4ff;color:#1a3a5c;font-size:10px">📍 ${esc(activeStage.name)}: <span class="badge ${stageDisp.cls}" style="font-size:9px;padding:1px 6px">${stageDisp.label}</span></span>`:""}
                ${prop.quotationNumber?`<span class="status-chip" style="background:#e8f4ff;color:#1a5276">📄 ${esc(prop.quotationNumber)}</span>`:""}
                ${reapps.length?`<span class="status-chip" style="background:#fde8d8;color:#a04800">🔄 ${reapps.length} Re-approval(s)</span>`:""}
              </div>
            </div>
            <div class="proj-row-right">
              <div class="proj-pct">${pc}%</div>
              <div class="mini-bar-bg"><div class="mini-bar-fill" style="width:${pc}%"></div></div>
            </div>
          </div>
          <div class="proj-row-btns" onclick="event.stopPropagation()">
            <button class="btn btn-sm btn-navy" onclick="copyText('${link}')">Copy Client Link</button>
            <button class="btn btn-sm btn-gold" onclick="openProject('${p.id}')">Edit Project</button>
            <button class="btn btn-sm" style="background:#f0f0f0;color:#555" onclick="window.open('${link}','_blank')">View as Client</button>
          </div>
        </div>`;
      }).join("")}
    </div>`;
  } else if (S.adminTab === "activity") {
    const rows = _activityRows || [];
    const moduleColors = { Proposals:"#9b59b6", Coordinator:"#27ae60", Account:"#5b8dee", Users:"#e8a060" };
    const mf = S.activityModule || "all";
    const filtered = mf === "all" ? rows : rows.filter(r => r.module === mf);
    h += `<div class="search-bar">
      <select class="filter-sel" onchange="S.activityModule=this.value;render()">
        <option value="all" ${mf==="all"?"selected":""}>All Modules</option>
        ${["Proposals","Coordinator","Account","Users"].map(m=>`<option value="${m}" ${mf===m?"selected":""}>${m}</option>`).join("")}
      </select>
      <button class="btn btn-gold btn-sm" onclick="loadActivity()">↻ Refresh</button>
      <div style="margin-left:auto;font-size:12px;color:#888;align-self:center">${filtered.length} entries</div>
    </div>
    <div style="padding:10px 18px">
      ${!filtered.length ? `<div style="padding:40px;text-align:center;color:#aaa;font-size:13px">No activity recorded yet.</div>` : ""}
      ${filtered.map(r=>{
        const col = moduleColors[r.module] || "#888";
        return `<div class="prop-card" style="border-left:4px solid ${col}">
          <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start">
            <div style="flex:1">
              <div style="font-size:13px;color:#1a1a1a"><b>${esc(r.action||"")}</b>${r.target?` — ${esc(r.target)}`:""}</div>
              <div style="font-size:11px;color:#888;margin-top:3px">
                <span style="background:${col}22;color:${col};padding:1px 7px;border-radius:7px;font-weight:600">${esc(r.module||"")}</span>
                &nbsp;by ${esc(r.by||"—")}${r.role?` <span style="color:#bbb">(${esc(r.role)})</span>`:""}
                ${r.detail?` · ${esc(r.detail)}`:""}
              </div>
            </div>
            <div style="font-size:11px;color:#999;white-space:nowrap">${fmtDateTime(r.at)}</div>
          </div>
        </div>`;
      }).join("")}
    </div>`;
  }

  h += `<div class="footer">Winner Holistic Consultants &nbsp;·&nbsp; Admin Dashboard &nbsp;·&nbsp; <a href="." style="color:#888">Logout</a></div>`;
  return h;
}


// ── Activity log (combined, cross-module) ─────────────────────
let _activityRows = null;
async function loadActivity() {
  document.getElementById("app").innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  _activityRows = (typeof getActivityLog === "function") ? await getActivityLog(null, 300) : [];
  S.adminTab = "activity"; render();
}
