// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

/// Adresa lokálního API JobiDocs. Musí sedět s JOBIDOCS_API v src/lib/jobidocs.ts –
/// obě strany posílají tentýž kontext a rozejití portu by se projevilo až u zákazníka
/// tím, že JobiDocs po restartu nikdy nedostane servis a tisk hlásí „not found“.
const JOBIDOCS_CONTEXT_URL: &str = "http://127.0.0.1:3847/v1/context";

#[tauri::command]
async fn close_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())?;
    Ok(())
}

/// Kde hledat JobiDocs.exe po instalaci NSIS instalátorem.
///
/// Vyčleněno z `launch_jobidocs`, aby šlo otestovat i na macOS – jinak by se
/// chyba v cestách projevila až na Windows u zákazníka.
/// NSIS instaluje per-user do %LOCALAPPDATA%\Programs, per-machine do Program Files.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn jobidocs_windows_candidates<F>(env: F) -> Vec<std::path::PathBuf>
where
    F: Fn(&str) -> Option<String>,
{
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    for var in ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(base) = env(var) {
            let root = std::path::PathBuf::from(base);
            candidates.push(root.join("Programs").join("JobiDocs").join("JobiDocs.exe"));
            candidates.push(root.join("JobiDocs").join("JobiDocs.exe"));
        }
    }
    candidates
}

/// Spustí aplikaci JobiDocs.
/// macOS: `open -a JobiDocs`. Windows: hledá exe v obvyklých cestách NSIS instalace.
/// Ostatní OS: nic nedělá.
#[tauri::command]
fn launch_jobidocs() -> Result<bool, String> {
    launch_jobidocs_impl()
}

#[cfg(target_os = "macos")]
fn launch_jobidocs_impl() -> Result<bool, String> {
    let status = std::process::Command::new("open")
        .args(["-a", "JobiDocs"])
        .status()
        .map_err(|e| e.to_string())?;
    Ok(status.success())
}

#[cfg(target_os = "windows")]
fn launch_jobidocs_impl() -> Result<bool, String> {
    for exe in jobidocs_windows_candidates(|v| std::env::var(v).ok()) {
        if exe.is_file() {
            return std::process::Command::new(&exe)
                .spawn()
                .map(|_| true)
                .map_err(|e| e.to_string());
        }
    }
    Ok(false)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn launch_jobidocs_impl() -> Result<bool, String> {
    Ok(false)
}

/// Rozbalí base64 z JS na PNG bajty pro ikonu v Docku.
///
/// Vyčleněno kvůli testům a kvůli tomu, že tohle je jediné místo, kde se dá
/// poznat, že přišlo něco jiného než PNG. Dřív se takový vstup jen zapsal do
/// temp souboru, NSImage vrátil null a ikona se tiše nezměnila – uživatel
/// neviděl nic. Teď z toho je chyba, kterou volající zaloguje.
fn decode_icon_png(data: &str) -> Result<Vec<u8>, String> {
    // Data URL („data:image/png;base64,…“) je snadný omyl na straně JS;
    // přijmeme ji, ať se kvůli prefixu nezahazuje jinak platný obrázek.
    let raw = data.trim();
    let raw = match raw.split_once("base64,") {
        Some((prefix, rest)) if prefix.starts_with("data:") => rest,
        _ => raw,
    };
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, raw.trim())
        .map_err(|e| format!("Ikona není platné base64: {e}"))?;
    if !bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Err("Ikona není PNG.".to_string());
    }
    Ok(bytes)
}

/// Soubor, přes který se ikona předává AppKitu. Vždy v systémovém temp adresáři,
/// který má aplikace v capabilities povolený (fs:scope-temp).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn icon_temp_path() -> std::path::PathBuf {
    std::env::temp_dir().join("jobi-icon.png")
}

/// Set the application (Dock) icon from base64-encoded PNG data. macOS only.
/// Must run AppKit (setApplicationIconImage) on the main thread to avoid crash.
#[tauri::command]
async fn set_app_icon(data: String) -> Result<(), String> {
    let bytes = decode_icon_png(&data)?;

    #[cfg(target_os = "macos")]
    {
        let path = icon_temp_path();
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

/// Prázdný payload znamená „přestaň posílat“ (odhlášení, žádný servis).
/// Bez toho by vlákno dál dokola posílalo poslední kontext i s přístupovým
/// tokenem, který už neplatí.
fn normalize_context_payload(payload: String) -> Option<String> {
    if payload.trim().is_empty() {
        None
    } else {
        Some(payload)
    }
}

#[tauri::command]
fn set_jobidocs_context(
    state: tauri::State<'_, JobiDocsContext>,
    payload: String,
) -> Result<(), String> {
    // Otrávený zámek (panika v jiném vlákně) by jinak kontext umlčel natrvalo
    // až do restartu aplikace – radši ho převezmeme a přepíšeme.
    let mut guard = match state.0.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    *guard = normalize_context_payload(payload);
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
            let payload = {
                let state = app.state::<JobiDocsContext>();
                let guard = match state.0.lock() {
                    Ok(g) => g,
                    Err(poisoned) => poisoned.into_inner(),
                };
                guard.clone()
            };
            if let Some(body) = payload {
                let req = client
                    .put(JOBIDOCS_CONTEXT_URL)
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
        .invoke_handler(tauri::generate_handler![
            close_window,
            set_app_icon,
            launch_jobidocs,
            set_jobidocs_context
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod testy {
    use super::*;

    /// 1×1 průhledný PNG (nejmenší platný soubor, na kterém jde ověřit hlavičku).
    const PNG_1X1: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    #[test]
    fn ikona_prijme_ciste_base64() {
        let bytes = decode_icon_png(PNG_1X1).expect("PNG se má rozbalit");
        assert_eq!(&bytes[..4], &[0x89, b'P', b'N', b'G']);
    }

    #[test]
    fn ikona_prijme_data_url_i_bile_znaky() {
        // JS posílá base64 z FileReaderu; prefix nebo zalomení řádku se dřív
        // projevily jen tím, že se ikona tiše nezměnila.
        let s_prefixem = format!("data:image/png;base64,{PNG_1X1}");
        assert!(decode_icon_png(&s_prefixem).is_ok());
        assert!(decode_icon_png(&format!("  {PNG_1X1}  ")).is_ok());
    }

    #[test]
    fn ikona_odmitne_nesmysl_misto_tiche_chyby() {
        let e = decode_icon_png("tohle není base64 @@@").unwrap_err();
        assert!(e.contains("base64"), "chyba má říct, co je špatně: {e}");
    }

    #[test]
    fn ikona_odmitne_jiny_format_nez_png() {
        // JPEG magic – dřív se zapsal do temp souboru a NSImage ho zahodil bez hlášky.
        let jpeg = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            [0xFF, 0xD8, 0xFF, 0xE0],
        );
        assert_eq!(decode_icon_png(&jpeg).unwrap_err(), "Ikona není PNG.");
    }

    #[test]
    fn ikona_odmitne_prazdny_vstup() {
        assert!(decode_icon_png("").is_err());
        assert!(decode_icon_png("   ").is_err());
    }

    #[test]
    fn cesta_k_ikone_je_v_temp_a_ma_priponu_png() {
        let p = icon_temp_path();
        assert!(p.is_absolute(), "cesta musí být absolutní: {p:?}");
        assert_eq!(p.file_name().unwrap(), "jobi-icon.png");
        assert!(p.starts_with(std::env::temp_dir()));
    }

    #[test]
    fn windows_cesty_pokryji_per_user_i_per_machine_instalaci() {
        let candidates = jobidocs_windows_candidates(|v| match v {
            "LOCALAPPDATA" => Some(r"C:\Users\test\AppData\Local".to_string()),
            "ProgramFiles" => Some(r"C:\Program Files".to_string()),
            _ => None,
        });
        let jako_text: Vec<String> = candidates
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            candidates.len(),
            4,
            "dvě proměnné × dvě rozložení: {jako_text:?}"
        );
        assert!(jako_text.iter().all(|p| p.ends_with("JobiDocs.exe")));
        assert!(jako_text.iter().any(|p| p.contains("Programs")));
        assert!(jako_text.iter().any(|p| p.contains("Program Files")));
    }

    #[test]
    fn windows_cesty_bez_promennych_prostredi_nic_nevymysli() {
        assert!(jobidocs_windows_candidates(|_| None).is_empty());
    }

    #[test]
    fn windows_cesty_neduplikuji_stejne_rozlozeni() {
        let c = jobidocs_windows_candidates(|v| {
            if v == "LOCALAPPDATA" {
                Some("/base".to_string())
            } else {
                None
            }
        });
        assert_eq!(c.len(), 2);
        assert_ne!(c[0], c[1]);
    }

    #[test]
    fn prazdny_kontext_znamena_zadny_kontext() {
        assert_eq!(normalize_context_payload(String::new()), None);
        assert_eq!(normalize_context_payload("  \n\t ".to_string()), None);
    }

    #[test]
    fn kontext_se_predava_beze_zmeny_vcetne_bilych_znaku() {
        // JSON se posílá dál doslova; ořezání by rozbilo případný podpis obsahu.
        let json = " {\"services\":[]} ".to_string();
        assert_eq!(normalize_context_payload(json.clone()), Some(json));
    }

    #[test]
    fn adresa_jobidocs_sedi_s_frontendem() {
        // Rust i frontend posílají tentýž kontext na tutéž adresu. Kdyby se
        // rozešly, JobiDocs by po restartu nikdy nedostal servis a tisk by
        // hlásil „not found“ – ale až u zákazníka, protože v testech se ani
        // jedna strana o tu druhou nezajímá. Proto se hodnota nečte podruhé
        // z konstanty, ale přímo ze zdrojáku frontendu.
        let cesta = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("src")
            .join("lib")
            .join("jobidocs.ts");
        let zdrojak = std::fs::read_to_string(&cesta)
            .unwrap_or_else(|e| panic!("nelze přečíst {cesta:?}: {e}"));

        // const JOBIDOCS_API = "http://127.0.0.1:3847";
        let radek = zdrojak
            .lines()
            .find(|l| l.contains("JOBIDOCS_API") && l.contains("http"))
            .expect("v jobidocs.ts zmizela konstanta JOBIDOCS_API");
        let zacatek = radek.find('"').expect("adresa není v uvozovkách") + 1;
        let konec = zacatek + radek[zacatek..].find('"').expect("neuzavřené uvozovky");
        let adresa_frontendu = &radek[zacatek..konec];

        assert_eq!(
            JOBIDOCS_CONTEXT_URL,
            format!("{adresa_frontendu}/v1/context"),
            "Rust a src/lib/jobidocs.ts míří jinam"
        );
    }
}
