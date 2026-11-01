import Foundation

struct LauncherResources {
    let node: URL
    let entry: URL
    let app: URL

    init(bundle: Bundle = .main) throws {
        guard let resources = bundle.resourceURL else { throw LauncherError.message("找不到应用资源目录。") }
        node = resources.appendingPathComponent("node")
        app = resources.appendingPathComponent("app", isDirectory: true)
        entry = app.appendingPathComponent("apps/desktop/gui.mjs")
        let required = [entry, app.appendingPathComponent("apps/server/index.mjs"),
                        app.appendingPathComponent("apps/host/inject.mjs"), app.appendingPathComponent("dist/web/index.html")]
        guard FileManager.default.isExecutableFile(atPath: node.path),
              required.allSatisfy({ FileManager.default.isReadableFile(atPath: $0.path) }) else {
            throw LauncherError.message("应用文件不完整，请重新解压或安装 TaskManaer-Vison。")
        }
    }
}

enum LauncherError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}

struct LauncherSettings {
    static let supportDirectory = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/TaskManager", isDirectory: true)
    var directory = supportDirectory.appendingPathComponent("data", isDirectory: true)
    var port = 47830
    var cdpPort = 9231
    var mode = "embed"
    var launchHost = true
    var requiresExistingDirectory = false
    var error: String?

    static func load() -> LauncherSettings {
        var settings = LauncherSettings()
        let config = supportDirectory.appendingPathComponent("launcher.json")
        guard FileManager.default.fileExists(atPath: config.path) else { return settings }
        do {
            let data = try Data(contentsOf: config)
            guard data.count <= 16_384,
                  let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  value["version"] as? Int == 1,
                  let directory = value["dataDir"] as? String, directory.hasPrefix("/"),
                  let port = value["port"] as? Int, (1024...65535).contains(port),
                  let cdpPort = value["cdpPort"] as? Int, (1024...65535).contains(cdpPort),
                  let mode = value["mode"] as? String, ["embed", "web"].contains(mode),
                  let launchHost = value["launchHost"] as? Bool else {
                throw LauncherError.message("已保存的启动配置无法读取。请查看配置目录并修复 launcher.json，现有数据不会被改动。")
            }
            settings.directory = URL(fileURLWithPath: directory, isDirectory: true)
            settings.port = port
            settings.cdpPort = cdpPort
            settings.mode = mode
            settings.launchHost = launchHost
            settings.requiresExistingDirectory = true
        } catch { settings.error = error.localizedDescription }
        return settings
    }

    func arguments() -> [String] {
        ["--config-dir", Self.supportDirectory.path, "--data-dir", directory.path,
         "--port", String(port), "--cdp-port", String(cdpPort), "--mode", mode,
         launchHost ? "--launch-host" : "--no-launch"]
    }
}
