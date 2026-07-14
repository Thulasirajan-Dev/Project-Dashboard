// ============================================================
//  Winner Holistic Consultants – Overall Summary
//  summary-dashboard.js
//  Depends on: shared/shared.js
// ============================================================

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const CATEGORIES = ["Live Folder","Fitout Folder","ID Folder","Private Folder"];
const CAT_KEYS   = { "Live Folder":"live","Fitout Folder":"fitout","ID Folder":"id","Private Folder":"private" };
const CAT_COLORS = {
  "Live Folder":    { bg:"#e8f0fe", color:"#1a5276", badge:"#5b8dee" },
  "Fitout Folder":  { bg:"#d4f0e3", color:"#166a3f", badge:"#27ae60" },
  "ID Folder":      { bg:"#fde8d8", color:"#a04800", badge:"#e8a060" },
  "Private Folder": { bg:"#f0e8fe", color:"#4a1fb8", badge:"#9b59b6" }
};

// ── Load all quotation data from Firebase ─────────────────────
async function loadSummaryData() {
  const [fitout, live, id, priv, summaryCounters, projects] = await Promise.all([
    fbGet("quotations/fitout"),
    fbGet("quotations/live"),
    fbGet("quotations/id"),
    fbGet("quotations/private"),
    fbGet("summary"),
    fbGet("projects", { fresh: true })
  ]);

  // Aggregate LPO totals across all projects (raised vs credited). Reads
  // from quotationGroups[].milestones — the real data source — not the
  // dead legacy p.lpos array (never populated by the actual award
  // pipeline), which was silently making this whole KPI block report zero.
  const projList = Object.values(projects || {});
  let lpoRaised = 0, lpoCredited = 0, lpoPending = 0, lpoCount = 0, projWithLpo = 0;
  projList.forEach(p => {
    const flat = [];
    (p.quotationGroups || []).forEach(g => {
      const gt = g.contractTotal || 0;
      (g.milestones || []).forEach(m => flat.push({
        amount: (typeof milestoneAmount === "function") ? milestoneAmount(m, gt) : (m.amount || 0),
        status: ((typeof accountStatus === "function") ? accountStatus(m) : m.status) === "Credited" ? "credited" : "pending"
      }));
    });
    const t = lpoTotals(flat);
    if (t.count > 0) projWithLpo++;
    lpoRaised += t.raised; lpoCredited += t.credited; lpoPending += t.pending; lpoCount += t.count;
  });

  return {
    "Fitout Folder": Object.values(fitout || {}),
    "Live Folder":   Object.values(live   || {}),
    "ID Folder":     Object.values(id     || {}),
    "Private Folder":Object.values(priv   || {}),
    summaryCounters: summaryCounters || {},
    lpo: { raised: lpoRaised, credited: lpoCredited, pending: lpoPending, count: lpoCount, projects: projWithLpo },
    _projects: projList
  };
}

// ── Compute KPIs from raw records ─────────────────────────────
function computeKPIs(allData) {
  const kpis = {};
  CATEGORIES.forEach(cat => {
    const records = allData[cat] || [];
    const converted = records.filter(r => ["Converted","Won"].includes(r.open_status));
    kpis[cat] = {
      total_inquiries: records.length,
      confirmed:       converted.length,
      net_value:       converted.reduce((s, r) => s + (parseFloat(r.net_amount) || 0), 0),
      open:            records.filter(r => r.open_status === "Open").length,
      lost:            records.filter(r => ["Lost","Closed"].includes(r.open_status)).length,
      lpo_received:    records.filter(r => r.lpo_received === "Y").length,
      sub_adm:         converted.reduce((s, r) => s + (parseFloat(r.sub_adm) || 0), 0),
      sub_adcd:        converted.reduce((s, r) => s + (parseFloat(r.sub_adcd) || 0), 0),
      sub_addc:        converted.reduce((s, r) => s + (parseFloat(r.sub_addc) || 0), 0),
      freelancer:      converted.reduce((s, r) => s + (parseFloat(r.freelancer) || 0), 0),
    };
  });
  return kpis;
}

// ── Build monthly breakdown table ─────────────────────────────
function buildMonthlyRows(allData, year) {
  const yr = year || new Date().getFullYear();
  const rows = MONTHS.map((month, mi) => {
    const row = { month, year: yr };
    CATEGORIES.forEach(cat => {
      const records = (allData[cat] || []).filter(r => {
        const d = r.rfq_date || r.createdAt?.split("T")[0] || "";
        return d.startsWith(`${yr}-${String(mi + 1).padStart(2, "0")}`);
      });
      const confirmed = records.filter(r => ["Converted","Won"].includes(r.open_status));
      row[cat] = {
        inquiries: records.length,
        confirmed: confirmed.length,
        net_value: confirmed.reduce((s, r) => s + (parseFloat(r.net_amount) || 0), 0)
      };
    });
    return row;
  });
  return rows;
}

// ── Render the full summary dashboard ─────────────────────────
function renderSummaryDashboard(allData, selectedYear) {
  const kpis = computeKPIs(allData);
  const year = selectedYear || new Date().getFullYear();
  const monthlyRows = buildMonthlyRows(allData, year);

  // Totals
  const totalInquiries = CATEGORIES.reduce((s, c) => s + kpis[c].total_inquiries, 0);
  const totalConfirmed = CATEGORIES.reduce((s, c) => s + kpis[c].confirmed, 0);
  const totalValue     = CATEGORIES.reduce((s, c) => s + kpis[c].net_value, 0);
  const convRate       = totalInquiries ? Math.round(totalConfirmed / totalInquiries * 100) : 0;

  let h = `
  <div class="pbar-header">
    <div class="pbar-label">📊 Overall Summary</div>
    <div style="display:flex;gap:7px;align-items:center">
      <select data-vo-safe class="fi" style="width:auto;padding:5px 10px;font-size:12px"
        onchange="S.summaryYear=parseInt(this.value);renderSummaryPage()">
        ${[2024,2025,2026,2027].map(y =>
          `<option value="${y}" ${y===year?"selected":""}>${y}</option>`
        ).join("")}
      </select>
      <button data-vo-safe class="btn btn-sm btn-gold keep-mobile" onclick="loadAndRenderSummary()">${svgIcon('refresh',14,'#fff')} Refresh</button>
    </div>
  </div>

  <!-- ── Overall KPI strip ── -->
  <div style="padding:14px 18px;background:var(--surface);border-bottom:1px solid var(--border)">
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px">
      ${[
        { n: totalInquiries, l: "Total Inquiries",   c: "#0d2137", icon: "📩" },
        { n: totalConfirmed, l: "Jobs Confirmed",     c: "#166a3f", icon: "✅" },
        { n: convRate+"%",   l: "Conversion Rate",    c: "#a06b00", icon: "📈" },
        { n: "AED "+fmtMoney(totalValue), l: "Total Net Value", c: "#1a5276", icon: "💰" }
      ].map(k => `
        <div style="background:var(--surface-2);border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:18px;margin-bottom:4px">${k.icon}</div>
          <div style="font-size:20px;font-weight:700;color:${k.c}">${k.n}</div>
          <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-top:2px">${k.l}</div>
        </div>`).join("")}
    </div>
  </div>

  <!-- ── Account / LPO payments strip ── -->
  ${(() => {
    const projects = allData._projects || [];
    const from = S.lpoFrom || "", to = S.lpoTo || "";
    const ranged = !!(from || to);
    const inR = (d) => { d=(d||"").slice(0,10); if(!d) return false; if(from&&d<from) return false; if(to&&d>to) return false; return true; };
    // Recompute totals with optional date range on credited income.
    let raised=0, credited=0, pending=0, count=0, projs=0;
    projects.forEach(p => {
      const lpos = [];
      (p.quotationGroups || []).forEach(g => {
        const gt = g.contractTotal || 0;
        (g.milestones || []).forEach(m => lpos.push({
          amount: (typeof milestoneAmount === "function") ? milestoneAmount(m, gt) : (m.amount || 0),
          status: ((typeof accountStatus === "function") ? accountStatus(m) : m.status) === "Credited" ? "credited" : "pending",
          creditedDate: m.creditedDate || "", dateRaised: m.dateRaised || ""
        }));
      });
      if (lpos.length) projs++;
      lpos.forEach(l => {
        const amt = Number(l.amount)||0; count++;
        raised += amt;
        if (l.status === "credited") {
          const incDate = (l.creditedDate || l.dateRaised || "");
          if (!ranged || inR(incDate)) credited += amt;
        } else pending += amt;
      });
    });
    const L = { raised, credited, pending, count, projects: projs };
    const collRate = L.raised > 0 ? Math.round((L.credited / L.raised) * 100) : 0;
    const rangeTxt = ranged ? ((from||"Start")+" → "+(to||"Today")) : "All Time";
    return `<div style="padding:14px 18px;background:var(--surface);border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px">💳 Account · LPO Payments</div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:10px;color:var(--text-muted);text-transform:uppercase">From</span>
          <input type="date" value="${from}" onchange="S.lpoFrom=this.value;renderSummaryPage()"
            style="border:1px solid var(--border);border-radius:7px;padding:5px 8px;font-size:12px"/>
          <span style="font-size:10px;color:var(--text-muted);text-transform:uppercase">To</span>
          <input type="date" value="${to}" onchange="S.lpoTo=this.value;renderSummaryPage()"
            style="border:1px solid var(--border);border-radius:7px;padding:5px 8px;font-size:12px"/>
          ${ranged?`<button onclick="S.lpoFrom='';S.lpoTo='';renderSummaryPage()" style="border:none;background:var(--surface-2);color:var(--text-muted);border-radius:7px;padding:5px 10px;font-size:11px;cursor:pointer">Clear</button>`:""}
        </div>
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-bottom:8px">Credited income: ${rangeTxt}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px">
        ${[
          { n: "AED "+fmtMoney(L.raised),   l: `LPO Raised (${L.count})`, c: "#1a5276", icon: "🧾" },
          { n: "AED "+fmtMoney(L.credited), l: ranged?"Credited In Range":"Credited", c: "#166a3f", icon: "✅" },
          { n: "AED "+fmtMoney(L.pending),  l: "Pending",                 c: "#a06b00", icon: "⏳" },
          { n: collRate+"%",                l: "Collection Rate",         c: "#7b3fb8", icon: "📊" }
        ].map(k => `
          <div style="background:var(--surface-2);border-radius:10px;padding:12px;text-align:center">
            <div style="font-size:18px;margin-bottom:4px">${k.icon}</div>
            <div style="font-size:20px;font-weight:700;color:${k.c}">${k.n}</div>
            <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-top:2px">${k.l}</div>
          </div>`).join("")}
      </div>
    </div>`;
  })()}

  <div style="padding:14px 18px">

  <!-- ── Per-category KPI cards ── -->
  <div style="margin-bottom:16px">
    <div class="sbox-title" style="margin-bottom:10px">Performance by Category</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">
      ${CATEGORIES.map(cat => {
        const k = kpis[cat];
        const col = CAT_COLORS[cat];
        const rate = k.total_inquiries ? Math.round(k.confirmed / k.total_inquiries * 100) : 0;
        return `
        <div style="background:${col.bg};border-radius:12px;padding:14px;border-left:4px solid ${col.badge}">
          <div style="font-size:11px;font-weight:700;color:${col.color};margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">
            ${cat.replace(" Folder","")}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:8px">
            <div style="text-align:center">
              <div style="font-size:18px;font-weight:700;color:${col.color}">${k.total_inquiries}</div>
              <div style="font-size:9px;color:var(--text-muted)">Inquiries</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:18px;font-weight:700;color:var(--money-color)">${k.confirmed}</div>
              <div style="font-size:9px;color:var(--text-muted)">Confirmed</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:18px;font-weight:700;color:#a06b00">${rate}%</div>
              <div style="font-size:9px;color:var(--text-muted)">Rate</div>
            </div>
          </div>
          <div style="background:rgba(255,255,255,0.6);border-radius:8px;padding:8px">
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
              <span style="color:var(--text-muted)">Net Value</span>
              <span style="font-weight:700;color:var(--money-color)">AED ${fmtMoney(k.net_value)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
              <span style="color:var(--text-muted)">LPO Received</span>
              <span style="font-weight:600;color:#1a5276">${k.lpo_received}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:11px">
              <span style="color:var(--text-muted)">Open / Lost</span>
              <span style="color:var(--text-muted)">${k.open} / ${k.lost}</span>
            </div>
          </div>
          ${k.sub_adm || k.sub_adcd || k.sub_addc || k.freelancer ? `
          <div style="margin-top:8px;font-size:10px;color:var(--text-muted)">
            <div style="font-weight:600;color:${col.color};margin-bottom:3px">Sub-contractor Breakdown</div>
            ${k.sub_adm  ? `<div>ADM: AED ${fmtMoney(k.sub_adm)}</div>` : ""}
            ${k.sub_adcd ? `<div>ADCD: AED ${fmtMoney(k.sub_adcd)}</div>` : ""}
            ${k.sub_addc ? `<div>ADDC: AED ${fmtMoney(k.sub_addc)}</div>` : ""}
            ${k.freelancer ? `<div>Freelancer: AED ${fmtMoney(k.freelancer)}</div>` : ""}
          </div>` : ""}
        </div>`;
      }).join("")}
    </div>
  </div>

  <!-- ── Monthly summary table ── -->
  <div class="sbox sbox-wide">
    <div class="sbox-title">Monthly Breakdown — ${year}</div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:var(--surface-2)">
            <th style="padding:11px 10px;text-align:left;border-bottom:2px solid var(--border);color:var(--text);white-space:nowrap">Month</th>
            ${CATEGORIES.map(cat => {
              const col = CAT_COLORS[cat];
              return `<th colspan="3" style="padding:8px;text-align:center;border-bottom:2px solid ${col.badge};color:${col.color};white-space:nowrap">
                ${cat.replace(" Folder","")}</th>`;
            }).join("")}
            <th colspan="2" style="padding:8px;text-align:center;border-bottom:2px solid var(--text);color:var(--text)">Total</th>
          </tr>
          <tr style="background:var(--surface-3);font-size:11.5px;color:var(--text-muted)">
            <th style="padding:5px 8px"></th>
            ${CATEGORIES.map(() => `
              <th style="padding:5px 4px;text-align:center">Inq.</th>
              <th style="padding:5px 4px;text-align:center">Conf.</th>
              <th style="padding:5px 4px;text-align:right">AED Net</th>`).join("")}
            <th style="padding:5px 4px;text-align:center">Conf.</th>
            <th style="padding:5px 4px;text-align:right">AED Net</th>
          </tr>
        </thead>
        <tbody>
          ${monthlyRows.map((row, i) => {
            const rowTotal = CATEGORIES.reduce((s, c) => s + (row[c]?.confirmed || 0), 0);
            const rowValue = CATEGORIES.reduce((s, c) => s + (row[c]?.net_value || 0), 0);
            const isCurrentMonth = new Date().getMonth() === i && new Date().getFullYear() === year;
            return `<tr style="border-bottom:1px solid var(--border-soft);${isCurrentMonth ? "background:var(--highlight-row);" : ""}">
              <td style="padding:9px 10px;font-weight:${isCurrentMonth?"700":"400"};color:var(--text);white-space:nowrap">
                ${row.month} ${year}${isCurrentMonth ? " ◀" : ""}
              </td>
              ${CATEGORIES.map(cat => {
                const d = row[cat] || {};
                const col = CAT_COLORS[cat];
                return `
                  <td style="padding:9px 8px;text-align:center;color:var(--text-muted)">${d.inquiries || 0}</td>
                  <td style="padding:9px 8px;text-align:center">
                    ${d.confirmed ? `<span style="background:${col.bg};color:${col.color};padding:1px 6px;border-radius:8px;font-weight:600">${d.confirmed}</span>` : "—"}
                  </td>
                  <td style="padding:9px 10px;text-align:right;color:${d.net_value ? "var(--money-color)" : "var(--text-faint)"};font-weight:${d.net_value?"600":"400"}">
                    ${d.net_value ? fmtMoney(d.net_value) : "—"}
                  </td>`;
              }).join("")}
              <td style="padding:9px 8px;text-align:center;font-weight:700;color:var(--text)">${rowTotal || "—"}</td>
              <td style="padding:9px 10px;text-align:right;font-weight:700;color:var(--money-color)">${rowValue ? fmtMoney(rowValue) : "—"}</td>
            </tr>`;
          }).join("")}
        </tbody>
        <tfoot>
          <tr style="background:var(--surface-3);font-weight:700;border-top:2px solid var(--border);color:var(--text)">
            <td style="padding:8px">Total ${year}</td>
            ${CATEGORIES.map(cat => {
              const k = kpis[cat];
              const col = CAT_COLORS[cat];
              const yearInq  = monthlyRows.reduce((s,r) => s+(r[cat]?.inquiries||0),0);
              const yearConf = monthlyRows.reduce((s,r) => s+(r[cat]?.confirmed||0),0);
              const yearVal  = monthlyRows.reduce((s,r) => s+(r[cat]?.net_value||0),0);
              return `
                <td style="padding:8px 4px;text-align:center;color:var(--text-muted)">${yearInq}</td>
                <td style="padding:8px 4px;text-align:center;color:${col.color}">${yearConf}</td>
                <td style="padding:8px 4px;text-align:right;color:var(--money-color)">${yearVal ? fmtMoney(yearVal) : "—"}</td>`;
            }).join("")}
            <td style="padding:8px 4px;text-align:center;color:var(--text)">
              ${CATEGORIES.reduce((s,c)=>s+monthlyRows.reduce((ss,r)=>ss+(r[c]?.confirmed||0),0),0)}
            </td>
            <td style="padding:8px 4px;text-align:right;color:var(--money-color)">
              ${fmtMoney(CATEGORIES.reduce((s,c)=>s+monthlyRows.reduce((ss,r)=>ss+(r[c]?.net_value||0),0),0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>

  <!-- Team Performance moved to its own module — /team-performance/ -->
  <div class="sbox sbox-wide" style="margin-top:12px;text-align:center;padding:20px">
    <div style="font-size:14px;font-weight:600;color:#1a2740">🏆 Team Performance</div>
    <div style="font-size:12px;color:var(--text-muted);margin:4px 0 10px">Proposals, Coordinator &amp; Account leaderboards now have their own page.</div>
    <a href="/team-performance/" class="btn btn-gold" style="display:inline-block;text-decoration:none">Open Team Performance →</a>
  </div>

  </div>
  <div class="footer">Winner Holistic Consultants · Overall Summary · <a href="${window.location.pathname}" style="color:var(--text-muted)">Back</a></div>`;

  return h;
}

// ── Entry points called from main render ──────────────────────
async function loadAndRenderSummary() {
  document.getElementById("app").innerHTML =
    `<div class="loading"><div class="spinner"></div><div style="font-size:13px;color:var(--text-muted)">Loading summary...</div></div>`;
  S._summaryData = await loadSummaryData();
  renderSummaryPage();
}

function renderSummaryPage() {
  if (!S._summaryData) { loadAndRenderSummary(); return; }
  document.getElementById("app").innerHTML =
    renderSummaryDashboard(S._summaryData, S.summaryYear || new Date().getFullYear());
  window.scrollTo({ top: 0, behavior: "smooth" });
}
