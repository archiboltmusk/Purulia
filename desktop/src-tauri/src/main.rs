// Parishkar desktop: one window over the live site. The site's own code and
// server rules run unchanged; links that leave the site open in the browser.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::{WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;
use url::Url;

// Hosts that stay inside the app window. Everything else (official portals,
// Wikipedia, WhatsApp, maps) opens in the system browser.
fn is_site(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "about" | "data" | "blob" => return true,
        "http" | "https" => {}
        _ => return false,
    }
    match url.host_str() {
        Some("archiboltmusk.github.io") => url.path().starts_with("/Purulia"),
        Some("purulia.vercel.app") | Some("purulia.mahatoanupam002.workers.dev") => true,
        // Bundled start page in dev / on Windows-style origins.
        Some("tauri.localhost") | Some("localhost") => true,
        // Frames the site embeds (Turnstile check, map embeds): the
        // navigation hook also sees subframe loads.
        Some("challenges.cloudflare.com") | Some("www.google.com") => true,
        _ => false,
    }
}

// Camera and location are what the site's report flow asks for; the site's own
// checks (live photo, GPS accuracy) still decide whether a report can be sent.
fn permission(on_site: bool, kind: PermissionKind) -> PermissionResponse {
    match kind {
        PermissionKind::Camera | PermissionKind::Geolocation if on_site => {
            PermissionResponse::Allow
        }
        _ => PermissionResponse::Deny,
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let handle = app.handle().clone();
            let popup_handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Parishkar")
                .inner_size(1280.0, 860.0)
                .min_inner_size(380.0, 560.0)
                .on_navigation(move |url| {
                    if is_site(url) {
                        return true;
                    }
                    let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                    false
                })
                .on_new_window(move |url, _features| {
                    // target=_blank links are the site's way of saying "leave the page":
                    // open them in the browser instead of a second app window.
                    let _ = popup_handle.opener().open_url(url.as_str(), None::<&str>);
                    tauri::webview::NewWindowResponse::Deny
                })
                .on_permission_request(|webview, kind| {
                    let on_site = webview.url().map(|u| is_site(&u)).unwrap_or(false);
                    permission(on_site, kind)
                })
                // Calendar (.ics), CSV, GPX and cover PNG downloads go to the
                // Downloads folder under the site's suggested name.
                .on_download(|_, _| true)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Parishkar");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_site_pages_in_the_window() {
        for u in [
            "https://archiboltmusk.github.io/Purulia/kasa.html",
            "https://purulia.vercel.app/case.html?id=1",
            "tauri://localhost/index.html",
        ] {
            assert!(is_site(&Url::parse(u).unwrap()), "{u}");
        }
    }

    #[test]
    fn sends_other_hosts_to_the_browser() {
        for u in [
            "https://archiboltmusk.github.io/other/",
            "https://en.wikipedia.org/wiki/Purulia",
            "https://wa.me/910000000000",
            "mailto:someone@example.org",
            "tel:15100",
        ] {
            assert!(!is_site(&Url::parse(u).unwrap()), "{u}");
        }
    }

    #[test]
    fn only_camera_and_location_on_the_site() {
        assert_eq!(
            permission(true, PermissionKind::Camera),
            PermissionResponse::Allow
        );
        assert_eq!(
            permission(true, PermissionKind::Geolocation),
            PermissionResponse::Allow
        );
        assert_eq!(
            permission(false, PermissionKind::Camera),
            PermissionResponse::Deny
        );
        assert_eq!(
            permission(true, PermissionKind::Microphone),
            PermissionResponse::Deny
        );
        assert_eq!(
            permission(true, PermissionKind::DisplayCapture),
            PermissionResponse::Deny
        );
    }
}
