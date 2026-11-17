// This file runs on Vercel's SERVER. It serves the PILOT copy of a page (/pilot -> index.html, /pilot-teacher -> teacher.html)
// with the pilot Supabase configuration filled in from Vercel Environment Variables.
//
// Nothing about the pilot is committed to the repository: no URL, no key, no host. The committed pages keep their
// placeholders and "off" switches, and "/" is always the normal, sync-off app.
//
// FAIL CLOSED. The page is served UNCHANGED (sync off) unless ALL of these hold:
//   - VERCEL_ENV is not "production"                       (never on Production, even if variables are set there by mistake)
//   - the request host is listed in ETHIXO_PILOT_HOSTS      (comma-separated plain hostnames)
//   - ETHIXO_PILOT_SUPABASE_URL is https://<ref>.supabase.co
//   - ETHIXO_PILOT_SUPABASE_PUBLISHABLE_KEY starts with sb_publishable_   (secret / service-role keys are refused)
//   - every placeholder line to be replaced is found exactly once in the page
// Student switches (index.html only): ETHIXO_PILOT_SYNC_MODE = shadow | on (anything else = off),
// ETHIXO_PILOT_ATTEMPTS_SYNC = true, ETHIXO_PILOT_BACKFILL = true.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const PAGES = { app: "index.html", teacher: "teacher.html" };

function pilotConfig(req, env) {
  if (env.VERCEL_ENV === "production") return null;
  const hosts = String(env.ETHIXO_PILOT_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter((h) => /^[a-z0-9.-]+$/.test(h));
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().split(":")[0].toLowerCase();
  if (!host || hosts.indexOf(host) === -1) return null;
  const url = String(env.ETHIXO_PILOT_SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = String(env.ETHIXO_PILOT_SUPABASE_PUBLISHABLE_KEY || "").trim();
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url)) return null;
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return null;
  const mode = env.ETHIXO_PILOT_SYNC_MODE === "shadow" || env.ETHIXO_PILOT_SYNC_MODE === "on" ? env.ETHIXO_PILOT_SYNC_MODE : "off";
  return { host, url, key, mode, attempts: env.ETHIXO_PILOT_ATTEMPTS_SYNC === "true", backfill: env.ETHIXO_PILOT_BACKFILL === "true" };
}

// JSON literal that is also safe inside an inline <script>.
function lit(v) { return JSON.stringify(v).replace(/[<\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")); }

function applyConfig(html, page, cfg) {
  const reps = [
    ['const SUPABASE_URL = "__SET_ME__";', "const SUPABASE_URL = " + lit(cfg.url) + ";"],
    ['const SUPABASE_PUBLISHABLE_KEY = "__SET_ME__";', "const SUPABASE_PUBLISHABLE_KEY = " + lit(cfg.key) + ";"],
    ["const DB_SYNC_ALLOWED_HOSTS = [];", "const DB_SYNC_ALLOWED_HOSTS = " + lit([cfg.host]) + ";"],
  ];
  if (page === "app") {
    reps.push(["const DB_ATTEMPTS_SYNC = false;", "const DB_ATTEMPTS_SYNC = " + (cfg.attempts ? "true" : "false") + ";"]);
    reps.push(["const DB_BACKFILL = false;", "const DB_BACKFILL = " + (cfg.backfill ? "true" : "false") + ";"]);
    reps.push(['const DB_SYNC_MODE = "off";', "const DB_SYNC_MODE = " + lit(cfg.mode) + ";"]);
  }
  let out = html;
  for (const [from, to] of reps) {
    if (out.split(from).length !== 2) return null; // not exactly once: refuse, serve the page unchanged
    out = out.replace(from, () => to);
  }
  return out;
}

export default function handler(req, res) {
  const page = Object.prototype.hasOwnProperty.call(PAGES, req.query && req.query.page) ? req.query.page : "app";
  let html;
  try {
    html = readFileSync(join(process.cwd(), PAGES[page]), "utf8");
  } catch (e) {
    res.status(404).send("Not found");
    return;
  }
  let cfg = null;
  try { cfg = pilotConfig(req, process.env); } catch (e) { cfg = null; }
  const configured = cfg ? applyConfig(html, page, cfg) : null;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  res.status(200).send(configured || html);
}

export { pilotConfig, applyConfig };
