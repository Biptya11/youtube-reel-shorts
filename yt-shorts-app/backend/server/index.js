import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { runPipeline, OUTPUT_DIR } from "./pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// Frontend lives elsewhere (Netlify/Vercel), so allow it to call this API
// from any origin. If you want to lock this down later, replace `cors()`
// with `cors({ origin: "https://your-frontend-domain.netlify.app" })`.
app.use(cors());
app.use(express.json());
app.use("/clips", express.static(OUTPUT_DIR));

app.get("/", (req, res) => {
  res.send("YouTube Shorts Generator API is running. The UI lives on your Netlify/Vercel frontend.");
});

// In-memory job store — fine for a single-user free-tier deployment.
const JOBS = {};

app.post("/api/process", (req, res) => {
  const { url, num_clips, min_len, max_len, burn_captions, vertical } = req.body || {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Missing YouTube URL" });
  }

  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    return res.status(500).json({
      error: "GROQ_API_KEY is not set on the server. Get a free key at console.groq.com and see README.md.",
    });
  }

  const jobId = uuidv4().slice(0, 12);
  JOBS[jobId] = { status: "queued", progress: 0 };

  runPipeline(JOBS, jobId, {
    youtubeUrl: url,
    groqApiKey,
    numClips: Number(num_clips) || 5,
    minLen: Number(min_len) || 20,
    maxLen: Number(max_len) || 60,
    burnCaptions: burn_captions !== false,
    vertical: vertical !== false,
  });

  res.json({ job_id: jobId });
});

app.get("/api/status/:jobId", (req, res) => {
  const job = JOBS[req.params.jobId];
  if (!job) return res.status(404).json({ error: "Unknown job id" });
  res.json(job);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running: http://localhost:${PORT}`);
});
