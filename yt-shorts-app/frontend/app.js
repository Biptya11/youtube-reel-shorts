const STORAGE_KEY = "yt_shorts_backend_url";

const form = document.getElementById("form");
const submitBtn = document.getElementById("submitBtn");
const progressBox = document.getElementById("progressBox");
const progressBar = document.getElementById("progressBar");
const statusText = document.getElementById("statusText");
const errorBox = document.getElementById("errorBox");
const results = document.getElementById("results");
const clipsGrid = document.getElementById("clipsGrid");
const setupBanner = document.getElementById("setupBanner");
const backendUrlInput = document.getElementById("backendUrl");
const saveBackendBtn = document.getElementById("saveBackend");
const changeBackendLink = document.getElementById("changeBackend");

let pollTimer = null;

function getBackendUrl() {
  return (localStorage.getItem(STORAGE_KEY) || "").replace(/\/+$/, "");
}

function showSetupBanner(show) {
  setupBanner.classList.toggle("hidden", !show);
}

function initBackendSetup() {
  const saved = getBackendUrl();
  if (saved) {
    backendUrlInput.value = saved;
    showSetupBanner(false);
  } else {
    showSetupBanner(true);
  }
}
initBackendSetup();

saveBackendBtn.addEventListener("click", () => {
  const val = backendUrlInput.value.trim();
  if (!val) return;
  localStorage.setItem(STORAGE_KEY, val.replace(/\/+$/, ""));
  showSetupBanner(false);
});

changeBackendLink.addEventListener("click", (e) => {
  e.preventDefault();
  showSetupBanner(true);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    showSetupBanner(true);
    return;
  }

  errorBox.classList.add("hidden");
  results.classList.add("hidden");
  clipsGrid.innerHTML = "";
  submitBtn.disabled = true;
  progressBox.classList.remove("hidden");
  progressBar.style.width = "0%";
  statusText.textContent = "Starting…";

  const payload = {
    url: document.getElementById("url").value,
    num_clips: document.getElementById("num_clips").value,
    min_len: document.getElementById("min_len").value,
    max_len: document.getElementById("max_len").value,
    burn_captions: document.getElementById("burn_captions").checked,
    vertical: document.getElementById("vertical").checked,
  };

  try {
    const res = await fetch(`${backendUrl}/api/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to start job");
    pollStatus(backendUrl, data.job_id);
  } catch (err) {
    showError(friendlyError(err));
  }
});

function pollStatus(backendUrl, jobId) {
  pollTimer = setInterval(async () => {
    try {
      const res = await fetch(`${backendUrl}/api/status/${jobId}`);
      const job = await res.json();
      if (!res.ok) throw new Error(job.error || "Status check failed");

      progressBar.style.width = `${job.progress || 0}%`;
      statusText.textContent = job.status || "";

      if (job.status === "done") {
        clearInterval(pollTimer);
        submitBtn.disabled = false;
        renderResults(backendUrl, jobId, job);
      } else if (job.status === "error") {
        clearInterval(pollTimer);
        submitBtn.disabled = false;
        showError(job.error);
      }
    } catch (err) {
      clearInterval(pollTimer);
      submitBtn.disabled = false;
      showError(friendlyError(err));
    }
  }, 2500);
}

function renderResults(backendUrl, jobId, job) {
  progressBox.classList.add("hidden");
  results.classList.remove("hidden");

  job.clips.forEach((clip) => {
    const src = `${backendUrl}/clips/${jobId}/${clip.file}`;
    const card = document.createElement("div");
    card.className = "clip-card";
    card.innerHTML = `
      <video src="${src}" controls playsinline></video>
      <h3>${escapeHtml(clip.title)}</h3>
      <p>${escapeHtml(clip.hook)}</p>
      <p>Score: ${clip.score ?? "–"}/10</p>
      <a href="${src}" download>Download</a>
    `;
    clipsGrid.appendChild(card);
  });
}

function friendlyError(err) {
  if (err instanceof TypeError) {
    return "Couldn't reach the backend. Check the backend URL in settings, and make sure it's deployed and awake (free Render instances sleep after 15 min idle — the first request wakes it up but takes ~30-60s).";
  }
  return err.message || String(err);
}

function showError(msg) {
  progressBox.classList.add("hidden");
  errorBox.classList.remove("hidden");
  errorBox.textContent = "Error: " + msg;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}
