// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "TraconMac",
    platforms: [.macOS(.v14)],
    targets: [
        // Snapshot model, engine fetch, account sorting and the account card, shared by the app and the widgets.
        .target(name: "TraconKit", path: "Sources/TraconKit"),
        .executableTarget(name: "TraconBar", dependencies: ["TraconKit"], path: "Sources/TraconBar"),
        .executableTarget(name: "TraconWidget", dependencies: ["TraconKit"], path: "Sources/TraconWidget"),
        .testTarget(name: "TraconKitTests", dependencies: ["TraconKit"], path: "Tests/TraconKitTests"),
    ]
)
