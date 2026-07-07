// ── Display label: strip the internal " Folder" suffix for the UI ──
// The category KEY (e.g. "Fitout Folder") is kept internally because it maps
// to Firebase paths. This only changes what the user sees.
function catLabel(category){ return (category||"").replace(/\s*Folder$/,""); }

// ── Field-level diff for the activity log ─────────────────────
// Compares the previous record with the new data and returns a short
// human-readable summary of which fields changed (using their labels).
function diffQuotationFields(category, prev, next) {
  if (!prev) return "";
  let labelMap = {};
  try {
    (getCategoryFields(category) || []).forEach(g =>
      (g.fields || []).forEach(f => { labelMap[f.id] = f.label || f.id; })
    );
  } catch (e) {}
  const skip = new Set(["createdAt","createdBy","createdByRole","lastEditedAt",
    "lastEditedBy","lastEditedByRole","editHistory","id","_cat","category"]);
  const changed = [];
  const keys = new Set([...Object.keys(prev||{}), ...Object.keys(next||{})]);
  keys.forEach(k => {
    if (skip.has(k)) return;
    const a = prev[k], b = next[k];
    const av = (a==null?"":String(a)).trim();
    const bv = (b==null?"":String(b)).trim();
    if (av !== bv) changed.push(labelMap[k] || k);
  });
  if (!changed.length) return "No field changes";
  const shown = changed.slice(0, 6);
  let txt = "Changed: " + shown.join(", ");
  if (changed.length > shown.length) txt += ` +${changed.length - shown.length} more`;
  return txt;
}


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

const PROPOSAL_INCHARGE = ["Mohamed Ramees","Mahadir","Katheeja","Vaisakh","Hasna","Abhi","Other"];
// Resolve a stored incharge value (email or legacy name) to a display name.
function inchargeName(val) {
  if (!val) return "";
  const list = (typeof PROPOSAL_USERS !== "undefined") ? PROPOSAL_USERS : [];
  const u = list.find(x => (x.email || "") === val || x.name === val);
  return u ? u.name : val;
}
const QTN_STATUSES = ["Sent","Yet to be Sent"];
const OPEN_STATUS  = ["Open","Regret","Won","Lost"];

// ── Generate next QTN number ──────────────────────────────────
async function generateQtnNumber(category) {
  const cfg = QTN_CONFIG[category];
  if (!cfg) return "";
  const yr = String(new Date().getFullYear()).slice(-2); // "26"

  // Read current counter from Firebase
  let counter = await fbGet(coPath(cfg.counterKey));
  let seq = counter ? (counter.seq || cfg.startSeq) : cfg.startSeq;

  // Save incremented counter
  await fbSet(coPath(cfg.counterKey), { seq: seq + 1, updatedAt: new Date().toISOString() });

  return cfg.pattern(seq, yr);
}

// ── Field definitions per category ───────────────────────────
// Returns array of field group objects for the form
// ============================================================
//  Per-company proposal field sets.
//  WHC uses the base field set below, unchanged. The two other
//  companies inherit the SAME base by default, so they work
//  immediately. To give a company its own fields later, add an
//  entry to COMPANY_FIELD_OVERRIDES keyed by company id; its
//  function receives the base groups and returns the modified
//  groups. Examples are commented below — just fill them in.
// ============================================================
const COMPANY_FIELD_OVERRIDES = {
  // "mw": function(baseGroups, category) {
  //   // Example: add a Moonway-specific field to "Project Details"
  //   const g = baseGroups.find(x => x.group === "Project Details");
  //   if (g) g.fields.push({ id: "mw_permit_no", label: "Municipality Permit No.", type: "text" });
  //   return baseGroups;
  // },
  // "whsf": function(baseGroups, category) {
  //   // Example: add fire-safety fields for WH Safety & Fire
  //   baseGroups.push({ group: "Fire & Safety", fields: [
  //     { id: "civil_defence_ref", label: "Civil Defence Ref", type: "text" },
  //     { id: "system_type", label: "System Type", type: "select", options: ["Fire Alarm","Sprinkler","Suppression","Other"] }
  //   ]});
  //   return baseGroups;
  // },
};

// Public entry point: returns the field groups for the active company.
function getCategoryFields(category) {
  const base = _baseCategoryFields(category);
  const co = (typeof getCompany === "function") ? getCompany().id : "whc";
  const override = COMPANY_FIELD_OVERRIDES[co];
  if (typeof override === "function") {
    try {
      // Deep-clone base so an override never mutates the shared definition.
      const clone = JSON.parse(JSON.stringify(base));
      const result = override(clone, category);
      if (Array.isArray(result)) return result;
    } catch (e) { /* fall back to base on any override error */ }
  }
  return base;
}

// WHC base field set (the original definition — unchanged).
function _baseCategoryFields(category) {
  const base = [
    {
      group: "Project Details",
      fields: [
        { id: "rfq_date",     label: "Request Date",       type: "date",   required: true },
        { id: "deadline_date", label: "Deadline Date",      type: "date",   required: true },
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
        { id: "proposal_incharge", label: "Proposal Incharge", type: "select", userRole: "proposals", required: true },
      ]
    },
    {
      group: "Follow-up",
      fields: [
        { id: "last_followup_date", label: "Last Follow-up Date", type: "date" },
        { id: "last_followup_note", label: "Last Follow-up Note", type: "text", full: true },
        { id: "followup_history",   label: "Follow-up History (new entries append the previous note here for reference)", type: "followup_history", full: true },
      ]
    },
    {
      group: "Status & Confirmation",
      fields: [
        { id: "open_status",   label: "Status", type: "select", options: OPEN_STATUS, required: true },
        { id: "email_confirm", label: "Email Confirmation Received",       type: "select", options: ["","Y","N"] },
        { id: "lpo_received",  label: "LPO Received",                      type: "select", options: ["","Y","N"] },
        { id: "lpo_date",      label: "LPO Date",                          type: "date" },
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
  if (category === "Live Folder") {
    // Extra project fields
    base[0].fields.splice(3, 0,
      { id: "plot_no",   label: "Plot #",   type: "text" },
      { id: "sector_no", label: "Sector #", type: "text" }
    );
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
  }

  if (category === "Private Folder") {
    base.splice(2, 0, {
      group: "Project Coordinators",
      fields: [
        { id: "pc1", label: "Project Coordinator 1", type: "text" },
        { id: "pc2", label: "Project Coordinator 2", type: "text" },
      ]
    });
  }

  return base;
}

// ── Render a single field ─────────────────────────────────────
function renderField(f, value = "") {
  const colSpan = f.full ? 'style="grid-column:1/-1"' : "";
  let input = "";

  if (f.type === "followup_history") {
    let hist = [];
    try { hist = value ? (typeof value === "string" ? JSON.parse(value) : value) : []; } catch (e) { hist = []; }
    const rows = (Array.isArray(hist) && hist.length)
      ? hist.map(e => `<div style="padding:6px 10px;border-bottom:1px solid #eef0f3;font-size:12px">
          <span style="color:#888">${esc(e.date || "")}</span> — <span style="color:#333">${esc(e.note || "")}</span>
        </div>`).join("")
      : `<div style="padding:10px;color:#aaa;font-size:12px">No previous follow-ups recorded.</div>`;
    input = `<div style="border:1px solid #e2e5ee;border-radius:8px;overflow:hidden;max-height:160px;overflow-y:auto">${rows}</div>
      <input type="hidden" id="qf-${f.id}" value="${esc(typeof value==='string'?value:JSON.stringify(hist))}"/>`;
    return `<div ${colSpan}><div class="fl">${esc(f.label)}</div>${input}</div>`;
  }

  if (f.type === "select") {
    // Role-based fields populate live from real users (name shown, email stored).
    let optionSource = f.options || [];
    if (f.userRole) {
      const pool = f.userRole === "proposals" ? (typeof PROPOSAL_USERS!=="undefined"?PROPOSAL_USERS:[])
                 : f.userRole === "account"   ? (typeof ACCOUNT_USERS!=="undefined"?ACCOUNT_USERS:[])
                 : [];
      optionSource = pool.map(u => ({ value: u.email || u.name, label: u.name }));
      // Keep an existing saved value visible even if that user is now inactive.
      if (value && !optionSource.some(o => o.value === value)) {
        optionSource = optionSource.concat([{ value, label: value + " (inactive)" }]);
      }
    }
    const opts = `<option value="">— Select —</option>` + optionSource.map(o => {
      const ov = (typeof o === "object") ? o.value : o;
      const ol = (typeof o === "object") ? o.label : o;
      return `<option value="${esc(ov)}" ${value === ov ? "selected" : ""}>${esc(ol)}</option>`;
    }).join("");
    // The award-gate fields refresh the inline Project Details section live.
    const onCh = (f.id === "open_status")
      ? ' onchange="_toggleRemarks(this.value);if(typeof refreshProjectDetails===\'function\')refreshProjectDetails()"'
      : (f.id === "lpo_received" || f.id === "email_confirm")
      ? ' onchange="if(typeof refreshProjectDetails===\'function\')refreshProjectDetails()"' : "";
    input = `<select class="fi" id="qf-${f.id}" ${f.required ? 'required' : ''}${onCh}>${opts}</select>`;

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
      autocomplete="off" ${f.required ? 'required' : ''} ${f.type === 'number' ? 'min="0" step="any"' : ''}/>`;
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

  // Seed project-details state early so the fees matrix (placed above Status)
  // has its data ready.
  initProjectDetails(existingData);
  let _scopePlaced = false;
  groups.forEach(group => {
    // Scope & Fees section sits directly ABOVE the Status & Confirmation group.
    if (group.group === "Status & Confirmation" && !_scopePlaced) {
      h += renderScopeAndFees();
      _scopePlaced = true;
    }
    // Remarks only shows when status is Regret or Lost.
    if (group.group === "Remarks") {
      const st = existingData.open_status || "";
      const show = (st === "Regret" || st === "Lost");
      h += `<div id="remarks-group" style="${show ? "" : "display:none"}">
        <div class="sbox" style="margin-bottom:0;border:none;padding:0;margin-top:14px">
          <div class="fl" style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#aaa;font-weight:700;margin-bottom:10px">${esc(group.group)}</div>
          <div class="fgrid">`;
      group.fields.forEach(f => { h += renderField(f, existingData[f.id] || ""); });
      h += `</div></div></div>`;
      return;
    }
    h += `<div class="sbox" style="margin-bottom:0;border:none;padding:0;margin-top:14px">
      <div class="fl" style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#aaa;font-weight:700;margin-bottom:10px">${esc(group.group)}</div>
      <div class="fgrid">`;
    group.fields.forEach(f => {
      h += renderField(f, existingData[f.id] || "");
    });
    h += `</div></div>`;
  });
  if (!_scopePlaced) h += renderScopeAndFees();

  // Proof / attachment (one file per quotation)
  S._pendingAttachment = (existingData && existingData.attachment) ? existingData.attachment : null;
  h += attachmentWidget(S._pendingAttachment, "quotation", editId || qtnNumber, "_setQuotationAttachment");

  // Inline Project Details (reveals when Won + LPO Received). State already
  // seeded above (before the fees matrix); fees now render above Status.
  h += renderProjectDetailsSection(existingData);

  h += `<button class="btn btn-purple" style="width:100%;margin-top:16px;padding:13px;font-size:14px"
    onclick="submitQuotation()">${editId ? `Submit Enquiry ${svgIcon('check',14,'#fff')}` : `Save Enquiry ${svgIcon('arrow-right',14,'#fff')}`}</button>`;

  h += `</div>`;
  return h;
}

// ── Collect form values ───────────────────────────────────────
function collectQuotationData(category) {
  const allFields = getCategoryFields(category).flatMap(g => g.fields);
  const data = { category, qtn_number: document.getElementById("qf-qtn_number")?.value || "" };

  allFields.forEach(f => {
    const el = document.getElementById("qf-" + f.id);
    if (el) data[f.id] = el.value || "";
  });

  // Follow-up history: when a NEW last-follow-up note is entered (different
  // from the previously saved one), push the previous one into the history
  // list so nothing is lost. History is kept as a JSON array.
  try {
    const prevData = S._editingQuotation || {};
    let hist = [];
    if (data.followup_history) { try { hist = JSON.parse(data.followup_history); } catch (e) { hist = []; } }
    const prevNote = (prevData.last_followup_note || "").trim();
    const prevDate = prevData.last_followup_date || "";
    const newNote = (data.last_followup_note || "").trim();
    if (prevNote && newNote && prevNote !== newNote) {
      hist = [{ date: prevDate, note: prevNote }].concat(hist);   // newest previous on top
    }
    data.followup_history = JSON.stringify(hist);
  } catch (e) {}

  // Quotation value = the computed contract total from the Scope & Fees tables.
  data.net_amount = (typeof _scopeContractTotalRaw === "function") ? _scopeContractTotalRaw() : 0;
  data.gross_amount = data.net_amount;

  // Attach the proof file (if uploaded / existing).
  if (S._pendingAttachment) data.attachment = S._pendingAttachment;

  // When the quotation is awarded (Won + LPO received), attach the inline
  // Project Details block. This is what the Coordinator & Account modules
  // read. collectProjectDetails returns null when not awarded.
  if (typeof collectProjectDetails === "function") {
    const project = collectProjectDetails(data);
    if (project) data.project = project;
  }
  // Scope & Fees are filled during quotation prep — save on the quotation
  // record itself (not gated behind Won) so revisions persist across edits.
  if (S._pj) {
    const curCol = Math.max(1, ...(S._pj.scope||[]).map(s => (s.rev && s.rev.length) || 1), 1) - 1;
    data.scope = (S._pj.scope || []).filter(s => (s.name||"").trim() || (s.rev||[]).some(v=>v!=="")).map(s => ({
      name: (s.name||"").trim(),
      rev: (s.rev||[]).map(v => v === "" || v == null ? "" : (parseFloat(v)||0)),
      value: parseFloat(s.rev && s.rev[curCol]) || 0
    }));
    data.govtFees = (S._pj.govtFees || []).filter(g => (g.label||"").trim() || (g.rev||[]).some(v=>v!==""&&v!=null))
      .map(g => ({
        label: (g.label||"").trim(),
        rev: (g.rev||[]).map(v => v === "" || v == null ? "" : (parseFloat(v)||0)),
        amount: parseFloat(g.rev && g.rev[curCol]) || 0
      }));
    data.subFees = (S._pj.subFees || []).map(s => ({
      label: s.label || "", name: s.name || "",
      rev: (s.rev||[]).map(v => v === "" || v == null ? "" : (parseFloat(v)||0)),
      amount: parseFloat(s.rev && s.rev[curCol]) || 0
    }));
    data.scopeFrozen = S._pj.scopeFrozen || 0;
  }

  return data;
}

// Called by the attachment widget after a successful upload.
function _setQuotationAttachment(att) {
  S._pendingAttachment = att;
}

// ── Validate required fields ──────────────────────────────────
function validateQuotation(category, data) {
  const allFields = getCategoryFields(category).flatMap(g => g.fields);
  const missing = allFields.filter(f => f.required && !data[f.id]).map(f => f.label);

  // Status-conditional rules:
  const status = (data.open_status || "");
  // Lost or Regret → Remarks is mandatory.
  if ((status === "Lost" || status === "Regret") && !(data.remarks || "").trim()) {
    missing.push("Remarks (required when status is " + status + ")");
  }
  // Won → LPO Received must be Y and email confirmation must be received,
  // before the awarded details are considered complete.
  if (status === "Won") {
    if ((data.lpo_received || "") !== "Y") missing.push("LPO Received = Y (required when Won)");
    if ((data.email_confirm || "") !== "Y") missing.push("Email Confirmation Received = Y (required when Won)");
  }

  if (missing.length) {
    alert("Please fix the following:\n• " + missing.join("\n• "));
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
  const basePath = coPath(pathMap[category]);

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
    history.push({ action: "edited", by: who.name || "Unknown", role: who.role || "", at: nowIso,
      changes: diffQuotationFields(category, prev, data) });
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
    // If awarded (Won AND LPO received), register/refresh the project for
    // the Coordinator (scope stages) and Account (LPO milestones).
    const _won = (data.open_status || "").toLowerCase() === "won";
    const _lpo = (data.lpo_received || "").toUpperCase() === "Y";
    // Only register the project when the awarded details block was actually
    // built (Won + LPO + email confirm all satisfied → data.project is set).
    if (_won && _lpo && data.project) {
      try { await ensureProjectFromQuotation(data, category); } catch (e) {}
    }
    if (typeof logActivity === "function") {
      const changeSummary = isEdit ? diffQuotationFields(category, prev, data) : "";
      const detail = isEdit
        ? (changeSummary ? `${catLabel(category)} · ${changeSummary}` : catLabel(category))
        : catLabel(category);
      logActivity("Proposals", isEdit ? "Updated quotation" : "Created quotation",
        data.qtn_number || data.proj_name || entryId, detail);
    }
    alert(`✅ Quotation ${data.qtn_number} ${isEdit ? "updated" : "saved"} successfully!`);
    S._editingQuotation = null; S._linkedProject = null; S._revParentProject = null;
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
  let current = await fbGet(coPath(path)) || { inquiries: 0, confirmed: 0, net_value: 0 };

  current.inquiries = (current.inquiries || 0) + 1;
  if (["Converted", "Won"].includes(data.open_status)) {
    current.confirmed = (current.confirmed || 0) + 1;
    current.net_value = (current.net_value || 0) + (data.net_amount || 0);
  }
  await fbSet(coPath(path), current);
}

// ── Load quotations list for a category ──────────────────────
async function loadQuotationsList(category) {
  const pathMap = {
    "Fitout Folder": "quotations/fitout",
    "Live Folder":   "quotations/live",
    "ID Folder":     "quotations/id",
    "Private Folder":"quotations/private"
  };
  const data = await fbGet(coPath(pathMap[category])) || {};
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
            ${r.proposal_incharge ? `<span class="status-chip" style="background:#f0f0f0;color:#555">👤 ${esc(inchargeName(r.proposal_incharge))}</span>` : ""}
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
  const data = await fbGet(coPath(`${pathMap[category]}/${id}`));
  if (data) {
    S._editingQuotation = data;
    // Load the linked project (single source of truth for scope/LPO), if one
    // exists. Project id is deterministic: "proj_" + quotation id.
    S._linkedProject = null;
    S._revParentProject = null;
    try {
      const proj = await fbGet(coPath("projects/proj_" + id), { fresh: true });
      if (proj) S._linkedProject = proj;
    } catch (e) {}
    // If this is a revision quotation, load its PARENT project for the faded
    // reference view.
    try {
      if (data.is_revision && data.parent_project_id) {
        const parent = await fbGet(coPath("projects/" + data.parent_project_id), { fresh: true });
        if (parent) S._revParentProject = parent;
      }
    } catch (e) {}
    render();
  }
}

// ── Delete a quotation — DISABLED ─────────────────────────────
// Quotations/enquiries are kept permanently as history and cannot be
// deleted. This stub remains only so any old cached page that still
// references it fails safely instead of erroring.
async function deleteQuotation(id, category) {
  alert("Quotations are kept as a permanent record and cannot be deleted.");
  return;
}

// ── Entry point: called when user picks a category ────────────
async function startNewQuotation(category) {
  S._editMode = false;            // ensure this is a fresh create, not an edit
  S._editingQuotation = null; S._linkedProject = null; S._revParentProject = null;
  document.getElementById("app").innerHTML =
    `<div class="loading"><div class="spinner"></div><div style="font-size:13px;color:#888">Generating quotation number...</div></div>`;
  const qtnNumber = await generateQtnNumber(category);
  S._newQuotationCategory = category;
  S._newQuotationNumber = qtnNumber;
  S.proposalTab = "new_form";
  render();
}

// ============================================================
//  Inline Project Details (Scope stages + LPO milestones)
//  Reveals when the quotation is awarded (Won + LPO Received).
//  Produces the exact shape ensureProjectFromQuotation() reads:
//    project = {
//      folderPath, scopeFile, lpoFile,
//      scope: [ {name, pct, status} ],
//      lpo:   [ {name, value, invoiced, received} ]
//    }
// ============================================================

// Seed working state from an existing quotation's saved project block.
function initProjectDetails(existingData) {
  const pj = (existingData && existingData.project) || {};
  // Single source of truth: if a linked project exists, its stages/LPOs win.
  // S._linkedProject is loaded (async) before the form renders; see openQuotation.
  const lp = S._linkedProject;
  let scopeRows, lpoRows;
  // Scope source: prefer the quotation's own saved scope (has rev arrays), else
  // derive from a linked project's stored scope values.
  // The quotation record is the authoritative source for scope/fees/revisions
  // (that's where edits are saved). Prefer it over the linked-project copy.
  const srcScope = (existingData && existingData.scope) || (lp && lp.scope) || pj.scope || null;
  if (Array.isArray(srcScope) && srcScope.length) {
    scopeRows = srcScope.map(s => ({
      name: s.name || "",
      rev: Array.isArray(s.rev) && s.rev.length ? s.rev.slice() : [s.value != null ? s.value : ""]
    }));
  } else {
    scopeRows = null;
  }
  if (lp) {
    lpoRows = (lp.lpos || []).map(m => ({
      name: m.name || "", pct: m.pct != null ? m.pct : "", value: m.amount != null ? m.amount : "", invoiced: 0, received: 0
    }));
  } else {
    lpoRows = Array.isArray(pj.lpo) && pj.lpo.length ? pj.lpo.map(m => ({
      name: m.name || "", pct: m.pct != null ? m.pct : "", value: m.value != null ? m.value : "", invoiced: m.invoiced || 0, received: m.received || 0
    })) : null;
  }
  const srcGovt = (existingData && existingData.govtFees) || (lp && lp.govtFees) || pj.govtFees || [];
  const srcSub  = (existingData && existingData.subFees)  || (lp && lp.subFees)  || pj.subFees  || null;
  const srcFrozen = (existingData && existingData.scopeFrozen != null ? existingData.scopeFrozen : (lp && lp.scopeFrozen)) || pj.scopeFrozen || 0;
  // Sub-Contractor rows are fully dynamic (free-text type + name + values).
  const subFees = (Array.isArray(srcSub) && srcSub.length)
    ? srcSub.map(s => ({
        label: s.label || "", name: s.name || "",
        rev: Array.isArray(s.rev) && s.rev.length ? s.rev.slice() : [s.amount != null ? s.amount : ""]
      }))
    : [{ label: "", name: "", rev: [""] }];
  S._pj = {
    folderPath: (existingData && existingData.folderPath) || (lp && lp.folderPath) || pj.folderPath || (S._revParentProject && S._revParentProject.folderPath) || "",
    scope: (scopeRows && scopeRows.length) ? scopeRows : [{ name: "", rev: [""] }],
    scopeFrozen: srcFrozen,
    subFees,
    govtFees: Array.isArray(srcGovt) ? srcGovt.map(g => ({
      label: g.label || "",
      rev: Array.isArray(g.rev) && g.rev.length ? g.rev.slice() : [g.amount != null ? g.amount : ""]
    })) : [],
    lpo:   (lpoRows && lpoRows.length)   ? lpoRows   : [{ name: "", pct: "", value: "", invoiced: 0, received: 0 }],
    scopeFile: (lp && lp.scopeFile) || pj.scopeFile || null,
    lpoFile: (lp && lp.lpoFile) || pj.lpoFile || null,
  };
}

function _isAwardedNow() {
  const won = (document.getElementById("qf-open_status")?.value || "").toLowerCase() === "won";
  const lpo = (document.getElementById("qf-lpo_received")?.value || "").toUpperCase() === "Y";
  const emailOk = (document.getElementById("qf-email_confirm")?.value || "").toUpperCase() === "Y";
  // Won + LPO received + email confirmation → awarded details unlock.
  return won && lpo && emailOk;
}

// Re-render the section when award status changes (wired via onchange below).
// Show the Remarks group only when status is Regret or Lost.
function _toggleRemarks(status) {
  const el = document.getElementById("remarks-group");
  if (!el) return;
  el.style.display = (status === "Regret" || status === "Lost") ? "" : "none";
}

// Update a milestone row's value + the running % total live, without
// re-rendering the inputs (so typing isn't interrupted).
function _updateMilestoneRow(i) {
  if (!S._pj || !S._pj.lpo) return;
  const contractTotal = (typeof _scopeContractTotalRaw === "function") ? _scopeContractTotalRaw() : 0;
  const m = S._pj.lpo[i];
  if (m) {
    const span = document.getElementById("ms-val-" + i);
    if (span) span.textContent = fmtAED(Math.round(contractTotal * (parseFloat(m.pct) || 0) / 100));
  }
  const pctTotal = S._pj.lpo.reduce((a, x) => a + (parseFloat(x.pct) || 0), 0);
  const tot = document.getElementById("ms-pct-total");
  if (tot) {
    tot.textContent = `Total: ${pctTotal}%${pctTotal !== 100 ? ' (should be 100%)' : ''}`;
    tot.style.color = pctTotal === 100 ? '#166a3f' : '#a06b00';
  }
}

function refreshProjectDetails() {
  const host = document.getElementById("pj-details-host");
  if (host) host.outerHTML = renderProjectDetailsSection(S._editingQuotation || {});
}

function renderProjectDetailsSection() {
  const awarded = _isAwardedNow();
  const pj = S._pj || { scope: [], lpo: [] };
  const lpoTotal = pj.lpo.reduce((a, m) => a + (parseFloat(m.value) || 0), 0);

  let h = `<div id="pj-details-host" class="pj-section" style="margin-top:18px;border:1px solid ${awarded ? '#7c5cff' : '#e3e6ef'};border-radius:12px;padding:14px;background:${awarded ? 'rgba(124,92,255,0.04)' : '#fafafe'}">`;
  h += `<div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;margin-bottom:4px">
    📁 Project Details ${awarded ? '<span style="background:#7c5cff;color:#fff;font-size:10px;padding:2px 8px;border-radius:10px">AWARDED</span>'
      : '<span style="background:#eee;color:#888;font-size:10px;padding:2px 8px;border-radius:10px">fills on award</span>'}</div>`;
  h += `<div style="font-size:11px;color:#888;margin-bottom:12px">Used by Coordinator (scope) and Account (milestones) once the quotation is <b>Won</b>, <b>LPO Received = Y</b> and <b>Email Confirmed</b>.</div>`;

  if (!awarded) {
    h += `<div style="font-size:12px;color:#a06b00;background:#fff7e6;border:1px solid #ffe1a8;border-radius:8px;padding:8px 10px">Set <b>Status = Won</b>, <b>LPO Received = Y</b> and <b>Email Confirmation = Y</b> above to activate this section. You can still fill it in now; it takes effect on save.</div>`;
  }

  // ── Revision quotation: show the PARENT project's scope + milestones
  //    faded and read-only for reference, then an editable section below. ──
  const isRev = !!(S._editingQuotation && S._editingQuotation.is_revision);
  const parent = S._revParentProject;
  if (isRev && parent) {
    const pStages = (parent.stages || []).filter(s => s.type === "awarded_scope");
    const pLpos = parent.lpos || [];
    h += `<div style="margin-top:6px;margin-bottom:14px;border:1px dashed #cfd3e0;border-radius:10px;padding:12px;background:#f6f7fa;opacity:0.72">
      <div style="font-size:11px;font-weight:700;color:#7a8095;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Main Project Scope — reference only (Folder ${esc(parent.folderPath || parent.id || "")})</div>`;
    h += `<div style="font-size:11px;color:#8a8f9e;font-weight:600;margin-bottom:4px">Scope / Milestone Stages</div>`;
    if (pStages.length) {
      pStages.forEach(s => {
        h += `<div style="display:flex;gap:8px;font-size:12px;color:#666;padding:3px 0;border-bottom:1px solid #edeff4">
          <span style="flex:1">${esc(s.name || "—")}</span><span style="width:50px;text-align:right">${esc(s.pct||0)}%</span><span style="width:90px;text-align:right;color:#999">${esc(s.status||"Not started")}</span></div>`;
      });
    } else { h += `<div style="font-size:12px;color:#aaa">No scope stages on the main project.</div>`; }
    h += `<div style="font-size:11px;color:#8a8f9e;font-weight:600;margin:10px 0 4px">LPO Milestones</div>`;
    if (pLpos.length) {
      pLpos.forEach(m => {
        h += `<div style="display:flex;gap:8px;font-size:12px;color:#666;padding:3px 0;border-bottom:1px solid #edeff4">
          <span style="flex:1">${esc(m.name || "—")}</span><span style="width:110px;text-align:right">${fmtAED(m.amount||0)}</span><span style="width:70px;text-align:right;color:#999">${esc(m.status||"pending")}</span></div>`;
      });
    } else { h += `<div style="font-size:12px;color:#aaa">No milestones on the main project.</div>`; }
    h += `</div>
    <div style="font-size:12px;font-weight:700;color:#5b3df5;margin-bottom:8px">✏️ Additional Scope (this revision) — fill the new details below</div>`;
  }

  // Folder Number (reference) — this is the project name used across links.
  h += `<label style="font-size:12px;font-weight:600;display:block;margin:12px 0 4px">Folder Number <span style="color:#aaa;font-weight:400">(reference — used as project name, e.g. F1685-Alguair)</span></label>
    <input id="pj-folderPath" class="fi" type="text" value="${esc(pj.folderPath || "")}" placeholder="e.g. F1685-Alguair"
      oninput="S._pj.folderPath=this.value" style="width:100%"/>`;

  // Contract total (computed from the Scope & Fees section above) — used for
  // milestone value calculation.
  const contractTotal = _scopeContractTotalRaw();

  // ── Payment Milestones (description + % of contract value) ──
  const pctTotal = pj.lpo.reduce((a, m) => a + (parseFloat(m.pct) || 0), 0);
  h += `<div style="margin-top:18px;font-weight:600;font-size:13px;display:flex;justify-content:space-between;align-items:center">
    <span>💰 Payment Milestones</span>
    <span id="ms-pct-total" style="font-size:11px;color:${pctTotal===100?'#166a3f':'#a06b00'}">Total: ${pctTotal}%${pctTotal!==100?' (should be 100%)':''}</span></div>`;
  h += `<div style="display:flex;gap:6px;margin-top:6px;font-size:10px;color:#999;font-weight:600">
    <span style="flex:1">Description</span><span style="width:70px;text-align:right">%</span><span style="width:110px;text-align:right">Value (AED)</span><span style="width:28px"></span></div>`;
  h += `<div id="pj-lpo-rows">`;
  pj.lpo.forEach((m, i) => {
    const mval = Math.round(contractTotal * (parseFloat(m.pct) || 0) / 100);
    h += `<div class="pj-row" style="display:flex;gap:6px;margin-top:6px;align-items:center">
      <input class="fi" type="text" value="${esc(m.name)}" placeholder="Milestone description" oninput="S._pj.lpo[${i}].name=this.value" style="flex:1"/>
      <input class="fi" type="number" min="0" max="100" value="${esc(String(m.pct != null ? m.pct : ''))}" placeholder="%" oninput="S._pj.lpo[${i}].pct=this.value;_updateMilestoneRow(${i})" style="width:70px;text-align:right"/>
      <span id="ms-val-${i}" style="width:110px;text-align:right;font-size:12px;color:#166a3f;font-weight:600">${fmtAED(mval)}</span>
      <button type="button" class="btn btn-sm" style="background:#f3f3f7;color:#c0392b" onclick="S._pj.lpo.splice(${i},1);refreshProjectDetails()">✕</button>
    </div>`;
  });
  h += `</div><button type="button" class="btn btn-sm" style="margin-top:6px;background:#eef0ff;color:#5b3df5" onclick="S._pj.lpo.push({name:'',pct:'',value:'',invoiced:0,received:0});refreshProjectDetails()">+ Add milestone</button>`;
  h += attachmentWidget(pj.lpoFile, "lpo", "lpofile", "_setLpoFile");

  h += `</div>`;
  return h;
}

function _setScopeFile(att) { if (S._pj) S._pj.scopeFile = att; }
function _setLpoFile(att)   { if (S._pj) S._pj.lpoFile = att; }

// Read the inline block back into the shape ensureProjectFromQuotation() reads.
// Returns null when not awarded (so non-awarded quotations carry no project).
// Sub-contractor fee types available in the dropdown.
const SUBCON_FEE_TYPES = ["ADM", "ADDC", "Local / ADDC", "Freelancer"];
const GOVT_FEE_TYPES = ["Government Dept", "Aldar Tasareeh", "ADM Fees", "ADDC Fees", "Other Govt Fee"];

// Scope & Fees section — shown ABOVE the Status group. Each scope row has
// R0/R1/R2… revision value columns (R0 freezes on submit). Sub-contractor fee
// lines are added via a "+ Sub-Contractor Fees" dropdown. Totals: scope
// sub-total (current revision) + VAT (5%) + fees = Total incl. VAT & Fees.
function renderScopeAndFees() {
  if (!S._pj) return "";
  return `<div id="scope-fees-host">${_renderScopeAndFeesInner()}</div>`;
}
function refreshScopeFees() {
  const host = document.getElementById("scope-fees-host");
  if (host) host.innerHTML = _renderScopeAndFeesInner();
  // Milestone values derive from the scope total — refresh them too.
  if (typeof refreshProjectDetails === "function") refreshProjectDetails();
}
function _renderScopeAndFeesInner() {
  if (!S._pj) return "";
  if (!Array.isArray(S._pj.scope)) S._pj.scope = [];
  if (!Array.isArray(S._pj.subFees)) S._pj.subFees = [];
  if (!Array.isArray(S._pj.govtFees)) S._pj.govtFees = [];
  const scope = S._pj.scope, subFees = S._pj.subFees, govtFees = S._pj.govtFees;
  // Revision columns are shared across all three tables.
  const nRev = Math.max(1,
    ...scope.map(s => (s.rev && s.rev.length) || 1),
    ...subFees.map(s => (s.rev && s.rev.length) || 1),
    ...govtFees.map(g => (g.rev && g.rev.length) || 1), 1);
  const editableCol = nRev - 1;
  const frozen = S._pj.scopeFrozen || 0;

  // Shared header (section title on the left, + Add Revision on the right).
  let h = `<div class="sbox" style="margin-top:14px;border:1px solid #e6e8ef;border-radius:12px;padding:14px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
      <div style="font-weight:700;font-size:13px">🛠 Scope &amp; Fees <span style="font-size:10px;color:#aaa;font-weight:400">Use "+ Add Revision" to freeze the current column & open the next</span></div>
      <button type="button" class="btn btn-sm" style="background:#fff3e0;color:#e67e22;white-space:nowrap" onclick="_addRevisionColumn()">+ Add Revision (freezes Previous R)</button>
    </div>`;

  // Helper: render a revision table for a list. `arr` is the state array,
  // `arrName` the S._pj key. opts.fixed = fixed rows (Sub-Contractor),
  // opts.useDropdown = fee-type select (Govt Fees), opts.nameField = also show
  // an editable name input (Sub-Contractor contractor name).
  function revTable(arr, arrName, title, firstColLabel, opts) {
    opts = opts || {};
    // Consistent column widths so R0/R1/R2 align across all three tables.
    // Left area is always 260px total: either one 260px column, or two 130px
    // columns (Type + Contractor Name) for the sub-contractor table.
    const firstW = opts.nameField ? 130 : 260;
    let t = `<div style="margin-top:12px;font-weight:700;font-size:13px">${title}</div>`;
    t += `<div style="overflow-x:auto;margin-top:6px"><table style="width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed">
      <colgroup>
        <col style="width:${firstW}px"/>
        ${opts.nameField?`<col style="width:130px"/>`:""}
        ${Array.from({length:nRev}).map(()=>`<col style="width:100px"/>`).join("")}
        <col style="width:34px"/>
      </colgroup>
      <thead><tr style="background:#f5f6fa">
        <th style="text-align:left;padding:6px 8px">${firstColLabel}</th>
        ${opts.nameField?`<th style="text-align:left;padding:6px 8px">Contractor Name</th>`:""}
        ${Array.from({length:nRev}).map((_,c)=>`<th style="text-align:right;padding:6px 8px;color:${c===editableCol?'#5b3df5':'#999'}">R${c}${c<editableCol||c<frozen?' 🔒':''}</th>`).join("")}
        <th></th>
      </tr></thead><tbody>`;
    arr.forEach((row, ri) => {
      if (!Array.isArray(row.rev)) row.rev = [""];
      let first;
      if (opts.freeText) {
        first = editableSelect("subcontractor_type", row.label, `S._pj.${arrName}[${ri}].label=this.value`, "margin:0;width:100%");
      } else if (opts.useDropdown) {
        first = editableSelect("govt_fee_type", row.label, `S._pj.${arrName}[${ri}].label=this.value`, "margin:0;width:100%;font-size:11px");
      } else {
        first = `<input class="fi" style="margin:0;width:100%" value="${esc(row.name||"")}" placeholder="Scope of works description" oninput="S._pj.${arrName}[${ri}].name=this.value"/>`;
      }
      t += `<tr style="border-bottom:1px solid #eef0f3"><td style="padding:6px 8px">${first}</td>`;
      if (opts.nameField) {
        t += `<td style="padding:6px 8px"><input class="fi" style="margin:0;width:100%" value="${esc(row.name||"")}" placeholder="Contractor name" oninput="S._pj.${arrName}[${ri}].name=this.value"/></td>`;
      }
      t += Array.from({length:nRev}).map((_,c)=>{
        const locked = c < editableCol || c < frozen;
        const val = row.rev[c] != null ? row.rev[c] : "";
        return `<td style="padding:6px 8px;text-align:right">${locked
          ? `<span style="color:#888">${val!==""?fmtAED(val):"—"}</span>`
          : `<input class="fi sf-val" type="number" min="0" style="margin:0;width:100%;text-align:right" value="${esc(String(val))}" oninput="S._pj.${arrName}[${ri}].rev[${c}]=this.value;_updateScopeTotals()" data-arr="${arrName}" data-ri="${ri}" data-col="${c}" placeholder="AED"/>`}</td>`;
      }).join("");
      t += `<td style="padding:6px 8px">${opts.fixed?"":`<button type="button" class="btn btn-sm" style="background:#f3f3f7;color:#c0392b" onclick="S._pj.${arrName}.splice(${ri},1);refreshScopeFees()">✕</button>`}</td>`;
      t += `</tr>`;
    });
    t += `</tbody></table></div>`;
    if (!opts.fixed) {
      const pushObj = opts.useDropdown ? "{label:'',rev:['']}"
        : opts.freeText ? "{label:'',name:'',rev:['']}"
        : "{name:'',rev:['']}";
      t += `<button type="button" class="btn btn-sm" style="margin-top:6px;background:#eef0ff;color:#5b3df5;font-size:11px" onclick="S._pj.${arrName}.push(${pushObj});refreshScopeFees()">+ Add ${opts.addLabel||'row'}</button>`;
    }
    return t;
  }

  h += revTable(scope,    "scope",    "Scope of Works", "Scope of Works", { addLabel: "scope item" });
  h += revTable(subFees,  "subFees",  "Sub-Contractor", "Type",           { freeText: true, nameField: true, addLabel: "Contractor" });
  h += revTable(govtFees, "govtFees", "Govt Fees",      "Fee type",       { useDropdown: true, addLabel: "Govt Fee" });

  h += `<div id="scope-totals" style="margin-top:12px;border-top:1px solid #e6e8ef;padding-top:8px;font-size:12px">${_scopeTotalsHtml()}</div>`;
  h += attachmentWidget(S._pj.scopeFile, "scope", "scopefile", "_setScopeFile");
  h += `</div>`;
  return h;
}

// Totals HTML (recomputed from current state, current revision column).
function _scopeTotalsHtml() {
  const scope = S._pj.scope || [], subFees = S._pj.subFees || [], govtFees = S._pj.govtFees || [];
  const col = Math.max(1,
    ...scope.map(s => (s.rev && s.rev.length) || 1),
    ...subFees.map(s => (s.rev && s.rev.length) || 1),
    ...govtFees.map(g => (g.rev && g.rev.length) || 1), 1) - 1;
  const scopeSubtotal = scope.reduce((a,s)=> a + (parseFloat(s.rev && s.rev[col]) || 0), 0);
  const vat = Math.round(scopeSubtotal * 0.05);
  const subTotal = subFees.reduce((a,s)=> a + (parseFloat(s.rev && s.rev[col]) || 0), 0);
  const govtTotalV = govtFees.reduce((a,g)=> a + (parseFloat(g.rev && g.rev[col]) || 0), 0);
  const contractTotal = scopeSubtotal + vat + subTotal + govtTotalV;
  return `<div style="display:flex;justify-content:space-between;padding:2px 0"><span>Scope Sub-Total (R${col})</span><span style="font-weight:600">${fmtAED(scopeSubtotal)}</span></div>
    <div style="display:flex;justify-content:space-between;padding:2px 0"><span>VAT (5%)</span><span>${fmtAED(vat)}</span></div>
    <div style="display:flex;justify-content:space-between;padding:2px 0"><span>Sub-Contractor Fees (R${col})</span><span>${fmtAED(subTotal)}</span></div>
    <div style="display:flex;justify-content:space-between;padding:2px 0"><span>Govt Fees (R${col})</span><span>${fmtAED(govtTotalV)}</span></div>
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:2px solid #d6d9e2;margin-top:4px;font-weight:700;color:#0d2137">
      <span>Total including VAT &amp; Fees</span><span>${fmtAED(contractTotal)}</span></div>`;
}

// Update just the totals (called on value keystrokes) — does NOT re-render the
// inputs, so typing isn't interrupted.
function _updateScopeTotals() {
  const host = document.getElementById("scope-totals");
  if (host) host.innerHTML = _scopeTotalsHtml();
  // Milestone values derive from the total — refresh the awarded block too.
  if (typeof refreshProjectDetails === "function") refreshProjectDetails();
}

// Contract total from the Scope & Fees section (current revision column).
// Explicitly add a new revision column: freeze the current (newest) column and
// open R(n+1) on every scope row and fee line.
function _addRevisionColumn() {
  if (!S._pj) return;
  const scope = S._pj.scope || [], sub = S._pj.subFees || [], govt = S._pj.govtFees || [];
  [scope, sub, govt].forEach(list => list.forEach(r => { if (!Array.isArray(r.rev)) r.rev = [""]; }));
  const curCol = Math.max(1,
    ...scope.map(r => r.rev.length), ...sub.map(r => r.rev.length), ...govt.map(r => r.rev.length)) - 1;
  const hasData = [scope, sub, govt].some(list => list.some(r => r.rev[curCol] != null && r.rev[curCol] !== ""));
  if (!hasData) { alert("Enter R" + curCol + " values before adding the next revision."); return; }
  S._pj.scopeFrozen = curCol + 1;
  [scope, sub, govt].forEach(list => list.forEach(r => { r.rev[curCol + 1] = ""; }));
  refreshScopeFees();
}

function _scopeContractTotalRaw() {
  if (!S._pj || !Array.isArray(S._pj.scope)) return 0;
  const nRev = Math.max(1,
    ...S._pj.scope.map(s => (s.rev && s.rev.length) || 1),
    ...(S._pj.subFees||[]).map(s => (s.rev && s.rev.length) || 1),
    ...(S._pj.govtFees||[]).map(g => (g.rev && g.rev.length) || 1), 1);
  const col = nRev - 1;
  const scopeSub = S._pj.scope.reduce((a,s)=> a + (parseFloat(s.rev && s.rev[col])||0), 0);
  const vat = Math.round(scopeSub * 0.05);
  const subF = (S._pj.subFees||[]).reduce((a,s)=> a + (parseFloat(s.rev && s.rev[col])||0), 0);
  const govtF = (S._pj.govtFees||[]).reduce((a,g)=> a + (parseFloat(g.rev && g.rev[col])||0), 0);
  return scopeSub + vat + subF + govtF;
}

function collectProjectDetails(quotationData) {
  const won = (quotationData.open_status || "").toLowerCase() === "won";
  const lpo = (quotationData.lpo_received || "").toUpperCase() === "Y";
  const emailOk = (quotationData.email_confirm || "").toUpperCase() === "Y";
  if (!(won && lpo && emailOk)) return null;
  const pj = S._pj || {};
  const curCol = Math.max(1, ...(pj.scope||[]).map(s => (s.rev && s.rev.length) || 1), 1) - 1;
  const scope = (pj.scope || []).filter(s => (s.name || "").trim()).map(s => ({
    name: s.name.trim(),
    rev: (s.rev || []).map(v => v === "" || v == null ? "" : (parseFloat(v) || 0)),
    value: parseFloat(s.rev && s.rev[curCol]) || 0    // current-revision value
  }));
  const govtFees = (pj.govtFees || []).filter(g => (g.label || "").trim() || (g.rev||[]).some(v=>v!==""&&v!=null))
    .map(g => ({
      label: (g.label || "").trim(),
      rev: (g.rev || []).map(v => v === "" || v == null ? "" : (parseFloat(v) || 0)),
      amount: parseFloat(g.rev && g.rev[curCol]) || 0
    }));
  const subFees = (pj.subFees || []).map(s => ({
    label: s.label || "", name: s.name || "",
    rev: (s.rev || []).map(v => v === "" || v == null ? "" : (parseFloat(v) || 0)),
    amount: parseFloat(s.rev && s.rev[curCol]) || 0
  }));
  const subtotal = scope.reduce((a, s) => a + (s.value || 0), 0);
  const vat = Math.round(subtotal * 0.05);
  const subTotal = subFees.reduce((a, s) => a + (s.amount || 0), 0);
  const govtTotal = govtFees.reduce((a, g) => a + (g.amount || 0), 0);
  const contractTotal = subtotal + vat + subTotal + govtTotal;
  return {
    folderPath: (pj.folderPath || "").trim(),
    scope, govtFees, subFees, scopeFrozen: pj.scopeFrozen || 0,
    subtotal, vat, subTotal, govtTotal, contractTotal,
    lpo: (pj.lpo || []).filter(m => (m.name || "").trim()).map(m => ({
      name: m.name.trim(), pct: parseFloat(m.pct) || 0,
      value: Math.round(contractTotal * (parseFloat(m.pct) || 0) / 100),
      invoiced: parseFloat(m.invoiced) || 0, received: parseFloat(m.received) || 0
    })),
    scopeFile: pj.scopeFile || null,
    lpoFile: pj.lpoFile || null,
  };
}

// On submit: freeze the current (newest) SCOPE revision column and open a fresh
// R(n+1) column on every scope row for the next edit.
function _freezeFeesOnSubmit() {
  if (!S._pj || !Array.isArray(S._pj.scope) || !S._pj.scope.length) return;
  const scope = S._pj.scope, sub = S._pj.subFees || [], govt = S._pj.govtFees || [];
  [scope, sub, govt].forEach(list => list.forEach(r => { if (!Array.isArray(r.rev)) r.rev = [""]; }));
  const curCol = Math.max(1,
    ...scope.map(r => r.rev.length), ...sub.map(r => r.rev.length), ...govt.map(r => r.rev.length)) - 1;
  const hasData = [scope, sub, govt].some(list => list.some(r => r.rev[curCol] != null && r.rev[curCol] !== ""));
  if (!hasData) return;
  S._pj.scopeFrozen = curCol + 1;
  [scope, sub, govt].forEach(list => list.forEach(r => { r.rev[curCol + 1] = ""; }));
}
