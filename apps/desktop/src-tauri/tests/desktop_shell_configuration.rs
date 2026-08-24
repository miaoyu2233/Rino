//! Test assertions panic by design and report skips on standard error, so the workspace
//! lints that forbid those in production code are relaxed for this integration test.
#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::print_stderr,
    clippy::unwrap_used,
    reason = "an integration test reports failures by panicking and skips on stderr"
)]

use std::{error::Error, fs, path::Path};

use serde_json::Value;

fn read_json(path: &Path) -> Result<Value, Box<dyn Error>> {
    let content = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&content)?)
}

#[test]
fn desktop_configuration_has_one_safe_main_window() -> Result<(), Box<dyn Error>> {
    let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let config = read_json(&crate_root.join("tauri.conf.json"))?;
    let windows = config["app"]["windows"]
        .as_array()
        .ok_or_else(|| std::io::Error::other("app.windows must be an array"))?;

    assert_eq!(windows.len(), 1);
    assert_eq!(windows[0]["label"], "main");
    assert_eq!(windows[0]["url"], "index.html");
    assert_eq!(windows[0]["minWidth"], 1100);
    assert_eq!(windows[0]["minHeight"], 700);
    assert_eq!(windows[0]["dragDropEnabled"], false);
    assert_eq!(windows[0]["transparent"], false);
    assert_eq!(windows[0]["browserExtensionsEnabled"], false);
    assert_eq!(windows[0]["generalAutofillEnabled"], false);
    assert_eq!(config["app"]["withGlobalTauri"], false);

    Ok(())
}

#[test]
fn device_preview_capability_is_fixed_and_least_privilege() -> Result<(), Box<dyn Error>> {
    let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let capability = read_json(&crate_root.join("capabilities/device-preview.json"))?;
    assert_eq!(capability["local"], true);
    assert_eq!(capability["windows"], serde_json::json!(["device-preview"]));
    assert_eq!(
        capability["permissions"],
        serde_json::json!([
            "core:window:allow-inner-size",
            "core:window:allow-scale-factor",
            "core:event:allow-listen",
            "core:event:allow-unlisten",
            "device-preview"
        ])
    );
    let permission = fs::read_to_string(crate_root.join("permissions/device-preview.toml"))?;
    for command in [
        "runtime_preview_read",
        "device_preview_current",
        "device_preview_close",
    ] {
        assert!(permission.contains(command));
    }
    assert!(!permission.contains("runtime_request"));
    assert!(!permission.contains("device_preview_open"));
    assert!(!permission.contains("device_preview_publish"));
    assert!(!permission.contains("device_preview_focus"));
    assert!(!permission.contains("shell") && !permission.contains("process"));
    Ok(())
}

#[test]
fn device_preview_is_not_a_second_configured_window() -> Result<(), Box<dyn Error>> {
    let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let config = read_json(&crate_root.join("tauri.conf.json"))?;
    let windows = config["app"]["windows"]
        .as_array()
        .ok_or_else(|| std::io::Error::other("app.windows must be an array"))?;
    assert_eq!(windows.len(), 1);
    assert_eq!(windows[0]["label"], "main");
    assert!(
        !windows
            .iter()
            .any(|window| window["label"] == "device-preview")
    );
    let source = fs::read_to_string(crate_root.join("src/device_preview.rs"))?;
    assert!(source.contains("DEVICE_PREVIEW_WINDOW_LABEL: &str = \"device-preview\""));
    assert!(source.contains("index.html?window=device-preview"));
    Ok(())
}
#[test]
fn production_webview_policy_is_local_and_least_privilege() -> Result<(), Box<dyn Error>> {
    let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let config = read_json(&crate_root.join("tauri.conf.json"))?;
    let security = &config["app"]["security"];
    let production_csp = security["csp"]
        .as_str()
        .ok_or_else(|| std::io::Error::other("app.security.csp must be a string"))?;
    let capability = read_json(&crate_root.join("capabilities/main.json"))?;
    let permissions = capability["permissions"]
        .as_array()
        .ok_or_else(|| std::io::Error::other("capability permissions must be an array"))?;

    assert_eq!(security["freezePrototype"], false);
    let frontend_entry = fs::read_to_string(crate_root.join("../src/main.tsx"))?;
    assert!(frontend_entry.contains("hardenObjectPrototype();"));
    assert_eq!(security["dangerousDisableAssetCspModification"], false);
    assert_eq!(security["assetProtocol"]["enable"], false);
    assert_eq!(
        security["capabilities"],
        serde_json::json!(["main-local", "device-preview-local"])
    );
    assert!(production_csp.contains("default-src 'self'"));
    assert!(production_csp.contains("object-src 'none'"));
    assert!(!production_csp.contains("https://"));
    assert!(!production_csp.contains("ws://"));
    assert_eq!(capability["local"], true);
    assert_eq!(capability["windows"], serde_json::json!(["main"]));
    assert!(capability.get("remote").is_none());
    assert_eq!(
        capability["permissions"],
        serde_json::json!([
            "main-commands",
            "core:window:allow-inner-size",
            "core:window:allow-scale-factor",
            "core:event:allow-listen",
            "core:event:allow-unlisten"
        ])
    );
    assert!(!permissions.iter().any(|permission| {
        permission
            .as_str()
            .is_some_and(|name| name.contains("shell") || name.contains("create"))
    }));

    Ok(())
}

#[test]
fn no_shell_or_process_capability_reaches_the_frontend() -> Result<(), Box<dyn Error>> {
    let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let cargo_manifest = fs::read_to_string(crate_root.join("Cargo.toml"))?;
    let frontend_manifest = fs::read_to_string(crate_root.join("../package.json"))?;
    let capability = read_json(&crate_root.join("capabilities/main.json"))?;
    let permissions = capability["permissions"]
        .as_array()
        .ok_or_else(|| std::io::Error::other("capability permissions must be an array"))?;

    assert!(!cargo_manifest.contains("tauri-plugin-shell"));
    assert!(!frontend_manifest.contains("@tauri-apps/plugin-shell"));
    assert!(!permissions.iter().any(|permission| {
        permission
            .as_str()
            .is_some_and(|name| name.starts_with("shell:") || name.starts_with("process:"))
    }));

    Ok(())
}

/// The frontend reaches the runtime only through this reviewed command allowlist. A new
/// command must be added here deliberately, together with its security review.
#[test]
fn the_registered_command_surface_matches_its_allowlist() -> Result<(), Box<dyn Error>> {
    const ALLOWED_RUNTIME_COMMANDS: [&str; 7] = [
        "runtime_status",
        "runtime_start",
        "runtime_restart",
        "runtime_shutdown",
        "runtime_request",
        "runtime_preview_read",
        "runtime_capture_read",
    ];
    const ALLOWED_DEVICE_PREVIEW_COMMANDS: [&str; 5] = [
        "device_preview_open",
        "device_preview_publish",
        "device_preview_current",
        "device_preview_close",
        "device_preview_focus",
    ];
    const ALLOWED_PROJECT_COMMANDS: [&str; 12] = [
        "project_choose_location",
        "project_open",
        "project_create",
        "project_save",
        "project_store_capture",
        "project_read_image_asset",
        "project_cleanup_orphan_assets",
        "project_cleanup_orphan_graphs",
        "project_save_as",
        "project_close",
        "project_write_autosave",
        "project_discard_recovery",
    ];
    const ALLOWED_PUBLISHING_COMMANDS: [&str; 5] = [
        "publishing_status",
        "publishing_login",
        "publishing_logout",
        "publishing_export",
        "publishing_publish",
    ];

    let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let library_source = fs::read_to_string(crate_root.join("src/lib.rs"))?;
    let commands_source = fs::read_to_string(crate_root.join("src/commands.rs"))?;
    let device_preview_source = fs::read_to_string(crate_root.join("src/device_preview.rs"))?;
    let project_commands_source = fs::read_to_string(crate_root.join("src/project/commands.rs"))?;
    let publishing_commands_source =
        fs::read_to_string(crate_root.join("src/publishing/commands.rs"))?;

    let registered = library_source
        .split_once("generate_handler![")
        .and_then(|(_, rest)| rest.split_once(']'))
        .map(|(registered, _)| registered.to_owned())
        .ok_or_else(|| std::io::Error::other("the invoke handler registration was not found"))?;

    for command in ALLOWED_RUNTIME_COMMANDS
        .iter()
        .chain(ALLOWED_DEVICE_PREVIEW_COMMANDS.iter())
        .chain(ALLOWED_PROJECT_COMMANDS.iter())
        .chain(ALLOWED_PUBLISHING_COMMANDS.iter())
    {
        assert!(
            registered.contains(command),
            "the allowlisted command {command} is not registered"
        );
    }
    assert_eq!(
        registered.matches("commands::").count(),
        ALLOWED_RUNTIME_COMMANDS.len()
            + ALLOWED_PROJECT_COMMANDS.len()
            + ALLOWED_PUBLISHING_COMMANDS.len(),
        "a command outside the reviewed allowlist is registered"
    );
    assert_eq!(
        registered.matches("device_preview::").count(),
        ALLOWED_DEVICE_PREVIEW_COMMANDS.len(),
        "a device preview command outside the reviewed allowlist is registered",
    );
    assert_eq!(
        device_preview_source.matches("#[tauri::command]").count(),
        ALLOWED_DEVICE_PREVIEW_COMMANDS.len(),
        "a device preview command is defined outside the reviewed allowlist",
    );
    assert_eq!(
        commands_source.matches("#[tauri::command]").count(),
        ALLOWED_RUNTIME_COMMANDS.len(),
        "a runtime command is defined outside the reviewed allowlist"
    );
    assert_eq!(
        project_commands_source.matches("#[tauri::command]").count(),
        ALLOWED_PROJECT_COMMANDS.len(),
        "a project command is defined outside the reviewed allowlist"
    );
    assert_eq!(
        publishing_commands_source
            .matches("#[tauri::command]")
            .count(),
        ALLOWED_PUBLISHING_COMMANDS.len(),
        "a publishing command is defined outside the reviewed allowlist"
    );

    Ok(())
}
