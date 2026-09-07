use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncoderInfo {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum CompressionMode {
    Quality { preset: String },
    TargetSize { target_mb: f64 },
}

const CANDIDATES_WINDOWS: &[(&str, &str)] = &[
    ("h264_nvenc", "NVIDIA NVENC (hardware)"),
    ("h264_qsv", "Intel Quick Sync (hardware)"),
    ("h264_amf", "AMD AMF (hardware)"),
];

const CANDIDATES_LINUX: &[(&str, &str)] = &[
    ("h264_nvenc", "NVIDIA NVENC (hardware)"),
    ("h264_vaapi", "VA-API (hardware)"),
];

const FALLBACK: (&str, &str) = ("libx264", "CPU (software)");

/// Tries each hardware encoder candidate for this OS, in priority order,
/// actually running a 1-frame encode to confirm it works on this machine
/// (a compiled-in encoder can still fail at runtime with no compatible GPU/driver).
/// Falls back to libx264 (software) if nothing hardware-backed is usable.
pub async fn detect_best_encoder(app: &AppHandle) -> Result<EncoderInfo, String> {
    let candidates: &[(&str, &str)] = if cfg!(target_os = "windows") {
        CANDIDATES_WINDOWS
    } else {
        CANDIDATES_LINUX
    };

    let compiled = list_compiled_encoders(app).await.unwrap_or_default();

    for (id, label) in candidates {
        if compiled.iter().any(|e| e == id) && probe_encoder(app, id).await {
            return Ok(EncoderInfo {
                id: id.to_string(),
                label: label.to_string(),
            });
        }
    }

    Ok(EncoderInfo {
        id: FALLBACK.0.to_string(),
        label: FALLBACK.1.to_string(),
    })
}

async fn list_compiled_encoders(app: &AppHandle) -> Result<Vec<String>, String> {
    let sidecar = app.shell().sidecar("ffmpeg").map_err(|e| e.to_string())?;
    let output = sidecar
        .args(["-hide_banner", "-encoders"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&output.stdout);
    Ok(text
        .lines()
        .filter_map(|line| line.split_whitespace().nth(1).map(str::to_string))
        .collect())
}

async fn probe_encoder(app: &AppHandle, encoder: &str) -> bool {
    let Ok(sidecar) = app.shell().sidecar("ffmpeg") else {
        return false;
    };

    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-f".into(),
        "lavfi".into(),
        "-i".into(),
        "color=size=64x64:rate=1:duration=1".into(),
    ];

    if encoder == "h264_vaapi" {
        args.extend([
            "-vaapi_device".into(),
            "/dev/dri/renderD128".into(),
            "-vf".into(),
            "format=nv12,hwupload".into(),
        ]);
    }

    args.extend([
        "-frames:v".into(),
        "1".into(),
        "-c:v".into(),
        encoder.into(),
        "-f".into(),
        "null".into(),
        "-".into(),
    ]);

    matches!(sidecar.args(args).output().await, Ok(output) if output.status.success())
}

pub async fn probe_duration_secs(app: &AppHandle, input_path: &str) -> Result<f64, String> {
    let sidecar = app.shell().sidecar("ffprobe").map_err(|e| e.to_string())?;
    let output = sidecar
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            input_path,
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err("Não foi possível ler as informações do vídeo (ffprobe falhou).".into());
    }

    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<f64>()
        .map_err(|_| "Não foi possível ler a duração do vídeo.".to_string())
}

pub fn parse_ffmpeg_timestamp(ts: &str) -> Option<f64> {
    let mut parts = ts.trim().splitn(3, ':');
    let h: f64 = parts.next()?.parse().ok()?;
    let m: f64 = parts.next()?.parse().ok()?;
    let s: f64 = parts.next()?.parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

const AUDIO_BITRATE_BPS: f64 = 128_000.0;
const MIN_VIDEO_BITRATE_KBPS: f64 = 100.0;

/// Bitrate (kbps) needed so the encoded file lands close to `target_mb`,
/// leaving room for the fixed 128kbps audio track and ~2% container overhead.
pub fn target_size_bitrate_kbps(target_mb: f64, duration_secs: f64) -> u32 {
    let container_overhead_factor = 0.98;
    let target_bits = target_mb * 8.0 * 1024.0 * 1024.0 * container_overhead_factor;
    let total_bps = target_bits / duration_secs.max(1.0);
    let video_kbps = (total_bps - AUDIO_BITRATE_BPS) / 1000.0;
    video_kbps.max(MIN_VIDEO_BITRATE_KBPS).round() as u32
}

/// Per-encoder rate-control flags for the "quality preset" mode. Numbers aren't
/// identical in meaning across encoders (CRF vs CQ vs QP), they're tuned to land
/// in a broadly similar visual-quality ballpark for high/medium/low.
fn quality_flags(preset: &str, encoder: &str) -> Vec<String> {
    let level = match preset {
        "high" => 0,
        "low" => 2,
        _ => 1,
    };

    match encoder {
        "h264_nvenc" => {
            let cq = [20, 27, 32][level];
            vec![
                "-rc".into(),
                "vbr".into(),
                "-cq".into(),
                cq.to_string(),
                "-preset".into(),
                "p4".into(),
            ]
        }
        "h264_qsv" => {
            let q = [20, 27, 32][level];
            vec![
                "-global_quality".into(),
                q.to_string(),
                "-preset".into(),
                "medium".into(),
            ]
        }
        "h264_amf" => {
            let qp = [20, 27, 32][level];
            vec![
                "-rc".into(),
                "cqp".into(),
                "-qp_i".into(),
                qp.to_string(),
                "-qp_p".into(),
                qp.to_string(),
            ]
        }
        "h264_vaapi" => {
            let qp = [24, 28, 34][level];
            vec!["-qp".into(), qp.to_string()]
        }
        _ => {
            let crf = [20, 27, 32][level];
            vec![
                "-crf".into(),
                crf.to_string(),
                "-preset".into(),
                "veryfast".into(),
            ]
        }
    }
}

pub struct EncodeArgsInput<'a> {
    pub input_path: &'a str,
    pub output_path: &'a str,
    pub encoder: &'a str,
    pub mode: &'a CompressionMode,
    pub resolution: &'a str,
    pub duration_secs: f64,
}

pub fn build_args(input: &EncodeArgsInput) -> Vec<String> {
    let mut args: Vec<String> = vec!["-y".into(), "-i".into(), input.input_path.into()];

    let target_height = match input.resolution {
        "1080" => Some(1080),
        "720" => Some(720),
        "480" => Some(480),
        _ => None,
    };

    if input.encoder == "h264_vaapi" {
        args.push("-vaapi_device".into());
        args.push("/dev/dri/renderD128".into());
        let vf = match target_height {
            Some(h) => format!("format=nv12,scale=-2:{h},hwupload"),
            None => "format=nv12,hwupload".into(),
        };
        args.push("-vf".into());
        args.push(vf);
    } else if let Some(h) = target_height {
        args.push("-vf".into());
        args.push(format!("scale=-2:{h}"));
    }

    args.push("-c:v".into());
    args.push(input.encoder.into());

    match input.mode {
        CompressionMode::Quality { preset } => {
            args.extend(quality_flags(preset, input.encoder));
        }
        CompressionMode::TargetSize { target_mb } => {
            let kbps = target_size_bitrate_kbps(*target_mb, input.duration_secs);
            args.push("-b:v".into());
            args.push(format!("{kbps}k"));
            args.push("-maxrate".into());
            args.push(format!("{}k", (kbps as f64 * 1.5).round() as u32));
            args.push("-bufsize".into());
            args.push(format!("{}k", kbps * 2));
        }
    }

    args.push("-c:a".into());
    args.push("aac".into());
    args.push("-b:a".into());
    args.push("128k".into());
    args.push("-movflags".into());
    args.push("+faststart".into());
    args.push("-progress".into());
    args.push("pipe:1".into());
    args.push("-nostats".into());
    args.push(input.output_path.into());

    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ffmpeg_timestamp() {
        assert_eq!(parse_ffmpeg_timestamp("00:00:00.000000"), Some(0.0));
        assert_eq!(parse_ffmpeg_timestamp("00:01:02.500000"), Some(62.5));
        assert_eq!(parse_ffmpeg_timestamp("01:00:00.000000"), Some(3600.0));
        assert_eq!(parse_ffmpeg_timestamp("garbage"), None);
    }

    #[test]
    fn computes_target_bitrate_for_shopee_style_limit() {
        // 30MB target, 60s video -> should land comfortably under 30MB with margin.
        let kbps = target_size_bitrate_kbps(30.0, 60.0);
        let estimated_bytes = (kbps as f64 * 1000.0 / 8.0) * 60.0 + (128_000.0 / 8.0) * 60.0;
        assert!(estimated_bytes <= 30.0 * 1024.0 * 1024.0);
        assert!(kbps > 0);
    }

    #[test]
    fn never_returns_a_degenerate_bitrate_for_tiny_targets() {
        let kbps = target_size_bitrate_kbps(0.5, 600.0);
        assert!(kbps as f64 >= MIN_VIDEO_BITRATE_KBPS);
    }

    #[test]
    fn quality_mode_uses_crf_on_libx264() {
        let input = EncodeArgsInput {
            input_path: "in.mp4",
            output_path: "out.mp4",
            encoder: "libx264",
            mode: &CompressionMode::Quality {
                preset: "medium".into(),
            },
            resolution: "720",
            duration_secs: 10.0,
        };
        let args = build_args(&input);
        assert!(args.iter().any(|a| a == "-crf"));
        assert!(args.iter().any(|a| a == "scale=-2:720"));
    }

    #[test]
    fn target_size_mode_sets_bitrate_flags() {
        let input = EncodeArgsInput {
            input_path: "in.mp4",
            output_path: "out.mp4",
            encoder: "h264_nvenc",
            mode: &CompressionMode::TargetSize { target_mb: 30.0 },
            resolution: "original",
            duration_secs: 45.0,
        };
        let args = build_args(&input);
        assert!(args.iter().any(|a| a == "-b:v"));
        assert!(args.iter().any(|a| a == "-maxrate"));
    }
}
