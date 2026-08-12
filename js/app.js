import { compressImage } from "./imageCompressor.js";
import { compressVideo } from "./videoCompressor.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const resultsSection = document.getElementById("results");

let cardCounter = 0;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function isImage(file) {
  return file.type.startsWith("image/");
}

function isVideo(file) {
  return file.type.startsWith("video/");
}

function buildImageCard(file) {
  const id = `card-${++cardCounter}`;
  const objectUrl = URL.createObjectURL(file);

  const card = document.createElement("div");
  card.className = "card";
  card.id = id;
  card.innerHTML = `
    <img class="card-thumb" src="${objectUrl}" alt="" />
    <div class="card-body">
      <div class="card-header">
        <div>
          <p class="card-name">${file.name}</p>
          <p class="card-size" data-role="size">${formatBytes(file.size)}</p>
        </div>
        <button class="card-remove" type="button" aria-label="Remover" data-role="remove">&times;</button>
      </div>

      <div class="card-controls">
        <div class="control control-slider">
          <label>Qualidade: <span data-role="quality-value">75</span>%</label>
          <input type="range" min="10" max="100" step="5" value="75" data-role="quality" />
        </div>
        <div class="control">
          <label>Formato</label>
          <select data-role="format">
            <option value="webp" selected>WebP (recomendado)</option>
            <option value="jpeg">JPEG</option>
            <option value="png">PNG (sem perdas)</option>
          </select>
        </div>
        <div class="control">
          <label>Tamanho máximo</label>
          <select data-role="maxdim">
            <option value="0">Original</option>
            <option value="2560">2560px</option>
            <option value="1920" selected>1920px</option>
            <option value="1280">1280px</option>
            <option value="800">800px</option>
          </select>
        </div>
      </div>

      <p class="status" data-role="status">Comprimindo...</p>
      <div data-role="result-area"></div>
    </div>
  `;

  const els = {
    size: card.querySelector('[data-role="size"]'),
    quality: card.querySelector('[data-role="quality"]'),
    qualityValue: card.querySelector('[data-role="quality-value"]'),
    format: card.querySelector('[data-role="format"]'),
    maxdim: card.querySelector('[data-role="maxdim"]'),
    status: card.querySelector('[data-role="status"]'),
    resultArea: card.querySelector('[data-role="result-area"]'),
    remove: card.querySelector('[data-role="remove"]'),
  };

  let currentBlobUrl = null;

  async function run() {
    els.status.hidden = false;
    els.status.classList.remove("error");
    els.status.textContent = "Comprimindo...";
    els.resultArea.innerHTML = "";

    try {
      const quality = Number(els.quality.value) / 100;
      const format = els.format.value;
      const maxDimension = Number(els.maxdim.value) || null;

      const blob = await compressImage(file, { quality, format, maxDimension });

      if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = URL.createObjectURL(blob);

      const savedPct = Math.max(0, Math.round((1 - blob.size / file.size) * 100));
      els.status.hidden = true;

      const ext = format === "jpeg" ? "jpg" : format;
      const baseName = file.name.replace(/\.[^.]+$/, "");

      els.resultArea.innerHTML = `
        <div class="result-badge">${formatBytes(blob.size)} · ${savedPct > 0 ? `-${savedPct}%` : "sem redução"}</div>
        <div class="card-actions">
          <a class="btn btn-primary" href="${currentBlobUrl}" download="${baseName}-comprimido.${ext}">Baixar</a>
        </div>
      `;
    } catch (err) {
      console.error(err);
      els.status.hidden = false;
      els.status.classList.add("error");
      els.status.textContent = "Erro ao comprimir esta imagem.";
    }
  }

  const debouncedRun = debounce(run, 250);

  els.quality.addEventListener("input", () => {
    els.qualityValue.textContent = els.quality.value;
    debouncedRun();
  });
  els.format.addEventListener("change", debouncedRun);
  els.maxdim.addEventListener("change", debouncedRun);
  els.remove.addEventListener("click", () => {
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    URL.revokeObjectURL(objectUrl);
    card.remove();
  });

  resultsSection.hidden = false;
  resultsSection.appendChild(card);
  run();
}

function buildVideoCard(file) {
  const id = `card-${++cardCounter}`;
  const objectUrl = URL.createObjectURL(file);

  const card = document.createElement("div");
  card.className = "card";
  card.id = id;
  card.innerHTML = `
    <video class="card-thumb" src="${objectUrl}#t=0.5" muted playsinline preload="metadata"></video>
    <div class="card-body">
      <div class="card-header">
        <div>
          <p class="card-name">${file.name}</p>
          <p class="card-size">${formatBytes(file.size)}</p>
        </div>
        <button class="card-remove" type="button" aria-label="Remover" data-role="remove">&times;</button>
      </div>

      <div class="card-controls">
        <div class="control">
          <label>Qualidade</label>
          <select data-role="preset">
            <option value="high">Alta qualidade</option>
            <option value="medium" selected>Média (recomendado)</option>
            <option value="low">Arquivo pequeno</option>
          </select>
        </div>
        <div class="control">
          <label>Resolução</label>
          <select data-role="resolution">
            <option value="original">Original</option>
            <option value="1080" selected>1080p</option>
            <option value="720">720p</option>
            <option value="480">480p</option>
          </select>
        </div>
      </div>

      <div class="card-actions">
        <button class="btn btn-primary" type="button" data-role="compress">Comprimir vídeo</button>
      </div>

      <p class="status" data-role="status" hidden></p>
      <div class="progress-track" data-role="progress-track" hidden>
        <div class="progress-fill" data-role="progress-fill"></div>
      </div>
      <div data-role="result-area"></div>
    </div>
  `;

  const els = {
    preset: card.querySelector('[data-role="preset"]'),
    resolution: card.querySelector('[data-role="resolution"]'),
    compress: card.querySelector('[data-role="compress"]'),
    status: card.querySelector('[data-role="status"]'),
    progressTrack: card.querySelector('[data-role="progress-track"]'),
    progressFill: card.querySelector('[data-role="progress-fill"]'),
    resultArea: card.querySelector('[data-role="result-area"]'),
    remove: card.querySelector('[data-role="remove"]'),
  };

  let currentBlobUrl = null;

  els.compress.addEventListener("click", async () => {
    els.compress.disabled = true;
    els.status.hidden = false;
    els.status.classList.remove("error");
    els.progressTrack.hidden = false;
    els.progressFill.style.width = "0%";
    els.resultArea.innerHTML = "";

    try {
      const preset = els.preset.value;
      const resolution = els.resolution.value;

      const blob = await compressVideo(
        file,
        { preset, resolution },
        (progress) => {
          els.progressFill.style.width = `${Math.round(progress * 100)}%`;
        },
        (statusText) => {
          els.status.textContent = statusText;
        }
      );

      if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = URL.createObjectURL(blob);

      const savedPct = Math.max(0, Math.round((1 - blob.size / file.size) * 100));
      els.status.hidden = true;
      els.progressTrack.hidden = true;

      const baseName = file.name.replace(/\.[^.]+$/, "");

      els.resultArea.innerHTML = `
        <div class="result-badge">${formatBytes(blob.size)} · ${savedPct > 0 ? `-${savedPct}%` : "sem redução"}</div>
      `;
      els.resultArea.querySelector(".result-badge").insertAdjacentHTML(
        "afterend",
        `<div class="card-actions">
          <a class="btn btn-primary" href="${currentBlobUrl}" download="${baseName}-comprimido.mp4">Baixar</a>
        </div>`
      );

      els.compress.textContent = "Comprimir novamente";
      els.compress.disabled = false;
    } catch (err) {
      console.error(err);
      els.status.classList.add("error");
      els.status.textContent = "Erro ao comprimir este vídeo. Tente outro arquivo ou resolução.";
      els.progressTrack.hidden = true;
      els.compress.disabled = false;
    }
  });

  els.remove.addEventListener("click", () => {
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    URL.revokeObjectURL(objectUrl);
    card.remove();
  });

  resultsSection.hidden = false;
  resultsSection.appendChild(card);
}

function handleFiles(fileList) {
  const files = Array.from(fileList);
  for (const file of files) {
    if (isImage(file)) {
      buildImageCard(file);
    } else if (isVideo(file)) {
      buildVideoCard(file);
    }
  }
}

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener("change", () => {
  handleFiles(fileInput.files);
  fileInput.value = "";
});

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  });
});

dropzone.addEventListener("drop", (e) => {
  if (e.dataTransfer?.files?.length) {
    handleFiles(e.dataTransfer.files);
  }
});
