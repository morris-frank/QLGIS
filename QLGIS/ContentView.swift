import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("QLGIS")
                .font(.largeTitle.weight(.semibold))

            Text("Quick Look preview host for geospatial files.")
                .font(.title3)
                .foregroundStyle(.secondary)

            Divider()

            VStack(alignment: .leading, spacing: 10) {
                Text("Build notes")
                    .font(.headline)

                Text("1. Configure Config/Secrets.xcconfig with a MapTiler API key.")
                Text("2. Run npm install in web/.")
                Text("3. Build and launch this app once to register the preview extension.")
                Text("4. Preview files from Finder with Space or qlmanage -p.")
            }
            .font(.body.monospaced())

            Spacer()
        }
        .padding(28)
    }
}

