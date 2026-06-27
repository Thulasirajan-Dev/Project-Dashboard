// ============================================================
//  Winner Holistic Consultants – OneDrive Attachment Upload
//  netlify/functions/onedrive-upload.js
//
//  Receives a small file (<=4MB) as base64 from the browser,
//  uploads it to one specific user's OneDrive via Microsoft Graph
//  using app (client-credentials) auth, creates a shareable view
//  link, and returns it. The app saves only the link on the record.
//
//  The Microsoft credentials live ONLY in Netlify environment
//  variables — never in the browser.
//
//  Required Netlify environment variables:
//    AZURE_TENANT_ID       (Directory/tenant ID)
//    AZURE_CLIENT_ID       (Application/client ID)
//    AZURE_CLIENT_SECRET   (client secret value)
//    ONEDRIVE_USER         (the UPN/email of the OneDrive account,
//                           e.g. proofs@winnerhc.com)
//    ONEDRIVE_FOLDER       (optional; default "WHC-Attachments")
//    SITE_URL              (optional; your site origin for CORS)
// ============================================================

const TENANT   = process.env.AZURE_TENANT_ID;
const CLIENT   = process.env.AZURE_CLIENT_ID;
const SECRET   = process.env.AZURE_CLIENT_SECRET;
const OD_USER  = process.env.ONEDRIVE_USER;
const FOLDER   = process.env.ONEDRIVE_FOLDER || "WHC-Attachments";

const CORS = {
  "Access-Control-Allow-Origin":  process.env.SITE_URL || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MAX_BYTES = 4 * 1024 * 1024;          // 4MB simple-upload ceiling
const ALLOWED_EXT = ["pdf","png","jpg","jpeg","gif","webp","heic","bmp","tif","tiff"];

// Get an app-only access token for Microsoft Graph.
async function getToken() {
  const url = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: CLIENT,
    client_secret: SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) throw new Error("Token request failed: " + r.status + " " + (await r.text()).slice(0,200));
  const j = await r.json();
  return j.access_token;
}

// Sanitize a file name and ensure a safe, unique path.
function safeName(name) {
  const clean = String(name || "file").replace(/[^\w.\-]+/g, "_").slice(-80);
  return Date.now() + "_" + clean;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  if (!TENANT || !CLIENT || !SECRET || !OD_USER) {
    return { statusCode: 500, headers: CORS,
      body: JSON.stringify({ error: "OneDrive not configured. Set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, ONEDRIVE_USER in Netlify." }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid JSON body" }) }; }

  const { fileName, fileBase64, recordType, recordId } = payload;
  if (!fileName || !fileBase64)
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "fileName and fileBase64 are required" }) };

  // Validate extension
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  if (!ALLOWED_EXT.includes(ext))
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Only images and PDF files are allowed." }) };

  // Decode + size-check
  let buf;
  try { buf = Buffer.from(fileBase64, "base64"); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Bad file encoding" }) }; }
  if (buf.length > MAX_BYTES)
    return { statusCode: 413, headers: CORS, body: JSON.stringify({ error: "File too large (max 4MB)." }) };

  try {
    const token = await getToken();

    // Organise files: /WHC-Attachments/<recordType>/<safeName>
    const sub = (recordType ? String(recordType).replace(/[^\w\-]+/g, "_") : "misc");
    const fname = safeName((recordId ? recordId + "_" : "") + fileName);
    const itemPath = `${FOLDER}/${sub}/${fname}`;

    // Upload (simple PUT, <=4MB) to the specified user's drive.
    const uploadUrl =
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(OD_USER)}/drive/root:/${encodeURI(itemPath)}:/content`;
    const up = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/octet-stream" },
      body: buf,
    });
    if (!up.ok) {
      const txt = (await up.text()).slice(0, 300);
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: "Upload failed", detail: txt }) };
    }
    const item = await up.json();

    // Create an organization-view share link (anyone in the tenant with the link can view).
    let link = item.webUrl;   // fallback: the item's web URL
    try {
      const linkRes = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(OD_USER)}/drive/items/${item.id}/createLink`,
        { method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ type: "view", scope: "organization" }) }
      );
      if (linkRes.ok) { const lj = await linkRes.json(); if (lj.link && lj.link.webUrl) link = lj.link.webUrl; }
    } catch (e) { /* keep fallback webUrl */ }

    return {
      statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        url: link,
        name: fileName,
        size: buf.length,
        itemId: item.id,
        uploadedAt: new Date().toISOString(),
      }),
    };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Server error", detail: String(e).slice(0,300) }) };
  }
}
