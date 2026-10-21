import Foundation

// Port of packages/tracon-ui/src/components/fleet/sortAccounts.ts; keep the two in step.

public enum SortKey: String, CaseIterable, Codable, Sendable, Identifiable {
    case profile, fiveLeft, weekLeft, fiveReset, weekReset, tokens
    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .profile: "Profile"
        case .fiveLeft: "5-hour left"
        case .weekLeft: "Weekly left"
        case .fiveReset: "5-hour reset"
        case .weekReset: "Weekly reset"
        case .tokens: "Tokens used"
        }
    }

    /// Lower rank = better (more quota left, sooner reset, fewer tokens). nil = no data.
    func rank(_ a: Account, _ i: Int) -> Double? {
        switch self {
        case .profile: Double(i)
        case .fiveLeft: a.fiveHour?.pct
        case .weekLeft: a.weekly?.pct
        case .fiveReset: a.fiveHour?.resetsAt?.timeIntervalSince1970
        case .weekReset: a.weekly?.resetsAt?.timeIntervalSince1970
        case .tokens: a.tokens.map(Double.init)
        }
    }

    /// How a gap on this measure reads: "12%", "1h5m", "3.4k tok".
    public func gapText(_ d: Double) -> String {
        switch self {
        case .profile: ""
        case .fiveLeft, .weekLeft: "\(Int(d.rounded()))%"
        case .fiveReset, .weekReset: Format.span(d)
        case .tokens: "\(Format.tokens(Int(d))) tok"
        }
    }
}

/// Best first unless `worstFirst`; accounts without the data always go last, ties keep profile order.
public func sortAccounts(_ accounts: [Account], _ key: SortKey, worstFirst: Bool) -> [Account] {
    accounts.enumerated()
        .map { (i: $0.offset, a: $0.element, v: key.rank($0.element, $0.offset)) }
        .sorted { x, y in
            switch (x.v, y.v) {
            case (nil, nil): return x.i < y.i
            case (nil, _): return false
            case (_, nil): return true
            case let (a?, b?): return a == b ? x.i < y.i : worstFirst ? a > b : a < b
            }
        }
        .map(\.a)
}

/// How far apart two accounts are on the sort's measure; nil in profile order or when either lacks the data.
public func gap(_ key: SortKey, _ a: Account, _ b: Account) -> Double? {
    guard key != .profile, let x = key.rank(a, 0), let y = key.rank(b, 0) else { return nil }
    return abs(x - y)
}

/// The sort the menu bar app last chose. The app writes it, the widgets read it (their sandbox allows reading this folder).
public struct ViewPrefs: Codable, Equatable, Sendable {
    public var sort: SortKey = .profile
    public var worstFirst = false
    public init(sort: SortKey = .profile, worstFirst: Bool = false) { self.sort = sort; self.worstFirst = worstFirst }

    /// Real home, not the widget's sandbox container.
    public static var file: URL {
        let home = getpwuid(getuid()).map { String(cString: $0.pointee.pw_dir) } ?? NSHomeDirectory()
        return URL(fileURLWithPath: home + "/Library/Application Support/TRACON/view.json")
    }

    public static func load() -> ViewPrefs {
        (try? Data(contentsOf: file)).flatMap { try? JSONDecoder().decode(ViewPrefs.self, from: $0) } ?? ViewPrefs()
    }

    public func save() throws {
        try FileManager.default.createDirectory(at: Self.file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(self).write(to: Self.file, options: .atomic)
    }
}
