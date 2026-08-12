const FFMPEG_VERSION = "0.12.10";
const UTIL_VERSION = "0.12.2";
const CORE_VERSION = "0.12.6";

// The worker script is vendored locally (js/vendor/ffmpeg/worker.js) instead of
// converted to a blob: URL. Some browsers fail to run a module Worker whose
// script is a blob: URL, so it must be loaded as a same-origin file instead.
const LOCAL_WORKER_URL = new URL("./vendor/ffmpeg/worker.js", import.meta.url).href;

let ffmpegPromise = null;

async function getFFmpeg(onEngineProgress) {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import(
        `https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/esm/index.js`
      );
      const { toBlobURL } = await import(
        `https://cdn.jsdelivr.net/npm/@ffmpeg/util@${UTIL_VERSION}/dist/esm/index.js`
      );

      const ffmpeg = new FFmpeg();
      const baseURL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

      onEngineProgress?.("Carregando mecanismo de vídeo (apenas na primeira vez)...");

      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
        classWorkerURL: LOCAL_WORKER_URL,
      });

      return ffmpeg;
    })();
  }
  return ffmpegPromise;
}

const PRESETS = {
  high: { crf: 20 },
  medium: { crf: 27 },
  low: { crf: 32 },
};

const SCALE_FILTERS = {
  original: null,
  1080: "scale=-2:1080",
  720: "scale=-2:720",
  480: "scale=-2:480",
};

function extensionFor(inputName) {
  const dot = inputName.lastIndexOf(".");
  return dot >= 0 ? inputName.slice(dot) : ".mp4";
}

export async function compressVideo(file, { preset, resolution }, onProgress, onStatus) {
  const ffmpeg = await getFFmpeg(onStatus);

  const progressHandler = ({ progress }) => {
    if (typeof progress === "number" && progress >= 0 && progress <= 1) {
      onProgress?.(progress);
    }
  };
  ffmpeg.on("progress", progressHandler);

  const inputName = `input${extensionFor(file.name)}`;
  const outputName = "output.mp4";

  try {
    onStatus?.("Lendo arquivo...");
    const data = new Uint8Array(await file.arrayBuffer());
    await ffmpeg.writeFile(inputName, data);

    const { crf } = PRESETS[preset] || PRESETS.medium;
    const scaleFilter = SCALE_FILTERS[resolution];

    const args = ["-i", inputName, "-c:v", "libx264", "-crf", String(crf), "-preset", "fast"];
    if (scaleFilter) {
      args.push("-vf", scaleFilter);
    }
    args.push("-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outputName);

    onStatus?.("Comprimindo vídeo...");
    await ffmpeg.exec(args);

    const outputData = await ffmpeg.readFile(outputName);
    const blob = new Blob([outputData.buffer], { type: "video/mp4" });

    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);

    return blob;
  } finally {
    ffmpeg.off("progress", progressHandler);
  }
}
