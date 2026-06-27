// ============================================================
//  Winner Holistic Consultants – Summary Dashboard
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
    fbGet("projects")
  ]);

  // Aggregate LPO totals across all projects (raised vs credited).
  const projList = Object.values(projects || {});
  let lpoRaised = 0, lpoCredited = 0, lpoPending = 0, lpoCount = 0, projWithLpo = 0;
  projList.forEach(p => {
    const t = lpoTotals(p.lpos);
    if (t.count > 0) projWithLpo++;
    lpoRaised += t.raised; lpoCredited += t.credited; lpoPending += t.pending; lpoCount += t.count;
  });

  return {
    "Fitout Folder": Object.values(fitout || {}),
    "Live Folder":   Object.values(live   || {}),
    "ID Folder":     Object.values(id     || {}),
    "Private Folder":Object.values(priv   || {}),
    summaryCounters: summaryCounters || {},
    lpo: { raised: lpoRaised, credited: lpoCredited, pending: lpoPending, count: lpoCount, projects: projWithLpo }
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
    <div class="pbar-label">📊 Summary Dashboard</div>
    <div style="display:flex;gap:7px;align-items:center">
      <button class="btn btn-sm" style="background:rgba(227,196,104,0.25);color:#e3c468;font-weight:600"
        onclick="openActivityLog('')">🕓 Log</button>
      <select class="fi" style="width:auto;padding:5px 10px;font-size:12px"
        onchange="S.summaryYear=parseInt(this.value);renderSummaryPage()">
        ${[2024,2025,2026,2027].map(y =>
          `<option value="${y}" ${y===year?"selected":""}>${y}</option>`
        ).join("")}
      </select>
      <button class="btn btn-sm btn-gold" onclick="loadAndRenderSummary()">↻ Refresh</button>
    </div>
  </div>

  <!-- ── Overall KPI strip ── -->
  <div style="padding:14px 18px;background:#fff;border-bottom:1px solid #e5e5e5">
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
      ${[
        { n: totalInquiries, l: "Total Inquiries",   c: "#0d2137", icon: "📩" },
        { n: totalConfirmed, l: "Jobs Confirmed",     c: "#166a3f", icon: "✅" },
        { n: convRate+"%",   l: "Conversion Rate",    c: "#a06b00", icon: "📈" },
        { n: "AED "+fmtMoney(totalValue), l: "Total Net Value", c: "#1a5276", icon: "💰" }
      ].map(k => `
        <div style="background:#f7f7f7;border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:18px;margin-bottom:4px">${k.icon}</div>
          <div style="font-size:20px;font-weight:700;color:${k.c}">${k.n}</div>
          <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px">${k.l}</div>
        </div>`).join("")}
    </div>
  </div>

  <!-- ── Account / LPO payments strip ── -->
  ${(() => {
    const L = allData.lpo || { raised:0, credited:0, pending:0, count:0, projects:0 };
    const collRate = L.raised > 0 ? Math.round((L.credited / L.raised) * 100) : 0;
    return `<div style="padding:14px 18px;background:#fff;border-bottom:1px solid #e5e5e5">
      <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">💳 Account · LPO Payments</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
        ${[
          { n: "AED "+fmtMoney(L.raised),   l: `LPO Raised (${L.count})`, c: "#1a5276", icon: "🧾" },
          { n: "AED "+fmtMoney(L.credited), l: "Credited",                c: "#166a3f", icon: "✅" },
          { n: "AED "+fmtMoney(L.pending),  l: "Pending",                 c: "#a06b00", icon: "⏳" },
          { n: collRate+"%",                l: "Collection Rate",         c: "#7b3fb8", icon: "📊" }
        ].map(k => `
          <div style="background:#f7f7f7;border-radius:10px;padding:12px;text-align:center">
            <div style="font-size:18px;margin-bottom:4px">${k.icon}</div>
            <div style="font-size:20px;font-weight:700;color:${k.c}">${k.n}</div>
            <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px">${k.l}</div>
          </div>`).join("")}
      </div>
    </div>`;
  })()}

  <div style="padding:14px 18px">

  <!-- ── Per-category KPI cards ── -->
  <div style="margin-bottom:16px">
    <div class="sbox-title" style="margin-bottom:10px">Performance by Category</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
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
              <div style="font-size:9px;color:#888">Inquiries</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:18px;font-weight:700;color:#166a3f">${k.confirmed}</div>
              <div style="font-size:9px;color:#888">Confirmed</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:18px;font-weight:700;color:#a06b00">${rate}%</div>
              <div style="font-size:9px;color:#888">Rate</div>
            </div>
          </div>
          <div style="background:rgba(255,255,255,0.6);border-radius:8px;padding:8px">
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
              <span style="color:#555">Net Value</span>
              <span style="font-weight:700;color:#166a3f">AED ${fmtMoney(k.net_value)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
              <span style="color:#555">LPO Received</span>
              <span style="font-weight:600;color:#1a5276">${k.lpo_received}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:11px">
              <span style="color:#555">Open / Lost</span>
              <span style="color:#555">${k.open} / ${k.lost}</span>
            </div>
          </div>
          ${k.sub_adm || k.sub_adcd || k.sub_addc || k.freelancer ? `
          <div style="margin-top:8px;font-size:10px;color:#888">
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
  <div class="sbox">
    <div class="sbox-title">Monthly Breakdown — ${year}</div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead>
          <tr style="background:#f7f7f7">
            <th style="padding:8px;text-align:left;border-bottom:2px solid #e5e5e5;white-space:nowrap">Month</th>
            ${CATEGORIES.map(cat => {
              const col = CAT_COLORS[cat];
              return `<th colspan="3" style="padding:8px;text-align:center;border-bottom:2px solid ${col.badge};color:${col.color};white-space:nowrap">
                ${cat.replace(" Folder","")}</th>`;
            }).join("")}
            <th colspan="2" style="padding:8px;text-align:center;border-bottom:2px solid #0d2137;color:#0d2137">Total</th>
          </tr>
          <tr style="background:#fafafa;font-size:10px;color:#888">
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
            return `<tr style="border-bottom:1px solid #f0f0f0;${isCurrentMonth ? "background:#fffde7;" : ""}">
              <td style="padding:7px 8px;font-weight:${isCurrentMonth?"700":"400"};color:#333;white-space:nowrap">
                ${row.month} ${year}${isCurrentMonth ? " ◀" : ""}
              </td>
              ${CATEGORIES.map(cat => {
                const d = row[cat] || {};
                const col = CAT_COLORS[cat];
                return `
                  <td style="padding:7px 4px;text-align:center;color:#555">${d.inquiries || 0}</td>
                  <td style="padding:7px 4px;text-align:center">
                    ${d.confirmed ? `<span style="background:${col.bg};color:${col.color};padding:1px 6px;border-radius:8px;font-weight:600">${d.confirmed}</span>` : "—"}
                  </td>
                  <td style="padding:7px 4px;text-align:right;color:${d.net_value ? "#166a3f" : "#ccc"};font-weight:${d.net_value?"600":"400"}">
                    ${d.net_value ? fmtMoney(d.net_value) : "—"}
                  </td>`;
              }).join("")}
              <td style="padding:7px 4px;text-align:center;font-weight:700;color:#0d2137">${rowTotal || "—"}</td>
              <td style="padding:7px 4px;text-align:right;font-weight:700;color:#166a3f">${rowValue ? fmtMoney(rowValue) : "—"}</td>
            </tr>`;
          }).join("")}
        </tbody>
        <tfoot>
          <tr style="background:#f0f2f5;font-weight:700;border-top:2px solid #e5e5e5">
            <td style="padding:8px">Total ${year}</td>
            ${CATEGORIES.map(cat => {
              const k = kpis[cat];
              const col = CAT_COLORS[cat];
              const yearInq  = monthlyRows.reduce((s,r) => s+(r[cat]?.inquiries||0),0);
              const yearConf = monthlyRows.reduce((s,r) => s+(r[cat]?.confirmed||0),0);
              const yearVal  = monthlyRows.reduce((s,r) => s+(r[cat]?.net_value||0),0);
              return `
                <td style="padding:8px 4px;text-align:center;color:#555">${yearInq}</td>
                <td style="padding:8px 4px;text-align:center;color:${col.color}">${yearConf}</td>
                <td style="padding:8px 4px;text-align:right;color:#166a3f">${yearVal ? fmtMoney(yearVal) : "—"}</td>`;
            }).join("")}
            <td style="padding:8px 4px;text-align:center;color:#0d2137">
              ${CATEGORIES.reduce((s,c)=>s+monthlyRows.reduce((ss,r)=>ss+(r[c]?.confirmed||0),0),0)}
            </td>
            <td style="padding:8px 4px;text-align:right;color:#166a3f">
              ${fmtMoney(CATEGORIES.reduce((s,c)=>s+monthlyRows.reduce((ss,r)=>ss+(r[c]?.net_value||0),0),0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>

  <!-- ── Coordinator workload (from Live & ID records) ── -->
  ${renderCoordinatorBlock(allData)}

  </div>
  <div class="footer">Winner Holistic Consultants · Summary Dashboard · <a href="${window.location.pathname}" style="color:#888">Back</a></div>`;

  return h;
}

// ── Coordinator workload block ────────────────────────────────
function renderCoordinatorBlock(allData) {
  const coordMap = {};
  CATEGORIES.forEach(cat => {
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

  const entries = Object.entries(coordMap).sort((a,b) => b[1].confirmed - a[1].confirmed);
  if (!entries.length) return "";

  return `
  <div class="sbox" style="margin-top:12px">
    <div class="sbox-title">👤 Team Performance</div>
    <div class="coord-table">
      <div class="coord-thead">
        <div>Name</div><div>Inquiries</div><div>Confirmed</div><div>Net Value (AED)</div><div>Categories</div>
      </div>
      ${entries.map(([name, d]) => `
        <div class="coord-row">
          <div class="coord-name">${esc(name)}</div>
          <div>${d.total}</div>
          <div><span class="status-chip chip-done">${d.confirmed}</span></div>
          <div style="font-weight:600;color:#166a3f">${fmtMoney(d.net)}</div>
          <div style="font-size:10px;color:#888">${[...d.cats].join(", ")}</div>
        </div>`).join("")}
    </div>
  </div>`;
}

// ── Entry points called from main render ──────────────────────
async function loadAndRenderSummary() {
  document.getElementById("app").innerHTML =
    `<div class="loading"><div class="spinner"></div><div style="font-size:13px;color:#888">Loading summary...</div></div>`;
  S._summaryData = await loadSummaryData();
  renderSummaryPage();
}

function renderSummaryPage() {
  if (!S._summaryData) { loadAndRenderSummary(); return; }
  document.getElementById("app").innerHTML =
    renderSummaryDashboard(S._summaryData, S.summaryYear || new Date().getFullYear());
  window.scrollTo({ top: 0, behavior: "smooth" });
}
