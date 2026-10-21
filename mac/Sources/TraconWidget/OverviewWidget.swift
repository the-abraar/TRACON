import SwiftUI
import TraconKit
import WidgetKit

// The control-tower widget: header stats, held decisions and TCAS warnings, flights, and account quota.

/// `snapshot` is nil when the engine did not answer.
struct OverviewEntry: TimelineEntry {
    let date: Date
    let snapshot: Snapshot?
}

struct OverviewProvider: TimelineProvider {
    func placeholder(in context: Context) -> OverviewEntry { .sample }

    func getSnapshot(in context: Context, completion: @escaping (OverviewEntry) -> Void) {
        if context.isPreview { return completion(.sample) }
        Task { completion(await Self.fetch()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<OverviewEntry>) -> Void) {
        Task {
            let entry = await Self.fetch()
            completion(Timeline(entries: [entry], policy: .after(entry.date.addingTimeInterval(5 * 60))))
        }
    }

    static func fetch() async -> OverviewEntry {
        guard var s = try? await Engine.snapshot() else { return OverviewEntry(date: .now, snapshot: nil) }
        let prefs = ViewPrefs.load()
        s.accounts = sortAccounts(s.accounts, prefs.sort, worstFirst: prefs.worstFirst)
        return OverviewEntry(date: .now, snapshot: s)
    }
}

struct OverviewWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TraconOverview", provider: OverviewProvider()) { OverviewRoot(entry: $0) }
            .configurationDisplayName("TRACON Overview")
            .description("Flights, held decisions, collisions and account quota.")
            .supportedFamilies([.systemLarge, .systemExtraLarge])
    }
}

private struct OverviewRoot: View {
    @Environment(\.widgetFamily) private var family
    let entry: OverviewEntry

    var body: some View {
        OverviewView(entry: entry, wide: family == .systemExtraLarge)
            .widgetURL(URL(string: "tracon://deck"))
            .widgetBackground()
    }
}

// MARK: - Views

private func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight, design: .monospaced) }

/// The section headings of the deck: small, tracked capitals.
private func label(_ text: String, _ color: Color = .secondary) -> some View {
    Text(text).font(.system(size: 9, weight: .semibold)).tracking(1.5).foregroundStyle(color)
}

private func basename(_ path: String) -> String { path.split(separator: "/").last.map(String.init) ?? path }

struct OverviewView: View {
    let entry: OverviewEntry
    /// systemExtraLarge: full account cards in a column beside the flights.
    var wide = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            if let s = entry.snapshot {
                if wide {
                    HStack(alignment: .top, spacing: 14) {
                        VStack(alignment: .leading, spacing: 8) { needsYou(s); flights(s) }
                        accountCards(s.accounts).frame(width: 350)
                    }
                } else {
                    needsYou(s)
                    flights(s)
                    accountRows(s.accounts)
                }
            } else {
                VStack(spacing: 6) {
                    Image(systemName: "antenna.radiowaves.left.and.right.slash").font(.title).foregroundStyle(.red)
                    Text("ENGINE OFFLINE").font(mono(13, .bold)).foregroundStyle(.red)
                    Text("No answer from 127.0.0.1:4040").font(mono(10)).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            footer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 14) {
            HStack(spacing: 4) {
                Image(systemName: "dot.radiowaves.left.and.right")
                Text("TRACON").font(mono(13, .bold))
            }
            .foregroundStyle(.green)
            .fixedSize()
            Spacer(minLength: 0)
            if let s = entry.snapshot {
                let holding = s.flights.filter { $0.flightState == "holding" }.count
                stat("AIRBORNE", s.flights.filter { !["landed", "aborted"].contains($0.flightState) }.count)
                stat("HOLDING", holding, holding > 0 ? .orange : .primary)
                VStack(alignment: .trailing, spacing: 1) {
                    label("WAITING")
                    Text("\(s.decisions.count)").font(mono(13, .bold))
                        .foregroundStyle(s.decisions.isEmpty ? Color.primary : Color.black)
                        .padding(.horizontal, s.decisions.isEmpty ? 0 : 6)
                        .background(Capsule().fill(s.decisions.isEmpty ? Color.clear : Color.orange))
                }
            }
        }
    }

    private func stat(_ name: String, _ value: Int, _ color: Color = .primary) -> some View {
        VStack(alignment: .trailing, spacing: 1) {
            label(name)
            Text("\(value)").font(mono(13, .bold)).foregroundStyle(color)
        }
    }

    private var footer: some View {
        HStack {
            if let away = entry.snapshot?.away {
                Circle().fill(away.away ? Color.orange : Color.secondary).frame(width: 5, height: 5)
                Text("\(away.away ? "AWAY" : "AT THE MAC") · \(away.mode.uppercased())")
                    .foregroundStyle(away.away ? Color.orange : Color.secondary)
            }
            Spacer()
            Text("as of ") + Text(entry.date, style: .time)
        }
        .font(mono(9))
        .foregroundStyle(.secondary)
    }

    // Held decisions, oldest first, then TCAS pairs (each flight of a pair reports the other; show the pair once).
    @ViewBuilder private func needsYou(_ s: Snapshot) -> some View {
        let decisions = s.decisions.sorted { $0.createdAt < $1.createdAt }
        var seen = Set<String>()
        let tcas = s.flights.compactMap { f -> (a: String, b: String, file: String)? in
            guard let c = f.collisionWarning else { return nil }
            let key = [f.flightCallsign, c.conflictingFlight].sorted().joined(separator: "|") + "|" + c.sharedFile
            return seen.insert(key).inserted ? (f.flightCallsign, c.conflictingFlight, c.sharedFile) : nil
        }
        let total = decisions.count + tcas.count
        let room = wide ? 5 : 3
        if total > 0 {
            VStack(alignment: .leading, spacing: 4) {
                label("NEEDS YOU · \(total)", .orange)
                ForEach(decisions.prefix(room)) { decisionRow($0) }
                ForEach(Array(tcas.prefix(max(0, room - decisions.count)).enumerated()), id: \.offset) { _, t in
                    HStack(spacing: 5) {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red).font(.system(size: 10))
                        Text("TCAS").font(mono(9, .bold)).foregroundStyle(.red)
                        Text("\(t.a) ↔ \(t.b)").font(mono(10, .semibold)).lineLimit(1).layoutPriority(1)
                        Text(basename(t.file)).font(mono(10)).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                    }
                }
                if total > room { more(total - room) }
            }
        }
    }

    private func decisionRow(_ d: Decision) -> some View {
        let (icon, kind) = ["question": ("questionmark.bubble.fill", "QUESTION"), "plan": ("list.clipboard.fill", "PLAN"), "permission": ("key.fill", "PERMISSION")][d.kind]
            ?? ("hand.raised.fill", d.kind.uppercased())
        let fragment = d.id.addingPercentEncoding(withAllowedCharacters: .urlFragmentAllowed) ?? d.id
        return Link(destination: URL(string: "tracon://deck#d=\(fragment)") ?? URL(string: "tracon://deck")!) {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 10)).foregroundStyle(.orange)
                Text(kind).font(mono(9, .bold)).foregroundStyle(.orange)
                Text(d.callsign).font(mono(10, .semibold)).lineLimit(1).layoutPriority(1)
                Text(d.tool).font(mono(10)).foregroundStyle(.secondary).lineLimit(1)
                Text(d.cwd.split(separator: "/").suffix(2).joined(separator: "/"))
                    .font(mono(10)).foregroundStyle(.tertiary).lineLimit(1).truncationMode(.head)
                Spacer(minLength: 4)
                Text(Format.ago(Date(timeIntervalSince1970: d.createdAt / 1000), now: entry.date))
                    .font(mono(10)).foregroundStyle(.secondary).fixedSize()
            }
        }
        .buttonStyle(.plain)
    }

    /// Holding first, then the rest still airborne, then aborted and landed; newest first within each.
    @ViewBuilder private func flights(_ s: Snapshot) -> some View {
        let order = ["holding": 0, "aborted": 2, "landed": 3]
        let flights = s.flights.sorted {
            (order[$0.flightState] ?? 1, $1.timestamp) < (order[$1.flightState] ?? 1, $0.timestamp)
        }
        VStack(alignment: .leading, spacing: 4) {
            label("FLIGHTS · \(flights.count)")
            if flights.isEmpty {
                Text("No flights on the scope").font(mono(10)).foregroundStyle(.secondary)
            }
            // Largest list that fits the space left, with a "+N more" line for the rest.
            ViewThatFits(in: .vertical) {
                ForEach(Array(stride(from: flights.count, through: 0, by: -1)), id: \.self) { k in
                    VStack(alignment: .leading, spacing: 5) {
                        ForEach(flights.prefix(k)) { FlightRow(f: $0) }
                        if k < flights.count { more(flights.count - k) }
                    }
                }
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private func more(_ n: Int) -> some View {
        Text("+\(n) more").font(mono(9)).foregroundStyle(.secondary)
    }

    /// One line per account: the deck's gauges, flattened to fit the large widget.
    private func accountRows(_ accounts: [Account]) -> some View {
        VStack(spacing: 3) {
            HStack(spacing: 6) {
                label("ACCOUNTS").frame(width: 100, alignment: .leading)
                label("5-HOUR").frame(maxWidth: .infinity, alignment: .leading)
                label("WEEKLY").frame(maxWidth: .infinity, alignment: .leading)
            }
            ForEach(accounts) { a in
                HStack(spacing: 6) {
                    Text(a.path).font(mono(10)).lineLimit(1).frame(width: 100, alignment: .leading)
                    quota(a.fiveHour)
                    quota(a.weekly)
                }
            }
        }
    }

    private func quota(_ w: QuotaWindow?) -> some View {
        HStack(spacing: 4) {
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(.quaternary)
                    if let w { Capsule().fill(w.pct > 80 ? Color.red : Color.green).frame(width: g.size.width * min(1, max(0, w.pct / 100))) }
                }
            }
            .frame(height: 5)
            Text(w.map { "\(Int($0.pct.rounded()))%" } ?? "n/a").font(mono(10)).frame(width: 30, alignment: .trailing)
        }
    }

    /// Two columns of the deck's cards: full when they fit, else compact.
    private func accountCards(_ accounts: [Account]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            label("ACCOUNTS")
            ViewThatFits(in: .vertical) {
                ForEach([false, true], id: \.self) { compact in
                    LazyVGrid(columns: [GridItem(spacing: 6), GridItem()], spacing: 6) {
                        ForEach(accounts) { AccountCard($0, compact: compact).padding(6).background(.fill.quaternary, in: .rect(cornerRadius: 6)) }
                    }
                }
            }
        }
    }
}

private struct FlightRow: View {
    let f: Flight

    private static let states: [String: (String, Color)] = [
        "preflight": ("PREFLIGHT", .blue), "cruising": ("CRUISING", .green), "tool_executing": ("TOOL", .cyan),
        "holding": ("HOLDING", .orange), "landed": ("LANDED", .gray), "aborted": ("ABORTED", .red),
    ]

    var body: some View {
        let (name, color) = Self.states[f.flightState] ?? (f.flightState.uppercased(), .gray)
        let holding = f.flightState == "holding"
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 6) {
                Text(name).font(mono(8, .bold)).lineLimit(1)
                    .foregroundStyle(holding ? Color.black : color)
                    .frame(width: 58)
                    .padding(.vertical, 1)
                    .background(holding ? color : color.opacity(0.18), in: .rect(cornerRadius: 3))
                Text(f.flightCallsign).font(mono(11, .bold)).lineLimit(1)
                Text(Format.squawk(f.accountTier)).font(mono(8)).foregroundStyle(.secondary)
                Spacer(minLength: 4)
                Text("\(Format.tokens(Int(f.fuelMetrics.burnRatePerMin)))/min").font(mono(10)).fixedSize()
            }
            HStack(spacing: 6) {
                Group {
                    if let t = f.activeTool {
                        (Text(t.name).foregroundStyle(.cyan) + Text(t.targetFile.map { " " + basename($0) } ?? "").foregroundStyle(.secondary))
                    } else {
                        Text("no tool in flight").foregroundStyle(.tertiary)
                    }
                }
                .lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 4)
                Text("\(Format.tokens(f.fuelMetrics.totalTokens)) tok").foregroundStyle(.secondary).fixedSize()
            }
            .font(mono(10))
            .padding(.leading, 64)
        }
        .opacity(["landed", "aborted"].contains(f.flightState) ? 0.6 : 1)
    }
}

// MARK: - Sample data (placeholder and widget gallery)

extension OverviewEntry {
    /// Two holding flights with held decisions, a TCAS pair, eight flights and five accounts.
    static var sample: OverviewEntry {
        let now = Date.now
        let iso = { (min: Double) in ISO8601DateFormatter().string(from: now.addingTimeInterval(min * 60)) }
        let ms = { (min: Double) in Int(now.addingTimeInterval(min * 60).timeIntervalSince1970 * 1000) }
        func flight(_ id: String, _ cs: String, _ tier: String, _ state: String, _ age: Double, _ tool: String?, _ burn: Int, _ total: Int, tcas: String? = nil) -> String {
            """
            {"id":"\(id)","timestamp":"\(iso(-age))","flightCallsign":"\(cs)","accountTier":"\(tier)","flightState":"\(state)",
             "cwd":"/Users/me/dev/products/TRACON","fuelMetrics":{"totalTokens":\(total),"burnRatePerMin":\(burn)}
             \(tool.map { ",\"activeTool\":\($0)" } ?? "")
             \(tcas.map { ",\"collisionWarning\":{\"conflictingFlight\":\"\($0)\",\"sharedFile\":\"/Users/me/dev/products/TRACON/packages/tracon-ui/src/App.tsx\"}" } ?? "")}
            """
        }
        let edit = #"{"name":"Edit","action":"write","targetFile":"/Users/me/dev/products/TRACON/packages/tracon-ui/src/App.tsx"}"#
        let flights = [
            flight("f1", "CL-BIZ-7A21", "team_100", "holding", 4, #"{"name":"Bash","action":"bash"}"#, 1240, 184_200),
            flight("f2", "CL-HAT-BFF1", "pro_20", "holding", 2, #"{"name":"ExitPlanMode","action":"other"}"#, 860, 73_584),
            flight("f3", "CL-WRK-19C4", "team_100", "tool_executing", 0.2, edit, 7483, 412_900, tcas: "CL-GRR-0E77"),
            flight("f4", "CL-GRR-0E77", "pro_20", "cruising", 0.5, edit, 3120, 96_300, tcas: "CL-WRK-19C4"),
            flight("f5", "AG-AGY-3310", "gemini", "cruising", 1, #"{"name":"Read","action":"read","targetFile":"/Users/me/dev/products/TRACON/PLAN.md"}"#, 2010, 51_000),
            flight("f6", "CL-BIZ-55D0", "team_100", "preflight", 0.1, nil, 0, 1_200),
            flight("f7", "CL-HAT-0A9F", "pro_20", "landed", 40, nil, 0, 1_204_000),
            flight("f8", "CL-WRK-7777", "team_100", "aborted", 25, nil, 0, 8_800),
        ]
        func account(_ profile: String, _ tier: String, _ five: Int, _ week: Int, _ tokens: Int) -> String {
            #"{"profile":"\#(profile)","tier":"\#(tier)","fiveHour":{"pct":\#(five),"resetsAt":"\#(iso(97))"},"weekly":{"pct":\#(week),"resetsAt":"\#(iso(3 * 1440))"},"tokens":\#(tokens),"updatedAt":"\#(iso(-2))"}"#
        }
        let json = """
        {"flights":[\(flights.joined(separator: ","))],
         "accounts":[\([account("", "pro_20", 42, 61, 73_584), account("WORK", "team_100", 88, 47, 412_900), account("HAT", "pro_20", 12, 38, 9_100),
                        account("BIZ", "team_100", 64, 22, 184_200), account("GRR", "pro_20", 5, 91, 96_300)].joined(separator: ","))],
         "decisions":[
           {"id":"d-plan-1","callsign":"CL-HAT-BFF1","kind":"plan","tool":"ExitPlanMode","cwd":"/Users/me/dev/products/TRACON","createdAt":\(ms(-2))},
           {"id":"d-perm-1","callsign":"CL-BIZ-7A21","kind":"permission","tool":"Bash","cwd":"/Users/me/dev/clients/Emon","createdAt":\(ms(-4))}],
         "away":{"mode":"auto","away":false}}
        """
        return OverviewEntry(date: now, snapshot: try? Engine.decoder.decode(Snapshot.self, from: Data(json.utf8)))
    }
}
