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

## Quick Start

```bash
# Generate an image
curl -X POST https://freepik-api-qg08.onrender.com/v1/images/generate \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "a futuristic city at night", "model": "flux-2", "aspect_ratio": "16:9"}'

# Generate a video
curl -X POST https://freepik-api-qg08.onrender.com/v1/videos/generate \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "a wave crashing on a rocky shore", "model": "kling-25", "aspect_ratio": "16:9"}'

# Generate speech audio
curl -X POST https://freepik-api-qg08.onrender.com/v1/audio/generate \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello, this is a test.", "voice": "A-Xee", "model": "eleven_v3"}'
```

---

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/images/generate` | API key | Generate images |
| `POST` | `/v1/images/generations` | API key | OpenAI-compatible image generation |
| `POST` | `/v1/images/describe` | API key | Describe an image with AI |
| `POST` | `/v1/images/remove-background` | API key | Remove background from image |
| `POST` | `/v1/videos/generate` | API key | Generate a video |
| `POST` | `/v1/audio/generate` | API key | Generate speech audio (TTS) |
| `GET` | `/v1/audio/voices` | API key | List all available voices |
| `GET` | `/v1/audio/voices/:id/preview` | API key | Get voice preview sample URL |
| `GET` | `/v1/models` | none | List all available models |
| `POST` | `/v1/spaces` | API key | Create a folder/space |
| `GET` | `/v1/accounts/plans` | API key | View account plan and credit status |
| `POST` | `/v1/accounts/plans/refresh` | API key | Force re-check all account plans |
| `GET` | `/health` | none | Server status and capacity |
| `GET` | `/logs` | none | Recent server logs |

---

## POST /v1/images/generate

Generates one or more images from a text prompt. This is the main image generation endpoint. All generated images are automatically deleted from the Magnific account after the CDN URL is returned — the URL itself remains valid for ~24 hours.

**Generation time:** 5–30 seconds depending on model and load.

### Request

```json
{
  "prompt": "a red apple on a wooden table",
  "model": "flux-2",
  "num_images": 1,
  "aspect_ratio": "1:1",
  "variations": false,
  "folder": "a17a3809-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

| Field | Type | Default | Required | Description |
|---|---|---|---|---|
| `prompt` | string | — | ✅ | Text description of the image |
| `model` | string | `"auto"` | | Model ID — see [Image Models](#image-models) below |
| `num_images` | number | `1` | | Number of images to generate (1–4) |
| `aspect_ratio` | string | `"1:1"` | | `"1:1"` `"16:9"` `"9:16"` `"4:3"` `"3:4"` `"3:2"` `"2:3"` |
| `variations` | boolean | `false` | | Generate creative prompt variations |
| `folder` | string | account default | | Space UUID — saves images into that folder |

### Response

```json
{
  "created": 1716278400,
  "data": [
    {
      "url": "https://pikaso.cdnpk.net/private/production/xxx/yyy.png?exp=...&hmac=...",
      "revised_prompt": "a crisp red apple resting on a rustic wooden table...",
      "model": "flux-2",
      "family": "a1d342d4-a543-4625-8a1d-afec8cc6fd3e",
      "width": 1024,
      "height": 576,
      "aspect_ratio": "1:1"
    }
  ],
  "account": "whora14@gmail.com",
  "processing_time_ms": 8420
}
```

| Field | Description |
|---|---|
| `data[].url` | CDN URL of the generated image — expires ~24h |
| `data[].revised_prompt` | The prompt as actually sent to the model (may differ from your input) |
| `data[].model` | Model ID used |
| `data[].family` | Internal generation batch UUID |
| `processing_time_ms` | Total server-side processing time in milliseconds |
| `account` | Which account processed the request |

### Aspect Ratio → Output Dimensions

| `aspect_ratio` | Width | Height |
|---|---|---|
| `1:1` | 1024 | 1024 |
| `16:9` | 1024 | 576 |
| `9:16` | 576 | 1024 |
| `4:3` | 1024 | 768 |
| `3:4` | 768 | 1024 |
| `3:2` | 1024 | 683 |
| `2:3` | 683 | 1024 |

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

## POST /v1/videos/generate

Generates a video from a text prompt (and optionally a start/end image). Polls internally until complete — the request stays open. All generated videos are auto-deleted from the account after the URL is captured.

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
| `aspect_ratio` | string | `"16:9"` | | `"16:9"` `"9:16"` `"1:1"` |
| `duration` | number | `5` | | Duration in seconds (1–10) |
| `resolution` | string | `"720p"` | | `"720p"` or `"1080p"` |
| `sound_effects` | boolean | `true` | | Auto-generate sound effects |
| `start_image` | string | `null` | ⚠️ Required for `wan-2-2`, `minimax-video-2_3-fast` | Start frame URL or base64 data URL (image-to-video). Only on models that support it — check `GET /v1/models?type=video` for `features.start_image`. Some models **require** it — omitting it returns HTTP 400. |
| `end_image` | string | `null` | | End frame URL or base64 data URL. Only on models that support it. |
| `references` | array | `[]` | | Reference media: `[{"type": "image"|"video"|"style"|"character"|"product"|"audio", "url": "..."}]`. Only on models with `features.references`. |
| `prompt_mode` | string | `"manual"` | | `"manual"` = use prompt exactly, `"auto"` = model re-interprets |
| `folder` | string | account default | | Folder UUID — saves video into that space |

### Response

```json
{
  "created": 1716278400,
  "data": {
    "url": "https://pikaso.cdnpk.net/private/production/xxx/yyy.mp4?exp=...&hmac=...",
    "prompt": "a golden retriever running on a beach at sunset",
    "model": "kling-25",
    "slug": "kling-25",
    "duration": 5,
    "aspect_ratio": "16:9",
    "resolution": "720p",
    "identifier": "01974...",
    "id": "01974..."
  },
  "account": "visualstudsales@gmail.com",
  "processing_time_ms": 142800
}
```

`data.url` is a CDN MP4 link that expires ~24h after generation.

> **Important:** Only accounts with the `video` flag enabled are used for video rotation. For **unlimited models** (`kling-25`, `minimax-video-2_3`, `wan-2-2`, etc.) no credits are needed. For **credit-based models** (e.g. `bytedance-seedance-fast-2.0` = 44 credits), the account must have enough credits — if not, Magnific queues the job but returns `status=failed` with no URL. Use unlimited video models when accounts are low on credits.

---

## POST /v1/audio/generate

Generates speech audio from text (TTS) using ElevenLabs or Google voices. Audio is auto-deleted from the account after the CDN URL is returned.

**Generation time:** 5–30 seconds.

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

```json
{
  "created": 1716278400,
  "data": {
    "url": "https://pikaso.cdnpk.net/private/production/xxx/audio.mp3?token=...",
    "text": "Hello, this is a test of the text-to-speech system.",
    "model": "eleven_v3",
    "voice": "A-Xee",
    "voice_id": "kD4dEWy2fbcyXlge6iHh",
    "duration": 4,
    "identifier": "EqzyeEJuuO",
    "id": "3023561766"
  },
  "account": "visualstudsales@gmail.com",
  "processing_time_ms": 7300
}
```

- ElevenLabs output: `.mp3`
- Google TTS output: `.wav`
- CDN URL expires ~24h

> **Important:** All audio models cost 5 credits per generation. Accounts without audio credits will fail with `INSUFFICIENT_CREDITS`.

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
GET /v1/models                  → all image models
GET /v1/models?type=unlimited   → unlimited Premium+ image models (41)
GET /v1/models?type=credits     → credit-based image models (11)
GET /v1/models?type=video       → video models (42)
GET /v1/models?type=audio       → audio/TTS models (6)
```

### Response (image)

```json
[
  {
    "id": "flux-2",
    "name": "Flux.2 Pro",
    "type": "unlimited",
    "credits": 0
  },
  {
    "id": "flux-2-flex",
    "name": "Flux.2 Flex",
    "type": "credits",
    "credits": 40
  }
]
```

### Response (video)

```json
[
  {
    "id": "kling-25",
    "name": "Kling 2.5",
    "credits": 0,
    "unlimited": true,
    "features": {
      "start_image": true,
      "end_image": true,
      "references": false
    }
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
| `video` | Whether this account can process video requests |

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

Use any of these `id` values as the `model` field in `/v1/images/generate`.

### Unlimited (no credits needed — Premium+ plan)

| Model ID | Name |
|---|---|
| `auto` | Auto (server picks best) |
| `flux` | Flux.1 Fast |
| `flux-dev` | Flux.1 |
| `flux-realism` | Flux.1 Realism |
| `flux-pro-plus` | Flux.1.1 |
| `flux-kontext` | Flux.1 Kontext Pro |
| `flux-kontext-high` | Flux.1 Kontext Max |
| `flux-sref` | Flux.1 Sref |
| `flux-2` | Flux.2 Pro |
| `flux-2-klein` | Flux.2 Klein |
| `fast` | Classic Fast |
| `classic` | Classic |
| `mystic` | Mystic 1.0 |
| `mystic-2-5` | Mystic 2.5 |
| `mystic-2-5-flexible` | Mystic 2.5 Flexible |
| `mystic-2-5-fluid` | Mystic 2.5 Fluid |
| `mystic-lora` | Mystic Lora |
| `mystic-sref` | Mystic Sref |
| `seedream-5-lite` | Seedream 5 Lite |
| `seedream-4-5` | Seedream 4.5 |
| `seedream-4-5-4k` | Seedream 4.5 4K |
| `seedream-4` | Seedream 4 |
| `seedream-4-4k` | Seedream 4 4K |
| `seedream` | Seedream |
| `imagen-nano-banana` | Google Nano Banana |
| `imagen-nano-banana-2` | Google Nano Banana Pro |
| `ideogram` | Ideogram |
| `ideogram-character` | Ideogram Character |
| `grok` | Grok |
| `grok-edit` | Grok Edit |
| `qwen` | Qwen |
| `qwen-edit` | Qwen Edit |
| `reve` | Reve |
| `recraft-v4` | Recraft V4 |
| `recraft-v4-1` | Recraft V4.1 |
| `z-image` | Z-Image |

### Credit-Based

| Model ID | Name | Credits/image |
|---|---|---|
| `imagen-nano-banana-2-4k` | Google Nano Banana Pro 4K | 150 |
| `imagen-nano-banana-2-flash-2k` | Google Nano Banana Pro 2K | 75 |
| `imagen-nano-banana-2-flash-4k` | Google Nano Banana Pro Flash 4K | 150 |
| `flux-2-flex` | Flux.2 Flex | 40 |
| `flux-2-max` | Flux.2 Max | 65 |
| `recraft-v4-pro` | Recraft V4 Pro | 175 |
| `gpt-medium` | GPT | 150 |
| `gpt-high` | GPT 1 - HQ | 500 |
| `gpt-1-5-medium` | GPT 1.5 | 150 |
| `gpt-1-5-high` | GPT 1.5 - High | 500 |
| `gpt-2` | GPT 2 | 200 |

---

## Video Models

Use any of these `id` values as the `model` field in `/v1/videos/generate`. Check `features` from `GET /v1/models?type=video` to know which models support `start_image`, `end_image`, `references`.

| Model ID | Name | Credits | sf | ef | refs |
|---|---|---|---|---|---|
| `bytedance-seedance-fast-2.0` | Seedance 2.0 Fast | 44 | ✅ | ✅ | ✅ |
| `bytedance-seedance-pro-2.0` | Seedance 2.0 Pro | 57 | ✅ | ✅ | ✅ |
| `bytedance-seedance-pro-1.5` | Seedance 1.5 Pro | 180 | ✅ | ✅ | — |
| `bytedance-omnihuman-lipsync` | Omni Human 1.5 | 540 | ✅ | — | — |
| `kling-30` | Kling 3.0 | 210 | ✅ | ✅ | — |
| `kling-omni3` | Kling 3.0 Omni | 210 | ✅ | ✅ | ✅ |
| `kling-motion-control-30` | Kling 3.0 Motion Control | 330 | ✅ | — | — |
| `kling-26` | Kling 2.6 | 225 | ✅ | ✅ | — |
| `kling-motion-control` | Kling 2.6 Motion Control | 150 | ✅ | — | — |
| `kling-25` | **Kling 2.5 (∞ Unlimited)** | 0 | ✅ | ✅ | — |
| `kling-21` | Kling 2.1 | 275 | ✅ | ✅ | — |
| `kling-21-master` | Kling 2.1 Master | 1400 | ✅ | — | — |
| `kling-omni1` | Kling O1 | 225 | ✅ | ✅ | ✅ |
| `minimax-video-2_3` | **MiniMax Hailuo 2.3 (∞ Unlimited)** | 0 | ✅ optional | — | — |
| `minimax-video-2_3-fast` | **MiniMax Hailuo 2.3 Fast (∞ Unlimited)** | 0 | ✅ **required** | — | — |
| `minimax-video-02` | MiniMax Hailuo 02 | 60 | ✅ | ✅ | — |
| `minimax-video-01-live2d` | MiniMax Live Illustrations | 600 | ✅ | — | — |
| `wan-2-7` | Wan 2.7 | 260 | ✅ | ✅ | ✅ |
| `wan-2-6` | Wan 2.6 | 1000 | ✅ | — | — |
| `wan-2-5` | Wan 2.5 | 500 | ✅ | — | — |
| `wan-2-2` | **Wan 2.2 (∞ Unlimited, 480p max)** | 0 | ✅ **required** | — | — |
| `wan-2-2-animate` | Wan 2.2 Animate Move | 600 | — | — | ✅ |
| `pixverse-6` | PixVerse 6 | 100 | ✅ | ✅ | — |
| `pixverse-5-5` | PixVerse 5.5 | 500 | ✅ | ✅ | — |
| `runway-gen45` | Runway Gen-4.5 | 1100 | ✅ | — | — |
| `runway-std` | Runway Gen 4 | 500 | ✅ | — | — |
| `runway-act-two` | Runway Act Two | 300 | — | — | ✅ |
| `google-veo3_1` | Google Veo 3.1 | 800 | ✅ | ✅ | ✅ |
| `google-veo3_1-fast` | Google Veo 3.1 Fast | 400 | ✅ | ✅ | — |
| `google-veo3_1-lite` | Google Veo 3.1 Lite | 160 | ✅ | ✅ | — |
| `google-veo3` | Google Veo 3 | 800 | ✅ | — | — |
| `google-veo3-fast` | Google Veo 3 Fast | 400 | ✅ | — | — |
| `google-veo2` | Google Veo 2 | 1000 | ✅ | ✅ | — |
| `openai-sora2-pro` | OpenAI Sora 2 Pro | 1800 | ✅ | — | — |
| `openai-sora2-standard` | OpenAI Sora 2 | 600 | ✅ | — | — |
| `grok-default` | Grok Video | 80 | ✅ | — | — |
| `ltx-ltx2-fast` | LTX 2 Fast | 480 | ✅ | — | — |
| `ltx-ltx2-pro` | LTX 2 Pro | 720 | ✅ | — | — |
| `veed-fabric-1.0` | Veed Fabric 1.0 | 420 | ✅ | — | — |
| `veed-fabric-1.0-fast` | Veed Fabric 1.0 Fast | 540 | ✅ | — | — |
| `happy-horse-1` | Happy Horse | 720 | ✅ | — | ✅ |
| `happy-horse-1-edit` | Happy Horse Edit | 720 | — | — | ✅ |

**sf** = start image (image-to-video), **ef** = end image, **refs** = reference media

> **`wan-2-2` note:** `start_image` is **required** — omitting it returns HTTP 400. Resolution is capped at **480p** regardless of what you pass.
>
> **MiniMax Hailuo 2.3 notes:**
> - `minimax-video-2_3` — text-to-video (start_image optional). Always generates at **768p, 6 seconds** regardless of `resolution`/`duration` values passed.
> - `minimax-video-2_3-fast` — image-to-video, `start_image` is **required** — omitting it returns HTTP 400. Same 768p/6s defaults apply.
> - `sound_effects` is ignored for both MiniMax models (they don't support it).

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

All errors return JSON with an `error` field and appropriate HTTP status.

```json
{ "error": "Prompt is required" }
```

| HTTP Status | Meaning |
|---|---|
| `400` | Bad request — missing or invalid parameters |
| `401` | Invalid or missing API key |
| `429` | All accounts are busy or rate limited — retry after a moment, or add more accounts |
| `500` | Server error — check `/logs` for details |
| `503` | No active accounts available |

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

### JavaScript / Node.js

```js
const BASE = 'https://freepik-api-qg08.onrender.com';
const KEY = 'your_api_key';

async function generateImage(prompt, model = 'flux-2') {
  const res = await fetch(`${BASE}/v1/images/generate`, {
    method: 'POST',
    headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, model, aspect_ratio: '16:9' }),
  });
  const data = await res.json();
  return data.data[0].url; // CDN image URL
}

async function generateVideo(prompt, model = 'kling-25') {
  const res = await fetch(`${BASE}/v1/videos/generate`, {
    method: 'POST',
    headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, model, aspect_ratio: '16:9', duration: 5 }),
    signal: AbortSignal.timeout(900_000), // 15 min timeout
  });
  const data = await res.json();
  return data.data.url; // CDN video URL
}
```

### Python

```python
import requests

BASE = "https://freepik-api-qg08.onrender.com"
HEADERS = {"X-API-Key": "your_api_key", "Content-Type": "application/json"}

# Generate image
r = requests.post(f"{BASE}/v1/images/generate", headers=HEADERS, json={
    "prompt": "a futuristic city at dawn",
    "model": "flux-2",
    "aspect_ratio": "16:9",
    "num_images": 1
})
print(r.json()["data"][0]["url"])

# Generate video (long timeout)
r = requests.post(f"{BASE}/v1/videos/generate", headers=HEADERS, json={
    "prompt": "waves crashing on a rocky coast",
    "model": "kling-25",
    "aspect_ratio": "16:9",
    "duration": 5
}, timeout=900)
print(r.json()["data"]["url"])

# Remove background
r = requests.post(f"{BASE}/v1/images/remove-background", headers=HEADERS, json={
    "image_url": "https://example.com/product.jpg"
})
b64 = r.json()["result_b64"]  # data:image/png;base64,...
```

### cURL

```bash
# List all unlimited image models
curl https://freepik-api-qg08.onrender.com/v1/models?type=unlimited

# Generate image
curl -X POST https://freepik-api-qg08.onrender.com/v1/images/generate \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a wolf in a neon forest","model":"mystic-2-5","aspect_ratio":"1:1"}'

# Generate video with start image (kling-25 — start_image optional)
curl -X POST https://freepik-api-qg08.onrender.com/v1/videos/generate \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"camera slowly panning right","model":"kling-25","start_image":"https://example.com/frame.jpg","aspect_ratio":"16:9"}' \
  --max-time 900

# Generate video with wan-2-2 (unlimited, start_image REQUIRED, 480p only)
curl -X POST https://freepik-api-qg08.onrender.com/v1/videos/generate \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"rainy forest with nostalgic thunderstorm","model":"wan-2-2","start_image":"https://example.com/forest.jpg","aspect_ratio":"16:9","resolution":"480p"}' \
  --max-time 900

# Generate video with minimax-video-2_3-fast (unlimited, start_image REQUIRED, always 768p/6s)
curl -X POST https://freepik-api-qg08.onrender.com/v1/videos/generate \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"person walking forward","model":"minimax-video-2_3-fast","start_image":"https://example.com/person.jpg","aspect_ratio":"16:9"}' \
  --max-time 900

# Describe an image
curl -X POST https://freepik-api-qg08.onrender.com/v1/images/describe \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"image_url":"https://example.com/photo.jpg"}'

# List voices (ElevenLabs only)
curl "https://freepik-api-qg08.onrender.com/v1/audio/voices?provider=elevenlabs" \
  -H "X-API-Key: YOUR_KEY"

# Generate speech
curl -X POST https://freepik-api-qg08.onrender.com/v1/audio/generate \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"Good morning, how can I help you today?","voice":"A-Xee","model":"eleven_v3"}'
```

---

## Tips

- **Start with unlimited models** — `flux-2`, `flux`, `mystic-2-5`, `imagen-nano-banana-2`, `kling-25` (video), `minimax-video-2_3` (video) all cost no credits and work out of the box
- **`wan-2-2`** is unlimited but requires `start_image` and caps at 480p — use `kling-25` or `minimax-video-2_3` for text-only or higher-res unlimited video
- **`minimax-video-2_3`** — free text-to-video at 768p/6s; **`minimax-video-2_3-fast`** — free image-to-video (start_image required), also 768p/6s
- **Check model availability** — hit `GET /v1/models` first to see what's available with the current accounts
- **Use `/health`** to see real-time slot availability before submitting long jobs
- **Video timeout** — always set your HTTP client timeout to at least 15 minutes for video requests
- **CDN links expire** — download and store within 24 hours if the file is important
- **`revised_prompt`** — the actual prompt sent to the model may differ from yours (Magnific applies smart prompt enhancement by default)
- **Variations** — set `"variations": true` on image requests for more creative, diverse outputs
