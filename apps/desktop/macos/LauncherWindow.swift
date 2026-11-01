import AppKit

final class LauncherWindow: NSWindowController, NSWindowDelegate {
    let processOwner = LauncherProcess()
    var onStopped: ((Bool) -> Void)?
    var onStopTimeout: (() -> Void)?
    private var settings = LauncherSettings.load()
    private var boardURL: URL?
    private let directory = NSTextField(labelWithString: "")
    private let port = NSTextField(string: "")
    private let mode = NSPopUpButton()
    private let launchHost = NSButton(checkboxWithTitle: "需要时打开 Codex", target: nil, action: nil)
    private let status = NSTextField(labelWithString: "尚未启动")
    private let detail = NSTextField(wrappingLabelWithString: "选择数据目录后，点击启动即可使用。")
    private let start = NSButton(title: "启动看板", target: nil, action: nil)
    private let stop = NSButton(title: "停止", target: nil, action: nil)
    private let open = NSButton(title: "打开看板", target: nil, action: nil)
    private let choose = NSButton(title: "选择数据目录…", target: nil, action: nil)

    init() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 620, height: 580),
                              styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "TaskManaer-Vison"
        window.isReleasedWhenClosed = false
        super.init(window: window)
        window.delegate = self
        buildContent()
        processOwner.onState = { [weak self] title, text, url in
            self?.status.stringValue = title; self?.detail.stringValue = text
            self?.boardURL = url; self?.open.isEnabled = url != nil
            if url != nil { self?.settings.requiresExistingDirectory = true }
        }
        processOwner.onExit = { [weak self] code, output in self?.finished(code, output) }
        processOwner.onStopTimeout = { [weak self] in self?.onStopTimeout?() }
        updateControls()
        window.center()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    private func buildContent() {
        guard let content = window?.contentView else { return }
        let title = NSTextField(labelWithString: "TaskManaer-Vison")
        title.font = .systemFont(ofSize: 26, weight: .semibold)
        let subtitle = NSTextField(labelWithString: "本地任务看板 · 数据保存在你的 Mac 上")
        subtitle.textColor = .secondaryLabelColor
        let dataTitle = NSTextField(labelWithString: "数据目录")
        dataTitle.font = .systemFont(ofSize: 13, weight: .semibold)
        directory.stringValue = settings.directory.path
        directory.toolTip = settings.directory.path
        directory.lineBreakMode = .byTruncatingMiddle
        directory.setAccessibilityLabel("数据目录")
        let dataRow = NSStackView(views: [directory, choose]); dataRow.spacing = 12
        directory.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let dataHint = NSTextField(wrappingLabelWithString: "已有任务请选择原数据目录。新目录会在首次启动时创建；更新应用会保留这里的数据。")
        dataHint.font = .systemFont(ofSize: 12); dataHint.textColor = .secondaryLabelColor
        port.stringValue = String(settings.port); port.setAccessibilityLabel("服务端口")
        port.widthAnchor.constraint(equalToConstant: 90).isActive = true
        mode.addItems(withTitles: ["Codex 内使用", "浏览器使用"])
        mode.selectItem(at: settings.mode == "embed" ? 0 : 1)
        mode.setAccessibilityLabel("使用方式")
        let options = NSStackView(views: [NSTextField(labelWithString: "使用方式"), mode,
                                         NSTextField(labelWithString: "端口"), port])
        options.spacing = 12
        launchHost.state = settings.launchHost ? .on : .off
        status.font = .systemFont(ofSize: 16, weight: .semibold)
        detail.textColor = .secondaryLabelColor
        let statusStack = NSStackView(views: [status, detail]); statusStack.orientation = .vertical
        statusStack.alignment = .leading; statusStack.spacing = 8
        let statusBox = NSBox(); statusBox.boxType = .custom; statusBox.borderWidth = 0
        statusBox.fillColor = .controlBackgroundColor; statusBox.cornerRadius = 9
        statusBox.contentViewMargins = NSSize(width: 16, height: 16)
        statusBox.contentView = statusStack
        let logs = NSButton(title: "查看日志", target: self, action: #selector(openLogs))
        let actions = NSStackView(views: [start, stop, open, logs]); actions.spacing = 10
        start.bezelStyle = .rounded; start.keyEquivalent = "\r"
        let stack = NSStackView(views: [title, subtitle, dataTitle, dataRow, dataHint, options, launchHost, statusBox, actions])
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 26),
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 26),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -26),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor, constant: -24),
            dataRow.widthAnchor.constraint(equalTo: stack.widthAnchor),
            dataHint.widthAnchor.constraint(equalTo: stack.widthAnchor),
            statusBox.widthAnchor.constraint(equalTo: stack.widthAnchor),
            statusBox.heightAnchor.constraint(greaterThanOrEqualToConstant: 96),
        ])
        for (button, action) in [(start, #selector(startService)), (stop, #selector(stopService)),
                                 (open, #selector(openBoard)), (choose, #selector(chooseDirectory))] {
            button.target = self; button.action = action; button.bezelStyle = .rounded
        }
        mode.target = self; mode.action = #selector(modeChanged)
        if let error = settings.error { status.stringValue = "配置需要检查"; detail.stringValue = error }
    }

    @objc private func startService() {
        guard !processOwner.isActive else { return }
        if let error = settings.error { showError(error); return }
        guard let number = Int(port.stringValue), (1024...65535).contains(number) else {
            showError("请输入 1024 到 65535 之间的端口号。"); return
        }
        settings.port = number; settings.mode = mode.indexOfSelectedItem == 0 ? "embed" : "web"
        settings.launchHost = launchHost.state == .on
        var isDirectory: ObjCBool = false
        if settings.requiresExistingDirectory && (!FileManager.default.fileExists(atPath: settings.directory.path, isDirectory: &isDirectory) || !isDirectory.boolValue) {
            showError("保存的数据目录不存在。请重新选择原目录，避免创建空看板。"); return
        }
        do { try processOwner.start(resources: LauncherResources(), settings: settings); updateControls() }
        catch { showError(error.localizedDescription); updateControls() }
    }

    @objc func stopService() { processOwner.stop(); updateControls() }
    @objc private func modeChanged() { updateControls() }
    @objc private func openBoard() { if let boardURL { NSWorkspace.shared.open(boardURL) } }
    @objc func openLogs() {
        let log = LauncherSettings.supportDirectory.appendingPathComponent("launcher.log")
        if FileManager.default.fileExists(atPath: log.path) { NSWorkspace.shared.open(log) }
        else { showError("尚无启动日志。启动后可在这里查看运行情况。") }
    }
    @objc private func chooseDirectory() {
        guard !processOwner.isActive, let window else { return }
        let panel = NSOpenPanel(); panel.canChooseFiles = false; panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false; panel.canCreateDirectories = true
        panel.prompt = "使用此目录"; panel.message = "选择原有任务数据库所在的目录，或创建一个新的数据目录。"
        panel.beginSheetModal(for: window) { [weak self] result in
            guard result == .OK, let selected = panel.url, let self else { return }
            self.settings.directory = selected; self.settings.requiresExistingDirectory = true
            self.directory.stringValue = selected.path; self.directory.toolTip = selected.path
        }
    }

    private func updateControls() {
        let active = processOwner.isActive
        start.isEnabled = !active && settings.error == nil
        stop.isEnabled = active && !processOwner.stopping
        choose.isEnabled = !active; port.isEnabled = !active; mode.isEnabled = !active
        launchHost.isEnabled = !active && mode.indexOfSelectedItem == 0
        open.isEnabled = active && !processOwner.stopping && boardURL != nil
    }
    private func finished(_ code: Int32, _ output: String) {
        boardURL = nil
        status.stringValue = code == 0 ? "已停止" : "运行遇到问题"
        detail.stringValue = code == 0 ? "本次服务已退出，数据已保留。可以随时重新启动。" : "请查看日志，处理问题后重新启动。"
        updateControls()
        if code != 0 {
            let text = String(output.suffix(1600)).trimmingCharacters(in: .whitespacesAndNewlines)
            showError(text.isEmpty ? "启动器异常退出，请查看日志。" : text)
        }
        onStopped?(code == 0)
    }
    private func showError(_ message: String) {
        guard let window else { return }
        let alert = NSAlert(); alert.messageText = "TaskManaer-Vison 提示"; alert.informativeText = message
        alert.alertStyle = .warning; alert.addButton(withTitle: "好")
        alert.beginSheetModal(for: window)
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { NSApp.terminate(nil); return false }
}
