// Do not open a console window in Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    crewboard_lib::run()
}
