# OneDrive Attachments — Setup Guide

This adds "one file per record" proof attachments (screenshots / PDFs, up to
4MB), uploaded to one OneDrive account via a small Netlify Function. The
Microsoft credentials live ONLY in Netlify environment variables — never in the
browser, so they stay secure.

There are two one-time setup steps: (A) register an app in Azure to get
credentials, and (B) add those credentials to Netlify. After that it just works.

---

## A. Azure App Registration (gets you 3 values + grants OneDrive access)

1. Go to https://portal.azure.com → search "App registrations" → **New registration**.
   - Name: e.g. "WHC Attachments".
   - Supported account types: "Accounts in this organizational directory only".
   - Click **Register**.

2. On the app's **Overview** page, copy:
   - **Application (client) ID**  → this is `AZURE_CLIENT_ID`
   - **Directory (tenant) ID**    → this is `AZURE_TENANT_ID`

3. Left menu → **Certificates & secrets** → **New client secret** →
   add a description, choose an expiry → **Add**.
   - Copy the secret **Value** immediately (you can't see it again later).
   - This is `AZURE_CLIENT_SECRET`.

4. Left menu → **API permissions** → **Add a permission** →
   **Microsoft Graph** → **Application permissions** →
   search and check **Files.ReadWrite.All** → **Add permissions**.

5. Still on API permissions, click **Grant admin consent for <your org>**
   and confirm. (This is required for app-only access. If the "Grant admin
   consent" button is greyed out, a Global Admin needs to click it.)

6. Decide which OneDrive account stores the files (e.g. proofs@winnerhc.com or
   any licensed user). Its email/UPN is `ONEDRIVE_USER`.

---

## B. Add the credentials to Netlify

Netlify → your site → **Site configuration** → **Environment variables** →
add these (then redeploy):

| Key                  | Value                                             |
|----------------------|---------------------------------------------------|
| `AZURE_TENANT_ID`    | Directory (tenant) ID from step A2                |
| `AZURE_CLIENT_ID`    | Application (client) ID from step A2              |
| `AZURE_CLIENT_SECRET`| Secret Value from step A3                         |
| `ONEDRIVE_USER`      | The OneDrive account email (e.g. proofs@winnerhc.com) |
| `ONEDRIVE_FOLDER`    | (optional) folder name; defaults to `WHC-Attachments` |
| `SITE_URL`           | (optional) your site origin, e.g. https://whc-projects.netlify.app — restricts who can call the function |

Then **Deploy → Deploy project without cache**.

---

## How it works

- The file uploads to: `OneDrive / WHC-Attachments / <recordType> / <id>_<filename>`
- The function creates an **organization view link** (anyone in your company with
  the link can view; not public to the world) and returns it.
- The app stores only that link on the record (in Firebase). Retrieval = open link.

## Limits & notes

- Max 4MB per file (simple upload). Allowed: PDF and common image types.
- Free Netlify Functions tier: 125k invocations + 100 hrs/month — far more than
  enough for occasional proof uploads.
- The OneDrive account needs a license with OneDrive (most M365 plans include it).
- The client secret has an expiry (you set it in step A3). Note the date and
  renew before it lapses, or uploads will start failing with an auth error.
- If you ever see "OneDrive not configured" — an env var is missing/misspelled.
- To restrict who can call the function, set `SITE_URL` to your exact site origin.

## Where attachments appear in the app

- **Quotations**: an upload box at the bottom of the new/edit form; the file
  shows on the quotation detail page.
- (Projects and LPOs use the same `attachmentWidget()` helper — wire-in is
  identical; ask to have those added when ready.)
