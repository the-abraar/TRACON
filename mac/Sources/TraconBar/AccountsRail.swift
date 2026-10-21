import SwiftUI
import TraconKit
import WidgetKit

/// Polls the engine and holds the rail's sort, which the widgets mirror through view.json.
@MainActor
final class RailModel: ObservableObject {
    /// The last good snapshot; kept while the engine is briefly unreachable.
    @Published var snapshot: Snapshot?
    @Published var offline = false
    @Published var prefs = ViewPrefs.load() {
        didSet {
            guard prefs != oldValue else { return }
            try? prefs.save()
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    func start() {
        Task {
            while !Task.isCancelled {
                do { snapshot = try await Engine.snapshot(); offline = false } catch { offline = true }
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }
}

/// The Flight Deck's accounts panel (AccountsRail.tsx): sort, best/worst first, and one card per Claude profile.
struct RailView: View {
    @ObservedObject var model: RailModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("ACCOUNTS").font(.system(size: 10, design: .monospaced)).tracking(2).foregroundStyle(.secondary)
            HStack(spacing: 6) {
                Picker("Sort accounts by", selection: $model.prefs.sort) {
                    ForEach(SortKey.allCases) { Text($0.label).tag($0) }
                }
                .labelsHidden()
                Button(model.prefs.worstFirst ? "WORST FIRST" : "BEST FIRST") { model.prefs.worstFirst.toggle() }
                    .font(.system(size: 10, design: .monospaced))
                    .help("Best = most quota left, soonest reset, fewest tokens. Accounts without data stay last.")
            }
            .controlSize(.small)
            content
            Divider()
            HStack {
                Button("Open Flight Deck") { NSWorkspace.shared.open(Engine.deck) }
                Spacer()
                Button("Quit") { NSApp.terminate(nil) }
            }
            .buttonStyle(.borderless)
            .font(.system(size: 11))
        }
        .padding(12)
        .frame(width: 280)
    }

    @ViewBuilder private var content: some View {
        if let accounts = model.snapshot?.accounts {
            if accounts.isEmpty {
                note("No Claude profiles found.")
            } else {
                ScrollView { cards(accounts) }
                    // ideal height = the cards, capped so many accounts scroll
                    .frame(maxHeight: 520)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } else if model.offline {
            note("Can't reach the TRACON engine. It isn't running on 127.0.0.1:4040.")
        } else {
            note("Connecting…")
        }
    }

    private func cards(_ accounts: [Account]) -> some View {
        let sort = model.prefs.sort
        let sorted = sortAccounts(accounts, sort, worstFirst: model.prefs.worstFirst)
        return VStack(spacing: 8) {
            ForEach(Array(sorted.enumerated()), id: \.element.id) { i, a in
                if i > 0, let d = gap(sort, sorted[i - 1], a) {
                    Text("Δ \(sort.gapText(d)) \(sort.label.lowercased())")
                        .font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary)
                }
                AccountCard(a)
                    .padding(8)
                    .background(RoundedRectangle(cornerRadius: 6).fill(.quaternary.opacity(0.4)))
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.quaternary))
            }
        }
    }

    private func note(_ text: String) -> some View {
        Text(text).font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }
}
