// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn close_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())?;
    Ok(())
}

/// Spustí aplikaci JobiDocs (macOS: open -a JobiDocs). Na ostatních OS nic nedělá.
#[tauri::command]
fn launch_jobidocs() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .args(["-a", "JobiDocs"])
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(status.success());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = ();
        Ok(false)
    }
}

/// Set the application (Dock) icon from base64-encoded PNG data. macOS only.
/// Must run AppKit (setApplicationIconImage) on the main thread to avoid crash.
#[tauri::command]
async fn set_app_icon(data: String) -> Result<(), String> {
    let bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        data.trim(),
    )
    .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        let path = std::env::temp_dir().join("jobi-icon.png");
        std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
        let path_str = path.to_string_lossy().into_owned();
        run_set_icon_on_main_thread(path_str).await;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = bytes;
    }

    Ok(())
}

#[cfg(target_os = "macos")]
async fn run_set_icon_on_main_thread(path: String) {
    use dispatch::Queue;
    use std::sync::mpsc;

    let (tx, rx) = mpsc::sync_channel(0);
    Queue::main().exec_async(move || {
        set_macos_app_icon(&path);
        let _ = tx.send(());
    });
    // Wait for main thread to finish without blocking the async runtime
    let _ = tauri::async_runtime::spawn_blocking(move || rx.recv()).await;
}

#[cfg(target_os = "macos")]
fn set_macos_app_icon(path: &str) {
    use cocoa::appkit::{NSApp, NSApplication, NSImage};
    use cocoa::foundation::NSString;
    unsafe {
        let path_ns = NSString::alloc(cocoa::base::nil).init_str(path);
        let img = NSImage::alloc(cocoa::base::nil).initWithContentsOfFile_(path_ns);
        if !img.is_null() {
            NSApp().setApplicationIconImage_(img);
        }
    }
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![greet, close_window, set_app_icon, launch_jobidocs])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
