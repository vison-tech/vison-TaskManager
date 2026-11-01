import AppKit

final class TaskManagerApplication: NSObject, NSApplicationDelegate {
    private var controller: LauncherWindow?
    private var quitting = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        let window = LauncherWindow()
        controller = window
        window.onStopped = { [weak self] success in
            guard let self, self.quitting else { return }
            self.quitting = false
            NSApp.reply(toApplicationShouldTerminate: success)
        }
        window.onStopTimeout = { [weak self] in
            guard let self, self.quitting else { return }
            self.quitting = false
            NSApp.reply(toApplicationShouldTerminate: false)
        }
        window.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let controller, controller.processOwner.isActive else { return .terminateNow }
        quitting = true
        controller.stopService()
        return .terminateLater
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        controller?.showWindow(nil)
        return true
    }

    @objc private func showWindow() { controller?.showWindow(nil) }
    @objc private func showLogs() { controller?.openLogs() }
    private func buildMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem(); menu.addItem(appItem)
        let appMenu = NSMenu(); appItem.submenu = appMenu
        let show = appMenu.addItem(withTitle: "显示 TaskManaer-Vison", action: #selector(showWindow), keyEquivalent: "0"); show.target = self
        let logs = appMenu.addItem(withTitle: "查看日志", action: #selector(showLogs), keyEquivalent: "l"); logs.target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 TaskManaer-Vison", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let editItem = NSMenuItem(); menu.addItem(editItem)
        let edit = NSMenu(title: "编辑"); editItem.submenu = edit
        edit.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        NSApp.mainMenu = menu
    }
}

if CommandLine.arguments.contains("--check-resources") {
    do {
        let resources = try LauncherResources()
        print("PASS: bundled runtime and application resources are present at \(resources.app.path)")
    } catch {
        FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
        exit(1)
    }
} else {
    let app = NSApplication.shared
    let delegate = TaskManagerApplication()
    app.setActivationPolicy(.regular)
    app.delegate = delegate
    withExtendedLifetime(delegate) { app.run() }
}
