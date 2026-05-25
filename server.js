require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const OTPAuth = require("otpauth");
const QRCode = require("qrcode");
const cookieParser = require("cookie-parser");

const PORT = process.env.PORT || 3002;
const API_SECRET = process.env.API_SECRET || "";
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || "";
const BASE = "https://www.magnific.com";
const RENDER_BASE = "https://ak-data.magnific.com";
const AUTO_DELETE = true; // always delete creations after generation — never store in account history
const RENDER_API_KEY    = process.env.RENDER_API_KEY    || '';
const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID || '';

// ── TOTP admin auth ────────────────────────────────────────────────────────────
let TOTP_INSTANCE = null;
let TOTP_SECRET_B32 = process.env.TOTP_SECRET || "";

function setupTOTP() {
  if (TOTP_SECRET_B32) {
    try {
      TOTP_INSTANCE = new OTPAuth.TOTP({
        issuer: "MagnificAPI",
        label: "MagnificAPI Admin",
        secret: OTPAuth.Secret.fromBase32(TOTP_SECRET_B32),
        digits: 6,
        period: 30,
      });
      console.log("[TOTP] Admin 2FA ready. Secret loaded from TOTP_SECRET env var.");
    } catch (e) {
      console.error("[TOTP] Invalid TOTP_SECRET:", e.message);
    }
  } else {
    const secret = new OTPAuth.Secret({ size: 20 });
    TOTP_SECRET_B32 = secret.base32;
    TOTP_INSTANCE = new OTPAuth.TOTP({
      issuer: "MagnificAPI",
      label: "MagnificAPI Admin",
      secret,
      digits: 6,
      period: 30,
    });
    console.log("\n┌─────────────────────────────────────────────────────────────┐");
    console.log("│  ⚠️  TOTP_SECRET not set — auto-generated for this session   │");
    console.log("│  Add to .env or Render to make it persistent:               │");
    console.log(`│  TOTP_SECRET=${TOTP_SECRET_B32.padEnd(47)}│`);
    console.log("│  Scan the QR code printed below or use the URI manually     │");
    console.log("└─────────────────────────────────────────────────────────────┘");
    console.log("Authenticator URI:", TOTP_INSTANCE.toString());
    QRCode.toString(TOTP_INSTANCE.toString(), { type: "terminal", small: true }, (err, qr) => {
      if (!err) console.log(qr);
    });
  }
}
setupTOTP();

// ── Admin sessions ─────────────────────────────────────────────────────────────
const adminSessions = new Map(); // token → expiry ms
const ADMIN_SESSION_TTL = 24 * 3600 * 1000; // 24 hours

function createAdminSession() {
  const token = crypto.randomBytes(32).toString("hex");
  adminSessions.set(token, Date.now() + ADMIN_SESSION_TTL);
  return token;
}

function isValidAdminSession(token) {
  if (!token) return false;
  const expiry = adminSessions.get(token);
  if (!expiry || Date.now() > expiry) { adminSessions.delete(token); return false; }
  return true;
}

function verifyTOTP(code) {
  if (!TOTP_INSTANCE) return false;
  const delta = TOTP_INSTANCE.validate({ token: String(code).replace(/\s/g, ""), window: 1 });
  return delta !== null;
}

function adminAuthMiddleware(req, res, next) {
  if (isValidAdminSession(req.cookies?.admin_session)) return next();
  res.redirect("/admin/login?next=" + encodeURIComponent(req.path));
}

// ── Image models ──────────────────────────────────────────────────────────────
// unlimited: true  = included in Premium+ (no credits consumed)
// unlimited: false = costs credits even on Premium+
// id = value sent as `mode` in start-tti-v2 and render/v4
// Names match the Magnific UI (verified 2026-05-21, 43 visible models)
const IMAGE_MODELS = [
  // ── Unlimited (Premium+ — no credits consumed) ────────────────────────────
  { id: "auto",                  name: "Auto",                          unlimited: true,  note: "Magnific picks best model automatically" },
  // Flux.1 family
  { id: "flux",                  name: "Flux.1 Fast",                   unlimited: true  },
  { id: "flux-dev",              name: "Flux.1",                        unlimited: true  },
  { id: "flux-realism",          name: "Flux.1 Realism",                unlimited: true  },
  { id: "flux-pro-plus",         name: "Flux.1.1",                      unlimited: true  },
  { id: "flux-kontext",          name: "Flux.1 Kontext Pro",            unlimited: true  },
  { id: "flux-kontext-high",     name: "Flux.1 Kontext Max",            unlimited: true  },
  { id: "flux-sref",             name: "Flux.1 Sref",                   unlimited: true,  note: "Style reference — works best with references[]" },
  // Flux.2 family
  { id: "flux-2",                name: "Flux.2 Pro",                    unlimited: true  },
  { id: "flux-2-klein",          name: "Flux.2 Klein",                  unlimited: true  },
  // Classic
  { id: "fast",                  name: "Classic Fast",                  unlimited: true  },
  { id: "classic",               name: "Classic",                       unlimited: true  },
  // Mystic family
  { id: "mystic",                name: "Mystic 1.0",                    unlimited: true  },
  { id: "mystic-2-5",            name: "Mystic 2.5",                    unlimited: true  },
  { id: "mystic-2-5-flexible",   name: "Mystic 2.5 Flexible",           unlimited: true  },
  { id: "mystic-2-5-fluid",      name: "Mystic 2.5 Fluid",              unlimited: true  },
  { id: "mystic-lora",           name: "Mystic Lora",                   unlimited: true,  note: "LoRA style — works best with references[]" },
  { id: "mystic-sref",           name: "Mystic Sref",                   unlimited: true,  note: "Style reference — works best with references[]" },
  // Seedream family
  { id: "seedream-5-lite",       name: "Seedream 5 Lite",               unlimited: true  },
  { id: "seedream-4-5",          name: "Seedream 4.5",                  unlimited: true  },
  { id: "seedream-4-5-4k",       name: "Seedream 4.5 4K",               unlimited: true  },
  { id: "seedream-4",            name: "Seedream 4",                    unlimited: true  },
  { id: "seedream-4-4k",         name: "Seedream 4 4K",                 unlimited: true  },
  { id: "seedream",              name: "Seedream",                      unlimited: true  },
  // Google
  { id: "imagen-nano-banana",    name: "Google Nano Banana",            unlimited: true  },
  { id: "imagen-nano-banana-2",  name: "Google Nano Banana Pro",        unlimited: true,  note: "∞ on Premium+ (1K/period via flash-1k bucket); 75 credits otherwise" },
  { id: "imagen3",               name: "Google Imagen 3 (Deprecated)",  unlimited: true  },
  { id: "imagen4",               name: "Google Imagen 4 (Deprecated)",  unlimited: true  },
  { id: "imagen4-fast",          name: "Google Imagen 4 Fast (Deprecated)", unlimited: true },
  { id: "imagen4-ultra",         name: "Google Imagen 4 Ultra (Deprecated)", unlimited: true },
  // Other unlimited
  { id: "ideogram",              name: "Ideogram",                      unlimited: true  },
  { id: "ideogram-character",    name: "Ideogram Character",            unlimited: true  },
  { id: "grok",                  name: "Grok",                          unlimited: true  },
  { id: "grok-edit",             name: "Grok Edit",                     unlimited: true,  note: "Image editing — works best with references[]" },
  { id: "qwen",                  name: "Qwen",                          unlimited: true  },
  { id: "qwen-edit",             name: "Qwen Edit",                     unlimited: true,  note: "Image editing — works best with references[]" },
  { id: "reve",                  name: "Reve",                          unlimited: true  },
  { id: "recraft-v4",            name: "Recraft V4",                    unlimited: true  },
  { id: "recraft-v4-1",          name: "Recraft V4.1",                  unlimited: true,  note: "100 generations/period cap" },
  { id: "z-image",               name: "Z-Image",                       unlimited: true  },
  { id: "runway-gen4",           name: "Runway (Deprecated)",           unlimited: true  },
  // ── Credit-based (costs credits even on Premium+) ────────────────────────
  // Google Nano Banana 2 variants (4K, flash sizes)
  { id: "imagen-nano-banana-2-4k",       name: "Google Nano Banana Pro 4K",    unlimited: false, credits: 150 },
  { id: "imagen-nano-banana-2-flash-2k", name: "Google Nano Banana Pro 2K",    unlimited: false, credits: 75  },
  { id: "imagen-nano-banana-2-flash-4k", name: "Google Nano Banana Pro Flash 4K", unlimited: false, credits: 150 },
  // Flux.2 credit models
  { id: "flux-2-flex",           name: "Flux.2 Flex",                   unlimited: false, credits: 40  },
  { id: "flux-2-max",            name: "Flux.2 Max",                    unlimited: false, credits: 65  },
  // Recraft
  { id: "recraft-v4-pro",        name: "Recraft V4 Pro",                unlimited: false, credits: 175 },
  // GPT models
  { id: "gpt-medium",            name: "GPT",                           unlimited: false, credits: 150 },
  { id: "gpt-high",              name: "GPT 1 - HQ",                    unlimited: false, credits: 500 },
  { id: "gpt-1-5-medium",        name: "GPT 1.5",                       unlimited: false, credits: 150 },
  { id: "gpt-1-5-high",          name: "GPT 1.5 - High",                unlimited: false, credits: 500 },
  { id: "gpt-2",                 name: "GPT 2",                         unlimited: false, credits: 200 },
  // New models (mode IDs pending DevTools capture)
  // { id: "???",                name: "Cinematic",                     unlimited: false, credits: 75  },
  // { id: "???",                name: "Luma Uni-1.1",                  unlimited: false, credits: 140 },
];

// ── Video models ─────────────────────────────────────────────────────────────
// id         = slug sent in clips[].slug + key for POST /v1/videos/generate
// api/videoModel/videoMode = exact fields from GET /app/api/video/ai-models (confirmed 2026-05-21)
// unlimited  = no credit cost on Premium+ plan
// sf/ef/refs = capabilities: startFrame / endFrame / references[] supported
const VIDEO_MODELS = [
  // ── ByteDance ────────────────────────────────────────────────────────────────
  { id: 'bytedance-seedance-fast-2.0',   name: 'Seedance 2.0 Fast',          credits: 44,   api: 'bytedance',    videoModel: 'seedance',          videoMode: 'fast-2.0',          sf: true,  ef: true,  refs: true  },
  { id: 'bytedance-seedance-pro-2.0',    name: 'Seedance 2.0',               credits: 57,   api: 'bytedance',    videoModel: 'seedance',          videoMode: 'pro-2.0',           sf: true,  ef: true,  refs: true  },
  { id: 'bytedance-seedance-pro-1.5',    name: 'Seedance 1.5 Pro',           credits: 180,  api: 'bytedance',    videoModel: 'seedance',          videoMode: 'pro-1.5',           sf: true,  ef: true,  refs: false },
  { id: 'bytedance-omnihuman-lipsync',   name: 'Omni Human 1.5',             credits: 540,  api: 'bytedance',    videoModel: 'omnihuman',         videoMode: 'omni_human',        sf: true,  ef: false, refs: false },
  // ── Kling ────────────────────────────────────────────────────────────────────
  { id: 'kling-30',                      name: 'Kling 3.0',                  credits: 210,  api: 'kling',        videoModel: 'kling',             videoMode: '30',                sf: true,  ef: true,  refs: false },
  { id: 'kling-omni3',                   name: 'Kling 3.0 Omni',             credits: 210,  api: 'kling',        videoModel: 'kling',             videoMode: 'omni3',             sf: true,  ef: true,  refs: true  },
  { id: 'kling-motion-control-30',       name: 'Kling 3.0 Motion Control',   credits: 330,  api: 'kling',        videoModel: 'kling',             videoMode: 'motion-control-30', sf: true,  ef: false, refs: false },
  { id: 'kling-26',                      name: 'Kling 2.6',                  credits: 225,  api: 'kling',        videoModel: 'kling',             videoMode: '26',                sf: true,  ef: true,  refs: false },
  { id: 'kling-motion-control',          name: 'Kling 2.6 Motion Control',   credits: 150,  api: 'kling',        videoModel: 'kling',             videoMode: 'motion-control',    sf: true,  ef: false, refs: false },
  { id: 'kling-omni1',                   name: 'Kling O1',                   credits: 225,  api: 'kling',        videoModel: 'kling',             videoMode: 'omni1',             sf: true,  ef: true,  refs: true  },
  { id: 'kling-25',                      name: 'Kling 2.5',                  credits: 0,    api: 'kling',        videoModel: 'kling',             videoMode: '25',                sf: true,  ef: true,  refs: false, unlimited: true },
  { id: 'kling-21',                      name: 'Kling 2.1',                  credits: 275,  api: 'kling',        videoModel: 'kling',             videoMode: '21',                sf: true,  ef: true,  refs: false },
  { id: 'kling-21-master',               name: 'Kling 2.1 Master',           credits: 1400, api: 'kling',        videoModel: 'kling',             videoMode: '21-master',         sf: true,  ef: false, refs: false },
  // ── Google ───────────────────────────────────────────────────────────────────
  { id: 'google-veo3_1',                 name: 'Google Veo 3.1',             credits: 800,  api: 'google',       videoModel: 'veo3_1',            videoMode: 'veo3_1',            sf: true,  ef: true,  refs: true  },
  { id: 'google-veo3_1-fast',            name: 'Google Veo 3.1 Fast',        credits: 400,  api: 'google',       videoModel: 'veo3_1',            videoMode: 'veo3_1_fast',       sf: true,  ef: true,  refs: false },
  { id: 'google-veo3_1-lite',            name: 'Google Veo 3.1 Lite',        credits: 160,  api: 'google',       videoModel: 'veo3_1',            videoMode: 'veo3_1_lite',       sf: true,  ef: true,  refs: false },
  { id: 'google-veo3',                   name: 'Google Veo 3',               credits: 800,  api: 'google',       videoModel: 'veo3',              videoMode: 'veo3',              sf: true,  ef: false, refs: false },
  { id: 'google-veo3-fast',              name: 'Google Veo 3 Fast',          credits: 400,  api: 'google',       videoModel: 'veo3',              videoMode: 'veo3_fast',         sf: true,  ef: false, refs: false },
  { id: 'google-veo2',                   name: 'Google Veo 2',               credits: 1000, api: 'google',       videoModel: 'veo2',              videoMode: 'veo2',              sf: true,  ef: true,  refs: false },
  // ── MiniMax ──────────────────────────────────────────────────────────────────
  { id: 'minimax-video-2_3',             name: 'MiniMax Hailuo 2.3',         credits: 0,    api: 'minimax',      videoModel: 'minimax',           videoMode: 'MiniMax-Hailuo-2.3',      sf: true,  ef: false, refs: false, unlimited: true },
  { id: 'minimax-video-2_3-fast',        name: 'MiniMax Hailuo 2.3 Fast',    credits: 0,    api: 'minimax',      videoModel: 'minimax',           videoMode: 'MiniMax-Hailuo-2.3-Fast', sf: true,  ef: false, refs: false, unlimited: true },
  { id: 'minimax-video-02',              name: 'MiniMax Hailuo 02',          credits: 60,   api: 'minimax',      videoModel: 'minimax',           videoMode: 'MiniMax-Hailuo-02',       sf: true,  ef: true,  refs: false },
  { id: 'minimax-video-01-live2d',       name: 'MiniMax Live Illustrations', credits: 600,  api: 'minimax',      videoModel: 'minimax',           videoMode: 'video-01-live2d',         sf: true,  ef: false, refs: false },
  // ── PixVerse ─────────────────────────────────────────────────────────────────
  { id: 'pixverse-6',                    name: 'PixVerse 6',                 credits: 100,  api: 'fal-pixverse', videoModel: 'pixverse',          videoMode: 'v6',                sf: true,  ef: true,  refs: false },
  { id: 'pixverse-5-5',                  name: 'PixVerse 5.5',               credits: 500,  api: 'fal-pixverse', videoModel: 'pixverse',          videoMode: 'v5-5',              sf: true,  ef: true,  refs: false },
  // ── Runway ───────────────────────────────────────────────────────────────────
  { id: 'runway-gen45',                  name: 'Runway Gen-4.5',             credits: 1100, api: 'runway',       videoModel: 'runway-gen3-turbo', videoMode: 'gen45',             sf: true,  ef: false, refs: false },
  { id: 'runway-std',                    name: 'Runway Gen 4',               credits: 500,  api: 'runway',       videoModel: 'runway-gen3-turbo', videoMode: 'std',               sf: true,  ef: false, refs: false },
  { id: 'runway-act-two',                name: 'Runway Act Two',             credits: 300,  api: 'runway',       videoModel: 'act_two',           videoMode: 'act_two',           sf: false, ef: false, refs: true  },
  // ── Wan ──────────────────────────────────────────────────────────────────────
  { id: 'wan-2-7',                       name: 'Wan 2.7',                    credits: 260,  api: 'wan',          videoModel: 'wan',               videoMode: '2-7',               sf: true,  ef: true,  refs: true  },
  { id: 'wan-2-6',                       name: 'Wan 2.6',                    credits: 1000, api: 'wan',          videoModel: 'wan',               videoMode: '2-6',               sf: true,  ef: false, refs: false },
  { id: 'wan-2-5',                       name: 'Wan 2.5',                    credits: 500,  api: 'wan',          videoModel: 'wan',               videoMode: '2-5',               sf: true,  ef: false, refs: false },
  { id: 'wan-2-2',                       name: 'Wan 2.2',                    credits: 0,    api: 'wan',          videoModel: 'wan',               videoMode: '2-2',               sf: true,  ef: false, refs: false, unlimited: true },
  { id: 'wan-2-2-animate',               name: 'Wan 2.2 Animate Move',       credits: 600,  api: 'wan',          videoModel: 'wan',               videoMode: '2-2-animate',       sf: false, ef: false, refs: true  },
  { id: 'happy-horse-1',                 name: 'Happy Horse',                credits: 720,  api: 'wan',          videoModel: 'wan',               videoMode: 'happy-horse-1',     sf: true,  ef: false, refs: true  },
  { id: 'happy-horse-1-edit',            name: 'Happy Horse Edit',           credits: 720,  api: 'wan',          videoModel: 'wan',               videoMode: 'happy-horse-1-edit',sf: false, ef: false, refs: true  },
  // ── LTX ──────────────────────────────────────────────────────────────────────
  { id: 'ltx-ltx2-fast',                 name: 'LTX 2 Fast',                 credits: 480,  api: 'ltx',          videoModel: 'ltx2',              videoMode: 'fast',              sf: true,  ef: false, refs: false },
  { id: 'ltx-ltx2-pro',                  name: 'LTX 2 Pro',                  credits: 720,  api: 'ltx',          videoModel: 'ltx2',              videoMode: 'pro',               sf: true,  ef: false, refs: false },
  // ── OpenAI Sora ──────────────────────────────────────────────────────────────
  { id: 'openai-sora2-pro',              name: 'OpenAI Sora 2 Pro',          credits: 1800, api: 'openai',       videoModel: 'sora-2',            videoMode: 'pro',               sf: true,  ef: false, refs: false },
  { id: 'openai-sora2-standard',         name: 'OpenAI Sora 2',              credits: 600,  api: 'openai',       videoModel: 'sora-2',            videoMode: 'standard',          sf: true,  ef: false, refs: false },
  // ── Grok (xAI) ───────────────────────────────────────────────────────────────
  { id: 'grok-default',                  name: 'Grok',                       credits: 80,   api: 'grok',         videoModel: 'grok',              videoMode: 'default',           sf: true,  ef: false, refs: false },
  // ── Veed Fabric ──────────────────────────────────────────────────────────────
  { id: 'veed-fabric-1.0',               name: 'Veed Fabric 1.0',            credits: 420,  api: 'veed',         videoModel: 'fabric',            videoMode: 'fabric_1_0',        sf: true,  ef: false, refs: false },
  { id: 'veed-fabric-1.0-fast',          name: 'Veed Fabric 1.0 Fast',       credits: 540,  api: 'veed',         videoModel: 'fabric',            videoMode: 'fabric_1_0_fast',   sf: true,  ef: false, refs: false },
];

// ── Audio models ──────────────────────────────────────────────────────────────
// provider = 'elevenlabs' | 'google'
// credits = 5 per generation (observed from API response)
const AUDIO_MODELS = [
  { id: 'eleven_v3',             name: 'ElevenLabs v3',         provider: 'elevenlabs', credits: 5 },
  { id: 'eleven_turbo_v2_5',     name: 'ElevenLabs v2.5 Turbo', provider: 'elevenlabs', credits: 5 },
  { id: 'elevenlabs_pepsi_v2',   name: 'ElevenLabs Pepsi v2',   provider: 'elevenlabs', credits: 5 },
  { id: 'elevenlabs_pepsi_v3',   name: 'ElevenLabs Pepsi v3',   provider: 'elevenlabs', credits: 5 },
  { id: 'gemini_v2_5_pro',       name: 'Gemini 2.5 Pro TTS',    provider: 'google',     credits: 5 },
  { id: 'gemini_v3_1_flash_tts', name: 'Gemini 3.1 Flash TTS',  provider: 'google',     credits: 5 },
];

// Voice style → ElevenLabs stability value (Google ignores this)
const VOICE_STYLE_STABILITY = { expressive: 0.2, neutral: 0.5, consistent: 0.8 };

// ── Logging ───────────────────────────────────────────────────────────────────
const logs = [];
function addLog(level, msg, meta = {}) {
  const entry = { ts: new Date().toISOString(), level, msg, ...meta };
  logs.unshift(entry);
  if (logs.length > 200) logs.pop();
  console.log(`[${entry.ts}] [${level}] ${msg}`);
}

// ── Cookie helpers ────────────────────────────────────────────────────────────
function extractCookieValue(cookieString, name) {
  const match = cookieString.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? match[1].trim() : "";
}

function extractXsrf(cookieString) {
  const raw = extractCookieValue(cookieString, "XSRF-TOKEN");
  if (!raw) return "";
  try { return decodeURIComponent(raw); } catch { return raw; }
}

function getTokenExpiry(token) {
  if (!token) return 0;
  try {
    const part = token.split(".")[1];
    const payload = JSON.parse(Buffer.from(part, "base64url").toString());
    return payload.exp * 1000;
  } catch {
    return 0;
  }
}

// ── Account loading ───────────────────────────────────────────────────────────
function parseAccountTxt(content, filename) {
  const lines = content.split("\n").map(l => l.trim());
  let cookieString = "";
  let userId = "";
  let folderRef = "";
  let email = "";
  let videoEnabled = false;

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith("#")) {
      const emailMatch = line.match(/—\s*([^\s]+@[^\s]+)/);
      if (emailMatch) email = emailMatch[1];
      const uidMatch = line.match(/user_id:\s*(\d+)/);
      if (uidMatch) userId = uidMatch[1];
      const folderMatch = line.match(/folder_reference:\s*([a-f0-9-]{36})/);
      if (folderMatch) folderRef = folderMatch[1];
      if (line.includes("video: true") || line.includes("video:true")) videoEnabled = true;
    } else if (!cookieString) {
      cookieString = line;
    }
  }

  if (!cookieString) return null;

  if (!userId) userId = extractCookieValue(cookieString, "UID");

  const grToken = extractCookieValue(cookieString, "GR_TOKEN");
  return {
    name: email || filename.replace(/\.(txt|json)$/, ""),
    userId,
    folderRef,
    cookieString,
    xsrf: extractXsrf(cookieString),
    grRefresh: extractCookieValue(cookieString, "GR_REFRESH"),
    grToken,
    grTokenExpiry: getTokenExpiry(grToken),
    status: "active",
    video: videoEnabled,
  };
}

function parseAccountJson(content, filename) {
  const cookies = JSON.parse(content);
  const cookieString = cookies.map(c => `${c.name}=${c.value}`).join("; ");
  const xsrfRaw = cookies.find(c => c.name === "XSRF-TOKEN")?.value || "";
  const userId = cookies.find(c => c.name === "UID")?.value || "";
  const grRefresh = cookies.find(c => c.name === "GR_REFRESH")?.value || "";
  const grToken = cookies.find(c => c.name === "GR_TOKEN")?.value || "";
  return {
    name: filename.replace(/\.(txt|json)$/, ""),
    userId,
    folderRef: "",
    cookieString,
    xsrf: xsrfRaw ? decodeURIComponent(xsrfRaw) : "",
    grRefresh,
    grToken,
    grTokenExpiry: getTokenExpiry(grToken),
    status: "active",
  };
}

// Whether ACCOUNTS_JSON env var is the active storage backend
const USING_ENV_ACCOUNTS = !!process.env.ACCOUNTS_JSON;

function parseAccountFromObj(obj) {
  const cookieString = obj.cookieString || obj.cookie_string || "";
  if (!cookieString) return null;
  const grToken = extractCookieValue(cookieString, "GR_TOKEN") || obj.grToken || "";
  return {
    name: obj.name || obj.email || "unknown",
    userId: obj.userId || obj.user_id || extractCookieValue(cookieString, "UID"),
    folderRef: obj.folderRef || obj.folder_ref || "",
    cookieString,
    xsrf: extractXsrf(cookieString),
    grRefresh: extractCookieValue(cookieString, "GR_REFRESH") || obj.grRefresh || "",
    grToken,
    grTokenExpiry: getTokenExpiry(grToken),
    status: obj.status || "active",
    video: obj.video || false,
    email: obj.email || obj.name || "",
  };
}

function loadAccounts() {
  // Priority 1: ACCOUNTS_JSON env var (Render / production)
  if (process.env.ACCOUNTS_JSON) {
    try {
      const arr = JSON.parse(process.env.ACCOUNTS_JSON);
      if (!Array.isArray(arr)) throw new Error("ACCOUNTS_JSON must be an array");
      const accounts = arr.map(parseAccountFromObj).filter(Boolean);
      addLog("INFO", `Loaded ${accounts.length} account(s) from ACCOUNTS_JSON env var`);
      return accounts;
    } catch (e) {
      addLog("WARN", `Failed to parse ACCOUNTS_JSON: ${e.message} — falling back to files`);
    }
  }

  // Priority 2: accounts/ folder (local dev)
  const dir = path.join(__dirname, "accounts");
  if (!fs.existsSync(dir)) return [];

  const accounts = [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".txt") || f.endsWith(".json"));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), "utf8");
      const acc = file.endsWith(".json")
        ? parseAccountJson(content, file)
        : parseAccountTxt(content, file);
      if (acc) accounts.push(acc);
    } catch (e) {
      addLog("WARN", `Failed to load account ${file}: ${e.message}`);
    }
  }

  return accounts;
}

// Serialize current in-memory accounts to ACCOUNTS_JSON format for export
function exportAccountsJSON() {
  return JSON.stringify(
    manager.accounts.map(a => ({
      name: a.name,
      email: a.email || a.name,
      userId: a.userId,
      folderRef: a.folderRef || "",
      cookieString: a.cookieString,
      grToken: a.grToken,
      grRefresh: a.grRefresh,
      video: a.video || false,
      status: a.status,
    })),
    null, 2
  );
}

// ── Render env-var sync ───────────────────────────────────────────────────────
// Persists in-memory accounts back to the ACCOUNTS_JSON env var on Render so
// changes survive a redeploy without any manual copy-paste.
async function syncToRender() {
  if (!RENDER_API_KEY || !RENDER_SERVICE_ID) return { ok: false, reason: 'RENDER_API_KEY / RENDER_SERVICE_ID not configured' };
  try {
    const listR = await fetch(`https://api.render.com/v1/services/${RENDER_SERVICE_ID}/env-vars`, {
      headers: { Authorization: `Bearer ${RENDER_API_KEY}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!listR.ok) return { ok: false, reason: `Render list env-vars: HTTP ${listR.status}` };
    const current = await listR.json();
    const newJson = exportAccountsJSON();
    const updated = current.map(ev => ({
      key: ev.envVar.key,
      value: ev.envVar.key === 'ACCOUNTS_JSON' ? newJson : (ev.envVar.value || ''),
    }));
    if (!updated.some(v => v.key === 'ACCOUNTS_JSON')) updated.push({ key: 'ACCOUNTS_JSON', value: newJson });
    const putR = await fetch(`https://api.render.com/v1/services/${RENDER_SERVICE_ID}/env-vars`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${RENDER_API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(updated),
      signal: AbortSignal.timeout(10000),
    });
    if (!putR.ok) {
      const t = await putR.text();
      return { ok: false, reason: `Render PUT: HTTP ${putR.status} — ${t.slice(0,120)}` };
    }
    addLog('INFO', `Accounts synced to Render (${manager.accounts.length} account(s))`);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// ── Per-account concurrency semaphore ────────────────────────────────────────
// Each account gets SLOTS_PER_ACCOUNT concurrent generation slots.
// Callers wait in a FIFO queue when all slots are taken.
// Adding accounts increases total capacity automatically.
const SLOTS_PER_ACCOUNT = 20;
const QUEUE_TIMEOUT_MS  = 120000; // 2 min max wait before 429

class AccountSemaphore {
  constructor(slots) {
    this.slots  = slots;
    this.active = 0;
    this._q     = []; // [{resolve, reject, timer}]
  }

  // Try to take a slot without blocking. Returns true on success.
  tryAcquire() {
    if (this.active < this.slots) { this.active++; return true; }
    return false;
  }

  // Wait for a slot; rejects after timeoutMs if one never opens.
  acquire(timeoutMs = QUEUE_TIMEOUT_MS) {
    if (this.active < this.slots) { this.active++; return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      let timer = null;
      const entry = { resolve, reject, timer: null };
      if (timeoutMs) {
        entry.timer = setTimeout(() => {
          const i = this._q.indexOf(entry);
          if (i >= 0) this._q.splice(i, 1);
          reject(Object.assign(
            new Error('Server busy — all account slots full, please retry'),
            { status: 429 }
          ));
        }, timeoutMs);
      }
      this._q.push(entry);
    });
  }

  release() {
    if (this._q.length) {
      const { resolve, timer } = this._q.shift();
      if (timer) clearTimeout(timer);
      resolve(); // slot transfers directly — active count unchanged
    } else {
      this.active--;
    }
  }

  resize(newSlots) {
    this.slots = newSlots;
    // Drain queue for newly freed slots
    while (this._q.length && this.active < this.slots) {
      const { resolve, timer } = this._q.shift();
      if (timer) clearTimeout(timer);
      this.active++;
      resolve();
    }
  }

  get available() { return this.active < this.slots; }
  get queued()    { return this._q.length; }
}

// ── Account manager ───────────────────────────────────────────────────────────
class AccountManager {
  constructor() {
    this.accounts = [];
    this.rrIndex = 0;
    this.rrVideoIndex = 0;
    this._load();
    addLog("INFO", `Loaded ${this.accounts.length} account(s)`, {
      accounts: this.accounts.map(a => a.name),
      totalSlots: this.totalCapacity,
    });
  }

  _load() {
    const fresh = loadAccounts();
    // Preserve semaphores for accounts that already exist (keep in-flight state)
    for (const acc of fresh) {
      const existing = this.accounts.find(a => a.name === acc.name);
      acc.semaphore = existing?.semaphore || new AccountSemaphore(SLOTS_PER_ACCOUNT);
      acc.lastRefresh = existing?.lastRefresh || {};  // { page: timestamp }
    }
    this.accounts = fresh;
  }

  reload() {
    this._load();
    this.rrIndex = 0;
    this.rrVideoIndex = 0;
    addLog("INFO", `Reloaded ${this.accounts.length} account(s)`, {
      accounts: this.accounts.map(a => a.name),
      totalSlots: this.activeCount * SLOTS_PER_ACCOUNT,
    });
  }

  get activeCount() {
    return this.accounts.filter(a => a.status === 'active').length;
  }

  // Total capacity = active accounts × slots each
  get totalCapacity() {
    return this.activeCount * SLOTS_PER_ACCOUNT;
  }

  // Returns all active accounts matching filter, in round-robin order starting
  // from the current index. Advances the index so the next call starts at the
  // next account (fair distribution across concurrent requests).
  getPool(filter = () => true, indexKey = 'rrIndex') {
    const active = this.accounts.filter(a => a.status === 'active' && filter(a));
    if (!active.length) return [];
    const n = active.length;
    const start = this[indexKey] % n;
    this[indexKey] = (start + 1) % n;
    return [...active.slice(start), ...active.slice(0, start)];
  }

  // Legacy single-account getter kept for compatibility
  async getAccount() {
    const pool = this.getPool();
    if (!pool.length) return null;
    const acc = pool[0];
    if (acc.grTokenExpiry && Date.now() > acc.grTokenExpiry - 120000) {
      await this.refreshToken(acc);
    }
    return acc;
  }

  async refreshToken(acc) {
    if (!FIREBASE_API_KEY) {
      addLog("WARN", `[${acc.name}] GR_TOKEN expiring but FIREBASE_API_KEY not set — skipping refresh`);
      return;
    }
    if (!acc.grRefresh) {
      addLog("WARN", `[${acc.name}] No GR_REFRESH token available`);
      return;
    }

    try {
      addLog("INFO", `[${acc.name}] Refreshing GR_TOKEN...`);
      const r = await fetch(
        `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(acc.grRefresh)}`,
          signal: AbortSignal.timeout(10000),
        }
      );
      const data = await r.json();

      if (data.id_token) {
        const newRefresh = data.refresh_token || acc.grRefresh;
        acc.grToken = data.id_token;
        acc.grRefresh = newRefresh;
        acc.grTokenExpiry = getTokenExpiry(data.id_token);
        acc.cookieString = acc.cookieString
          .replace(/GR_TOKEN=[^;]+/, `GR_TOKEN=${data.id_token}`)
          .replace(/GR_REFRESH=[^;]+/, `GR_REFRESH=${newRefresh}`);
        addLog("INFO", `[${acc.name}] GR_TOKEN refreshed, expires ${new Date(acc.grTokenExpiry).toISOString()}`);
      } else {
        addLog("WARN", `[${acc.name}] Token refresh failed: ${JSON.stringify(data)}`);
        if (["USER_DISABLED", "USER_NOT_FOUND", "TOKEN_EXPIRED"].includes(data.error?.status)) {
          this.markExpired(acc);
        }
      }
    } catch (e) {
      addLog("WARN", `[${acc.name}] Token refresh error: ${e.message}`);
    }
  }

  markExpired(acc) {
    acc.status = "expired";
    addLog("WARN", `[${acc.name}] Marked as expired — remaining capacity: ${this.totalCapacity} slots`);
  }
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
async function apiRequest(method, apiPath, body, acc) {
  const headers = {
    "accept": "application/json",
    "content-type": "application/json",
    "cookie": acc.cookieString,
    "origin": BASE,
    "referer": `${BASE}/app/ai-image-generator`,
    "x-xsrf-token": acc.xsrf,
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
  };

  if (acc.folderRef) headers["x-folder-reference"] = acc.folderRef;

  const opts = { method, headers, signal: AbortSignal.timeout(20000) };
  if (body) opts.body = JSON.stringify(body);

  const r = await fetch(BASE + apiPath, opts);
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}

  return { status: r.status, text, json };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function aspectToDimensions(ratio) {
  const map = {
    "1:1":  { width: 1024, height: 1024 },
    "16:9": { width: 1024, height: 576  },
    "9:16": { width: 576,  height: 1024 },
    "4:3":  { width: 1024, height: 768  },
    "3:4":  { width: 768,  height: 1024 },
    "3:2":  { width: 1024, height: 683  },
    "2:3":  { width: 683,  height: 1024 },
  };
  return map[ratio] || { width: 1024, height: 1024 };
}

// ── Session refresh ───────────────────────────────────────────────────────────
// Magnific's magnific_session rotates on every browser request (~30 min TTL).
// We GET the app page to receive fresh Set-Cookie headers before each generation.
// ── Voice list cache ──────────────────────────────────────────────────────────
// Magnific's /v2/voices returns all voices; each has a `provider` field.
// We cache the full list and filter by provider client-side.
let voiceCacheAll = null; // { ts, voices[] }
const VOICE_CACHE_TTL = 3600000; // 1 hour

async function getAllVoices(acc) {
  if (voiceCacheAll && Date.now() - voiceCacheAll.ts < VOICE_CACHE_TTL) return voiceCacheAll.voices;

  const r = await fetch(
    `${BASE}/app/api/audio/feature/voiceover/v2/voices`,
    {
      headers: {
        'accept': 'application/json',
        'cookie': acc.cookieString,
        'origin': BASE,
        'referer': `${BASE}/app/voiceover-generator`,
        'x-xsrf-token': acc.xsrf,
        'x-requested-with': '6',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
      },
      signal: AbortSignal.timeout(15000),
    }
  );

  if (!r.ok) {
    const err = new Error(`Failed to fetch voices (${r.status})`);
    err.status = r.status;
    throw err;
  }

  const json = await r.json();
  const voices = json?.data || json?.voices || (Array.isArray(json) ? json : []);
  const providers = new Set(voices.map(v => v.provider));
  // Only cache if we got voices from both providers; otherwise retry next call
  if (providers.has('elevenlabs') && providers.has('google')) {
    voiceCacheAll = { ts: Date.now(), voices };
  }
  return voices;
}

async function getVoices(acc, provider) {
  const all = await getAllVoices(acc);
  return provider ? all.filter(v => v.provider === provider) : all;
}

const REFRESH_DEBOUNCE_MS = 60000; // skip refresh if done within last 60s for same page

async function refreshSession(acc, page = 'ai-image-generator') {
  // Debounce: skip if this account+page was refreshed recently
  const lastRefreshKey = page;
  const now = Date.now();
  if (acc.lastRefresh && acc.lastRefresh[lastRefreshKey] && now - acc.lastRefresh[lastRefreshKey] < REFRESH_DEBOUNCE_MS) {
    addLog('INFO', `[${acc.name}] Session refresh skipped (debounced, page=${page})`);
    return;
  }
  if (!acc.lastRefresh) acc.lastRefresh = {};
  acc.lastRefresh[lastRefreshKey] = now;

  try {
    const r = await fetch(`${BASE}/app/${page}`, {
      method: "GET",
      headers: {
        "cookie": acc.cookieString,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "none",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });

    const setCookies = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    let refreshed = false;

    for (const raw of setCookies) {
      const match = raw.match(/^([^=]+)=([^;]*)/);
      if (!match) continue;
      const [, name, value] = match;

      if (name === "magnific_session") {
        if (acc.cookieString.includes("magnific_session=")) {
          acc.cookieString = acc.cookieString.replace(/magnific_session=[^;]*/, `magnific_session=${value}`);
        } else {
          acc.cookieString += `; magnific_session=${value}`;
        }
        refreshed = true;
      } else if (name === "XSRF-TOKEN") {
        if (acc.cookieString.includes("XSRF-TOKEN=")) {
          acc.cookieString = acc.cookieString.replace(/XSRF-TOKEN=[^;]*/, `XSRF-TOKEN=${value}`);
        } else {
          acc.cookieString += `; XSRF-TOKEN=${value}`;
        }
        try { acc.xsrf = decodeURIComponent(value); } catch { acc.xsrf = value; }
        refreshed = true;
      } else if (name === "GR_TOKEN") {
        if (acc.cookieString.includes("GR_TOKEN=")) {
          acc.cookieString = acc.cookieString.replace(/GR_TOKEN=[^;]*/, `GR_TOKEN=${value}`);
        } else {
          acc.cookieString += `; GR_TOKEN=${value}`;
        }
        acc.grToken = value;
        acc.grTokenExpiry = getTokenExpiry(value);
        addLog("INFO", `[${acc.name}] GR_TOKEN refreshed via Set-Cookie, expires ${new Date(acc.grTokenExpiry).toISOString()}`);
        refreshed = true;
      } else if (name === "GR_REFRESH") {
        if (acc.cookieString.includes("GR_REFRESH=")) {
          acc.cookieString = acc.cookieString.replace(/GR_REFRESH=[^;]*/, `GR_REFRESH=${value}`);
        } else {
          acc.cookieString += `; GR_REFRESH=${value}`;
        }
        acc.grRefresh = value;
        refreshed = true;
      }
    }

    if (refreshed) {
      addLog("INFO", `[${acc.name}] Session refreshed from Set-Cookie (page=${page})`);
    } else {
      addLog("WARN", `[${acc.name}] Session refresh got no new cookies (page=${page} status=${r.status})`);
    }
  } catch (e) {
    addLog("WARN", `[${acc.name}] Session refresh failed: ${e.message}`);
  }
}

// ── render/v4 — queues one image on ak-data.magnific.com ─────────────────────
async function renderV4(acc, body) {
  const headers = {
    "accept": "application/json",
    "content-type": "application/json",
    "cookie": acc.cookieString,
    "origin": BASE,
    "referer": `${BASE}/app/ai-image-generator`,
    "x-xsrf-token": acc.xsrf,
    ...(acc.folderRef ? { "x-folder-reference": acc.folderRef } : {}),
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
  };

  const r = await fetch(
    `${RENDER_BASE}/app/api/render/v4?lang=en_US&user_id=${acc.userId}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    }
  );

  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, text, json };
}

// ── Auto-delete ───────────────────────────────────────────────────────────────
// Deletes Magnific creations by their integer IDs after generation.
// Fire-and-forget — called without await so it never delays the response.
// Endpoint: POST /app/api/creations with { _method: "DELETE", ids: [int, ...] }
async function deleteCreations(acc, integerIds) {
  if (!AUTO_DELETE || !integerIds?.length) return;
  try {
    const r = await fetch(`${BASE}/app/api/creations`, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'cookie': acc.cookieString,
        'origin': BASE,
        'referer': `${BASE}/app/ai-image-generator`,
        'x-xsrf-token': acc.xsrf,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
      },
      body: JSON.stringify({ _method: 'DELETE', ids: integerIds }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    addLog('INFO', `[${acc.name}] Auto-deleted ${integerIds.length} creation(s): ${j.success ? 'ok' : r.status}`);
  } catch (e) {
    addLog('WARN', `[${acc.name}] Auto-delete failed: ${e.message}`);
  }
}

// ── Image generation ──────────────────────────────────────────────────────────
async function generateImages(acc, { prompt, num_images = 1, aspect_ratio = "1:1", mode = "auto", model = "auto", variations = false, folder = null }) {
  // model param takes precedence over mode param
  const resolvedMode = model !== "auto" ? model : mode;
  // folder param overrides the account's default folderRef
  if (folder) acc = { ...acc, folderRef: folder };
  // refreshSession fetches the app page — Magnific auto-refreshes GR_TOKEN via Set-Cookie when needed.
  // magnific_session is the primary auth; GR_TOKEN expiry is advisory only — let the API itself reject if truly dead.
  await refreshSession(acc);

  // Step 1: Reserve generation slots
  const { status, json, text } = await apiRequest(
    "POST",
    `/app/api/start-tti-v2?lang=en_US&user_id=${acc.userId}`,
    {
      mode: resolvedMode,
      prompt,
      references: [],
      num_images,
      aspect_ratio,
      color_palette: null,
      color_palette_id: null,
      variations,
      force_credits: false,
    },
    acc
  );

  if (status === 401 || status === 403) {
    const err = new Error(`Auth failed (${status})`);
    err.status = status;
    throw err;
  }

  if (status !== 200 || !json?.family) {
    const err = new Error(`Generation start failed (${status}): ${text.slice(0, 200)}`);
    err.status = status;
    throw err;
  }

  if (json.available_slots === 0) {
    const err = new Error("No generation slots available — account is busy, try again in a moment");
    err.status = 429;
    throw err;
  }

  const family = json.family;
  const requestTokens = json.request_tokens || [];
  const dims = aspectToDimensions(aspect_ratio);
  const seed = Math.floor(Math.random() * 1000000);
  const startTime = Date.now();

  addLog("INFO", `[${acc.name}] Slots reserved — family=${family} tokens=${requestTokens.length} prompt="${prompt.slice(0, 60)}"`);

  // Step 2: Queue each image via render/v4 on ak-data.magnific.com
  let queued = 0;
  for (let i = 0; i < num_images; i++) {
    const request_token = requestTokens[i];
    if (!request_token) {
      addLog("WARN", `[${acc.name}] No request_token for image ${i} — skipping`);
      continue;
    }

    try {
      const rv = await renderV4(acc, {
        tool: "text-to-image",
        mode: resolvedMode,
        family,
        prompt,
        negative_prompt: null,
        width: dims.width,
        height: dims.height,
        seed,
        aspect_ratio,
        request_token,
        force_credits: false,
        metadata: {
          inputPrompt: prompt,
          aspectRatio: aspect_ratio,
          mode,
          unlimited: true,
          smartPrompt: true,
        },
        smart_prompt: true,
        image_index: i,
        num_images,
      });

      if (rv.status === 200 || rv.status === 201) {
        queued++;
        addLog("INFO", `[${acc.name}] Queued image ${i} — id=${rv.json?.creation?.id || "?"} status=${rv.json?.creation?.status || "?"}`);
      } else {
        addLog("WARN", `[${acc.name}] render/v4 image ${i} → ${rv.status}: ${rv.text.slice(0, 200)}`);
      }
    } catch (e) {
      addLog("WARN", `[${acc.name}] render/v4 image ${i} error: ${e.message}`);
    }
  }

  if (queued === 0) {
    throw new Error("All render/v4 calls failed — images could not be queued. Check logs for details.");
  }

  addLog("INFO", `[${acc.name}] Queued ${queued}/${num_images} images, polling...`);

  // Step 3: Poll creations and filter by family (client-side — server ignores the family param)
  const deadline = startTime + 180000;

  while (Date.now() < deadline) {
    await sleep(5000);

    let poll;
    try {
      poll = await apiRequest("GET", `/app/api/creations`, null, acc);
    } catch (e) {
      addLog("WARN", `[${acc.name}] Poll error: ${e.message}`);
      continue;
    }

    if (poll.status !== 200 || !Array.isArray(poll.json?.data)) continue;

    const items = poll.json.data.filter(i => i.family === family);

    if (items.length === 0) continue;

    const completed = items.filter(i => i.status === "completed" && i.url);
    const failed    = items.filter(i => i.status === "failed");
    const pending   = items.filter(i => i.status === "queued" || i.status === "processing");

    addLog("INFO", `[${acc.name}] Poll: family=${family} completed=${completed.length} pending=${pending.length} failed=${failed.length}`);

    if (failed.length > 0 && pending.length === 0 && completed.length === 0) {
      throw new Error(`All ${failed.length} image(s) failed to generate`);
    }

    if (completed.length >= queued || (pending.length === 0 && completed.length > 0)) {
      addLog("INFO", `[${acc.name}] Done — ${completed.length} completed, ${failed.length} failed`);
      const results = completed.map(item => ({
        url: item.url,
        preview: item.large_preview || item.preview || item.url,
        prompt: item.metadata?.prompt || item.metadata?.inputPrompt || prompt,
        width: item.metadata?.width || dims.width,
        height: item.metadata?.height || dims.height,
        mode: item.metadata?.mode || mode,
        seed: item.metadata?.seed || seed,
        id: item.identifier || String(item.id),
        family,
      }));
      deleteCreations(acc, completed.map(i => i.id).filter(Number.isInteger)); // fire-and-forget
      return results;
    }
  }

  throw new Error("Generation timed out after 180s");
}

// ── Express app ───────────────────────────────────────────────────────────────

// ── Video generation ──────────────────────────────────────────────────────────
async function generateVideo(acc, {
  prompt,
  negative_prompt = '',
  model = 'bytedance-seedance-fast-2.0',
  aspect_ratio = '16:9',
  duration = 5,
  resolution = '720p',
  sound_effects = true,
  start_image = null,     // URL — start frame (image-to-video)
  end_image = null,       // URL — end frame (only models with ef:true)
  references = [],        // [{ type, url }] — image/video/character/style/product refs
  prompt_mode = 'manual', // 'manual' | 'auto'
  folder = null,          // folder reference UUID — overrides account default
}) {
  const vm = VIDEO_MODELS.find(m => m.id === model);
  if (!vm) {
    const err = new Error(`Unknown video model "${model}". Call GET /v1/models?type=video to see available models.`);
    err.status = 400;
    throw err;
  }

  await refreshSession(acc);

  const family = crypto.randomUUID();

  const clip = {
    position: 0,
    prompt,
    negativePrompt: negative_prompt,
    name: prompt,
    family,
    aspectRatio: aspect_ratio,
    cameraMotion: null,
    duration,
    api: vm.api,
    model: vm.videoModel,
    mode: vm.videoMode,
    slug: vm.id,
    ...(start_image ? { startFrame: start_image } : {}),
    ...(end_image   ? { endFrame: end_image }     : {}),
    ...(references.length > 0 ? { references }    : {}),
    extraParameters: { style: 'default', promptMode: prompt_mode },
    withSoundEffects: sound_effects,
    promptType: 'basic',
    resolution,
    audioUrl: '',
    voices: [],
    boardUuid: null,
    videoPreset: 'custom',
  };

  const folderRef = folder || acc.folderRef;
  const headers = {
    'accept': 'application/json',
    'content-type': 'application/json',
    'cookie': acc.cookieString,
    'origin': BASE,
    'referer': `${BASE}/app/ai-video-generator`,
    'x-xsrf-token': acc.xsrf,
    'x-request-origin': 'video-generator-pikaso-web',
    ...(folderRef ? { 'x-folder-reference': folderRef } : {}),
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  };

  const r = await fetch(
    `${BASE}/app/api/video/generate?return_creations=true&lang=en_US&user_id=${acc.userId}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ video: { family, clips: [clip] } }),
      signal: AbortSignal.timeout(20000),
    }
  );

  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}

  if (r.status === 401 || r.status === 403) {
    const err = new Error(`Auth failed (${r.status})`);
    err.status = r.status;
    throw err;
  }
  if (!json?.success || !json?.data?.creations?.[0]) {
    const err = new Error(`Video generation start failed (${r.status}): ${text.slice(0, 200)}`);
    err.status = r.status;
    throw err;
  }

  const creation = json.data.creations[0];
  const identifier = creation.identifier;
  addLog('INFO', `[${acc.name}] Video queued — id=${creation.id} identifier=${identifier} model=${vm.id}`);

  // Poll /app/api/creations until status = completed or failed (10 min max)
  const deadline = Date.now() + 600000;
  while (Date.now() < deadline) {
    await sleep(10000);

    let poll;
    try {
      poll = await apiRequest('GET', '/app/api/creations', null, acc);
    } catch (e) {
      addLog('WARN', `[${acc.name}] Video poll error: ${e.message}`);
      continue;
    }

    if (poll.status !== 200 || !Array.isArray(poll.json?.data)) continue;

    const item = poll.json.data.find(i => i.identifier === identifier);
    if (!item) continue;

    addLog('INFO', `[${acc.name}] Video poll: identifier=${identifier} status=${item.status}`);

    if (item.status === 'completed') {
      const videoUrl = item.metadata?.url || item.url || item.raw;
      if (!videoUrl) continue; // URL not ready yet — keep polling
      deleteCreations(acc, [item.id].filter(Number.isInteger)); // fire-and-forget
      return {
        url: videoUrl,
        prompt: item.metadata?.prompt || prompt,
        model: vm.id,
        slug: vm.id,
        duration: item.metadata?.duration || duration,
        aspect_ratio: item.metadata?.aspectRatio || aspect_ratio,
        resolution: item.metadata?.resolution || resolution,
        identifier: item.identifier,
        id: String(item.id),
      };
    }

    if (item.status === 'failed') {
      throw new Error(`Video generation failed: ${item.metadata?.error || 'unknown error'}`);
    }
  }

  throw new Error('Video generation timed out after 10 minutes');
}

// ── Audio generation ──────────────────────────────────────────────────────────
async function generateAudio(acc, {
  text,
  model = 'eleven_v3',
  voice = null,            // voice name — if omitted uses first available for provider
  voice_id = null,         // explicit voice ID (skips voice lookup)
  style = 'neutral',       // 'expressive' | 'neutral' | 'consistent'
  speed = 1.0,             // ElevenLabs only
  temperature = 1.0,       // Google only
  system_instruction = '', // Google only
  folder = null,
}) {
  const am = AUDIO_MODELS.find(m => m.id === model);
  if (!am) {
    const err = new Error(`Unknown audio model "${model}". Call GET /v1/models?type=audio to see available models.`);
    err.status = 400;
    throw err;
  }

  await refreshSession(acc, 'voiceover-generator');

  // Resolve the full voice entry object — required as-is in the payload
  const voices = await getVoices(acc, am.provider);
  let entry;
  if (voice_id) {
    // explicit numeric ID
    entry = voices.find(v => v.id === voice_id || v.id === Number(voice_id) || v.provider_id === voice_id);
  } else if (voice) {
    entry = voices.find(v => v.name === voice || v.id === voice || v.provider_id === voice);
  } else {
    entry = voices[0];
  }
  if (!entry) {
    const err = new Error(
      voice || voice_id
        ? `Voice "${voice || voice_id}" not found for provider "${am.provider}"`
        : `No voices available for provider "${am.provider}"`
    );
    err.status = 400;
    throw err;
  }

  const stability = VOICE_STYLE_STABILITY[style?.toLowerCase()] ?? 0.5;
  const isElevenLabs = am.provider === 'elevenlabs';

  // `voice` is the full voice entry object; `voiceId`/`voice_id` is the integer DB id
  const payload = isElevenLabs
    ? { text, voice: entry, model, voiceId: entry.id, stability, similarity_boost: 0.75, speed }
    : { text, voice: entry, model, voice_id: entry.id, temperature, system_instruction };

  const folderRef = folder || acc.folderRef;
  const headers = {
    'accept': 'application/json',
    'content-type': 'application/json',
    'cookie': acc.cookieString,
    'origin': BASE,
    'referer': `${BASE}/app/voiceover-generator`,
    'x-xsrf-token': acc.xsrf,
    'x-requested-with': '6',
    ...(folderRef ? { 'x-folder-reference': folderRef } : {}),
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  };

  const r = await fetch(
    `${BASE}/app/api/audio/feature/voiceover/generate-iqs?lang=en_US&user_id=${acc.userId}`,
    { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) }
  );

  const rawText = await r.text();
  let json = null;
  try { json = JSON.parse(rawText); } catch {}

  if (r.status === 401 || r.status === 403) {
    const err = new Error(`Auth failed (${r.status})`);
    err.status = r.status;
    throw err;
  }
  if (r.status !== 202 && r.status !== 200) {
    const err = new Error(`Audio generation start failed (${r.status}): ${rawText.slice(0, 200)}`);
    err.status = r.status;
    throw err;
  }

  const identifier = json?.creation?.identifier || json?.identifier || json?.data?.identifier;
  if (!identifier) {
    const err = new Error(`Audio generation response missing identifier: ${rawText.slice(0, 200)}`);
    err.status = 500;
    throw err;
  }

  addLog('INFO', `[${acc.name}] Audio queued — identifier=${identifier} model=${model} voice=${entry.name}`);

  // Poll /app/api/creations until completed or failed (5 min max)
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    await sleep(5000);

    let poll;
    try {
      poll = await apiRequest('GET', '/app/api/creations', null, acc);
    } catch (e) {
      addLog('WARN', `[${acc.name}] Audio poll error: ${e.message}`);
      continue;
    }

    if (poll.status !== 200 || !Array.isArray(poll.json?.data)) continue;

    const item = poll.json.data.find(i => i.identifier === identifier);
    if (!item) continue;

    addLog('INFO', `[${acc.name}] Audio poll: identifier=${identifier} status=${item.status}`);

    if (item.status === 'completed') {
      const audioUrl = item.metadata?.url || item.url;
      if (!audioUrl) continue; // URL not ready yet — keep polling
      deleteCreations(acc, [item.id].filter(Number.isInteger)); // fire-and-forget
      return {
        url: audioUrl,
        text: item.metadata?.text || text,
        model,
        voice: entry.name,
        voice_id: entry.provider_id || entry.id,
        duration: item.metadata?.duration || null,
        identifier: item.identifier,
        id: String(item.id),
      };
    }

    if (item.status === 'failed') {
      throw new Error(`Audio generation failed: ${item.metadata?.error || 'unknown error'}`);
    }
  }

  throw new Error('Audio generation timed out after 5 minutes');
}

async function generateAudioWithRotation(params) {
  const pool = manager.getPool();
  // Audio 403 = "feature not on plan" (not an expired session) — try next without expiring.
  // We wrap tryWithRotation and re-throw 403 as a 402-like skip so tryWithRotation moves on.
  return tryWithRotation(pool, 'audio', async acc => {
    addLog('INFO', `Audio generating — account=${acc.name}`, { text: params.text?.slice(0, 80) });
    try {
      const audio = await generateAudio(acc, params);
      return { audio, account: acc.name };
    } catch (e) {
      if (e.status === 403) {
        addLog('WARN', `[${acc.name}] [audio] 403 — voiceover feature may not be on this account's plan, trying next`);
        e.status = 429; // remap to "try next, don't expire"
      }
      throw e;
    }
  });
}

// ── Image upscaling ───────────────────────────────────────────────────────────
// Uploads an external image URL into Magnific and returns "creation:{id}"
// Endpoint: POST /app/api/describe?tool=upload  body: { image: "data:image/jpeg;base64,..." }
// Accepts either a remote URL (downloads it) or a base64 data URL directly.
async function uploadImageForUpscale(acc, imageSource) {
  let dataUrl;

  if (imageSource.startsWith('data:')) {
    // Already a base64 data URL — use directly
    dataUrl = imageSource;
  } else {
    // Treat as URL — download first
    const imgRes = await fetch(imageSource, {
      headers: { 'user-agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(30000),
    });
    if (!imgRes.ok) throw Object.assign(new Error(`Failed to download image (HTTP ${imgRes.status})`), { status: 400 });
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
    const ct = imgRes.headers.get('content-type') || 'image/jpeg';
    dataUrl = `data:${ct};base64,${imgBuffer.toString('base64')}`;
  }

  const headers = {
    'accept': 'application/json',
    'content-type': 'application/json',
    'cookie': acc.cookieString,
    'origin': BASE,
    'referer': `${BASE}/app/image-upscaler`,
    'x-xsrf-token': acc.xsrf,
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    ...(acc.folderRef ? { 'x-folder-reference': acc.folderRef } : {}),
  };

  const r = await fetch(
    `${BASE}/app/api/describe?tool=upload&lang=en_US&user_id=${acc.userId}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ image: dataUrl }),
      signal: AbortSignal.timeout(60000),
    }
  );

  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch {}

  addLog('INFO', `[${acc.name}] Upload → ${r.status}: ${text.slice(0, 200)}`);

  if (r.status === 401 || r.status === 403) {
    throw Object.assign(new Error(`Auth failed during upload (${r.status})`), { status: r.status });
  }

  if (r.status === 200 || r.status === 201) {
    // Magnific upload endpoint returns: {"image":"temporal:reimagine-xxx.jpg",...}
    // The temporal: reference is passed directly as input_image to the upscaler
    if (json?.image && typeof json.image === 'string') {
      addLog('INFO', `[${acc.name}] Image uploaded → ${json.image}`);
      return json.image; // e.g. "temporal:reimagine-oGeWvLFZ...jpg"
    }
    // Fallback: creation identifier shapes from other endpoints
    const id = json?.creation?.identifier
      || json?.identifier
      || json?.data?.identifier
      || json?.data?.creation?.identifier
      || json?.id;
    if (id) {
      addLog('INFO', `[${acc.name}] Image uploaded → creation:${id}`);
      return `creation:${id}`;
    }
    addLog('WARN', `[${acc.name}] Upload succeeded but no id in response: ${text.slice(0, 300)}`);
  }

  throw Object.assign(
    new Error(`Image upload failed (${r.status}): ${json?.error || json?.message || text.slice(0, 200)}`),
    { status: 400 }
  );
}

// Calls the same describe?tool=upload endpoint but returns the full output
// (description, style, uses_left) instead of just the temporal: reference.
async function describeImage(acc, imageSource) {
  let dataUrl;
  if (imageSource.startsWith('data:')) {
    dataUrl = imageSource;
  } else {
    const imgRes = await fetch(imageSource, {
      headers: { 'user-agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(30000),
    });
    if (!imgRes.ok) throw Object.assign(new Error(`Failed to download image (HTTP ${imgRes.status})`), { status: 400 });
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
    const ct = imgRes.headers.get('content-type') || 'image/jpeg';
    dataUrl = `data:${ct};base64,${imgBuffer.toString('base64')}`;
  }

  await refreshSession(acc, 'image-upscaler');

  const r = await fetch(
    `${BASE}/app/api/describe?tool=upload&lang=en_US&user_id=${acc.userId}`,
    {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'cookie': acc.cookieString,
        'origin': BASE,
        'referer': `${BASE}/app/image-upscaler`,
        'x-xsrf-token': acc.xsrf,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        ...(acc.folderRef ? { 'x-folder-reference': acc.folderRef } : {}),
      },
      body: JSON.stringify({ image: dataUrl }),
      signal: AbortSignal.timeout(60000),
    }
  );

  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch {}
  addLog('INFO', `[${acc.name}] Describe → ${r.status}: ${text.slice(0, 200)}`);

  if (r.status === 401 || r.status === 403)
    throw Object.assign(new Error(`Auth failed (${r.status})`), { status: r.status });

  if (r.status !== 200 && r.status !== 201)
    throw Object.assign(
      new Error(`Describe failed (${r.status}): ${json?.error || json?.message || text.slice(0, 200)}`),
      { status: 400 }
    );

  return {
    description: json?.output?.description || null,
    style:       json?.output?.style       || null,
    uses_left:   json?.uses_left           ?? null,
  };
}

async function describeImageWithRotation(imageSource) {
  const pool = manager.getPool();
  return tryWithRotation(pool, 'describe', async acc => {
    const result = await describeImage(acc, imageSource);
    return { result, account: acc.name };
  });
}

async function upscaleImage(acc, {
  image_url,
  creation_id  = null,         // Magnific creation ID (preferred) — "id" from /v1/images/generate
  mode         = 'creative',   // 'creative' | 'precision'
  model        = 'magnific',   // 'classic' | 'magnific'
  preset       = 'subtle',     // 'subtle' | 'upscale-v2' (imagination field)
  scale        = 2,            // 2 | 4 | 8
  optimized_for = 'StandardUltra',  // optimised field — 'StandardUltra' | 'Faces' | 'Nature' etc.
  creativity   = -3,
  hdr          = 0,
  resemblance  = 3,
  fractality   = 0,
  engine       = 'automatic',  // 'automatic' | 'illusio' | 'sharpy' | 'sparkle'
  prompt       = '',
  folder       = null,
}) {
  if (folder) acc = { ...acc, folderRef: folder };
  await refreshSession(acc, 'image-upscaler');

  // Resolve input_image — must be "creation:{id}" format
  let inputImage;
  if (creation_id) {
    // Accept temporal: (from /v1/upload) or creation: prefix, or bare identifier
    inputImage = (creation_id.startsWith('creation:') || creation_id.startsWith('temporal:'))
      ? creation_id
      : `creation:${creation_id}`;
  } else if (image_url) {
    inputImage = await uploadImageForUpscale(acc, image_url);
  } else {
    throw Object.assign(new Error('Either image_url or creation_id is required'), { status: 400 });
  }

  // mode key = "enhance-{model}-{mode}"  e.g. "enhance-magnific-creative"
  const modeKey = `enhance-${model}-${mode}`;
  const family  = crypto.randomUUID();
  const startTime = Date.now();

  addLog('INFO', `[${acc.name}] Upscale queuing — family=${family} mode=${modeKey} scale=${scale}x input=${inputImage}`);

  const headers = {
    'accept': 'application/json',
    'content-type': 'application/json',
    'cookie': acc.cookieString,
    'origin': BASE,
    'referer': `${BASE}/app/image-upscaler`,
    'x-xsrf-token': acc.xsrf,
    ...(acc.folderRef ? { 'x-folder-reference': acc.folderRef } : {}),
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
  };

  const r = await fetch(
    `${RENDER_BASE}/app/api/render/v4/upscale?lang=en_US&user_id=${acc.userId}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mode:         modeKey,
        input_image:  inputImage,
        scale:        `${scale}x`,
        board_uuid:   null,
        family,
        metadata:     {},
        force_credits: false,
        optimised:    optimized_for,
        imagination:  preset,
        creativity,
        resemblance,
        hdr,
        fractality,
        engine,
        prompt:       prompt || '',
      }),
      signal: AbortSignal.timeout(20000),
    }
  );

  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch {}

  if (r.status === 401 || r.status === 403) {
    const err = new Error(`Auth failed (${r.status})`);
    err.status = r.status;
    throw err;
  }

  if (r.status !== 200 && r.status !== 201) {
    const msg = json?.error || json?.message || text.slice(0, 300);
    const err = new Error(`Upscale failed (${r.status}): ${msg}`);
    err.status = r.status >= 400 ? r.status : 500;
    throw err;
  }

  const creation = json?.creation || json?.data?.creation || json;
  const identifier = creation?.identifier || creation?.id;
  addLog('INFO', `[${acc.name}] Upscale queued — id=${identifier} family=${family}`);

  // Poll /app/api/creations (5 min max)
  const deadline = startTime + 300000;
  while (Date.now() < deadline) {
    await sleep(5000);

    let poll;
    try {
      poll = await apiRequest('GET', '/app/api/creations', null, acc);
    } catch (e) {
      addLog('WARN', `[${acc.name}] Upscale poll error: ${e.message}`);
      continue;
    }

    if (poll.status !== 200 || !Array.isArray(poll.json?.data)) continue;

    const items = poll.json.data.filter(i => i.family === family);
    if (!items.length) continue;

    const completed = items.filter(i => i.status === 'completed' && i.url);
    const failed    = items.filter(i => i.status === 'failed');
    const pending   = items.filter(i => i.status === 'queued' || i.status === 'processing');

    addLog('INFO', `[${acc.name}] Upscale poll: completed=${completed.length} pending=${pending.length} failed=${failed.length}`);

    if (failed.length > 0 && !pending.length && !completed.length) {
      throw new Error(`Upscale failed: ${failed[0]?.metadata?.error || 'unknown error'}`);
    }

    if (completed.length > 0 && pending.length === 0) {
      const item = completed[0];
      deleteCreations(acc, [item.id].filter(Number.isInteger)); // fire-and-forget
      return {
        url:     item.url,
        preview: item.large_preview || item.preview || item.url,
        width:   item.metadata?.width  || null,
        height:  item.metadata?.height || null,
        scale,
        mode:    modeKey,
        model,
        engine,
        preset,
        id:      item.identifier || String(item.id),
        family,
      };
    }
  }

  throw new Error('Upscale timed out after 5 minutes');
}

async function upscaleWithRotation(params) {
  let pool = manager.getPool();
  // Prefer accounts with active premium (isPremium true) — they have upscale quota.
  // Skip accounts already known to have expired/no credits.
  const premiumPool = pool.filter(a => a.isPremium === true);
  if (premiumPool.length > 0) {
    pool = premiumPool;
    addLog('INFO', `Upscale — routing to premium accounts: ${pool.map(a => a.name).join(', ')}`);
  } else if (pool.some(a => a.isPremium != null)) {
    // All checked accounts have no premium — warn but still try
    addLog('WARN', `Upscale — no premium accounts found, trying all active accounts`);
  }
  return tryWithRotation(pool, 'upscale', async acc => {
    addLog('INFO', `Upscaling — account=${acc.name}`);
    const result = await upscaleImage(acc, params);
    return { result, account: acc.name };
  });
}

async function uploadWithRotation(imageData) {
  const pool = manager.getPool();
  return tryWithRotation(pool, 'upload', async acc => {
    await refreshSession(acc, 'image-upscaler');
    const result = await uploadImageForUpscale(acc, imageData);
    return { result, account: acc.name };
  });
}

// ── Background removal ────────────────────────────────────────────────────────
// Calls POST /app/api/remove-background — returns PNG binary directly (no polling).
// Returns a base64 data URL of the result PNG with transparent background.
async function removeBackground(acc, imageSource) {
  let dataUrl;
  if (imageSource.startsWith('data:')) {
    dataUrl = imageSource;
  } else {
    const imgRes = await fetch(imageSource, {
      headers: { 'user-agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(30000),
    });
    if (!imgRes.ok) throw Object.assign(new Error(`Failed to download image (HTTP ${imgRes.status})`), { status: 400 });
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
    const ct = imgRes.headers.get('content-type') || 'image/jpeg';
    dataUrl = `data:${ct};base64,${imgBuffer.toString('base64')}`;
  }

  await refreshSession(acc, 'tools/remove-background');

  const r = await fetch(`${BASE}/app/api/remove-background`, {
    method: 'POST',
    headers: {
      'accept': 'image/png,*/*',
      'content-type': 'application/json',
      'cookie': acc.cookieString,
      'origin': BASE,
      'referer': `${BASE}/app/tools/remove-background`,
      'x-xsrf-token': acc.xsrf,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      ...(acc.folderRef ? { 'x-folder-reference': acc.folderRef } : {}),
    },
    body: JSON.stringify({ image: dataUrl }),
    signal: AbortSignal.timeout(60000),
  });

  addLog('INFO', `[${acc.name}] BG remove → ${r.status} ${r.headers.get('content-type')}`);

  if (r.status === 401 || r.status === 403) {
    throw Object.assign(new Error(`Auth failed (${r.status})`), { status: r.status });
  }
  if (r.status !== 200 && r.status !== 201) {
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch {}
    throw Object.assign(
      new Error(`Background removal failed (${r.status}): ${json?.error || json?.message || text.slice(0, 200)}`),
      { status: 400 }
    );
  }

  const buf = Buffer.from(await r.arrayBuffer());
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (!isPng) {
    throw Object.assign(new Error('Background removal returned unexpected data (not a PNG)'), { status: 500 });
  }

  addLog('INFO', `[${acc.name}] BG remove done — ${buf.length} bytes PNG`);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

async function removeBackgroundWithRotation(imageSource) {
  const pool = manager.getPool();
  return tryWithRotation(pool, 'bg-remove', async acc => {
    const result = await removeBackground(acc, imageSource);
    return { result, account: acc.name };
  });
}

// ── tryWithRotation — semaphore-aware account rotation ───────────────────────
// Algorithm:
//   1. First pass: try every account that has a free slot RIGHT NOW (no waiting).
//      This spreads load evenly and handles errors with immediate fallback.
//   2. If all accounts are slot-full, wait on the account whose semaphore queue
//      is shortest (soonest to free up), then retry from step 1.
//   3. Bad-request (400) throws immediately — retrying won't help.
//   4. Auth errors expire the account; its slot is released for others.
//   5. Total capacity scales automatically: each new active account adds
//      SLOTS_PER_ACCOUNT slots. Removing/expiring accounts shrinks it.
async function tryWithRotation(pool, tag, fn) {
  if (!pool.length) {
    throw Object.assign(new Error(`No active accounts available for ${tag}`), { status: 503 });
  }

  let lastError  = null;
  let tried      = new Set();
  const deadline = Date.now() + QUEUE_TIMEOUT_MS;

  while (Date.now() < deadline) {
    // Refresh pool view (accounts may have been expired during iteration)
    const live = pool.filter(a => a.status === 'active' && !tried.has(a.name));
    if (!live.length) break;

    // ── Pass 1: grab any account that has an immediately free slot ──────────
    const freeAcc = live.find(a => a.semaphore.tryAcquire());
    if (freeAcc) {
      tried.add(freeAcc.name);
      let released = false;
      const release = () => { if (!released) { released = true; freeAcc.semaphore.release(); } };
      try {
        const result = await fn(freeAcc);
        release();
        return result;
      } catch (e) {
        release();
        lastError = e;

        if (e.status === 400) throw e; // invalid params — no point retrying

        if (e.status === 401 || e.status === 403 || e.status === 419) {
          manager.markExpired(freeAcc);
          addLog('WARN', `[${freeAcc.name}] [${tag}] Auth error (${e.status}) — marking expired, trying next`);
          continue; // try another account immediately
        }

        addLog('WARN', `[${freeAcc.name}] [${tag}] Failed (${e.status || e.message}) — trying next`);
        continue; // try another account immediately
      }
    }

    // ── Pass 2: all remaining accounts are slot-full — wait on the one ──────
    // with the shortest internal queue (most likely to free up soonest)
    const untried = live; // already filtered above
    if (!untried.length) break;
    untried.sort((a, b) => a.semaphore.queued - b.semaphore.queued);
    const waitAcc = untried[0];

    addLog('INFO', `[${tag}] All ${untried.length} account(s) at capacity — queuing on ${waitAcc.name} (${waitAcc.semaphore.queued} ahead)`);

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    try {
      await waitAcc.semaphore.acquire(remaining);
    } catch (e) {
      // Timed out waiting for a slot
      throw Object.assign(
        new Error(`Server busy — all ${pool.length} account(s) at capacity (${pool.length * SLOTS_PER_ACCOUNT} total slots). Add more accounts to increase throughput.`),
        { status: 429 }
      );
    }

    // Slot acquired on waitAcc — now run fn on it
    tried.add(waitAcc.name);
    let released2 = false;
    const release2 = () => { if (!released2) { released2 = true; waitAcc.semaphore.release(); } };
    try {
      const result = await fn(waitAcc);
      release2();
      return result;
    } catch (e) {
      release2();
      lastError = e;

      if (e.status === 400) throw e;

      if (e.status === 401 || e.status === 403 || e.status === 419) {
        manager.markExpired(waitAcc);
        addLog('WARN', `[${waitAcc.name}] [${tag}] Auth error (${e.status}) — marking expired, trying next`);
        continue;
      }

      addLog('WARN', `[${waitAcc.name}] [${tag}] Failed (${e.status || e.message}) — trying next`);
      continue;
    }
  }

  const triedList = [...tried].join(', ') || 'none';
  throw lastError || Object.assign(
    new Error(`All accounts failed for ${tag}. Tried: ${triedList}`),
    { status: 503 }
  );
}

async function generateVideoWithRotation(params) {
  const pool = manager.getPool(a => a.video, 'rrVideoIndex');
  if (!pool.length) {
    throw Object.assign(
      new Error('No video-capable accounts available. Add an account with credits or set "# video: true" in an account file.'),
      { status: 503 }
    );
  }
  return tryWithRotation(pool, 'video', async acc => {
    addLog('INFO', `Video generating — account=${acc.name}`, { prompt: params.prompt?.slice(0, 80) });
    const video = await generateVideo(acc, params);
    return { video, account: acc.name };
  });
}

// ── Account plan & credit checker ────────────────────────────────────────────
// Calls Magnific's subscription + wallet APIs to get live plan/credit data.
// Results stored directly on acc: plan, credits, planStatus, isPremium, etc.
const PLAN_CHECK_INTERVAL_MS = 3600000; // re-check every 1 hour

async function checkAccountPlan(acc) {
  const planHeaders = {
    'accept': '*/*',
    'cookie': acc.cookieString,
    'referer': `${BASE}/user/my-subscriptions`,
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
    'accept-language': 'en-US,en;q=0.5',
    'dnt': '1',
  };

  try {
    const r1 = await fetch(`${BASE}/user/api/my-subscriptions`, {
      headers: planHeaders,
      signal: AbortSignal.timeout(15000),
    });

    if (r1.status === 401 || r1.status === 403) {
      const body = await r1.text();
      // Cloudflare WAF blocks from datacenter IPs return HTML — don't deactivate, just skip
      if (body.trim().startsWith('<') || body.includes('cloudflare') || body.includes('Just a moment')) {
        addLog('WARN', `[${acc.name}] Plan check blocked by WAF (HTTP ${r1.status}) — keeping account active`);
        acc.planCheckedAt = Date.now();
        return;
      }
      acc.planStatus = 'expired'; acc.planCheckedAt = Date.now();
      acc.status = 'inactive';
      addLog('WARN', `[${acc.name}] Auto-deactivated — session expired (HTTP ${r1.status})`);
      return;
    }

    if (r1.status === 204) {
      Object.assign(acc, { planStatus: 'free', plan: 'Free', isPremium: false,
        credits: 0, creditsTotal: 0, creditsUsed: 0, planCheckedAt: Date.now() });
      acc.status = 'inactive';
      addLog('WARN', `[${acc.name}] Auto-deactivated — Free plan (no subscription, HTTP 204)`);
      return;
    }

    if (r1.status !== 200) {
      addLog('WARN', `[${acc.name}] Plan check: unexpected HTTP ${r1.status}`);
      return;
    }

    let data;
    try { data = await r1.json(); } catch { addLog('WARN', `[${acc.name}] Plan check: invalid JSON`); return; }

    if (!data.billing) {
      acc.planStatus = 'expired'; acc.planCheckedAt = Date.now();
      acc.status = 'inactive';
      addLog('WARN', `[${acc.name}] Auto-deactivated — no billing data (session likely expired)`);
      return;
    }

    // Email (update if missing from cookie file)
    if (data.billing.customerBillingEmail && !acc.email) {
      acc.email = data.billing.customerBillingEmail;
    }

    const isFree = data.permissions?.isFree !== false;
    const purchases = data.purchases || [];

    if (!purchases.length) {
      Object.assign(acc, { planStatus: 'free', plan: 'Free', isPremium: false,
        credits: 0, creditsTotal: 0, planCheckedAt: Date.now() });
      acc.status = 'inactive';
      addLog('WARN', `[${acc.name}] Auto-deactivated — Free plan (no purchases)`);
      return;
    }

    const purchase = purchases[0];
    const purchaseStatus = (purchase.purchaseStatus || '').toLowerCase();
    const product = purchase.purchaseProduct || {};
    acc.plan          = product.productName || (isFree ? 'Free' : 'Unknown');
    acc.planFrequency = product.productPrices?.priceFrequency || '';
    acc.planExpiry    = (purchase.purchaseNextBillingDate || '').split(' ')[0];
    acc.purchaseStatus = purchaseStatus;

    const ACTIVE = new Set(['active', 'trialing', 'past_due']);
    acc.isPremium  = !isFree && ACTIVE.has(purchaseStatus);
    acc.planStatus = acc.isPremium ? 'premium' : (isFree ? 'free' : 'expired');

    // Step 2: wallet (credits)
    const purchaseId = purchase.purchaseExternalId;
    if (purchaseId) {
      try {
        const r2 = await fetch(`${BASE}/user/api/my-subscriptions/wallet-info/${purchaseId}`, {
          headers: planHeaders,
          signal: AbortSignal.timeout(15000),
        });
        if (r2.status === 200) {
          const w = await r2.json();
          const planCreds  = w.creditsAvailable || 0;
          const addonCreds = w.creditsAddonsAvailable || 0;
          acc.credits      = w.totalCreditsAvailable != null ? w.totalCreditsAvailable : planCreds + addonCreds;
          acc.creditsTotal = w.totalCreditsOfPlan || 0;
          acc.creditsUsed  = w.creditsSpend || 0;
          acc.creditsAddons = addonCreds;
          acc.autoRefill   = w.autoRefill || false;
          acc.isTeam       = w.profile?.isTeams || false;
          acc.isTrial      = w.profile?.isTrial || false;
        }
      } catch (e) {
        addLog('WARN', `[${acc.name}] Wallet check failed: ${e.message}`);
      }
    }

    acc.planCheckedAt = Date.now();
    addLog('INFO', `[${acc.name}] Plan: ${acc.planStatus.toUpperCase()} | ${acc.plan} | Credits: ${acc.credits ?? '?'}/${acc.creditsTotal ?? '?'} | Expiry: ${acc.planExpiry || 'N/A'}`);

    // Auto-deactivate free accounts — they can't generate anything useful
    if (acc.planStatus === 'free') {
      acc.status = 'inactive';
      addLog('WARN', `[${acc.name}] Auto-deactivated — Free plan, no generation access`);
    }

    // Auto-enable/disable video based on credit balance.
    // Video generation costs credits — only enable for accounts that have them.
    if (acc.credits != null) {
      const hadVideo = acc.video;
      acc.video = acc.credits > 0;
      if (acc.video && !hadVideo)
        addLog('INFO', `[${acc.name}] Video auto-enabled — ${acc.credits.toLocaleString()} credits available`);
      else if (!acc.video && hadVideo)
        addLog('WARN', `[${acc.name}] Video auto-disabled — credits exhausted (${acc.credits})`);
    }
  } catch (e) {
    addLog('WARN', `[${acc.name}] Plan check error: ${e.message}`);
  }
}

// Check all active accounts; stagger requests 1s apart to avoid rate limiting
async function checkAllAccountPlans(force = false) {
  const accounts = manager.accounts.filter(a => a.status === 'active');
  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    const age = acc.planCheckedAt ? Date.now() - acc.planCheckedAt : Infinity;
    if (!force && age < PLAN_CHECK_INTERVAL_MS) continue;
    if (i > 0) await sleep(1000);
    await checkAccountPlan(acc);
  }
}

const app = express();
const manager = new AccountManager();

// Check plans on startup (non-blocking)
setTimeout(() => checkAllAccountPlans(true), 2000);
// Re-check every hour
setInterval(() => checkAllAccountPlans(false), PLAN_CHECK_INTERVAL_MS);

app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());

function auth(req, res, next) {
  if (!API_SECRET) return next();
  const key = req.headers["x-api-key"] || req.headers["authorization"]?.replace(/^Bearer\s+/i, "");
  if (key !== API_SECRET) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// ── generateWithRotation — smart routing by plan/credits ─────────────────────
async function generateWithRotation(params) {
  const modelDef = IMAGE_MODELS.find(m => m.id === (params.model || params.mode || 'auto'));
  const needsCredits = modelDef && !modelDef.unlimited;
  const creditCost   = modelDef?.credits || 0;

  // For credit-based models: prefer accounts that have enough credits.
  // If no account has been plan-checked yet (planCheckedAt undefined), include them all.
  let pool = manager.getPool();
  if (needsCredits && creditCost > 0) {
    const creditPool = pool.filter(a =>
      a.planCheckedAt == null ||          // not yet checked — include optimistically
      (a.credits != null && a.credits >= creditCost)
    );
    if (creditPool.length > 0) {
      pool = creditPool;
      addLog('INFO', `Credit model "${params.model}" (${creditCost} credits) — routing to ${pool.map(a=>a.name).join(', ')}`);
    } else {
      addLog('WARN', `Credit model "${params.model}" (${creditCost} credits) — no account has enough credits, trying all`);
    }
  }

  return tryWithRotation(pool, 'image', async acc => {
    addLog("INFO", `Generating — account=${acc.name}`, { prompt: params.prompt?.slice(0, 80) });
    const images = await generateImages(acc, params);
    // Deduct credits optimistically from local counter so next request routes correctly
    if (needsCredits && creditCost > 0 && acc.credits != null) {
      acc.credits = Math.max(0, acc.credits - creditCost);
    }
    return { images, account: acc.name };
  });
}

// ── POST /v1/images/generate ──────────────────────────────────────────────────
app.post("/v1/images/generate", auth, async (req, res) => {
  const { prompt, num_images = 1, aspect_ratio = "1:1", mode = "auto", model, variations = false, folder } = req.body || {};

  if (!prompt?.trim()) {
    return res.status(400).json({ error: "prompt is required" });
  }

  // validate model if provided
  const resolvedModel = model || mode || "auto";
  const modelInfo = IMAGE_MODELS.find(m => m.id === resolvedModel);
  if (resolvedModel !== "auto" && !modelInfo) {
    return res.status(400).json({
      error: `Unknown model "${resolvedModel}". Call GET /v1/models to see available models.`,
    });
  }

  try {
    const _t0 = Date.now();
    const { images, account } = await generateWithRotation({
      prompt,
      num_images: Math.min(Math.max(parseInt(num_images) || 1, 1), 4),
      aspect_ratio,
      model: resolvedModel,
      variations: Boolean(variations),
      folder: folder || null,
    });

    res.json({
      created: Math.floor(Date.now() / 1000),
      processing_time_ms: Date.now() - _t0,
      data: images.map(img => ({
        url: img.url,
        preview_url: img.preview,
        revised_prompt: img.prompt,
        width: img.width,
        height: img.height,
        mode: img.mode,
        seed: img.seed,
        id: img.id,
        family: img.family,
      })),
      account,
    });
  } catch (e) {
    addLog("ERROR", `Generation failed: ${e.message}`);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── POST /v1/images/generations (OpenAI-compatible) ───────────────────────────
app.post("/v1/images/generations", auth, async (req, res) => {
  const { prompt, n = 1, size = "1024x1024" } = req.body || {};

  if (!prompt?.trim()) {
    return res.status(400).json({ error: { message: "prompt is required", type: "invalid_request_error" } });
  }

  const sizeToRatio = {
    "1024x1024": "1:1", "512x512": "1:1", "256x256": "1:1",
    "1792x1024": "16:9", "1024x576": "16:9",
    "1024x1792": "9:16", "576x1024": "9:16",
  };

  try {
    const { images } = await generateWithRotation({
      prompt,
      num_images: Math.min(parseInt(n) || 1, 4),
      aspect_ratio: sizeToRatio[size] || "1:1",
      mode: "auto",
    });
    res.json({
      created: Math.floor(Date.now() / 1000),
      data: images.map(img => ({ url: img.url, revised_prompt: img.prompt })),
    });
  } catch (e) {
    res.status(500).json({ error: { message: e.message, type: "server_error" } });
  }
});

// ── POST /v1/videos/generate ─────────────────────────────────────────────────
app.post("/v1/videos/generate", auth, async (req, res) => {
  const {
    prompt,
    model = "bytedance-seedance-fast-2.0",
    negative_prompt = "",
    aspect_ratio = "16:9",
    duration = 5,
    resolution = "720p",
    sound_effects = true,
    start_image = null,
    end_image = null,
    references = [],
    prompt_mode = "manual",
    folder = null,
  } = req.body || {};

  if (!prompt?.trim()) return res.status(400).json({ error: "prompt is required" });

  const vm = VIDEO_MODELS.find(m => m.id === model);
  if (!vm) {
    return res.status(400).json({
      error: `Unknown video model "${model}". Call GET /v1/models?type=video to see available models.`,
    });
  }

  if (start_image && !vm.sf) return res.status(400).json({ error: `Model "${model}" does not support start_image` });
  if (end_image   && !vm.ef) return res.status(400).json({ error: `Model "${model}" does not support end_image` });
  if (references.length > 0 && !vm.refs) return res.status(400).json({ error: `Model "${model}" does not support references` });

  try {
    const _t0 = Date.now();
    const { video, account } = await generateVideoWithRotation({
      prompt,
      model,
      negative_prompt,
      aspect_ratio,
      duration: Math.min(Math.max(parseInt(duration) || 5, 1), 10),
      resolution,
      sound_effects: Boolean(sound_effects),
      start_image,
      end_image,
      references: Array.isArray(references) ? references : [],
      prompt_mode: prompt_mode === 'auto' ? 'auto' : 'manual',
      folder,
    });

    res.json({
      created: Math.floor(Date.now() / 1000),
      processing_time_ms: Date.now() - _t0,
      data: {
        url: video.url,
        prompt: video.prompt,
        model: video.model,
        slug: video.slug,
        duration: video.duration,
        aspect_ratio: video.aspect_ratio,
        resolution: video.resolution,
        identifier: video.identifier,
        id: video.id,
      },
      account,
    });
  } catch (e) {
    addLog("ERROR", `Video generation failed: ${e.message}`);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── GET /v1/audio/voices ──────────────────────────────────────────────────────
app.get('/v1/audio/voices', auth, async (req, res) => {
  const { provider } = req.query;
  try {
    const acc = await manager.getAccount();
    if (!acc) return res.status(503).json({ error: 'No active accounts' });

    const providers = provider ? [provider] : ['elevenlabs', 'google'];
    const results = {};
    for (const p of providers) {
      try {
        results[p] = await getVoices(acc, p);
      } catch (e) {
        results[p] = { error: e.message };
      }
    }

    if (provider) {
      const voices = results[provider];
      res.json({
        provider,
        voices: Array.isArray(voices) ? voices : [],
        total: Array.isArray(voices) ? voices.length : 0,
        ...(voices?.error ? { error: voices.error } : {}),
      });
    } else {
      res.json({ providers: results });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /v1/audio/voices/:id/preview ─────────────────────────────────────────
// Redirects to the CDN audio sample for a voice (publicly accessible, no auth).
app.get('/v1/audio/voices/:id/preview', auth, async (req, res) => {
  try {
    const acc = await manager.getAccount();
    if (!acc) return res.status(503).json({ error: 'No active accounts' });
    const all = await getAllVoices(acc);
    const voice = all.find(v => String(v.id) === req.params.id || v.provider_id === req.params.id || v.name === req.params.id);
    if (!voice) return res.status(404).json({ error: `Voice "${req.params.id}" not found` });
    if (!voice.example_mp3_url) return res.status(404).json({ error: 'No preview available for this voice' });
    res.json({
      id: voice.id,
      name: voice.name,
      provider: voice.provider,
      preview_url: voice.example_mp3_url,
      preview_image_url: voice.preview_image_url || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /v1/audio/generate ───────────────────────────────────────────────────
app.post('/v1/audio/generate', auth, async (req, res) => {
  const {
    text,
    model = 'eleven_v3',
    voice = null,
    voice_id = null,
    style = 'neutral',
    speed = 1.0,
    temperature = 1.0,
    system_instruction = '',
    folder = null,
  } = req.body || {};

  if (!text?.trim()) return res.status(400).json({ error: 'text is required' });

  const am = AUDIO_MODELS.find(m => m.id === model);
  if (!am) {
    return res.status(400).json({
      error: `Unknown audio model "${model}". Call GET /v1/models?type=audio to see available models.`,
    });
  }

  const validStyles = ['expressive', 'neutral', 'consistent'];
  if (style && !validStyles.includes(style.toLowerCase())) {
    return res.status(400).json({ error: `Invalid style "${style}". Must be one of: ${validStyles.join(', ')}` });
  }

  try {
    const _t0 = Date.now();
    const { audio, account } = await generateAudioWithRotation({
      text: text.trim(),
      model,
      voice: voice || null,
      voice_id: voice_id || null,
      style: style || 'neutral',
      speed: parseFloat(speed) || 1.0,
      temperature: parseFloat(temperature) || 1.0,
      system_instruction: system_instruction || '',
      folder: folder || null,
    });

    res.json({
      created: Math.floor(Date.now() / 1000),
      processing_time_ms: Date.now() - _t0,
      data: {
        url: audio.url,
        text: audio.text,
        model: audio.model,
        voice: audio.voice,
        voice_id: audio.voice_id,
        duration: audio.duration,
        identifier: audio.identifier,
        id: audio.id,
      },
      account,
    });
  } catch (e) {
    addLog('ERROR', `Audio generation failed: ${e.message}`);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── POST /v1/images/describe ──────────────────────────────────────────────────
// Describe an image — returns AI-generated description + style.
// Accepts image_url (public URL) or image_data (base64 data URL).
// Returns: { description, style, uses_left, account }
app.post('/v1/images/describe', auth, async (req, res) => {
  const { image_url, image_data } = req.body || {};
  const imageSource = image_data || image_url;
  if (!imageSource)
    return res.status(400).json({ error: 'image_url or image_data is required' });
  if (image_data && !image_data.startsWith('data:'))
    return res.status(400).json({ error: 'image_data must be a base64 data URL (data:image/...;base64,...)' });
  try {
    const { result, account } = await describeImageWithRotation(imageSource);
    res.json({ ...result, account });
  } catch (e) {
    addLog('ERROR', `Describe failed: ${e.message}`);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── POST /v1/images/remove-background ────────────────────────────────────────
// Remove the background from an image. Accepts image_url or image_data (base64).
// Returns: { result_b64: "data:image/png;base64,...", account }
app.post('/v1/images/remove-background', auth, async (req, res) => {
  const { image_url, image_data } = req.body || {};
  const imageSource = image_data || image_url;
  if (!imageSource) {
    return res.status(400).json({ error: 'image_url or image_data is required' });
  }
  if (image_data && !image_data.startsWith('data:')) {
    return res.status(400).json({ error: 'image_data must be a base64 data URL (data:image/...;base64,...)' });
  }
  try {
    const { result: result_b64, account } = await removeBackgroundWithRotation(imageSource);
    res.json({ result_b64, account });
  } catch (e) {
    addLog('ERROR', `BG remove failed: ${e.message}`);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── POST /v1/images/upscale ───────────────────────────────────────────────────
// ── POST /v1/upload ───────────────────────────────────────────────────────────
// Upload an image to Magnific and get back a creation_id for use with /v1/images/upscale.
// Body: { image_data: "data:image/jpeg;base64,..." }  (base64 data URL from FileReader)
app.post('/v1/upload', auth, async (req, res) => {
  const { image_data } = req.body || {};
  if (!image_data?.startsWith('data:')) {
    return res.status(400).json({ error: 'image_data must be a base64 data URL (data:image/...;base64,...)' });
  }
  try {
    const pool = manager.getPool();
    console.log('UPLOAD pool type:', typeof pool, Array.isArray(pool), pool?.length);
    const { result: creation_id, account } = await tryWithRotation(pool, 'upload', async acc => {
      await refreshSession(acc, 'image-upscaler');
      const result = await uploadImageForUpscale(acc, image_data);
      return { result, account: acc.name };
    });
    res.json({ creation_id, account });
  } catch (e) {
    console.error('UPLOAD ERROR:', e.message, e.stack);
    addLog('ERROR', `Upload failed: ${e.message}`);
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/v1/images/upscale', auth, async (req, res) => {
  const {
    image_url,
    creation_id   = null,
    mode          = 'creative',
    model         = 'magnific',
    preset        = 'subtle',
    scale         = 2,
    optimized_for = 'StandardUltra',
    creativity    = -3,
    hdr           = 0,
    resemblance   = 3,
    fractality    = 0,
    engine        = 'automatic',
    prompt        = '',
    folder        = null,
  } = req.body || {};

  if (!image_url?.trim() && !creation_id?.trim()) {
    return res.status(400).json({ error: 'image_url or creation_id is required' });
  }

  const validModes   = ['creative', 'precision'];
  const validModels  = ['classic', 'magnific'];
  const validEngines = ['automatic', 'illusio', 'sharpy', 'sparkle'];
  const validScales  = [2, 4, 8];

  if (!validModes.includes(mode))    return res.status(400).json({ error: `Invalid mode "${mode}". Must be: ${validModes.join(', ')}` });
  if (!validModels.includes(model))  return res.status(400).json({ error: `Invalid model "${model}". Must be: ${validModels.join(', ')}` });
  if (!validEngines.includes(engine))return res.status(400).json({ error: `Invalid engine "${engine}". Must be: ${validEngines.join(', ')}` });
  if (!validScales.includes(Number(scale))) return res.status(400).json({ error: `Invalid scale "${scale}". Must be: ${validScales.join(', ')}` });

  try {
    const { result, account } = await upscaleWithRotation({
      image_url:    image_url?.trim() || null,
      creation_id:  creation_id?.trim() || null,
      mode,
      model,
      preset:       preset || 'upscale',
      scale:        Number(scale),
      optimized_for,
      creativity:   Math.max(-10, Math.min(10, Number(creativity) || -3)),
      hdr:          Math.max(-10, Math.min(10, Number(hdr)        || 0)),
      resemblance:  Math.max(-10, Math.min(10, Number(resemblance)|| 3)),
      fractality:   Math.max(-10, Math.min(10, Number(fractality) || 0)),
      engine,
      prompt:       prompt || '',
      folder:       folder || null,
    });

    res.json({
      created: Math.floor(Date.now() / 1000),
      data: {
        url:     result.url,
        preview_url: result.preview,
        width:   result.width,
        height:  result.height,
        scale:   result.scale,
        mode:    result.mode,
        model:   result.model,
        engine:  result.engine,
        preset:  result.preset,
        id:      result.id,
        family:  result.family,
      },
      account,
    });
  } catch (e) {
    addLog('ERROR', `Upscale failed: ${e.message}`);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── GET /v1/models ────────────────────────────────────────────────────────────
app.get("/v1/models", (req, res) => {
  const { type = "all" } = req.query;

  if (type === "audio") {
    return res.json({
      object: "list",
      data: AUDIO_MODELS.map(m => ({
        id: m.id,
        name: m.name,
        type: "audio",
        provider: m.provider,
        credits: m.credits,
        styles: ["expressive", "neutral", "consistent"],
      })),
      total: AUDIO_MODELS.length,
    });
  }

  if (type === "video") {
    return res.json({
      object: "list",
      data: VIDEO_MODELS.map(m => ({
        id: m.id,
        name: m.name,
        type: "video",
        unlimited: m.unlimited || false,
        credits: m.credits,
        features: {
          start_image: m.sf || false,
          end_image:   m.ef || false,
          references:  m.refs || false,
        },
      })),
      total: VIDEO_MODELS.length,
    });
  }

  let models = IMAGE_MODELS;
  if (type === "unlimited") models = IMAGE_MODELS.filter(m => m.unlimited);
  if (type === "credits")   models = IMAGE_MODELS.filter(m => !m.unlimited);
  res.json({
    object: "list",
    data: models.map(m => ({
      id: m.id,
      name: m.name,
      type: "image",
      unlimited: m.unlimited,
      credits: m.credits || null,
      note: m.note || null,
    })),
    total: models.length,
    unlimited_count: IMAGE_MODELS.filter(m => m.unlimited).length,
    credits_count: IMAGE_MODELS.filter(m => !m.unlimited).length,
  });
});

// ── GET /health ───────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  const accounts = manager.accounts.map(a => ({
    name: a.name,
    userId: a.userId,
    status: a.status,
    tokenExpiry:  a.grTokenExpiry ? new Date(a.grTokenExpiry).toISOString() : null,
    slots_active: a.semaphore?.active ?? 0,
    slots_total:  a.semaphore?.slots  ?? SLOTS_PER_ACCOUNT,
    slots_queued: a.semaphore?.queued ?? 0,
    plan:         a.plan        || null,
    planStatus:   a.planStatus  || null,
    isPremium:    a.isPremium   ?? null,
    credits:      a.credits     ?? null,
    creditsTotal: a.creditsTotal ?? null,
    planExpiry:   a.planExpiry  || null,
    planCheckedAt: a.planCheckedAt ? new Date(a.planCheckedAt).toISOString() : null,
  }));
  const activeAccounts = accounts.filter(a => a.status === 'active');
  res.json({
    status: "ok",
    accounts,
    total: accounts.length,
    active: activeAccounts.length,
    capacity: {
      slots_per_account: SLOTS_PER_ACCOUNT,
      total_slots: manager.totalCapacity,
      in_use: activeAccounts.reduce((s, a) => s + a.slots_active, 0),
      queued: activeAccounts.reduce((s, a) => s + a.slots_queued, 0),
    },
  });
});

// ── GET /v1/accounts/plans ────────────────────────────────────────────────────
app.get('/v1/accounts/plans', auth, (req, res) => {
  res.json(manager.accounts.map(a => ({
    name:         a.name,
    email:        a.email || a.name,
    status:       a.status,
    plan:         a.plan        || null,
    planStatus:   a.planStatus  || null,
    isPremium:    a.isPremium   ?? null,
    isTrial:      a.isTrial     ?? null,
    isTeam:       a.isTeam      ?? null,
    credits:      a.credits     ?? null,
    creditsTotal: a.creditsTotal ?? null,
    creditsUsed:  a.creditsUsed  ?? null,
    creditsAddons: a.creditsAddons ?? null,
    autoRefill:   a.autoRefill  ?? null,
    planExpiry:   a.planExpiry  || null,
    planFrequency: a.planFrequency || null,
    purchaseStatus: a.purchaseStatus || null,
    planCheckedAt: a.planCheckedAt ? new Date(a.planCheckedAt).toISOString() : null,
  })));
});

// ── POST /v1/accounts/plans/refresh ──────────────────────────────────────────
app.post('/v1/accounts/plans/refresh', auth, async (req, res) => {
  checkAllAccountPlans(true).catch(() => {});
  res.json({ ok: true, message: 'Plan refresh started for all active accounts' });
});

// ── GET /logs ─────────────────────────────────────────────────────────────────
app.get("/logs", (req, res) => {
  res.json(logs.slice(0, 100));
});

// ── GET /admin/login ──────────────────────────────────────────────────────────
app.get("/admin/login", (req, res) => {
  const next = req.query.next || "/admin";
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Admin Login — Magnific API</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#0a0a0a;color:#eee;display:flex;align-items:center;justify-content:center;min-height:100vh}
    .card{background:#141414;border:1px solid #262626;border-radius:14px;padding:36px;width:340px}
    h1{font-size:22px;margin-bottom:4px}p{color:#888;font-size:13px;margin-bottom:24px}
    label{display:block;font-size:12px;color:#999;margin-bottom:6px}
    input{width:100%;background:#0f0f0f;color:#eee;border:1px solid #333;border-radius:8px;padding:12px 14px;font-size:22px;letter-spacing:6px;text-align:center;font-family:monospace;margin-bottom:16px}
    input:focus{outline:none;border-color:#3b82f6}
    button{width:100%;background:#3b82f6;color:#fff;border:none;border-radius:8px;padding:12px;font-size:15px;cursor:pointer;font-weight:600}
    button:hover{background:#2563eb}
    .err{color:#f87171;font-size:13px;margin-top:10px;text-align:center}
    .info{color:#888;font-size:12px;margin-top:14px;text-align:center}
  </style>
</head>
<body>
  <div class="card">
    <h1>🔐 Admin Login</h1>
    <p>Enter the 6-digit code from Google Authenticator</p>
    <form method="POST" action="/admin/login">
      <input type="hidden" name="next" value="${next}">
      <label>Authenticator Code</label>
      <input type="text" name="code" maxlength="6" pattern="[0-9]{6}" autocomplete="one-time-code" autofocus placeholder="000000">
      <button type="submit">Sign In</button>
      ${req.query.err ? `<div class="err">Invalid code — try again</div>` : ""}
    </form>
    <div class="info">Code changes every 30 seconds</div>
  </div>
</body>
</html>`);
});

app.post("/admin/login", express.urlencoded({ extended: false }), (req, res) => {
  const { code, next = "/admin" } = req.body || {};
  if (verifyTOTP(code)) {
    const token = createAdminSession();
    res.cookie("admin_session", token, { httpOnly: true, maxAge: ADMIN_SESSION_TTL, sameSite: "lax" });
    return res.redirect(next);
  }
  res.redirect("/admin/login?err=1&next=" + encodeURIComponent(next));
});

app.get("/admin/logout", (req, res) => {
  const token = req.cookies?.admin_session;
  if (token) adminSessions.delete(token);
  res.clearCookie("admin_session");
  res.redirect("/admin/login");
});

// ── GET /admin/export-accounts ─────────────────────────────────────────────────
app.get("/admin/export-accounts", adminAuthMiddleware, (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", "attachment; filename=accounts.json");
  res.send(exportAccountsJSON());
});

// ── GET /admin ─────────────────────────────────────────────────────────────────
app.get("/admin", adminAuthMiddleware, (req, res) => {
  const accounts = manager.accounts.map(a => ({
    name:         a.name,
    email:        a.email || a.name,
    userId:       a.userId,
    status:       a.status,
    tokenExpiry:  a.grTokenExpiry ? new Date(a.grTokenExpiry).toISOString() : "unknown",
    slotsActive:  a.semaphore?.active ?? 0,
    slotsTotal:   a.semaphore?.slots  ?? SLOTS_PER_ACCOUNT,
    slotsQueued:  a.semaphore?.queued ?? 0,
    plan:         a.plan        || null,
    planStatus:   a.planStatus  || null,
    isPremium:    a.isPremium   ?? null,
    isTrial:      a.isTrial     ?? null,
    isTeam:       a.isTeam      ?? null,
    credits:      a.credits     ?? null,
    creditsTotal: a.creditsTotal ?? null,
    creditsUsed:  a.creditsUsed  ?? null,
    creditsAddons: a.creditsAddons ?? null,
    planExpiry:   a.planExpiry  || null,
    video:        a.video       || false,
    planCheckedAt: a.planCheckedAt ? new Date(a.planCheckedAt).toISOString().slice(0,16).replace('T',' ') : null,
  }));
  const activeCount  = accounts.filter(a => a.status === 'active').length;
  const totalSlots   = activeCount * SLOTS_PER_ACCOUNT;
  const inUseSlots   = accounts.reduce((s, a) => s + a.slotsActive, 0);
  const queuedReqs   = accounts.reduce((s, a) => s + a.slotsQueued, 0);
  const storageMode  = USING_ENV_ACCOUNTS ? "ACCOUNTS_JSON env var" : "accounts/ folder (local files)";

  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Admin — Magnific API</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    *{box-sizing:border-box}
    body{font-family:system-ui,sans-serif;max-width:900px;margin:0 auto;padding:20px;background:#0a0a0a;color:#eee}
    h1{color:#fff;margin:0 0 2px 0;font-size:24px}
    h2{color:#ccc;margin:0 0 14px 0;font-size:15px;font-weight:600}
    .card{background:#141414;border:1px solid #222;border-radius:12px;padding:20px;margin:14px 0}
    .row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
    .meta{color:#666;font-size:12px;margin:2px 0;font-family:monospace}
    .badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700}
    .active{background:#14532d;color:#4ade80}.inactive{background:#292000;color:#facc15}
    .expired{background:#450a0a;color:#f87171}
    label{display:block;margin-bottom:5px;color:#999;font-size:12px}
    input,textarea,select{width:100%;background:#0f0f0f;color:#eee;border:1px solid #2a2a2a;border-radius:7px;padding:9px 12px;font-family:monospace;font-size:12px;margin-bottom:10px}
    textarea{resize:vertical}
    select{font-size:13px}
    input:focus,textarea:focus,select:focus{outline:none;border-color:#3b82f6}
    .btn{background:#3b82f6;color:#fff;border:none;border-radius:7px;padding:8px 16px;cursor:pointer;font-size:13px;font-weight:600}
    .btn:hover{background:#2563eb}
    .btn-sm{padding:5px 12px;font-size:11px}
    .btn-gray{background:#1f1f1f;border:1px solid #333;color:#ccc}.btn-gray:hover{background:#2a2a2a}
    .btn-danger{background:#7f1d1d;color:#fca5a5;border:1px solid #991b1b}.btn-danger:hover{background:#991b1b}
    .btn-warn{background:#422006;color:#fde68a;border:1px solid #78350f}.btn-warn:hover{background:#78350f}
    .btn-green{background:#14532d;color:#4ade80;border:1px solid #166534}.btn-green:hover{background:#166534}
    #toast{position:fixed;bottom:20px;right:20px;padding:12px 20px;border-radius:9px;font-size:13px;font-weight:600;display:none;z-index:999;max-width:320px}
    .toast-ok{background:#14532d;color:#4ade80}.toast-err{background:#450a0a;color:#f87171}
    .stat{text-align:center}
    .stat-val{font-size:26px;font-weight:700}
    .stat-lbl{font-size:10px;color:#666;margin-top:2px;text-transform:uppercase;letter-spacing:.05em}
    .log-line{font-family:monospace;font-size:11px;padding:3px 0;border-bottom:1px solid #1a1a1a}
    .log-INFO{color:#60a5fa}.log-WARN{color:#fbbf24}.log-ERROR{color:#f87171}
    audio,video{width:100%;border-radius:7px;border:1px solid #222;margin-top:5px}
    #testResult img{border-radius:7px;border:1px solid #222;margin-top:7px;max-width:300px}
    input[type=range]{accent-color:#3b82f6;cursor:pointer}
    .dl{color:#60a5fa;font-size:11px;display:inline-block;margin-top:5px}
    nav{display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap;align-items:center}
    nav a{color:#60a5fa;text-decoration:none;font-size:13px;padding:5px 10px;border-radius:6px;background:#0f1826;border:1px solid #1a3a5c}
    nav a:hover{background:#1a3a5c}
    .storage-badge{font-size:11px;padding:3px 8px;border-radius:5px;background:#1a1a00;color:#facc15;border:1px solid #3a3a00}
    .acc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-top:10px}
    .acc-card{background:#0f0f0f;border:1px solid #222;border-radius:9px;padding:14px}
    .acc-name{font-size:14px;font-weight:600;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .acc-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
    .plan-premium{color:#4ade80}.plan-expired{color:#f87171}.plan-free{color:#facc15}
    .cr-green{color:#4ade80}.cr-yellow{color:#facc15}.cr-red{color:#f87171}
  </style>
</head>
<body>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px">
    <div>
      <h1>Magnific API Admin</h1>
      <div style="color:#555;font-size:12px;margin-top:2px">Storage: <span class="storage-badge">${storageMode}</span></div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span id="syncBadge" style="font-size:11px;padding:3px 8px;border-radius:5px;background:#0f1a0f;color:#4ade80;border:1px solid #166534;display:none">✓ Synced</span>
      <button class="btn btn-sm btn-green" onclick="syncAccounts(this)">↑ Sync to Render</button>
      <a href="/docs" class="btn btn-sm btn-gray" target="_blank">Docs</a>
      <a href="/admin/export-accounts" class="btn btn-sm btn-gray" download>Export JSON</a>
      <a href="/admin/logout" class="btn btn-sm btn-danger">Logout</a>
    </div>
  </div>

  <!-- Capacity stats -->
  <div class="card">
    <div style="display:flex;gap:0;justify-content:space-around;flex-wrap:wrap;margin-bottom:14px">
      <div class="stat"><div class="stat-val" style="color:#4ade80">${activeCount}</div><div class="stat-lbl">Active Accounts</div></div>
      <div class="stat"><div class="stat-val" style="color:#60a5fa">${totalSlots}</div><div class="stat-lbl">Total Slots</div></div>
      <div class="stat"><div class="stat-val" style="color:${inUseSlots>0?'#facc15':'#4ade80'}">${inUseSlots}</div><div class="stat-lbl">In Use</div></div>
      <div class="stat"><div class="stat-val" style="color:${queuedReqs>0?'#f87171':'#4ade80'}">${queuedReqs}</div><div class="stat-lbl">Queued</div></div>
      <div class="stat"><div class="stat-val" style="color:#a78bfa">${accounts.length}</div><div class="stat-lbl">Total Accounts</div></div>
    </div>
    <div style="background:#1a1a1a;border-radius:5px;height:8px;overflow:hidden">
      <div style="background:#4ade80;height:100%;width:${totalSlots?Math.round(inUseSlots/totalSlots*100):0}%;transition:width .3s"></div>
    </div>
    <div style="font-size:11px;color:#555;margin-top:5px;text-align:right">${inUseSlots}/${totalSlots} slots · ${SLOTS_PER_ACCOUNT} per account · add accounts to scale</div>
  </div>

  <!-- Accounts -->
  <div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <h2 style="margin:0">Accounts (${accounts.length})</h2>
      <button class="btn btn-sm" onclick="refreshPlans(this)">↻ Refresh Plans</button>
    </div>
    ${accounts.length===0 ? '<p style="color:#555">No accounts. Add one below.</p>' :
    `<div class="acc-grid">${accounts.map(a => `
      <div class="acc-card">
        <div class="acc-name" title="${a.email}">${a.email}</div>
        <div class="meta">uid: ${a.userId||'—'}${a.video?' · 📹 video':''}</div>
        <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap">
          <div>
            <div style="font-size:9px;color:#555;margin-bottom:1px">STATUS</div>
            <span class="badge ${a.status}">${a.status}</span>
          </div>
          <div>
            <div style="font-size:9px;color:#555;margin-bottom:1px">PLAN</div>
            <div style="font-size:12px;font-weight:600" class="plan-${a.planStatus||'unknown'}">${a.plan||(a.planCheckedAt?'—':'…')}${a.isTrial?' 🆕':''}</div>
            ${a.planExpiry?`<div style="font-size:9px;color:#555">↻ ${a.planExpiry}</div>`:''}
          </div>
          ${a.credits!=null?`<div>
            <div style="font-size:9px;color:#555;margin-bottom:1px">CREDITS</div>
            <div style="font-size:12px;font-weight:600" class="${a.credits<100?'cr-red':a.credits<1000?'cr-yellow':'cr-green'}">${Number(a.credits).toLocaleString()}</div>
            <div style="font-size:9px;color:#555">${Number(a.creditsUsed||0).toLocaleString()} used</div>
          </div>`:''}
          <div>
            <div style="font-size:9px;color:#555;margin-bottom:1px">SLOTS</div>
            <div style="font-size:12px;color:${a.slotsActive>0?'#facc15':'#4ade80'}">${a.slotsActive}/${a.slotsTotal}</div>
            ${a.planCheckedAt?`<div style="font-size:9px;color:#444">${a.planCheckedAt}</div>`:''}
          </div>
        </div>
        <div class="acc-actions">
          <button class="btn btn-sm btn-gray" onclick="checkAccount('${encodeURIComponent(a.name)}',this)">Check</button>
          <button class="btn btn-sm btn-warn" onclick="toggleAccount('${encodeURIComponent(a.name)}',this)">${a.status==='active'?'Disable':'Enable'}</button>
          <button class="btn btn-sm btn-green" onclick="toggleEditAccount('${encodeURIComponent(a.name)}')">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="removeAccount('${encodeURIComponent(a.name)}')">Remove</button>
        </div>
        <div id="edit-${encodeURIComponent(a.name)}" style="display:none;margin-top:10px;padding:10px;background:#0a0a0a;border:1px solid #2a2a2a;border-radius:7px">
          <div style="font-size:11px;color:#666;margin-bottom:8px">Edit account settings (applied immediately + synced to Render)</div>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:8px;font-size:12px;color:#ccc">
            <input type="checkbox" id="edit-video-${encodeURIComponent(a.name)}" ${a.video?'checked':''} style="width:14px;height:14px;margin:0;accent-color:#3b82f6">
            Video-capable account (enables video generation for this account)
          </label>
          <button class="btn btn-sm" onclick="saveAccount('${encodeURIComponent(a.name)}')">Save Changes</button>
          <span id="edit-result-${encodeURIComponent(a.name)}" style="font-size:11px;margin-left:8px"></span>
        </div>
      </div>`).join('')}
    </div>`}
  </div>

  <!-- Add Account -->
  <div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <h2 style="margin:0">Add Account</h2>
      <div style="display:flex;gap:6px">
        <button id="tabCookie" class="btn btn-sm" onclick="setAddTab('cookie')" style="background:#3b82f6">Cookie / Netscape</button>
        <button id="tabJson" class="btn btn-sm btn-gray" onclick="setAddTab('json')">JSON Format</button>
      </div>
    </div>

    <!-- Cookie/Netscape tab -->
    <div id="addTabCookie">
      <label>Paste cookie string or Netscape format — email &amp; user ID are auto-detected from cookies</label>
      <textarea id="cookies" rows="5" oninput="autoDetectFromCookies(this.value)" placeholder="magnific_session=...; GR_REFRESH=...; GR_TOKEN=...; UID=...; XSRF-TOKEN=...

─ OR Netscape format (EditThisCookie / Cookie-Editor export) ─
# Netscape HTTP Cookie File
.magnific.com	TRUE	/	FALSE	1234567890	magnific_session	abc123...
.magnific.com	TRUE	/	FALSE	1234567890	XSRF-TOKEN	eyJ..."></textarea>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <div style="flex:1;min-width:140px">
          <label>Email / Name <span style="color:#555;font-size:10px">(auto-detected)</span></label>
          <input type="text" id="accName" placeholder="auto-detected from GR_TOKEN">
        </div>
        <div style="flex:1;min-width:100px">
          <label>User ID <span style="color:#555;font-size:10px">(auto-detected)</span></label>
          <input type="text" id="userId" placeholder="auto-detected from UID cookie">
        </div>
        <div style="flex:1;min-width:160px">
          <label>Folder Reference <span style="color:#555;font-size:10px">(optional)</span></label>
          <input type="text" id="folderRef" placeholder="a17a3809-...">
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:6px;color:#aaa;font-size:12px;cursor:pointer;margin:0">
          <input type="checkbox" id="videoEnabled" style="width:15px;height:15px;margin:0"> Video-capable account
        </label>
        <button class="btn" onclick="addAccount('cookie')">Add Account</button>
      </div>
    </div>

    <!-- JSON tab -->
    <div id="addTabJson" style="display:none">
      <label>Paste a single account JSON object or an array of objects — supports bulk import</label>
      <textarea id="jsonInput" rows="8" placeholder='Single account:
{
  "name": "user@gmail.com",
  "userId": "8837992",
  "folderRef": "a17a3809-...",
  "cookieString": "magnific_session=...; GR_REFRESH=...; GR_TOKEN=...; UID=...; XSRF-TOKEN=...",
  "video": false
}

Bulk (array of objects):
[{"name":"acc1@gmail.com","cookieString":"..."},{"name":"acc2@gmail.com","cookieString":"..."}]'></textarea>
      <button class="btn" onclick="addAccount('json')">Add from JSON</button>
    </div>

    <div id="addResult" style="margin-top:8px;font-size:12px"></div>
    ${RENDER_API_KEY ? `<div style="margin-top:8px;padding:7px 11px;background:#0f1a0f;border:1px solid #166534;border-radius:6px;font-size:11px;color:#4ade80">
      ✓ Render auto-sync enabled — accounts are saved to env var automatically on add/remove
    </div>` : `<div style="margin-top:8px;padding:7px 11px;background:#1a1a00;border:1px solid #3a3a00;border-radius:6px;font-size:11px;color:#facc15">
      ⚠️ Set RENDER_API_KEY + RENDER_SERVICE_ID env vars to enable auto-sync (or use Export JSON button manually)
    </div>`}
  </div>

  <!-- Logs -->
  <div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <h2 style="margin:0">Live Logs</h2>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-sm btn-gray" onclick="loadLogs()">↻ Refresh</button>
        <button class="btn btn-sm btn-gray" onclick="toggleAutoRefresh(this)" id="autoRefBtn">Auto ▶</button>
        <button class="btn btn-sm btn-gray" onclick="copyLogs(this)">⎘ Copy All</button>
      </div>
    </div>
    <div id="logsBox" style="max-height:280px;overflow-y:auto;font-family:monospace;font-size:11px">Loading…</div>
  </div>

  <!-- Test Image -->
  <div class="card">
    <h2>Test Image Generation</h2>
    <input type="text" id="testPrompt" placeholder="a red apple on a wooden table, soft light">
    <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <select id="testRatio">
        <option value="1:1">1:1 Square</option>
        <option value="16:9">16:9</option>
        <option value="9:16">9:16 Portrait</option>
        <option value="4:3">4:3</option>
        <option value="3:4">3:4</option>
        <option value="3:2">3:2</option>
        <option value="2:3">2:3</option>
      </select>
      <select id="testModel">
        ${IMAGE_MODELS.map(m=>`<option value="${m.id}">${m.name}${m.unlimited?' ♾️':` (${m.credits}cr)`}</option>`).join('')}
      </select>
      <select id="testCount">
        <option value="1">1 image</option>
        <option value="2">2 images</option>
        <option value="4">4 images</option>
      </select>
    </div>
    <label style="display:flex;align-items:center;gap:6px;color:#aaa;font-size:12px;cursor:pointer;margin-bottom:10px">
      <input type="checkbox" id="testVariations" style="width:14px;height:14px"> Variations
    </label>
    <button class="btn" onclick="testGenerate()">Generate Image</button>
    <div id="testResult" style="margin-top:10px;color:#888;font-size:13px"></div>
  </div>

  <!-- Test Video -->
  <div class="card">
    <h2>Test Video Generation</h2>
    <textarea id="vidPrompt" rows="3" placeholder="a golden retriever running on a beach at sunset"></textarea>
    <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <select id="vidModel" style="flex:2;min-width:200px">
        ${VIDEO_MODELS.map(m=>`<option value="${m.id}">${m.name}${m.unlimited?' ♾️':` (${m.credits}cr)`}</option>`).join('')}
      </select>
      <select id="vidRatio">
        <option value="16:9">16:9</option>
        <option value="9:16">9:16</option>
        <option value="1:1">1:1</option>
      </select>
      <select id="vidDur">
        <option value="5">5s</option>
        <option value="3">3s</option>
        <option value="8">8s</option>
        <option value="10">10s</option>
      </select>
      <select id="vidRes">
        <option value="720p">720p</option>
        <option value="1080p">1080p</option>
      </select>
    </div>
    <label style="display:flex;align-items:center;gap:6px;color:#aaa;font-size:12px;cursor:pointer;margin-bottom:10px">
      <input type="checkbox" id="vidSound" checked style="width:14px;height:14px"> Sound effects
    </label>
    <button class="btn" onclick="testVideo()">Generate Video</button>
    <div id="vidResult" style="margin-top:10px;color:#888;font-size:13px"></div>
  </div>

  <!-- Test Audio -->
  <div class="card">
    <h2>Test Voice Generation</h2>
    <textarea id="audioText" rows="3" placeholder="Hello! This is a test of the Magnific voice API."></textarea>
    <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
      <select id="audioModel" onchange="onModelChange()" style="flex:2;min-width:180px">
        ${AUDIO_MODELS.map(m=>`<option value="${m.id}">${m.name} (${m.provider})</option>`).join('')}
      </select>
      <select id="audioStyle">
        <option value="neutral">Neutral</option>
        <option value="expressive">Expressive</option>
        <option value="consistent">Consistent</option>
      </select>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
      <select id="vGender" onchange="filterVoices()"><option value="">All genders</option><option value="male">Male</option><option value="female">Female</option></select>
      <select id="vAge" onchange="filterVoices()"><option value="">All ages</option><option value="young">Young</option><option value="middle_aged">Middle aged</option><option value="old">Old</option></select>
      <select id="vAccent" onchange="filterVoices()"><option value="">All accents</option></select>
      <input type="text" id="vSearch" placeholder="Search voice…" oninput="filterVoices()" style="flex:1;min-width:120px;margin:0">
    </div>
    <div style="display:flex;gap:8px;margin-bottom:6px;align-items:center">
      <select id="vSelect" onchange="updateVoicePreview()" style="flex:1"><option value="">— Load voices first —</option></select>
      <button class="btn btn-sm btn-gray" onclick="loadVoices(this)" style="white-space:nowrap">Load Voices</button>
    </div>
    <div id="voicePreviewBox" style="margin-bottom:8px"></div>
    <div id="speedRow" style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
      <label style="color:#aaa;font-size:12px;white-space:nowrap;margin:0">Speed: <span id="speedVal">1.0</span>×</label>
      <input type="range" id="audioSpeed" min="0.5" max="2.0" step="0.1" value="1.0" oninput="document.getElementById('speedVal').textContent=parseFloat(this.value).toFixed(1)" style="flex:1;margin:0">
    </div>
    <div id="tempRow" style="display:none;gap:8px;align-items:center;margin-bottom:10px">
      <label style="color:#aaa;font-size:12px;white-space:nowrap;margin:0">Temperature: <span id="tempVal">1.0</span></label>
      <input type="range" id="audioTemp" min="0.0" max="2.0" step="0.1" value="1.0" oninput="document.getElementById('tempVal').textContent=parseFloat(this.value).toFixed(1)" style="flex:1;margin:0">
    </div>
    <button class="btn" onclick="testAudio()">Generate Audio</button>
    <div id="audioResult" style="margin-top:10px;color:#888;font-size:13px"></div>
  </div>

  <!-- Test Upscale -->
  <div class="card">
    <h2>Test Image Upscaler</h2>
    <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;flex-wrap:wrap">
      <label style="color:#aaa;font-size:13px;white-space:nowrap">Image source:</label>
      <input type="text" id="upscaleUrl" placeholder="https://... (image URL)" style="flex:1;min-width:200px;margin:0">
      <span style="color:#555;font-size:13px">or</span>
      <label style="background:#2563eb;color:#fff;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px;white-space:nowrap">
        📁 Pick file
        <input type="file" id="upscaleFile" accept="image/*" style="display:none" onchange="onUpscaleFileChange(this)">
      </label>
    </div>
    <div id="upscaleFilePreview" style="display:none;margin-bottom:8px;padding:8px;background:#111;border-radius:6px;font-size:12px;color:#4ade80"></div>
    <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <select id="upscaleMode">
        <option value="creative">Creative</option>
        <option value="precision">Precision</option>
      </select>
      <select id="upscaleModel">
        <option value="magnific">Magnific</option>
        <option value="classic">Classic</option>
      </select>
      <select id="upscaleScale">
        <option value="2">2×</option>
        <option value="4">4×</option>
        <option value="8">8×</option>
      </select>
      <select id="upscaleEngine">
        <option value="automatic">Engine: Automatic</option>
        <option value="illusio">Illusio</option>
        <option value="sharpy">Sharpy</option>
        <option value="sparkle">Sparkle</option>
      </select>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      <div>
        <label style="margin-bottom:3px">Creativity: <span id="upCreatVal">-3</span></label>
        <input type="range" id="upCreat" min="-10" max="10" step="1" value="-3" oninput="document.getElementById('upCreatVal').textContent=this.value" style="margin:0">
      </div>
      <div>
        <label style="margin-bottom:3px">HDR: <span id="upHdrVal">0</span></label>
        <input type="range" id="upHdr" min="-10" max="10" step="1" value="0" oninput="document.getElementById('upHdrVal').textContent=this.value" style="margin:0">
      </div>
      <div>
        <label style="margin-bottom:3px">Resemblance: <span id="upResVal">3</span></label>
        <input type="range" id="upRes" min="-10" max="10" step="1" value="3" oninput="document.getElementById('upResVal').textContent=this.value" style="margin:0">
      </div>
      <div>
        <label style="margin-bottom:3px">Fractality: <span id="upFracVal">0</span></label>
        <input type="range" id="upFrac" min="-10" max="10" step="1" value="0" oninput="document.getElementById('upFracVal').textContent=this.value" style="margin:0">
      </div>
    </div>
    <input type="text" id="upscalePrompt" placeholder="Describe your image for better results (optional)" style="margin-bottom:10px">
    <button class="btn" onclick="testUpscale()">Upscale Image</button>
    <div id="upscaleResult" style="margin-top:10px;color:#888;font-size:13px"></div>
  </div>

  <div class="card">
    <h2>Remove Background</h2>
    <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;flex-wrap:wrap">
      <input type="text" id="bgUrl" placeholder="https://... (image URL)" style="flex:1;min-width:200px;margin:0">
      <span style="color:#555;font-size:13px">or</span>
      <label style="background:#2563eb;color:#fff;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px;white-space:nowrap">
        📁 Pick file
        <input type="file" id="bgFile" accept="image/*" style="display:none" onchange="onBgFileChange(this)">
      </label>
    </div>
    <div id="bgFilePreview" style="display:none;margin-bottom:8px;padding:8px;background:#111;border-radius:6px;font-size:12px;color:#4ade80"></div>
    <button class="btn" onclick="testRemoveBg()">Remove Background</button>
    <div id="bgResult" style="margin-top:10px;color:#888;font-size:13px"></div>
  </div>

  <div id="toast"></div>

  <script>
    function toast(text, ok=true) {
      const el = document.getElementById('toast');
      el.className = ok ? 'toast-ok' : 'toast-err';
      el.style.display = 'block';
      el.textContent = text;
      clearTimeout(el._t);
      el._t = setTimeout(() => el.style.display='none', 4000);
    }

    // ── Accounts ───────────────────────────────────────────────────────────────
    function setAddTab(tab) {
      document.getElementById('addTabCookie').style.display = tab==='cookie' ? '' : 'none';
      document.getElementById('addTabJson').style.display   = tab==='json'   ? '' : 'none';
      document.getElementById('tabCookie').className = 'btn btn-sm ' + (tab==='cookie' ? '' : 'btn-gray');
      document.getElementById('tabJson').className   = 'btn btn-sm ' + (tab==='json'   ? '' : 'btn-gray');
    }

    async function addAccount(tab) {
      const resEl = document.getElementById('addResult');
      resEl.innerHTML = '⏳ Adding…';
      let body;
      if (tab === 'json') {
        const jsonInput = document.getElementById('jsonInput').value.trim();
        if (!jsonInput) { resEl.innerHTML = '<span style="color:#f87171">Paste JSON first</span>'; return; }
        body = { json_data: jsonInput };
      } else {
        const name = document.getElementById('accName').value.trim();
        const userId = document.getElementById('userId').value.trim();
        const folderRef = document.getElementById('folderRef').value.trim();
        const rawCookies = document.getElementById('cookies').value.trim();
        const video = document.getElementById('videoEnabled').checked;
        if (!name || !rawCookies) { resEl.innerHTML = '<span style="color:#f87171">Name and cookies are required</span>'; return; }
        // Parse Netscape format if detected (tab-separated lines)
        let cookies = rawCookies;
        if (rawCookies.includes('\\t') || rawCookies.startsWith('# Netscape')) {
          cookies = rawCookies.split('\\n')
            .filter(l => l && !l.startsWith('#'))
            .map(l => { const p=l.split('\\t'); return p.length>=7 ? p[5]+'='+p[6] : null; })
            .filter(Boolean).join('; ');
        }
        body = { name, userId, folderRef, cookies, video };
      }
      try {
        const d = await fetch('/manage/add', {
          method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(body),
        }).then(r=>r.json());
        if (d.ok) {
          const syncMsg = d.synced ? ' · <span style="color:#4ade80">✓ Synced to Render</span>' : (d.sync_error ? \` · <span style="color:#facc15">⚠ Sync: \${d.sync_error}</span>\` : '');
          resEl.innerHTML = \`<span style="color:#4ade80">✅ Added\${d.added>1?' '+d.added+' accounts':''}\${syncMsg}</span>\`;
          setTimeout(()=>location.reload(), 1800);
        } else {
          resEl.innerHTML = \`<span style="color:#f87171">❌ \${d.error||'Failed'}</span>\`;
        }
      } catch(e) { resEl.innerHTML = \`<span style="color:#f87171">Error: \${e.message}</span>\`; }
    }

    async function syncAccounts(btn) {
      btn.textContent='Syncing…'; btn.disabled=true;
      try {
        const d = await fetch('/manage/sync',{method:'POST'}).then(r=>r.json());
        if (d.ok) {
          toast(d.message||'Synced!');
          const badge = document.getElementById('syncBadge');
          badge.style.display='inline-block';
          setTimeout(()=>{badge.style.display='none';}, 5000);
        } else toast('Sync failed: '+(d.error||'unknown'), false);
      } catch(e) { toast('Sync error: '+e.message, false); }
      btn.textContent='↑ Sync to Render'; btn.disabled=false;
    }

    async function refreshPlans(btn) {
      btn.textContent='↻ Refreshing…'; btn.disabled=true;
      await fetch('/v1/accounts/plans/refresh', {method:'POST'}).catch(()=>{});
      toast('Plan refresh started — reloading in 12s…');
      setTimeout(() => location.reload(), 12000);
      btn.disabled=false; btn.textContent='↻ Refresh Plans';
    }

    async function checkAccount(encoded, btn) {
      const name = decodeURIComponent(encoded);
      btn.textContent='…'; btn.disabled=true;
      const r = await fetch('/manage/check', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name})});
      const d = await r.json();
      btn.textContent='Check'; btn.disabled=false;
      if (d.ok) { toast('Plan checked — reloading…'); setTimeout(()=>location.reload(), 2000); }
      else toast(d.error||'Failed', false);
    }

    async function toggleAccount(encoded, btn) {
      const name = decodeURIComponent(encoded);
      const r = await fetch('/manage/toggle', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name})});
      const d = await r.json();
      if (d.ok) { toast(\`\${name}: \${d.status}\`); setTimeout(()=>location.reload(), 1000); }
      else toast(d.error||'Failed', false);
    }

    async function removeAccount(encoded) {
      const name = decodeURIComponent(encoded);
      if (!confirm('Remove account: ' + name + '?')) return;
      const r = await fetch('/manage/remove', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name})});
      const d = await r.json();
      if (d.ok) { toast('Removed!'); setTimeout(()=>location.reload(), 1000); }
      else toast(d.error||'Failed', false);
    }

    function toggleEditAccount(encoded) {
      const el = document.getElementById('edit-'+encoded);
      if (el) el.style.display = el.style.display==='none' ? '' : 'none';
    }

    async function saveAccount(encoded) {
      const name = decodeURIComponent(encoded);
      const video = document.getElementById('edit-video-'+encoded)?.checked ?? false;
      const resultEl = document.getElementById('edit-result-'+encoded);
      resultEl.textContent = 'Saving…';
      const d = await fetch('/manage/update', {
        method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({ name, video }),
      }).then(r=>r.json());
      if (d.ok) {
        resultEl.innerHTML = d.synced ? '<span style="color:#4ade80">✓ Saved & synced</span>' : '<span style="color:#facc15">✓ Saved (sync failed)</span>';
        setTimeout(()=>location.reload(), 1500);
      } else {
        resultEl.innerHTML = \`<span style="color:#f87171">\${d.error||'Failed'}</span>\`;
      }
    }

    // Auto-detect email and userId from pasted cookie string
    function autoDetectFromCookies(raw) {
      if (!raw.trim()) return;
      // Normalise Netscape format to key=value pairs first
      let cookieStr = raw;
      if (raw.includes('\\t') || raw.trim().startsWith('#')) {
        cookieStr = raw.split('\\n')
          .filter(l => l && !l.startsWith('#'))
          .map(l => { const p=l.split('\\t'); return p.length>=7 ? p[5]+'='+p[6] : null; })
          .filter(Boolean).join('; ');
      }
      // Extract UID
      const uid = cookieStr.match(/(?:^|[;\\s])UID=([^;\\s]+)/i);
      if (uid) document.getElementById('userId').value = uid[1].trim();
      // Extract email from GR_TOKEN JWT payload
      const jwt = cookieStr.match(/GR_TOKEN=([A-Za-z0-9._-]+)/i);
      if (jwt) {
        try {
          const parts = jwt[1].split('.');
          if (parts.length >= 2) {
            const payload = JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));
            if (payload.email) document.getElementById('accName').value = payload.email;
          }
        } catch {}
      }
    }

    // Copy all logs to clipboard
    let _allLogs = [];
    async function copyLogs(btn) {
      try {
        const d = await fetch('/logs?limit=500').then(r=>r.json());
        const text = d.map(l=>\`[\${l.ts.slice(0,19)}] [\${l.level}] \${l.msg}\`).join('\\n');
        await navigator.clipboard.writeText(text);
        btn.textContent='✓ Copied!';
        setTimeout(()=>{ btn.textContent='⎘ Copy All'; }, 2000);
      } catch(e) { toast('Copy failed: '+e.message, false); }
    }

    // ── Elapsed-time progress helper ───────────────────────────────────────────
    function startTimer(elId, expectedSec) {
      const el = document.getElementById(elId);
      const start = Date.now();
      const tid = setInterval(() => {
        const sec = Math.floor((Date.now()-start)/1000);
        const pct = expectedSec ? Math.min(95, Math.round(sec/expectedSec*100)) : null;
        const bar = pct !== null ? \`<div style="margin-top:5px;background:#1a1a1a;border-radius:3px;height:4px;overflow:hidden"><div style="background:#3b82f6;height:100%;width:\${pct}%;transition:width 1s linear"></div></div>\` : '';
        const cur = el.innerHTML.split('<!--timer-->')[0];
        el.innerHTML = cur + \`<!--timer--><div style="font-size:11px;color:#555;margin-top:4px">\${sec}s elapsed\${pct!==null?' · ~'+pct+'% complete':''}\${bar}</div>\`;
      }, 1000);
      return tid;
    }
    function stopTimer(tid) { clearInterval(tid); }

    // ── Logs ───────────────────────────────────────────────────────────────────
    async function loadLogs() {
      const box = document.getElementById('logsBox');
      try {
        const d = await fetch('/logs').then(r=>r.json());
        box.innerHTML = d.slice(0,80).map(l=>\`
          <div class="log-line log-\${l.level}">
            <span style="color:#444">\${l.ts.slice(11,19)}</span>
            <span style="color:\${l.level==='INFO'?'#3b82f6':l.level==='WARN'?'#f59e0b':'#ef4444'};margin:0 4px">\${l.level}</span>
            \${l.msg}
          </div>\`).join('');
      } catch(e) { box.textContent = 'Error loading logs: ' + e.message; }
    }
    let autoRefInterval = null;
    function toggleAutoRefresh(btn) {
      if (autoRefInterval) { clearInterval(autoRefInterval); autoRefInterval=null; btn.textContent='Auto ▶'; }
      else { autoRefInterval=setInterval(loadLogs, 3000); btn.textContent='Auto ⏸'; loadLogs(); }
    }
    loadLogs();

    // ── Voices ─────────────────────────────────────────────────────────────────
    const AM = ${JSON.stringify(AUDIO_MODELS.map(m=>({id:m.id,provider:m.provider})))};
    let allVoices = [];

    async function loadVoices(btn) {
      btn.textContent='Loading…'; btn.disabled=true;
      try {
        const d = await fetch('/v1/audio/voices').then(r=>r.json());
        allVoices = [...(d.providers?.elevenlabs||[]), ...(d.providers?.google||[])];
        const accents = [...new Set(allVoices.map(v=>v.accent_id).filter(Boolean))].sort();
        const asel = document.getElementById('vAccent');
        asel.innerHTML = '<option value="">All accents</option>' + accents.map(a=>\`<option value="\${a}">\${a}</option>\`).join('');
        filterVoices();
        btn.textContent=\`\${allVoices.length} voices ✓\`;
      } catch(e) { toast('Failed: '+e.message, false); btn.textContent='Load Voices'; }
      finally { btn.disabled=false; }
    }

    function filterVoices() {
      const gender=document.getElementById('vGender').value, age=document.getElementById('vAge').value,
            accent=document.getElementById('vAccent').value, search=document.getElementById('vSearch').value.toLowerCase(),
            model=document.getElementById('audioModel').value, provider=AM.find(m=>m.id===model)?.provider;
      const f=allVoices.filter(v=>(!provider||v.provider===provider)&&(!gender||v.gender===gender)&&
        (!age||v.age===age)&&(!accent||v.accent_id===accent)&&(!search||v.name.toLowerCase().includes(search)));
      const sel=document.getElementById('vSelect'), cur=sel.value;
      sel.innerHTML=f.length?f.map(v=>\`<option value="\${v.id}">\${v.name} — \${v.gender||''}\${v.age?' · '+v.age:''}\${v.accent_id?' ('+v.accent_id+')':''}</option>\`).join('')
        :'<option value="">No voices match</option>';
      if (cur) sel.value=cur;
      updateVoicePreview();
    }

    function updateVoicePreview() {
      const voiceId=document.getElementById('vSelect').value, voice=allVoices.find(v=>String(v.id)===voiceId);
      const box=document.getElementById('voicePreviewBox');
      if (!voice||!voice.example_mp3_url){box.innerHTML='';return;}
      const isWav=voice.example_mp3_url.endsWith('.wav');
      box.innerHTML=\`<div style="display:flex;align-items:center;gap:8px;margin-top:5px">
        \${voice.preview_image_url?\`<img src="\${voice.preview_image_url}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid #4ade80">\`:''}
        <div style="flex:1"><div style="font-size:11px;color:#888;margin-bottom:3px">\${voice.name} · \${voice.provider} · \${voice.gender||''} \${voice.age||''}</div>
        <audio controls style="height:28px" src="\${voice.example_mp3_url}"><source src="\${voice.example_mp3_url}" type="\${isWav?'audio/wav':'audio/mpeg'}"></audio></div></div>\`;
    }

    function onModelChange() {
      filterVoices();
      const isEL=AM.find(m=>m.id===document.getElementById('audioModel').value)?.provider==='elevenlabs';
      document.getElementById('speedRow').style.display=isEL?'flex':'none';
      document.getElementById('tempRow').style.display=isEL?'none':'flex';
    }

    // ── Test generators ────────────────────────────────────────────────────────
    async function testGenerate() {
      const prompt=document.getElementById('testPrompt').value.trim();
      const model=document.getElementById('testModel').value;
      const num_images=parseInt(document.getElementById('testCount').value)||1;
      const variations=document.getElementById('testVariations').checked;
      if (!prompt) return toast('Enter a prompt', false);
      const el=document.getElementById('testResult');
      el.innerHTML=\`⏳ Generating \${num_images} image(s) with <b>\${model}</b>…\`;
      const tid=startTimer('testResult', 15);
      try {
        const d=await fetch('/v1/images/generate',{method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({prompt,num_images,aspect_ratio:document.getElementById('testRatio').value,model,variations})}).then(r=>r.json());
        stopTimer(tid);
        if (d.data?.length) {
          const tms = d.processing_time_ms ? \` · \${(d.processing_time_ms/1000).toFixed(1)}s\` : '';
          el.innerHTML=\`<div style="color:#4ade80;margin-bottom:6px">✅ \${d.data.length} image(s) · account: \${d.account}\${tms}</div>\`+
            d.data.map(img=>\`<div style="margin-bottom:12px"><a href="\${img.url}" target="_blank">
              <img src="\${img.preview_url||img.url}" loading="lazy" style="max-width:280px;border-radius:8px;border:1px solid #333"></a>
              <div style="font-size:11px;color:#888;margin-top:3px">\${img.width}×\${img.height} · <b style="color:#eee">\${img.mode}</b> · seed: \${img.seed}</div>
              <a href="\${img.url}" target="_blank" class="dl">Full res ↗</a></div>\`).join('');
        } else { stopTimer(tid); el.innerHTML=\`<span style='color:#f87171'>Error: \${d.error||JSON.stringify(d)}</span>\`; }
      } catch(e) { stopTimer(tid); el.innerHTML=\`<span style='color:#f87171'>Error: \${e.message}</span>\`; }
    }

    async function testVideo() {
      const prompt=document.getElementById('vidPrompt').value.trim();
      const model=document.getElementById('vidModel').value;
      if (!prompt) return toast('Enter a prompt', false);
      const el=document.getElementById('vidResult');
      el.innerHTML=\`⏳ Generating video with <b>\${model}</b>…\`;
      const tid=startTimer('vidResult', 90);
      try {
        const d=await fetch('/v1/videos/generate',{method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({prompt,model,aspect_ratio:document.getElementById('vidRatio').value,
            duration:parseInt(document.getElementById('vidDur').value),resolution:document.getElementById('vidRes').value,
            sound_effects:document.getElementById('vidSound').checked})}).then(r=>r.json());
        stopTimer(tid);
        if (d.data?.url) {
          const tms = d.processing_time_ms ? \` · \${(d.processing_time_ms/1000).toFixed(1)}s\` : '';
          el.innerHTML=\`<div style="color:#4ade80;margin-bottom:6px">✅ Done · account: \${d.account}\${tms}</div>
            <video controls><source src="\${d.data.url}" type="video/mp4"></video>
            <div style="font-size:11px;color:#888;margin-top:3px">\${d.data.model} · \${d.data.duration}s · \${d.data.resolution}</div>
            <a href="\${d.data.url}" target="_blank" class="dl">⬇ Download</a>\`;
        } else el.innerHTML=\`<span style='color:#f87171'>Error: \${d.error||JSON.stringify(d)}</span>\`;
      } catch(e) { stopTimer(tid); el.innerHTML=\`<span style='color:#f87171'>Error: \${e.message}</span>\`; }
    }

    async function testAudio() {
      const text=document.getElementById('audioText').value.trim();
      const model=document.getElementById('audioModel').value;
      const voiceId=document.getElementById('vSelect').value;
      if (!text) return toast('Enter text', false);
      const el=document.getElementById('audioResult');
      el.innerHTML=\`⏳ Generating with <b>\${model}</b>…\`;
      const tid=startTimer('audioResult', 20);
      try {
        const body={text,model,style:document.getElementById('audioStyle').value,
          speed:parseFloat(document.getElementById('audioSpeed').value),
          temperature:parseFloat(document.getElementById('audioTemp').value)};
        if (voiceId) body.voice_id=parseInt(voiceId)||voiceId;
        const d=await fetch('/v1/audio/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
        stopTimer(tid);
        if (d.data?.url) {
          const isWav=d.data.url.includes('.wav');
          const tms = d.processing_time_ms ? \` · \${(d.processing_time_ms/1000).toFixed(1)}s\` : '';
          el.innerHTML=\`<div style="color:#4ade80;margin-bottom:6px">✅ Done · account: \${d.account}\${tms}</div>
            <audio controls><source src="\${d.data.url}" type="\${isWav?'audio/wav':'audio/mpeg'}"></audio>
            <div style="font-size:11px;color:#888;margin-top:3px">\${d.data.model} · \${d.data.voice} · \${d.data.duration}s</div>
            <a href="\${d.data.url}" target="_blank" class="dl">⬇ Download</a>\`;
        } else el.innerHTML=\`<span style='color:#f87171'>Error: \${d.error||JSON.stringify(d)}</span>\`;
      } catch(e) { stopTimer(tid); el.innerHTML=\`<span style='color:#f87171'>Error: \${e.message}</span>\`; }
    }

    let _upscaleImageData = null; // base64 data URL from file picker

    function onUpscaleFileChange(input) {
      const file = input.files[0];
      if (!file) return;
      const preview = document.getElementById('upscaleFilePreview');
      const reader = new FileReader();
      reader.onload = e => {
        _upscaleImageData = e.target.result; // "data:image/jpeg;base64,..."
        document.getElementById('upscaleUrl').value = ''; // clear URL field
        preview.style.display = 'block';
        preview.innerHTML = \`✅ File loaded: <b>\${file.name}</b> (\${(file.size/1024).toFixed(1)} KB) — ready to upload & upscale\`;
      };
      reader.readAsDataURL(file);
    }

    async function testUpscale() {
      const imageUrl = document.getElementById('upscaleUrl').value.trim();
      const el = document.getElementById('upscaleResult');
      const scale = document.getElementById('upscaleScale').value;
      const model = document.getElementById('upscaleModel').value;

      if (!imageUrl && !_upscaleImageData) return toast('Enter an image URL or pick a file', false);

      let creation_id = null;

      // If user picked a file, upload it first to get a creation_id
      if (_upscaleImageData) {
        el.innerHTML = '⏳ Uploading image to Magnific…';
        try {
          const up = await fetch('/v1/upload', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({ image_data: _upscaleImageData }),
          }).then(r => r.json());
          if (!up.creation_id) {
            el.innerHTML = \`<span style='color:#f87171'>Upload failed: \${up.error || JSON.stringify(up)}</span>\`;
            return;
          }
          creation_id = up.creation_id;
          el.innerHTML = \`✅ Uploaded → <code>\${creation_id}</code> (account: \${up.account})<br>⏳ Upscaling \${scale}× with <b>\${model}</b>…\`;
        } catch(e) {
          el.innerHTML = \`<span style='color:#f87171'>Upload error: \${e.message}</span>\`;
          return;
        }
      } else {
        el.innerHTML = \`⏳ Upscaling \${scale}× with <b>\${model}</b>…\`;
      }
      const tid = startTimer('upscaleResult', 120);

      try {
        const body = {
          mode: document.getElementById('upscaleMode').value,
          model,
          scale: parseInt(scale),
          engine: document.getElementById('upscaleEngine').value,
          creativity: parseInt(document.getElementById('upCreat').value),
          hdr: parseInt(document.getElementById('upHdr').value),
          resemblance: parseInt(document.getElementById('upRes').value),
          fractality: parseInt(document.getElementById('upFrac').value),
          prompt: document.getElementById('upscalePrompt').value.trim() || undefined,
        };
        if (creation_id) body.creation_id = creation_id;
        else body.image_url = imageUrl;

        const d = await fetch('/v1/images/upscale', {
          method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body),
        }).then(r => r.json());
        stopTimer(tid);

        if (d.data?.url) {
          const tms = d.processing_time_ms ? \` · \${(d.processing_time_ms/1000).toFixed(1)}s\` : '';
          el.innerHTML = \`<div style="color:#4ade80;margin-bottom:6px">✅ Done · account: \${d.account} · \${d.data.width}×\${d.data.height}\${tms}</div>
            <img src="\${d.data.url}" style="max-width:100%;border-radius:8px;border:1px solid #222">
            <div style="font-size:11px;color:#888;margin-top:4px">\${d.data.model} · \${d.data.engine} · \${d.data.scale}×</div>
            <a href="\${d.data.url}" target="_blank" class="dl">⬇ Download full resolution</a>\`;
        } else {
          el.innerHTML = \`<span style='color:#f87171'>Error: \${d.error || JSON.stringify(d)}</span>\`;
        }
      } catch(e) { stopTimer(tid); el.innerHTML = \`<span style='color:#f87171'>Error: \${e.message}</span>\`; }
    }

    let _bgImageData = null;
    function onBgFileChange(input) {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        _bgImageData = e.target.result;
        document.getElementById('bgUrl').value = '';
        document.getElementById('bgFilePreview').style.display = 'block';
        document.getElementById('bgFilePreview').textContent = \`📎 \${file.name} (\${(file.size/1024).toFixed(1)} KB)\`;
      };
      reader.readAsDataURL(file);
    }

    async function testRemoveBg() {
      const el = document.getElementById('bgResult');
      const imageUrl = document.getElementById('bgUrl').value.trim();
      if (!imageUrl && !_bgImageData) return toast('Enter an image URL or pick a file', false);
      el.innerHTML = '⏳ Removing background…';
      try {
        const body = _bgImageData ? { image_data: _bgImageData } : { image_url: imageUrl };
        const d = await fetch('/v1/images/remove-background', {
          method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body),
        }).then(r => r.json());
        if (d.result_b64) {
          el.innerHTML = \`<div style="color:#4ade80;margin-bottom:6px">✅ Done · account: \${d.account}</div>
            <img src="\${d.result_b64}" style="max-width:100%;border-radius:8px;border:1px solid #222;background:repeating-conic-gradient(#555 0% 25%,#333 0% 50%) 0 0/20px 20px">
            <a href="\${d.result_b64}" download="bg-removed.png" class="dl" style="display:block;margin-top:6px">⬇ Download PNG</a>\`;
        } else {
          el.innerHTML = \`<span style='color:#f87171'>Error: \${d.error || JSON.stringify(d)}</span>\`;
        }
      } catch(e) { el.innerHTML = \`<span style='color:#f87171'>Error: \${e.message}</span>\`; }
    }
  </script>
</body>
</html>`);
});

// ── GET /manage — redirect to /admin ─────────────────────────────────────────
app.get("/manage", (req, res) => res.redirect("/admin"));

// ── POST /manage/add ──────────────────────────────────────────────────────────
app.post("/manage/add", adminAuthMiddleware, express.json(), async (req, res) => {
  const { name, userId, folderRef, cookies, json_data, video = false } = req.body || {};

  let acc = null;

  // JSON format: paste full account object (or array — bulk add)
  if (json_data) {
    let parsed;
    try { parsed = JSON.parse(json_data); } catch { return res.json({ ok: false, error: "Invalid JSON" }); }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    let added = 0;
    for (const obj of arr) {
      const a = parseAccountFromObj(obj);
      if (!a) continue;
      if (manager.accounts.find(x => x.name === a.name)) continue; // skip duplicates
      a.semaphore = new AccountSemaphore(SLOTS_PER_ACCOUNT);
      a.lastRefresh = {};
      manager.accounts.push(a);
      added++;
    }
    if (added === 0) return res.json({ ok: false, error: "No valid accounts found in JSON (check cookieString field)" });
    addLog("INFO", `${added} account(s) added from JSON`);
    const sync = await syncToRender();
    return res.json({ ok: true, added, synced: sync.ok, sync_error: sync.ok ? undefined : sync.reason });
  }

  // Cookie string / Netscape format
  if (!name?.trim() || !cookies?.trim()) {
    return res.json({ ok: false, error: "name and cookies are required (or use json_data)" });
  }

  acc = parseAccountFromObj({ name: name.trim(), userId, folderRef, cookieString: cookies.trim(), video });
  if (!acc) return res.json({ ok: false, error: "Invalid cookie string — could not parse cookies" });

  if (USING_ENV_ACCOUNTS || true) {
    if (manager.accounts.find(a => a.name === acc.name)) return res.json({ ok: false, error: "Account already exists" });
    acc.semaphore = new AccountSemaphore(SLOTS_PER_ACCOUNT);
    acc.lastRefresh = {};
    manager.accounts.push(acc);
    addLog("INFO", `Account added: ${name}`);
    const sync = await syncToRender();
    return res.json({ ok: true, synced: sync.ok, sync_error: sync.ok ? undefined : sync.reason });
  }

  const safeFilename = name.replace(/[^a-zA-Z0-9._@+-]/g, "_") + ".txt";
  const filepath = path.join(__dirname, "accounts", safeFilename);
  const lines = [
    `# Magnific/Freepik Account — ${name}`,
    `# user_id: ${userId || ""}`,
    `# folder_reference: ${folderRef || ""}`,
    ...(video ? ["# video: true"] : []),
    `# Export date: ${new Date().toISOString().slice(0, 10)}`,
    cookies.trim(),
  ];
  try {
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, lines.join("\n"), "utf8");
    manager.reload();
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── POST /manage/update ───────────────────────────────────────────────────────
app.post("/manage/update", adminAuthMiddleware, express.json(), async (req, res) => {
  const { name, video, status, email } = req.body || {};
  const acc = manager.accounts.find(a => a.name === name);
  if (!acc) return res.json({ ok: false, error: "Account not found" });
  if (video !== undefined) acc.video = Boolean(video);
  if (status && ['active','inactive'].includes(status)) acc.status = status;
  if (email?.trim()) acc.email = email.trim();
  addLog('INFO', `Account updated: ${name} (video=${acc.video})`);
  const sync = await syncToRender();
  return res.json({ ok: true, synced: sync.ok, sync_error: sync.ok ? undefined : sync.reason });
});

// ── POST /manage/sync ─────────────────────────────────────────────────────────
app.post("/manage/sync", adminAuthMiddleware, async (req, res) => {
  const result = await syncToRender();
  if (result.ok) res.json({ ok: true, message: `Synced ${manager.accounts.length} account(s) to Render` });
  else res.json({ ok: false, error: result.reason });
});

// ── POST /manage/check ────────────────────────────────────────────────────────
app.post("/manage/check", adminAuthMiddleware, express.json(), async (req, res) => {
  const { name } = req.body || {};
  const acc = manager.accounts.find(a => a.name === name);
  if (!acc) return res.json({ ok: false, error: "Account not found" });
  try {
    await checkAccountPlan(acc);
    res.json({ ok: true, planStatus: acc.planStatus, credits: acc.credits, status: acc.status });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── POST /manage/remove ───────────────────────────────────────────────────────
app.post("/manage/remove", adminAuthMiddleware, express.json(), async (req, res) => {
  const { name } = req.body || {};
  if (!name?.trim()) return res.json({ ok: false, error: "name required" });

  const idx = manager.accounts.findIndex(a => a.name === name);
  if (idx === -1) return res.json({ ok: false, error: "Account not found" });
  manager.accounts.splice(idx, 1);
  addLog("INFO", `Account removed: ${name}`);
  const sync = await syncToRender();
  return res.json({ ok: true, synced: sync.ok, sync_error: sync.ok ? undefined : sync.reason });
});

// ── POST /manage/toggle ───────────────────────────────────────────────────────
app.post("/manage/toggle", adminAuthMiddleware, express.json(), async (req, res) => {
  const { name } = req.body || {};
  if (!name?.trim()) return res.json({ ok: false, error: "name required" });
  const acc = manager.accounts.find(a => a.name === name);
  if (!acc) return res.json({ ok: false, error: "Account not found" });
  acc.status = acc.status === "active" ? "inactive" : "active";
  addLog("INFO", `Account ${acc.name} toggled to ${acc.status}`);
  syncToRender(); // fire-and-forget — persist the change
  res.json({ ok: true, name: acc.name, status: acc.status });
});

// ── POST /v1/spaces ───────────────────────────────────────────────────────────
// Creates a new Space/folder in Magnific. Returns `reference` UUID which can
// be passed as `folder` in POST /v1/images/generate to save images there.
app.post("/v1/spaces", auth, async (req, res) => {
  const { name, description = "", access = "private" } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: "name is required" });
  try {
    const acc = await manager.getAccount();
    if (!acc) return res.status(503).json({ error: "No active accounts" });
    await refreshSession(acc);
    const { status, json } = await apiRequest(
      "POST",
      `/app/api/projects/folders?lang=en_US&user_id=${acc.userId}`,
      { name: name.trim(), description, accessType: access, type: "project" },
      acc
    );
    if (!json) return res.status(status).json({ error: "Unexpected response from Magnific" });
    res.status(status).json({
      id: json.id,
      name: json.name,
      reference: json.reference,          // use this as `folder` in /v1/images/generate
      parent_reference: json.parent_reference,
      is_public: json.is_public,
      created_at: json.created_at,
      account: acc.name,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /docs ─────────────────────────────────────────────────────────────────
app.get("/docs", (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>API Docs — Magnific API</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    *{box-sizing:border-box}body{font-family:system-ui,sans-serif;max-width:860px;margin:0 auto;padding:24px 20px;background:#0a0a0a;color:#ddd;line-height:1.6}
    h1{color:#fff;font-size:28px;margin-bottom:4px}h2{color:#ccc;font-size:18px;margin:32px 0 8px;border-top:1px solid #1e1e1e;padding-top:20px}
    h3{color:#aaa;font-size:14px;margin:20px 0 6px}p{color:#888;margin:0 0 10px;font-size:14px}
    .endpoint{background:#141414;border:1px solid #222;border-radius:10px;padding:18px;margin:14px 0}
    .method{display:inline-block;padding:3px 10px;border-radius:5px;font-size:12px;font-weight:700;margin-right:8px;font-family:monospace}
    .GET{background:#0c2a1c;color:#4ade80}.POST{background:#0c1a2a;color:#60a5fa}
    .url{font-family:monospace;font-size:15px;color:#e2e8f0;font-weight:600}
    code{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:5px;padding:2px 7px;font-size:12px;font-family:monospace;color:#a5b4fc}
    pre{background:#0f0f0f;border:1px solid #1e1e1e;border-radius:8px;padding:14px;overflow-x:auto;font-size:11px;line-height:1.7;position:relative}
    .copy-btn{position:absolute;top:8px;right:8px;background:#1e1e1e;border:1px solid #333;color:#888;border-radius:5px;padding:3px 8px;font-size:10px;cursor:pointer}
    .copy-btn:hover{background:#2a2a2a;color:#eee}
    table{width:100%;border-collapse:collapse;font-size:13px;margin:10px 0}
    th{text-align:left;padding:6px 10px;background:#1a1a1a;color:#999;font-weight:600}
    td{padding:6px 10px;border-top:1px solid #1e1e1e;color:#ccc;vertical-align:top}
    td:first-child{font-family:monospace;color:#a5b4fc}
    .req{color:#f87171;font-size:10px}.opt{color:#64748b;font-size:10px}
    .nav{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:24px}
    .nav a{color:#60a5fa;text-decoration:none;font-size:13px;padding:4px 10px;border-radius:5px;background:#0f1826;border:1px solid #1a3a5c}
    .nav a:hover{background:#1a3a5c}
    .auth-note{background:#12100a;border:1px solid #3a2a00;border-radius:7px;padding:10px 14px;font-size:13px;color:#fde68a;margin-bottom:16px}
  </style>
</head>
<body>
  <h1>Magnific API</h1>
  <p style="color:#555;margin-bottom:16px">OpenAI-compatible proxy to Magnific image/video/audio generation</p>

  <div class="nav">
    <a href="#auth">Auth</a>
    <a href="#images">Images</a>
    <a href="#videos">Videos</a>
    <a href="#audio">Audio</a>
    <a href="#voices">Voices</a>
    <a href="#models">Models</a>
    <a href="#health">Health</a>
    <a href="/admin">Admin</a>
  </div>

  <div class="auth-note" id="auth">
    🔑 <strong>Authentication:</strong> Set <code>X-API-Key: YOUR_SECRET</code> header (or <code>Authorization: Bearer YOUR_SECRET</code>) on all requests.
    If <code>API_SECRET</code> env var is not set, auth is disabled (local dev).
  </div>

  <!-- Images -->
  <h2 id="images">Image Generation</h2>

  <div class="endpoint">
    <span class="method POST">POST</span><span class="url">/v1/images/generate</span>
    <p>Generate images using any Magnific model. Returns image URLs immediately after generation completes (~20–60s).</p>
    <h3>Request body</h3>
    <table>
      <tr><th>Field</th><th>Type</th><th>Description</th></tr>
      <tr><td>prompt</td><td>string</td><td><span class="req">required</span> Text description of the image</td></tr>
      <tr><td>model</td><td>string</td><td><span class="opt">optional</span> Model ID (default: <code>auto</code>). See <a href="#models" style="color:#60a5fa">GET /v1/models</a></td></tr>
      <tr><td>num_images</td><td>integer</td><td><span class="opt">optional</span> 1–4 (default: 1)</td></tr>
      <tr><td>aspect_ratio</td><td>string</td><td><span class="opt">optional</span> <code>1:1</code> | <code>16:9</code> | <code>9:16</code> | <code>4:3</code> | <code>3:4</code> | <code>3:2</code> | <code>2:3</code> (default: <code>1:1</code>)</td></tr>
      <tr><td>variations</td><td>boolean</td><td><span class="opt">optional</span> Generate creative variants (default: false)</td></tr>
      <tr><td>folder</td><td>string</td><td><span class="opt">optional</span> Folder UUID to save images into (from <code>POST /v1/spaces</code>)</td></tr>
    </table>
    <h3>Example</h3>
    <pre><button class="copy-btn" onclick="copyPre(this)">Copy</button>curl -X POST https://YOUR_DOMAIN/v1/images/generate \\
  -H "X-API-Key: YOUR_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "a serene mountain lake at golden hour, photorealistic",
    "model": "flux",
    "aspect_ratio": "16:9",
    "num_images": 1
  }'</pre>
    <h3>Response</h3>
    <pre>{"created":1748000000,"data":[{"url":"https://...","preview_url":"https://...","revised_prompt":"...","width":1024,"height":576,"mode":"flux","seed":123456,"id":"abc","family":"uuid"}],"account":"user@gmail.com"}</pre>
  </div>

  <div class="endpoint">
    <span class="method POST">POST</span><span class="url">/v1/images/generations</span>
    <p>OpenAI-compatible endpoint. Same as above but accepts <code>n</code> and <code>size</code> instead of <code>num_images</code> and <code>aspect_ratio</code>.</p>
    <table>
      <tr><th>Field</th><th>Type</th><th>Description</th></tr>
      <tr><td>prompt</td><td>string</td><td><span class="req">required</span></td></tr>
      <tr><td>n</td><td>integer</td><td>1–4 (default: 1)</td></tr>
      <tr><td>size</td><td>string</td><td><code>1024x1024</code> | <code>1792x1024</code> | <code>1024x1792</code> (maps to aspect ratios)</td></tr>
    </table>
  </div>

  <!-- Videos -->
  <h2 id="videos">Video Generation</h2>

  <div class="endpoint">
    <span class="method POST">POST</span><span class="url">/v1/videos/generate</span>
    <p>Generate a video clip (~2–10 min to complete). Requires a video-capable account.</p>
    <table>
      <tr><th>Field</th><th>Type</th><th>Description</th></tr>
      <tr><td>prompt</td><td>string</td><td><span class="req">required</span></td></tr>
      <tr><td>model</td><td>string</td><td><span class="opt">optional</span> Video model ID (default: <code>bytedance-seedance-fast-2.0</code>)</td></tr>
      <tr><td>negative_prompt</td><td>string</td><td><span class="opt">optional</span></td></tr>
      <tr><td>aspect_ratio</td><td>string</td><td><span class="opt">optional</span> <code>16:9</code> | <code>9:16</code> | <code>1:1</code></td></tr>
      <tr><td>duration</td><td>integer</td><td><span class="opt">optional</span> Seconds, 1–10 (default: 5)</td></tr>
      <tr><td>resolution</td><td>string</td><td><span class="opt">optional</span> <code>720p</code> | <code>1080p</code></td></tr>
      <tr><td>sound_effects</td><td>boolean</td><td><span class="opt">optional</span> default: true</td></tr>
      <tr><td>start_image</td><td>string</td><td><span class="opt">optional</span> URL — image-to-video start frame</td></tr>
      <tr><td>end_image</td><td>string</td><td><span class="opt">optional</span> URL — end frame (model must support it)</td></tr>
      <tr><td>references</td><td>array</td><td><span class="opt">optional</span> <code>[{"type":"character","url":"..."}]</code></td></tr>
    </table>
    <h3>Example</h3>
    <pre><button class="copy-btn" onclick="copyPre(this)">Copy</button>curl -X POST https://YOUR_DOMAIN/v1/videos/generate \\
  -H "X-API-Key: YOUR_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt":"a golden retriever runs on a beach","model":"bytedance-seedance-fast-2.0","duration":5}'</pre>
  </div>

  <!-- Audio -->
  <h2 id="audio">Audio / TTS Generation</h2>

  <div class="endpoint">
    <span class="method POST">POST</span><span class="url">/v1/audio/generate</span>
    <p>Convert text to speech using ElevenLabs or Google Gemini TTS models.</p>
    <table>
      <tr><th>Field</th><th>Type</th><th>Description</th></tr>
      <tr><td>text</td><td>string</td><td><span class="req">required</span></td></tr>
      <tr><td>model</td><td>string</td><td><span class="opt">optional</span> Audio model ID (default: <code>eleven_v3</code>)</td></tr>
      <tr><td>voice</td><td>string</td><td><span class="opt">optional</span> Voice name (e.g. <code>Rachel</code>)</td></tr>
      <tr><td>voice_id</td><td>integer|string</td><td><span class="opt">optional</span> Explicit voice ID (from <code>GET /v1/audio/voices</code>)</td></tr>
      <tr><td>style</td><td>string</td><td><span class="opt">optional</span> <code>neutral</code> | <code>expressive</code> | <code>consistent</code></td></tr>
      <tr><td>speed</td><td>float</td><td><span class="opt">optional</span> 0.5–2.0, ElevenLabs only (default: 1.0)</td></tr>
      <tr><td>temperature</td><td>float</td><td><span class="opt">optional</span> 0.0–2.0, Google only (default: 1.0)</td></tr>
      <tr><td>system_instruction</td><td>string</td><td><span class="opt">optional</span> Google only — persona prompt</td></tr>
    </table>
    <h3>Example</h3>
    <pre><button class="copy-btn" onclick="copyPre(this)">Copy</button>curl -X POST https://YOUR_DOMAIN/v1/audio/generate \\
  -H "X-API-Key: YOUR_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{"text":"Hello world, this is a test.","model":"eleven_v3","voice":"Rachel","style":"neutral"}'</pre>
  </div>

  <!-- Voices -->
  <h2 id="voices">Voices</h2>

  <div class="endpoint">
    <span class="method GET">GET</span><span class="url">/v1/audio/voices</span>
    <p>List all available voices. Returns all providers by default.</p>
    <table>
      <tr><th>Query param</th><th>Description</th></tr>
      <tr><td>provider</td><td><code>elevenlabs</code> | <code>google</code> — filter by provider</td></tr>
    </table>
    <h3>Example</h3>
    <pre><button class="copy-btn" onclick="copyPre(this)">Copy</button>curl https://YOUR_DOMAIN/v1/audio/voices -H "X-API-Key: YOUR_SECRET"
curl "https://YOUR_DOMAIN/v1/audio/voices?provider=elevenlabs" -H "X-API-Key: YOUR_SECRET"</pre>
  </div>

  <div class="endpoint">
    <span class="method GET">GET</span><span class="url">/v1/audio/voices/:id/preview</span>
    <p>Get preview audio URL and metadata for a specific voice. <code>:id</code> can be the numeric ID, provider_id, or name.</p>
    <pre><button class="copy-btn" onclick="copyPre(this)">Copy</button>curl https://YOUR_DOMAIN/v1/audio/voices/Rachel/preview -H "X-API-Key: YOUR_SECRET"</pre>
    <pre>{"id":42,"name":"Rachel","provider":"elevenlabs","preview_url":"https://...mp3","preview_image_url":"https://..."}</pre>
  </div>

  <!-- Models -->
  <h2 id="models">Models</h2>

  <div class="endpoint">
    <span class="method GET">GET</span><span class="url">/v1/models</span>
    <p>List available models. Returns image models by default.</p>
    <table>
      <tr><th>Query param</th><th>Description</th></tr>
      <tr><td>type</td><td><code>all</code> (default) | <code>video</code> | <code>audio</code> | <code>unlimited</code> | <code>credits</code></td></tr>
    </table>
    <pre><button class="copy-btn" onclick="copyPre(this)">Copy</button>curl "https://YOUR_DOMAIN/v1/models?type=video" -H "X-API-Key: YOUR_SECRET"
curl "https://YOUR_DOMAIN/v1/models?type=unlimited"</pre>
  </div>

  <!-- Health -->
  <h2 id="health">Health & Status</h2>

  <div class="endpoint">
    <span class="method GET">GET</span><span class="url">/health</span>
    <p>Server health and per-account slot/plan status. No auth required.</p>
    <pre><button class="copy-btn" onclick="copyPre(this)">Copy</button>curl https://YOUR_DOMAIN/health</pre>
  </div>

  <div class="endpoint">
    <span class="method GET">GET</span><span class="url">/v1/accounts/plans</span>
    <p>Detailed plan/credit info for all accounts. Requires auth.</p>
  </div>

  <div class="endpoint">
    <span class="method POST">POST</span><span class="url">/v1/accounts/plans/refresh</span>
    <p>Trigger immediate plan re-check for all active accounts. Requires auth.</p>
  </div>

  <!-- Spaces -->
  <h2>Spaces (Folders)</h2>
  <div class="endpoint">
    <span class="method POST">POST</span><span class="url">/v1/spaces</span>
    <p>Create a Magnific folder/Space. Returns a <code>reference</code> UUID you can pass as <code>folder</code> in image/video generation to organize content.</p>
    <table>
      <tr><th>Field</th><th>Description</th></tr>
      <tr><td>name</td><td><span class="req">required</span> Space name</td></tr>
      <tr><td>description</td><td><span class="opt">optional</span></td></tr>
      <tr><td>access</td><td><span class="opt">optional</span> <code>private</code> (default) | <code>public</code></td></tr>
    </table>
  </div>

  <script>
    function copyPre(btn) {
      const pre = btn.parentElement;
      const text = pre.textContent.replace('Copy','').trim();
      navigator.clipboard.writeText(text).then(() => { btn.textContent='Copied!'; setTimeout(()=>btn.textContent='Copy',1500); });
    }
  </script>
</body>
</html>`);
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  addLog("INFO", `Freepik API server listening on port ${PORT}`);
});
