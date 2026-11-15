use tauri::{Manager, Theme, WebviewWindow, WindowEvent};
use windows_sys::Win32::Graphics::Dwm::{DWMWA_CAPTION_COLOR, DwmSetWindowAttribute};

/// Match the native Windows caption to --bg in src/theme.css.
fn sync_caption(window: &WebviewWindow, theme: Theme) {
    let Ok(hwnd) = window.hwnd() else { return };
    let color: u32 = match theme {
        Theme::Dark => 0x001e1e1e,
        _ => 0x00ffffff,
    };
    // SAFETY: hwnd belongs to this live Tauri window, and color is a COLORREF
    // that remains valid for the entire synchronous call. Older Windows versions
    // may reject the attribute; retain their normal caption in that case.
    unsafe {
        DwmSetWindowAttribute(
            hwnd.0,
            DWMWA_CAPTION_COLOR as u32,
            (&color as *const u32).cast(),
            std::mem::size_of_val(&color) as u32,
        );
    }
}

pub fn init(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else { return };
    if let Ok(theme) = window.theme() {
        sync_caption(&window, theme);
    }
    let target = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::ThemeChanged(theme) => sync_caption(&target, *theme),
        WindowEvent::Focused(_) => {
            if let Ok(theme) = target.theme() {
                sync_caption(&target, theme);
            }
        }
        _ => {}
    });
}
