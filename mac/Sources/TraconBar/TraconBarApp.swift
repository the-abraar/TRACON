import SwiftUI
import TraconKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let rail = RailModel()

    func applicationDidFinishLaunching(_ notification: Notification) {
        rail.start()
    }

    /// tracon://deck and tracon://deck#d=<decisionId>, from the widgets.
    func application(_ application: NSApplication, open urls: [URL]) {
        urls.compactMap(deckURL).forEach { NSWorkspace.shared.open($0) }
    }
}

/// tracon://deck[#d=<id>] -> the Flight Deck with the same fragment, which focuses that decision. nil for anything else.
func deckURL(_ url: URL) -> URL? {
    guard url.scheme == "tracon", url.host == "deck",
          var c = URLComponents(url: Engine.deck, resolvingAgainstBaseURL: false) else { return nil }
    c.percentEncodedFragment = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedFragment
    return c.url
}

@main
struct TraconBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var app

    init() {
        // Single instance: a second copy would poll and write view.json too.
        // The kernel drops the lock when this process dies, so it can't go stale.
        let fd = open(NSTemporaryDirectory() + "com.abraar.tracon.lock", O_CREAT | O_RDWR, 0o600)
        if fd >= 0 && flock(fd, LOCK_EX | LOCK_NB) != 0 { exit(0) }
    }

    var body: some Scene {
        MenuBarExtra("TRACON", systemImage: "gauge.with.dots.needle.33percent") {
            RailView(model: app.rail)
        }
        .menuBarExtraStyle(.window)
    }
}
