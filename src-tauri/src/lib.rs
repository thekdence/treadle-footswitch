pub mod pedal;

use std::sync::{Arc, Mutex};

use hidapi::HidApi;
use pedal::{Pedal, PedalError, PedalState, SlotUpdate};

/// hidapi must be initialised once per process; every command shares it.
#[derive(Clone)]
struct Hid(Arc<Mutex<HidApi>>);

impl Hid {
    async fn with<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut HidApi) -> Result<T, PedalError> + Send + 'static,
    ) -> Result<T, PedalError> {
        let api = self.0.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let mut api = api.lock().unwrap_or_else(|e| e.into_inner());
            f(&mut api)
        })
        .await
        .expect("USB worker panicked")
    }
}

#[tauri::command]
async fn pedal_connected(hid: tauri::State<'_, Hid>) -> Result<bool, PedalError> {
    hid.with(|api| Ok(pedal::device::is_connected(api))).await
}

#[tauri::command]
async fn read_pedal(hid: tauri::State<'_, Hid>) -> Result<PedalState, PedalError> {
    hid.with(|api| Pedal::open(api)?.read_state()).await
}

#[tauri::command]
async fn write_pedal(
    hid: tauri::State<'_, Hid>,
    updates: Vec<SlotUpdate>,
) -> Result<PedalState, PedalError> {
    hid.with(move |api| Pedal::open(api)?.write(&updates)).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let api = HidApi::new().expect("failed to initialise USB HID");
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Hid(Arc::new(Mutex::new(api))))
        .invoke_handler(tauri::generate_handler![pedal_connected, read_pedal, write_pedal])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
