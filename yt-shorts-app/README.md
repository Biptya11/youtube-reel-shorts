# YouTube → Reels/Shorts Generator

Two folders, two homes, both free:

- **`backend/`** → deploy to **Render** (free tier). Does the actual work:
  downloads the video, transcribes it locally with whisper.cpp (free AI
  captions), asks Groq's free AI to pick the best moments, cuts + crops +
  burns in captions with ffmpeg.
- **`frontend/`** → deploy to **Netlify** or **Vercel** (free). Just the UI —
  a few static files, no build step, so it really is a drag-and-drop upload.

**Why split it?** Netlify/Vercel are built for static sites and short
serverless functions (seconds, not minutes) with no persistent storage —
there's no way to run video downloading/transcoding/AI transcription there,
regardless of what language it's written in. The backend needs an actual
always-on-ish server, which Render's free tier provides.

---

## Step 1 — Deploy the backend to Render

1. Push the `backend/` folder to its own GitHub repo (or the whole project,
   Render will just point at the `backend` folder).
2. On https://render.com → **New +** → **Web Service** → connect the repo.
   - Root directory: `backend` (if you pushed the whole project)
   - Render should auto-detect the `Dockerfile` — this matters, it's what
     lets whisper.cpp compile reliably.
3. Instance type: **Free**.
4. Environment variable: `GROQ_API_KEY` = a free key from
   https://console.groq.com/keys (no card needed).
5. Deploy. Copy the URL Render gives you, e.g.
   `https://yt-shorts-backend.onrender.com`.

## Step 2 — Deploy the frontend to Netlify or Vercel

**Netlify (drag-and-drop, easiest):**
1. Go to https://app.netlify.com/drop
2. Drag the `frontend/` folder straight into the browser window.
3. Done — you get a live URL immediately.

**Vercel:**
1. https://vercel.com/new → import the repo → set root directory to
   `frontend` → deploy. (No framework/build step needed, it's static.)

## Step 3 — Connect them

Open your new Netlify/Vercel URL. On first visit it'll ask for your backend
URL — paste the Render URL from Step 1. It's saved in your browser, so you
only do this once. Works the same on your phone or laptop, from anywhere,
no local script required.

---

## Heads-up on the free tiers

- **Render free tier**: 512MB RAM, spins down after 15 min idle (first
  request after that takes ~30-60s to wake up — the frontend will show a
  friendly message if this happens). Fine for occasional personal use;
  long/high-res videos may need the smaller `tiny.en` whisper model — see
  `backend/server/pipeline.js`.
- **Groq free tier**: generous limits for personal use; hitting a rate
  limit just means "wait a bit," not a bill.
- **Netlify/Vercel free tier**: effectively unlimited for a low-traffic
  static site like this frontend.

## Legal note

Only run this on your own videos or ones you're licensed to repurpose.

## Project structure

```
yt-shorts-app/
├── backend/            → deploy to Render
│   ├── server/
│   │   ├── index.js
│   │   └── pipeline.js
│   ├── package.json
│   ├── Dockerfile
│   └── .env.example
└── frontend/            → deploy to Netlify/Vercel (drag-and-drop)
    ├── index.html
    ├── style.css
    └── app.js
```
