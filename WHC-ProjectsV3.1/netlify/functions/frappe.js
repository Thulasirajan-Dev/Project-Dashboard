// ============================================================
//  Winner Holistic Consultants – Frappe API Proxy
//  netlify/functions/frappe.js
//
//  Sits between your browser and Frappe Cloud.
//  API key never exposed to the client.
//  Deploy: this file auto-detected by Netlify as a Function.
// ============================================================

const FRAPPE_URL    = process.env.FRAPPE_URL    || "https://erp.winnerhc.com";
const FRAPPE_KEY    = process.env.FRAPPE_API_KEY;
const FRAPPE_SECRET = process.env.FRAPPE_API_SECRET;

// ── CORS headers ──────────────────────────────────────────────
// Allow requests only from your Netlify site
const CORS = {
  "Access-Control-Allow-Origin":  process.env.SITE_URL || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ── Supported actions → Frappe endpoints ─────────────────────
const ACTIONS = {

  // All active employees — for coordinator dropdown
  employees: {
    endpoint: "/api/resource/Employee",
    params: {
      fields: JSON.stringify(["name","employee_name","designation","department","user_id"]),
      filters: JSON.stringify([["status","=","Active"]]),
      limit_page_length: 200,
      order_by: "employee_name asc"
    }
  },

  // All open/active projects — link WHC project to ERP
  projects: {
    endpoint: "/api/resource/Project",
    params: {
      fields: JSON.stringify(["name","project_name","customer","status","expected_start_date","expected_end_date","percent_complete"]),
      filters: JSON.stringify([["status","in","Open,In Progress"]]),
      limit_page_length: 200,
      order_by: "modified desc"
    }
  },

  // Single project detail — fetch by ERP project name
  project_detail: {
    endpoint: "/api/resource/Project/{name}",   // {name} replaced at runtime
    params: {}
  },

  // Leave applications — coordinator availability
  // Returns approved leaves for all employees in next 60 days
  leaves: {
    endpoint: "/api/resource/Leave Application",
    params: {
      fields: JSON.stringify(["employee","employee_name","leave_type","from_date","to_date","status","total_leave_days"]),
      filters: JSON.stringify([
        ["status","=","Approved"],
        ["from_date",">=", new Date().toISOString().split("T")[0]],
        ["from_date","<=", new Date(Date.now() + 60*24*60*60*1000).toISOString().split("T")[0]]
      ]),
      limit_page_length: 200,
      order_by: "from_date asc"
    }
  },

  // Attendance — last 30 days for a specific employee
  attendance: {
    endpoint: "/api/resource/Attendance",
    params: {
      fields: JSON.stringify(["employee","employee_name","attendance_date","status","working_hours"]),
      filters: null,   // built dynamically from request body
      limit_page_length: 50,
      order_by: "attendance_date desc"
    }
  },

  // Customers — for client name auto-fill
  customers: {
    endpoint: "/api/resource/Customer",
    params: {
      fields: JSON.stringify(["name","customer_name","customer_type","territory","mobile_no","email_id"]),
      filters: JSON.stringify([["disabled","=",0]]),
      limit_page_length: 500,
      order_by: "customer_name asc"
    }
  }
};

// ── Main handler ──────────────────────────────────────────────
export async function handler(event) {

  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  // Check keys are configured
  if (!FRAPPE_KEY || !FRAPPE_SECRET) {
    return { statusCode: 500, headers: CORS,
      body: JSON.stringify({ error: "FRAPPE_API_KEY / FRAPPE_API_SECRET not set in Netlify environment variables" }) };
  }

  // Parse request
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const { action, filters: extraFilters, name: docName } = body;
  const actionCfg = ACTIONS[action];
  if (!actionCfg) {
    return { statusCode: 400, headers: CORS,
      body: JSON.stringify({ error: `Unknown action: ${action}. Valid: ${Object.keys(ACTIONS).join(", ")}` }) };
  }

  // Build URL
  let endpoint = actionCfg.endpoint.replace("{name}", encodeURIComponent(docName || ""));
  const params = { ...actionCfg.params };

  // Allow caller to pass extra filters (e.g. filter attendance by employee)
  if (extraFilters) params.filters = JSON.stringify(extraFilters);

  // Build query string
  const qs = Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const url = `${FRAPPE_URL}${endpoint}${qs ? "?" + qs : ""}`;

  // Call Frappe
  let frappeRes;
  try {
    frappeRes = await fetch(url, {
      headers: {
        "Authorization": `token ${FRAPPE_KEY}:${FRAPPE_SECRET}`,
        "Content-Type":  "application/json",
        "Accept":        "application/json",
      }
    });
  } catch (err) {
    return { statusCode: 502, headers: CORS,
      body: JSON.stringify({ error: "Could not reach Frappe Cloud", detail: err.message }) };
  }

  // Handle Frappe errors
  if (!frappeRes.ok) {
    const errText = await frappeRes.text();
    return { statusCode: frappeRes.status, headers: CORS,
      body: JSON.stringify({ error: "Frappe returned an error", detail: errText }) };
  }

  const data = await frappeRes.json();

  return {
    statusCode: 200,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(data)
  };
}
