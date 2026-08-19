/**
 * Core pipeline — everything here is free:
 *   1. Download the video with yt-dlp
 *   2. Extract 16kHz mono audio with ffmpeg
 *   3. Transcribe locally with whisper.cpp (nodejs-whisper) — free, no API
 *   4. Ask Groq's free Llama 3.3 70B to pick the best 15-90s moments
 *   5. Cut each moment with ffmpeg, crop to 9:16, burn in AI-generated captions
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import ytdlp from "youtube-dl-exec";
import Groq from "groq-sdk";
import { nodewhisper } from "nodejs-whisper";

ffmpeg.setFfmpegPath(ffmpegPath);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const TMP_DIR = path.join(__dirname, "..", "tmp");
export const OUTPUT_DIR = path.join(__dirname, "..", "output");

function updateJob(jobs, jobId, patch) {
  jobs[jobId] = { ...jobs[jobId], ...patch };
}

function ensureCookiesFile() {
  const writablePath = path.join(TMP_DIR, "cookies.txt");
  const secretFilePath = "/etc/secrets/cookies.txt";

  if (fs.existsSync(secretFilePath)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    fs.copyFileSync(secretFilePath, writablePath);
    return writablePath;
  }

  const b64 = process.env.YTDLP_COOKIES_B64;
  if (!b64) return null;
  if (!fs.existsSync(writablePath)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    fs.writeFileSync(writablePath, Buffer.from(b64, "base64").toString("utf-8"));
  }
  return writablePath;
}

async function downloadVideo(youtubeUrl, jobId) {
  const outPath = path.join(TMP_DIR, `${jobId}.mp4`);
  const cookiesPath = ensureCookiesFile();
  await ytdlp(youtubeUrl, {
    output: outPath,
    format: "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best",
    mergeOutputFormat: "mp4",
    noWarnings: true,
    noCheckCertificates: true,
    extractorArgs: "youtube:player_client=default,web_embedded",
    jsRuntimes: "node",
    remoteComponents: "ejs:github",
    ...(cookiesPath ? { cookies: cookiesPath } : {}),
  });
  return outPath;
}

function extractWav(videoPath, jobId) {
  const wavPath = path.join(TMP_DIR, `${jobId}.wav`);
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .audioChannels(1)
      .audioFrequency(16000)
      .format("wav")
      .on("end", () => resolve(wavPath))
      .on("error", reject)
      .save(wavPath);
  });
}

// whisper.cpp's .srt timestamp format: HH:MM:SS,mmm
function srtTimeToSeconds(t) {
  const [h, m, rest] = t.split(":");
  const [s, ms] = rest.split(",");
  return (+h) * 3600 + (+m) * 60 + (+s) + (+ms) / 1000;
}

function parseSrt(srtPath) {
  if (!fs.existsSync(srtPath)) return [];
  const raw = fs.readFileSync(srtPath, "utf-8").trim();
  if (!raw) return [];
  const blocks = raw.split(/\r?\n\r?\n/);
  const segments = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) continue;
    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) continue;
    const [startStr, endStr] = timeLine.split("-->").map((s) => s.trim());
    const text = lines.slice(lines.indexOf(timeLine) + 1).join(" ").trim();
    segments.push({
      start: srtTimeToSeconds(startStr),
      end: srtTimeToSeconds(endStr),
      text,
    });
  }
  return segments;
}

async function transcribe(videoPath, jobId, modelName = "base.en") {
  const wavPath = await extractWav(videoPath, jobId);
  await nodewhisper(wavPath, {
    modelName,
    autoDownloadModelName: modelName,
    removeWavFileAfterTranscription: false,
    whisperOptions: {
      outputInSrt: true,
      outputInText: false,
      outputInVtt: false,
      outputInCsv: false,
      translateToEnglish: false,
    },
  });
  const srtPath = wavPath.replace(/\.wav$/, ".srt");
  return parseSrt(srtPath);
}

function formatSrtTime(seconds) {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msRem = ms % 1000;
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(msRem, 3)}`;
}

function buildClipSrt(transcript, clipStart, clipEnd, srtPath) {
  let idx = 1;
  const entries = [];
  for (const seg of transcript) {
    if (seg.end <= clipStart || seg.start >= clipEnd) continue;
    const relStart = Math.max(seg.start, clipStart) - clipStart;
    const relEnd = Math.min(seg.end, clipEnd) - clipStart;
    if (relEnd <= relStart) continue;
    entries.push(`${idx}\n${formatSrtTime(relStart)} --> ${formatSrtTime(relEnd)}\n${seg.text}\n`);
    idx++;
  }
  fs.writeFileSync(srtPath, entries.join("\n"));
  return entries.length > 0;
}

async function askGroqForClips(transcript, numClips, minLen, maxLen, apiKey) {
  const groq = new Groq({ apiKey });
  let transcriptText = transcript
    .map((s) => `[${Math.floor(s.start)}s-${Math.floor(s.end)}s] ${s.text}`)
    .join("\n");
  if (transcriptText.length > 50000) {
    transcriptText = transcriptText.slice(0, 50000) + "\n...[transcript truncated]";
  }

  const prompt = `You are an expert short-form video editor who finds the most
"clippable" moments in long videos for Instagram Reels / YouTube Shorts.

Below is a timestamped transcript. Pick up to ${numClips} moments that would
work best as standalone vertical short clips. Each clip must be between
${minLen} and ${maxLen} seconds long, and should be a self-contained moment
(a strong hook, a punchline, a surprising fact, a complete story beat, or a
clear standalone insight) that makes sense without the rest of the video.
Prefer moments with a strong opening line in the first 1-2 seconds.

Transcript:
${transcriptText}

Respond with ONLY a JSON array (no markdown fences, no prose before or
after), where each item has this exact shape:
{"start": <number seconds>, "end": <number seconds>, "title": "<short catchy title, max 8 words>", "hook": "<first line to hook viewers, max 12 words>", "reason": "<one sentence why this works>", "score": <integer 1-10>}
Order by score, highest first.`;

  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    temperature: 0.4,
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  let raw = completion.choices[0].message.content.trim();
  raw = raw.replace(/^```json\s*|\s*```$/gm, "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("Could not parse Groq's response as JSON: " + raw.slice(0, 300));
    return JSON.parse(match[0]);
  }
}

function cutClip(videoPath, clip, transcript, outPath, jobDir, { burnCaptions, vertical }) {
  return new Promise((resolve, reject) => {
    const start = Number(clip.start);
    const end = Number(clip.end);
    const duration = Math.max(1, end - start);

    const filters = [];
    if (vertical) {
      filters.push("crop=ih*9/16:ih");
      filters.push("scale=1080:1920");
    }
    if (burnCaptions) {
      const srtPath = path.join(jobDir, path.basename(outPath) + ".srt");
      const hasCaptions = buildClipSrt(transcript, start, end, srtPath);
      if (hasCaptions) {
        const escaped = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:");
        const style =
          "FontName=Arial,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=90";
        filters.push(`subtitles='${escaped}':force_style='${style}'`);
      }
    }

    const cmd = ffmpeg(videoPath)
      .setStartTime(start)
      .duration(duration)
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions(["-crf 20", "-preset veryfast", "-b:a 128k"]);

    if (filters.length) cmd.videoFilters(filters.join(","));

    cmd.on("end", resolve).on("error", reject).save(outPath);
  });
}

export async function runPipeline(jobs, jobId, {
  youtubeUrl, groqApiKey, numClips = 5, minLen = 20, maxLen = 60,
  burnCaptions = true, vertical = true, whisperModel = "base.en",
}) {
  const jobDir = path.join(OUTPUT_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  try {
    updateJob(jobs, jobId, { status: "downloading", progress: 5 });
    const videoPath = await downloadVideo(youtubeUrl, jobId);

    updateJob(jobs, jobId, { status: "transcribing (free, local whisper.cpp)", progress: 25 });
    const transcript = await transcribe(videoPath, jobId, whisperModel);
    if (!transcript.length) throw new Error("Could not get a transcript (video may have no speech).");

    updateJob(jobs, jobId, { status: "finding highlights (free Groq API)", progress: 55 });
    const clips = await askGroqForClips(transcript, numClips, minLen, maxLen, groqApiKey);
    if (!clips || !clips.length) throw new Error("Groq didn't return any clip suggestions.");

    updateJob(jobs, jobId, { status: "cutting & captioning clips", progress: 70 });
    const results = [];
    const chosen = clips.slice(0, numClips);
    for (let i = 0; i < chosen.length; i++) {
      const clip = chosen[i];
      const outName = `clip_${i + 1}.mp4`;
      const outPath = path.join(jobDir, outName);
      await cutClip(videoPath, clip, transcript, outPath, jobDir, { burnCaptions, vertical });
      results.push({
        file: outName,
        title: clip.title || `Clip ${i + 1}`,
        hook: clip.hook || "",
        reason: clip.reason || "",
        score: clip.score ?? null,
        start: clip.start,
        end: clip.end,
      });
      updateJob(jobs, jobId, { progress: 70 + Math.round((25 * (i + 1)) / chosen.length) });
    }

    updateJob(jobs, jobId, { status: "done", progress: 100, clips: results, jobDir: jobId });
  } catch (err) {
    console.error(err);
    updateJob(jobs, jobId, { status: "error", error: err.message });
  }
}
