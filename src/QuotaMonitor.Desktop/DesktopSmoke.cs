using System.Drawing.Imaging;
using System.Text.Json;
using System.Windows.Media.Imaging;

namespace QuotaMonitor.Desktop;

// This opt-in runner exercises real HWNDs and uses an isolated configuration directory.
internal static class DesktopSmoke
{
    internal static async Task RunAsync(MonitorController controller, FloatingWindow floating, LocalStore store)
    {
        var directory = Environment.GetEnvironmentVariable("QUOTA_SMOKE_DIR") ?? Path.Combine(Environment.CurrentDirectory, "artifacts", "wpf-smoke");
        Directory.CreateDirectory(directory);
        var checks = new List<string>();
        var originalCursor = NativeWindows.Cursor();
        void Check(bool condition, string name)
        {
            if (!condition) throw new InvalidOperationException("Desktop smoke failed: " + name);
            checks.Add(name);
        }
        try
        {
            await Task.Delay(250);
            await controller.UpdateAsync(new Preferences { Demo = true, SelectedIds = [1, 2], RotationSeconds = 2 });
            floating.DockForSmoke(DockEdge.None);
            var work = NativeWindows.WorkArea(floating);
            NativeWindows.SetCursorPos((int)work.X + 12, (int)work.Y + 120);
            var foreground = NativeWindows.GetForegroundWindow();
            await Task.Delay(450);
            Check(NativeWindows.IsWindowVisible(NativeWindows.Handle(floating)), "floating HWND is visible to Windows");
            Check(Math.Abs(floating.Opacity - .65) < .01, "idle opacity is 65 percent");
            Check(Math.Abs(floating.Width - 224) < .1 && Math.Abs(floating.Height - 64) < .1, "two account compact size");
            Capture(floating, Path.Combine(directory, "floating-idle.png"));
            var rect = NativeWindows.Bounds(floating);
            NativeWindows.SetCursorPos((int)(rect.X + rect.Width / 2), (int)(rect.Y + rect.Height / 2));
            await Task.Delay(700);
            Check(Math.Abs(floating.Opacity - 1) < .01, "hover restores full opacity");
            Check(floating.Details?.IsVisible == true, "hover opens detailed native window");
            Check(NativeWindows.IsWindowVisible(NativeWindows.Handle(floating.Details!)), "details HWND is visible to Windows");
            Check(NativeWindows.GetForegroundWindow() == foreground, "hover does not steal foreground focus");
            Capture(floating, Path.Combine(directory, "floating-hover.png"));
            Capture(floating.Details!, Path.Combine(directory, "details.png"));
            NativeWindows.SetCursorPos((int)work.X + 12, (int)work.Y + 120);
            await Task.Delay(650);
            Check(floating.Details?.IsVisible == false, "leaving closes unpinned details");
            Check(Math.Abs(floating.Opacity - .65) < .01, "leaving restores idle opacity");
            await controller.UpdateAsync(controller.State.Preferences with { ShowFiveHour = false });
            Check(Math.Abs(floating.Width - 150) < .1, "seven day only shrinks width");
            Capture(floating, Path.Combine(directory, "seven-day-only.png"));
            await controller.UpdateAsync(controller.State.Preferences with { ShowFiveHour = true, BarWidth = 96, Summary = SummaryMode.Both });
            Check(Math.Abs(floating.Width - 280) < .1, "custom bar width resizes window");
            foreach (var edge in new[] { DockEdge.Left, DockEdge.Right, DockEdge.Top, DockEdge.Bottom })
            {
                floating.DockForSmoke(edge);
                await Task.Delay(180);
                rect = NativeWindows.Bounds(floating);
                work = NativeWindows.WorkArea(floating);
                var aligned = edge switch
                {
                    DockEdge.Left => Math.Abs(rect.X - work.X) < 2,
                    DockEdge.Right => Math.Abs(rect.Right - work.Right) < 2,
                    DockEdge.Top => Math.Abs(rect.Y - work.Y) < 2,
                    _ => Math.Abs(rect.Bottom - work.Bottom) < 2
                };
                Check(aligned, edge + " dock aligns to working area");
                Check(Math.Abs(floating.Width - (edge is DockEdge.Top or DockEdge.Bottom ? 178 : 64)) < .1, edge + " dock width");
                Capture(floating, Path.Combine(directory, "dock-" + edge.ToString().ToLowerInvariant() + ".png"));
            }
            var oldIndex = floating.RotatingIndex;
            await Task.Delay(2350);
            Check(floating.RotatingIndex != oldIndex, "docked account rotates automatically");
            await controller.UpdateAsync(controller.State.Preferences with { InactiveOpacityPercent = 40 });
            await Task.Delay(300);
            Check(Math.Abs(floating.Opacity - .4) < .01, "configured idle opacity is applied");
            await controller.UpdateAsync(controller.State.Preferences with { FadeWhenInactive = false });
            await Task.Delay(300);
            Check(Math.Abs(floating.Opacity - 1) < .01, "fade can be disabled");
            var token = new SavedSession("https://example.invalid", "qa@example.invalid", "smoke-refresh-token");
            store.Save(token);
            Check(store.Load() == token, "Windows DPAPI session round trip");
            Check(!System.Text.Encoding.UTF8.GetString(File.ReadAllBytes(Path.Combine(store.DirectoryPath, "session.dpapi"))).Contains(token.RefreshToken), "refresh token is encrypted on disk");
            store.Clear();
            floating.DockForSmoke(DockEdge.None);
            var settings = new SettingsWindow(controller);
            settings.Show();
            await Task.Delay(180);
            for (var tab = 0; tab < 5; tab++)
            {
                settings.SelectTab(tab);
                await Task.Delay(120);
                Capture(settings, Path.Combine(directory, "settings-" + tab + ".png"));
            }
            settings.Close();
            Check(!Directory.EnumerateFiles(store.DirectoryPath).Any(p => p.EndsWith("session.dpapi", StringComparison.Ordinal)), "logout storage clears encrypted session");
            File.WriteAllText(Path.Combine(directory, "result.json"), JsonSerializer.Serialize(new { passed = true, checks,
                native = NativeWindows.Diagnostics(floating) }, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception error)
        {
            File.WriteAllText(Path.Combine(directory, "result.json"), JsonSerializer.Serialize(new { passed = false, checks, error = error.ToString() }, new JsonSerializerOptions { WriteIndented = true }));
            Environment.ExitCode = 1;
        }
        finally { NativeWindows.SetCursorPos(originalCursor.X, originalCursor.Y); }
    }
    private static void Capture(Window window, string path)
    {
        window.UpdateLayout();
        var dpi = VisualTreeHelper.GetDpi(window);
        var image = new RenderTargetBitmap(Math.Max(1, (int)Math.Ceiling(window.ActualWidth * dpi.DpiScaleX)),
            Math.Max(1, (int)Math.Ceiling(window.ActualHeight * dpi.DpiScaleY)), dpi.PixelsPerInchX, dpi.PixelsPerInchY, PixelFormats.Pbgra32);
        image.Render(window);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(image));
        using (var stream = File.Create(path)) encoder.Save(stream);
        var bounds = NativeWindows.Bounds(window);
        using var bitmap = new System.Drawing.Bitmap((int)bounds.Width, (int)bounds.Height);
        using var graphics = System.Drawing.Graphics.FromImage(bitmap);
        graphics.CopyFromScreen((int)bounds.X, (int)bounds.Y, 0, 0, bitmap.Size);
        bitmap.Save(Path.ChangeExtension(path, ".screen.png"), ImageFormat.Png);
    }
}
