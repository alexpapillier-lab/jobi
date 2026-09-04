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

/// Spustí aplikaci JobiDocs.
/// macOS: `open -a JobiDocs`. Windows: hledá exe v obvyklých cestách NSIS instalace.
/// Ostatní OS: nic nedělá.
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

    #[cfg(target_os = "windows")]
    {
        // NSIS instaluje per-user do %LOCALAPPDATA%\Programs, per-machine do Program Files.
        let mut candidates: Vec<std::path::PathBuf> = Vec::new();
        for var in ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"] {
            if let Ok(base) = std::env::var(var) {
                let root = std::path::PathBuf::from(base);
                candidates.push(root.join("Programs").join("JobiDocs").join("JobiDocs.exe"));
                candidates.push(root.join("JobiDocs").join("JobiDocs.exe"));
            }
        }

        for exe in candidates {
            if exe.is_file() {
                return std::process::Command::new(&exe)
                    .spawn()
                    .map(|_| true)
                    .map_err(|e| e.to_string());
            }
        }
        return Ok(false);
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
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



/// Kontext pro JobiDocs (servisy, údaje firmy, přihlášení k Supabase), který
/// Rust posílá na 127.0.0.1:3847 každých 5 s nezávisle na webview.
///
/// Proč: macOS uspává JavaScript v okně na pozadí, takže `setInterval` v React
/// části přestal posílat kontext a JobiDocs po vlastním restartu čekal, dokud
/// uživatel nepřepnul do Jobi. Vlákno tady běží, i když je okno schované.
struct JobiDocsContext(std::sync::Mutex<Option<String>>);

#[tauri::command]
fn set_jobidocs_context(state: tauri::State<'_, JobiDocsContext>, payload: String) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    *guard = if payload.trim().is_empty() { None } else { Some(payload) };
    Ok(())
}

fn spawn_jobidocs_context_pusher(app: &tauri::AppHandle) {
    use tauri::Manager;
    let app = app.clone();
    std::thread::spawn(move || {
        let client = tauri_plugin_http::reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(4))
            .build();
        let client = match client {
            Ok(c) => c,
            Err(_) => return,
        };
        loop {
            std::thread::sleep(std::time::Duration::from_secs(5));
            let payload = app
                .state::<JobiDocsContext>()
                .0
                .lock()
                .ok()
                .and_then(|g| g.clone());
            if let Some(body) = payload {
                let req = client
                    .put("http://127.0.0.1:3847/v1/context")
                    .header("Content-Type", "application/json")
                    .body(body)
                    .send();
                // JobiDocs nemusí běžet – chyba je normální stav, jen ji ignorujeme.
                let _ = tauri::async_runtime::block_on(req);
            }
        }
    });
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
        .plugin(tauri_plugin_notification::init())
        .manage(JobiDocsContext(std::sync::Mutex::new(None)))
        .setup(|app| {
            spawn_jobidocs_context_pusher(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, close_window, set_app_icon, launch_jobidocs, set_jobidocs_context])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
