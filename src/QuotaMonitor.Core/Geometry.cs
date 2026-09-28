namespace QuotaMonitor.Core;

// Geometry uses physical screen pixels; view dimensions are converted from DIP at the window boundary.
public readonly record struct ScreenRect(double X, double Y, double Width, double Height)
{
    public double Right => X + Width;
    public double Bottom => Y + Height;
    public bool Contains(double x, double y) => x >= X && x <= Right && y >= Y && y <= Bottom;
}

public static class WindowGeometry
{
    public static (double Width, double Height) Size(Preferences settings, int accounts, DockEdge edge, int periods = 1)
    {
        if (settings.AutoCollapse && edge != DockEdge.None)
            return edge is DockEdge.Top or DockEdge.Bottom ? (settings.HorizontalDockWidth, 32)
                : (settings.SideDockWidth, 30 + periods * 22 + (periods - 1) * 4);
        return (settings.ShowFiveHour ? 88 + 2 * settings.BarWidth : 82 + settings.BarWidth,
            14 + Math.Max(1, accounts) * 22 + Math.Max(0, accounts - 1) * 6);
    }

    public static ScreenRect Clamp(ScreenRect value, ScreenRect work, DockEdge edge = DockEdge.None)
    {
        var width = Math.Min(value.Width, work.Width);
        var height = Math.Min(value.Height, work.Height);
        var x = Math.Clamp(value.X, work.X, Math.Max(work.X, work.Right - width));
        var y = Math.Clamp(value.Y, work.Y, Math.Max(work.Y, work.Bottom - height));
        if (edge == DockEdge.Left) x = work.X;
        if (edge == DockEdge.Right) x = work.Right - width;
        if (edge == DockEdge.Top) y = work.Y;
        if (edge == DockEdge.Bottom) y = work.Bottom - height;
        return new(x, y, width, height);
    }

    public static DockEdge Snap(ScreenRect value, ScreenRect work, double threshold = 20)
    {
        var edges = new[] { (DockEdge.Left, Math.Abs(value.X - work.X)), (DockEdge.Right, Math.Abs(value.Right - work.Right)),
            (DockEdge.Top, Math.Abs(value.Y - work.Y)), (DockEdge.Bottom, Math.Abs(value.Bottom - work.Bottom)) };
        var nearest = edges.MinBy(candidate => candidate.Item2);
        return nearest.Item2 <= threshold ? nearest.Item1 : DockEdge.None;
    }

    public static ScreenRect Detail(ScreenRect ball, ScreenRect work, double width, double height, double gap)
    {
        width = Math.Min(width, work.Width - 2 * gap);
        height = Math.Min(height, work.Height - 2 * gap);
        var candidates = new[] { new ScreenRect(ball.Right + gap, ball.Y, width, height),
            new(ball.X - gap - width, ball.Y, width, height), new(ball.X, ball.Bottom + gap, width, height),
            new(ball.X, ball.Y - gap - height, width, height) };
        foreach (var value in candidates)
            if (value.X >= work.X && value.Y >= work.Y && value.Right <= work.Right && value.Bottom <= work.Bottom) return value;
        return Clamp(candidates[0], new(work.X + gap, work.Y + gap, work.Width - 2 * gap, work.Height - 2 * gap));
    }
}
