import SwiftUI
import TraconKit
import WidgetKit

// Stub: a subagent replaces this.
struct AccountsEntry: TimelineEntry { let date: Date }

struct AccountsProvider: TimelineProvider {
    func placeholder(in context: Context) -> AccountsEntry { AccountsEntry(date: .now) }
    func getSnapshot(in context: Context, completion: @escaping (AccountsEntry) -> Void) { completion(AccountsEntry(date: .now)) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<AccountsEntry>) -> Void) {
        completion(Timeline(entries: [AccountsEntry(date: .now)], policy: .never))
    }
}

struct AccountsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TraconAccounts", provider: AccountsProvider()) { _ in Text("TRACON").widgetBackground() }
            .configurationDisplayName("TRACON Accounts")
    }
}
