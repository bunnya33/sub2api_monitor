using System.Text.Json;
using QuotaMonitor.Core;

namespace QuotaMonitor.Tests;

public class DisplayTests
{
    private static readonly Account Account = new(7, "Claude", "anthropic", "oauth", "active");

    [Fact]
    public void MissingWindowIsUnknownRatherThanZero()
    {
        using var json = JsonDocument.Parse("{\"five_hour\":{\"utilization\":12.5},\"seven_day\":null}");
        var quota = Sub2ApiClient.MapUsage(Account, json.RootElement, DateTimeOffset.UtcNow);
        Assert.Equal("13%", QuotaDisplay.Percent(quota.FiveHour, Metric.Used));
        Assert.Equal("--", QuotaDisplay.Percent(quota.SevenDay, Metric.Used));
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(double.NaN)]
    public void InvalidWindowIsUnknown(double used)
    {
        var body = used < 0 ? "{\"five_hour\":{\"utilization\":-1}}" : "{\"five_hour\":{\"utilization\":\"NaN\"}}";
        using var json = JsonDocument.Parse(body);
        Assert.Null(Sub2ApiClient.MapUsage(Account, json.RootElement, DateTimeOffset.UtcNow).FiveHour);
    }

    [Fact]
    public void ServerTimestampsAndOverLimitConsumptionArePreserved()
    {
        var now = DateTimeOffset.UtcNow;
        using var json = JsonDocument.Parse("{\"five_hour\":{\"utilization\":108,\"remaining_seconds\":120},\"updated_at\":\"2026-09-28T02:00:00Z\",\"source\":\"passive\"}");
        var quota = Sub2ApiClient.MapUsage(Account, json.RootElement, now);
        Assert.Equal(108, quota.FiveHour!.Used);
        Assert.Equal(now.AddMinutes(2), quota.FiveHour.ResetsAt);
        Assert.Equal("0%", QuotaDisplay.Percent(quota.FiveHour, Metric.Remaining));
        Assert.Equal(DateTimeOffset.Parse("2026-09-28T02:00:00Z"), quota.SourceUpdatedAt);
    }

    [Fact]
    public void RemainingModeDoesNotReverseSeverityOrWorstWindow()
    {
        var settings = new Preferences { Metric = Metric.Remaining };
        var quota = new AccountQuota(Account, new(19, null), new(84, null));
        Assert.Equal(settings.CriticalColor, QuotaDisplay.Color(84, settings));
        Assert.Equal("16%", QuotaDisplay.Percent(quota.SevenDay, settings.Metric));
        Assert.Equal([QuotaPeriod.SevenDay], QuotaDisplay.Periods(quota, settings));
    }

    [Fact]
    public void OpacityRestoresForAllInteractionStates()
    {
        var settings = new Preferences { InactiveOpacityPercent = 40 };
        Assert.Equal(.4, QuotaDisplay.Opacity(settings, false, false, false, false));
        Assert.Equal(1, QuotaDisplay.Opacity(settings, true, false, false, false));
        Assert.Equal(1, QuotaDisplay.Opacity(settings, false, true, false, false));
        Assert.Equal(1, QuotaDisplay.Opacity(settings, false, false, true, false));
        Assert.Equal(1, QuotaDisplay.Opacity(settings, false, false, false, true));
        Assert.Equal(1, QuotaDisplay.Opacity(settings with { FadeWhenInactive = false }, false, false, false, false));
    }

    [Fact]
    public void RemovingFiveHourColumnShrinksWindow()
    {
        Assert.Equal((224d, 64d), WindowGeometry.Size(new(), 2, DockEdge.None));
        Assert.Equal((150d, 64d), WindowGeometry.Size(new() { ShowFiveHour = false }, 2, DockEdge.None));
        Assert.Equal((178d, 32d), WindowGeometry.Size(new(), 2, DockEdge.Top));
        Assert.Equal((64d, 78d), WindowGeometry.Size(new(), 2, DockEdge.Left, 2));
    }

    [Fact]
    public void NegativeMonitorCoordinatesAndRightBottomWorkAreaAreRespected()
    {
        var work = new ScreenRect(-1920, -200, 1920, 1040);
        var value = WindowGeometry.Clamp(new(-2600, 1000, 224, 64), work, DockEdge.Right);
        Assert.Equal(new ScreenRect(-224, 776, 224, 64), value);
        Assert.Equal(DockEdge.Right, WindowGeometry.Snap(value, work));
        var detail = WindowGeometry.Detail(value, work, 320, 350, 8);
        Assert.True(detail.X >= work.X && detail.Right <= work.Right && detail.Bottom <= work.Bottom);
    }

    [Fact]
    public void InvalidPreferencesCannotCreateInvisibleOrOversizedWindows()
    {
        var settings = new Preferences { InactiveOpacityPercent = -20, RefreshSeconds = 0, BarWidth = 1000, NormalColor = "oops" }.Normalize();
        Assert.Equal(20, settings.InactiveOpacityPercent);
        Assert.Equal(5, settings.RefreshSeconds);
        Assert.Equal(240, settings.BarWidth);
        Assert.Equal("#83cbaa", settings.NormalColor);
    }
}
