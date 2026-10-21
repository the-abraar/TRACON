import SwiftUI
import WidgetKit

@main
struct TraconWidgets: WidgetBundle {
    var body: some Widget {
        AccountsWidget()
        OverviewWidget()
    }
}

extension View {
    func widgetBackground() -> some View { containerBackground(.fill.tertiary, for: .widget) }
}
