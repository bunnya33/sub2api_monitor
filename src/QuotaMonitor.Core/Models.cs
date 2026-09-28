using System.Text.RegularExpressions;

namespace QuotaMonitor.Core;

public enum Metric { Used, Remaining }
public enum SummaryMode { Worst, Both, FiveHour, SevenDay }
public enum DockEdge { None, Left, Right, Top, Bottom }
public enum ConnectionStatus { Disconnected, Authenticating, TwoFactor, Connected, Demo, Expired, Error }
public enum QuotaPeriod { FiveHour, SevenDay }

public sealed record Preferences
{
    public Metric Metric { get; init; } = Metric.Used;
    public bool ShowFiveHour { get; init; } = true;
    public bool AutoCollapse { get; init; } = true;
    public SummaryMode Summary { get; init; } = SummaryMode.Worst;
    public int BarWidth { get; init; } = 68;
    public int HorizontalDockWidth { get; init; } = 178;
    public int SideDockWidth { get; init; } = 64;
    public bool AutoRefresh { get; init; } = true;
    public int RefreshSeconds { get; init; } = 60;
    public int RotationSeconds { get; init; } = 4;
    public string NormalColor { get; init; } = "#83cbaa";
    public string WarningColor { get; init; } = "#ffa600";
    public string CriticalColor { get; init; } = "#ed9c98";
    public bool FadeWhenInactive { get; init; } = true;
    public int InactiveOpacityPercent { get; init; } = 65;
    public bool RememberSession { get; init; } = true;
    public bool Demo { get; init; }
    public int[] SelectedIds { get; init; } = [];

    public Preferences Normalize() => this with
    {
        Metric = Enum.IsDefined(Metric) ? Metric : Metric.Used,
        Summary = Enum.IsDefined(Summary) ? Summary : SummaryMode.Worst,
        BarWidth = Math.Clamp(BarWidth, 40, 240),
        HorizontalDockWidth = Math.Clamp(HorizontalDockWidth, 120, 400),
        SideDockWidth = Math.Clamp(SideDockWidth, 48, 240),
        RefreshSeconds = Math.Clamp(RefreshSeconds, 5, 3600),
        RotationSeconds = Math.Clamp(RotationSeconds, 2, 60),
        InactiveOpacityPercent = Math.Clamp(InactiveOpacityPercent, 20, 100),
        NormalColor = ValidColor(NormalColor) ? NormalColor : "#83cbaa",
        WarningColor = ValidColor(WarningColor) ? WarningColor : "#ffa600",
        CriticalColor = ValidColor(CriticalColor) ? CriticalColor : "#ed9c98",
        SelectedIds = (SelectedIds ?? []).Where(id => id > 0).Distinct().Take(100).ToArray()
    };

    public static bool ValidColor(string? color) => color is not null && Regex.IsMatch(color, "^#[0-9a-fA-F]{6}$");
}

public sealed record Account(int Id, string Name, string Platform, string Type, string Status);
public sealed record QuotaWindow(double Used, DateTimeOffset? ResetsAt);
public sealed record AccountQuota(Account Account, QuotaWindow? FiveHour = null, QuotaWindow? SevenDay = null,
    string Source = "unknown", DateTimeOffset? SourceUpdatedAt = null, DateTimeOffset? FetchedAt = null, string? Error = null)
{
    public QuotaWindow? Window(QuotaPeriod period) => period == QuotaPeriod.FiveHour ? FiveHour : SevenDay;
}

public sealed record SavedSession(string Server, string Email, string RefreshToken);
public interface ISessionVault
{
    SavedSession? Load();
    void Save(SavedSession session);
    void Clear();
}

public sealed record AppSnapshot(Preferences Preferences, ConnectionStatus Status, string Server, string Email,
    string Message, IReadOnlyList<Account> Accounts, IReadOnlyList<AccountQuota> Quotas,
    bool Busy = false, DateTimeOffset? LastRefresh = null, DateTimeOffset? NextRefresh = null, string? Error = null);

public static class QuotaDisplay
{
    public static double Value(double used, Metric metric) => metric == Metric.Used ? used : Math.Max(0, 100 - used);
    public static string Color(double used, Preferences settings) => used >= 80 ? settings.CriticalColor
        : used > 50 ? settings.WarningColor : settings.NormalColor;
    public static string Percent(QuotaWindow? window, Metric metric) => window is null ? "--"
        : Math.Round(Value(window.Used, metric), MidpointRounding.AwayFromZero).ToString("0", System.Globalization.CultureInfo.InvariantCulture) + "%";

    public static QuotaPeriod[] Periods(AccountQuota quota, Preferences settings)
    {
        if (!settings.ShowFiveHour) return [QuotaPeriod.SevenDay];
        return settings.Summary switch
        {
            SummaryMode.Both => [QuotaPeriod.FiveHour, QuotaPeriod.SevenDay],
            SummaryMode.FiveHour => [QuotaPeriod.FiveHour],
            SummaryMode.SevenDay => [QuotaPeriod.SevenDay],
            _ => [(quota.FiveHour?.Used ?? -1) >= (quota.SevenDay?.Used ?? -1) ? QuotaPeriod.FiveHour : QuotaPeriod.SevenDay]
        };
    }

    public static double Opacity(Preferences settings, bool active, bool hovered, bool dragging, bool inspecting) =>
        !settings.FadeWhenInactive || active || hovered || dragging || inspecting ? 1 : settings.InactiveOpacityPercent / 100d;
}
