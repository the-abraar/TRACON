import SwiftUI
import TraconKit
import WidgetKit

// Stub: a subagent replaces this.
struct OverviewEntry: TimelineEntry { let date: Date }

struct OverviewProvider: TimelineProvider {
    func placeholder(in context: Context) -> OverviewEntry { OverviewEntry(date: .now) }
    func getSnapshot(in context: Context, completion: @escaping (OverviewEntry) -> Void) { completion(OverviewEntry(date: .now)) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<OverviewEntry>) -> Void) {
        completion(Timeline(entries: [OverviewEntry(date: .now)], policy: .never))
    }
}

struct OverviewWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TraconOverview", provider: OverviewProvider()) { _ in Text("TRACON").widgetBackground() }
            .configurationDisplayName("TRACON Overview")
    }
}
