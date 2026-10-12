const form = document.querySelector("#profile-form");
const submitButton = form.querySelector('button[type="submit"]');
const formError = document.querySelector("#form-error");
const apiStatus = document.querySelector("#api-status");
const apiStatusText = document.querySelector("#api-status-text");
const emptyState = document.querySelector("#empty-state");
const resultState = document.querySelector("#result-state");
const loadingState = document.querySelector("#loading-state");

const factorLabels = {
  ai_ml_skill: "AI / ML skill",
  cgpa: "CGPA",
  dsa_problems: "DSA problems solved",
  github_contributions: "GitHub contributions",
  leetcode_rating: "LeetCode rating",
};

const scoreInputs = new Set([
  "cgpa",
  "coding_score",
  "communication_score",
  "aptitude_score",
  "leetcode_rating",
  "ai_ml_skill",
  "system_design",
  "resume_score",
  "mock_interview_score",
]);

async function checkApiStatus() {
  try {
    const response = await fetch("/health");
    if (!response.ok) throw new Error(`Health check returned ${response.status}`);
    apiStatus.classList.add("is-online");
    apiStatus.classList.remove("is-offline");
    apiStatusText.textContent = "Prediction service online";
  } catch {
    apiStatus.classList.add("is-offline");
    apiStatus.classList.remove("is-online");
    apiStatusText.textContent = "Service unavailable";
  }
}

function formatFactor(factor) {
  if (factorLabels[factor]) return factorLabels[factor];
  return factor.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function renderFactors(container, factors, positive) {
  container.replaceChildren();
  if (!factors.length) {
    const message = document.createElement("span");
    message.className = "factor-empty";
    message.textContent = "Factor breakdown isn’t available for this result.";
    container.append(message);
    return;
  }

  for (const factor of factors) {
    const chip = document.createElement("span");
    chip.className = positive ? "factor-chip positive" : "factor-chip";
    chip.textContent = formatFactor(factor);
    container.append(chip);
  }
}

let lastScore = null;
let animFrame = 0;

function animateScore(from, to) {
  const ring = document.querySelector("#score-ring");
  const value = document.querySelector("#score-value");
  cancelAnimationFrame(animFrame);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const start = performance.now();
  const duration = reduced ? 0 : 800;
  const tick = (now) => {
    const t = duration ? Math.min(1, (now - start) / duration) : 1;
    const eased = 1 - Math.pow(1 - t, 3);
    const current = from + (to - from) * eased;
    value.textContent = `${current.toFixed(1)}%`;
    ring.style.setProperty("--score-angle", `${current * 3.6}deg`);
    if (t < 1) animFrame = requestAnimationFrame(tick);
  };
  animFrame = requestAnimationFrame(tick);
}

function showResult(data) {
  const score = Math.min(100, Math.max(0, Number(data.readiness_percent)));
  document.querySelector("#score-ring").dataset.band = score >= 70 ? "high" : score >= 50 ? "mid" : "low";
  animateScore(lastScore ?? 0, score);

  const delta = document.querySelector("#result-delta");
  if (lastScore === null) {
    delta.hidden = true;
  } else if (Math.abs(score - lastScore) >= 0.1) {
    const diff = score - lastScore;
    delta.textContent = `${diff > 0 ? "▲ +" : "▼ "}${diff.toFixed(1)} pts since last estimate`;
    delta.className = `result-delta ${diff > 0 ? "up" : "down"}`;
    delta.hidden = false;
  }
  lastScore = score;

  const badge = document.querySelector("#result-badge");
  badge.textContent = data.label;
  badge.classList.toggle("needs-improvement", data.label !== "Ready");
  document.querySelector("#result-description").textContent =
    data.label === "Ready"
      ? "Your profile shows promising signals. Keep building on what’s working."
      : "You have a starting point. Use the signals below to guide your next steps.";

  renderFactors(document.querySelector("#strongest-factors"), data.strongest_factors ?? [], true);
  renderFactors(document.querySelector("#weakest-factors"), data.weakest_factors ?? [], false);
  emptyState.hidden = true;
  resultState.hidden = false;
}

function buildPayload() {
  const payload = Object.fromEntries(new FormData(form).entries());
  for (const [key, value] of Object.entries(payload)) {
    payload[key] = scoreInputs.has(key) ? Number.parseFloat(value) : Number.parseInt(value, 10);
  }
  return payload;
}

let requestId = 0;

async function predict({ silent }) {
  const id = ++requestId;
  formError.hidden = true;
  formError.textContent = "";

  if (!silent) {
    submitButton.disabled = true;
    loadingState.hidden = false;
    resultState.hidden = true;
  }

  try {
    const response = await fetch("/v1/predict-readiness", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload()),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const detail = typeof body?.detail === "string" ? body.detail : "Please check your profile and try again.";
      throw new Error(detail);
    }

    const data = await response.json();
    if (id === requestId) showResult(data);
  } catch (error) {
    if (id !== requestId) return;
    resultState.hidden = true;
    formError.textContent =
      error instanceof TypeError
        ? "Couldn’t connect to the prediction service. Check that it’s running, then try again."
        : error.message;
    formError.hidden = false;
  } finally {
    if (id === requestId) {
      loadingState.hidden = true;
      submitButton.disabled = false;
    }
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  predict({ silent: false });
});

// --- Interactivity: sliders, progress, live updates, sample/reset ---

const requiredInputs = [...form.querySelectorAll("input[required]")];
const progressBar = document.querySelector("#progress-bar");
const progressLabel = document.querySelector("#progress-label");
const sliderMeta = { cgpa: { max: 10, step: 0.1 } };
const syncers = [];

function setupSliders() {
  for (const input of form.querySelectorAll("input[type=number]")) {
    if (!scoreInputs.has(input.name)) continue;
    const meta = sliderMeta[input.name] ?? { max: 100, step: 1 };
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = String(meta.max);
    slider.step = String(meta.step);
    slider.className = "range";
    slider.tabIndex = -1;
    slider.setAttribute("aria-label", `${input.name.replaceAll("_", " ")} slider`);
    const sync = () => {
      const v = Number.parseFloat(input.value);
      const val = Number.isFinite(v) ? Math.min(meta.max, Math.max(0, v)) : 0;
      slider.value = String(val);
      slider.style.setProperty("--fill", `${(val / meta.max) * 100}%`);
    };
    slider.addEventListener("input", (event) => {
      event.stopPropagation();
      input.value = meta.step < 1 ? Number(slider.value).toFixed(1) : slider.value;
      sync();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    input.addEventListener("input", sync);
    syncers.push(sync);
    input.closest(".field").append(slider);
    sync();
  }
}

function updateProgress() {
  const done = requiredInputs.filter((i) => i.value !== "" && i.checkValidity()).length;
  progressLabel.textContent =
    done === requiredInputs.length
      ? "All required fields complete ✓"
      : `${done} of ${requiredInputs.length} required fields`;
  progressBar.style.width = `${(done / requiredInputs.length) * 100}%`;
  progressBar.classList.toggle("is-complete", done === requiredInputs.length);
}

let liveTimer = 0;
form.addEventListener("input", () => {
  updateProgress();
  if (lastScore === null) return; // live updates begin after the first estimate
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    if (form.checkValidity()) predict({ silent: true });
  }, 450);
});

const sample = {
  cgpa: 8.4, internships: 2, projects: 5, certifications: 3,
  coding_score: 78, communication_score: 70,
  dsa_problems: 220, aptitude_score: 72, leetcode_rating: 65,
  github_contributions: 150, hackathons: 2, ai_ml_skill: 60,
  system_design: 55, resume_score: 75, mock_interview_score: 68,
};

document.querySelector("#sample-button").addEventListener("click", () => {
  for (const [name, value] of Object.entries(sample)) form.elements[name].value = value;
  form.querySelector(".advanced-fields").open = true;
  syncers.forEach((fn) => fn());
  updateProgress();
  submitButton.focus();
});

document.querySelector("#reset-button").addEventListener("click", () => {
  clearTimeout(liveTimer);
  requestId++;
  form.reset();
  syncers.forEach((fn) => fn());
  updateProgress();
  lastScore = null;
  formError.hidden = true;
  resultState.hidden = true;
  loadingState.hidden = true;
  submitButton.disabled = false;
  emptyState.hidden = false;
});

setupSliders();
updateProgress();

checkApiStatus();
