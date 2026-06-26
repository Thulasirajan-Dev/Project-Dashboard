// ── Display label: strip the internal " Folder" suffix for the UI ──
// The category KEY (e.g. "Fitout Folder") is kept internally because it maps
// to Firebase paths. This only changes what the user sees.
function catLabel(category){ return (category||"").replace(/\s*Folder$/,""); }

// ============================================================
//  Winner Holistic Consultants – Quotation / Proposal Module
//  proposals-quotation.js
//  Depends on: shared/shared.js loaded first
// ============================================================

// ── QTN number config per category ───────────────────────────
const QTN_CONFIG = {
  "Fitout Folder": {
    prefix: "",                  // e.g. 1708-26
    pattern: (seq, yr) => `${seq}-${yr}`,
    counterKey: "qtn_counter/fitout",
    startSeq: 1709
  },
  "Live Folder": {
    prefix: "W-L",              // e.g. W-L-747-26-R0
    pattern: (seq, yr) => `W-L-${seq}-${yr}-R0`,
    counterKey: "qtn_counter/live",
    startSeq: 747
  },
  "ID Folder": {
    prefix: "W-ID",             // e.g. W-ID-108-26
    pattern: (seq, yr) => `W-ID-${seq}-${yr}`,
    counterKey: "qtn_counter/id",
    startSeq: 108
  },
  "Private Folder": {
    prefix: "W-P",              // e.g. W-P-316-26
    pattern: (seq, yr) => `W-P-${seq}-${yr}`,
    counterKey: "qtn_counter/private",
    startSeq: 316
  }
};

// ── Location list from Data sheet ────────────────────────────
const LOCATIONS = [
  "Abu Dhabi","Abu Dhabi Airport","Abu Dhabi Emirate","Abu Dhabi Global Market Square",
  "Abu Dhabi Industrial City","Abu Dhabi Island","Abu Dhabi Mall","Abu Dhabi Midfield Terminal",
  "Abu Dhabi Ports","ADDAX Tower","ADGM Square","ADIA HQ","ADIB Al Shamkha","ADNEC",
  "Airport Road","Ajban","Al Adlah Farms","Al Ain","Al Ain Campus","Al Ain Mall","Al Bateen",
  "Al Bustan Abu Dhabi","Al Dar HQ","Al Dhafra Region","Al Dhafra Street","Al Falah",
  "Al Forsan","Al Forsan Mall","Al Jimi","Al Jimi Mall","Al Khawneej 01, Dubai","Al Mafraq",
  "Al Mamoura Building","Al Maqam Tower","Al Maqta Mall","Al Markaz","Al Marsa Bateen",
  "Al Maryah Island","Al Meel Street, Al Nahayan","Al Mina","Al Muneera Beach Island",
  "Al Muneera Community","Al Mushrif","Al Nahyan","Al Nakheel Place","Al Qana","Al Raha Mall",
  "Al Rayyana","Al Reef","Al Reef 2","Al Reef Village","Al Reem Island","Al Riyadh Mall",
  "Al Sadr Port, Al Taweela","Al Sahel Tower","Al Sarab Community","Al Seef Mall",
  "Al Seef Village Mall","Al Shahama","Al Sila","Al Taweelah","Al Wahda Mall","Al Wathba",
  "Al Yaher Al Ain","Al Zahia","Al Zahiyah","Al Zeina Mall","Aldar HQ","Alfoah Mall",
  "Asab & Buhasa","AUH Midfield Terminal","Bani Yas City","Baniyas","Baniyas Cooperative",
  "BAS Mall","Bawabat Al Sharq Mall","Bawadi Al Ain","Bloom Properties","Boulevard 52",
  "Capital Mall","Capital Gate (ADNEC)","Capital City","CI Tower","Corniche","Dalma Mall",
  "Deena Tower","Deerfields Mall","Dubai","Dubai Airport Terminal 3","Dubai Expo",
  "Dubai Silicon Oasis","Eastern Mangrove","EGA Dubai","Etihad Innovation Centre",
  "Etihad Plaza","Etihad Tower","Etihad Tower 3","Ferrari World","Forsan Central Mall",
  "Galleria Al Maryah","Galleria Mall","Grove Mall","Garden Plaza","Hamdan Street",
  "Hudayriat Island","ICAD","ICAD 3","International Tower","KEZAD","KIZAD","Khalidiyah",
  "Liwa","Madinat Zayed","Masdar City","Masdar City Center","Mohammed Bin Zayed City",
  "Mussafah","Nation Towers","Nurai Island","Port Zayed","Reem Mall","Yas Island",
  "Yas Mall","Saadiyat Island","Shamkha","Shams Abu Dhabi","TIP Abu Dhabi",
  "Tourist Club Area","World Trade Centre"
];

const PROPOSAL_INCHARGE = ["Hasna","Nandhu","Karthik","Other"];
const QTN_STATUSES = ["Sent","Yet to be Sent"];
const OPEN_STATUS  = ["Open","Closed","Converted","Won","Lost"];

// ── Generate next QTN number ──────────────────────────────────
async function generateQtnNumber(category) {
  const cfg = QTN_CONFIG[category];
  if (!cfg) return "";
  const yr = String(new Date().getFullYear()).slice(-2); // "26"

  // Read current counter from Firebase
  let counter = await fbGet(cfg.counterKey);
  let seq = counter ? (counter.seq || cfg.startSeq) : cfg.startSeq;

  // Save incremented counter
  await fbSet(cfg.counterKey, { seq: seq + 1, updatedAt: new Date().toISOString() });

  return cfg.pattern(seq, yr);
}

// ── Field definitions per category ───────────────────────────
// Returns array of field group objects for the form
function getCategoryFields(category) {
  const base = [
    {
      group: "Project Details",
      fields: [
        { id: "rfq_date",     label: "RFQ Date",           type: "date",   required: true },
        { id: "proj_name",    label: "Project Name",        type: "text",   required: true, placeholder: "e.g. Internal Modification in Golden Goose" },
        { id: "location",     label: "Location",            type: "datalist", list: LOCATIONS, required: true },
        { id: "qtn_status",   label: "Quotation Status",    type: "select", options: QTN_STATUSES, required: true },
        { id: "submitted_date", label: "Submitted Date",    type: "date" },
      ]
    },
    {
      group: "Client Details",
      fields: [
        { id: "client_name",   label: "Client / Firm Name",   type: "text", required: true, full: true },
        { id: "contact_person",label: "Contact Person",        type: "text", required: true },
        { id: "client_mobile", label: "Mobile",                type: "text" },
        { id: "proposal_incharge", label: "Proposal Incharge", type: "select", options: PROPOSAL_INCHARGE, required: true },
      ]
    },
    {
      group: "Follow-up",
      fields: [
        { id: "followup1_date",  label: "Follow-up 1 Date",  type: "date" },
        { id: "followup1_notes", label: "Follow-up 1 Notes", type: "text", full: true },
        { id: "followup2_date",  label: "Follow-up 2 Date",  type: "date" },
        { id: "followup2_notes", label: "Follow-up 2 Notes", type: "text", full: true },
      ]
    },
    {
      group: "Status & Confirmation",
      fields: [
        { id: "open_status",   label: "Status (Open/Won/Lost/Converted)", type: "select", options: OPEN_STATUS, required: true },
        { id: "email_confirm", label: "Email Confirmation Received",       type: "select", options: ["","Y","N"] },
        { id: "lpo_received",  label: "LPO Received",                      type: "select", options: ["","Y","N"] },
        { id: "lpo_date",      label: "LPO Date",                          type: "date" },
      ]
    },
    {
      group: "Fees",
      fields: [
        { id: "total_amount",  label: "Total Amount (Excl. VAT & Govt. Fees) AED", type: "number", required: true },
        { id: "sub_adm",       label: "Sub-Contractor ADM (AED)",                  type: "number" },
        { id: "sub_adcd",      label: "Sub-Contractor ADCD (AED)",                 type: "number" },
        { id: "sub_addc",      label: "Sub-Contractor Local / ADDC (AED)",         type: "number" },
        { id: "freelancer",    label: "Freelancer (AED)",                           type: "number" },
        // Net is auto-calculated
      ]
    },
    {
      group: "Remarks",
      fields: [
        { id: "remarks", label: "Remarks", type: "textarea", full: true },
      ]
    }
  ];

  // ── Category-specific extra fields ─────────────────────────
  if (category === "Fitout Folder") {
    // Insert after client group: ADM Contractor name, ADDC Contractor name
    base[4].fields.splice(2, 0,
      { id: "adm_contractor",  label: "ADM Contractor Name / Permit Issued", type: "text", full: true },
      { id: "addc_contractor", label: "ADDC Contractor Name",                type: "text", full: true }
    );
    base[5].fields.unshift(
      { id: "reason_not_converted", label: "Reason if Not Converted", type: "textarea", full: true }
    );
  }

  if (category === "Live Folder") {
    // Extra project fields
    base[0].fields.splice(3, 0,
      { id: "plot_no",   label: "Plot #",   type: "text" },
      { id: "sector_no", label: "Sector #", type: "text" }
    );
    // Replace single total_amount with 4 fee breakdown fields
    base[4].fields = [
      { id: "fee_design",      label: "Design Fee (AED)",      type: "number" },
      { id: "fee_approvals",   label: "Approvals Fee (AED)",   type: "number" },
      { id: "fee_tender",      label: "Tender Fee (AED)",      type: "number" },
      { id: "fee_supervision", label: "Supervision Fee (AED)", type: "number" },
      { id: "sub_adm",         label: "Sub-Contractor ADM (AED)", type: "number" },
      { id: "sub_adcd",        label: "Sub-Contractor ADCD (AED)", type: "number" },
      { id: "sub_addc",        label: "Sub-Contractor Local / ADDC (AED)", type: "number" },
      { id: "freelancer",      label: "Freelancer (AED)", type: "number" },
    ];
    // Coordinator fields
    base.splice(2, 0, {
      group: "Project Coordinators",
      fields: [
        { id: "follow_up_by", label: "Follow-up By",          type: "text" },
        { id: "pc1",          label: "Project Coordinator 1", type: "text" },
        { id: "pc2",          label: "Project Coordinator 2", type: "text" },
      ]
    });
  }

  if (category === "ID Folder") {
    base[1].fields.push(
      { id: "update_by_karthik", label: "Update by Karthik", type: "text" }
    );
    base.splice(2, 0, {
      group: "Project Coordinators",
      fields: [
        { id: "pc1", label: "Project Coordinator 1", type: "text" },
        { id: "pc2", label: "Project Coordinator 2", type: "text" },
      ]
    });
    base[4].fields.splice(1, 0,
      { id: "adm_contractor",  label: "ADM Contractor Name",  type: "text", full: true },
      { id: "addc_contractor", label: "ADDC Contractor Name", type: "text", full: true }
    );
  }

  if (category === "Private Folder") {
    base.splice(1, 0, {
      group: "Scope",
      fields: [
        { id: "scope", label: "Scope of Work", type: "textarea", full: true }
      ]
    });
    base.splice(3, 0, {
      group: "Project Coordinators",
      fields: [
        { id: "pc1", label: "Project Coordinator 1", type: "text" },
        { id: "pc2", label: "Project Coordinator 2", type: "text" },
      ]
    });
    base[5].fields.splice(1, 0,
      { id: "adm_contractor",  label: "ADM Contractor Name",  type: "text", full: true },
      { id: "addc_contractor", label: "ADDC Contractor Name", type: "text", full: true }
    );
  }

  return base;
}

// ── Render a single field ─────────────────────────────────────
function renderField(f, value = "") {
  const colSpan = f.full ? 'style="grid-column:1/-1"' : "";
  let input = "";

  if (f.type === "select") {
    const opts = (f.options || []).map(o =>
      `<option value="${esc(o)}" ${value === o ? "selected" : ""}>${esc(o) || "— Select —"}</option>`
    ).join("");
    input = `<select class="fi" id="qf-${f.id}" ${f.required ? 'required' : ''}>${opts}</select>`;

  } else if (f.type === "datalist") {
    const listId = `dl-${f.id}`;
    const opts = (f.list || []).map(l => `<option value="${esc(l)}">`).join("");
    input = `<input class="fi" id="qf-${f.id}" list="${listId}" value="${esc(value)}"
      placeholder="${esc(f.placeholder || '')}" ${f.required ? 'required' : ''} autocomplete="off"/>
      <datalist id="${listId}">${opts}</datalist>`;

  } else if (f.type === "textarea") {
    input = `<textarea class="fi" id="qf-${f.id}" rows="3"
      placeholder="${esc(f.placeholder || '')}">${esc(value)}</textarea>`;

  } else {
    input = `<input class="fi" type="${f.type}" id="qf-${f.id}"
      value="${esc(value)}" placeholder="${esc(f.placeholder || '')}"
      ${f.required ? 'required' : ''} ${f.type === 'number' ? 'min="0" step="any"' : ''}
      ${f.id.startsWith("sub_") || f.id.startsWith("fee_") || f.id === "freelancer" || f.id === "total_amount"
        ? `oninput="recalcNet()"` : ""}/>`;
  }

  return `<div ${colSpan}>
    <div class="fl">${esc(f.label)}${f.required ? ' <span class="req-star">*</span>' : ''}</div>
    ${input}
  </div>`;
}

// ── Render the full quotation form ────────────────────────────
function renderQuotationForm(category, qtnNumber, existingData = {}, editId = "") {
  const groups = getCategoryFields(category);
  let h = `<div class="sbox">
    <div class="sbox-title" style="display:flex;justify-content:space-between;align-items:center">
      <span>📋 ${esc(catLabel(category))} — ${editId ? "Edit" : "New"} Quotation</span>
      <span class="quot-num-badge" style="font-size:13px">🔢 ${esc(qtnNumber)}</span>
    </div>
    <input type="hidden" id="qf-qtn_number" value="${esc(qtnNumber)}"/>
    <input type="hidden" id="qf-category" value="${esc(category)}"/>
    <input type="hidden" id="qf-edit_id" value="${esc(editId)}"/>`;

  groups.forEach(group => {
    h += `<div class="sbox" style="margin-bottom:0;border:none;padding:0;margin-top:14px">
      <div class="fl" style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#aaa;font-weight:700;margin-bottom:10px">${esc(group.group)}</div>
      <div class="fgrid">`;
    group.fields.forEach(f => {
      h += renderField(f, existingData[f.id] || "");
    });
    h += `</div></div>`;
  });

  // Net calculation display
  const isLive = category === "Live Folder";
  h += `<div class="quot-box" style="margin-top:14px">
    <div class="quot-box-title">💰 Fee Summary</div>
    <div class="fgrid">
      ${isLive ? `
      <div><div class="fl">Total (Design+Approvals+Tender+Supervision)</div>
        <div id="net-gross" style="font-size:14px;font-weight:700;color:#0d2137;padding:6px 0">AED 0</div></div>` :
      `<div><div class="fl">Total Amount (Entered Above)</div>
        <div id="net-gross" style="font-size:14px;font-weight:700;color:#0d2137;padding:6px 0">AED 0</div></div>`}
      <div><div class="fl">Sub-Contractor Deductions</div>
        <div id="net-deductions" style="font-size:13px;color:#a32d2d;padding:6px 0">AED 0</div></div>
      <div><div class="fl" style="font-weight:700">Net Amount (WHC)</div>
        <div id="net-amount" style="font-size:16px;font-weight:700;color:#166a3f;padding:6px 0">AED 0</div></div>
      <div><div class="fl">VAT (5%)</div>
        <div id="net-vat" style="font-size:13px;color:#555;padding:6px 0">AED 0</div></div>
    </div>
  </div>`;

  h += `<button class="btn btn-purple" style="width:100%;margin-top:16px;padding:13px;font-size:14px"
    onclick="submitQuotation()">${editId ? "Update Quotation ✓" : "Submit Quotation →"}</button>`;

  h += `</div>`;
  return h;
}

// ── Live net recalculation ────────────────────────────────────
function recalcNet() {
  const v = id => parseFloat(document.getElementById(id)?.value || 0) || 0;
  const category = document.getElementById("qf-category")?.value || "";
  const isLive = category === "Live Folder";

  let gross = 0;
  if (isLive) {
    gross = v("qf-fee_design") + v("qf-fee_approvals") + v("qf-fee_tender") + v("qf-fee_supervision");
  } else {
    gross = v("qf-total_amount");
  }

  const deductions = v("qf-sub_adm") + v("qf-sub_adcd") + v("qf-sub_addc") + v("qf-freelancer");
  const net = gross - deductions;
  const vat = net * 0.05;

  const fmt = n => "AED " + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const el = id => document.getElementById(id);

  if (el("net-gross")) el("net-gross").textContent = fmt(gross);
  if (el("net-deductions")) el("net-deductions").textContent = "− " + fmt(deductions);
  if (el("net-amount")) el("net-amount").textContent = fmt(net);
  if (el("net-vat")) el("net-vat").textContent = fmt(vat);
}

// ── Collect form values ───────────────────────────────────────
function collectQuotationData(category) {
  const allFields = getCategoryFields(category).flatMap(g => g.fields);
  const data = { category, qtn_number: document.getElementById("qf-qtn_number")?.value || "" };

  allFields.forEach(f => {
    const el = document.getElementById("qf-" + f.id);
    if (el) data[f.id] = el.value || "";
  });

  // Compute net
  const v = key => parseFloat(data[key] || 0) || 0;
  const isLive = category === "Live Folder";
  const gross = isLive
    ? v("fee_design") + v("fee_approvals") + v("fee_tender") + v("fee_supervision")
    : v("total_amount");
  const deductions = v("sub_adm") + v("sub_adcd") + v("sub_addc") + v("freelancer");
  data.net_amount = gross - deductions;
  data.gross_amount = gross;

  return data;
}

// ── Validate required fields ──────────────────────────────────
function validateQuotation(category, data) {
  const allFields = getCategoryFields(category).flatMap(g => g.fields);
  const missing = allFields.filter(f => f.required && !data[f.id]).map(f => f.label);
  if (missing.length) {
    alert("Please fill in required fields:\n• " + missing.join("\n• "));
    return false;
  }
  return true;
}

// ── Submit quotation to Firebase ──────────────────────────────
async function submitQuotation() {
  const category = document.getElementById("qf-category")?.value || "";
  if (!category) { alert("Category not set."); return; }

  const data = collectQuotationData(category);
  if (!validateQuotation(category, data)) return;

  // Build Firebase path based on category
  const pathMap = {
    "Fitout Folder": "quotations/fitout",
    "Live Folder":   "quotations/live",
    "ID Folder":     "quotations/id",
    "Private Folder":"quotations/private"
  };
  const basePath = pathMap[category];

  const editId = document.getElementById("qf-edit_id")?.value || "";
  const isEdit = !!editId;
  const entryId = isEdit ? editId : ("q_" + Date.now());

  // ── Activity / audit trail ──────────────────────────────────
  const who = (typeof CURRENT_USER !== "undefined" && CURRENT_USER) || getSession() || {};
  const nowIso = new Date().toISOString();
  const prev = (isEdit && S._editingQuotation) ? S._editingQuotation : null;

  if (isEdit) {
    // Preserve original creator + creation time.
    data.createdAt     = (prev && prev.createdAt) || nowIso;
    data.createdBy     = (prev && prev.createdBy) || who.name || "Unknown";
    data.createdByRole = (prev && prev.createdByRole) || who.role || "";
    // Record this edit.
    data.lastEditedAt     = nowIso;
    data.lastEditedBy     = who.name || "Unknown";
    data.lastEditedByRole = who.role || "";
    // Append to a running edit history (keep prior entries).
    const history = (prev && Array.isArray(prev.editHistory)) ? prev.editHistory.slice() : [];
    history.push({ action: "edited", by: who.name || "Unknown", role: who.role || "", at: nowIso });
    data.editHistory = history;
  } else {
    data.createdAt     = nowIso;
    data.createdBy     = who.name || "Unknown";
    data.createdByRole = who.role || "";
    data.editHistory   = [{ action: "created", by: who.name || "Unknown", role: who.role || "", at: nowIso }];
  }
  data.id = entryId;

  document.getElementById("app").innerHTML =
    `<div class="loading"><div class="spinner"></div><div style="font-size:13px;color:#888">${isEdit ? "Updating" : "Saving"} quotation...</div></div>`;

  const ok = await fbSet(`${basePath}/${entryId}`, data);
  if (ok) {
    // Only count NEW quotations in the monthly summary (editing must not double-count).
    if (!isEdit) await updateSummaryCounter(data);
    if (typeof logActivity === "function") {
      logActivity("Proposals", isEdit ? "Updated quotation" : "Created quotation",
        data.qtn_number || data.proj_name || entryId, catLabel(category));
    }
    alert(`✅ Quotation ${data.qtn_number} ${isEdit ? "updated" : "saved"} successfully!`);
    S._editingQuotation = null;
    // Return to the type list the user was viewing (or all).
    if (S._listCategory) { loadListPage(S._listCategory); }
    else { S.proposalTab = "category"; render(); }
  } else {
    alert("Error saving. Check Firebase connection.");
    render();
  }
}

// ── Update summary counters in Firebase ───────────────────────
async function updateSummaryCounter(data) {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const catKey = {
    "Fitout Folder": "fitout", "Live Folder": "live",
    "ID Folder": "id", "Private Folder": "private"
  }[data.category] || "other";

  const path = `summary/${monthKey}/${catKey}`;
  let current = await fbGet(path) || { inquiries: 0, confirmed: 0, net_value: 0 };

  current.inquiries = (current.inquiries || 0) + 1;
  if (["Converted", "Won"].includes(data.open_status)) {
    current.confirmed = (current.confirmed || 0) + 1;
    current.net_value = (current.net_value || 0) + (data.net_amount || 0);
  }
  await fbSet(path, current);
}

// ── Load quotations list for a category ──────────────────────
async function loadQuotationsList(category) {
  const pathMap = {
    "Fitout Folder": "quotations/fitout",
    "Live Folder":   "quotations/live",
    "ID Folder":     "quotations/id",
    "Private Folder":"quotations/private"
  };
  const data = await fbGet(pathMap[category]) || {};
  return Object.values(data).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

// ── Render quotations list ────────────────────────────────────
function renderQuotationsList(category, records) {
  if (!records.length) {
    return `<div style="text-align:center;padding:40px;color:#aaa;font-size:13px">No quotations yet in ${category}.</div>`;
  }

  const statusColor = s => ({
    "Converted": "chip-done", "Won": "chip-done",
    "Open": "chip-active", "Closed": "chip-new", "Lost": "chip-not-approved"
  }[s] || "chip-new");

  return records.map(r => `
    <div class="prop-card" style="cursor:pointer" onclick="openQuotationDetail('${r.id}','${r.category}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:6px">
        <div style="flex:1">
          <div class="prop-card-title">${esc(r.proj_name || "Unnamed Project")}</div>
          <div class="prop-card-meta">${esc(r.client_name || "—")} · ${esc(r.location || "—")}</div>
          <div style="margin-top:5px;display:flex;gap:5px;flex-wrap:wrap">
            <span class="status-chip" style="background:#e8f4ff;color:#1a5276">📄 ${esc(r.qtn_number)}</span>
            <span class="status-chip ${statusColor(r.open_status)}">${esc(r.open_status || "Open")}</span>
            <span class="status-chip chip-new">${esc(r.rfq_date || r.createdAt?.split("T")[0] || "")}</span>
            ${r.proposal_incharge ? `<span class="status-chip" style="background:#f0f0f0;color:#555">👤 ${esc(r.proposal_incharge)}</span>` : ""}
            ${r.lpo_received === "Y" ? `<span class="status-chip chip-done">✓ LPO</span>` : ""}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:15px;font-weight:700;color:#166a3f">AED ${fmtMoney(r.net_amount || 0)}</div>
          <div style="font-size:10px;color:#aaa">Net Amount</div>
        </div>
      </div>
    </div>`).join("");
}

// ── Open a quotation for viewing/editing ──────────────────────
async function openQuotationDetail(id, category) {
  const pathMap = {
    "Fitout Folder": "quotations/fitout",
    "Live Folder":   "quotations/live",
    "ID Folder":     "quotations/id",
    "Private Folder":"quotations/private"
  };
  document.getElementById("app").innerHTML =
    `<div class="loading"><div class="spinner"></div></div>`;
  const data = await fbGet(`${pathMap[category]}/${id}`);
  if (data) {
    S._editingQuotation = data;
    render();
  }
}

// ── Delete a quotation ────────────────────────────────────────
async function deleteQuotation(id, category) {
  if (!confirm("Delete this quotation? This cannot be undone.")) return;
  const pathMap = {
    "Fitout Folder": "quotations/fitout",
    "Live Folder":   "quotations/live",
    "ID Folder":     "quotations/id",
    "Private Folder":"quotations/private"
  };
  await fbDelete(`${pathMap[category]}/${id}`);
  if (typeof logActivity === "function") logActivity("Proposals", "Deleted quotation", id, catLabel(category));
  S._editingQuotation = null;
  render();
}

// ── Entry point: called when user picks a category ────────────
async function startNewQuotation(category) {
  S._editMode = false;            // ensure this is a fresh create, not an edit
  S._editingQuotation = null;
  document.getElementById("app").innerHTML =
    `<div class="loading"><div class="spinner"></div><div style="font-size:13px;color:#888">Generating quotation number...</div></div>`;
  const qtnNumber = await generateQtnNumber(category);
  S._newQuotationCategory = category;
  S._newQuotationNumber = qtnNumber;
  S.proposalTab = "new_form";
  render();
}
