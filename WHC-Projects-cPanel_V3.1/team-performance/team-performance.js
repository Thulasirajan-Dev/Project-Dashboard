// ============================================================
//  Winner Holistic Consultants – Team Performance
//  team-performance/team-performance.js
//  Depends on: shared/shared.js
//
//  Moved out of the Overall Summary module into its own page — this used
//  to be a "Team Performance" section rendered inline at the bottom of
//  Summary; it's now a standalone module with its own URL and sidebar entry.
// ============================================================

const CATEGORIES_TP = ["Live Folder","Fitout Folder","ID Folder","Private Folder"];

// ── Load quotations + projects needed for the three leaderboards ──
async function loadTeamPerformanceData() {
  const [fitout, live, id, priv, projects] = await Promise.all([
    fbGet("quotations/fitout"),
    fbGet("quotations/live"),
    fbGet("quotations/id"),
    fbGet("quotations/private"),
    fbGet("projects", { fresh: true })
  ]);
  return {
    "Fitout Folder": Object.values(fitout || {}),
    "Live Folder":   Object.values(live   || {}),
    "ID Folder":     Object.values(id     || {}),
    "Private Folder":Object.values(priv   || {}),
    _projects: Object.values(projects || {}).map(p => migrateProject(p))
  };
}

// ── Proposals in-charge leaderboard (inquiries / confirmed / net value) ──
function renderProposalsBlock(allData) {
  const coordMap = {};
  CATEGORIES_TP.forEach(cat => {
    (allData[cat] || []).forEach(r => {
      const pcs = [r.pc1, r.pc2, r.proposal_incharge].filter(Boolean);
      pcs.forEach(pc => {
        if (!coordMap[pc]) coordMap[pc] = { total: 0, confirmed: 0, net: 0, cats: new Set() };
        coordMap[pc].total++;
        coordMap[pc].cats.add(cat.replace(" Folder",""));
        if (["Converted","Won"].includes(r.open_status)) {
          coordMap[pc].confirmed++;
          coordMap[pc].net += parseFloat(r.net_amount) || 0;
        }
      });
    });
  });

  const entries = Object.entries(coordMap).sort((a,b) => b[1].net - a[1].net || b[1].confirmed - a[1].confirmed);
  if (!entries.length) return `<div class="sbox sbox-wide" style="margin-top:12px"><div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">No Proposals activity yet.</div></div>`;

  const teamNet = entries.reduce((s,[,d]) => s + (d.net||0), 0) || 1;
  const medals = ["🥇","🥈","🥉"];
  const avatarColors = ["#6d28d9","#2563eb","#059669","#7c3aed","#d97706","#db2777","#0891b2","#65a30d"];

  return `
  <div class="sbox sbox-wide" style="margin-top:12px">
    <div class="sbox-title">📝 Proposals Team</div>
    <div class="tp-grid">
      ${entries.map(([name, d], i) => {
        const conv = d.total ? Math.round((d.confirmed / d.total) * 100) : 0;
        const share = Math.round((d.net / teamNet) * 100);
        const col = avatarColors[i % avatarColors.length];
        const initials = name.trim().split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase();
        const rankBadge = i < 3 ? medals[i] : `#${i+1}`;
        const convColor = conv >= 50 ? "#166a3f" : conv >= 25 ? "#a06b00" : "#a32d2d";
        return `
        <div class="tp-card${i===0?" tp-top":""}">
          <div class="tp-rank">${rankBadge}</div>
          <div class="tp-head">
            <div class="tp-avatar" style="background:${col}">${esc(initials||"?")}</div>
            <div class="tp-namewrap">
              <div class="tp-name">${esc(name)}</div>
              <div class="tp-cats">${[...d.cats].join(" · ")||"—"}</div>
            </div>
          </div>
          <div class="tp-stats">
            <div class="tp-stat"><div class="tp-stat-n">${d.total}</div><div class="tp-stat-l">Inquiries</div></div>
            <div class="tp-stat"><div class="tp-stat-n" style="color:var(--money-color)">${d.confirmed}</div><div class="tp-stat-l">Confirmed</div></div>
            <div class="tp-stat"><div class="tp-stat-n" style="color:${convColor}">${conv}%</div><div class="tp-stat-l">Conversion</div></div>
          </div>
          <div class="tp-net">
            <span class="tp-net-v">AED ${fmtMoney(d.net)}</span>
            <span class="tp-net-share">${share}% of team</span>
          </div>
          <div class="tp-bar"><div class="tp-bar-fill" style="width:${share}%;background:${col}"></div></div>
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

// ── Project Coordinator members (avatar + project count) ──────
function renderCoordMembersBlock(allData) {
  const projects = allData._projects || [];
  const map = {};
  projects.forEach(p => {
    const c = (p.project && p.project.coordinator) || "";
    if (!c) return;
    if (!map[c]) map[c] = { total: 0, active: 0, done: 0 };
    map[c].total++;
    const st = (typeof projStatus === "function") ? projStatus(p) : "";
    if (st === "done") map[c].done++; else map[c].active++;
  });
  const entries = Object.entries(map).sort((a,b) => b[1].total - a[1].total);
  if (!entries.length) return `<div class="sbox sbox-wide" style="margin-top:12px"><div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">No projects assigned to a coordinator yet.</div></div>`;
  const colors = ["#6d28d9","#2563eb","#059669","#7c3aed","#d97706","#db2777","#0891b2","#65a30d"];
  const label = (v) => (typeof _coordLabel === "function") ? _coordLabel(v) : v;
  return `
  <div class="sbox sbox-wide" style="margin-top:12px">
    <div class="sbox-title">🧑‍🔧 Project Coordinators</div>
    <div class="tp-grid">
      ${entries.map(([name,d],i)=>{
        const disp = label(name);
        const col = colors[i%colors.length];
        const initials = String(disp).trim().split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase();
        return `
        <div class="tp-card">
          <div class="tp-rank">#${i+1}</div>
          <div class="tp-head">
            <div class="tp-avatar" style="background:${col}">${esc(initials||"?")}</div>
            <div class="tp-namewrap"><div class="tp-name">${esc(disp)}</div><div class="tp-cats">Coordinator</div></div>
          </div>
          <div class="tp-stats">
            <div class="tp-stat"><div class="tp-stat-n">${d.total}</div><div class="tp-stat-l">Projects</div></div>
            <div class="tp-stat"><div class="tp-stat-n" style="color:#1a5fb4">${d.active}</div><div class="tp-stat-l">Active</div></div>
            <div class="tp-stat"><div class="tp-stat-n" style="color:var(--money-color)">${d.done}</div><div class="tp-stat-l">Done</div></div>
          </div>
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

// ── Account members (avatar + milestone count owned) ──────────
// Reads from quotationGroups[].milestones (the actual live milestone
// data — see account.js _allMilestoneRows) rather than the legacy flat
// p.lpos array, which is never populated by the real award/submission
// pipeline and was silently making this whole block report zero/empty.
function renderAccountMembersBlock(allData) {
  const projects = allData._projects || [];
  const map = {};
  projects.forEach(p => {
    (p.quotationGroups || []).forEach(g => {
      const total = g.contractTotal || 0;
      (g.milestones || []).forEach(m => {
        const o = m.owner || "";
        if (!o) return;
        if (!map[o]) map[o] = { total: 0, credited: 0, pending: 0, amount: 0 };
        const amount = milestoneAmount(m, total);
        map[o].total++;
        map[o].amount += amount;
        if ((typeof accountStatus === "function" ? accountStatus(m) : m.status) === "Credited") map[o].credited++;
        else map[o].pending++;
      });
    });
  });
  const entries = Object.entries(map).sort((a,b) => b[1].total - a[1].total);
  if (!entries.length) return `<div class="sbox sbox-wide" style="margin-top:12px"><div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">No milestones assigned to an Account owner yet.</div></div>`;
  const colors = ["#059669","#2563eb","#6d28d9","#d97706","#db2777","#0891b2","#7c3aed","#65a30d"];
  const label = (v) => (typeof _ownerLabel === "function") ? _ownerLabel(v) : v;
  return `
  <div class="sbox sbox-wide" style="margin-top:12px">
    <div class="sbox-title">💰 Account Team — Milestones</div>
    <div class="tp-grid">
      ${entries.map(([name,d],i)=>{
        const disp = label(name);
        const col = colors[i%colors.length];
        const initials = String(disp).trim().split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase();
        return `
        <div class="tp-card">
          <div class="tp-rank">#${i+1}</div>
          <div class="tp-head">
            <div class="tp-avatar" style="background:${col}">${esc(initials||"?")}</div>
            <div class="tp-namewrap"><div class="tp-name">${esc(disp)}</div><div class="tp-cats">Accounts</div></div>
          </div>
          <div class="tp-stats">
            <div class="tp-stat"><div class="tp-stat-n">${d.total}</div><div class="tp-stat-l">Milestones</div></div>
            <div class="tp-stat"><div class="tp-stat-n" style="color:#a06b00">${d.pending}</div><div class="tp-stat-l">Awaiting</div></div>
            <div class="tp-stat"><div class="tp-stat-n" style="color:var(--money-color)">${d.credited}</div><div class="tp-stat-l">Credited</div></div>
          </div>
          <div class="tp-net"><span class="tp-net-v">AED ${fmtMoney(d.amount)}</span></div>
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

// ── Entry point ─────────────────────────────────────────────
async function loadAndRenderTeamPerformance() {
  document.getElementById("app").innerHTML =
    `<div class="loading"><div class="spinner"></div><div style="font-size:13px;color:var(--text-muted)">Loading team performance...</div></div>`;
  S._tpData = await loadTeamPerformanceData();
  renderTeamPerformancePage();
}

function renderTeamPerformancePage() {
  const d = S._tpData || {};
  let h = `<div class="pbar-header">
    <div class="pbar-label">🏆 Team Performance</div>
  </div>
  <div class="body">
    <div class="nb" style="margin-bottom:4px">Leaderboards for Proposals, Coordinator, and Account teams — moved here from Overall Summary so it has room to grow on its own.</div>
    ${renderProposalsBlock(d)}
    ${renderCoordMembersBlock(d)}
    ${renderAccountMembersBlock(d)}
  </div>
  <div class="footer">Winner Holistic Consultants · Team Performance</div>`;
  document.getElementById("app").innerHTML = h;
}
