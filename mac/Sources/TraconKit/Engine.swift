import Foundation

// Mirrors the engine's Snapshot (packages/avalokita-engine/src/types.ts), only the fields the Mac app and widgets show.

public struct QuotaWindow: Decodable, Equatable, Sendable {
    /// percent of the window used
    public var pct: Double
    public var resetsAt: Date?
    public init(pct: Double, resetsAt: Date? = nil) { self.pct = pct; self.resetsAt = resetsAt }
}

public struct Account: Decodable, Equatable, Sendable, Identifiable {
    /// "" for ~/.claude, else the suffix: ~/.claude-biz -> "BIZ"
    public var profile: String
    public var tier: String
    public var fiveHour: QuotaWindow?
    public var weekly: QuotaWindow?
    /// optional: engines before the account-sorting commit don't send it
    public var tokens: Int?
    public var updatedAt: Date?
    public var id: String { profile }
    public var path: String { profile.isEmpty ? "~/.claude" : "~/.claude-\(profile.lowercased())" }

    public init(profile: String, tier: String = "pro_20", fiveHour: QuotaWindow? = nil, weekly: QuotaWindow? = nil, tokens: Int? = nil, updatedAt: Date? = nil) {
        self.profile = profile; self.tier = tier; self.fiveHour = fiveHour; self.weekly = weekly; self.tokens = tokens; self.updatedAt = updatedAt
    }
}

public struct Flight: Decodable, Equatable, Sendable, Identifiable {
    public struct Tool: Decodable, Equatable, Sendable { public var name: String; public var action: String; public var targetFile: String? }
    public struct Fuel: Decodable, Equatable, Sendable { public var totalTokens: Int; public var burnRatePerMin: Double }
    public struct Collision: Decodable, Equatable, Sendable { public var conflictingFlight: String; public var sharedFile: String }
    public var id: String
    public var timestamp: Date
    public var flightCallsign: String
    public var accountTier: String
    /// preflight | cruising | tool_executing | holding | landed | aborted
    public var flightState: String
    public var cwd: String
    public var activeTool: Tool?
    public var fuelMetrics: Fuel
    public var collisionWarning: Collision?
}

public struct Decision: Decodable, Equatable, Sendable, Identifiable {
    public var id: String
    public var callsign: String
    /// question | plan | permission
    public var kind: String
    public var tool: String
    public var cwd: String
    /// epoch ms
    public var createdAt: Double
}

public struct Snapshot: Decodable, Equatable, Sendable {
    public struct Away: Decodable, Equatable, Sendable { public var mode: String; public var away: Bool }
    public var flights: [Flight]
    public var accounts: [Account]
    public var decisions: [Decision]
    public var away: Away
}

public enum Engine {
    /// The local listener. 127.0.0.1 rather than localhost: the engine binds IPv4, and ATS leaves plain-http IP addresses alone.
    public static let deck = URL(string: "http://127.0.0.1:4040/")!

    public static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        let frac = ISO8601DateFormatter()
        frac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        d.dateDecodingStrategy = .custom { dec in
            let s = try dec.singleValueContainer().decode(String.self)
            guard let date = frac.date(from: s) ?? plain.date(from: s) else {
                throw DecodingError.dataCorrupted(.init(codingPath: dec.codingPath, debugDescription: "bad ISO date \(s)"))
            }
            return date
        }
        return d
    }()

    /// GET /api/flights; GETs on the local listener need no secret. Throws when the engine is down.
    public static func snapshot() async throws -> Snapshot {
        var req = URLRequest(url: deck.appendingPathComponent("api/flights"))
        req.timeoutInterval = 3
        let (data, res) = try await URLSession.shared.data(for: req)
        guard (res as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        return try decoder.decode(Snapshot.self, from: data)
    }
}
