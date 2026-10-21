import SwiftUI

/// One quota bar, like the deck's Gauge: green, red past 80% used.
public struct QuotaGauge: View {
    let label: String
    let window: QuotaWindow?
    var showReset = true

    public init(_ label: String, _ window: QuotaWindow?, showReset: Bool = true) { self.label = label; self.window = window; self.showReset = showReset }

    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(label).font(.system(size: 9)).tracking(1.5).foregroundStyle(.secondary)
                Spacer()
                Text(window.map { "\(Int($0.pct.rounded()))%" } ?? "n/a").font(.system(size: 10, design: .monospaced))
            }
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(.quaternary)
                    if let w = window {
                        Capsule().fill(w.pct > 80 ? Color.red : Color.green).frame(width: g.size.width * min(1, max(0, w.pct / 100)))
                    }
                }
            }
            .frame(height: 5)
            if showReset, let r = window?.resetsAt {
                Text("resets in \(Format.until(r))").font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(window.map { "\(Int($0.pct.rounded())) percent used" } ?? "no data")
    }
}

/// The deck's account card (AccountsRail.tsx): profile, tier, 5-hour and weekly quota, tokens and mirror age.
/// `compact` drops the reset lines and the footer for small widgets.
public struct AccountCard: View {
    let account: Account
    var compact = false

    public init(_ account: Account, compact: Bool = false) { self.account = account; self.compact = compact }

    public var body: some View {
        VStack(alignment: .leading, spacing: compact ? 4 : 6) {
            HStack {
                Text(account.path).font(.system(size: 11, design: .monospaced)).lineLimit(1)
                Spacer()
                Text(Format.squawk(account.tier)).font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
            }
            QuotaGauge("5-HOUR", account.fiveHour, showReset: !compact)
            QuotaGauge("WEEKLY", account.weekly, showReset: !compact)
            if !compact {
                Text("\(account.tokens.map(Format.tokens) ?? "–") tok in window · \(account.updatedAt.map { "read \(Format.ago($0))" } ?? "no usage mirror (TRACON_QUOTA)")")
                    .font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
            }
        }
    }
}
