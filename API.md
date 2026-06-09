# Magnific API — Developer Reference

**Base URL:** `https://freepik-api-qg08.onrender.com`

This is a private proxy that turns Magnific/Freepik browser sessions into a clean REST API for AI image, video, audio, and utility generation. All generation endpoints require an API key. Responses follow a consistent JSON shape.

---

## Authentication

Add your API key to every request as a header:

```
X-API-Key: <your_api_secret>
```

**No auth required:** `GET /health`, `GET /v1/models`, `GET /docs`

If `API_SECRET` is empty (not set on the server), all requests pass through without key validation.

---

## How the API Works — Async Job System

All generation endpoints (`/v1/images/generate`, `/v1/videos/generate`, `/v1/audio/generate`) use an **async job system**. You submit a request and get back a `job_id` **instantly** (< 1 second). Then you poll `GET /v1/jobs/:id` until the job is `completed` or `failed`.

```
Submit → job_id returned immediately (HTTP 202)
Poll every N seconds → status: queued → processing → completed
Completed → result contains the CDN URL
```

**Why async?**
- Video takes 1–5 minutes — holding an HTTP connection that long breaks mobile clients, Vercel, Cloudflare Workers, etc.
- Multiple jobs can run in parallel without blocking your client
- If network drops, the job keeps running — just re-poll with the same `job_id`

**Legacy sync mode** (backward compatible): Add `?wait=true` to any generation request to get the old blocking behaviour (connection held open until done). Useful for simple scripts and testing.

---

## Quick Start

```bash
# Step 1 — Submit a video job (returns instantly)
curl -X POST https://freepik-api-qg08.onrender.com/v1/videos/generate \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "a wave crashing on a rocky shore", "model": "kling-25"}'
# → {"job_id":"job_abc123","status":"queued","retry_after":10,"poll_url":"/v1/jobs/job_abc123"}

# Step 2 — Poll for result (repeat every retry_after seconds)
curl https://freepik-api-qg08.onrender.com/v1/jobs/job_abc123 \
  -H "X-API-Key: YOUR_KEY"
# → {"status":"completed","result":{"url":"https://pikaso.cdnpk.net/...",...}}

# Images and audio work the same way
curl -X POST https://freepik-api-qg08.onrender.com/v1/images/generate \
  -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"prompt": "a futuristic city at night", "model": "flux-2"}'

curl -X POST https://freepik-api-qg08.onrender.com/v1/audio/generate \
  -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"text": "Hello world", "model": "eleven_v3"}'
```

---

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/images/generate` | API key | Submit image job → `job_id` (async) |
| `POST` | `/v1/videos/generate` | API key | Submit video job → `job_id` (async) |
| `POST` | `/v1/audio/generate` | API key | Submit audio job → `job_id` (async) |
| `GET` | `/v1/jobs/:id` | API key | Poll job status and get result |
| `GET` | `/v1/jobs` | API key | List last 100 jobs |
| `POST` | `/v1/images/generations` | API key | OpenAI-compatible image generation (sync) |
| `POST` | `/v1/images/describe` | API key | Describe an image with AI (sync) |
| `POST` | `/v1/images/remove-background` | API key | Remove background from image (sync) |
| `POST` | `/v1/images/upscale` | API key | Upscale / enhance an image (sync) |
| `POST` | `/v1/upload` | API key | Upload local image for upscale |
| `GET` | `/v1/audio/voices` | API key | List all voices |
| `GET` | `/v1/audio/voices/:id/preview` | API key | Get voice preview sample URL |
| `GET` | `/v1/models` | none | List all available models |
| `POST` | `/v1/spaces` | API key | Create a folder/space |
| `GET` | `/v1/accounts/plans` | API key | View account plan and credit status |
| `POST` | `/v1/accounts/plans/refresh` | API key | Trigger immediate plan re-check |
| `GET` | `/health` | none | Server status and live capacity |
| `GET` | `/logs` | none | Recent server logs |

---

## POST /v1/images/generate

Submits an image generation job. Returns a `job_id` **immediately** (HTTP 202). Poll `GET /v1/jobs/:id` for the result. Add `?wait=true` for legacy sync mode.

**Typical job time:** 5–30 s at 1K · 15–60 s at 2K · 30–120 s at 4K (varies by model).

### Request

```json
{
  "prompt": "a red apple on a wooden table",
  "model": "imagen-nano-banana-2",
  "num_images": 1,
  "aspect_ratio": "16:9",
  "resolution": "4k",
  "variations": false,
  "folder": "a17a3809-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

| Field | Type | Default | Required | Description |
|---|---|---|---|---|
| `prompt` | string | — | ✅ | Text description of the image |
| `model` | string | `"auto"` | | Model ID — see [Image Models](#image-models) |
| `num_images` | number | `1` | | Number of images to generate (1–4, model max applies) |
| `aspect_ratio` | string | `"1:1"` | | `"1:1"` `"16:9"` `"9:16"` `"4:3"` `"3:4"` `"3:2"` `"2:3"` `"5:4"` `"4:5"` `"21:9"` |
| `resolution` | string | `"1k"` | | Output quality tier: `"1k"` `"2k"` `"4k"`. Only valid for models that list `resolutions` in `GET /v1/models`. Returns HTTP 400 if the model does not support the requested tier. Aliases accepted: `"4K"` `"2160p"` `"uhd"` → `"4k"` · `"1440p"` → `"2k"` · `"1080p"` `"hd"` → `"1k"` |
| `variations` | boolean | `false` | | Generate creative prompt variations |
| `folder` | string | account default | | Space UUID — saves images into that folder |

### Response (async — HTTP 202)

```json
{
  "job_id": "job_28363f9b904cbef7e857",
  "status": "queued",
  "retry_after": 3,
  "poll_url": "/v1/jobs/job_28363f9b904cbef7e857"
}
```

Poll `GET /v1/jobs/:id` every `retry_after` seconds. When `status` is `completed`, the `result` contains:

```json
{
  "status": "completed",
  "result": {
    "images": [
      {
        "url": "https://pikaso.cdnpk.net/private/production/xxx/yyy.png?exp=...&hmac=...",
        "preview_url": "...",
        "revised_prompt": "a crisp red apple resting on a rustic wooden table...",
        "width": 5376,
        "height": 3072,
        "resolution": "4k",
        "mode": "imagen-nano-banana-2",
        "seed": "275022",
        "id": "KjXMRaNkqp",
        "family": "a1f15323-..."
      }
    ]
  },
  "account": "info@eleventhspace.com",
  "processing_time_ms": 89000
}
```

**Response image fields:**

| Field | Description |
|---|---|
| `url` | Full-resolution CDN URL (expires ~24h — download promptly) |
| `preview_url` | Lower-resolution preview (same image, compressed) |
| `revised_prompt` | Actual prompt used after Magnific's smart enhancement |
| `width` / `height` | Expected output pixel dimensions (computed from `aspect_ratio` + `resolution`) |
| `resolution` | Normalized resolution tier used: `"1k"` `"2k"` or `"4k"` |
| `mode` | Magnific mode ID that was used |
| `seed` | Generation seed (for reproducibility where supported) |
| `id` | Magnific creation identifier |
| `family` | Generation batch UUID (groups all images from one request) |

### Response (sync — `?wait=true`)

```json
{
  "created": 1749462400,
  "processing_time_ms": 89000,
  "data": [
    {
      "url": "https://pikaso.cdnpk.net/...",
      "revised_prompt": "...",
      "width": 5376,
      "height": 3072,
      "resolution": "4k",
      "mode": "imagen-nano-banana-2"
    }
  ],
  "account": "info@eleventhspace.com"
}
```

### Aspect Ratio → Base Dimensions (1K)

These are Magnific's native 1K pixel dimensions per aspect ratio. At 2K dimensions double; at 4K dimensions quadruple.

| `aspect_ratio` | 1K (default) | 2K | 4K |
|---|---|---|---|
| `1:1` | 1024 × 1024 | 2048 × 2048 | 4096 × 4096 |
| `16:9` | 1344 × 768 | 2688 × 1536 | 5376 × 3072 |
| `9:16` | 768 × 1344 | 1536 × 2688 | 3072 × 5376 |
| `4:3` | 1024 × 768 | 2048 × 1536 | 4096 × 3072 |
| `3:4` | 768 × 1024 | 1536 × 2048 | 3072 × 4096 |
| `3:2` | 1216 × 832 | 2432 × 1664 | 4864 × 3328 |
| `2:3` | 832 × 1216 | 1664 × 2432 | 3328 × 4864 |
| `5:4` | 1280 × 1024 | 2560 × 2048 | 5120 × 4096 |
| `4:5` | 832 × 1024 | 1664 × 2048 | 3328 × 4096 |
| `21:9` | 1536 × 656 | 3072 × 1312 | 6144 × 2624 |

> **Note:** Not all models support all aspect ratios. Models that support `resolution` are marked with a `resolutions` array in `GET /v1/models?type=image`. Requesting `"4k"` on a model without resolution support returns HTTP 400.

---

## POST /v1/images/generations

OpenAI-compatible endpoint. Accepts `model`, `prompt`, `n`, `size`. Useful for drop-in compatibility with OpenAI client libraries.

### Request

```json
{
  "model": "flux",
  "prompt": "a mountain lake at sunrise",
  "n": 1,
  "size": "1024x1024"
}
```

### Response

Same format as OpenAI's image generation response:

```json
{
  "created": 1716278400,
  "data": [
    { "url": "https://pikaso.cdnpk.net/..." }
  ]
}
```

---

## POST /v1/images/describe

Analyzes an image and returns an AI-generated text description and detected visual style. Unlimited on Premium+ — no credits consumed.

**Response time:** ~3–5 seconds.

### Request

Option A — image URL:
```json
{ "image_url": "https://example.com/photo.jpg" }
```

Option B — base64 data URL:
```json
{ "image_data": "data:image/png;base64,iVBORw0KGgo..." }
```

### Response

```json
{
  "description": "A red Nissan Magnite SUV parked outdoors with a light blue sky in the background",
  "style": "Photo",
  "uses_left": 4988,
  "account": "whora14@gmail.com"
}
```

| Field | Description |
|---|---|
| `description` | Natural language description of image content |
| `style` | Detected visual style: `"Photo"`, `"Illustration"`, `"Digital Art"`, etc. |
| `uses_left` | Remaining describe calls on this account for the period |

---

## POST /v1/images/remove-background

Removes the background from an image and returns a transparent PNG. Synchronous — no polling needed. Unlimited on Premium+ — no credits consumed.

**Response time:** ~2–5 seconds.

### Request

Option A — image URL:
```json
{ "image_url": "https://example.com/product.jpg" }
```

Option B — base64 data URL:
```json
{ "image_data": "data:image/jpeg;base64,/9j/4AAQ..." }
```

### Response

```json
{
  "result_b64": "data:image/png;base64,iVBORw0KGgo...",
  "account": "whora14@gmail.com"
}
```

`result_b64` is always a transparent PNG (RGBA) encoded as a base64 data URL. Paste it directly into an `<img src>` or decode and save as `.png`.

---

## POST /v1/images/upscale

Upscales and enhances an image using Magnific's upscaler. Supports 2×, 4×, 8× scaling with fine-grained control over creativity, resemblance, HDR, and engine style. Costs Magnific credits.

**Response time:** 30–120 seconds depending on image size and scale.

### Request

```json
{
  "image_url": "https://example.com/photo.jpg",
  "mode": "creative",
  "model": "magnific",
  "scale": 2,
  "engine": "automatic",
  "creativity": -3,
  "resemblance": 3,
  "hdr": 0,
  "fractality": 0,
  "optimized_for": "StandardUltra",
  "prompt": "",
  "folder": null
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `image_url` | string | required* | Public URL of image to upscale |
| `creation_id` | string | required* | Alternative to `image_url` — use ID from `POST /v1/upload` for local files |
| `mode` | string | `"creative"` | `"creative"` — AI-enhanced detail \| `"precision"` — faithful upscale |
| `model` | string | `"magnific"` | `"magnific"` \| `"classic"` |
| `scale` | number | `2` | `2` \| `4` \| `8` |
| `engine` | string | `"automatic"` | `"automatic"` \| `"illusio"` \| `"sharpy"` \| `"sparkle"` |
| `creativity` | number | `-3` | `-10` to `10` — how much AI adds new detail |
| `resemblance` | number | `3` | `-10` to `10` — how closely output matches input |
| `hdr` | number | `0` | `-10` to `10` — dynamic range enhancement |
| `fractality` | number | `0` | `-10` to `10` — texture complexity |
| `optimized_for` | string | `"StandardUltra"` | Subject type hint for the model |
| `prompt` | string | `""` | Optional text to guide creative enhancement |
| `folder` | string | account default | Space reference UUID to save into |

*One of `image_url` or `creation_id` is required.

### Response

```json
{
  "created": 1716278400,
  "data": {
    "url": "https://pikaso.cdnpk.net/private/production/.../upscaled.jpg",
    "preview_url": "https://pikaso.cdnpk.net/private/production/.../preview.jpg",
    "width": 2048,
    "height": 2048,
    "scale": 2,
    "mode": "creative",
    "model": "magnific",
    "engine": "automatic",
    "preset": "upscale",
    "id": "4123456789",
    "family": "a1b2c3d4-..."
  },
  "account": "whora14@gmail.com"
}
```

---

## POST /v1/upload

Uploads a local image (base64) to Magnific and returns a `creation_id` for use with `POST /v1/images/upscale`. Use this when you have a local file rather than a public URL.

### Request

```json
{ "image_data": "data:image/jpeg;base64,/9j/4AAQ..." }
```

| Field | Type | Required | Description |
|---|---|---|---|
| `image_data` | string | yes | Base64 data URL (`data:image/...;base64,...`) |

### Response

```json
{
  "creation_id": "temporal:reimagine-oGeWvLFZ...jpg",
  "account": "whora14@gmail.com"
}
```

Pass `creation_id` directly to `POST /v1/images/upscale` instead of `image_url`.

---

## GET /v1/jobs/:id

Poll a job for its current status. Call this after submitting any generation request.

```
GET /v1/jobs/job_28363f9b904cbef7e857
```

### Response

```json
{
  "id": "job_28363f9b904cbef7e857",
  "type": "image",
  "status": "completed",
  "model": "flux-2",
  "prompt": "a red apple on a wooden table",
  "result": { ... },
  "error": null,
  "account": "info@eleventhspace.com",
  "processing_time_ms": 11841,
  "created_at": 1780578537609,
  "updated_at": 1780578549452
}
```

| Field | Description |
|---|---|
| `status` | `"queued"` → `"processing"` → `"completed"` \| `"failed"` |
| `retry_after` | Seconds to wait before polling again (only on queued/processing) |
| `result` | Generation result — shape depends on `type` (see each endpoint's response) |
| `error` | Error message if `status === "failed"` |
| `processing_time_ms` | Total time from submission to completion |

**Jobs expire after 2 hours.** Returns `404` after expiry.

---

## GET /v1/jobs

List the last 100 jobs (all types, most recent first).

```json
{ "jobs": [...], "total": 12 }
```

---

## POST /v1/videos/generate

Submits a video generation job. Returns a `job_id` **immediately** (HTTP 202). Poll `GET /v1/jobs/:id` every 10 seconds for the result. Add `?wait=true` for legacy sync (connection held open, 10 min timeout).

**Typical job time:** 1–5 minutes depending on model.

**Generation time:** 2–10 minutes depending on model. Use a long HTTP timeout (15+ minutes) or implement async retry on your client.

### Request

```json
{
  "prompt": "a golden retriever running on a beach at sunset",
  "model": "kling-25",
  "negative_prompt": "",
  "aspect_ratio": "16:9",
  "duration": 5,
  "resolution": "720p",
  "sound_effects": true,
  "start_image": "https://example.com/frame1.jpg",
  "folder": "a17a3809-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

| Field | Type | Default | Required | Description |
|---|---|---|---|---|
| `prompt` | string | — | ✅ | Text description of the video |
| `model` | string | `"bytedance-seedance-fast-2.0"` | | Video model ID — see [Video Models](#video-models) below |
| `negative_prompt` | string | `""` | | Things to avoid in the video |
| `aspect_ratio` | string | `"16:9"` | | `"16:9"` `"9:16"` `"1:1"` (support varies by model) |
| `duration` | number | `5` | | Duration in seconds — valid values depend on model (e.g. `[5,10]` for Kling, `[4,6,8]` for Veo, `1–15` for PixVerse). Check `durations` in `GET /v1/models?type=video`. |
| `resolution` | string | model default | | Output resolution — e.g. `"720p"` `"1080p"` `"4K"` `"2160p"`. Valid values depend on model — check `resolutions` in `GET /v1/models?type=video`. For unlimited models, requesting a resolution above the free tier costs credits. |
| `sound_effects` | boolean | `true` | | Auto-generate sound effects (not supported on MiniMax models — ignored) |
| `start_image` | string | `null` | ⚠️ Required for some models | Start frame URL or base64 data URL (image-to-video). Check `features.start_image_required` in `GET /v1/models?type=video` — if `true`, omitting returns HTTP 400. If `features.start_image` is `false`, passing it returns HTTP 400. |
| `end_image` | string | `null` | | End frame URL or base64. Only on models where `features.end_image = true`. |
| `references` | array | `[]` | | Reference media: `[{"type": "image"\|"video"\|"style"\|"character"\|"product"\|"audio", "url": "..."}]`. Only on models where `features.references = true`. Max items = `features.refs_limit`. |
| `prompt_mode` | string | `"manual"` | | `"manual"` = use prompt exactly, `"auto"` = model re-interprets |
| `folder` | string | account default | | Folder UUID — saves video into that space |

### Response (async — HTTP 202)

```json
{ "job_id": "job_130704fa0511ab2f8c6c", "status": "queued", "retry_after": 10, "poll_url": "/v1/jobs/job_130704fa0511ab2f8c6c" }
```

When `status === "completed"`, `result` contains:

```json
{
  "url": "https://pikaso.cdnpk.net/private/production/xxx/yyy.mp4?exp=...&hmac=...",
  "prompt": "a dog running in a park",
  "model": "kling-25",
  "slug": "kling-25",
  "duration": 5,
  "aspect_ratio": "16:9",
  "resolution": "720p",
  "identifier": "ubTn4izQLD",
  "id": "3095654142"
}
```

> **Account routing:** All active accounts are eligible for video generation. For **unlimited models** (`kling-25`, `minimax-video-2_3`, `wan-2-2`, etc.) any active account is used. For **credit-based models** (e.g. `bytedance-seedance-fast-2.0` = 44 credits), the server automatically routes only to accounts with sufficient credits — zero-credit accounts are skipped.

---

## POST /v1/audio/generate

Submits an audio (TTS) generation job. Returns `job_id` immediately. Poll `GET /v1/jobs/:id` every 5 seconds.

**Typical job time:** 5–15 seconds.

### Request

```json
{
  "text": "Hello, this is a test of the text-to-speech system.",
  "model": "eleven_v3",
  "voice": "A-Xee",
  "style": "neutral",
  "speed": 1.0
}
```

| Field | Type | Default | Required | Description |
|---|---|---|---|---|
| `text` | string | — | ✅ | Script to convert to speech |
| `model` | string | `"eleven_v3"` | | Audio model ID — see [Audio Models](#audio-models) below |
| `voice` | string | first available | | Voice name, `provider_id`, or integer `id` from `/v1/audio/voices` |
| `voice_id` | string/number | `null` | | Explicit voice ID — skips name lookup |
| `style` | string | `"neutral"` | | `"expressive"` `"neutral"` `"consistent"` (ElevenLabs only — maps to stability) |
| `speed` | number | `1.0` | | Playback speed 0.5–2.0 (ElevenLabs only) |
| `temperature` | number | `1.0` | | Creativity 0.0–2.0 (Google TTS only) |
| `system_instruction` | string | `""` | | System prompt (Google TTS only) |
| `folder` | string | account default | | Folder UUID |

### Response

### Response (async — HTTP 202)

```json
{ "job_id": "job_bc9cea05e1fba74c285c", "status": "queued", "retry_after": 5, "poll_url": "/v1/jobs/job_bc9cea05e1fba74c285c" }
```

When completed, `result` contains:

```json
{
  "url": "https://pikaso.cdnpk.net/private/production/xxx/audio.mp3?token=...",
  "text": "Hello, this is a test of the async audio API.",
  "model": "eleven_v3",
  "voice": "Antara Bose",
  "voice_id": "FDQcYNtvPtQjNlTyU3du",
  "duration": 4,
  "identifier": "LUmBYLMswO",
  "id": "3095656150"
}
```

- ElevenLabs output: `.mp3` · Google TTS output: `.wav`
- CDN URL expires ~24h
- All audio models cost 5 Magnific credits per generation

---

## GET /v1/audio/voices

Returns all available TTS voices (516 total: 486 ElevenLabs + 30 Google).

### Query Parameters

| Param | Values | Description |
|---|---|---|
| `provider` | `elevenlabs` `google` | Filter by provider (omit for all) |

### Response

```json
[
  {
    "id": 570,
    "name": "A-Xee",
    "provider": "elevenlabs",
    "provider_id": "kD4dEWy2fbcyXlge6iHh",
    "gender": "male",
    "age": "young",
    "accent_id": "american",
    "preview_image_url": "https://pikaso.cdnpk.net/public/production/voices/images/Adeel_Qamar.png?w=512&h=512&preview=true",
    "example_mp3_url": "https://pikaso.cdnpk.net/public/production/voices/audio/Adeel_Qamar.mp3",
    "use_case": ["narration"],
    "categories": ["characters"]
  }
]
```

**Useful fields for filtering:**
- `provider` — `"elevenlabs"` or `"google"`
- `gender` — `"male"`, `"female"`
- `age` — `"young"`, `"middle_aged"`, `"old"`
- `accent_id` — e.g. `"american"`, `"british"`, `"australian"`

Pass any voice's `name`, `id`, or `provider_id` as the `voice` field in `/v1/audio/generate`.

---

## GET /v1/audio/voices/:id/preview

Returns the CDN sample URL and avatar for a voice so you can preview it before generating.

### Path Parameter

`:id` can be the integer `id`, the voice `name`, or the `provider_id`.

```
GET /v1/audio/voices/570/preview
GET /v1/audio/voices/A-Xee/preview
GET /v1/audio/voices/kD4dEWy2fbcyXlge6iHh/preview
```

### Response

```json
{
  "id": 570,
  "name": "A-Xee",
  "provider": "elevenlabs",
  "preview_url": "https://pikaso.cdnpk.net/public/production/voices/audio/Adeel_Qamar.mp3",
  "preview_image_url": "https://pikaso.cdnpk.net/public/production/voices/images/Adeel_Qamar.png?w=512&h=512&preview=true"
}
```

Preview CDN files are **publicly accessible** — no auth, no expiry. Safe to embed in `<audio src>` directly.

---

## GET /v1/models

Lists all available models. No authentication required.

### Query Parameters

| Param | Values | Description |
|---|---|---|
| `type` | `unlimited` `credits` `video` `audio` | Filter by model type (omit for all image models) |

```
GET /v1/models                  → all image models (43 total)
GET /v1/models?type=unlimited   → unlimited image models (34)
GET /v1/models?type=credits     → credit-based image models (9)
GET /v1/models?type=video       → video models (42)
GET /v1/models?type=audio       → audio/TTS models (6)
```

### Response (image)

Each image model includes reference-image support, max images per generation, and available resolution tiers:

```json
[
  {
    "id": "flux-2",
    "name": "Flux.2 Pro",
    "type": "unlimited",
    "credits": 0,
    "refs": true,
    "maxImages": 2,
    "resolutions": ["1k", "2k"]
  },
  {
    "id": "imagen-nano-banana-2-flash",
    "name": "Google Nano Banana 2",
    "type": "unlimited",
    "credits": 0,
    "refs": true,
    "maxImages": 4,
    "resolutions": ["1k", "2k", "4k"],
    "note": "Gemini 3.1 Flash"
  },
  {
    "id": "gpt-2",
    "name": "GPT 2",
    "type": "credits",
    "credits": 200,
    "refs": true,
    "maxImages": 1,
    "resolutions": ["1k", "2k", "4k"]
  }
]
```

### Response (video)

Each video model includes full capability metadata — resolutions, duration options, reference limits:

```json
[
  {
    "id": "kling-25",
    "name": "Kling 2.5",
    "credits": 0,
    "unlimited": true,
    "unlimitedResolution": "720p",
    "features": {
      "start_image": true,
      "end_image": true,
      "start_image_required": false,
      "references": false,
      "refs_limit": 0
    },
    "resolutions": ["1080p", "720p"],
    "durations": [5, 10]
  },
  {
    "id": "wan-2-2",
    "name": "Wan 2.2",
    "credits": 0,
    "unlimited": true,
    "unlimitedResolution": "480p",
    "features": {
      "start_image": true,
      "end_image": false,
      "start_image_required": true,
      "references": false,
      "refs_limit": 0
    },
    "resolutions": ["720p", "580p", "480p"],
    "durations": [5, 10]
  },
  {
    "id": "google-veo3_1",
    "name": "Google Veo 3.1",
    "credits": 800,
    "unlimited": false,
    "features": {
      "start_image": true,
      "end_image": true,
      "start_image_required": false,
      "references": true,
      "refs_limit": 3
    },
    "resolutions": ["4K", "1080p", "720p"],
    "durations": [4, 6, 8]
  }
]
```

### Response (audio)

```json
[
  {
    "id": "eleven_v3",
    "name": "ElevenLabs v3",
    "provider": "elevenlabs",
    "credits": 5
  }
]
```

---

## POST /v1/spaces

Creates a folder (Space) in Magnific. The `reference` UUID returned can be passed as `folder` in any generation request to save outputs into that space.

### Request

```json
{
  "name": "My Project",
  "description": "optional description",
  "access": "private"
}
```

### Response

```json
{
  "reference": "a17a3809-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "name": "My Project",
  "id": 12345
}
```

---

## GET /v1/accounts/plans

Returns current plan and credit status for all accounts.

### Response

```json
[
  {
    "name": "whora14@gmail.com",
    "status": "active",
    "plan": "Premium+",
    "planStatus": "expired",
    "credits": 0,
    "creditsTotal": 540000,
    "planExpiry": "2027-02-25",
    "video": false,
    "slots": { "active": 0, "total": 20, "queued": 0 }
  }
]
```

| Field | Description |
|---|---|
| `planStatus` | `"premium"` (active subscription) / `"expired"` (cancelled but session valid) / `"free"` (no subscription) |
| `credits` | Remaining credits for credit-based models |
| `video` | Video flag — informational only; all active accounts join the video pool regardless |
| `videoOverride` | `true` if the video flag was manually set via admin (won't be changed by plan checks) |

---

## POST /v1/accounts/plans/refresh

Triggers an immediate plan and credit re-check for all accounts. Returns after all checks complete.

No request body needed.

```json
{ "ok": true, "checked": 2 }
```

---

## GET /health

Returns server status and live concurrency stats. No auth required.

```json
{
  "status": "ok",
  "accounts": {
    "total": 2,
    "active": 2,
    "inactive": 0
  },
  "capacity": {
    "slots_per_account": 20,
    "total_slots": 40,
    "in_use": 3,
    "queued": 0
  },
  "uptime_seconds": 3600
}
```

---

## GET /logs

Returns the last 100 server log entries. Useful for debugging.

### Query Parameters

| Param | Default | Description |
|---|---|---|
| `limit` | `100` | Number of entries to return (max 500) |

### Response

```json
[
  {
    "ts": "2026-05-25T09:19:29.403Z",
    "level": "INFO",
    "msg": "[whora14@gmail.com] Done — 1 completed, 0 failed"
  }
]
```

---

## Image Models

Use any of these `id` values as the `model` field in `/v1/images/generate`. All IDs verified against Magnific's live API 2026-06-08.

**Column key:** `refs` = supports `references[]` image input · `max` = max images per generation · `resolutions` = available quality tiers (passed as `resolution` param; default = 1K)

### Unlimited — 34 models (no credits on Premium+/Pro)

| Model ID | Name | refs | max | Resolutions |
|---|---|---|---|---|
| `auto` | Auto | ✅ | 4 | default |
| **Flux.1 family** | | | | |
| `flux` | Flux.1 Fast | — | 12 | default |
| `flux-dev` | Flux.1 | ✅ | 8 | default |
| `flux-realism` | Flux.1 Realism | — | 12 | default |
| `flux-pro-plus` | Flux.1.1 | — | 12 | default |
| `flux-kontext` | Flux.1 Kontext Pro | ✅ | 8 | default |
| `flux-kontext-high` | Flux.1 Kontext Max | ✅ | 2 | default |
| **Flux.2 family** | | | | |
| `flux-2` | Flux.2 Pro | ✅ | 2 | 1K, 2K |
| `flux-2-klein` | Flux.2 Klein | ✅ | 2 | 1K, 2K |
| `flux-2-flex` | Flux.2 Flex | ✅ | 4 | 1K, 2K |
| **Classic** | | | | |
| `fast` | Classic Fast | — | 12 | default |
| `classic` | Classic | — | 12 | default |
| **Mystic family** | | | | |
| `mystic` | Mystic 1.0 | ✅ | 8 | default |
| `mystic-2-5` | Mystic 2.5 | ✅ | 8 | default |
| `mystic-2-5-flexible` | Mystic 2.5 Flexible | — | 12 | default |
| `mystic-2-5-fluid` | Mystic 2.5 Fluid | — | 8 | default |
| **Seedream family** | | | | |
| `seedream-4-5` | Seedream 4.5 | ✅ | 4 | 2K, 4K |
| `seedream-4` | Seedream 4 | ✅ | 4 | default |
| `seedream-4-4k` | Seedream 4 4K | ✅ | 4 | default |
| `seedream` | Seedream | ✅ | 4 | default |
| **Google** | | | | |
| `imagen-nano-banana` | Google Nano Banana | ✅ | 4 | default |
| `imagen-nano-banana-2-flash` | Google Nano Banana 2 (Gemini 3.1 Flash) | ✅ | 4 | 1K, 2K, **4K** |
| `imagen-nano-banana-2` | Google Nano Banana Pro (Gemini 3.0 Pro) | ✅ | 4 | 1K, 2K, **4K** |
| `imagen3` | Google Imagen 3 | — | 12 | default |
| `imagen4-fast` | Google Imagen 4 Fast | — | 8 | default |
| `imagen4` | Google Imagen 4 | — | 1 | default |
| `imagen4-ultra` | Google Imagen 4 Ultra | — | 1 | default |
| **Other** | | | | |
| `ideogram` | Ideogram | ✅ | 2 | default |
| `z-image` | Z-Image | — | 8 | default |
| `gpt-medium` | GPT | ✅ | 1 | default |
| `gpt-high` | GPT 1 - HQ | ✅ | 1 | default |
| `recraft-v4-1` | Recraft V4.1 | — | 4 | default |
| `runway-gen4` | Runway *(deprecated — still works)* | ✅ | 2 | default |
| `reve` | Reve *(currently inactive)* | ✅ | 8 | default |

> **Resolution tiers** for Nano Banana 2, Nano Banana Pro, Seedream 4.5: the `resolution` param controls output quality. `4K` produces the largest images. No separate model ID is needed — same model ID, different `resolution` value.

> **`gpt-medium` and `gpt-high`** are unlimited (Premium+ users can generate at no credit cost). Do **not** confuse with `gpt-1-5-medium`/`gpt-1-5-high` which are credit-based.

> **`recraft-v4-1`** is a hidden backend mode — not shown in Magnific's UI but confirmed valid. `recraft-v4` is the standard credit-based version.

### Credit-Based — 9 models (deduct credits even on Premium+)

| Model ID | Name | Credits | refs | max | Resolutions |
|---|---|---|---|---|---|
| `flux-2-max` | Flux.2 Max | 65 | ✅ | 1 | 1K, 2K |
| `seedream-5-lite` | Seedream 5 Lite | varies | ✅ | 4 | 2K, 3K |
| `qwen` | Qwen | varies | ✅ | 2 | default |
| `grok` | Grok | varies | ✅ | 8 | default |
| `recraft-v4` | Recraft V4 | varies | — | 4 | default |
| `recraft-v4-pro` | Recraft V4 Pro | 175 | — | 4 | default |
| `gpt-1-5-medium` | GPT 1.5 | 150 | ✅ | 1 | default |
| `gpt-1-5-high` | GPT 1.5 - High | 500 | ✅ | 1 | default |
| `gpt-2` | GPT 2 | 200 | ✅ | 1 | 1K, 2K, **4K** |

> **"varies"** — `seedream-5-lite`, `qwen`, `grok`, and `recraft-v4` consume credits but their exact per-image cost is not exposed in the API. Check the Magnific billing page for current rates.

> **Removed invalid models (2026-06-08):** `flux-sref`, `mystic-lora`, `mystic-sref`, `seedream-4-5-4k`, `ideogram-character`, `grok-edit`, `qwen-edit`, `imagen-nano-banana-2-4k`, `imagen-nano-banana-2-flash-2k`, `imagen-nano-banana-2-flash-4k` — all confirmed invalid (Magnific returns 422 "The selected mode is invalid"). Resolution variants (4K etc.) are a **parameter**, not separate model IDs.

---

## Video Models

Use any of these `id` values as the `model` field in `/v1/videos/generate`. All data verified against Magnific's live API 2026-06-08.

**Column key:**
- `Credits` — credits consumed per generation (0 = free/unlimited on plan)
- `sf` — `start_image` supported (✅ = optional, ⚠️ = **required**)
- `ef` — `end_image` supported
- `refs` — `references[]` supported (number = max allowed)
- `Resolutions` — output resolutions available (first = highest quality)
- `Duration (s)` — available clip lengths in seconds

### Unlimited video models (free on plan)

| Model ID | Name | sf | ef | refs | Resolutions | Duration (s) | Free resolution |
|---|---|---|---|---|---|---|---|
| `kling-25` | Kling 2.5 | ✅ | ✅ | — | 1080p, 720p | 5, 10 | 720p |
| `minimax-video-2_3` | MiniMax Hailuo 2.3 | ✅ | — | — | 1080p, 768p | 6, 10 | 768p |
| `minimax-video-2_3-fast` | MiniMax Hailuo 2.3 Fast | ⚠️ | — | — | 1080p, 768p | 6, 10 | 768p |
| `wan-2-2` | Wan 2.2 | ⚠️ | — | — | 720p, 580p, 480p | 5, 10 | 480p |

> **Free resolution** = quality used when generating without extra credits. Higher resolutions cost credits.
> **`minimax-video-2_3`** always defaults to 768p/6s. **`wan-2-2`** and **`minimax-video-2_3-fast`** require `start_image` — omitting returns HTTP 400.

### ByteDance

| Model ID | Name | Credits | sf | ef | refs | Resolutions | Duration (s) |
|---|---|---|---|---|---|---|---|
| `bytedance-seedance-fast-2.0` | Seedance 2.0 Fast | 44 | ✅ | ✅ | ✅ up to 9 | 720p, 480p | 4–15 |
| `bytedance-seedance-pro-2.0` | Seedance 2.0 | 57 | ✅ | ✅ | ✅ up to 9 | 1080p, 720p, 480p | 4–15 |
| `bytedance-seedance-pro-1.5` | Seedance 1.5 Pro | 180 | ✅ | ✅ | — | 1080p, 720p, 480p | 4–12 |
| `bytedance-omnihuman-lipsync` | Omni Human 1.5 | 540 | ⚠️ | — | — | — | 3, 30 |

### Kling

| Model ID | Name | Credits | sf | ef | refs | Resolutions | Duration (s) |
|---|---|---|---|---|---|---|---|
| `kling-30` | Kling 3.0 | 210 | ✅ | ✅ | — | **4K**, 1080p, 720p | 3–15 |
| `kling-omni3` | Kling 3.0 Omni | 210 | ✅ | ✅ | ✅ up to 7 | **4K**, 1080p, 720p | 3–15 |
| `kling-motion-control-30` | Kling 3.0 Motion Control | 330 | ⚠️ | — | — | 1080p, 720p | 3–15 |
| `kling-26` | Kling 2.6 | 225 | ✅ | ✅ | — | 1080p | 5, 10 |
| `kling-motion-control` | Kling 2.6 Motion Control | 150 | ⚠️ | — | — | 1080p, 720p | 3–10 |
| `kling-omni1` | Kling O1 | 225 | ✅ | ✅ | ✅ up to 7 | 1080p, 720p | 3–10 |
| `kling-21` | Kling 2.1 | 275 | ⚠️ | ✅ | — | 1080p, 720p | 5, 10 |
| `kling-21-master` | Kling 2.1 Master | 1400 | ✅ | — | — | 1080p | 5, 10 |

### Google

| Model ID | Name | Credits | sf | ef | refs | Resolutions | Duration (s) |
|---|---|---|---|---|---|---|---|
| `google-veo3_1` | Google Veo 3.1 | 800 | ✅ | ✅ | ✅ up to 3 | **4K**, 1080p, 720p | 4, 6, 8 |
| `google-veo3_1-fast` | Google Veo 3.1 Fast | 400 | ✅ | ✅ | — | **4K**, 1080p, 720p | 4, 6, 8 |
| `google-veo3_1-lite` | Google Veo 3.1 Lite | 160 | ✅ | ✅ | — | 1080p, 720p | 4, 6, 8 |
| `google-veo3` | Google Veo 3 | 800 | ✅ | — | — | 1080p, 720p | 4, 6, 8 |
| `google-veo3-fast` | Google Veo 3 Fast | 400 | ✅ | — | — | 1080p, 720p | 4, 6, 8 |
| `google-veo2` | Google Veo 2 | 1000 | ✅ | ✅ | — | 720p | 5, 6, 7, 8 |

### MiniMax

| Model ID | Name | Credits | sf | ef | refs | Resolutions | Duration (s) |
|---|---|---|---|---|---|---|---|
| `minimax-video-02` | MiniMax Hailuo 02 | 60 | ✅ | ✅ | — | 1080p, 768p, 512p | 6 |
| `minimax-video-01-live2d` | MiniMax Live Illustrations | 600 | ⚠️ | — | — | 720p | 5 |

### PixVerse

| Model ID | Name | Credits | sf | ef | refs | Resolutions | Duration (s) |
|---|---|---|---|---|---|---|---|
| `pixverse-6` | PixVerse 6 | 100 | ✅ | ✅ | — | 1080p, 720p, 540p, 360p | 1–15 |
| `pixverse-5-5` | PixVerse 5.5 | 500 | ✅ | ✅ | — | 1080p, 720p, 540p, 360p | 5, 8, 10 |

### Runway

| Model ID | Name | Credits | sf | ef | refs | Resolutions | Duration (s) |
|---|---|---|---|---|---|---|---|
| `runway-gen45` | Runway Gen-4.5 | 1100 | ✅ | — | — | 720p | 5, 8, 10 |
| `runway-std` | Runway Gen 4 | 500 | ⚠️ | — | — | 720p | 5, 10 |
| `runway-act-two` | Runway Act Two | 300 | — | — | ✅ up to 2 | 720p | 3, 30 |

### Wan

| Model ID | Name | Credits | sf | ef | refs | Resolutions | Duration (s) |
|---|---|---|---|---|---|---|---|
| `wan-2-7` | Wan 2.7 | 260 | ✅ | ✅ | ✅ up to 5 | 1080p, 720p | 2–15 |
| `wan-2-6` | Wan 2.6 | 1000 | ✅ | — | — | 1080p, 720p | 5, 10, 15 |
| `wan-2-5` | Wan 2.5 | 500 | ✅ | — | — | 1080p, 720p, 480p | 5, 10 |
| `wan-2-2-animate` | Wan 2.2 Animate Move | 600 | — | — | ✅ up to 2 | 720p, 580p, 480p | 3, 30 |
| `happy-horse-1` | Happy Horse | 720 | ✅ | — | ✅ up to 9 | 1080p, 720p | 3–15 |
| `happy-horse-1-edit` | Happy Horse Edit | 720 | — | — | ✅ up to 5 | 1080p, 720p | 3–15 |

### LTX

| Model ID | Name | Credits | sf | ef | refs | Resolutions | Duration (s) |
|---|---|---|---|---|---|---|---|
| `ltx-ltx2-fast` | LTX 2 Fast | 480 | ✅ | — | — | **2160p**, 1440p, 1080p | 6, 8, 10, 12, 14, 16, 18, 20 |
| `ltx-ltx2-pro` | LTX 2 Pro | 720 | ✅ | — | — | **2160p**, 1440p, 1080p | 6, 8, 10 |

### OpenAI Sora

| Model ID | Name | Credits | sf | ef | refs | Resolutions | Duration (s) |
|---|---|---|---|---|---|---|---|
| `openai-sora2-pro` | OpenAI Sora 2 Pro | 1800 | ✅ | — | — | 1080p, 1024p, 720p | 4, 8, 12, 16, 20 |
| `openai-sora2-standard` | OpenAI Sora 2 | 600 | ✅ | — | — | 720p | 4, 8, 12, 16, 20 |

### Grok

| Model ID | Name | Credits | sf | ef | refs | Resolutions | Duration (s) |
|---|---|---|---|---|---|---|---|
| `grok-default` | Grok | 80 | ✅ | — | — | 720p, 480p | 1–15 |

### Veed Fabric

| Model ID | Name | Credits | sf | ef | refs | Resolutions | Duration (s) |
|---|---|---|---|---|---|---|---|
| `veed-fabric-1.0` | Veed Fabric 1.0 | 420 | ⚠️ | — | — | 720p, 480p | 3, 300 |
| `veed-fabric-1.0-fast` | Veed Fabric 1.0 Fast | 540 | ⚠️ | — | — | 720p, 480p | 3, 300 |

---

### Video Model Notes

**`sf` column:**
- ✅ = `start_image` supported and **optional** (text-to-video works without it)
- ⚠️ = `start_image` is **required** — omitting it returns HTTP 400. Affected models: `bytedance-omnihuman-lipsync`, `kling-21`, `kling-motion-control`, `kling-motion-control-30`, `minimax-video-01-live2d`, `minimax-video-2_3-fast`, `runway-std`, `veed-fabric-1.0`, `veed-fabric-1.0-fast`, `wan-2-2`

**refs column** — `references[]` are media clips used as style/character anchors, not start frames. Format:
```json
"references": [{ "type": "image", "url": "https://..." }]
```
The number shown (e.g. "up to 9") is the maximum number of reference items the model accepts.

**Resolutions** — pass as the `resolution` field. The first listed is the highest quality. Lower resolutions are faster and cheaper. For unlimited models, the "Free resolution" column shows which tier is included at no credit cost.

**Duration** — ranges shown as "3–15" mean every integer second in that range is valid. Discrete lists (e.g. "5, 10") mean only those exact values are accepted.

**Notable highlights:**
- `kling-30`, `kling-omni3`, `google-veo3_1`, `google-veo3_1-fast` support **4K** output
- `ltx-ltx2-fast` and `ltx-ltx2-pro` support up to **2160p (4K)** and up to **20s** duration
- `veed-fabric-1.0` supports up to **300s** duration
- `pixverse-6` accepts **1–15s** in 1-second steps
- `openai-sora2-pro` supports up to **20s** at 1080p/1024p/720p

---

## Audio Models

All audio models cost **5 credits per generation**.

| Model ID | Name | Provider | Output | Notes |
|---|---|---|---|---|
| `eleven_v3` | ElevenLabs v3 | ElevenLabs | `.mp3` | ✅ Working |
| `eleven_turbo_v2_5` | ElevenLabs v2.5 Turbo | ElevenLabs | `.mp3` | ✅ Working |
| `gemini_v2_5_pro` | Gemini 2.5 Pro TTS | Google | `.wav` | ✅ Working |
| `elevenlabs_pepsi_v2` | ElevenLabs Pepsi v2 | ElevenLabs | `.mp3` | ❌ Enterprise only |
| `elevenlabs_pepsi_v3` | ElevenLabs Pepsi v3 | ElevenLabs | `.mp3` | ❌ Enterprise only |
| `gemini_v3_1_flash_tts` | Gemini 3.1 Flash TTS | Google | `.wav` | ❌ Not on current plans |

---

## Error Responses

All errors return JSON. For async jobs, check the `error` field on the job object (not the HTTP response).

```json
{ "error": "Specific reason here" }
```

### HTTP Status Codes

| HTTP | When | Meaning |
|---|---|---|
| `202` | Submit | Job accepted — poll `/v1/jobs/:id` |
| `400` | Submit | Bad request — missing/invalid params (e.g. `start_image` required, unknown model) |
| `401` | Any | Invalid or missing API key |
| `402` | Job result | Insufficient credits — see credit errors below |
| `404` | Poll | Job not found or expired (jobs live 2 hours) |
| `429` | Submit | All account slots busy — retry in a moment, or add more accounts |
| `500` | Job result | Server error or Magnific generation error |
| `503` | Submit | No active accounts available |

---

### Image Errors

**Insufficient credits (HTTP 402):**
```json
{ "error": "Not enough credits for model \"gpt-medium\" — check your account balance" }
```
Returned when the model costs credits and no account has enough. The server checks credits **before** calling Magnific — no wasted request.

**Bad model ID:**
```json
{ "error": "Unknown model \"gpt-xyz\". Call GET /v1/models to see available models." }
```

**Missing prompt:**
```json
{ "error": "prompt is required" }
```

---

### Video Errors

**Insufficient credits — pre-check fires before any Magnific request (HTTP 402):**
```json
{
  "error": "Insufficient credits for model \"openai-sora2-pro\" — requires 1800 credits, highest available: 291511. Top up an account or use an unlimited model like kling-25."
}
```
Returned immediately when all plan-checked accounts are confirmed under the credit threshold.

**Model temporarily unavailable (errorCode 500001, account has credits):**
```json
{ "error": "Video generation failed: Model \"bytedance-seedance-fast-2.0\" is temporarily unavailable or at capacity — try again in a few minutes" }
```

**Insufficient credits detected after queueing (errorCode 500001, no credits):**
```json
{ "error": "Video generation failed: Insufficient credits for model \"bytedance-seedance-fast-2.0\" (requires 44 credits)" }
```

**Model not available on account plan (e.g. Sora requires enterprise):**
```json
{ "error": "Video generation failed: Generation failed (errorCode invalid_value)" }
```

**start_image required but not provided:**
```json
{ "error": "Model \"minimax-video-2_3-fast\" requires start_image" }
```

**start_image provided to model that doesn't support it:**
```json
{ "error": "Model \"bytedance-seedance-fast-2.0\" does not support end_image" }
```

**Timed out (10 min server-side poll exceeded):**
```json
{ "error": "Video generation timed out after 10 minutes" }
```

---

### Audio Errors

**Insufficient credits (HTTP 402):**
```json
{ "error": "Insufficient credits for audio generation — all audio models cost 5 credits per request. Top up an account with audio credits." }
```

**Plan doesn't include voiceover feature:**
```json
{ "error": "Audio generation not available on this account's plan — voiceover feature required" }
```

**Auth failure (session expired):**
```json
{ "error": "Auth failed — session expired" }
```

**Timed out:**
```json
{ "error": "Audio generation timed out after 5 minutes" }
```

---

### General Errors

**All accounts tried and all failed:**
```json
{ "error": "Insufficient credits for model \"gpt-high\" — requires 500 credits, highest available: 0. ..." }
```
The actual underlying last error is propagated — not just "all accounts failed".

**No active accounts:**
```json
{ "error": "No active accounts available for video generation." }
```

**Account slots all busy:**
```json
{ "error": "Server busy — all 3 account(s) at capacity (60 total slots). Add more accounts to increase throughput." }
```

---

## CDN URLs

All generated file URLs (`pikaso.cdnpk.net`) are **signed** with `exp` (expiry timestamp) and `hmac` (signature). They expire approximately **24 hours** after generation. Download and store files if you need them longer term.

```
https://pikaso.cdnpk.net/private/production/xxx/yyy.png?exp=1716364800&hmac=abc123
```

---

## Concurrency & Rate Limits

The server manages a semaphore pool per account. Each account has **20 concurrent slots**. With 3 accounts, that's 60 total concurrent requests. Each new account you add increases capacity by 20.

- If all slots are occupied, new requests queue for up to **2 minutes**
- If the queue doesn't clear in 2 minutes, you'll receive a `429` with message `"Add more accounts to increase throughput"`
- No per-key rate limiting is enforced — limits are purely from Magnific's account capacity

Check live capacity at `GET /health`.

---

## Code Examples

### JavaScript / Node.js (async — recommended)

```js
const BASE = 'https://freepik-api-qg08.onrender.com';
const KEY = 'your_api_key';
const HEADERS = { 'X-API-Key': KEY, 'Content-Type': 'application/json' };

// Generic job poller — works for image, video, and audio
async function pollJob(jobId, intervalMs = 5000, timeoutMs = 600000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, intervalMs));
    const res = await fetch(`${BASE}/v1/jobs/${jobId}`, { headers: HEADERS });
    const job = await res.json();
    if (job.status === 'completed') return job.result;
    if (job.status === 'failed') throw new Error(job.error);
  }
  throw new Error('Job timed out');
}

// Generate image
async function generateImage(prompt, model = 'flux-2') {
  const { job_id, retry_after } = await fetch(`${BASE}/v1/images/generate`, {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({ prompt, model, aspect_ratio: '16:9' }),
  }).then(r => r.json());
  const result = await pollJob(job_id, retry_after * 1000);
  return result.images[0].url; // CDN image URL
}

// Generate video
async function generateVideo(prompt, model = 'kling-25') {
  const { job_id, retry_after } = await fetch(`${BASE}/v1/videos/generate`, {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({ prompt, model, aspect_ratio: '16:9' }),
  }).then(r => r.json());
  const result = await pollJob(job_id, retry_after * 1000, 600000); // 10 min max
  return result.url; // CDN video URL
}

// Generate audio
async function generateAudio(text, voice = 'A-Xee') {
  const { job_id, retry_after } = await fetch(`${BASE}/v1/audio/generate`, {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({ text, voice, model: 'eleven_v3' }),
  }).then(r => r.json());
  const result = await pollJob(job_id, retry_after * 1000);
  return result.url; // CDN MP3 URL
}
```

### Python (async)

```python
import requests, time

BASE = "https://freepik-api-qg08.onrender.com"
HEADERS = {"X-API-Key": "your_api_key", "Content-Type": "application/json"}

def poll_job(job_id, interval=5, timeout=600):
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(interval)
        r = requests.get(f"{BASE}/v1/jobs/{job_id}", headers=HEADERS)
        job = r.json()
        if job["status"] == "completed": return job["result"]
        if job["status"] == "failed": raise Exception(job["error"])
    raise TimeoutError("Job timed out")

# Generate image
r = requests.post(f"{BASE}/v1/images/generate", headers=HEADERS, json={
    "prompt": "a futuristic city at dawn", "model": "flux-2", "aspect_ratio": "16:9"
})
result = poll_job(r.json()["job_id"], interval=3)
print(result["images"][0]["url"])

# Generate video
r = requests.post(f"{BASE}/v1/videos/generate", headers=HEADERS, json={
    "prompt": "waves crashing on a rocky coast", "model": "kling-25"
})
result = poll_job(r.json()["job_id"], interval=10, timeout=600)
print(result["url"])

# Generate audio
r = requests.post(f"{BASE}/v1/audio/generate", headers=HEADERS, json={
    "text": "Hello world", "voice": "A-Xee", "model": "eleven_v3"
})
result = poll_job(r.json()["job_id"], interval=5)
print(result["url"])
```

### cURL (async workflow)

```bash
BASE="https://freepik-api-qg08.onrender.com"
KEY="YOUR_KEY"

# 1. Submit video job
JOB=$(curl -s -X POST $BASE/v1/videos/generate \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"prompt":"a wolf running through a forest","model":"kling-25"}')
JOB_ID=$(echo $JOB | grep -o '"job_id":"[^"]*"' | cut -d'"' -f4)
echo "Job: $JOB_ID"

# 2. Poll until done
while true; do
  STATUS=$(curl -s $BASE/v1/jobs/$JOB_ID -H "X-API-Key: $KEY")
  STATE=$(echo $STATUS | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
  echo "Status: $STATE"
  [ "$STATE" = "completed" ] || [ "$STATE" = "failed" ] && break
  sleep 10
done
echo $STATUS

# Legacy sync (old style — still works)
curl -X POST "$BASE/v1/videos/generate?wait=true" \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"prompt":"a wave crashing","model":"kling-25"}' --max-time 900

# Describe an image (sync — instant)
curl -X POST $BASE/v1/images/describe \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"image_url":"https://example.com/photo.jpg"}'
```

---

## Tips

- **Always use async** — submit job, get `job_id` immediately, poll until done. Use `?wait=true` only for quick scripts or testing
- **Poll with `retry_after`** — the response tells you how often to poll: 3s for images, 5s for audio, 10s for video. Don't poll faster than this
- **Jobs expire in 2 hours** — once `status === "completed"` store the `result.url` immediately; the job entry and CDN URL both expire
- **Credit routing is automatic** — zero-credit accounts are skipped for credit-based models; the server picks the best funded account automatically

### Image tips
- **Start with unlimited image models** — `flux-2`, `mystic-2-5`, `imagen-nano-banana-2-flash`, `auto` cost no credits and work out of the box
- **4K image generation** — add `"resolution": "4k"` to any model whose `resolutions` array includes `"4k"`: `imagen-nano-banana-2`, `imagen-nano-banana-2-flash`, `gpt-2`. Aliases `"4K"` / `"2160p"` / `"uhd"` are accepted and normalized. Returns HTTP 400 if the model doesn't support that tier
- **Reference images (`refs: true`)** — pass `references: [{"type": "image", "url": "..."}]`. Supported by 28 of 43 image models. Check the table in [Image Models](#image-models)
- **`gpt-medium` and `gpt-high`** are unlimited (no credits) — don't confuse with `gpt-1-5-medium`/`gpt-1-5-high` which cost credits
- **`flux-2-flex`** is unlimited (not credit-based) and supports 1K/2K output

### Video tips
- **Unlimited video** — `kling-25` (text-to-video, up to 1080p), `minimax-video-2_3` (text-to-video 768p/6s), `wan-2-2` (image-to-video, 480p, start_image required), `minimax-video-2_3-fast` (image-to-video, 768p, start_image required)
- **`start_image` required models** — `wan-2-2`, `minimax-video-2_3-fast`, `kling-21`, `kling-motion-control`, `kling-motion-control-30`, `bytedance-omnihuman-lipsync`, `minimax-video-01-live2d`, `runway-std`, `veed-fabric-1.0`, `veed-fabric-1.0-fast` — omitting `start_image` on these returns HTTP 400
- **4K video** — `kling-30`, `kling-omni3`, `google-veo3_1`, `google-veo3_1-fast` support 4K; LTX models support 2160p
- **Long-form video** — `veed-fabric-1.0/fast` supports up to 300s; `openai-sora2` supports up to 20s; LTX up to 20s; Grok and PixVerse 6 support 1–15s in 1s steps
- **Reference media in video** — models supporting `refs` accept style/character anchors, not just start frames. Check `refs_limit` for the max count per model
- **Always check `GET /v1/models?type=video`** — `resolutions` and `durations` arrays tell you exactly which values are valid for each model

### General
- **`revised_prompt`** — Magnific may enhance your prompt; the actual prompt used is in the result
- **CDN links expire ~24h** — download and store if needed long-term
- **Check capacity** — `GET /health` shows live slot availability; `GET /v1/jobs` shows queued/running jobs
- **Add accounts to scale** — each account adds 20 concurrent slots; credit accounts are automatically balanced
