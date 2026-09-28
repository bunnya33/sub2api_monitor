using System.Windows.Interop;
using System.Windows.Media.Animation;
using System.Windows.Threading;

namespace QuotaMonitor.Desktop;

internal sealed class FloatingWindow : Window, IDisposable
{
    private readonly MonitorController _controller;
    private readonly Action<ScreenRect, DockEdge> _savePosition;
    private readonly Border _surface;
    private readonly DispatcherTimer _interaction;
    private readonly AppConfig _config;
    private DetailWindow? _detail;
    private bool _pressed, _moving, _hovered, _inspect, _pinned, _ready, _suppressHover;
    private double _offsetX, _offsetY, _opacityTarget = -1;
    private NativeWindows.Point _start;
    private DateTimeOffset? _hoverSince, _awaySince;
    private DateTimeOffset _nextRotation;
    private int _index;
    public DockEdge Edge { get; private set; }
    public bool Dragging => _moving;
    internal DetailWindow? Details => _detail;
    internal int RotatingIndex => _index;

    public FloatingWindow(MonitorController controller, AppConfig config, Action<ScreenRect, DockEdge> savePosition)
    {
        _controller = controller;
        _config = config;
        _savePosition = savePosition;
        Edge = config.Edge;
        Title = "Sub2API 额度浮球";
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        ShowInTaskbar = false;
        ShowActivated = false;
        Topmost = true;
        _surface = new Border { Background = Brushes.White, BorderBrush = Ui.Brush("#dbe3df"),
            BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(6), Padding = new Thickness(6) };
        Content = _surface;
        Render(controller.State);
        SourceInitialized += (_, _) =>
        {
            NativeWindows.NoActivate(this);
            HwndSource.FromHwnd(NativeWindows.Handle(this))?.AddHook(WindowHook);
        };
        Loaded += (_, _) =>
        {
            _ready = true;
            var work = NativeWindows.WorkArea(this);
            var scale = NativeWindows.Scale(this);
            Reflow(new(_config.X ?? work.X + work.Width / 3, _config.Y ?? work.Y + work.Height / 4, Width * scale, Height * scale));
            ApplyOpacity();
        };
        MouseLeftButtonDown += BeginDrag;
        MouseMove += MoveDrag;
        MouseLeftButtonUp += EndDrag;
        LostMouseCapture += (_, _) => { if (_pressed) FinishDrag(); };
        Activated += (_, _) => ApplyOpacity();
        Deactivated += (_, _) => ApplyOpacity();
        controller.Changed += OnSnapshotChanged;
        _nextRotation = DateTimeOffset.UtcNow.AddSeconds(controller.State.Preferences.RotationSeconds);
        _interaction = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(100) };
        _interaction.Tick += (_, _) => Tick();
        _interaction.Start();
    }

    private nint WindowHook(nint hwnd, int message, nint wParam, nint lParam, ref bool handled)
    {
        if (message is 0x02E0 or 0x007E or 0x001A) // DPI, monitor topology, or work-area change.
            Dispatcher.InvokeAsync(() => { if (_ready && IsVisible) Reflow(); }, DispatcherPriority.Background);
        return 0;
    }
    private void OnSnapshotChanged(AppSnapshot state)
    {
        if (!Dispatcher.CheckAccess()) { Dispatcher.InvokeAsync(() => OnSnapshotChanged(state)); return; }
        Render(state);
        _detail?.Render(state);
        if (_ready) Reflow();
        ApplyOpacity();
    }
    private void Render(AppSnapshot state)
    {
        var settings = state.Preferences;
        var collapsed = settings.AutoCollapse && Edge != DockEdge.None;
        var rows = new StackPanel();
        var account = state.Quotas.Count > 0 ? state.Quotas[_index % state.Quotas.Count] : null;
        var periods = account is null ? new[] { QuotaPeriod.SevenDay } : QuotaDisplay.Periods(account, settings);
        var (width, height) = WindowGeometry.Size(settings, state.Quotas.Count, Edge, periods.Length);
        Width = width;
        Height = height;
        _surface.Padding = collapsed ? new Thickness(6, 4, 6, 4) : new Thickness(6);
        _surface.CornerRadius = collapsed ? Edge switch
        {
            DockEdge.Left => new(0, 6, 6, 0), DockEdge.Right => new(6, 0, 0, 6),
            DockEdge.Top => new(0, 0, 6, 6), _ => new(6, 6, 0, 0)
        } : new(6);
        if (state.Quotas.Count == 0)
        {
            var label = Ui.Text(state.Status is ConnectionStatus.Authenticating ? "连接中…"
                : state.Status is ConnectionStatus.Connected ? "未选账号" : "未登录", 11, true);
            label.HorizontalAlignment = HorizontalAlignment.Center;
            _surface.Child = label;
            return;
        }
        if (collapsed && account is not null)
        {
            var horizontal = Edge is DockEdge.Top or DockEdge.Bottom;
            var grid = new Grid();
            var name = Ui.Text(ShortName(account.Account, _index % state.Quotas.Count), 11);
            name.ToolTip = account.Account.Name;
            if (horizontal)
            {
                grid.ColumnDefinitions.Add(new() { Width = new GridLength(28) });
                grid.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
                grid.Children.Add(name);
                var bars = new Grid();
                for (var i = 0; i < periods.Length; i++)
                {
                    if (i > 0) bars.ColumnDefinitions.Add(new() { Width = new GridLength(4) });
                    bars.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
                    var bar = Bar(account, periods[i], settings);
                    Grid.SetColumn(bar, i * 2);
                    bars.Children.Add(bar);
                }
                Grid.SetColumn(bars, 1);
                grid.Children.Add(bars);
            }
            else
            {
                grid.RowDefinitions.Add(new() { Height = new GridLength(20) });
                name.HorizontalAlignment = HorizontalAlignment.Center;
                grid.Children.Add(name);
                for (var i = 0; i < periods.Length; i++)
                {
                    grid.RowDefinitions.Add(new() { Height = new GridLength(i == 0 ? 22 : 26) });
                    var bar = Bar(account, periods[i], settings);
                    if (i > 0) bar.Margin = new Thickness(0, 4, 0, 0);
                    bar.VerticalAlignment = VerticalAlignment.Top;
                    Grid.SetRow(bar, i + 1);
                    grid.Children.Add(bar);
                }
            }
            _surface.Child = grid;
        }
        else
        {
            for (var i = 0; i < state.Quotas.Count; i++)
            {
                var quota = state.Quotas[i];
                var row = new StackPanel { Orientation = Orientation.Horizontal, Height = 22, Margin = new Thickness(0, i > 0 ? 6 : 0, 0, 0) };
                var name = Ui.Text(quota.Account.Name, 11);
                name.Width = 62;
                name.Margin = new Thickness(0, 0, 6, 0);
                name.ToolTip = quota.Account.Name + (quota.Error is null ? "" : " · " + quota.Error);
                row.Children.Add(name);
                if (settings.ShowFiveHour)
                {
                    var bar = Bar(quota, QuotaPeriod.FiveHour, settings, settings.BarWidth);
                    bar.Margin = new Thickness(0, 0, 6, 0);
                    row.Children.Add(bar);
                }
                row.Children.Add(Bar(quota, QuotaPeriod.SevenDay, settings, settings.BarWidth));
                rows.Children.Add(row);
            }
            _surface.Child = new ScrollViewer { Content = rows, VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, CanContentScroll = false };
        }
        _surface.BorderBrush = Ui.Brush(state.Error is null ? "#dbe3df" : "#b4473e");
    }
    private static string ShortName(Account account, int index)
    {
        if (account.Name.StartsWith("示例 ", StringComparison.Ordinal)) return account.Name[3..];
        if (account.Name.Length <= 3) return account.Name;
        var prefix = account.Platform switch { "anthropic" => "C", "openai" => "O", _ => "A" };
        return prefix + (index + 1).ToString(System.Globalization.CultureInfo.InvariantCulture);
    }
    private static QuotaBar Bar(AccountQuota quota, QuotaPeriod period, Preferences settings, double? width = null) =>
        new(quota.Window(period), settings, quota.Account.Name + " · " + (period == QuotaPeriod.FiveHour ? "5 小时" : "7 天")
            + (settings.Metric == Metric.Used ? "已用" : "剩余") + (quota.Error is null ? "" : " · 缓存"), width);

    private void Reflow(ScreenRect? location = null)
    {
        if (!_ready) return;
        var current = location ?? NativeWindows.Bounds(this);
        var work = NativeWindows.WorkArea(new NativeWindows.Point { X = (int)(current.X + current.Width / 2), Y = (int)(current.Y + current.Height / 2) });
        var scale = NativeWindows.Scale(this);
        NativeWindows.Place(this, WindowGeometry.Clamp(new(current.X, current.Y, Width * scale, Height * scale), work, Edge));
        if (_detail?.IsVisible == true) PlaceDetail();
    }
    private void BeginDrag(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton != MouseButton.Left) return;
        _pressed = true;
        _moving = false;
        _start = NativeWindows.Cursor();
        var rect = NativeWindows.Bounds(this);
        _offsetX = _start.X - rect.X;
        _offsetY = _start.Y - rect.Y;
        CaptureMouse();
        e.Handled = true;
    }
    private void MoveDrag(object sender, MouseEventArgs e)
    {
        if (!_pressed) return;
        var cursor = NativeWindows.Cursor();
        if (!_moving && Math.Abs(cursor.X - _start.X) + Math.Abs(cursor.Y - _start.Y) < 4 * NativeWindows.Scale(this)) return;
        if (!_moving)
        {
            _moving = true;
            HideDetails();
            var old = NativeWindows.Bounds(this);
            Edge = DockEdge.None;
            Render(_controller.State);
            var scale = NativeWindows.Scale(this);
            _offsetX = Math.Clamp(_offsetX / old.Width * Width * scale, 0, Width * scale - 1);
            _offsetY = Math.Clamp(_offsetY / old.Height * Height * scale, 0, Height * scale - 1);
        }
        var bounds = NativeWindows.Bounds(this);
        NativeWindows.Place(this, bounds with { X = cursor.X - _offsetX, Y = cursor.Y - _offsetY });
        ApplyOpacity();
    }
    private void EndDrag(object sender, MouseButtonEventArgs e) { if (_pressed) FinishDrag(); e.Handled = true; }
    private void FinishDrag()
    {
        var moved = _moving;
        _pressed = _moving = false;
        ReleaseMouseCapture();
        if (moved)
        {
            var rect = NativeWindows.Bounds(this);
            var work = NativeWindows.WorkArea(this);
            var contained = WindowGeometry.Clamp(rect, work);
            Edge = WindowGeometry.Snap(contained, work, 20 * NativeWindows.Scale(this));
            Render(_controller.State);
            Reflow(contained);
            _savePosition(NativeWindows.Bounds(this), Edge);
        }
        else { _pinned = true; ShowDetail(); }
        _nextRotation = DateTimeOffset.UtcNow.AddSeconds(_controller.State.Preferences.RotationSeconds);
        ApplyOpacity();
    }

    private void Tick()
    {
        if (!_ready || !IsVisible) return;
        var cursor = NativeWindows.Cursor();
        _hovered = NativeWindows.Bounds(this).Contains(cursor.X, cursor.Y);
        var overDetail = _detail?.IsVisible == true && NativeWindows.Bounds(_detail).Contains(cursor.X, cursor.Y);
        var now = DateTimeOffset.UtcNow;
        if (!_hovered) _suppressHover = false;
        if (_hovered && !_pressed && !_suppressHover)
        {
            _hoverSince ??= now;
            if (now - _hoverSince >= TimeSpan.FromMilliseconds(220) && _detail?.IsVisible != true) ShowDetail();
        }
        else _hoverSince = null;
        if (_hovered || overDetail || _pinned) _awaySince = null;
        else
        {
            _awaySince ??= now;
            if (now - _awaySince >= TimeSpan.FromMilliseconds(300) && !_pinned && _detail?.IsVisible == true) HideDetails();
        }
        _inspect = _detail?.IsVisible == true;
        if (_hovered || _inspect || _pressed)
            _nextRotation = now.AddSeconds(_controller.State.Preferences.RotationSeconds);
        else if (now >= _nextRotation)
        {
            _nextRotation = now.AddSeconds(_controller.State.Preferences.RotationSeconds);
            if (_controller.State.Quotas.Count > 1 && Edge != DockEdge.None && _controller.State.Preferences.AutoCollapse)
            {
                _index = (_index + 1) % _controller.State.Quotas.Count;
                Render(_controller.State);
                Reflow();
            }
        }
        ApplyOpacity();
    }
    private void ApplyOpacity()
    {
        var target = QuotaDisplay.Opacity(_controller.State.Preferences, IsActive, _hovered, _moving || _pressed, _inspect || _pinned);
        if (Math.Abs(target - _opacityTarget) < .001) return;
        _opacityTarget = target;
        BeginAnimation(OpacityProperty, new DoubleAnimation(target, TimeSpan.FromMilliseconds(140))
            { EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut } });
    }
    private void ShowDetail()
    {
        if (_moving) return;
        if (_detail is null)
        {
            _detail = new DetailWindow(_controller, () => { _suppressHover = true; HideDetails(); },
                () => { _pinned = !_pinned; _detail?.SetPinned(_pinned); });
            _detail.Owner = this;
        }
        _detail.Render(_controller.State);
        _detail.SetPinned(_pinned);
        if (!_detail.IsVisible) { _detail.Show(); NativeWindows.ShowWithoutActivation(_detail); }
        PlaceDetail();
        _inspect = true;
        ApplyOpacity();
    }
    private void PlaceDetail()
    {
        if (_detail is null) return;
        var scale = NativeWindows.Scale(this);
        var height = Math.Min(Math.Max(110, _detail.NaturalHeight()), NativeWindows.WorkArea(this).Height / scale - 16);
        _detail.Height = height;
        _detail.Width = 320;
        var rect = WindowGeometry.Detail(NativeWindows.Bounds(this), NativeWindows.WorkArea(this), 320 * scale, height * scale, 8 * scale);
        NativeWindows.Place(_detail, rect);
    }
    internal void HideDetails()
    {
        _pinned = _inspect = false;
        _detail?.Hide();
        _hoverSince = DateTimeOffset.UtcNow;
        _nextRotation = DateTimeOffset.UtcNow.AddSeconds(_controller.State.Preferences.RotationSeconds);
        ApplyOpacity();
    }
    internal void DockForSmoke(DockEdge edge)
    {
        HideDetails();
        Edge = edge;
        Render(_controller.State);
        Reflow();
    }
    public void Dispose()
    {
        _interaction.Stop();
        _controller.Changed -= OnSnapshotChanged;
        _detail?.Close();
    }
}
