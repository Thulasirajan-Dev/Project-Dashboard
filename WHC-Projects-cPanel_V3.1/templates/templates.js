// ============================================================
//  Winner Holistic Consultants – Templates module
//  templates/templates.js  ·  Depends on: shared/shared.js
//
//  Scope of Works: Master-Template is the ONLY source of truth for scope
//  items across the whole app (see shared.js SCOPE_TEMPLATES /
//  getMasterScopeTemplate). This page is the ONLY place it's edited —
//  Proposals only ever loads from it and edits are local to that quotation,
//  never written back. Scope templates hold section headings + descriptions
//  ONLY — no AED values, since pricing is quotation-specific.
//
//  Approval Stage templates are a separate, unrestricted list (Coordinator
//  can still have as many as useful) — Create / Edit / Delete all apply.
// ============================================================

var CUSTOM_SCOPE_TEMPLATES_ALL = {};
var CUSTOM_APPROVAL_TEMPLATES_ALL = {};
// Every stage type actually used by real projects (see blankStages() in
// shared.js) — each has its own status option set (STAGE_OPTIONS), which
// is exactly why templates need to use the correct type per stage rather
// than defaulting everything to Preparation/Approval.
var STAGE_TYPE_CHOICES = [
  { v: "scope",           label: "Scope Analysis" },
  { v: "registration",    label: "Registration" },
  { v: "drawing_prep",    label: "Drawing Preparation" },
  { v: "approval_meps",   label: "Approval (MEPS)" },
  { v: "approval_portal", label: "Approval (Portal)" },
  { v: "site_work",       label: "Site Work" },
  { v: "inspection",      label: "Inspection" },
  { v: "gis",             label: "GIS Approval" },
  { v: "completed",       label: "Completion" },
];

async function loadAndRenderTemplates() {
  document.getElementById("app").innerHTML = `<div class="loading"><div class="spinner"></div><div style="font-size:13px;color:var(--text-muted)">Loading templates...</div></div>`;
  const [scopeCustom, approvalCustom] = await Promise.all([
    (typeof loadCustomTemplates === "function") ? loadCustomTemplates("scope_templates") : {},
    (typeof loadCustomTemplates === "function") ? loadCustomTemplates("approval_stage_templates") : {}
  ]);
  CUSTOM_SCOPE_TEMPLATES_ALL = scopeCustom || {};
  CUSTOM_APPROVAL_TEMPLATES_ALL = approvalCustom || {};
  renderTemplatesPage();
}

function _tplSetTab(t) { S.tplTab = t; S.search = ""; renderTemplatesPage(); }
function _tplToggle(key) { S.expanded[key] = !S.expanded[key]; renderTemplatesPage(); }

// Normalize a template entry to { items, createdBy, createdAt, sourceProject, builtin }
function _normalizeTpl(name, raw, builtin) {
  if (Array.isArray(raw)) return { items: raw, createdBy: "", createdAt: "", sourceProject: "", builtin, auto: false };
  return {
    items: raw.items || [],
    createdBy: raw.createdBy || "",
    createdAt: raw.createdAt || "",
    sourceProject: raw.sourceProject || "",
    builtin,
    auto: !!raw.auto
  };
}

async function _tplDelete(kind, name) {
  const store = kind === "scope" ? CUSTOM_SCOPE_TEMPLATES_ALL : CUSTOM_APPROVAL_TEMPLATES_ALL;
  if (!Object.prototype.hasOwnProperty.call(store, name)) return;
  if (kind === "scope" && name === MASTER_SCOPE_TEMPLATE_NAME) { alert("Master-Template can't be deleted — it's the only source of truth for scope items. Edit it instead."); return; }
  if (!confirm(`Delete the template "${name}"? This can't be undone, and it will disappear from Load Template everywhere.`)) return;
  delete store[name];
  const path = kind === "scope" ? "options/scope_templates" : "options/approval_stage_templates";
  try { await fbSet(coPath(path), store); } catch (e) {}
  renderTemplatesPage();
}

// ── Create / Edit modal ─────────────────────────────────────────
// S._tplEdit = { kind:"scope"|"approval", isNew, origName, name, items:[...] }
function _tplOpenNew(kind) {
  const it = kind === "scope" ? { code:"", name:"", desc:"" } : { name: "", type: "drawing_prep", time: "" };
  S._tplEdit = { kind, isNew: true, origName: "", name: "", items: [it] };
  renderTemplatesPage();
}
function _tplOpenEdit(kind, name) {
  const builtins = kind === "scope" ? SCOPE_TEMPLATES : APPROVAL_STAGE_TEMPLATES;
  const customs  = kind === "scope" ? CUSTOM_SCOPE_TEMPLATES_ALL : CUSTOM_APPROVAL_TEMPLATES_ALL;
  const raw = customs[name] || builtins[name];
  const tpl = _normalizeTpl(name, raw, !customs[name] && !!builtins[name]);
  const items = kind === "scope"
    ? (tpl.items.length ? tpl.items.map(it => ({ code: it.code||"", name: it.name||"", desc: it.desc||"" })) : [{ code:"", name:"", desc:"" }])
    : (tpl.items.length ? tpl.items.map(it => ({ name: it.name||"", type: it.type||"drawing_prep", time: it.time||"" })) : [{ name:"", type:"drawing_prep", time:"" }]);
  S._tplEdit = { kind, isNew: false, origName: name, name, items };
  renderTemplatesPage();
}
function _tplEditClose() { S._tplEdit = null; renderTemplatesPage(); }
function _tplEditAddRow() {
  const it = S._tplEdit.kind === "scope" ? { code:"", name:"", desc:"" } : { name:"", type:"drawing_prep", time:"" };
  S._tplEdit.items.push(it); renderTemplatesPage();
}
function _tplEditRemoveRow(i) { S._tplEdit.items.splice(i,1); renderTemplatesPage(); }

async function _tplEditSave() {
  const e = S._tplEdit;
  if (!e) return;
  const finalName = (e.name || "").trim();
  if (!finalName) { alert("Give the template a name."); return; }
  const items = e.kind === "scope"
    ? e.items.filter(it => (it.name||"").trim()).map(it => ({ code: (it.code||"").trim(), name: it.name.trim(), desc: (it.desc||"").trim() }))
    : e.items.filter(it => (it.name||"").trim()).map(it => ({ name: it.name.trim(), type: it.type || "drawing_prep", time: (it.time||"").trim() }));
  if (!items.length) { alert("Add at least one item before saving."); return; }

  const store = e.kind === "scope" ? CUSTOM_SCOPE_TEMPLATES_ALL : CUSTOM_APPROVAL_TEMPLATES_ALL;
  const path = e.kind === "scope" ? "options/scope_templates" : "options/approval_stage_templates";
  // Renaming: drop the old custom entry (the built-in default, if any, stays put).
  if (!e.isNew && e.origName && e.origName !== finalName) delete store[e.origName];

  const who = (typeof CURRENT_USER !== "undefined" && CURRENT_USER) || {};
  store[finalName] = {
    items,
    createdBy: who.name || who.email || "",
    createdAt: new Date().toISOString(),
    sourceProject: e.kind === "scope" && finalName === MASTER_SCOPE_TEMPLATE_NAME ? "Master-Template" : finalName
  };
  // Merge against a fresh server copy so this can never wipe out templates
  // saved by someone else in the meantime.
  try {
    const fresh = (await fbGet(coPath(path), { fresh: true })) || {};
    if (!e.isNew && e.origName && e.origName !== finalName) delete fresh[e.origName];
    fresh[finalName] = store[finalName];
    if (e.kind === "scope") CUSTOM_SCOPE_TEMPLATES_ALL = fresh; else CUSTOM_APPROVAL_TEMPLATES_ALL = fresh;
    await fbSet(coPath(path), fresh);
  } catch (err) {}
  S._tplEdit = null;
  renderTemplatesPage();
}

function _tplEditModal() {
  const e = S._tplEdit;
  if (!e) return "";
  const isScope = e.kind === "scope";
  const isMaster = isScope && e.origName === MASTER_SCOPE_TEMPLATE_NAME;
  return `<div class="overlay"><div class="modal" data-vo-safe style="max-width:800px;text-align:left;max-height:85vh;overflow-y:auto">
    <h3>${e.isNew ? "New" : "Edit"} ${isScope ? "Scope" : "Approval Stage"} Template</h3>
    <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Template name</label>
    <input class="fi" style="margin:0 0 14px" value="${esc(e.name)}" ${isMaster ? "disabled" : ""}
      oninput="S._tplEdit.name=this.value" placeholder="e.g. Standard Retail Fitout"/>
    ${isMaster ? `<div class="nb" style="margin-bottom:12px">Master-Template is the single source of truth for scope items everywhere in the app — its name can't be changed.</div>` : ""}

    <label style="font-size:12px;font-weight:600;display:block;margin-bottom:6px">${isScope ? "Sections (heading + description only — no AED values)" : "Stages"}</label>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px">
      ${e.items.map((it,i) => isScope ? `
        <div style="border:1px solid #e6e8ef;border-radius:8px;padding:8px;display:flex;gap:8px;align-items:flex-start">
          <input class="fi" style="margin:0;width:60px;flex:none;text-align:center;font-weight:700" placeholder="B.1" value="${esc(it.code||"")}" oninput="S._tplEdit.items[${i}].code=this.value"/>
          <div style="flex:1;display:flex;flex-direction:column;gap:6px">
            <input class="fi" style="margin:0;font-weight:600" placeholder="Section name" value="${esc(it.name||"")}" oninput="S._tplEdit.items[${i}].name=this.value"/>
            <textarea class="fi" style="margin:0;min-height:48px;resize:vertical;font-size:11px" placeholder="Description" oninput="S._tplEdit.items[${i}].desc=this.value">${esc(it.desc||"")}</textarea>
          </div>
          <button type="button" class="btn btn-sm btn-red" onclick="_tplEditRemoveRow(${i})">✕</button>
        </div>` : `
        <div style="border:1px solid #e6e8ef;border-radius:8px;padding:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input class="fi" style="margin:0;flex:2;min-width:160px" placeholder="Stage name" value="${esc(it.name||"")}" oninput="S._tplEdit.items[${i}].name=this.value"/>
          <select class="fi" style="margin:0;flex:1;min-width:150px" onchange="S._tplEdit.items[${i}].type=this.value">
            ${STAGE_TYPE_CHOICES.map(t => `<option value="${t.v}" ${it.type===t.v?'selected':''}>${esc(t.label)}</option>`).join("")}
          </select>
          <input class="fi" style="margin:0;width:130px" placeholder="e.g. 5 working days" value="${esc(it.time||"")}" oninput="S._tplEdit.items[${i}].time=this.value"/>
          <button type="button" class="btn btn-sm btn-red" onclick="_tplEditRemoveRow(${i})">✕</button>
        </div>`
      ).join("")}
    </div>
    <button type="button" class="btn-add" onclick="_tplEditAddRow()">+ Add ${isScope ? "section" : "stage"}</button>

    <div class="modal-btns" style="margin-top:16px">
      <button class="btn" style="background:var(--surface-2);color:#666" onclick="_tplEditClose()">Cancel</button>
      <button class="btn btn-gold" onclick="_tplEditSave()">Save Template</button>
    </div>
  </div></div>`;
}

function renderTemplatesPage() {
  const isScope = S.tplTab === "scope";
  const builtins = isScope ? (typeof SCOPE_TEMPLATES !== "undefined" ? SCOPE_TEMPLATES : {}) : (typeof APPROVAL_STAGE_TEMPLATES !== "undefined" ? APPROVAL_STAGE_TEMPLATES : {});
  const customs  = isScope ? CUSTOM_SCOPE_TEMPLATES_ALL : CUSTOM_APPROVAL_TEMPLATES_ALL;

  // Both tabs list ALL templates (built-in + saved-by-team). Master-Template
  // is just the one that auto-loads by default for a brand-new quotation —
  // it isn't the only scope template that can exist.
  const names = new Set([...Object.keys(builtins), ...Object.keys(customs)]);
  let all = Array.from(names).map(name => ({ name, tpl: _normalizeTpl(name, customs[name] || builtins[name], !customs[name]) }));
  const q = (S.search || "").toLowerCase();
  if (q) all = all.filter(x => x.name.toLowerCase().includes(q) ||
    (x.tpl.items || []).some(it => (it.name || "").toLowerCase().includes(q)));
  all.sort((a, b) => a.name.localeCompare(b.name));

  const totalItems = all.reduce((s, x) => s + (x.tpl.items || []).length, 0);

  let h = `<div class="pbar-header">
    <div class="pbar-label">🧩 Templates</div>
  </div>
  <div class="body">
  ${isScope
    ? `<div class="nb" style="margin-bottom:14px">📐 <b>Master-Template</b> loads automatically into every brand-new quotation by default — but you can create as many other Scope templates as useful and load any of them instead from the dropdown in Proposals. Master-Template itself can be edited but not deleted.</div>`
    : `<div class="nb" style="margin-bottom:14px">🗂️ Approval Stage templates for Coordinator's Approval Stages tab — create as many as useful, edit or delete any of them.</div>`}

  <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
    <div style="display:inline-flex;border:1px solid #d6d9e2;border-radius:8px;overflow:hidden">
      <button onclick="_tplSetTab('scope')" style="border:none;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;background:${isScope?'#0d2137':'#fff'};color:${isScope?'#fff':'#555'}">📐 Scope List Templates</button>
      <button onclick="_tplSetTab('approval')" style="border:none;border-left:1px solid #d6d9e2;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;background:${!isScope?'#0d2137':'#fff'};color:${!isScope?'#fff':'#555'}">🗂️ Approval Stage Templates</button>
    </div>
    <button class="btn btn-sm btn-gold" onclick="_tplOpenNew('${isScope?'scope':'approval'}')">+ New Template</button>
  </div>

  <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
    <input class="fi" id="tpl-search" style="flex:1;min-width:200px;margin:0" placeholder="Search templates or items..."
      value="${esc(S.search||"")}" oninput="S.search=this.value;renderTemplatesPage();_refocusSearch('tpl-search')"/>
    <div style="font-size:12px;color:var(--text-muted);white-space:nowrap">${all.length} template${all.length===1?"":"s"} · ${totalItems} total item${totalItems===1?"":"s"}</div>
  </div>

  ${!all.length ? `<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">No templates ${q?"match your search":"yet"}.</div>` : ""}
  <div style="display:flex;flex-direction:column;gap:10px">
    ${all.map(x => _tplCard(x, isScope)).join("")}
  </div>
  </div>
  <div class="footer">Winner Holistic Consultants · Templates</div>
  ${S._tplEdit ? _tplEditModal() : ""}`;

  document.getElementById("app").innerHTML = h;
}

function _tplCard(x, isScope) {
  const key = (isScope ? "s:" : "a:") + x.name;
  const open = !!S.expanded[key];
  const tpl = x.tpl;
  const sourceLine = tpl.builtin
    ? `<span style="background:#eef0ff;color:#5b3df5;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600">Default</span>`
    : `<span style="background:#e3f6ee;color:#166a3f;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600">Edited</span>
       ${tpl.createdBy ? `<span style="font-size:11px;color:var(--text-muted)">by ${esc(tpl.createdBy)}</span>` : ""}
       ${tpl.createdAt ? `<span style="font-size:11px;color:var(--text-muted)">· ${new Date(tpl.createdAt).toLocaleDateString()}</span>` : ""}`;

  const itemsBody = isScope
    ? `<div style="overflow-x:auto;margin-top:8px"><table style="width:100%;border-collapse:collapse;font-size:12px">
        <colgroup><col style="width:44px"/><col/></colgroup>
        <thead><tr style="background:var(--surface-3)">
          <th style="text-align:left;padding:5px 8px;font-size:10px;color:var(--text-muted)">No.</th>
          <th style="text-align:left;padding:5px 8px;font-size:10px;color:var(--text-muted)">Section / Description</th>
        </tr></thead><tbody>
        ${(tpl.items||[]).map(it => `<tr style="border-bottom:1px solid var(--border-soft)">
          <td style="padding:6px 8px;vertical-align:top;font-weight:700;color:#5b3df5">${esc(it.code||"—")}</td>
          <td style="padding:6px 8px;vertical-align:top">
            <div style="font-weight:600;color:var(--text)">${esc(it.name||"—")}</div>
            ${it.desc?`<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(it.desc)}</div>`:""}
          </td>
        </tr>`).join("")}
        </tbody></table></div>`
    : `<div style="margin-top:8px">
        ${(tpl.items||[]).map((it,i) => {
          const typeLabel = (STAGE_TYPE_CHOICES.find(t => t.v === it.type) || {}).label || it.type || "—";
          const isApproval = ["approval_meps","approval_portal","gis","completed"].includes(it.type);
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border-bottom:1px solid var(--border-soft);font-size:12px">
          <span><b style="color:#5b3df5">${i+1}.</b> ${esc(it.name||"—")}${it.time?` <span style="color:var(--text-muted);font-size:10px">(${esc(it.time)})</span>`:""}</span>
          <span style="font-size:10px;padding:2px 8px;border-radius:8px;background:${isApproval?'#fdf3df':'#eef4ff'};color:${isApproval?'#8a5a00':'#1a3a5c'}">${esc(typeLabel)}</span>
        </div>`;
        }).join("")}
      </div>`;

  const kind = isScope ? "scope" : "approval";
  const customStore = isScope ? CUSTOM_SCOPE_TEMPLATES_ALL : CUSTOM_APPROVAL_TEMPLATES_ALL;
  const canDelete = !(isScope && x.name === MASTER_SCOPE_TEMPLATE_NAME) && Object.prototype.hasOwnProperty.call(customStore, x.name);

  return `<div class="sbox" style="margin:0">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;cursor:pointer" onclick="_tplToggle('${key.replace(/'/g,"\\'")}')">
      <div>
        <div style="font-weight:700;font-size:14px;color:var(--text)">${esc(x.name)}</div>
        <div style="display:flex;gap:6px;align-items:center;margin-top:4px;flex-wrap:wrap">${sourceLine}
          <span style="font-size:11px;color:var(--text-muted)">${(tpl.items||[]).length} item${(tpl.items||[]).length===1?"":"s"}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <button type="button" class="btn btn-sm" style="background:#eef0ff;color:#5b3df5" onclick="event.stopPropagation();_tplOpenEdit('${kind}','${x.name.replace(/'/g,"\\'")}')">Edit</button>
        ${canDelete ? `<button type="button" class="btn btn-sm btn-red" onclick="event.stopPropagation();_tplDelete('${kind}','${x.name.replace(/'/g,"\\'")}')">Delete</button>` : ""}
        <span style="font-size:12px;color:#7a8095">${open?'▲ Hide':'▼ View items'}</span>
      </div>
    </div>
    ${open ? itemsBody : ""}
  </div>`;
}
