use crate::ffmpeg::{self, CompressionMode, EncodeArgsInput, EncoderInfo};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

pub struct EncoderState(pub Mutex<Option<EncoderInfo>>);

#[derive(Serialize, Clone)]
pub struct ProgressPayload {
    pub id: String,
    pub fraction: f64,
}

#[derive(Serialize)]
pub struct CompressResult {
    pub output_path: String,
    pub input_size: u64,
    pub output_size: u64,
}

#[derive(Deserialize)]
pub struct CompressRequest {
    pub id: String,
    pub input_path: String,
    pub output_dir: String,
    pub resolution: String,
    pub mode: CompressionMode,
}

async fn cached_encoder(app: &AppHandle, state: &State<'_, EncoderState>) -> Result<EncoderInfo, String> {
    if let Some(info) = state.0.lock().unwrap().clone() {
        return Ok(info);
    }
    let info = ffmpeg::detect_best_encoder(app).await?;
    *state.0.lock().unwrap() = Some(info.clone());
    Ok(info)
}

#[tauri::command]
pub async fn get_encoder_info(
    app: AppHandle,
    state: State<'_, EncoderState>,
) -> Result<EncoderInfo, String> {
    cached_encoder(&app, &state).await
}

#[tauri::command]
pub async fn pick_video_files() -> Option<Vec<String>> {
    let files = rfd::AsyncFileDialog::new()
        .add_filter("Vídeos", &["mp4", "mov", "m4v", "webm", "mkv", "avi"])
        .pick_files()
        .await?;

    Some(
        files
            .into_iter()
            .map(|f| f.path().to_string_lossy().to_string())
            .collect(),
    )
}

#[tauri::command]
pub async fn pick_output_folder() -> Option<String> {
    let folder = rfd::AsyncFileDialog::new().pick_folder().await?;
    Some(folder.path().to_string_lossy().to_string())
}

#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{path}"))
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let target = Path::new(&path);
        let dir = if target.is_dir() {
            target
        } else {
            target.parent().unwrap_or(target)
        };
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn compress_video(
    app: AppHandle,
    state: State<'_, EncoderState>,
    request: CompressRequest,
) -> Result<CompressResult, String> {
    let input_size = std::fs::metadata(&request.input_path)
        .map_err(|e| format!("Arquivo de entrada não encontrado: {e}"))?
        .len();

    let encoder = cached_encoder(&app, &state).await?;
    let duration = ffmpeg::probe_duration_secs(&app, &request.input_path).await?;

    let stem = Path::new(&request.input_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    let output_path = Path::new(&request.output_dir).join(format!("{stem}-comprimido.mp4"));
    let output_path_str = output_path.to_string_lossy().to_string();

    let args = ffmpeg::build_args(&EncodeArgsInput {
        input_path: &request.input_path,
        output_path: &output_path_str,
        encoder: &encoder.id,
        mode: &request.mode,
        resolution: &request.resolution,
        duration_secs: duration,
    });

    let sidecar = app.shell().sidecar("ffmpeg").map_err(|e| e.to_string())?;
    let (mut rx, _child) = sidecar
        .args(args)
        .spawn()
        .map_err(|e| format!("Não foi possível iniciar o FFmpeg: {e}"))?;

    let progress_id = request.id.clone();
    let mut last_stderr = String::new();
    let mut exit_code: Option<i32> = None;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                let line = String::from_utf8_lossy(&bytes);
                if let Some(rest) = line.trim().strip_prefix("out_time=") {
                    if let Some(secs) = ffmpeg::parse_ffmpeg_timestamp(rest) {
                        let fraction = (secs / duration.max(0.001)).clamp(0.0, 1.0);
                        let _ = app.emit(
                            "compress-progress",
                            ProgressPayload {
                                id: progress_id.clone(),
                                fraction,
                            },
                        );
                    }
                }
            }
            CommandEvent::Stderr(bytes) => {
                last_stderr = String::from_utf8_lossy(&bytes).trim().to_string();
            }
            CommandEvent::Error(err) => {
                return Err(format!("Erro ao executar o FFmpeg: {err}"));
            }
            CommandEvent::Terminated(payload) => {
                exit_code = payload.code;
            }
            _ => {}
        }
    }

    if exit_code != Some(0) {
        return Err(format!(
            "A compressão falhou (código {exit_code:?}). {last_stderr}"
        ));
    }

    let output_size = std::fs::metadata(&output_path)
        .map_err(|e| format!("Falha ao ler o arquivo de saída: {e}"))?
        .len();

    Ok(CompressResult {
        output_path: output_path_str,
        input_size,
        output_size,
    })
}
