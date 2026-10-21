import SwiftUI
import TraconKit

// Stub: the menu bar subagent replaces this.
@main
struct TraconBarApp: App {
    var body: some Scene {
        MenuBarExtra("TRACON", systemImage: "gauge.with.dots.needle.33percent") { Text("TRACON") }
    }
}
