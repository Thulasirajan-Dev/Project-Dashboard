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
// ── Quotation number format ────────────────────────────────────
// Format, category codes, and company-letter mapping all live in shared.js
// (qtnBuildNumber / QTN_CATEGORY_CODE / QTN_COMPANY_LETTER) since Coordinator
// needs the exact same format when minting a revision's quotation number —
// see shared.js _QTN_NUM_CONFIG / mintRevisionQuotation.
var QTN_CONFIG = {
  "Fitout Folder":  { counterKey: "qtn_counter/fitout",  startSeq: 1709, pattern: (seq, yr) => qtnBuildNumber("Fitout Folder", seq, yr) },
  "Live Folder":    { counterKey: "qtn_counter/live",    startSeq: 747,  pattern: (seq, yr) => qtnBuildNumber("Live Folder", seq, yr) },
  "ID Folder":      { counterKey: "qtn_counter/id",      startSeq: 108,  pattern: (seq, yr) => qtnBuildNumber("ID Folder", seq, yr) },
  "Private Folder": { counterKey: "qtn_counter/private", startSeq: 316,  pattern: (seq, yr) => qtnBuildNumber("Private Folder", seq, yr) }
};

// ── Location list from Data sheet ────────────────────────────
var LOCATIONS = [
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

var PROPOSAL_INCHARGE = ["Mohamed Ramees","Mahadir","Katheeja","Vaisakh","Hasna","Abhi","Other"];
// Feed the static LOCATIONS list into the shared, persisted option-list store
// (see shared.js) so "Location" behaves like the other add-your-own dropdowns.
if (typeof _OPTION_DEFAULTS !== "undefined") _OPTION_DEFAULTS.location = LOCATIONS;
// Resolve a stored incharge value (email or legacy name) to a display name.
function inchargeName(val) {
  if (!val) return "";
  const list = (typeof PROPOSAL_USERS !== "undefined") ? PROPOSAL_USERS : [];
  const u = list.find(x => (x.email || "") === val || x.name === val);
  return u ? u.name : val;
}
var QTN_STATUSES = ["Sent","Yet to be Sent","Regret"];
var OPEN_STATUS  = ["Open","Won","Lost"];

// ── Generate next QTN number ──────────────────────────────────
async function generateQtnNumber(category) {
  const cfg = QTN_CONFIG[category];
  if (!cfg) return "";
  const yr = String(new Date().getFullYear()).slice(-2); // "26"

  // Atomic increment — see fbIncrement/api/data.php 'increment' op. Two
  // Proposals users opening "New Quotation" for the same category at the
  // same instant can never be handed the same suggested number.
  const seq = await fbIncrement(coPath(cfg.counterKey), cfg.startSeq);

  return cfg.pattern(seq != null ? seq : cfg.startSeq, yr);
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
var COMPANY_FIELD_OVERRIDES = {
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
        { id: "location",     label: "Location",            type: "datalist", list: LOCATIONS, optionType: "location", required: true },
        { id: "qtn_status",   label: "Enquiry status",    type: "select", options: QTN_STATUSES, required: true },
        { id: "submitted_date", label: "Submitted Date",    type: "date" },
      ]
    },
    {
      group: "Client Details",
      fields: [
        { id: "client_name",   label: "Client / Firm Name",   type: "text", required: true, full: true },
        { id: "contact_person",label: "Contact Person",        type: "text", required: true },
        { id: "client_mobile", label: "Mobile",                type: "text" },
        { id: "proposal_incharge", label: "Proposal Incharge", type: "select", userRole: "proposals", allowDepartment: true, required: true },
        { id: "_coord_display", label: "Project Coordinator", type: "coord_display" },
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
        { id: "open_status",   label: "Quotation status", type: "select", options: OPEN_STATUS, required: true },
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
// Colors for Quotation status / Enquiry status dropdowns — same green/blue/
// red/amber visual language used for every other status field in the app.
var QTN_STATUS_COLORS = {
  open_status: { "Open": { bg:"#e8f0fe", color:"#1a5276" }, "Won": { bg:"#d4f0e3", color:"#166a3f" }, "Lost": { bg:"#fde8e8", color:"#a32d2d" } },
  qtn_status:  { "Sent": { bg:"#e8f0fe", color:"#1a5276" }, "Yet to be Sent": { bg:"#ffe8cc", color:"#a04800" }, "Regret": { bg:"#fde8e8", color:"#a32d2d" } },
  lpo_received:  { "Y": { bg:"#d4f0e3", color:"#166a3f" }, "N": { bg:"#fde8e8", color:"#a32d2d" } },
  email_confirm: { "Y": { bg:"#d4f0e3", color:"#166a3f" }, "N": { bg:"#fde8e8", color:"#a32d2d" } },
};
// Re-colors the select live on change (the quotation form isn't a full
// reactive re-render, so without this the color would only be right at
// initial page load, not after picking a new value).
function _colorStatusSelect(fieldId) {
  const el = document.getElementById("qf-" + fieldId);
  if (!el) return;
  const sc = QTN_STATUS_COLORS[fieldId] && QTN_STATUS_COLORS[fieldId][el.value];
  el.style.background = sc ? sc.bg : "";
  el.style.color = sc ? sc.color : "";
  el.style.borderColor = sc ? sc.color : "";
  el.style.fontWeight = sc ? "600" : "";
}

function renderField(f, value = "") {
  const colSpan = f.full ? 'style="grid-column:1/-1"' : "";
  let input = "";

  if (f.type === "coord_display") {
    // Read-only Project Coordinator reference — the assignee lives on the
    // linked project (or, for a revision, its parent project), never on the
    // quotation record itself, so it's rendered specially rather than as an
    // editable input.
    const linkedProj = (typeof S !== "undefined" && (S._revParentProject || S._linkedProject)) || null;
    const coordVal = (linkedProj && linkedProj.project && linkedProj.project.coordinator) || "";
    const coordName = coordVal ? (typeof resolveUserName === "function" ? resolveUserName(coordVal) : coordVal) : "";
    const coordIsEmail = /@/.test(coordVal);
    const display = coordVal
      ? `<a href="mailto:${esc(coordIsEmail ? coordVal : '')}" style="color:#5b3df5;text-decoration:none;font-weight:600">👤 ${esc(coordName)}${coordIsEmail ? ' ↗' : ''}</a>`
      : `<span style="color:var(--text-muted)">— Not assigned yet</span>`;
    return `<div ${colSpan}><div class="fl">${esc(f.label)}</div><div style="font-size:13px;padding:6px 0">${display}</div></div>`;
  }

  if (f.type === "followup_history") {
    let hist = [];
    try { hist = value ? (typeof value === "string" ? JSON.parse(value) : value) : []; } catch (e) { hist = []; }
    const rows = (Array.isArray(hist) && hist.length)
      ? hist.map(e => `<div style="padding:6px 10px;border-bottom:1px solid var(--border-soft);font-size:12px">
          <span style="color:var(--text-muted)">${esc(e.date || "")}</span> — <span style="color:var(--text)">${esc(e.note || "")}</span>
        </div>`).join("")
      : `<div style="padding:10px;color:var(--text-muted);font-size:12px">No previous follow-ups recorded.</div>`;
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
      if (value && !value.startsWith("dept:") && !optionSource.some(o => o.value === value)) {
        optionSource = optionSource.concat([{ value, label: value + " (inactive)" }]);
      }
    }
    const peopleOpts = optionSource.map(o => {
      const ov = (typeof o === "object") ? o.value : o;
      const ol = (typeof o === "object") ? o.label : o;
      return `<option value="${esc(ov)}" ${value === ov ? "selected" : ""}>${esc(ol)}</option>`;
    }).join("");
    // Department options — same dropdown, grouped separately, prefixed
    // "dept:" so this field can hold either a specific person's email OR a
    // team/department name, same assign-to-person-or-team pattern used by
    // Dependent Tasks.
    const deptOpts = f.allowDepartment && typeof DEP_TASK_DEPARTMENTS !== "undefined"
      ? DEP_TASK_DEPARTMENTS.map(dep => `<option value="dept:${esc(dep)}" ${value === "dept:"+dep ? "selected" : ""}>${esc(dep)}</option>`).join("")
      : "";
    const opts = `<option value="">— Select —</option>`
      + (f.userRole ? `<optgroup label="Assign to Person">${peopleOpts}</optgroup>` : peopleOpts)
      + (deptOpts ? `<optgroup label="Assign to Team">${deptOpts}</optgroup>` : "");
    // The award-gate fields refresh the inline Project Details section live.
    const onCh = (f.id === "open_status")
      ? ` onchange="_colorStatusSelect('open_status');_toggleRemarks();if(typeof refreshProjectDetails===\'function\')refreshProjectDetails()"`
      : (f.id === "qtn_status")
      ? ` onchange="_colorStatusSelect('qtn_status');_toggleRemarks()"`
      : (f.id === "lpo_received")
      ? ` onchange="_colorStatusSelect('lpo_received');if(typeof refreshProjectDetails===\'function\')refreshProjectDetails()"`
      : (f.id === "email_confirm")
      ? ` onchange="_colorStatusSelect('email_confirm');if(typeof refreshProjectDetails===\'function\')refreshProjectDetails()"` : "";
    const sc = QTN_STATUS_COLORS[f.id] && QTN_STATUS_COLORS[f.id][value];
    const colorStyle = sc ? `background:${sc.bg};color:${sc.color};border-color:${sc.color};font-weight:600;` : "";
    input = `<select class="fi" id="qf-${f.id}" style="${colorStyle}" ${f.required ? 'required' : ''}${onCh}>${opts}</select>`;

  } else if (f.type === "datalist") {
    const listId = `dl-${f.id}`;
    // f.optionType links this field to the shared, persisted dropdown-option
    // store (see shared.js addOptionValue/getOptionList) — typing a new value
    // and moving on saves it globally for every future quotation.
    const listSrc = f.optionType ? getOptionList(f.optionType) : (f.list || []);
    const opts = listSrc.map(l => `<option value="${esc(l)}">`).join("");
    const persistAttr = f.optionType ? ` onchange="addOptionValue('${f.optionType}', this.value)"` : "";
    input = `<input class="fi" id="qf-${f.id}" list="${listId}" value="${esc(value)}"
      placeholder="${esc(f.placeholder || (f.optionType ? 'Pick or type a new one' : ''))}" ${f.required ? 'required' : ''} autocomplete="off"${persistAttr}/>
      <datalist id="${listId}">${opts}</datalist>`;

  } else if (f.type === "textarea") {
    input = `<textarea class="fi" id="qf-${f.id}" rows="3" ${f.required ? 'required' : ''}
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
// ── Full-award lock ──────────────────────────────────────────
// Locks once "Save & Submit to Coordinator" has actually succeeded
// (coordinatorSubmitted flag — see submitQuotation), not just whenever the
// three status fields happen to be set. That flag only ever gets set when
// someone explicitly clicked Save & Submit while Won + Email Confirmed
// were satisfied, so it's the precise "this is finalized" signal. Read-only
// for everyone except Super Admin; a brand-new (never-saved) quotation is
// never locked.
function _isQuotationLocked(existingData) {
  if (!existingData || !existingData.qtn_number) return false;
  if (CURRENT_USER && CURRENT_USER.role === "super_admin") return false;
  return !!existingData.coordinatorSubmitted;
}
// Disable every form control inside the quotation form (scoped — never
// touches the header's Back/Cancel buttons, which live outside #qtn-form-root)
// and show a lock banner. Called after the form is in the DOM.
function _applyQuotationLock() {
  const root = document.getElementById("qtn-form-root");
  if (!root) return;
  root.querySelectorAll("input, select, textarea, button").forEach(el => {
    el.disabled = true;
    el.style.cursor = "not-allowed";
  });
  // Catch-all: some interactive bits aren't real form/button elements
  // (the scope drag handle, the Project Details collapse toggle, template
  // Load buttons) — pointer-events:none blocks all of them at once rather
  // than trying to enumerate every possible clickable element.
  root.style.pointerEvents = "none";
  root.style.opacity = "0.92";
}

function renderQuotationForm(category, qtnNumber, existingData = {}, editId = "") {
  const groups = getCategoryFields(category);
  const locked = _isQuotationLocked(existingData);
  let h = `<div class="sbox" id="qtn-form-root">
    ${locked ? `<div style="background:#fdecec;border:1px solid #f3c0c0;color:#a32d2d;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;font-weight:600">
      🔒 This quotation has been submitted to Coordinator and is now read-only. Only a Super Admin can make further changes.
    </div>` : ""}
    <div class="sbox-title" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <span>📋 ${esc(catLabel(category))} — ${editId ? "Edit" : "New"} Quotation</span>
      <span style="display:flex;align-items:center;gap:6px">
        <span style="font-size:14px">🔢</span>
        <input id="qf-qtn_number" class="fi" style="margin:0;width:230px;font-weight:700;text-align:center;font-size:13px;font-family:'SF Mono',Consolas,Menlo,monospace;letter-spacing:0.5px" value="${esc(qtnNumber)}" placeholder="Q-W-F-####-YY-R0" title="Editable by Super Admin / Proposals — auto-suggested, adjust to continue your own numbering"/>
      </span>
    </div>
    <input type="hidden" id="qf-category" value="${esc(category)}"/>
    <input type="hidden" id="qf-edit_id" value="${esc(editId)}"/>`;

  // Seed project-details state early so the fees matrix (placed above Status)
  // has its data ready.
  initProjectDetails(existingData);
  let _scopePlaced = false;
  groups.forEach(group => {
    // Scope & Fees AND Payment Milestones both sit directly ABOVE the
    // Status & Confirmation group — always visible, not tucked away.
    if (group.group === "Status & Confirmation" && !_scopePlaced) {
      h += renderScopeAndFees();
      h += renderPaymentMilestonesSection();
      _scopePlaced = true;
    }
    // Remarks only shows (and is mandatory) when Enquiry status is Regret
    // or Quotation status is Lost.
    if (group.group === "Remarks") {
      const openSt = existingData.open_status || "";
      const qtnSt = existingData.qtn_status || "";
      const show = (openSt === "Lost" || qtnSt === "Regret");
      h += `<div id="remarks-group" style="${show ? "" : "display:none"}">
        <div class="sbox" style="margin-bottom:0;border:none;padding:0;margin-top:14px">
          <div class="fl" style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin-bottom:10px">${esc(group.group)}</div>
          <div class="fgrid">`;
      group.fields.forEach(f => {
        // Mandatory only while visible — a plain copy so the shared field
        // definition (used by the generic required-fields check) never
        // becomes unconditionally required.
        const ff = show ? Object.assign({}, f, { required: true }) : f;
        h += renderField(ff, existingData[f.id] || "");
      });
      h += `</div></div></div>`;
      return;
    }
    h += `<div class="sbox" style="margin-bottom:0;border:none;padding:0;margin-top:14px">
      <div class="fl" style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin-bottom:10px">${esc(group.group)}</div>
      <div class="fgrid">`;
    group.fields.forEach(f => {
      h += renderField(f, existingData[f.id] || "");
    });
    h += `</div></div>`;
  });
  if (!_scopePlaced) { h += renderScopeAndFees(); h += renderPaymentMilestonesSection(); }

  // Proof / attachment (one file per quotation)
  S._pendingAttachment = (existingData && existingData.attachment) ? existingData.attachment : null;
  h += attachmentWidget(S._pendingAttachment, "quotation", editId || qtnNumber, "_setQuotationAttachment");

  // Collapsible Project Details box (Folder Number + Project Type only —
  // Scope & Fees and Payment Milestones now render above, always visible).
  h += renderProjectDetailsSection(existingData);

  // Two save actions:
  //  - "Save" persists the quotation only. It never creates/updates the
  //    Coordinator/Account project, even if the quotation is already
  //    Won + LPO Received (awarded).
  //  - "Save & Submit to Coordinator" persists the quotation AND (only when
  //    awarded) pushes/refreshes the project via ensureProjectFromQuotation.
  const _submitted = !!existingData.coordinatorSubmitted;
  h += `<div style="margin-top:16px;padding-top:10px;border-top:1px solid var(--border-soft);font-size:11px;color:${_submitted ? '#166a3f' : '#a06b00'};text-align:right">
    ${_submitted ? `✅ Submitted to Coordinator${existingData.coordinatorSubmittedAt ? ' on ' + new Date(existingData.coordinatorSubmittedAt).toLocaleDateString() : ''}` : '⚠️ Not yet submitted to Coordinator — saved locally only'}
  </div>`;
  if (locked) {
    h += `<div style="margin-top:8px;padding:13px;text-align:center;background:var(--surface-2);border-radius:8px;color:var(--text-muted);font-size:13px;font-weight:600">🔒 Locked — read-only for your role</div>`;
  } else {
    h += `<div style="display:flex;gap:10px;margin-top:8px">
      <button class="btn" style="flex:1;background:#f3f3f7;color:var(--text);padding:13px;font-size:14px" type="button"
        onclick="submitQuotation(false)">💾 Save</button>
      <button class="btn btn-purple" style="flex:1;padding:13px;font-size:14px" type="button"
        onclick="submitQuotation(true)">Save &amp; Submit to Coordinator ${svgIcon('check',14,'#fff')}</button>
    </div>`;
  }

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

  // Net Amount (WHC) = what WHC retains after Sub-Contractor + Govt Fees.
  // Gross/Total incl. VAT = the full amount invoiced to the client.
  data.net_amount = (typeof _scopeNetAmountRaw === "function") ? _scopeNetAmountRaw() : 0;
  data.gross_amount = (typeof _scopeContractTotalRaw === "function") ? _scopeContractTotalRaw() : data.net_amount;

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
      desc: (s.desc||"").trim(),
      code: (s.code||"").trim(),
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
    // Payment Milestones (% of contract value) — also saved unconditionally
    // so a Coordinator's read-only Review can show progress before award.
    data.lpo = (S._pj.lpo || []).filter(m => (m.name||"").trim()).map(m => ({
      name: (m.name||"").trim(), pct: parseFloat(m.pct) || 0
    }));
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
  const openStatus = (data.open_status || "");
  const enquiryStatus = (data.qtn_status || "");
  // Enquiry status = Regret, or Quotation status = Lost → Remarks mandatory.
  if ((openStatus === "Lost" || enquiryStatus === "Regret") && !(data.remarks || "").trim()) {
    missing.push("Remarks (required when " + (openStatus === "Lost" ? "Quotation status is Lost" : "Enquiry status is Regret") + ")");
  }
  // Won → email confirmation must be received before the awarded details
  // are considered complete. (LPO Received is tracked separately and no
  // longer gates this.)
  if (openStatus === "Won") {
    if ((data.email_confirm || "") !== "Y") missing.push("Email Confirmation Received = Y (required when Won)");
  }

  if (missing.length) {
    alert("Please fix the following:\n• " + missing.join("\n• "));
    return false;
  }
  return true;
}

// ── Submit quotation to Firebase ──────────────────────────────
// pushToCoordinator: false = local save only (never touches the Coordinator
// / Account project). true = also register/refresh the project when the
// quotation is awarded (Won + Email Confirmed).
async function submitQuotation(pushToCoordinator) {
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

  // Coordinator submission flag: sticky true once submitted at least once,
  // so a later "Save" (local) doesn't wrongly flip the badge back to
  // "not submitted" — it just means the newest edits haven't been pushed.
  data.coordinatorSubmitted = pushToCoordinator || !!(prev && prev.coordinatorSubmitted);
  data.coordinatorSubmittedAt = pushToCoordinator ? nowIso : ((prev && prev.coordinatorSubmittedAt) || null);

  document.getElementById("app").innerHTML =
    `<div class="loading"><div class="spinner"></div><div style="font-size:13px;color:var(--text-muted)">${isEdit ? "Updating" : "Saving"} quotation...</div></div>`;

  const ok = await fbSet(`${basePath}/${entryId}`, data);
  if (ok) {
    // Only count NEW quotations in the monthly summary (editing must not double-count).
    if (!isEdit) await updateSummaryCounter(data);
    // Grow Master-Template with any genuinely NEW section headings typed in
    // this quotation — existing Master-Template entries are never touched
    // (no overwriting, no values added), so a proposal stays fully editable
    // without affecting how Master-Template already looks for anyone else.
    try { await _appendNewScopeItemsToMasterTemplate(); } catch (e) {}
    // If awarded (Won AND email confirmed) AND the user explicitly chose
    // "Save & Submit to Coordinator", register/refresh the project for the
    // Coordinator (scope stages) and Account (LPO milestones). A plain
    // "Save" never touches the Coordinator/Account project.
    const _won = (data.open_status || "").toLowerCase() === "won";
    // Only register the project when the awarded details block was actually
    // built (Won + email confirm satisfied → data.project is set).
    if (pushToCoordinator && _won && data.project) {
      try { await ensureProjectFromQuotation(data, category); } catch (e) {}
    }
    if (typeof logActivity === "function") {
      const changeSummary = isEdit ? diffQuotationFields(category, prev, data) : "";
      const detail = isEdit
        ? (changeSummary ? `${catLabel(category)} · ${changeSummary}` : catLabel(category))
        : catLabel(category);
      // Tag with the project id (deterministic from the quotation, doesn't
      // require the project to exist yet) — the project's own Activity Log
      // tab filters strictly by projectId, so without this, every Proposals
      // entry existed in the global log but was invisible there.
      const logProjectId = (typeof deriveProjectIdForQuotation === "function") ? deriveProjectIdForQuotation(data) : "";
      logActivity("Proposals", isEdit ? "Updated quotation" : "Created quotation",
        data.qtn_number || data.proj_name || entryId, detail, null, logProjectId);
    }
    const _pushedMsg = (pushToCoordinator && _won && data.project) ? " and submitted to Coordinator" : "";
    alert(`✅ Quotation ${data.qtn_number} ${isEdit ? "updated" : "saved"}${_pushedMsg} successfully!`);
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

// ── Render quotations list ────────────────────────────────────
// Quotations that belong to the SAME project (an original quotation + each
// of its revisions, linked via parent_project_id) render as ONE card with
// clickable quotation-number tags — not as separate, unrelated-looking cards.

// ── Open a quotation for viewing/editing ──────────────────────

// ── Delete a quotation — DISABLED ─────────────────────────────
// Quotations/enquiries are kept permanently as history and cannot be
// deleted. This stub remains only so any old cached page that still
// references it fails safely instead of erroring.

// ── Entry point: called when user picks a category ────────────
async function startNewQuotation(category) {
  S._editMode = false;            // ensure this is a fresh create, not an edit
  S._editingQuotation = null; S._linkedProject = null; S._revParentProject = null;
  document.getElementById("app").innerHTML =
    `<div class="loading"><div class="spinner"></div><div style="font-size:13px;color:var(--text-muted)">Generating quotation number...</div></div>`;
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
// When there's no scope saved yet (a brand-new quotation), load straight
// from Master-Template — the single source of truth for scope sections.
// Editing afterward is local to this quotation only.
// When someone picks (or types) a Section Name that matches a Master-
// Template heading — by containing or being contained in it, not
// requiring an exact full match — and this row's Description/Code are
// still empty, fill them in from the template. Still fully editable
// afterward, and this never touches Master-Template itself.
function _scopeSectionPicked(arrName, ri, val) {
  if (!S._pj || !Array.isArray(S._pj[arrName]) || !S._pj[arrName][ri]) return;
  const q = (val || "").trim().toLowerCase();
  if (!q) return;
  const tpl = (typeof getMasterScopeTemplate === "function") ? getMasterScopeTemplate(CUSTOM_SCOPE_TEMPLATES) : [];
  const match = tpl.find(h => {
    const hn = (h.name || "").trim().toLowerCase();
    return hn && (hn === q || hn.includes(q) || q.includes(hn));
  });
  if (!match) return;
  const row = S._pj[arrName][ri];
  // Code is auto-numbered from position, never copied — only description
  // gets pulled in from a matched Master-Template heading.
  if (!row.desc && match.desc) {
    row.desc = match.desc;
    if (typeof refreshScopeFees === "function") refreshScopeFees();
  }
}

// Grow Master-Template with any section heading typed in THIS quotation
// that isn't already in it — matched case-insensitively on the name. Never
// modifies an existing Master-Template entry (no description/code
// overwrite, no values ever added — templates hold headings+descriptions
// only). Only ever ADDS new entries, so a proposal editing/using existing
// headings never changes what Master-Template looks like for anyone else.
async function _appendNewScopeItemsToMasterTemplate() {
  if (!S._pj || !Array.isArray(S._pj.scope)) return;
  const rows = S._pj.scope.filter(s => (s.name || "").trim());
  if (!rows.length) return;

  // Fetch a FRESH copy so this can't clobber another user's edits, and so
  // we're checking "new" against the true current state, not a stale cache.
  const fresh = (await fbGet(coPath("options/scope_templates"), { fresh: true })) || {};
  const current = getMasterScopeTemplate(fresh); // custom override if present, else the built-in default
  const existingNames = new Set(current.map(it => (it.name || "").trim().toLowerCase()));

  const additions = [];
  const seenThisSave = new Set();
  rows.forEach(row => {
    const key = row.name.trim().toLowerCase();
    if (existingNames.has(key) || seenThisSave.has(key)) return;
    seenThisSave.add(key);
    additions.push({ code: row.code || "", name: row.name.trim(), desc: row.desc || "" });
  });
  if (!additions.length) return;

  fresh[MASTER_SCOPE_TEMPLATE_NAME] = {
    items: current.concat(additions),
    createdBy: (fresh[MASTER_SCOPE_TEMPLATE_NAME] && fresh[MASTER_SCOPE_TEMPLATE_NAME].createdBy) || "",
    createdAt: new Date().toISOString(),
    sourceProject: "Master-Template"
  };
  CUSTOM_SCOPE_TEMPLATES = fresh;
  try { await fbSet(coPath("options/scope_templates"), fresh); } catch (e) {}
}

function _masterScopeRowsForNewQuotation() {
  const tpl = (typeof getMasterScopeTemplate === "function") ? getMasterScopeTemplate(CUSTOM_SCOPE_TEMPLATES) : [];
  if (!tpl.length) return [{ code: "", name: "", desc: "", rev: [""] }];
  return tpl.map(item => ({ code: item.code || "", name: item.name || "", desc: item.desc || "", rev: [] }));
}
function initProjectDetails(existingData) {
  S._pjDetailsExpanded = false; // Project Details is collapsed by default on open.
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
      desc: s.desc || "",
      code: s.code || "",
      rev: Array.isArray(s.rev) && s.rev.length ? s.rev.slice() : [s.value != null ? s.value : ""]
    }));
  } else {
    scopeRows = null;
  }
  // LPO/Milestones source: same priority as scope above — the quotation's
  // own saved data is authoritative. This used to check `lp` (linked
  // project) FIRST and read lp.lpos, which is a dead legacy field the real
  // pipeline (ensureProjectFromQuotation) never populates — meaning every
  // time an already-awarded quotation was reopened, its milestones
  // silently reset to empty instead of showing what was actually saved.
  const srcLpo = (Array.isArray(pj.lpo) && pj.lpo.length) ? pj.lpo : ((lp && Array.isArray(lp.lpos) && lp.lpos.length) ? lp.lpos : null);
  if (Array.isArray(srcLpo) && srcLpo.length) {
    lpoRows = srcLpo.map(m => ({
      name: m.name || "", pct: m.pct != null ? m.pct : "",
      value: m.value != null ? m.value : (m.amount != null ? m.amount : ""),
      invoiced: m.invoiced || 0, received: m.received || 0
    }));
  } else {
    lpoRows = null;
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
    unitType: (lp && lp.project && Array.isArray(lp.project.unitType) && lp.project.unitType.length) ? lp.project.unitType.slice() : (Array.isArray(pj.unitType) ? pj.unitType.slice() : []),
    scope: (scopeRows && scopeRows.length) ? scopeRows : _masterScopeRowsForNewQuotation(),
    scopeFrozen: srcFrozen,
    subFees,
    govtFees: Array.isArray(srcGovt) ? srcGovt.map(g => ({
      label: g.label || "",
      rev: Array.isArray(g.rev) && g.rev.length ? g.rev.slice() : [g.amount != null ? g.amount : ""]
    })) : [],
    lpo:   (lpoRows && lpoRows.length)   ? lpoRows   : [{ name: "", pct: "", value: "", invoiced: 0, received: 0 }],
    scopeFile: (lp && lp.scopeFile) || pj.scopeFile || null,
    subFile: (lp && lp.subFile) || pj.subFile || null,
    lpoFile: (lp && lp.lpoFile) || pj.lpoFile || null,
  };
}

function _isAwardedNow() {
  const won = (document.getElementById("qf-open_status")?.value || "").toLowerCase() === "won";
  const emailOk = (document.getElementById("qf-email_confirm")?.value || "").toUpperCase() === "Y";
  // Won + email confirmation → awarded details unlock. (LPO Received is
  // still tracked as its own field, just no longer a gate for this.)
  return won && emailOk;
}
// Payment Milestones has its OWN, separate gate: LPO Received = Y. Scope &
// Fees / Project Details unlock on Won + Email Confirmed alone, but
// milestones stay hidden until the LPO itself has actually been received.
function _isLpoReceived() {
  return (document.getElementById("qf-lpo_received")?.value || "").toUpperCase() === "Y";
}

// Re-render the section when either status field changes (wired via
// onchange below). Show + mandate the Remarks group when Enquiry status is
// Regret or Quotation status is Lost — updates the label's asterisk and the
// textarea's required attribute live, not just visibility.
function _toggleRemarks() {
  const el = document.getElementById("remarks-group");
  if (!el) return;
  const openSt = document.getElementById("qf-open_status")?.value || "";
  const qtnSt = document.getElementById("qf-qtn_status")?.value || "";
  const show = (openSt === "Lost" || qtnSt === "Regret");
  el.style.display = show ? "" : "none";
  const ta = document.getElementById("qf-remarks");
  if (ta) { if (show) ta.setAttribute("required", "required"); else ta.removeAttribute("required"); }
  // Two .fl elements live in this group: the "REMARKS" section header, and
  // the field's own label — the field label is the last one in DOM order.
  const labels = el.querySelectorAll(".fl");
  const label = labels[labels.length - 1];
  if (label) {
    const hasStar = label.querySelector(".req-star");
    if (show && !hasStar) label.insertAdjacentHTML("beforeend", ' <span class="req-star">*</span>');
    else if (!show && hasStar) hasStar.remove();
  }
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
  const msHost = document.getElementById("pj-milestones-host");
  if (msHost) msHost.outerHTML = renderPaymentMilestonesSection();
}

function _togglePjDetails() {
  S._pjDetailsExpanded = !S._pjDetailsExpanded;
  refreshProjectDetails();
}

function renderProjectDetailsSection() {
  const awarded = _isAwardedNow();
  const pj = S._pj || { scope: [], lpo: [] };
  const lpoTotal = pj.lpo.reduce((a, m) => a + (parseFloat(m.value) || 0), 0);
  const expanded = !!S._pjDetailsExpanded;

  let h = `<div id="pj-details-host" class="pj-section" style="margin-top:18px;border:1px solid ${awarded ? '#7c5cff' : '#e3e6ef'};border-radius:12px;padding:14px;background:${awarded ? 'rgba(124,92,255,0.04)' : '#fafafe'}">`;
  h += `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer" onclick="_togglePjDetails()">
    <div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;flex-wrap:wrap">
      📁 Project Details ${awarded ? '<span style="background:#7c5cff;color:#fff;font-size:10px;padding:2px 8px;border-radius:10px">AWARDED</span>'
        : '<span style="background:var(--surface-2);color:var(--text-muted);font-size:10px;padding:2px 8px;border-radius:10px">fills on award</span>'}</div>
    <span style="font-size:12px;color:#7a8095">${expanded ? '▲ Hide' : '▼ Show'}</span>
  </div>`;
  if (!expanded) { h += `</div>`; return h; }
  h += `<div style="font-size:11px;color:var(--text-muted);margin:4px 0 12px">Used by Coordinator (scope) and Account (milestones) once the quotation is <b>Won</b> and <b>Email Confirmed</b>.</div>`;

  if (!awarded) {
    h += `<div style="font-size:12px;color:#a06b00;background:#fff7e6;border:1px solid #ffe1a8;border-radius:8px;padding:8px 10px">Set <b>Status = Won</b> and <b>Email Confirmation = Y</b> above to activate this section. You can still fill it in now; it takes effect on save.</div>`;
  }

  // ── Revision quotation: show the PARENT project's scope + milestones
  //    faded and read-only for reference, then an editable section below. ──
  const isRev = !!(S._editingQuotation && S._editingQuotation.is_revision);
  const parent = S._revParentProject;
  if (isRev && parent) {
    const pStages = (parent.stages || []).filter(s => s.type === "awarded_scope");
    // Real milestone data lives in quotationGroups[].milestones, not the
    // dead legacy parent.lpos array (never populated by the actual award
    // pipeline) — flatten across every quotation group on the parent.
    const pLpos = [];
    (parent.quotationGroups || []).forEach(g => {
      const gt = g.contractTotal || 0;
      (g.milestones || []).forEach(m => pLpos.push({
        name: m.name,
        amount: (typeof milestoneAmount === "function") ? milestoneAmount(m, gt) : (m.amount || 0),
        status: (typeof accountStatus === "function") ? accountStatus(m) : (m.status || "Open")
      }));
    });
    h += `<div style="margin-top:6px;margin-bottom:14px;border:1px dashed #cfd3e0;border-radius:10px;padding:12px;background:var(--surface-2);opacity:0.72">
      <div style="font-size:11px;font-weight:700;color:#7a8095;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Main Project Scope — reference only (Folder ${esc(parent.folderPath || parent.id || "")})</div>`;
    h += `<div style="font-size:11px;color:#8a8f9e;font-weight:600;margin-bottom:4px">Scope / Milestone Stages</div>`;
    if (pStages.length) {
      pStages.forEach(s => {
        h += `<div style="display:flex;gap:8px;font-size:12px;color:#666;padding:3px 0;border-bottom:1px solid #edeff4">
          <span style="flex:1">${esc(s.name || "—")}</span><span style="width:50px;text-align:right">${esc(s.pct||0)}%</span><span style="width:90px;text-align:right;color:var(--text-muted)">${esc(s.status||"Not started")}</span></div>`;
      });
    } else { h += `<div style="font-size:12px;color:var(--text-muted)">No scope stages on the main project.</div>`; }
    h += `<div style="font-size:11px;color:#8a8f9e;font-weight:600;margin:10px 0 4px">LPO Milestones</div>`;
    if (pLpos.length) {
      pLpos.forEach(m => {
        h += `<div style="display:flex;gap:8px;font-size:12px;color:#666;padding:3px 0;border-bottom:1px solid #edeff4">
          <span style="flex:1">${esc(m.name || "—")}</span><span style="width:110px;text-align:right">${fmtAED(m.amount||0)}</span><span style="width:70px;text-align:right;color:var(--text-muted)">${esc(m.status||"Open")}</span></div>`;
      });
    } else { h += `<div style="font-size:12px;color:var(--text-muted)">No milestones on the main project.</div>`; }
    h += `</div>
    <div style="font-size:12px;font-weight:700;color:#5b3df5;margin-bottom:8px">✏️ Additional Scope (this revision) — fill the new details below</div>`;
  }

  // Folder Number (reference) — this is the project name used across links.
  h += `<label style="font-size:12px;font-weight:600;display:block;margin:12px 0 4px">Folder Number <span style="color:var(--text-muted);font-weight:400">(reference — used as project name, e.g. F1685-Alguair)</span></label>
    <input id="pj-folderPath" class="fi" type="text" value="${esc(pj.folderPath || "")}" placeholder="e.g. F1685-Alguair"
      oninput="S._pj.folderPath=this.value" style="width:100%"/>`;

  // Project Type — multiple selection (chips). Feeds the Coordinator/Account
  // "nature of project" filters.
  h += `<label style="font-size:12px;font-weight:600;display:block;margin:12px 0 4px">Project Type <span style="color:var(--text-muted);font-weight:400">(select all that apply)</span></label>
    <div id="pj-projtype-chips" style="display:flex;flex-wrap:wrap;gap:6px">
      ${PROJECT_TYPES_NEW.map(t => {
        const on = (pj.unitType || []).includes(t);
        return `<button type="button" class="ptype-chip" onclick="_toggleProjectType('${t}')"
          style="padding:5px 12px;border-radius:16px;font-size:12px;cursor:pointer;border:1px solid ${on ? '#5b3df5' : '#dcdfe8'};background:${on ? '#5b3df5' : '#fff'};color:${on ? '#fff' : '#555'};font-weight:${on?'600':'400'}">${esc(t)}</button>`;
      }).join("")}
    </div>`;

  h += `</div>`;
  return h;
}

// Payment Milestones — its OWN standalone section (not nested inside the
// collapsible Project Details box), placed right after Scope & Fees and
// ABOVE the Status & Confirmation group so it's always visible, matching
// how Scope & Fees is already positioned.
function renderPaymentMilestonesSection() {
  const pj = S._pj || { lpo: [] };
  if (!Array.isArray(pj.lpo)) pj.lpo = [];
  const lpoReceived = _isLpoReceived();

  // Hidden entirely until LPO Received = Y — this is a stricter, separate
  // gate from Scope & Fees / Project Details (Won + Email Confirmed).
  if (!lpoReceived) {
    return `<div id="pj-milestones-host" class="pj-section" style="margin-top:14px;border:1px dashed #e3e6ef;border-radius:12px;padding:14px;background:var(--surface-2);text-align:center">
      <div style="font-weight:600;font-size:13px;color:var(--text-muted)">💰 Payment Milestones</div>
      <div style="font-size:12px;color:#a06b00;background:#fff7e6;border:1px solid #ffe1a8;border-radius:8px;padding:8px 10px;margin-top:8px">Set <b>LPO Received = Y</b> below to unlock Payment Milestones.</div>
    </div>`;
  }

  const awarded = _isAwardedNow();
  // Contract total (computed from the Scope & Fees section above) — used for
  // milestone value calculation.
  const contractTotal = _scopeContractTotalRaw();
  const pctTotal = pj.lpo.reduce((a, m) => a + (parseFloat(m.pct) || 0), 0);

  let h = `<div id="pj-milestones-host" class="pj-section" style="margin-top:14px;border:1px solid ${awarded ? '#7c5cff' : '#e3e6ef'};border-radius:12px;padding:14px;background:${awarded ? 'rgba(124,92,255,0.04)' : '#fafafe'}">`;
  h += `<div style="font-weight:600;font-size:13px;display:flex;justify-content:space-between;align-items:center">
    <span>💰 Payment Milestones</span>
    <span id="ms-pct-total" style="font-size:11px;color:${pctTotal===100?'#166a3f':'#a06b00'}">Total: ${pctTotal}%${pctTotal!==100?' (should be 100%)':''}</span></div>`;
  if (!awarded) {
    h += `<div style="font-size:12px;color:#a06b00;background:#fff7e6;border:1px solid #ffe1a8;border-radius:8px;padding:8px 10px;margin-top:8px">Set <b>Status = Won</b> and <b>Email Confirmation = Y</b> below to activate this section. You can still fill it in now; it takes effect on save.</div>`;
  }
  h += `<div style="display:flex;gap:6px;margin-top:10px;font-size:10px;color:var(--text-muted);font-weight:600">
    <span style="flex:1">Description</span><span style="width:70px;text-align:right">%</span><span style="width:110px;text-align:right">Value (AED)</span><span style="width:28px"></span></div>`;
  h += `<div id="pj-lpo-rows">`;
  pj.lpo.forEach((m, i) => {
    const mval = Math.round(contractTotal * (parseFloat(m.pct) || 0) / 100);
    h += `<div class="pj-row" style="display:flex;gap:6px;margin-top:6px;align-items:center">
      <input class="fi" type="text" value="${esc(m.name)}" placeholder="Milestone description" oninput="S._pj.lpo[${i}].name=this.value" style="flex:1"/>
      <input class="fi" type="number" min="0" max="100" value="${esc(String(m.pct != null ? m.pct : ''))}" placeholder="%" oninput="S._pj.lpo[${i}].pct=this.value;_updateMilestoneRow(${i})" style="width:70px;text-align:right"/>
      <span id="ms-val-${i}" style="width:110px;text-align:right;font-size:12px;color:var(--money-color);font-weight:600">${fmtAED(mval)}</span>
      <button type="button" class="btn btn-sm" style="background:#f3f3f7;color:#c0392b" onclick="S._pj.lpo.splice(${i},1);refreshProjectDetails()">✕</button>
    </div>`;
  });
  h += `</div><button type="button" class="btn btn-sm" style="margin-top:6px;background:#eef0ff;color:#5b3df5" onclick="S._pj.lpo.push({name:'',pct:'',value:'',invoiced:0,received:0});refreshProjectDetails()">+ Add milestone</button>`;
  h += `</div>`;
  return h;
}

function _setScopeFile(att) { if (S._pj) S._pj.scopeFile = att; }
function _setSubFile(att)   { if (S._pj) S._pj.subFile = att; }

function _toggleProjectType(t) {
  if (!S._pj) return;
  if (!Array.isArray(S._pj.unitType)) S._pj.unitType = [];
  const i = S._pj.unitType.indexOf(t);
  if (i >= 0) S._pj.unitType.splice(i, 1); else S._pj.unitType.push(t);
  const host = document.getElementById("pj-projtype-chips");
  if (host) {
    host.innerHTML = PROJECT_TYPES_NEW.map(pt => {
      const on = S._pj.unitType.includes(pt);
      return `<button type="button" class="ptype-chip" onclick="_toggleProjectType('${pt}')"
        style="padding:5px 12px;border-radius:16px;font-size:12px;cursor:pointer;border:1px solid ${on ? '#5b3df5' : '#dcdfe8'};background:${on ? '#5b3df5' : '#fff'};color:${on ? '#fff' : '#555'};font-weight:${on?'600':'400'}">${esc(pt)}</button>`;
    }).join("");
  }
}

// Read the inline block back into the shape ensureProjectFromQuotation() reads.
// Returns null when not awarded (so non-awarded quotations carry no project).
// Sub-contractor fee types available in the dropdown.
var SUBCON_FEE_TYPES = ["ADM", "ADDC", "Local / ADDC", "Freelancer"];
var GOVT_FEE_TYPES = ["Government Dept", "Aldar Tasareeh", "ADM Fees", "ADDC Fees", "Other Govt Fee"];

// Predefined Scope of Works templates (Master-Template lives in shared.js
// as SCOPE_TEMPLATES — it is the ONLY source of truth for scope items).

// Custom scope templates — an edited copy of Master-Template (saved via the
// Templates module's Create/Edit) lives here, server-side under options/,
// and takes precedence over the hardcoded default (see
// getMasterScopeTemplate in shared.js). Proposals only ever READS this —
// editing scope inside a quotation never writes back here.
var CUSTOM_SCOPE_TEMPLATES = {};
async function loadCustomScopeTemplates() {
  try { CUSTOM_SCOPE_TEMPLATES = (await fbGet(coPath("options/scope_templates"))) || {}; }
  catch (e) { CUSTOM_SCOPE_TEMPLATES = {}; }
  return CUSTOM_SCOPE_TEMPLATES;
}

// Load a named template's section headings + descriptions into this
// quotation's Scope of Works (appended, never replacing what's there).
// Editing afterward is purely local to this quotation — it never affects
// the template itself. Master-Template auto-loads by default for a
// brand-new quotation, but any other saved template can be picked too.
function _loadScopeTemplate(name) {
  const custom = CUSTOM_SCOPE_TEMPLATES[name];
  const tpl = (custom && custom.items) || SCOPE_TEMPLATES[name];
  if (!tpl || !tpl.length || !S._pj) return;
  if (!Array.isArray(S._pj.scope)) S._pj.scope = [];
  // Drop a single still-empty leading row so loading into a brand-new
  // quotation doesn't leave a stray blank line above it.
  if (S._pj.scope.length === 1 && !S._pj.scope[0].name && !S._pj.scope[0].desc && !S._pj.scope[0].code) S._pj.scope = [];
  tpl.forEach(item => {
    S._pj.scope.push({ code: item.code || "", name: item.name || "", desc: item.desc || "", rev: [] });
  });
  if (typeof refreshScopeFees === "function") refreshScopeFees();
}

// Scope & Fees section — shown ABOVE the Status group. Each scope row has
// R0/R1/R2… revision value columns (R0 freezes on submit). Sub-contractor fee
// lines are added via a "+ Sub-Contractor Fees" dropdown. Totals: scope
// sub-total (current revision) + VAT (5%) + fees = Total incl. VAT & Fees.
function renderScopeAndFees() {
  if (!S._pj) return "";
  return `<div id="scope-fees-host">${_renderScopeAndFeesInner()}</div>`;
}
// ── Scope row drag-and-drop reorder ─────────────────────────────
// Dragging the ⠿ handle moves that row's whole data set (code, section
// name, description, and every R0/R1/R2… price) to the dropped position —
// it's a plain array splice, so nothing about the row's data changes,
// only its position in S._pj[arrName].
var _scopeDragSrc = null;
function _scopeDragStart(e, arrName, i) {
  _scopeDragSrc = i;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", String(i));
  setTimeout(() => {
    const rows = document.querySelectorAll(".scope-drag-row");
    if (rows[i]) rows[i].classList.add("scope-row-dragging");
  }, 0);
}
function _scopeDragOver(e, i) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  document.querySelectorAll(".scope-drag-row").forEach((el, idx) => {
    el.classList.toggle("scope-row-over", idx === i && _scopeDragSrc !== null && _scopeDragSrc !== i);
  });
}
function _scopeDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove("scope-row-over");
}
function _scopeDragDrop(e, arrName, i) {
  e.preventDefault(); e.stopPropagation();
  _scopeClearDrag();
  if (_scopeDragSrc !== null && _scopeDragSrc !== i && S._pj && Array.isArray(S._pj[arrName])) {
    const [moved] = S._pj[arrName].splice(_scopeDragSrc, 1);
    S._pj[arrName].splice(i, 0, moved);
    if (typeof refreshScopeFees === "function") refreshScopeFees();
  }
  _scopeDragSrc = null;
}
function _scopeDragEnd() { _scopeClearDrag(); _scopeDragSrc = null; }
function _scopeClearDrag() {
  document.querySelectorAll(".scope-drag-row").forEach(el => el.classList.remove("scope-row-dragging", "scope-row-over"));
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
      <div style="font-weight:700;font-size:13px">🛠 Scope &amp; Fees <span style="font-size:10px;color:var(--text-muted);font-weight:400">Use "+ Add Revision" to freeze the current column & open the next</span></div>
      <button type="button" class="btn btn-sm" style="background:#fff3e0;color:#e67e22;white-space:nowrap" onclick="_addRevisionColumn()">+ Add Revision (freezes Previous R)</button>
    </div>`;

  // Helper: render a revision table for a list. `arr` is the state array,
  // `arrName` the S._pj key. opts.fixed = fixed rows (Sub-Contractor),
  // opts.useDropdown = fee-type select (Govt Fees), opts.nameField = also show
  // an editable name input (Sub-Contractor contractor name).
  function revTable(arr, arrName, title, firstColLabel, opts) {
    opts = opts || {};
    // Percentage-based columns with table-layout:fixed — always sums to
    // exactly 100% of the actual container width (unlike plain pixel
    // widths, which can leave the table narrower than its container, or
    // auto-layout, which can give number columns disproportionate space
    // at the description column's expense). The description column
    // always keeps a healthy majority share (min 30%) no matter how many
    // revision columns exist; each revision column is capped at 18% so a
    // small number of them can't hog the row either.
    const delPct = 4;
    const namePct = opts.nameField ? 16 : 0;
    const revPctEach = Math.min(18, (100 - delPct - namePct - 30) / Math.max(nRev, 1));
    const revPctTotal = revPctEach * nRev;
    const firstPct = 100 - delPct - namePct - revPctTotal;
    let t = title ? `<div style="margin-top:12px;font-weight:700;font-size:13px">${title}</div>` : "";
    t += `<div style="overflow-x:auto;margin-top:6px"><table style="width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed">
      <colgroup>
        <col style="width:${firstPct}%"/>
        ${opts.nameField?`<col style="width:${namePct}%"/>`:""}
        ${Array.from({length:nRev}).map(()=>`<col style="width:${revPctEach}%"/>`).join("")}
        <col style="width:${delPct}%"/>
      </colgroup>
      <thead><tr style="background:var(--surface-3)">
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
      } else if (opts.description) {
        // Section Name is an editable dropdown of Master-Template's current
        // headings — pick one as a starting point (auto-fills description
        // and code if this row's are still empty) or just type your own;
        // it stays a normal free-text field either way.
        const sectionListId = `dl-scope-sec-${arrName}-${ri}`;
        const masterHeadings = (typeof getMasterScopeTemplate === "function")
          ? getMasterScopeTemplate(typeof CUSTOM_SCOPE_TEMPLATES !== "undefined" ? CUSTOM_SCOPE_TEMPLATES : {})
          : [];
        // Auto-numbered from this row's CURRENT position — not manually
        // typed. Since re-rendering after a drag-drop reorder walks the
        // array in its new order, this always matches: drag row 4 to the
        // top and it becomes B1, everything below shifts down by one.
        row.code = "B" + (ri + 1);
        first = `<div style="display:flex;gap:6px;align-items:flex-start">
          <span class="scope-drag-handle" draggable="true"
            ondragstart="_scopeDragStart(event,'${arrName}',${ri})" ondragend="_scopeDragEnd()"
            title="Drag to reorder this scope item" style="cursor:grab;color:var(--text-muted);font-size:15px;padding:6px 2px 0 0;flex:none;user-select:none">⠿</span>
          <div style="margin:0;width:38px;flex:none;text-align:center;font-weight:700;font-size:11px;color:#5b3df5;padding-top:8px;user-select:none" title="Auto-numbered from position — drag to reorder">${esc(row.code)}</div>
          <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:0">
            <input class="fi" list="${sectionListId}" style="margin:0;width:100%;font-weight:600" value="${esc(row.name||"")}" placeholder="Pick a Master-Template heading or type your own"
              oninput="S._pj.${arrName}[${ri}].name=this.value" onchange="_scopeSectionPicked('${arrName}',${ri},this.value)"/>
            <datalist id="${sectionListId}">${masterHeadings.map(h => `<option value="${esc(h.name||"")}">`).join("")}</datalist>
            <textarea class="fi" style="margin:0;width:100%;min-height:48px;resize:vertical;font-size:11px;font-weight:400" placeholder="Description (optional)" oninput="S._pj.${arrName}[${ri}].desc=this.value">${esc(row.desc||"")}</textarea>
          </div>
        </div>`;
      } else {
        first = `<input class="fi" style="margin:0;width:100%" value="${esc(row.name||"")}" placeholder="Scope of works description" oninput="S._pj.${arrName}[${ri}].name=this.value"/>`;
      }
      // Scope rows (Section Name + Description + Price, i.e. the whole rev[]
      // row) are draggable as one unit via the ⠿ handle — dropping on
      // another row reorders the underlying array, so all of that row's data
      // moves together.
      const rowDragAttrs = opts.description
        ? ` class="scope-drag-row" data-ri="${ri}" ondragover="_scopeDragOver(event,${ri})" ondragleave="_scopeDragLeave(event)" ondrop="_scopeDragDrop(event,'${arrName}',${ri})"`
        : "";
      t += `<tr${rowDragAttrs} style="border-bottom:1px solid var(--border-soft)"><td style="padding:6px 8px">${first}</td>`;
      if (opts.nameField) {
        t += `<td style="padding:6px 8px"><input class="fi" style="margin:0;width:100%" value="${esc(row.name||"")}" placeholder="Contractor name" oninput="S._pj.${arrName}[${ri}].name=this.value"/></td>`;
      }
      t += Array.from({length:nRev}).map((_,c)=>{
        const locked = c < editableCol || c < frozen;
        const val = row.rev[c] != null ? row.rev[c] : "";
        return `<td style="padding:6px 8px;text-align:right">${locked
          ? `<span style="color:var(--text-muted)">${val!==""?fmtAED(val):"—"}</span>`
          : `<input class="fi sf-val" type="number" min="0" style="margin:0;width:100%;text-align:right" value="${esc(String(val))}" oninput="S._pj.${arrName}[${ri}].rev[${c}]=this.value;_updateScopeTotals()" data-arr="${arrName}" data-ri="${ri}" data-col="${c}" placeholder="AED"/>`}</td>`;
      }).join("");
      t += `<td style="padding:6px 8px">${opts.fixed?"":`<button type="button" class="btn btn-sm" style="background:#f3f3f7;color:#c0392b" onclick="S._pj.${arrName}.splice(${ri},1);refreshScopeFees()">✕</button>`}</td>`;
      t += `</tr>`;
    });
    t += `</tbody></table></div>`;
    if (!opts.fixed) {
      const pushObj = opts.useDropdown ? "{label:'',rev:['']}"
        : opts.freeText ? "{label:'',name:'',rev:['']}"
        : opts.description ? "{code:'',name:'',desc:'',rev:['']}"
        : "{name:'',rev:['']}";
      t += `<button type="button" class="btn btn-sm" style="margin-top:6px;background:#eef0ff;color:#5b3df5;font-size:11px" onclick="S._pj.${arrName}.push(${pushObj});refreshScopeFees()">+ Add ${opts.addLabel||'row'}</button>`;
    }
    return t;
  }

  h += `<div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
    <div style="font-weight:700;font-size:13px">Scope of Works <span style="font-size:10px;color:var(--text-muted);font-weight:400">Master-Template loads in automatically for a new quotation — edit freely here, or load another template below</span></div>
    <div style="display:flex;gap:6px;align-items:center">
      <select id="scope-tpl-pick" class="fi" style="margin:0;font-size:11px;width:auto;max-width:220px">
        <option value="">Load Template…</option>
        ${Object.keys(SCOPE_TEMPLATES).length ? `<optgroup label="Default">${Object.keys(SCOPE_TEMPLATES).map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join("")}</optgroup>` : ""}
        ${Object.keys(CUSTOM_SCOPE_TEMPLATES).filter(k=>!SCOPE_TEMPLATES[k]).length ? `<optgroup label="Saved by team">${Object.keys(CUSTOM_SCOPE_TEMPLATES).filter(k=>!SCOPE_TEMPLATES[k]).map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join("")}</optgroup>` : ""}
      </select>
      <button type="button" class="btn btn-sm" style="background:#eef0ff;color:#5b3df5" onclick="const v=document.getElementById('scope-tpl-pick').value;if(v)_loadScopeTemplate(v)">+ Load</button>
    </div>
  </div>`;
  h += revTable(scope,    "scope",    "", "Scope of Works", { addLabel: "scope item", description: true });
  h += `<div id="scope-subtotal-host" style="margin-top:8px;padding-top:6px;border-top:1px solid var(--border-soft);font-size:12px">${_scopeSubtotalHtml()}</div>`;
  h += attachmentWidget(S._pj.scopeFile, "scope", "scopefile", "_setScopeFile");

  h += revTable(subFees,  "subFees",  "Sub-Contractor/Provision Fees", "Type",           { freeText: true, nameField: true, addLabel: "Contractor" });
  h += `<div id="subfees-subtotal-host" style="margin-top:8px;padding-top:6px;border-top:1px solid var(--border-soft);font-size:12px">${_subFeesSubtotalHtml()}</div>`;
  h += attachmentWidget(S._pj.subFile, "subcontractor", "subfile", "_setSubFile");

  h += revTable(govtFees, "govtFees", "Govt Fees",      "Fee type",       { useDropdown: true, addLabel: "Govt Fee" });
  h += `<div id="govt-subtotal-host" style="margin-top:8px;padding-top:6px;border-top:1px solid var(--border-soft);font-size:12px">${_govtSubtotalHtml()}</div>`;

  h += `<div id="fee-summary-host" style="margin-top:14px;border-top:2px solid #d6d9e2;padding-top:8px;font-size:12px">${_feeSummaryHtml()}</div>`;
  h += `</div>`;
  return h;
}

// Shared fee breakdown: Scope and Sub-Contractor each get their own 5% VAT
// line; Govt Fees carry no VAT. Net Amount (WHC) = what WHC actually keeps
// after passing through Sub-Contractor + Govt Fees; Total incl. VAT = the
// full amount invoiced to the client (sum of all three "incl. VAT" totals).
function _computeFeeBreakdown(scope, subFees, govtFees, col) {
  const scopeSubtotal = (scope || []).reduce((a, s) => a + (parseFloat(s.rev && s.rev[col]) || 0), 0);
  const scopeVat = Math.round(scopeSubtotal * 0.05);
  const scopeInclVat = scopeSubtotal + scopeVat;

  const subFeesSubtotal = (subFees || []).reduce((a, s) => a + (parseFloat(s.rev && s.rev[col]) || 0), 0);
  const subFeesVat = Math.round(subFeesSubtotal * 0.05);
  const subFeesInclVat = subFeesSubtotal + subFeesVat;

  const govtSubtotal = (govtFees || []).reduce((a, g) => a + (parseFloat(g.rev && g.rev[col]) || 0), 0);

  // Net Amount (WHC) = the raw Scope Sub-Total for this revision column
  // (before VAT) — NOT netted against Sub-Contractor/Govt Fees anymore.
  const netAmountWHC = scopeSubtotal;
  // LPO incl. VAT = Scope + Sub-Contractor, both incl. VAT — deliberately
  // excludes Govt Fees.
  const lpoInclVat = scopeInclVat + subFeesInclVat;
  // Total Project Value incl. VAT = everything, incl. Govt Fees. This is
  // the figure Payment Milestone % values are calculated against.
  const totalInclVat = scopeInclVat + subFeesInclVat + govtSubtotal;

  return { scopeSubtotal, scopeVat, scopeInclVat, subFeesSubtotal, subFeesVat, subFeesInclVat, govtSubtotal, lpoInclVat, totalInclVat, netAmountWHC };
}

// Current editable revision column, shared across all three tables.
function _currentRevCol() {
  if (!S._pj) return 0;
  const nRev = Math.max(1,
    ...(S._pj.scope||[]).map(s => (s.rev && s.rev.length) || 1),
    ...(S._pj.subFees||[]).map(s => (s.rev && s.rev.length) || 1),
    ...(S._pj.govtFees||[]).map(g => (g.rev && g.rev.length) || 1), 1);
  return nRev - 1;
}

function _scopeSubtotalHtml() {
  const col = _currentRevCol();
  const b = _computeFeeBreakdown(S._pj.scope, S._pj.subFees, S._pj.govtFees, col);
  return `<div style="display:flex;justify-content:space-between;padding:2px 0"><span>Scope Sub-Total (R${col})</span><span style="font-weight:600">${fmtAED(b.scopeSubtotal)}</span></div>
    <div style="display:flex;justify-content:space-between;padding:2px 0"><span>VAT (5%)</span><span>${fmtAED(b.scopeVat)}</span></div>
    <div style="display:flex;justify-content:space-between;padding:2px 0;font-weight:700"><span>Scope Sub-Total incl. VAT</span><span>${fmtAED(b.scopeInclVat)}</span></div>`;
}
function _subFeesSubtotalHtml() {
  const col = _currentRevCol();
  const b = _computeFeeBreakdown(S._pj.scope, S._pj.subFees, S._pj.govtFees, col);
  return `<div style="display:flex;justify-content:space-between;padding:2px 0"><span>Sub-Contractor/Provision Fees Sub-Total (R${col})</span><span style="font-weight:600">${fmtAED(b.subFeesSubtotal)}</span></div>
    <div style="display:flex;justify-content:space-between;padding:2px 0"><span>VAT (5%)</span><span>${fmtAED(b.subFeesVat)}</span></div>
    <div style="display:flex;justify-content:space-between;padding:2px 0;font-weight:700"><span>Sub-Contractor/Provision Sub-Total incl. VAT</span><span>${fmtAED(b.subFeesInclVat)}</span></div>`;
}
function _govtSubtotalHtml() {
  const col = _currentRevCol();
  const b = _computeFeeBreakdown(S._pj.scope, S._pj.subFees, S._pj.govtFees, col);
  return `<div style="display:flex;justify-content:space-between;padding:2px 0"><span>Govt Fees Sub-Total (R${col})</span><span style="font-weight:600">${fmtAED(b.govtSubtotal)}</span></div>`;
}
function _feeSummaryHtml() {
  const col = _currentRevCol();
  const b = _computeFeeBreakdown(S._pj.scope, S._pj.subFees, S._pj.govtFees, col);
  return `<div style="font-size:11px;font-weight:700;color:#5b3df5;margin-bottom:4px">💰 Fee Summary</div>
    <div style="display:flex;justify-content:space-between;padding:2px 0;font-weight:700;color:var(--text)"><span>Net Amount (WHC)</span><span>${fmtAED(b.netAmountWHC)}</span></div>
    <div style="display:flex;justify-content:space-between;padding:2px 0;font-weight:700;color:#1a5fb4"><span>LPO incl. VAT</span><span>${fmtAED(b.lpoInclVat)}</span></div>
    <div style="display:flex;justify-content:space-between;padding:2px 0;font-weight:700;color:var(--money-color)"><span>Total Project Value incl. VAT</span><span>${fmtAED(b.totalInclVat)}</span></div>`;
}

// Update just the totals (called on value keystrokes) — does NOT re-render the
// inputs, so typing isn't interrupted.
function _updateScopeTotals() {
  const scopeHost = document.getElementById("scope-subtotal-host");
  if (scopeHost) scopeHost.innerHTML = _scopeSubtotalHtml();
  const subHost = document.getElementById("subfees-subtotal-host");
  if (subHost) subHost.innerHTML = _subFeesSubtotalHtml();
  const govtHost = document.getElementById("govt-subtotal-host");
  if (govtHost) govtHost.innerHTML = _govtSubtotalHtml();
  const summaryHost = document.getElementById("fee-summary-host");
  if (summaryHost) summaryHost.innerHTML = _feeSummaryHtml();
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
  return _computeFeeBreakdown(S._pj.scope, S._pj.subFees || [], S._pj.govtFees || [], col).totalInclVat;
}

// Net Amount (WHC) = Scope Sub-Total incl. VAT − Sub-Contractor Sub-Total
// incl. VAT − Govt Fees Sub-Total (the amount WHC actually retains).
function _scopeNetAmountRaw() {
  if (!S._pj || !Array.isArray(S._pj.scope)) return 0;
  const nRev = Math.max(1,
    ...S._pj.scope.map(s => (s.rev && s.rev.length) || 1),
    ...(S._pj.subFees||[]).map(s => (s.rev && s.rev.length) || 1),
    ...(S._pj.govtFees||[]).map(g => (g.rev && g.rev.length) || 1), 1);
  const col = nRev - 1;
  return _computeFeeBreakdown(S._pj.scope, S._pj.subFees || [], S._pj.govtFees || [], col).netAmountWHC;
}

function collectProjectDetails(quotationData) {
  const won = (quotationData.open_status || "").toLowerCase() === "won";
  const emailOk = (quotationData.email_confirm || "").toUpperCase() === "Y";
  // Won + email confirmation → build the awarded details. LPO Received is
  // still saved as its own field, just no longer required to unlock this.
  if (!(won && emailOk)) return null;
  const pj = S._pj || {};
  const curCol = Math.max(1, ...(pj.scope||[]).map(s => (s.rev && s.rev.length) || 1), 1) - 1;
  const scope = (pj.scope || []).filter(s => (s.name || "").trim()).map(s => ({
    name: s.name.trim(),
    desc: (s.desc || "").trim(),
    code: (s.code || "").trim(),
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
  const b = _computeFeeBreakdown(pj.scope || [], pj.subFees || [], pj.govtFees || [], curCol);
  const subtotal = b.scopeSubtotal, vat = b.scopeVat;
  const subTotal = b.subFeesSubtotal, subVat = b.subFeesVat;
  const govtTotal = b.govtSubtotal;
  const contractTotal = b.totalInclVat;      // Total Project Value incl. VAT — used for milestone % calc
  const netAmount = b.netAmountWHC;          // Net Amount (WHC) = raw Scope Sub-Total
  return {
    folderPath: (pj.folderPath || "").trim(),
    unitType: Array.isArray(pj.unitType) ? pj.unitType.slice() : [],
    scope, govtFees, subFees, scopeFrozen: pj.scopeFrozen || 0,
    subtotal, vat, subTotal, subVat, govtTotal, contractTotal, netAmount,
    lpo: (pj.lpo || []).filter(m => (m.name || "").trim()).map(m => ({
      name: m.name.trim(), pct: parseFloat(m.pct) || 0,
      value: Math.round(contractTotal * (parseFloat(m.pct) || 0) / 100),
      invoiced: parseFloat(m.invoiced) || 0, received: parseFloat(m.received) || 0
    })),
    scopeFile: pj.scopeFile || null,
    subFile: pj.subFile || null,
    lpoFile: pj.lpoFile || null,
  };
}

// On submit: freeze the current (newest) SCOPE revision column and open a fresh
// R(n+1) column on every scope row for the next edit.
