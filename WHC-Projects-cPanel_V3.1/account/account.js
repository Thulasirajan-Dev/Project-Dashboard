// ============================================================
//  Winner Holistic Consultants – Account / Admin Module
//  account/account.js
//  Depends on: shared/shared.js
// ============================================================

var _lastFilteredProjects = [];

// ── Load all projects ─────────────────────────────────────────
async function loadAll(silent) {
  if (!silent) document.getElementById("app").innerHTML = `<div class="loading"><div class="spinner"></div><div style="font-size:13px;color:var(--text-muted)">Loading all projects...</div></div>`;
  try {
    ALL_PROJECTS = (await fbGet(coPath("projects"), { fresh: true })) || {};
    Object.keys(ALL_PROJECTS).forEach(id => { ALL_PROJECTS[id] = migrateProject(ALL_PROJECTS[id]); });
  } catch (e) {
    ALL_PROJECTS = {};
  }
  S.mode = "admin";
  try { render(); }
  catch (e) {
    // Never leave the user stuck on the spinner — show the error instead.
    document.getElementById("app").innerHTML =
      `<div style="padding:40px;text-align:center;color:#a33"><b>Something went wrong loading this view.</b><br>
       <span style="font-size:12px;color:var(--text-muted)">${(e && e.message) ? String(e.message).replace(/[<>]/g,"") : "Unknown error"}</span></div>`;
    console.error("Account render error:", e);
  }
}

async function openProject(id, targetTab, readOnly) {
  document.getElementById("app").innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  // Fetch fresh (bypass the 15s client cache) so the snapshot used for the
  // diff-based save below reflects the true current state.
  const data = await fbGet(coPath("projects/" + id), { fresh: true });
  if (data) {
    PROJ = migrateProject(data);
    _projSnapshot = JSON.parse(JSON.stringify(PROJ));
    ALL_PROJECTS[id] = PROJ; // keep the list view in sync with what we just fetched
    S.mode = "project";
    S.tab = targetTab || S.tab || "proj";
    // Account users opening from All Records get a reference-only view.
    S.projReadOnly = !!readOnly;
    render();
  }
}

// _projSnapshot is declared once in coordinator.js (loaded before this file).
// We reference that shared global directly — no redeclaration here.
async function saveProj() {
  if (!PROJ) return; S.saving = true; render();
  const isEdit = !!PROJ.createdAt;
  const snapshot = _projSnapshot;
  stampAudit(PROJ, isEdit);
  syncWorkflowStatus(PROJ);
  const ok = await saveProjectDiff(PROJ.id, snapshot, PROJ);
  if (ok) {
    await logProjectChanges("Account", isEdit ? snapshot : null, PROJ, PROJ.project?.title || PROJ.id);
    _projSnapshot = JSON.parse(JSON.stringify(PROJ));
    ALL_PROJECTS[PROJ.id] = PROJ;
  }
  S.saving = false; S.saved = ok; render();
  setTimeout(() => { S.saved = false; render(); }, 2500);
}

async function confirmDelete() {
  if (!PROJ) return;
  const title = PROJ.project?.title || PROJ.id;
  await fbDelete(coPath("projects/" + PROJ.id));
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
      activeStage?activeStage.name:"", p.createdAt||"", projectLink(p)
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
              <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:3px">${esc(projTitle(p)||"Unnamed")}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-bottom:5px">${esc(pr.client||"—")} · ${esc(pr.location||"—")} · Unit: ${esc(pr.unit||"—")}${pr.coordinator?" · <strong>"+esc(pr.coordinator)+"</strong>":""}</div>
              <div style="display:flex;gap:5px;flex-wrap:wrap">
                <span class="status-chip ${cCls}">${cTxt}</span>
                ${prop.quotationNumber?`<span class="status-chip" style="background:#e8f4ff;color:#1a5276">📄 ${esc(prop.quotationNumber)}</span>`:""}
              </div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:13px;font-weight:700;color:var(--text)">${pc}%</div>
              <div class="mini-bar-bg" style="margin-top:4px"><div class="mini-bar-fill" style="width:${pc}%"></div></div>
              <div style="font-size:10px;color:var(--text-muted);margin-top:3px">Tap to open →</div>
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
    const link = projectLink(PROJ);
    overlay += `<div class="overlay"><div class="modal">
      <h3>Project Link</h3>
      <div style="font-size:11px;font-family:monospace;background:var(--surface-2);padding:10px;border-radius:8px;word-break:break-all;margin-bottom:12px">${link}</div>
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
        <button class="btn" style="background:var(--surface-2);color:#666" onclick="S.modal=null;render()">Cancel</button>
        <button class="btn btn-red" onclick="confirmDelete()">Delete Permanently</button>
      </div>
    </div></div>`;
  }
  return overlay;
}

// ── Milestone helpers ─────────────────────────────────────────
// Post a follow-up reply from the Account awaiting view.
async function _postFollowupAcct(projectId, gi, mi, inputId) {
  const el = document.getElementById(inputId);
  const text = el ? el.value : "";
  if (!(text || "").trim()) return;
  const ok = await postMilestoneFollowup(projectId, gi, mi, text);
  if (ok) { if (el) el.value = ""; render(); }
  else alert("Could not post the reply. Please try again.");
}

// Save a shared follow-up note onto a specific quotation-group milestone.
// Persisted immediately so it's visible to the coordinator too.

// Account action: mark a specific quotation-group milestone as credited.
// Writes back into ALL_PROJECTS and persists; records who credited it and when.

// Team-wide: ALL payment milestones across all projects and their quotation
// groups. A milestone marked "Done" but not credited is awaiting the Account team.
function _allMilestoneRows() {
  const rows = [];
  Object.values(ALL_PROJECTS || {}).forEach(p => {
    (p.quotationGroups || []).forEach((g, gi) => {
      const total = g.contractTotal || 0;
      (g.milestones || []).forEach((m, mi) => {
        // Always recompute live from the CURRENT contractTotal and pct —
        // same approach Coordinator's view uses — rather than trusting the
        // stored m.amount snapshot, which is only as fresh as the last
        // time the quotation group was rebuilt. This is what was causing
        // Account to sometimes show a value Proposals had already changed.
        rows.push({ p, g, gi, mi, l: Object.assign({}, m,
          { amount: milestoneAmount(m, total) }) });
      });
    });
  });
  return rows;
}
// Per-member: only milestones owned by the logged-in user (used by My Milestones).
function _myMilestoneRows() {
  const sess = (CURRENT_USER || getSession() || {});
  const myEmail = (sess.email || "").toLowerCase();
  const myName  = sess.name || "";
  return _allMilestoneRows().filter(r => {
    const o = r.l.owner;
    if (!o) return false;
    return (myEmail && String(o).toLowerCase() === myEmail) || (myName && o === myName);
  });
}
// Awaiting = milestone Account still needs to act on: Invoice Pending
// (Coordinator raised it, Account hasn't touched it) or Invoice Raised
// (Account sent the invoice, waiting on payment) — not yet Credited.
function _isAwaiting(l) {
  return typeof isAwaitingAccount === "function" ? isAwaitingAccount(l) : (l.status || "pending") !== "credited";
}
function _awaitingCount() {
  try { return _allMilestoneRows().filter(r => _isAwaiting(r.l)).length; }
  catch (e) { return 0; }
}
// My Milestones count (pending only, per member).
function _myCount() {
  try { return _myMilestoneRows().filter(r => r.l.status !== "credited").length; } catch (e) { return 0; }
}

// ── Main admin dashboard render ───────────────────────────────
// Called by the milestone search box — searches across every project's
// milestones (name, project title, client, quotation number, owner) and
// switches into a dedicated search-results view with inline-editable rows,
// so a match can be acted on directly without navigating into the project.
function _searchMilestones(query) {
  S.milestoneSearch = query;
  if (query && query.trim()) {
    S.adminTab = "milestoneSearch";
  } else if (S.adminTab === "milestoneSearch") {
    S.adminTab = "byStatus";
  }
  render();
  // render() rebuilds the whole page's HTML, which would otherwise kick
  // focus out of this input after every single keystroke — put it back
  // and restore the cursor position.
  const el = document.getElementById("acct-milestone-search");
  if (el) { el.focus(); const p = el.value.length; el.setSelectionRange(p, p); }
}

// Saves one row's edited fields (status, invoice no, date raised, payment
// ref) directly from the milestone search results — cross-project safe
// (writes to ALL_PROJECTS[projectId], not the single currently-open PROJ),
// since search results can span many different projects at once.
async function _searchSaveMilestoneRow(ridx) {
  const r = (S._milestoneSearchRows || [])[ridx];
  if (!r) return;
  const proj = ALL_PROJECTS[r.p.id];
  const ms = proj && proj.quotationGroups && proj.quotationGroups[r.gi] && proj.quotationGroups[r.gi].milestones[r.mi];
  if (!ms) return;

  const statusVal = (document.getElementById(`sms-status-${ridx}`) || {}).value || "Open";
  const invNo = (document.getElementById(`sms-inv-${ridx}`) || {}).value || "";
  const dateRaised = (document.getElementById(`sms-date-${ridx}`) || {}).value || "";
  const paymentRef = (document.getElementById(`sms-ref-${ridx}`) || {}).value || "";

  if (statusVal === "credited" && ms.status !== "credited") {
    const willHold = !!ms.isCompletedScopePayment && !isProjectOnHold(proj);
    const confirmMsg = willHold
      ? `Mark "${ms.name || "this payment"}" as credited?\n\nThis is a Completed Scope Payment — crediting it will automatically move this project to Hold.`
      : `Mark "${ms.name || "this milestone"}" as credited?`;
    if (!confirm(confirmMsg)) return;
    if (willHold) {
      const who = (CURRENT_USER || getSession() || {});
      proj.holdStatus = "hold"; proj.holdStatusAt = new Date().toISOString(); proj.holdStatusBy = who.name || who.email || "";
      try {
        await fbSet(coPath("projects/" + r.p.id + "/holdStatus"), proj.holdStatus);
        await fbSet(coPath("projects/" + r.p.id + "/holdStatusAt"), proj.holdStatusAt);
        await fbSet(coPath("projects/" + r.p.id + "/holdStatusBy"), proj.holdStatusBy);
      } catch (e) {}
    }
  }

  ms.status = statusVal;
  ms.invoiceNo = invNo;
  ms.dateRaised = dateRaised;
  ms.paymentRef = paymentRef;
  if (statusVal === "credited") {
    if (!ms.creditedDate) ms.creditedDate = new Date().toISOString();
    const who = (CURRENT_USER || getSession() || {});
    ms.creditedBy = who.email || who.name || "";
  } else {
    ms.creditedDate = ""; ms.creditedBy = "";
  }
  ms.statusSince = new Date().toISOString();

  const ok = await fbSet(coPath("projects/" + r.p.id + "/quotationGroups"), proj.quotationGroups);
  if (!ok) { alert("Could not save. Try again."); return; }
  if (typeof logActivity === "function") {
    const amt = (typeof milestoneAmount === "function") ? milestoneAmount(ms, r.g.contractTotal || 0) : (ms.amount || 0);
    const projName = projTitle(proj) || (proj.quotationGroups[0] && proj.quotationGroups[0].quotationNo) || "Untitled project";
    logActivity("Account", statusVal === "credited" ? "Credited milestone" : "Updated milestone status",
      projName, `${ms.name || "Milestone"} · ${fmtAED(amt)} · ${statusVal === "credited" ? "Credited" : statusVal}`, null, r.p.id);
  }
  render();
}

// Called by the milestone status tiles (Total/Raise Invoice/Invoice
// Raised/Attention/Credited) at the top of the Account page. A dedicated
// function rather than an inline multi-statement onclick string, so
// there's no ambiguity in what runs on click.
function _selectMilestoneTile(filterKey) {
  S.adminTab = "byStatus";
  S.milestoneStatusFilter = filterKey;
  render();
}

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
  <div class="cbar">
    <div class="clabel">${esc(getCompany().name)} · Account</div>
    <div style="margin-left:auto;display:flex;gap:8px;align-items:center">
      ${(CURRENT_USER&&CURRENT_USER.role==="super_admin")?`<button class="btn btn-sm" style="background:rgba(227,196,104,0.25);color:#e3c468;font-weight:600"
        onclick="openActivityLog('Account')">🕘 Log</button>`:""}
      <button class="btn btn-sm" style="background:rgba(255,255,255,0.12);color:#fff" onclick="loadAll()" title="Pull the latest data — e.g. after Proposals submits an edit elsewhere">↻ Refresh</button>
    </div>
  </div>`;

  // ── Milestone status tiles (click to filter) ────────────────
  {
    const allMs = _allMilestoneRows();
    const cTotal   = allMs.length;
    const cRaise   = allMs.filter(r => accountStatus(r.l) === "Invoice Pending").length;
    const cRaised  = allMs.filter(r => accountStatus(r.l) === "Invoice Raised").length;
    const cAttn    = allMs.filter(r => isMilestoneAttention(r.l)).length;
    const cCredit  = allMs.filter(r => accountStatus(r.l) === "Credited").length;
    const isByStatus = S.adminTab === "byStatus";
    const activeFilter = isByStatus ? (S.milestoneStatusFilter || "all") : null;
    const tiles = [
      { n: cTotal,  l: "Total",          icon: "📋", c: "#0d2137", f: "all",     title: "Every milestone" },
      { n: cRaise,  l: "Raise Invoice",  icon: "🧾", c: "#a06b00", f: "pending", title: "Coordinator flagged these — invoice not yet raised" },
      { n: cRaised, l: "Invoice Raised", icon: "📨", c: "#1a3a5c", f: "raised",  title: "Invoice sent, awaiting payment" },
      { n: cAttn,   l: "Attention",      icon: "⚠️", c: "#e24b4a", f: "attention", title: "Sitting in Raise Invoice / Invoice Raised for over 10 days" },
      { n: cCredit, l: "Credited",       icon: "💰", c: "#166a3f", f: "credited", title: "Payment received and credited" },
    ].map(t => Object.assign(t, { active: activeFilter === t.f, onclick: `_selectMilestoneTile('${t.f}')` }));
    h += `<div style="background:var(--surface);padding:14px 18px;border-bottom:1px solid var(--border)">${renderStatTiles(tiles)}
      <div style="margin-top:10px;position:relative">
        <input class="fi" id="acct-milestone-search" style="padding-left:32px" placeholder="Search milestones — project, client, quotation no, milestone name…"
          value="${esc(S.milestoneSearch||"")}" oninput="_searchMilestones(this.value)"/>
        <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text-muted);font-size:13px">🔍</span>
      </div>
    </div>`;
  }

  h += `<div class="admin-nav-tabs">
    <div class="admin-nav-tab ${S.adminTab==="all"?"on":""}"       onclick="S.adminTab='all';render()">📁 All Records</div>
    <div class="admin-nav-tab ${S.adminTab==="awaiting"?"on":""}"  onclick="S.adminTab='awaiting';render()">🔔 Awaiting Your Action${(() => { const n = _awaitingCount(); return n ? ` <span style="background:#e74c3c;color:#fff;font-size:10px;font-weight:700;padding:1px 7px;border-radius:10px;margin-left:2px">${n}</span>` : ""; })()}</div>
    <div class="admin-nav-tab ${S.adminTab==="mine"?"on":""}"      onclick="S.adminTab='mine';render()">💰 My Milestones${(() => { const n = _myCount(); return n ? ` <span style="background:#5b8dee;color:#fff;font-size:10px;font-weight:700;padding:1px 7px;border-radius:10px;margin-left:2px">${n}</span>` : ""; })()}</div>
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
              <div class="attn-stage">${esc(projTitle(p)||"Unnamed")}</div>
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
        ${!attention.length ? `<div class="dash-empty" style="color:var(--money-color)">✓ No stages currently blocked.</div>` : ""}
        ${attention.map(({proj,stage}) => {
          const disp = STATUS_DISPLAY[stage.status||""] || STATUS_DISPLAY[""];
          return `<div class="attn-row" onclick="openProject('${proj.id}')">
            <div class="attn-stage">${esc(stage.name)}</div>
            <div class="attn-proj">${esc(proj.project?.title||"")}</div>
            <div><span class="badge ${disp.cls}">${disp.label}</span></div>
            <span style="font-size:10px;color:var(--text-muted)">${esc(proj.project?.coordinator||"")}</span>
          </div>`;
        }).join("")}
      </div>
    </div>`;

  // ── Milestone search (from the search box above the tiles) ────
  } else if (S.adminTab === "milestoneSearch") {
    const q = (S.milestoneSearch || "").trim().toLowerCase();
    const rows = _allMilestoneRows().filter(r => {
      if (!q) return true;
      const pr = r.p.project || {};
      const hay = [r.l.name, projTitle(r.p), pr.client, pr.clientName, r.g && r.g.quotationNo, r.l.owner, r.l.invoiceNo]
        .filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
    S._milestoneSearchRows = rows; // so _searchSaveMilestoneRow can map an index back to {p,g,gi,mi}

    h += `<div class="admin-body">
      <div class="dash-card" style="margin-bottom:12px;border-left:4px solid #5b3df5">
        <div class="dash-card-title">Search: "${esc(S.milestoneSearch||"")}"</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${rows.length} match${rows.length===1?"":"es"}. Edit and save directly below — no need to open the project.</div>
      </div>`;
    if (!rows.length) {
      h += `<div class="dash-card"><div class="dash-empty" style="padding:30px;text-align:center;color:var(--text-muted);font-size:14px">No milestones match "${esc(S.milestoneSearch||"")}".</div></div>`;
    } else {
      rows.forEach((r, ridx) => {
        const pr = r.p.project || {};
        const st = accountStatus(r.l);
        const sty = ACCOUNT_STATUS_STYLE[st];
        h += `<div class="dash-card" style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px;cursor:pointer" onclick="openProject('${r.p.id}','lpo')">
            <div style="min-width:0">
              <div style="font-weight:700;font-size:14px;color:#1a2740">${esc(r.l.name||"Milestone")}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${esc(projTitle(r.p)||r.p.id)}${pr.client?` · ${esc(pr.client)}`:""}${r.g&&r.g.quotationNo?` · Qtn ${esc(r.g.quotationNo)}`:""}</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-weight:700;color:var(--text);font-size:14px">${fmtAED(r.l.amount||0)}</div>
              <span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;background:${sty.bg};color:${sty.color}">${sty.icon} ${st}</span>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;align-items:end" onclick="event.stopPropagation()">
            <div>
              <div class="fl">Status</div>
              <select class="fi" id="sms-status-${ridx}" style="font-size:12px">
                <option value="Open" ${st==="Open"?"selected":""}>Open</option>
                <option value="Invoice Pending" ${st==="Invoice Pending"?"selected":""}>⏳ Invoice Pending</option>
                <option value="Invoice Raised" ${st==="Invoice Raised"?"selected":""}>📨 Invoice Raised</option>
                <option value="credited" ${st==="Credited"?"selected":""}>✓ Credited</option>
              </select>
            </div>
            <div>
              <div class="fl">Invoice No.</div>
              <input class="fi" id="sms-inv-${ridx}" style="font-size:12px" value="${esc(r.l.invoiceNo||"")}"/>
            </div>
            <div>
              <div class="fl">Date Raised</div>
              <input class="fi" id="sms-date-${ridx}" type="date" style="font-size:12px" value="${esc(r.l.dateRaised||"")}"/>
            </div>
            <div>
              <div class="fl">Payment Ref</div>
              <input class="fi" id="sms-ref-${ridx}" style="font-size:12px" value="${esc(r.l.paymentRef||"")}"/>
            </div>
            <button class="btn btn-sm btn-gold" style="padding:9px" onclick="_searchSaveMilestoneRow(${ridx})">💾 Save</button>
          </div>
        </div>`;
      });
    }
    h += `</div>`;

  // ── By status (from the milestone tiles above) ────────────────
  } else if (S.adminTab === "byStatus") {
    const filterKey = S.milestoneStatusFilter || "all";
    const filterLabel = { all: "Total", pending: "Raise Invoice", raised: "Invoice Raised", attention: "Attention", credited: "Credited" }[filterKey] || "Total";
    const rows = _allMilestoneRows().filter(r => {
      if (filterKey === "all") return true;
      if (filterKey === "pending") return accountStatus(r.l) === "Invoice Pending";
      if (filterKey === "raised") return accountStatus(r.l) === "Invoice Raised";
      if (filterKey === "credited") return accountStatus(r.l) === "Credited";
      if (filterKey === "attention") return isMilestoneAttention(r.l);
      return true;
    });
    rows.sort((a,b) => (b.l.statusSince||b.l.dateRaised||"").localeCompare(a.l.statusSince||a.l.dateRaised||""));

    h += `<div class="admin-body">
      <div class="dash-card" style="margin-bottom:12px;border-left:4px solid #5b3df5">
        <div class="dash-card-title">${esc(filterLabel)} Milestones</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${rows.length} milestone${rows.length===1?"":"s"}.</div>
      </div>`;
    if (!rows.length) {
      h += `<div class="dash-card"><div class="dash-empty" style="padding:30px;text-align:center;color:var(--text-muted);font-size:14px">No milestones match this status.</div></div>`;
    } else {
      h += `<div class="dash-card" style="padding:0"><div style="display:flex;flex-direction:column">`;
      rows.forEach(r => {
        const pr = r.p.project || {};
        const ownerLbl = r.l.owner ? (typeof _ownerLabel==="function" ? _ownerLabel(r.l.owner) : r.l.owner) : "Unassigned";
        const st = accountStatus(r.l);
        const sty = ACCOUNT_STATUS_STYLE[st];
        const attn = isMilestoneAttention(r.l);
        const daysIn = r.l.statusSince ? Math.floor((Date.now() - new Date(r.l.statusSince).getTime()) / 86400000) : null;
        h += `<div style="padding:12px 16px;border-bottom:1px solid #f0f0f3;cursor:pointer" onclick="openProject('${r.p.id}','lpo')">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:14px;color:#1a2740">${esc(r.l.name || "Milestone")}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                ${esc(projTitle(r.p) || r.p.id)}${pr.client?` · ${esc(pr.client)}`:""}
                · <span style="color:#5b3df5">👤 ${esc(ownerLbl)}</span>${r.g&&r.g.quotationNo?` · <span style="color:var(--text-muted)">Qtn ${esc(r.g.quotationNo)}</span>`:""}
                ${daysIn!=null?` · <span style="color:${attn?'#e24b4a':'#aaa'};font-weight:${attn?700:400}">${daysIn}d in status</span>`:""}
              </div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-weight:700;color:var(--text);font-size:14px">${fmtAED(r.l.amount||0)}</div>
              <span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;background:${sty.bg};color:${sty.color};white-space:nowrap">${sty.icon} ${st}${attn?' ⚠️':''}</span>
            </div>
            <div style="color:#c9a752;font-size:18px;flex-shrink:0">›</div>
          </div>
        </div>`;
      });
      h += `</div></div>`;
    }
    h += `</div>`;

  // ── Awaiting Action (team-wide open/in-progress milestones) ──
  } else if (S.adminTab === "awaiting") {
    // Team-wide: every not-yet-credited milestone, same list for everyone.
    const rows = _allMilestoneRows().filter(r => _isAwaiting(r.l));
    rows.sort((a,b) => (a.l.dateRaised||"").localeCompare(b.l.dateRaised||""));

    h += `<div class="admin-body">
      <div class="dash-card" style="margin-bottom:12px;border-left:4px solid #e74c3c">
        <div class="dash-card-title">🔔 Milestones Awaiting Credit</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
          All open / in-progress milestones across the team that still need crediting. ${rows.length} pending.
        </div>
      </div>`;

    if (!rows.length) {
      h += `<div class="dash-card"><div class="dash-empty" style="padding:30px;text-align:center;color:#27ae60;font-size:14px">✓ No milestones are awaiting credit.</div></div>`;
    } else {
      h += `<div class="dash-card" style="padding:0">
        <div style="display:flex;flex-direction:column">`;
      rows.forEach(r => {
        const pr = r.p.project || {};
        const ownerLbl = r.l.owner ? (typeof _ownerLabel==="function" ? _ownerLabel(r.l.owner) : r.l.owner) : "Unassigned";
        h += `<div style="padding:12px 16px;border-bottom:1px solid #f0f0f3">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
            <div style="flex:1;min-width:0;cursor:pointer" onclick="openProject('${r.p.id}','lpo')">
              <div style="font-weight:600;font-size:14px;color:#1a2740">${esc(r.l.name || "Milestone")}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                ${esc(projTitle(r.p) || r.p.id)}${pr.client?` · ${esc(pr.client)}`:""}
                · <span style="color:#5b3df5">👤 ${esc(ownerLbl)}</span>${r.g&&r.g.quotationNo?` · <span style="color:var(--text-muted)">Qtn ${esc(r.g.quotationNo)}</span>`:""}
              </div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-weight:700;color:var(--text);font-size:14px">${fmtAED(r.l.amount||0)}</div>
              ${(() => { const st = accountStatus(r.l); const sty = ACCOUNT_STATUS_STYLE[st]; return `<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;background:${sty.bg};color:${sty.color};white-space:nowrap">${sty.icon} ${st}</span>`; })()}
            </div>
            <div style="color:#c9a752;font-size:18px;flex-shrink:0">›</div>
          </div>
          <div style="margin-top:8px;background:var(--surface-2);border-radius:6px;padding:6px 8px">
            <div style="font-size:10px;color:var(--text-muted);font-weight:600;margin-bottom:2px">📣 Follow-up thread</div>
            ${renderFollowupThread(r.l)}
            <div style="display:flex;gap:6px;align-items:center;margin-top:4px">
              <input class="fi" id="aftin_${r.gi}_${r.mi}" style="flex:1;margin:0;font-size:11px" placeholder="Reply to the coordinator…"/>
              <button class="btn btn-sm btn-gold" onclick="_postFollowupAcct('${r.p.id}',${r.gi},${r.mi},'aftin_${r.gi}_${r.mi}')">Reply</button>
            </div>
          </div>
        </div>`;
      });
      h += `</div></div>`;
    }
    h += `</div>`;

  // ── My Milestones tab (cross-project, owned by me) ────────────
  } else if (S.adminTab === "mine") {
    const sess = (CURRENT_USER || getSession() || {});
    const myName  = sess.name || "";
    // Only the current user's PENDING milestones (not yet credited).
    const allMine = _myMilestoneRows();
    const shown = allMine.filter(r => r.l.status !== "credited");
    const pendVal = shown.reduce((a, r) => a + (Number(r.l.amount) || 0), 0);

    h += `<div class="admin-body">
      <div class="dash-card" style="margin-bottom:12px">
        <div class="dash-card-title">💰 My Milestones — ${esc(myName || "Account user")} <span style="font-size:11px;color:var(--text-muted);font-weight:400">pending only</span></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin:6px 0 0">
          <div class="lpo-kpi"><div class="lpo-kpi-n" style="color:#e0a000">${fmtAED(pendVal)}</div><div class="lpo-kpi-l">Awaiting credit (${shown.length})</div></div>
        </div>
      </div>`;

    if (!shown.length) {
      h += `<div class="dash-card"><div class="dash-empty">${allMine.length? "Nothing pending — all your milestones are credited." : "No milestones are assigned to you yet."}</div></div>`;
    } else {
      h += `<div class="dash-card"><div style="display:flex;flex-direction:column;gap:8px">`;
      shown.forEach(r => {
        const pr = r.p.project || {};
        h += `<div class="attn-row" style="cursor:pointer" onclick="openProject('${r.p.id}','lpo')">
          <div style="flex:1">
            <div class="attn-stage">${esc(r.l.name || "Milestone")} · <span style="color:var(--text-muted);font-weight:400">${esc(projTitle(r.p) || r.p.id)}</span></div>
            <div style="font-size:11px;color:var(--text-muted)">${esc(pr.client||"")}${pr.coordinator?" · Coordinator: "+esc(pr.coordinator):""}</div>
          </div>
          <div style="text-align:right">
            <div style="font-weight:700;color:var(--text)">${fmtAED(r.l.amount||0)}</div>
            ${(() => { const st = accountStatus(r.l); const sty = ACCOUNT_STATUS_STYLE[st]; return `<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;background:${sty.bg};color:${sty.color}">${sty.icon} ${st}</span>`; })()}
          </div>
        </div>`;
      });
      h += `</div></div>`;
    }
    h += `</div>`;

  // ── All Records tab ───────────────────────────────────────
  } else if (S.adminTab === "all") {
    const stageNames = ["Project Scope Analysis and Requirement Collection","Project Registration","ADM and CD-FLS – Drawing Preparation","ADM & CD-FLS Approval","TAQA Drawing Preparation","TAQA Drawing Approval","ADCD Shop Drawing Preparation","ADCD Shop Drawing Approval","Work Start Notice Approval","Commencement of Site Work","TAQA Inspection Approval","Hassantuk & AMC Application Submission Initiation","ADCD Inspection","ADM Completion Inspection","GIS Approval","Project Fully Completed"];
    _lastFilteredProjects = filtered;

    h += `<div class="search-bar">
      <input class="search-input" id="acc-search" placeholder="Search project, client, unit, coordinator..."
        value="${esc(S.search)}" oninput="S.search=this.value;render();_refocusSearch('acc-search')"/>
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
      <button class="btn btn-gold btn-sm" onclick="loadAll()">${svgIcon('refresh',14,'#fff')} Refresh</button>
      <button class="btn btn-sm" style="background:#d4f0e3;color:#166a3f" onclick="exportFilteredCSV()">⬇ Export CSV</button>
    </div>
    <div style="padding:8px 18px 0;font-size:12px;color:var(--text-muted)">Showing ${filtered.length} of ${all.length} records</div>
    <div class="proj-table">
      ${!filtered.length ? `<div style="padding:40px;text-align:center;color:var(--text-muted);font-size:13px">No records match the selected filters.</div>` : ""}
      ${filtered.map(p => {
        const pc = projPct(p), st = projStatus(p), pr = p.project||{}, prop = p.proposal||{};
        const cCls = { done:"chip-done", active:"chip-active", proposal:"chip-proposal", allocated:"chip-allocated" }[st] || "chip-new";
        const cTxt = { done:"Completed", active:"In Progress", proposal:"Proposal", allocated:"Allocated" }[st] || "Not Started";
        const link = projectLink(p);
        const activeStage = (p.stages||[]).find(s => { const sv=s.status||""; return sv&&!["received","approved","completed","completed-signed","approved-bcc"].includes(sv); });
        const stageDisp = activeStage ? (STATUS_DISPLAY[activeStage.status||""]||STATUS_DISPLAY[""]) : null;
        const reapps = prop.reapprovals||[];
        return `<div class="proj-row" onclick="openProject('${p.id}','lpo')">
          <div class="proj-row-top">
            <div>
              <div class="proj-row-title">${esc(projTitle(p)||"Unnamed Project")}</div>
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
            <button class="btn btn-sm btn-gold" onclick="openProject('${p.id}','lpo')">Edit Project</button>
            <button class="btn btn-sm" style="background:var(--surface-2);color:var(--text-muted)" onclick="window.open('${link}','_blank')">View as Client</button>
          </div>
        </div>`;
      }).join("")}
    </div>`;
  }

  h += `<div class="footer">${esc(getCompany().name)} &nbsp;·&nbsp; Admin Dashboard &nbsp;·&nbsp; <a href="#" style="color:var(--text-muted)" onclick="event.preventDefault();serverLogout().then(()=>window.location.href='/auth/')">Logout</a></div>`;
  return h;
}
