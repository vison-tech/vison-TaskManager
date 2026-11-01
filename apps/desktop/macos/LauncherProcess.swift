import Foundation

/// Owns only the launcher Process it created. Closing stdin asks Node to stop its children in order.
final class LauncherProcess {
    var onState: ((String, String, URL?) -> Void)?
    var onExit: ((Int32, String) -> Void)?
    var onStopTimeout: (() -> Void)?
    private(set) var child: Process?
    private(set) var stopping = false
    private var input: Pipe?
    private var output: Pipe?
    private var errors: Pipe?
    private var statusTimer: Timer?
    private var stopTimer: Timer?
    private var recentOutput = Data()
    private var instanceID: String?
    var isActive: Bool { child != nil }

    func start(resources: LauncherResources, settings: LauncherSettings) throws {
        guard child == nil else { return }
        let process = Process()
        let stdin = Pipe(), stdout = Pipe(), stderr = Pipe()
        process.executableURL = resources.node
        process.arguments = [resources.entry.path] + settings.arguments()
        process.currentDirectoryURL = resources.app
        var environment = ProcessInfo.processInfo.environment
        for key in Array(environment.keys) where ["NODE_", "DYLD_", "LD_", "TSX_"].contains(where: key.hasPrefix) {
            environment.removeValue(forKey: key)
        }
        environment["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
        process.environment = environment
        process.standardInput = stdin
        process.standardOutput = stdout
        process.standardError = stderr
        recentOutput = Data()
        stopping = false
        instanceID = nil
        child = process
        input = stdin; output = stdout; errors = stderr
        for pipe in [stdout, stderr] {
            pipe.fileHandleForReading.readabilityHandler = { [weak self, weak process] handle in
                let bytes = handle.availableData
                guard !bytes.isEmpty else { return }
                DispatchQueue.main.async {
                    guard let self, self.child === process else { return }
                    self.recentOutput.append(bytes)
                    if self.recentOutput.count > 32_768 { self.recentOutput = self.recentOutput.suffix(32_768) }
                }
            }
        }
        process.terminationHandler = { [weak self] process in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self?.finished(process) }
        }
        do { try process.run() }
        catch {
            cleanupPipes()
            child = nil
            throw error
        }
        // Only the child retains these ends after spawn; the parent keeps the
        // write side of stdin until an explicit stop or native-process exit.
        try? stdin.fileHandleForReading.close()
        try? stdout.fileHandleForWriting.close()
        try? stderr.fileHandleForWriting.close()
        onState?("正在启动", "正在准备本地服务，请稍候…", nil)
        statusTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.readStatus() }
    }

    func stop() {
        guard child != nil else { return }
        if stopping { armStopTimeout(); return }
        stopping = true
        statusTimer?.invalidate(); statusTimer = nil
        onState?("正在停止", "正在卸载任务面板，然后关闭本次启动的服务。", nil)
        // No PID-file lookup, process-group signal or termination of Codex.
        try? input?.fileHandleForWriting.close()
        input = nil
        armStopTimeout()
    }

    private func armStopTimeout() {
        // A repeated Quit after a timeout must also receive a bounded reply.
        stopTimer?.invalidate()
        stopTimer = Timer.scheduledTimer(withTimeInterval: 55, repeats: false) { [weak self] _ in
            guard let self, self.child != nil else { return }
            self.onState?("停止尚未完成", "请查看日志。应用保持打开，等待清理完成。", nil)
            self.onStopTimeout?()
        }
    }

    private func readStatus() {
        guard let child, child.isRunning, !stopping else { return }
        let url = LauncherSettings.supportDirectory.appendingPathComponent("running/state.json")
        guard let data = try? Data(contentsOf: url), data.count < 8192,
              let state = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              state["pid"] as? Int == Int(child.processIdentifier),
              let identity = state["instanceId"] as? String, UUID(uuidString: identity) != nil,
              instanceID == nil || instanceID == identity,
              let phase = state["phase"] as? String,
              let port = state["port"] as? Int, (1024...65535).contains(port) else { return }
        instanceID = identity
        switch phase {
        case "running":
            let detail = state["mode"] as? String == "embed"
                ? "服务与连接器已运行，请在 Codex 内打开任务面板。"
                : "服务已运行，点击“打开看板”即可使用。"
            onState?("正在运行", detail, URL(string: "http://127.0.0.1:\(port)/"))
        case "starting": onState?("正在启动", "正在准备服务与任务面板连接…", nil)
        case "stopping": onState?("正在停止", "正在清理任务面板与本地服务…", nil)
        default: break
        }
    }

    private func finished(_ process: Process) {
        guard child === process else { return }
        statusTimer?.invalidate(); statusTimer = nil
        stopTimer?.invalidate(); stopTimer = nil
        cleanupPipes()
        child = nil
        stopping = false
        let text = String(decoding: recentOutput, as: UTF8.self)
        recentOutput = Data()
        onExit?(process.terminationStatus, text)
    }

    private func cleanupPipes() {
        for pipe in [output, errors] {
            pipe?.fileHandleForReading.readabilityHandler = nil
            try? pipe?.fileHandleForReading.close()
        }
        try? input?.fileHandleForWriting.close()
        input = nil; output = nil; errors = nil
    }
}
