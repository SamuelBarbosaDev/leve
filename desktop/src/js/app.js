(function () {
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;

  const dropzone = document.getElementById("dropzone");
  const resultsSection = document.getElementById("results");
  const encoderBadge = document.getElementById("encoderBadge");
  const outputPathEl = document.getElementById("outputPath");
  const chooseOutputBtn = document.getElementById("chooseOutputBtn");

  let cardCounter = 0;
  let sharedOutputDir = null;

  function baseName(path) {
    const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return idx >= 0 ? path.slice(idx + 1) : path;
  }

  function dirName(path) {
    const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return idx >= 0 ? path.slice(0, idx) : path;
  }

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

  // Best-effort: native drag & drop payload shape can vary across Tauri
  // versions. If the event name doesn't match, this silently never fires —
  // the "Escolher vídeos" button below still works either way.
  listen("tauri://drag-drop", (event) => {
    const paths = event.payload && event.payload.paths;
    if (paths && paths.length) handleFiles(paths);
  }).catch(() => {});

  listen("compress-progress", (event) => {
    const { id, fraction } = event.payload;
    const fill = document.querySelector(`#${id} [data-role="progress-fill"]`);
    if (fill) fill.style.width = `${Math.round(fraction * 100)}%`;
  });

  async function init() {
    try {
      const info = await invoke("get_encoder_info");
      encoderBadge.textContent = `Motor: ${info.label}`;
    } catch (err) {
      console.error(err);
      encoderBadge.textContent = "Motor: CPU (software)";
    }
  }

  chooseOutputBtn.addEventListener("click", async () => {
    try {
      const folder = await invoke("pick_output_folder");
      if (folder) {
        sharedOutputDir = folder;
        outputPathEl.textContent = folder;
      }
    } catch (err) {
      console.error(err);
    }
  });

  dropzone.addEventListener("click", async () => {
    try {
      const files = await invoke("pick_video_files");
      if (files && files.length) handleFiles(files);
    } catch (err) {
      console.error(err);
    }
  });

  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      dropzone.click();
    }
  });

  function handleFiles(paths) {
    for (const path of paths) {
      buildVideoCard(path);
    }
  }

  function buildVideoCard(inputPath) {
    const id = `card-${++cardCounter}`;
    const card = document.createElement("div");
    card.className = "card";
    card.id = id;
    card.innerHTML = `
      <div class="card-header">
        <p class="card-name" title="${inputPath}">${baseName(inputPath)}</p>
        <button class="card-remove" type="button" aria-label="Remover" data-role="remove">&times;</button>
      </div>

      <div class="mode-tabs">
        <button class="mode-tab active" type="button" data-mode="target_size">Tamanho alvo (Shopee)</button>
        <button class="mode-tab" type="button" data-mode="quality">Qualidade</button>
      </div>

      <div class="card-controls">
        <div class="control" data-role="target-panel">
          <label>Tamanho alvo (MB)</label>
          <input class="field-number" type="number" min="1" step="1" value="30" data-role="target-mb" />
        </div>
        <div class="control" data-role="quality-panel" hidden>
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
    `;

    const els = {
      remove: card.querySelector('[data-role="remove"]'),
      modeTabs: card.querySelectorAll(".mode-tab"),
      targetPanel: card.querySelector('[data-role="target-panel"]'),
      qualityPanel: card.querySelector('[data-role="quality-panel"]'),
      targetMb: card.querySelector('[data-role="target-mb"]'),
      preset: card.querySelector('[data-role="preset"]'),
      resolution: card.querySelector('[data-role="resolution"]'),
      compress: card.querySelector('[data-role="compress"]'),
      status: card.querySelector('[data-role="status"]'),
      progressTrack: card.querySelector('[data-role="progress-track"]'),
      progressFill: card.querySelector('[data-role="progress-fill"]'),
      resultArea: card.querySelector('[data-role="result-area"]'),
    };

    let mode = "target_size";

    els.modeTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        mode = tab.dataset.mode;
        els.modeTabs.forEach((t) => t.classList.toggle("active", t === tab));
        els.targetPanel.hidden = mode !== "target_size";
        els.qualityPanel.hidden = mode !== "quality";
      });
    });

    els.compress.addEventListener("click", async () => {
      els.compress.disabled = true;
      els.status.hidden = false;
      els.status.classList.remove("error");
      els.status.textContent = "Comprimindo...";
      els.progressTrack.hidden = false;
      els.progressFill.style.width = "0%";
      els.resultArea.innerHTML = "";

      const modePayload =
        mode === "target_size"
          ? { mode: "target_size", target_mb: Number(els.targetMb.value) || 30 }
          : { mode: "quality", preset: els.preset.value };

      const outputDir = sharedOutputDir || dirName(inputPath);

      try {
        const result = await invoke("compress_video", {
          request: {
            id,
            input_path: inputPath,
            output_dir: outputDir,
            resolution: els.resolution.value,
            mode: modePayload,
          },
        });

        els.status.hidden = true;
        els.progressTrack.hidden = true;

        const savedPct = Math.max(
          0,
          Math.round((1 - result.output_size / result.input_size) * 100)
        );

        els.resultArea.innerHTML = `
          <div class="result-badge">${formatBytes(result.output_size)} · ${savedPct > 0 ? `-${savedPct}%` : "sem redução"}</div>
          <p class="saved-path" title="${result.output_path}">Salvo em: ${result.output_path}</p>
          <div class="card-actions">
            <button class="btn btn-secondary" type="button" data-role="reveal">Abrir pasta</button>
          </div>
        `;

        els.resultArea.querySelector('[data-role="reveal"]').addEventListener("click", () => {
          invoke("reveal_in_folder", { path: result.output_path }).catch(console.error);
        });

        els.compress.textContent = "Comprimir novamente";
        els.compress.disabled = false;
      } catch (err) {
        console.error(err);
        els.status.classList.add("error");
        els.status.textContent = typeof err === "string" ? err : "Erro ao comprimir este vídeo.";
        els.progressTrack.hidden = true;
        els.compress.disabled = false;
      }
    });

    els.remove.addEventListener("click", () => card.remove());

    resultsSection.hidden = false;
    resultsSection.appendChild(card);
  }

  init();
})();
