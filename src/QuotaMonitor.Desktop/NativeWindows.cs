using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Windows.Interop;

namespace QuotaMonitor.Desktop;

internal static class NativeWindows
{
    [StructLayout(LayoutKind.Sequential)] internal struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct MonitorInfo
    {
        public int Size;
        public Rect Monitor, Work;
        public uint Flags;
    }
    [DllImport("user32.dll")] private static extern bool GetWindowRect(nint hwnd, out Rect rect);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] internal static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] private static extern nint MonitorFromWindow(nint hwnd, uint flags);
    [DllImport("user32.dll")] private static extern nint MonitorFromPoint(Point point, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern bool GetMonitorInfo(nint monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(nint hwnd);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(nint hwnd, nint after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern nint GetWindowLongPtr(nint hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] private static extern nint SetWindowLongPtr(nint hwnd, int index, nint value);
    [DllImport("user32.dll")] internal static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] internal static extern bool IsWindowVisible(nint hwnd);
    [DllImport("user32.dll")] private static extern bool ShowWindow(nint hwnd, int command);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(nint hwnd, int attribute, out int value, int size);
    [DllImport("user32.dll")] private static extern nint GetThreadDesktop(uint threadId);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool GetUserObjectInformation(nint handle, int index, System.Text.StringBuilder buffer, int length, out int needed);

    internal static nint Handle(Window window) => new WindowInteropHelper(window).Handle;
    internal static double Scale(Window window) => Math.Max(96, GetDpiForWindow(Handle(window))) / 96d;
    internal static Point Cursor() { GetCursorPos(out var point); return point; }
    internal static ScreenRect Bounds(Window window)
    {
        GetWindowRect(Handle(window), out var r);
        return new(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);
    }
    internal static ScreenRect WorkArea(Window window) => Work(MonitorFromWindow(Handle(window), 2));
    internal static ScreenRect WorkArea(Point point) => Work(MonitorFromPoint(point, 2));
    private static ScreenRect Work(nint monitor)
    {
        var info = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
        if (!GetMonitorInfo(monitor, ref info)) throw new Win32Exception();
        return new(info.Work.Left, info.Work.Top, info.Work.Right - info.Work.Left, info.Work.Bottom - info.Work.Top);
    }
    internal static void Place(Window window, ScreenRect rect)
    {
        SetWindowPos(Handle(window), 0, (int)Math.Round(rect.X), (int)Math.Round(rect.Y),
            (int)Math.Round(rect.Width), (int)Math.Round(rect.Height), 0x0014); // NOZORDER | NOACTIVATE
    }
    internal static void NoActivate(Window window)
    {
        var hwnd = Handle(window);
        SetWindowLongPtr(hwnd, -20, GetWindowLongPtr(hwnd, -20) | 0x08000000 | 0x00000080);
    }
    internal static void ShowWithoutActivation(Window window) => ShowWindow(Handle(window), 8);
    internal static object Diagnostics(Window window)
    {
        var desktop = new System.Text.StringBuilder(256);
        GetUserObjectInformation(GetThreadDesktop(GetCurrentThreadId()), 2, desktop, 512, out _);
        DwmGetWindowAttribute(Handle(window), 14, out var cloaked, sizeof(int));
        return new { desktop = desktop.ToString(), cloaked, visible = IsWindowVisible(Handle(window)),
            foreground = GetForegroundWindow().ToInt64(), handle = Handle(window).ToInt64(), bounds = Bounds(window) };
    }
}
