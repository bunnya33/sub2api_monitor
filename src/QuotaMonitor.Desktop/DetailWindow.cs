using System.Windows.Interop;

namespace QuotaMonitor.Desktop;

internal sealed class DetailWindow : Window
{
    private readonly StackPanel _accounts = new();
    private readonly TextBlock _footer = Ui.Text("", 11, true);
    private readonly Button _pin;
    private readonly Button _refresh;

    internal DetailWindow(MonitorController controller, Action close, Action pin)
    {
        Title = "额度明细";
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = false;
        ShowActivated = false;
        Topmost = true;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        Width = 320;
        Height = 360;
        var panel = new DockPanel();
        var head = new DockPanel { Margin = new Thickness(10, 5, 5, 5) };
        var controls = new StackPanel { Orientation = Orientation.Horizontal };
        _refresh = Ui.Icon("\uE72C", "刷新额度", async (_, _) => await controller.RefreshAsync());
        _pin = Ui.Icon("\uE718", "固定明细", (_, _) => pin());
        controls.Children.Add(_refresh);
        controls.Children.Add(_pin);
        controls.Children.Add(Ui.Icon("\uE711", "关闭明细", (_, _) => close()));
        DockPanel.SetDock(controls, Dock.Right);
        head.Children.Add(controls);
        head.Children.Add(Ui.Text("额度明细"));
        DockPanel.SetDock(head, Dock.Top);
        panel.Children.Add(head);
        var footer = new Border { Background = Ui.Brush("#f1f5f3"), Padding = new Thickness(10, 7, 10, 7), Child = _footer };
        DockPanel.SetDock(footer, Dock.Bottom);
        panel.Children.Add(footer);
        panel.Children.Add(new ScrollViewer { Content = _accounts, VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled });
        Content = new Border { Background = Brushes.White, BorderBrush = Ui.Brush("#dbe3df"), BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(6), Child = panel, ClipToBounds = true };
        SourceInitialized += (_, _) => NativeWindows.NoActivate(this);
    }
    internal void SetPinned(bool pinned)
    {
        _pin.Background = Ui.Brush(pinned ? "#dcece4" : "#f1f5f3");
        _pin.ToolTip = pinned ? "取消固定" : "固定明细";
    }
    internal double NaturalHeight()
    {
        _accounts.Measure(new Size(298, double.PositiveInfinity));
        return _accounts.DesiredSize.Height + 68;
    }
    internal void Render(AppSnapshot state)
    {
        _accounts.Children.Clear();
        _refresh.IsEnabled = !state.Busy && state.Status is ConnectionStatus.Connected or ConnectionStatus.Demo;
        if (state.Quotas.Count == 0) _accounts.Children.Add(new TextBlock { Text = state.Message, Margin = new Thickness(12), TextWrapping = TextWrapping.Wrap });
        foreach (var quota in state.Quotas)
        {
            var item = new StackPanel { Margin = new Thickness(10, 9, 10, 9) };
            var head = new DockPanel();
            var status = Ui.Text(quota.Error is not null ? "缓存" : quota.Account.Status == "active" ? "可用" : quota.Account.Status, 11, true);
            DockPanel.SetDock(status, Dock.Right);
            head.Children.Add(status);
            var name = Ui.Text(quota.Account.Name);
            name.FontWeight = FontWeights.SemiBold;
            name.ToolTip = quota.Account.Name;
            head.Children.Add(name);
            item.Children.Add(head);
            item.Children.Add(Ui.Text(Ui.Platform(quota.Account.Platform) + " · " + quota.Account.Type + " · " + Ui.Source(quota.Source), 11, true));
            var windows = new Grid { Margin = new Thickness(0, 8, 0, 5) };
            windows.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
            windows.ColumnDefinitions.Add(new() { Width = new GridLength(10) });
            windows.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
            var periods = new[] { QuotaPeriod.FiveHour, QuotaPeriod.SevenDay };
            for (var i = 0; i < 2; i++)
            {
                var column = new StackPanel();
                var label = (i == 0 ? "5 小时" : "7 天") + (state.Preferences.Metric == Metric.Used ? " · 已用" : " · 剩余");
                column.Children.Add(Ui.Text(label, 11));
                var bar = new QuotaBar(quota.Window(periods[i]), state.Preferences, quota.Account.Name + " · " + label)
                    { Margin = new Thickness(0, 4, 0, 4) };
                column.Children.Add(bar);
                var reset = Ui.Text(Ui.Reset(quota.Window(periods[i])?.ResetsAt), 10, true);
                reset.ToolTip = quota.Window(periods[i])?.ResetsAt?.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss") ?? "未知";
                column.Children.Add(reset);
                Grid.SetColumn(column, i * 2);
                windows.Children.Add(column);
            }
            item.Children.Add(windows);
            item.Children.Add(Ui.Text("源数据 " + Ui.Time(quota.SourceUpdatedAt), 10, true));
            item.Children.Add(Ui.Text("本次读取 " + Ui.Time(quota.FetchedAt), 10, true));
            if (quota.Error is not null) item.Children.Add(new TextBlock { Text = quota.Error, FontSize = 11,
                Foreground = Ui.Brush("#b4473e"), TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 4, 0, 0) });
            _accounts.Children.Add(new Border { BorderBrush = Ui.Brush("#e0e6e2"), BorderThickness = new Thickness(0, 1, 0, 0), Child = item });
        }
        _footer.Text = "刷新 " + Ui.Time(state.LastRefresh) + " · " + (state.Busy ? "刷新中" : state.Status == ConnectionStatus.Demo
            ? "演示数据" : state.Error is not null ? "部分数据未更新" : state.Message);
        _footer.ToolTip = state.Error ?? state.Message;
    }
}
