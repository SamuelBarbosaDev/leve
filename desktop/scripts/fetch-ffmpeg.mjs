#!/usr/bin/env node
// Downloads a prebuilt FFmpeg (with ffprobe) for the current platform from
// BtbN/FFmpeg-Builds and places the binaries in src-tauri/binaries with the
// target-triple suffix Tauri's sidecar mechanism expects.
//
// Usage: node scripts/fetch-ffmpeg.mjs [linux|win32]
// (defaults to the platform this script is running on)

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  copyFileSync,
  chmodSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BINARIES_DIR = join(__dirname, "..", "src-tauri", "binaries");

const PLATFORM_CONFIG = {
  linux: {
    url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz",
    archiveName: "ffmpeg-linux64.tar.xz",
    targetTriple: "x86_64-unknown-linux-gnu",
    exeSuffix: "",
  },
  win32: {
    url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
    archiveName: "ffmpeg-win64.zip",
    targetTriple: "x86_64-pc-windows-msvc",
    exeSuffix: ".exe",
  },
};

function findFile(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

function extract(archivePath, destDir) {
  if (archivePath.endsWith(".zip")) {
    if (process.platform === "win32") {
      execFileSync("powershell", [
        "-NoProfile",
        "-Command",
        `Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force`,
      ]);
    } else {
      execFileSync("unzip", ["-q", archivePath, "-d", destDir]);
    }
  } else {
    execFileSync("tar", ["-xf", archivePath, "-C", destDir]);
  }
}

async function main() {
  const platform = process.argv[2] || process.platform;
  const config = PLATFORM_CONFIG[platform];
  if (!config) {
    console.error(`Plataforma não suportada: ${platform}. Use "linux" ou "win32".`);
    process.exit(1);
  }

  mkdirSync(BINARIES_DIR, { recursive: true });
  const tmpDir = join(os.tmpdir(), `leve-ffmpeg-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  const archivePath = join(tmpDir, config.archiveName);

  console.log(`Baixando FFmpeg (${platform}) de ${config.url} ...`);
  const res = await fetch(config.url);
  if (!res.ok) throw new Error(`Falha ao baixar: HTTP ${res.status}`);
  writeFileSync(archivePath, Buffer.from(await res.arrayBuffer()));

  console.log("Extraindo...");
  extract(archivePath, tmpDir);

  const ffmpegExe = `ffmpeg${config.exeSuffix}`;
  const ffprobeExe = `ffprobe${config.exeSuffix}`;
  const ffmpegPath = findFile(tmpDir, ffmpegExe);
  const ffprobePath = findFile(tmpDir, ffprobeExe);

  if (!ffmpegPath || !ffprobePath) {
    throw new Error("Não encontrei ffmpeg/ffprobe dentro do pacote baixado.");
  }

  const destFfmpeg = join(BINARIES_DIR, `ffmpeg-${config.targetTriple}${config.exeSuffix}`);
  const destFfprobe = join(BINARIES_DIR, `ffprobe-${config.targetTriple}${config.exeSuffix}`);
  copyFileSync(ffmpegPath, destFfmpeg);
  copyFileSync(ffprobePath, destFfprobe);

  if (config.exeSuffix === "") {
    chmodSync(destFfmpeg, 0o755);
    chmodSync(destFfprobe, 0o755);
  }

  rmSync(tmpDir, { recursive: true, force: true });
  console.log(`OK: ${destFfmpeg}`);
  console.log(`OK: ${destFfprobe}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
