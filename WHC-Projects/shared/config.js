// ============================================================
//  Winner Holistic Consultants – Environment Config
//  shared/config.js  ← LOAD THIS FIRST in every index.html
//
//  HOW TO SWITCH ENVIRONMENTS:
//  Change ENV below to "live" or "test"
//
//  LIVE  → existing Firebase (real data, production)
//  TEST  → new Firebase project (safe for testing)
// ============================================================

const ENV = "test"; // ← change to "live" when deploying to production

const FIREBASE_URLS = {
  // ── Existing production database ─────────────────────────
  live: "https://whc-projects-update-default-rtdb.firebaseio.com/",

  // ── New test database ─────────────────────────────────────
  // After creating your new Firebase project, paste its URL below
  test: "https://whc-projects-test-default-rtdb.firebaseio.com/"
};

// Active Firebase URL — used by shared.js automatically
const FIREBASE_URL = FIREBASE_URLS[ENV];

// Bootstrap password for first-time super admin setup
const SUPER_ADMIN_BOOTSTRAP_PW = "whcadmin2026";

// ── Visual environment badge ──────────────────────────────────
// Shows a badge on every page so you always know which DB you're hitting
if (typeof document !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    if (ENV !== "live") {
      const badge = document.createElement("div");
      badge.textContent = "⚠ TEST DATABASE — " + FIREBASE_URLS[ENV];
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
