// ============================================================
//  Winner Holistic Consultants – Project Payment Summary
//  payments/payments-summary.js
//  Standalone module: project-by-project LPO collection details.
//  Reads projects + their lpos[] (uses shared lpoTotals/fmtAED/fmtMoney).
//  Does NOT touch the existing Summary module.
// ============================================================

async function loadAndRenderPayments() {
  document.getElementById("app").innerHTML =
    `<div class="loading"><div class="spinner"></div><div style="font-size:13px;color:#888">Loading payments…</div></div>`;

  const projects = await fbGet("projects") || {};
  const rows = Object.values(projects).map(p => {
    const t = lpoTotals(p.lpos);
    const collRate = t.raised > 0 ? Math.round((t.credited / t.raised) * 100) : 0;
    let status = "none";
    if (t.count > 0) {
      if (t.credited >= t.raised && t.raised > 0) status = "paid";
      else if (t.credited > 0) status = "partial";
      else status = "unpaid";
    }
    return {
      id: p.id,
      title: (p.project && p.project.title) || p.id || "Untitled",
      client: (p.project && (p.project.client || p.project.clientName)) || "",
      coordinator: (p.project && p.project.coordinator) || "",
      quotation: (p.proposal && p.proposal.quotationNumber) || "",
      raised: t.raised, credited: t.credited, pending: t.pending,
      count: t.count, creditedCount: t.creditedCount,
      collRate, status,
      lpos: Array.isArray(p.lpos) ? p.lpos : []
    };
  });

  S._rows = rows;
  renderPayments();
}

function renderPayments() {
  const rows = S._rows || [];

  // Overall totals
  const tot = rows.reduce((a, r) => {
    a.raised += r.raised; a.credited += r.credited; a.pending += r.pending;
    a.projects += (r.count > 0 ? 1 : 0);
    return a;
  }, { raised:0, credited:0, pending:0, projects:0 });
  const overallRate = tot.raised > 0 ? Math.round((tot.credited / tot.raised) * 100) : 0;

  // Filter + search
  let view = rows.filter(r => r.count > 0); // only projects that have LPOs
  if (S.filterStatus !== "all") view = view.filter(r => r.status === S.filterStatus);
  if (S.search) {
    const q = S.search.toLowerCase();
    view = view.filter(r =>
      r.title.toLowerCase().includes(q) ||
      (r.client||"").toLowerCase().includes(q) ||
      (r.coordinator||"").toLowerCase().includes(q) ||
      (r.quotation||"").toLowerCase().includes(q)
    );
  }
  // Sort
  if (S.sortBy === "pending")  view.sort((a,b) => b.pending - a.pending);
  else if (S.sortBy === "raised")   view.sort((a,b) => b.raised - a.raised);
  else if (S.sortBy === "credited") view.sort((a,b) => b.credited - a.credited);
  else if (S.sortBy === "name")     view.sort((a,b) => a.title.localeCompare(b.title));

  const statusMeta = {
    paid:    { label:"Paid",        col:"#166a3f", bg:"#e6f4ec" },
    partial: { label:"Partial",     col:"#a06b00", bg:"#fdf3e0" },
    unpaid:  { label:"Unpaid",      col:"#a32d2d", bg:"#fbe9e9" },
  };

  let h = `
  <div class="pbar-header">
    <div class="pbar-label">💳 Project Payment Summary</div>
    <button class="btn btn-sm" style="background:rgba(227,196,104,0.25);color:#e3c468;font-weight:600"
      onclick="loadAndRenderPayments()">↻ Refresh</button>
  </div>

  <!-- Overall totals -->
  <div style="padding:14px 18px;background:var(--d-surface,#2e3560);border-bottom:1px solid var(--d-line,#474f86)">
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
      ${[
        { n: fmtAED(tot.raised),   l: `Total Raised (${tot.projects} projects)`, c:"#7fb4e6", icon:"🧾" },
        { n: fmtAED(tot.credited), l: "Total Credited",                          c:"#5fcf95", icon:"✅" },
        { n: fmtAED(tot.pending),  l: "Total Pending",                           c:"#e3c468", icon:"⏳" },
        { n: overallRate+"%",      l: "Collection Rate",                         c:"#c4a5f0", icon:"📊" }
      ].map(k => `
        <div style="background:var(--d-surface-2,#3a4275);border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:18px;margin-bottom:4px">${k.icon}</div>
          <div style="font-size:19px;font-weight:700;color:${k.c}">${k.n}</div>
          <div style="font-size:10px;color:var(--d-text-dim,#8b93c4);text-transform:uppercase;letter-spacing:0.5px;margin-top:2px">${k.l}</div>
        </div>`).join("")}
    </div>
  </div>

  <!-- Filters -->
  <div class="search-bar">
    <input class="search-input" placeholder="Search project, client, coordinator, quotation…"
      value="${esc(S.search)}" oninput="S.search=this.value;renderPayments()"/>
    <select class="filter-sel" onchange="S.filterStatus=this.value;renderPayments()">
      <option value="all" ${S.filterStatus==="all"?"selected":""}>All Statuses</option>
      <option value="unpaid" ${S.filterStatus==="unpaid"?"selected":""}>Unpaid</option>
      <option value="partial" ${S.filterStatus==="partial"?"selected":""}>Partial</option>
      <option value="paid" ${S.filterStatus==="paid"?"selected":""}>Paid</option>
    </select>
    <select class="filter-sel" onchange="S.sortBy=this.value;renderPayments()">
      <option value="pending" ${S.sortBy==="pending"?"selected":""}>Sort: Pending ↓</option>
      <option value="raised" ${S.sortBy==="raised"?"selected":""}>Sort: Raised ↓</option>
      <option value="credited" ${S.sortBy==="credited"?"selected":""}>Sort: Credited ↓</option>
      <option value="name" ${S.sortBy==="name"?"selected":""}>Sort: Name A–Z</option>
    </select>
    <div style="margin-left:auto;font-size:12px;color:var(--d-text-dim,#8b93c4);align-self:center">${view.length} projects</div>
  </div>

  <div style="padding:10px 16px 50px">`;

  if (!view.length) {
    h += `<div style="padding:50px;text-align:center;color:var(--d-text-dim,#8b93c4);font-size:13px">
      No projects with LPOs match. Projects appear here once the Coordinator adds an LPO.</div>`;
  }

  view.forEach(r => {
    const sm = statusMeta[r.status] || { label:"—", col:"#888", bg:"#eee" };
    const pct = r.raised > 0 ? Math.min(100, Math.round((r.credited / r.raised) * 100)) : 0;
    h += `<div class="pay-card">
      <div class="pay-card-top">
        <div style="flex:1;min-width:0">
          <div class="pay-title">${esc(r.title)}</div>
          <div class="pay-sub">${[r.client, r.coordinator?("Coord: "+r.coordinator):"", r.quotation].filter(Boolean).map(esc).join(" · ")||"—"}</div>
        </div>
        <span class="pay-status" style="background:${sm.bg};color:${sm.col}">${sm.label}</span>
      </div>
      <div class="pay-figures">
        <div><span class="pay-fl">Raised</span><span class="pay-fv">${fmtAED(r.raised)}</span><span class="pay-fc">${r.count} LPO${r.count!==1?"s":""}</span></div>
        <div><span class="pay-fl">Credited</span><span class="pay-fv" style="color:#5fcf95">${fmtAED(r.credited)}</span><span class="pay-fc">${r.creditedCount} paid</span></div>
        <div><span class="pay-fl">Pending</span><span class="pay-fv" style="color:#e3c468">${fmtAED(r.pending)}</span><span class="pay-fc">${r.collRate}% collected</span></div>
      </div>
      <div class="pay-bar"><div class="pay-bar-fill" style="width:${pct}%"></div></div>
      <details class="pay-details">
        <summary>View ${r.count} LPO${r.count!==1?"s":""}</summary>
        <div class="pay-lpo-list">
          ${r.lpos.map(l => {
            const credited = l.status === "credited";
            return `<div class="pay-lpo-row">
              <div style="flex:1">
                <div class="pay-lpo-name">${esc(l.name||"LPO")}</div>
                <div class="pay-lpo-meta">${l.dateRaised?("Raised "+fmtDateTime(l.dateRaised)):""}${l.invoiceNo?(" · Inv "+esc(l.invoiceNo)):""}${l.paymentRef?(" · Ref "+esc(l.paymentRef)):""}</div>
              </div>
              <div style="text-align:right">
                <div class="pay-lpo-amt">${fmtAED(l.amount)}</div>
                <span class="pay-lpo-chip" style="background:${credited?"#1f5135":"#5a4a1f"};color:${credited?"#9be8bb":"#f0d080"}">${credited?"✓ Credited":"⏳ Pending"}</span>
              </div>
            </div>`;
          }).join("")}
        </div>
      </details>
      <div class="pay-card-foot">
        <a href="/account/?id=${encodeURIComponent(r.id)}" class="pay-open" title="Open in Account module">Open project →</a>
      </div>
    </div>`;
  });

  h += `</div>
  <div class="footer">Winner Holistic Consultants · Project Payment Summary · <a href="/auth/" style="color:#888">Portal</a></div>`;

  document.getElementById("app").innerHTML = h;
  setupScrollTop();
}

function setupScrollTop() {
  const btn = document.getElementById("scrollTopBtn");
  if (!btn) return;
  window.onscroll = () => { btn.style.display = window.scrollY > 300 ? "flex" : "none"; };
}
