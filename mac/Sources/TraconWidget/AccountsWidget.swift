import SwiftUI
import TraconKit
import WidgetKit

// The menu bar app's accounts list on the desktop: same accounts, same sort (ViewPrefs), mirrors AccountsRail.tsx.

struct AccountsEntry: TimelineEntry {
    let date: Date
    /// nil = engine offline
    var accounts: [Account]?
    var prefs = ViewPrefs()

    static func load() async -> AccountsEntry {
        AccountsEntry(date: .now, accounts: try? await Engine.snapshot().accounts, prefs: .load())
    }

    static let sample: AccountsEntry = {
        let now = Date.now
        let h: Double = 3600
        return AccountsEntry(date: now, accounts: [
            Account(profile: "", tier: "team_100", fiveHour: .init(pct: 62, resetsAt: now + 2 * h), weekly: .init(pct: 41, resetsAt: now + 80 * h), tokens: 1_840_000, updatedAt: now - 40),
            Account(profile: "BIZ", fiveHour: .init(pct: 18, resetsAt: now + 4 * h), weekly: .init(pct: 77, resetsAt: now + 30 * h), tokens: 420_000, updatedAt: now - 90),
            Account(profile: "HAT", fiveHour: .init(pct: 91, resetsAt: now + 0.5 * h), weekly: .init(pct: 88, resetsAt: now + 12 * h), tokens: 2_300_000, updatedAt: now - 15),
            Account(profile: "WORK", fiveHour: .init(pct: 5, resetsAt: now + 4.8 * h), weekly: .init(pct: 12, resetsAt: now + 150 * h), tokens: 73_584, updatedAt: now - 300),
            Account(profile: "GRR"),
        ], prefs: ViewPrefs(sort: .fiveLeft))
    }()
}

struct AccountsProvider: TimelineProvider {
    func placeholder(in context: Context) -> AccountsEntry { .sample }

    func getSnapshot(in context: Context, completion: @escaping (AccountsEntry) -> Void) {
        let preview = context.isPreview
        Task {
            let e = await AccountsEntry.load()
            // the widget gallery shows sample accounts rather than an offline card
            completion(preview && e.accounts == nil ? .sample : e)
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<AccountsEntry>) -> Void) {
        Task {
            let e = await AccountsEntry.load()
            completion(Timeline(entries: [e], policy: .after(e.date + 5 * 60)))
        }
    }
}

struct AccountsView: View {
    let entry: AccountsEntry
    let family: WidgetFamily

    private var sort: SortKey { entry.prefs.sort }
    private var compact: Bool { family != .systemLarge }

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 4 : 6) {
            header
            if let accounts = entry.accounts {
                if accounts.isEmpty {
                    note("No Claude profiles found.")
                } else {
                    cards(sortAccounts(accounts, sort, worstFirst: entry.prefs.worstFirst))
                }
            } else {
                note("Engine offline · 127.0.0.1:4040")
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        // own margins (content margins are disabled): the system's leave room for only one compact card in small
        .padding(.horizontal, compact ? 10 : 14).padding(.vertical, compact ? 8 : 14)
    }

    private var header: some View {
        let order = "\(sort.label) · \(entry.prefs.worstFirst ? "worst" : "best") first"
        let asOf = Text("as of \(entry.date, style: .time)")
        return ViewThatFits(in: .horizontal) {
            HStack { Text("ACCOUNTS · \(order)"); Spacer(minLength: 4); asOf }
            VStack(alignment: .leading, spacing: 1) {
                HStack { Text("ACCOUNTS"); Spacer(minLength: 4); asOf }
                Text(order)
            }
        }
        .font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary).lineLimit(1)
    }

    private func note(_ s: String) -> some View {
        Text(s).font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
    }

    private var maxCards: Int {
        switch family {
        case .systemSmall: 2
        case .systemMedium: 4
        default: 12
        }
    }

    /// The most accounts that fit, best-sorted first; fewer when the cards would overflow.
    private func cards(_ sorted: [Account]) -> some View {
        ViewThatFits(in: .vertical) {
            ForEach((1...min(maxCards, sorted.count)).reversed(), id: \.self) { n in
                list(Array(sorted.prefix(n)))
            }
        }
    }

    @ViewBuilder private func list(_ shown: [Account]) -> some View {
        switch family {
        case .systemSmall:
            VStack(spacing: 10) { ForEach(shown) { SmallCard(account: $0) } }
        case .systemMedium:
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 14), GridItem(.flexible())], spacing: 6) {
                ForEach(shown) { AccountCard($0, compact: true) }
            }
        default:
            VStack(spacing: 4) {
                ForEach(Array(shown.enumerated()), id: \.element.id) { i, a in
                    if i > 0, let d = gap(sort, shown[i - 1], a) {
                        Text("Δ \(sort.gapText(d)) \(sort.label.lowercased())")
                            .font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
                    }
                    AccountCard(a)
                        .padding(6)
                        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 6))
                }
            }
        }
    }
}

/// AccountCard(compact:) with the two gauges side by side: two stacked compact cards overflow the small widget.
private struct SmallCard: View {
    let account: Account

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(account.path).font(.system(size: 11, design: .monospaced)).lineLimit(1)
                Spacer(minLength: 4)
                Text(Format.squawk(account.tier)).font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                QuotaGauge("5-HOUR", account.fiveHour, showReset: false)
                QuotaGauge("WEEKLY", account.weekly, showReset: false)
            }
            .lineLimit(1).minimumScaleFactor(0.8)
        }
    }
}

struct AccountsWidgetView: View {
    let entry: AccountsEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        AccountsView(entry: entry, family: family)
            .widgetURL(URL(string: "tracon://deck"))
            .widgetBackground()
    }
}

struct AccountsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TraconAccounts", provider: AccountsProvider()) { AccountsWidgetView(entry: $0) }
            .configurationDisplayName("TRACON Accounts")
            .description("Your Claude profiles' 5-hour and weekly quota, in the menu bar app's sort.")
            .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
            .contentMarginsDisabled()
    }
}
