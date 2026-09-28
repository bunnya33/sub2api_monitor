using System.Globalization;
using System.Windows.Automation;

namespace QuotaMonitor.Desktop;

internal sealed class QuotaBar : FrameworkElement
{
    private readonly QuotaWindow? _quota;
    private readonly Preferences _settings;
    public QuotaBar(QuotaWindow? quota, Preferences settings, string label, double? width = null)
    {
        _quota = quota;
        _settings = settings;
        Height = 22;
        if (width is not null) Width = width.Value;
        MinWidth = 28;
        ToolTip = label + " · " + QuotaDisplay.Percent(quota, settings.Metric);
        AutomationProperties.SetName(this, (string)ToolTip);
        SnapsToDevicePixels = true;
    }
    protected override Size MeasureOverride(Size available) => new(double.IsFinite(available.Width) ? available.Width : 68, 22);
    protected override void OnRender(DrawingContext context)
    {
        base.OnRender(context);
        var rect = new Rect(0, 0, ActualWidth, ActualHeight);
        context.PushClip(new RectangleGeometry(rect, 3, 3));
        context.DrawRectangle(Ui.Brush("#edf1ef"), null, rect);
        var text = QuotaDisplay.Percent(_quota, _settings.Metric);
        DrawText(context, text, Ui.Brush("#26322e"));
        if (_quota is not null)
        {
            var color = Ui.Brush(QuotaDisplay.Color(_quota.Used, _settings));
            var width = ActualWidth * Math.Clamp(QuotaDisplay.Value(_quota.Used, _settings.Metric), 0, 100) / 100;
            context.PushClip(new RectangleGeometry(new Rect(0, 0, width, ActualHeight)));
            context.DrawRectangle(color, null, rect);
            DrawText(context, text, Contrast(color.Color));
            context.Pop();
        }
        context.Pop();
    }
    private void DrawText(DrawingContext context, string value, Brush ink)
    {
        var text = new FormattedText(value, CultureInfo.InvariantCulture, FlowDirection.LeftToRight,
            new Typeface("Segoe UI"), 11, ink, VisualTreeHelper.GetDpi(this).PixelsPerDip);
        text.MaxTextWidth = Math.Max(1, ActualWidth);
        text.Trimming = TextTrimming.CharacterEllipsis;
        context.DrawText(text, new Point(Math.Max(0, (ActualWidth - text.Width) / 2), (ActualHeight - text.Height) / 2));
    }
    private static Brush Contrast(Color color)
    {
        static double Linear(byte b) { var v = b / 255d; return v <= .04045 ? v / 12.92 : Math.Pow((v + .055) / 1.055, 2.4); }
        var luminance = .2126 * Linear(color.R) + .7152 * Linear(color.G) + .0722 * Linear(color.B);
        return (luminance + .05) / .05 >= 1.05 / (luminance + .05) ? Brushes.Black : Brushes.White;
    }
}

internal static class Ui
{
    internal static SolidColorBrush Brush(string color)
    {
        var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(color));
        brush.Freeze();
        return brush;
    }
    internal static TextBlock Text(string value, double size = 12, bool muted = false) => new()
    {
        Text = value, FontSize = size, Foreground = Brush(muted ? "#64716c" : "#26322e"),
        VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis
    };
    internal static Button Icon(string glyph, string tooltip, RoutedEventHandler action)
    {
        var button = new Button { Content = new TextBlock { Text = glyph, FontFamily = new FontFamily("Segoe Fluent Icons"), FontSize = 14 },
            Width = 28, Height = 28, Padding = new Thickness(0), ToolTip = tooltip };
        AutomationProperties.SetName(button, tooltip);
        button.Click += action;
        return button;
    }
    internal static string Time(DateTimeOffset? time) => time?.ToLocalTime().ToString("MM-dd HH:mm:ss") ?? "--";
    internal static string Reset(DateTimeOffset? time)
    {
        if (time is null) return "重置时间未知";
        var remaining = time.Value - DateTimeOffset.UtcNow;
        if (remaining <= TimeSpan.Zero) return "等待服务端更新";
        return remaining.TotalDays >= 1 ? $"{(int)remaining.TotalDays}天{remaining.Hours}小时后重置"
            : $"{(int)remaining.TotalHours}小时{remaining.Minutes}分后重置";
    }
    internal static string Source(string source) => source switch { "passive" => "被动采样", "active" => "服务端查询", "demo" => "演示数据", "unknown" => "暂无数据", _ => "服务端快照" };
    internal static string Platform(string platform) => platform switch { "anthropic" => "Claude", "openai" => "OpenAI", _ => platform };
}
