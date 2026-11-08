use std::sync::mpsc;

async fn on_main<T: Send + 'static>(
    app: tauri::AppHandle,
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (sender, receiver) = mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        if sender.send(operation()).is_err() {
            eprintln!("Scrub: clipboard request cancelled");
        }
    })
    .map_err(|_| "clipboardError")?;
    tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|_| "clipboardError")?
        .map_err(|_| "clipboardError")?
}

pub async fn read(app: tauri::AppHandle) -> Result<String, String> {
    on_main(app, || {
        gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD)
            .wait_for_text()
            .map(|text| text.to_string())
            .ok_or_else(|| "clipboardEmpty".into())
    })
    .await
}

pub async fn write(app: tauri::AppHandle, text: String) -> Result<(), String> {
    on_main(app, move || {
        let clipboard = gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD);
        clipboard.set_text(&text);
        clipboard.store();
        Ok(())
    })
    .await
}
