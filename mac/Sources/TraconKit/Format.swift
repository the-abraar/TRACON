import Foundation

/// Same text as the Flight Deck (FlightCard.tsx, AccountsRail.tsx).
public enum Format {
    public static func tokens(_ n: Int) -> String {
        n >= 1_000_000 ? String(format: "%.1fM", Double(n) / 1e6) : n >= 1000 ? String(format: "%.1fk", Double(n) / 1e3) : String(n)
    }

    /// seconds -> "42m", "3h5m", "2d4h"
    public static func span(_ seconds: Double) -> String {
        let m = max(0, Int((seconds / 60).rounded()))
        return m < 60 ? "\(m)m" : m < 1440 ? "\(m / 60)h\(m % 60)m" : "\(m / 1440)d\((m % 1440) / 60)h"
    }

    public static func until(_ date: Date, now: Date = .now) -> String { span(date.timeIntervalSince(now)) }

    public static func ago(_ date: Date, now: Date = .now) -> String {
        let s = max(0, Int(now.timeIntervalSince(date).rounded()))
        return s < 60 ? "\(s)s ago" : s < 3600 ? "\(s / 60)m ago" : "\(s / 3600)h ago"
    }

    public static func squawk(_ tier: String) -> String {
        ["pro_20": "SQ-20", "team_100": "SQ-100", "api_usage": "SQ-API", "gemini": "SQ-AGY"][tier] ?? tier
    }
}
