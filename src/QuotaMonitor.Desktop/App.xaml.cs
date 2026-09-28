using System.Security.Cryptography;
using System.Text;
using System.Windows.Threading;
using Forms = System.Windows.Forms;

namespace QuotaMonitor.Desktop;

public partial class App : Application
{
    private Mutex? _instance;
    private Forms.NotifyIcon? _tray;
    private LocalStore? _store;
    private MonitorController? _controller;
    private FloatingWindow? _floating;
    private SettingsWindow? _settings;
    private DispatcherTimer? _poll;
    private AppConfig? _config;
    private bool _ownsMutex;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        var directory = e.Args.Contains("--smoke-test")
            ? Path.Combine(Path.GetTempPath(), "QuotaMonitorSmoke", Guid.NewGuid().ToString("N"))
            : Environment.GetEnvironmentVariable("QUOTA_DATA_DIR")
                ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Sub2APIQuotaMonitor");
        var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Path.GetFullPath(directory))))[..16];
        _instance = new Mutex(true, "Local\\Sub2APIQuotaMonitor-" + key, out _ownsMutex);
        if (!_ownsMutex) { Shutdown(); return; }
        try
        {
            _store = new LocalStore(directory);
            _config = _store.LoadConfig();
            _controller = new MonitorController(_config.Preferences, _store, SaveState, _config.Server, _config.Email);
            _floating = new FloatingWindow(_controller, _config, SavePosition);
            MainWindow = _floating;
            CreateTray();
            _floating.Show();
            NativeWindows.ShowWithoutActivation(_floating);
            _poll = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
            _poll.Tick += async (_, _) => { if (_controller is not null) await _controller.PollAsync(); };
            _poll.Start();
            if (e.Args.Contains("--smoke-test"))
            {
                await DesktopSmoke.RunAsync(_controller, _floating, _store);
                Shutdown(Environment.ExitCode);
                return;
            }
            await _controller.StartAsync();
            if (_controller.State.Status != ConnectionStatus.Connected && !e.Args.Contains("--background")) OpenSettings(3);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Security.Cryptography.CryptographicException)
        {
            MessageBox.Show("无法读取或保存本地配置：" + error.Message, "Sub2API Quota Monitor", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
    }

    private void SaveState(AppSnapshot state)
    {
        if (_store is null || _config is null) return;
        _config = _config with { Preferences = state.Preferences, Server = state.Server, Email = state.Email };
        _store.SaveConfig(_config);
        if (_tray is not null) _tray.Text = state.Status == ConnectionStatus.Demo ? "Sub2API · 演示数据" : "Sub2API Quota Monitor";
    }
    private void SavePosition(ScreenRect bounds, DockEdge edge)
    {
        if (_config is null || _store is null) return;
        _config = _config with { X = bounds.X, Y = bounds.Y, Edge = edge };
        _store.SaveConfig(_config);
    }
    private void CreateTray()
    {
        _tray = new Forms.NotifyIcon { Icon = System.Drawing.SystemIcons.Information, Text = "Sub2API Quota Monitor", Visible = true };
        var menu = new Forms.ContextMenuStrip();
        menu.Items.Add("刷新额度", null, async (_, _) => { if (_controller is not null) await _controller.RefreshAsync(); });
        var visibility = new Forms.ToolStripMenuItem("显示浮球") { Checked = true, CheckOnClick = true };
        visibility.Click += (_, _) =>
        {
            if (_floating is null) return;
            if (visibility.Checked) _floating.Show(); else { _floating.HideDetails(); _floating.Hide(); }
        };
        menu.Items.Add(visibility);
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add("设置…", null, (_, _) => OpenSettings());
        menu.Items.Add("退出", null, (_, _) => Shutdown());
        _tray.ContextMenuStrip = menu;
        _tray.DoubleClick += (_, _) => OpenSettings();
    }
    internal void OpenSettings(int tab = 0)
    {
        if (_controller is null) return;
        if (_settings is null)
        {
            _settings = new SettingsWindow(_controller);
            _settings.Closed += (_, _) => _settings = null;
        }
        _settings.SelectTab(tab);
        _settings.Show();
        if (_settings.WindowState == WindowState.Minimized) _settings.WindowState = WindowState.Normal;
        _settings.Activate();
    }
    protected override void OnExit(ExitEventArgs e)
    {
        _poll?.Stop();
        _floating?.Dispose();
        _controller?.Dispose();
        _tray?.Dispose();
        if (_ownsMutex) _instance?.ReleaseMutex();
        _instance?.Dispose();
        base.OnExit(e);
    }
}
