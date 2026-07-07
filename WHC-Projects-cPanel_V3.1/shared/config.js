// ============================================================
//  Winner Holistic Consultants – Environment Config
//  shared/config.js  ← LOAD THIS FIRST in every index.html
//
//  Data now lives in cPanel MySQL, reached via /api/data.php.
//  (Firebase has been removed.) There is nothing to point at
//  here anymore — the API URL is relative and lives in shared.js.
//
//  ENV only controls the on-screen environment badge below, so
//  you can tell a staging copy apart from production at a glance.
// ============================================================

const ENV = "live"; // "live" or "test" — affects the badge only

// ── Visual environment badge ──────────────────────────────────
// Shows a small badge on every page when NOT in "live", so you
// always know you're on a test/staging copy.
if (typeof document !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    if (ENV !== "live") {
      const badge = document.createElement("div");
      badge.textContent = "⚠ " + ENV.toUpperCase() + " ENVIRONMENT";
      badge.style.cssText = [
        "position:fixed", "bottom:12px", "left:50%",
        "transform:translateX(-50%)", "background:#a06b00",
        "color:#fff", "font-size:10px", "font-weight:700",
        "padding:4px 14px", "border-radius:20px", "z-index:9999",
        "letter-spacing:0.5px", "pointer-events:none",
        "white-space:nowrap", "box-shadow:0 2px 8px rgba(0,0,0,0.3)"
      ].join(";");
      document.body.appendChild(badge);
    }
  });
}
