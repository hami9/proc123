// The desktop entry point, and deliberately nothing more.
//
// Everything is in `lib.rs` so that phase 18's Android target — which has no
// `main` of its own and calls `run()` through a mobile entry point — runs the
// same setup rather than a second copy of it.

// Without this a Windows release build opens a console window behind the app.
// It is `windows_subsystem`, not a `cfg`, so it has to sit at the crate root.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    proc123_app_lib::run();
}
