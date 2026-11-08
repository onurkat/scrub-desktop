#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod storage;
#[cfg(target_os = "linux")]
mod wayland_clipboard;
#[cfg(target_os = "windows")]
mod windows_notification;
use serde_json::{json, Value};
use std::{collections::HashMap, fs, sync::Mutex};
use tauri::{
    menu::{Menu, MenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;
struct AppState {
    ready: bool,
    pending: Vec<String>,
    settings: Value,
    mappings: Value,
    shortcut_error: bool,
}
type Shared = Mutex<AppState>;
fn wayland() -> bool {
    std::env::var("XDG_SESSION_TYPE").is_ok_and(|x| x == "wayland")
        || std::env::var_os("WAYLAND_DISPLAY").is_some()
}
fn defaults() -> Value {
    json!({"language":"auto","skipReview":false,"keepMappings":false,"autostart":false,"welcomed":false,"scrubShortcut":"Ctrl+Alt+S","restoreShortcut":"Ctrl+Alt+R","dictionary":[],"detectors":{}})
}
fn request(app: &tauri::AppHandle, action: &str) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("windowError")?;
    if action == "scrub" || action == "restore" {
        window
            .set_size(tauri::LogicalSize::new(560.0, 640.0))
            .map_err(|_| "windowError")?;
    } else {
        window
            .set_size(tauri::LogicalSize::new(800.0, 720.0))
            .map_err(|_| "windowError")?;
    }
    window
        .show()
        .and_then(|_| window.center())
        .and_then(|_| window.set_focus())
        .map_err(|_| "windowError")?;
    let shared = app.state::<Shared>();
    let mut s = shared.lock().map_err(|_| "stateError")?;
    if s.ready {
        window.emit("action", action).map_err(|_| "windowError")?;
    } else {
        s.pending.push(action.into());
    }
    Ok(())
}
fn shortcuts(app: &tauri::AppHandle, settings: &Value) -> Result<(), String> {
    if wayland() {
        return Ok(());
    }
    for (key, action) in [("scrubShortcut", "scrub"), ("restoreShortcut", "restore")] {
        let shortcut = settings[key].as_str().ok_or("shortcutConflict")?;
        app.global_shortcut()
            .on_shortcut(shortcut, move |app, _, event| {
                if event.state == ShortcutState::Pressed && request(app, action).is_err() {
                    eprintln!("Scrub: cannot focus action window");
                }
            })
            .map_err(|_| "shortcutConflict")?;
    }
    Ok(())
}
#[tauri::command]
fn bootstrap(app: tauri::AppHandle, state: State<Shared>) -> Result<Value, String> {
    let dir = storage::directory(&app)?;
    let mut s = state.lock().map_err(|_| "stateError")?;
    if dir.join("mappings.json").exists() {
        s.mappings = storage::mappings(&dir)?;
        s.settings["keepMappings"] = json!(true);
    }
    Ok(
        json!({"settings":s.settings,"mappings":s.mappings,"wayland":wayland(),"shortcutError":s.shortcut_error,"version":env!("CARGO_PKG_VERSION")}),
    )
}
#[tauri::command]
fn frontend_ready(state: State<Shared>) -> Result<Vec<String>, String> {
    let mut s = state.lock().map_err(|_| "stateError")?;
    s.ready = true;
    Ok(std::mem::take(&mut s.pending))
}
#[tauri::command]
async fn read_clipboard(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "linux")]
    if wayland() {
        return wayland_clipboard::read(app).await;
    }
    app.clipboard()
        .read_text()
        .map_err(|_| "clipboardEmpty".into())
}
#[tauri::command]
async fn write_clipboard(app: tauri::AppHandle, text: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    if wayland() {
        return wayland_clipboard::write(app, text).await;
    }
    app.clipboard()
        .write_text(text)
        .map_err(|_| "clipboardError".into())
}
#[tauri::command]
fn notify(app: tauri::AppHandle, message: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    if let Some(id) = windows_notification::packaged_id()? {
        return tauri_winrt_notification::Toast::new(&id)
            .title("Scrub")
            .text1(&message)
            .show()
            .map_err(|_| "notificationError".into());
    }
    app.notification()
        .builder()
        .title("Scrub")
        .body(message)
        .show()
        .map_err(|_| "notificationError".into())
}
#[tauri::command]
fn hide_window(app: tauri::AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or("windowError")?
        .hide()
        .map_err(|_| "windowError".into())
}
#[tauri::command]
fn save_settings(
    app: tauri::AppHandle,
    state: State<Shared>,
    value: Value,
) -> Result<Value, String> {
    let mut s = state.lock().map_err(|_| "stateError")?;
    if !value.is_object() {
        return Err("settingsError".into());
    }
    let mut next = s.settings.clone();
    for (key, v) in value.as_object().ok_or("settingsError")? {
        if next.get(key).is_none() {
            return Err("settingsError".into());
        }
        next[key] = v.clone();
    }
    let changed = next["scrubShortcut"] != s.settings["scrubShortcut"]
        || next["restoreShortcut"] != s.settings["restoreShortcut"];
    if changed {
        app.global_shortcut()
            .unregister_all()
            .map_err(|_| "shortcutConflict")?;
        if shortcuts(&app, &next).is_err() {
            app.global_shortcut()
                .unregister_all()
                .map_err(|_| "shortcutConflict")?;
            s.shortcut_error = shortcuts(&app, &s.settings).is_err();
            return Err("shortcutConflict".into());
        }
    }
    if next["autostart"] != s.settings["autostart"] {
        if next["autostart"] == true {
            app.autolaunch().enable()
        } else {
            app.autolaunch().disable()
        }
        .map_err(|_| "autostartError")?;
    }
    let dir = storage::directory(&app)?;
    let _lock = storage::Lock::acquire(&dir)?;
    if next["keepMappings"] == true && s.settings["keepMappings"] != true {
        let merged = storage::merge_mappings(&storage::mappings(&dir)?, &s.mappings)?;
        storage::atomic(&dir.join("mappings.json"), &merged)?;
        s.mappings = merged;
    } else if next["keepMappings"] == false
        && s.settings["keepMappings"] == true
        && dir.join("mappings.json").exists()
    {
        fs::remove_file(dir.join("mappings.json")).map_err(|_| "storageError")?;
    }
    storage::atomic(&dir.join("settings.json"), &next)?;
    s.settings = next.clone();
    Ok(next)
}
#[tauri::command]
fn set_mappings(app: tauri::AppHandle, state: State<Shared>, value: Value) -> Result<(), String> {
    if value["version"] != 1
        || !value["recent"].is_array()
        || value["recent"].as_array().is_some_and(|v| v.len() > 10)
    {
        return Err("mappingError".into());
    }
    let mut value = value;
    let mut s = state.lock().map_err(|_| "stateError")?;
    if s.settings["keepMappings"] == true {
        let dir = storage::directory(&app)?;
        let _lock = storage::Lock::acquire(&dir)?;
        value = storage::merge_mappings(&storage::mappings(&dir)?, &value)?;
        storage::atomic(&dir.join("mappings.json"), &value)?;
    }
    s.mappings = value;
    Ok(())
}
#[tauri::command]
fn clear_mappings(app: tauri::AppHandle, state: State<Shared>) -> Result<(), String> {
    let dir = storage::directory(&app)?;
    let _lock = storage::Lock::acquire(&dir)?;
    let path = dir.join("mappings.json");
    if path.exists() {
        fs::remove_file(path).map_err(|_| "storageError")?;
    }
    state.lock().map_err(|_| "stateError")?.mappings = storage::empty_store();
    Ok(())
}
#[tauri::command]
async fn choose_file(app: tauri::AppHandle, kind: String) -> Result<Option<Value>, String> {
    let filters = if kind == "dictionary" {
        vec!["csv"]
    } else if kind == "mapping" {
        vec!["json"]
    } else {
        vec!["docx", "txt", "csv", "md"]
    };
    let chosen = app
        .dialog()
        .file()
        .add_filter("Scrub", &filters)
        .blocking_pick_file();
    let Some(file) = chosen else { return Ok(None) };
    let path = file.into_path().map_err(|_| "fileError")?;
    let bytes = fs::read(&path).map_err(|_| "fileError")?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("fileError")?;
    Ok(Some(json!({"name":name,"bytes":bytes})))
}
#[tauri::command]
async fn save_file(app: tauri::AppHandle, name: String, bytes: Vec<u8>) -> Result<bool, String> {
    let safe = std::path::Path::new(&name)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("fileError")?;
    let Some(chosen) = app.dialog().file().set_file_name(safe).blocking_save_file() else {
        return Ok(false);
    };
    let path = chosen.into_path().map_err(|_| "fileError")?;
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    use std::io::Write;
    options
        .open(path)
        .and_then(|mut f| f.write_all(&bytes))
        .map_err(|_| "fileError")?;
    Ok(true)
}
#[tauri::command]
fn finish_self_test(app: tauri::AppHandle, success: bool, previous: Option<String>) {
    #[cfg(target_os = "linux")]
    let success = match previous {
        Some(text) => preserve_clipboard(&app, &text).is_ok() && success,
        None => false,
    };
    #[cfg(not(target_os = "linux"))]
    let _ = previous;
    app.exit(if success { 0 } else { 1 });
}

// X11 clipboard data belongs to its owner process. A short-lived owner keeps the
// restored text available after self-test exits, even without a desktop manager.
#[cfg(target_os = "linux")]
fn preserve_clipboard(app: &tauri::AppHandle, text: &str) -> Result<(), String> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let executable = std::env::current_exe().map_err(|_| "clipboardError")?;
    let mut child = Command::new(executable)
        .arg("--clipboard-keeper")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "clipboardError")?;
    child
        .stdin
        .take()
        .ok_or("clipboardError")?
        .write_all(text.as_bytes())
        .map_err(|_| "clipboardError")?;
    use std::io::Read;
    let mut ready = [0_u8];
    child
        .stdout
        .take()
        .ok_or("clipboardError")?
        .read_exact(&mut ready)
        .map_err(|_| "clipboardError")?;
    if ready == [1] && app.clipboard().read_text().is_ok_and(|value| value == text) {
        Ok(())
    } else {
        Err("clipboardError".into())
    }
}

#[cfg(target_os = "linux")]
fn clipboard_keeper() -> Result<(), Box<dyn std::error::Error>> {
    use std::io::Read;
    use std::io::Write;
    let mut text = String::new();
    std::io::stdin().read_to_string(&mut text)?;
    let mut clipboard = arboard::Clipboard::new()?;
    clipboard.set_text(text.clone())?;
    std::io::stdout().write_all(&[1])?;
    std::io::stdout().flush()?;
    while clipboard.get_text().is_ok_and(|value| value == text) {
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    Ok(())
}

#[tauri::command]
fn open_link(url: String) -> Result<(), String> {
    if ![
        "https://github.com/onurkat/scrub-desktop",
        "https://github.com/sponsors/onurkat",
        "mailto:onur@okteknoloji.com",
    ]
    .contains(&url.as_str())
    {
        return Err("linkError".into());
    }
    #[cfg(target_os = "linux")]
    let mut command = std::process::Command::new("xdg-open");
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = std::process::Command::new("rundll32.exe");
        c.arg("url.dll,FileProtocolHandler");
        c
    };
    command
        .arg(url)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|_| "linkError")?;
    Ok(())
}

#[tauri::command]
fn menu_labels(
    app: tauri::AppHandle,
    labels: HashMap<String, String>,
    recent: Vec<Value>,
) -> Result<(), String> {
    let label = |k: &str| labels.get(k).cloned().unwrap_or_else(|| k.to_string());
    let menu = Menu::new(&app).map_err(|_| "menuError")?;
    for (id, key) in [
        ("scrub", "scrubClipboard"),
        ("restore", "restoreClipboard"),
        ("open", "openScrub"),
        ("dictionary", "dictionary"),
    ] {
        menu.append(
            &MenuItem::with_id(&app, id, label(key), true, None::<&str>)
                .map_err(|_| "menuError")?,
        )
        .map_err(|_| "menuError")?;
    }
    let sub = Submenu::new(&app, label("recent"), true).map_err(|_| "menuError")?;
    for row in recent.iter().take(10) {
        let id = row["id"].as_str().ok_or("mappingError")?;
        let text = row["label"].as_str().ok_or("mappingError")?;
        sub.append(
            &MenuItem::with_id(&app, format!("recent:{id}"), text, true, None::<&str>)
                .map_err(|_| "menuError")?,
        )
        .map_err(|_| "menuError")?;
    }
    menu.append(&sub).map_err(|_| "menuError")?;
    for (id, key) in [("settings", "settings"), ("quit", "quit")] {
        menu.append(
            &MenuItem::with_id(&app, id, label(key), true, None::<&str>)
                .map_err(|_| "menuError")?,
        )
        .map_err(|_| "menuError")?;
    }
    app.tray_by_id("scrub")
        .ok_or("menuError")?
        .set_menu(Some(menu))
        .map_err(|_| "menuError".into())
}
fn tray_image(dark: bool) -> Result<tauri::image::Image<'static>, tauri::Error> {
    let bytes: &'static [u8] = if dark {
        include_bytes!("../icons/tray-dark.png")
    } else {
        include_bytes!("../icons/tray-light.png")
    };
    tauri::image::Image::from_bytes(bytes)
}

fn main() {
    #[cfg(target_os = "linux")]
    if std::env::args().any(|arg| arg == "--clipboard-keeper") {
        std::process::exit(if clipboard_keeper().is_ok() { 0 } else { 1 });
    }
    let result = tauri::Builder::default()
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("navigation-guard")
                .on_navigation(|_, url| {
                    url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")
                })
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            let action = if args.iter().any(|a| a == "--scrub-clipboard") {
                "scrub"
            } else if args.iter().any(|a| a == "--restore-clipboard") {
                "restore"
            } else {
                "open"
            };
            if request(app, action).is_err() {
                eprintln!("Scrub: action unavailable");
            }
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let dir = storage::directory(app.handle()).map_err(std::io::Error::other)?;
            let settings = storage::read(&dir.join("settings.json"), defaults())
                .map_err(std::io::Error::other)?;
            let mappings = storage::mappings(&dir).map_err(std::io::Error::other)?;
            let shortcut_error = shortcuts(app.handle(), &settings).is_err();
            let args: Vec<String> = std::env::args().collect();
            let action = if args.iter().any(|a| a == "--self-test") {
                Some("self-test")
            } else if args.iter().any(|a| a == "--scrub-clipboard") {
                Some("scrub")
            } else if args.iter().any(|a| a == "--restore-clipboard") {
                Some("restore")
            } else if args.iter().any(|a| a == "--open") || settings["welcomed"] != true {
                Some("open")
            } else {
                None
            };
            app.manage(Mutex::new(AppState {
                ready: false,
                pending: action.into_iter().map(str::to_string).collect(),
                settings,
                mappings,
                shortcut_error,
            }));
            let theme = app
                .get_webview_window("main")
                .and_then(|window| window.theme().ok());
            let icon = tray_image(theme == Some(tauri::Theme::Dark))?;
            TrayIconBuilder::with_id("scrub")
                .icon(icon)
                .icon_as_template(true)
                .tooltip("Scrub")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        app.exit(0);
                    } else if request(app, event.id.as_ref()).is_err() {
                        eprintln!("Scrub: menu action unavailable");
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) && request(tray.app_handle(), "open").is_err()
                    {
                        eprintln!("Scrub: window unavailable");
                    }
                })
                .build(app)?;
            if action.is_some() {
                let window = app.get_webview_window("main").ok_or("Window unavailable")?;
                window.show()?;
                window.set_focus()?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::ThemeChanged(theme) = event {
                if let Some(tray) = window.app_handle().tray_by_id("scrub") {
                    match tray_image(*theme == tauri::Theme::Dark) {
                        Ok(icon) => {
                            if tray.set_icon(Some(icon)).is_err() {
                                eprintln!("Scrub: tray theme unavailable");
                            }
                        }
                        Err(_) => eprintln!("Scrub: tray icon unavailable"),
                    }
                }
            }

            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if window.hide().is_err() {
                    eprintln!("Scrub: cannot hide window");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            frontend_ready,
            read_clipboard,
            write_clipboard,
            notify,
            hide_window,
            save_settings,
            set_mappings,
            clear_mappings,
            choose_file,
            save_file,
            finish_self_test,
            menu_labels,
            open_link
        ])
        .run(tauri::generate_context!());
    if result.is_err() {
        eprintln!("Scrub: unable to initialize desktop integration");
        std::process::exit(1);
    }
}
