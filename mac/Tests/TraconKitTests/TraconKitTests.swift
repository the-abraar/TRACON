import XCTest
@testable import TraconKit

final class TraconKitTests: XCTestCase {
    let a = Account(profile: "", fiveHour: .init(pct: 50), tokens: 100)
    let b = Account(profile: "BIZ", fiveHour: .init(pct: 10))
    let c = Account(profile: "HAT", tokens: 10)

    func testSortBestWorstAndMissingLast() {
        XCTAssertEqual(sortAccounts([a, b, c], .fiveLeft, worstFirst: false).map(\.profile), ["BIZ", "", "HAT"])
        XCTAssertEqual(sortAccounts([a, b, c], .fiveLeft, worstFirst: true).map(\.profile), ["", "BIZ", "HAT"])
        XCTAssertEqual(sortAccounts([a, b, c], .tokens, worstFirst: false).map(\.profile), ["HAT", "", "BIZ"])
        XCTAssertEqual(sortAccounts([a, b, c], .profile, worstFirst: false).map(\.profile), ["", "BIZ", "HAT"])
    }

    func testGap() {
        XCTAssertEqual(gap(.fiveLeft, a, b), 40)
        XCTAssertNil(gap(.fiveLeft, a, c))
        XCTAssertNil(gap(.profile, a, b))
        XCTAssertEqual(SortKey.fiveReset.gapText(3900), "1h5m")
    }

    func testDecodesEngineSnapshot() throws {
        // shape of a live GET /api/flights; tokens absent as older engines send it
        let json = """
        {"flights":[{"id":"x","timestamp":"2026-10-21T10:51:51.240Z","flightCallsign":"CL-HAT-BFF1","accountTier":"pro_20",
          "runtime":"claude-code","cwd":"/tmp","flightState":"holding","subagents":[],
          "fuelMetrics":{"inputTokens":1,"outputTokens":2,"totalTokens":3,"burnRatePerMin":7483,"quotaPercentage":0}}],
         "accounts":[{"profile":"HAT","tier":"pro_20","fiveHour":{"pct":0,"resetsAt":"2026-10-21T15:50:00.000Z"},
          "weekly":{"pct":38},"updatedAt":"2026-10-21T10:52:38.000Z"}],
         "decisions":[{"id":"d","callsign":"CL-HAT-BFF1","kind":"plan","tool":"ExitPlanMode","input":{},"cwd":"/tmp","createdAt":1761043911240}],
         "away":{"mode":"auto","away":false}}
        """
        let s = try Engine.decoder.decode(Snapshot.self, from: Data(json.utf8))
        XCTAssertEqual(s.flights.first?.flightState, "holding")
        XCTAssertEqual(s.accounts.first?.path, "~/.claude-hat")
        XCTAssertNil(s.accounts.first?.tokens)
        XCTAssertNotNil(s.accounts.first?.fiveHour?.resetsAt)
        XCTAssertEqual(s.decisions.first?.kind, "plan")
    }

    func testFormat() {
        XCTAssertEqual(Format.tokens(73584), "73.6k")
        XCTAssertEqual(Format.span(2 * 86400 + 4 * 3600), "2d4h")
        XCTAssertEqual(Format.squawk("team_100"), "SQ-100")
    }
}
