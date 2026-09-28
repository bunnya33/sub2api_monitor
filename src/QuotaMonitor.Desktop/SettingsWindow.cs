using System.Globalization;
using System.Windows.Interop;
using Forms = System.Windows.Forms;

namespace QuotaMonitor.Desktop;

internal sealed class SettingsWindow : Window
{
    private readonly MonitorController _controller;
    private readonly TabControl _tabs = new();
    private readonly TextBlock _status = Ui.Text("", 11, true);
    private readonly TextBlock _error = new() { Foreground = Ui.Brush("#b4473e"), FontSize = 11, TextWrapping = TextWrapping.Wrap };
    private readonly List<Action<AppSnapshot>> _sync = [];
    private readonly StackPanel _accountList = new();
    private readonly TextBox _server = new(), _email = new(), _otp = new() { MaxLength = 6 };
    private readonly PasswordBox _password = new();
    private readonly Button _login = new() { Content = "登录", MinWidth = 78 };
    private readonly Button _verify = new() { Content = "验证", MinWidth = 78 };
    private readonly TextBlock _connection = new() { TextWrapping = TextWrapping.Wrap };
    private IReadOnlyList<Account>? _lastAccounts;
    private int[] _lastSelected = [];
    private bool _syncing, _authBusy;

    internal SettingsWindow(MonitorController controller)
    {
        _controller = controller;
        Title = "Sub2API Quota Monitor · 设置";
        Width = 520;
        Height = 590;
        MinWidth = 470;
        MinHeight = 420;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        var root = new DockPanel { Margin = new Thickness(14) };
        var footer = new StackPanel { Margin = new Thickness(0, 10, 0, 0) };
        footer.Children.Add(_error);
        footer.Children.Add(_status);
        DockPanel.SetDock(footer, Dock.Bottom);
        root.Children.Add(footer);
        root.Children.Add(_tabs);
        Content = root;
        BuildDisplay();
        BuildRefresh();
        BuildColors();
        BuildConnection();
        BuildAccounts();
        Sync(controller.State);
        controller.Changed += Sync;
        Closed += (_, _) => { _password.Clear(); _otp.Clear(); controller.Changed -= Sync; };
    }
    internal void SelectTab(int index) => _tabs.SelectedIndex = Math.Clamp(index, 0, _tabs.Items.Count - 1);
    private StackPanel Tab(string title)
    {
        var body = new StackPanel { Margin = new Thickness(10, 8, 10, 8) };
        _tabs.Items.Add(new TabItem { Header = title, Content = new ScrollViewer { Content = body,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled } });
        return body;
    }
    private static void Row(Panel panel, string label, FrameworkElement control)
    {
        var row = new Grid { MinHeight = 36, Margin = new Thickness(0, 2, 0, 2) };
        row.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new() { Width = new GridLength(200) });
        var text = Ui.Text(label);
        text.Margin = new Thickness(0, 0, 10, 0);
        row.Children.Add(text);
        control.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(control, 1);
        row.Children.Add(control);
        panel.Children.Add(row);
    }
    private void Toggle(Panel panel, string label, Func<Preferences, bool> get, Func<Preferences, bool, Preferences> set)
    {
        var check = new CheckBox { HorizontalAlignment = HorizontalAlignment.Right };
        check.Checked += async (_, _) => { if (!_syncing) await Apply(s => set(s, true)); };
        check.Unchecked += async (_, _) => { if (!_syncing) await Apply(s => set(s, false)); };
        Row(panel, label, check);
        _sync.Add(state => check.IsChecked = get(state.Preferences));
    }
    private void Choice<T>(Panel panel, string label, (T Value, string Name)[] choices, Func<Preferences, T> get, Func<Preferences, T, Preferences> set)
    {
        var combo = new ComboBox { HorizontalAlignment = HorizontalAlignment.Stretch };
        foreach (var choice in choices) combo.Items.Add(new ComboBoxItem { Content = choice.Name, Tag = choice.Value });
        combo.SelectionChanged += async (_, _) =>
        {
            if (!_syncing && combo.SelectedItem is ComboBoxItem { Tag: T value }) await Apply(s => set(s, value));
        };
        Row(panel, label, combo);
        _sync.Add(state => combo.SelectedIndex = Array.FindIndex(choices, c => EqualityComparer<T>.Default.Equals(c.Value, get(state.Preferences))));
    }
    private void Number(Panel panel, string label, int min, int max, string unit, Func<Preferences, int> get, Func<Preferences, int, Preferences> set)
    {
        var box = new TextBox { Width = 75, HorizontalContentAlignment = HorizontalAlignment.Right, ToolTip = $"{min}–{max} {unit}" };
        async Task Commit()
        {
            if (_syncing) return;
            if (!int.TryParse(box.Text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) || value < min || value > max)
            { box.BorderBrush = Ui.Brush("#b4473e"); _error.Text = $"{label}范围：{min}–{max} {unit}"; return; }
            box.BorderBrush = Ui.Brush("#e0e6e2");
            if (get(_controller.State.Preferences) != value) await Apply(s => set(s, value));
        }
        box.LostKeyboardFocus += async (_, _) => await Commit();
        box.KeyDown += async (_, e) => { if (e.Key == Key.Enter) { await Commit(); e.Handled = true; } };
        var arrows = new StackPanel { Margin = new Thickness(2, 0, 6, 0) };
        foreach (var delta in new[] { 1, -1 })
        {
            var button = new Button { Content = new TextBlock { Text = delta > 0 ? "\uE70E" : "\uE70D", FontFamily = new FontFamily("Segoe Fluent Icons"), FontSize = 9 },
                Width = 22, Height = 14, MinHeight = 14, Padding = new Thickness(0), ToolTip = delta > 0 ? "增加" : "减少", Focusable = false };
            button.Click += async (_, _) =>
            {
                var value = int.TryParse(box.Text, out var typed) ? typed : get(_controller.State.Preferences);
                box.Text = Math.Clamp(value + delta, min, max).ToString(CultureInfo.InvariantCulture);
                await Commit();
            };
            arrows.Children.Add(button);
        }
        var group = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        group.Children.Add(box);
        group.Children.Add(arrows);
        var units = Ui.Text(unit, 11, true);
        units.Width = 27;
        group.Children.Add(units);
        Row(panel, label, group);
        _sync.Add(state => { if (!box.IsKeyboardFocusWithin) box.Text = get(state.Preferences).ToString(CultureInfo.InvariantCulture); });
    }
    private async Task Apply(Func<Preferences, Preferences> edit)
    {
        try { _error.Text = ""; await _controller.UpdateAsync(edit(_controller.State.Preferences)); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Security.Cryptography.CryptographicException)
        { _error.Text = "设置保存失败：" + error.Message; }
    }
    private void BuildDisplay()
    {
        var panel = Tab("显示");
        Choice(panel, "百分比含义", new[] { (Metric.Used, "已用"), (Metric.Remaining, "剩余") }, s => s.Metric, (s, v) => s with { Metric = v });
        Toggle(panel, "显示 5 小时额度", s => s.ShowFiveHour, (s, v) => s with { ShowFiveHour = v });
        Toggle(panel, "贴边自动收起", s => s.AutoCollapse, (s, v) => s with { AutoCollapse = v });
        Number(panel, "进度条宽度", 40, 240, "px", s => s.BarWidth, (s, v) => s with { BarWidth = v });
        Number(panel, "顶部 / 底部宽度", 120, 400, "px", s => s.HorizontalDockWidth, (s, v) => s with { HorizontalDockWidth = v });
        Number(panel, "两侧贴边宽度", 48, 240, "px", s => s.SideDockWidth, (s, v) => s with { SideDockWidth = v });
        Choice(panel, "贴边摘要", new[] { (SummaryMode.Worst, "最紧张的窗口"), (SummaryMode.Both, "5 小时 + 7 天"),
            (SummaryMode.FiveHour, "5 小时"), (SummaryMode.SevenDay, "7 天") }, s => s.Summary, (s, v) => s with { Summary = v });
        Toggle(panel, "失焦时半透明", s => s.FadeWhenInactive, (s, v) => s with { FadeWhenInactive = v });
        var opacityRow = new StackPanel { Orientation = Orientation.Horizontal };
        var slider = new Slider { Minimum = 20, Maximum = 100, TickFrequency = 5, IsSnapToTickEnabled = false,
            Width = 145, VerticalAlignment = VerticalAlignment.Center, ToolTip = "失焦透明度" };
        var value = Ui.Text("65%", 11, true);
        value.Margin = new Thickness(8, 0, 0, 0);
        value.Width = 44;
        opacityRow.Children.Add(slider);
        opacityRow.Children.Add(value);
        slider.ValueChanged += async (_, _) => { if (!_syncing) await Apply(s => s with { InactiveOpacityPercent = (int)Math.Round(slider.Value) }); };
        Row(panel, "失焦不透明度", opacityRow);
        _sync.Add(state => { slider.Value = state.Preferences.InactiveOpacityPercent; slider.IsEnabled = state.Preferences.FadeWhenInactive;
            value.Text = state.Preferences.InactiveOpacityPercent + "%"; });
    }
    private void BuildRefresh()
    {
        var panel = Tab("刷新");
        Toggle(panel, "自动刷新", s => s.AutoRefresh, (s, v) => s with { AutoRefresh = v });
        Number(panel, "数据刷新间隔", 5, 3600, "秒", s => s.RefreshSeconds, (s, v) => s with { RefreshSeconds = v });
        Number(panel, "账号轮播间隔", 2, 60, "秒", s => s.RotationSeconds, (s, v) => s with { RotationSeconds = v });
        var last = Ui.Text("", 11, true);
        var next = Ui.Text("", 11, true);
        Row(panel, "最近刷新", last);
        Row(panel, "下次刷新", next);
        var button = new Button { Content = "立即刷新", HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 10, 0, 0) };
        button.Click += async (_, _) => await _controller.RefreshAsync();
        panel.Children.Add(button);
        _sync.Add(state => { last.Text = Ui.Time(state.LastRefresh); next.Text = state.NextRefresh is null ? "已暂停" : Ui.Time(state.NextRefresh);
            button.IsEnabled = !state.Busy && state.Status is ConnectionStatus.Connected or ConnectionStatus.Demo; });
    }
    private void BuildColors()
    {
        var panel = Tab("颜色");
        ColorRow(panel, "正常 ≤50%", 25, s => s.NormalColor, (s, v) => s with { NormalColor = v });
        ColorRow(panel, "注意 >50% 且 <80%", 65, s => s.WarningColor, (s, v) => s with { WarningColor = v });
        ColorRow(panel, "接近耗尽 ≥80%", 90, s => s.CriticalColor, (s, v) => s with { CriticalColor = v });
    }
    private sealed class DialogOwner(nint handle) : Forms.IWin32Window { public nint Handle => handle; }
    private void ColorRow(Panel panel, string label, double sample, Func<Preferences, string> get, Func<Preferences, string, Preferences> set)
    {
        var row = new Grid { Margin = new Thickness(0, 8, 0, 8) };
        row.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new() { Width = new GridLength(34) });
        row.ColumnDefinitions.Add(new() { Width = new GridLength(86) });
        row.ColumnDefinitions.Add(new() { Width = new GridLength(92) });
        row.Children.Add(Ui.Text(label, 11));
        var swatch = new Button { Width = 26, Height = 28, Padding = new Thickness(0), ToolTip = label + "颜色" };
        swatch.Click += async (_, _) =>
        {
            var color = (Color)ColorConverter.ConvertFromString(get(_controller.State.Preferences));
            using var dialog = new Forms.ColorDialog { FullOpen = true, Color = System.Drawing.Color.FromArgb(color.R, color.G, color.B) };
            if (dialog.ShowDialog(new DialogOwner(NativeWindows.Handle(this))) == Forms.DialogResult.OK)
                await Apply(s => set(s, $"#{dialog.Color.R:x2}{dialog.Color.G:x2}{dialog.Color.B:x2}"));
        };
        Grid.SetColumn(swatch, 1);
        row.Children.Add(swatch);
        var box = new TextBox { FontSize = 11, Margin = new Thickness(0, 0, 6, 0), MaxLength = 7 };
        async Task Commit()
        {
            if (_syncing) return;
            if (!Preferences.ValidColor(box.Text)) { box.BorderBrush = Ui.Brush("#b4473e"); _error.Text = "颜色格式为 #RRGGBB"; return; }
            box.BorderBrush = Ui.Brush("#e0e6e2");
            if (!string.Equals(box.Text, get(_controller.State.Preferences), StringComparison.OrdinalIgnoreCase)) await Apply(s => set(s, box.Text));
        }
        box.LostKeyboardFocus += async (_, _) => await Commit();
        box.KeyDown += async (_, e) => { if (e.Key == Key.Enter) { await Commit(); e.Handled = true; } };
        Grid.SetColumn(box, 2);
        row.Children.Add(box);
        var preview = new Border { VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(preview, 3);
        row.Children.Add(preview);
        panel.Children.Add(row);
        _sync.Add(state =>
        {
            swatch.Background = Ui.Brush(get(state.Preferences));
            if (!box.IsKeyboardFocusWithin) box.Text = get(state.Preferences);
            preview.Child = new QuotaBar(new(sample, null), state.Preferences, label + "预览");
        });
    }
    private void BuildConnection()
    {
        var panel = Tab("连接");
        _connection.Margin = new Thickness(0, 2, 0, 10);
        panel.Children.Add(_connection);
        Field(panel, "服务器地址", _server);
        Field(panel, "邮箱", _email);
        Field(panel, "密码", _password);
        var otpField = Field(panel, "双重验证码", _otp);
        Toggle(panel, "记住登录", s => s.RememberSession, (s, v) => s with { RememberSession = v });
        var actions = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Thickness(0, 6, 0, 8) };
        var logout = new Button { Content = "退出登录", Margin = new Thickness(0, 0, 8, 0) };
        logout.Click += (_, _) => { _controller.Logout(); _password.Clear(); _otp.Clear(); };
        actions.Children.Add(logout);
        actions.Children.Add(_login);
        actions.Children.Add(_verify);
        _login.Click += async (_, _) =>
        {
            if (_authBusy) return;
            var password = _password.Password;
            _password.Clear();
            _authBusy = true;
            _login.IsEnabled = _verify.IsEnabled = false;
            try { await _controller.LoginAsync(_server.Text, _email.Text, password); }
            catch (ApiException error) { _error.Text = error.Message; }
            finally { _authBusy = false; Sync(_controller.State); }
        };
        _verify.Click += async (_, _) =>
        {
            if (_authBusy) return;
            var code = _otp.Text.Trim();
            _authBusy = true;
            _login.IsEnabled = _verify.IsEnabled = false;
            try { await _controller.VerifyAsync(code); }
            finally { _authBusy = false; if (_controller.State.Status == ConnectionStatus.Connected) _otp.Clear(); Sync(_controller.State); }
        };
        panel.Children.Add(actions);
        Toggle(panel, "演示数据", s => s.Demo, (s, v) => s with { Demo = v });
        _sync.Add(state =>
        {
            _connection.Text = state.Message;
            _connection.Foreground = Ui.Brush(state.Status is ConnectionStatus.Error or ConnectionStatus.Expired ? "#b4473e" : "#64716c");
            if (!_server.IsKeyboardFocusWithin && _server.Text.Length == 0) _server.Text = state.Server;
            if (!_email.IsKeyboardFocusWithin && _email.Text.Length == 0) _email.Text = state.Email;
            var challenge = state.Status == ConnectionStatus.TwoFactor;
            otpField.Visibility = _verify.Visibility = challenge ? Visibility.Visible : Visibility.Collapsed;
            _login.Visibility = challenge ? Visibility.Collapsed : Visibility.Visible;
            _login.IsEnabled = _verify.IsEnabled = !_authBusy && state.Status != ConnectionStatus.Authenticating;
            logout.IsEnabled = state.Status is not (ConnectionStatus.Disconnected or ConnectionStatus.Authenticating);
        });
    }
    private static StackPanel Field(Panel panel, string title, FrameworkElement input)
    {
        var field = new StackPanel { Margin = new Thickness(0, 0, 0, 9) };
        var label = Ui.Text(title, 11, true);
        label.Margin = new Thickness(0, 0, 0, 4);
        field.Children.Add(label);
        field.Children.Add(input);
        panel.Children.Add(field);
        return field;
    }
    private void BuildAccounts()
    {
        var panel = Tab("账号");
        panel.Children.Add(_accountList);
        _sync.Add(state =>
        {
            if (ReferenceEquals(_lastAccounts, state.Accounts) && _lastSelected.SequenceEqual(state.Preferences.SelectedIds)) return;
            _lastAccounts = state.Accounts;
            _lastSelected = state.Preferences.SelectedIds.ToArray();
            _accountList.Children.Clear();
            if (state.Accounts.Count == 0) _accountList.Children.Add(Ui.Text(state.Status == ConnectionStatus.Connected ? "没有上游账号" : "未登录", 12, true));
            foreach (var account in state.Accounts)
            {
                var text = new StackPanel();
                text.Children.Add(Ui.Text(account.Name));
                text.Children.Add(Ui.Text(Ui.Platform(account.Platform) + " · " + account.Type + " · " + account.Status, 11, true));
                var check = new CheckBox { Content = text, IsChecked = state.Preferences.SelectedIds.Contains(account.Id),
                    Margin = new Thickness(0, 7, 0, 7), ToolTip = account.Name };
                check.Checked += async (_, _) => { if (!_syncing) await Apply(s => s with { SelectedIds = s.SelectedIds.Append(account.Id).Distinct().ToArray() }); };
                check.Unchecked += async (_, _) => { if (!_syncing) await Apply(s => s with { SelectedIds = s.SelectedIds.Where(id => id != account.Id).ToArray() }); };
                _accountList.Children.Add(check);
            }
        });
    }
    private void Sync(AppSnapshot state)
    {
        if (!Dispatcher.CheckAccess()) { Dispatcher.InvokeAsync(() => Sync(state)); return; }
        _syncing = true;
        try
        {
            foreach (var sync in _sync) sync(state);
            _status.Text = (state.Status == ConnectionStatus.Demo ? "演示数据" : state.Message) + " · 已选 " + state.Quotas.Count + " 个账号";
            if (state.Error is not null) _error.Text = state.Error;
        }
        finally { _syncing = false; }
    }
}
