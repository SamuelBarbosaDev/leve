// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod ffmpeg;

use commands::EncoderState;
use std::sync::Mutex;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(EncoderState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            commands::get_encoder_info,
            commands::pick_video_files,
            commands::pick_output_folder,
            commands::reveal_in_folder,
            commands::compress_video,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Leve Desktop");
}
