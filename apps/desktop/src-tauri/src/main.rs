#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Err(error) = rino_desktop_lib::run() {
        rino_desktop_lib::report_startup_failure(&error);
        std::process::exit(1);
    }
}
