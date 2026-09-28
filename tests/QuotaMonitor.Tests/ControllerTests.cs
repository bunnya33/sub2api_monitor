using System.Net;
using QuotaMonitor.Core;

namespace QuotaMonitor.Tests;

public class ControllerTests
{
    private static HttpResponseMessage Success(string path) => path.EndsWith("/login")
        ? FixtureHandler.Json("{\"access_token\":\"access\",\"refresh_token\":\"refresh\"}")
        : path.EndsWith("/me") ? FixtureHandler.Json("{\"role\":\"admin\"}")
        : path.EndsWith("/accounts") ? FixtureHandler.Json("{\"items\":[{\"id\":1,\"name\":\"C1\",\"platform\":\"anthropic\",\"type\":\"oauth\",\"status\":\"active\"},{\"id\":2,\"name\":\"O2\",\"platform\":\"openai\",\"type\":\"oauth\",\"status\":\"active\"}],\"total\":2}")
        : FixtureHandler.Json("{\"five_hour\":{\"utilization\":32},\"seven_day\":{\"utilization\":58},\"source\":\"passive\"}");

    [Fact]
    public async Task OneAccountFailureRetainsItsLastSuccessfulTimestamp()
    {
        var failing = false;
        using var http = new HttpClient(new FixtureHandler(request => Task.FromResult(failing && request.RequestUri!.AbsolutePath.EndsWith("/2/usage")
            ? FixtureHandler.Json("{}", HttpStatusCode.BadGateway) : Success(request.RequestUri!.AbsolutePath))));
        using var controller = new MonitorController(new(), new MemoryVault(), _ => { }, factory: (s, v, r) => new(s, v, r, http));
        await controller.LoginAsync("https://example.invalid", "admin@example.com", "password");
        var original = controller.State.Quotas.Single(q => q.Account.Id == 2);
        failing = true;
        await controller.RefreshAsync();
        var cached = controller.State.Quotas.Single(q => q.Account.Id == 2);
        Assert.NotNull(cached.Error);
        Assert.Equal(original.FetchedAt, cached.FetchedAt);
        Assert.Equal(original.SevenDay, cached.SevenDay);
        Assert.Null(controller.State.Quotas.Single(q => q.Account.Id == 1).Error);
        Assert.Equal(ConnectionStatus.Connected, controller.State.Status);
    }

    [Fact]
    public async Task ManualRefreshRequestsShareOnePendingOperation()
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var usageCalls = 0;
        var delay = false;
        using var http = new HttpClient(new FixtureHandler(async request =>
        {
            if (request.RequestUri!.AbsolutePath.EndsWith("/usage"))
            {
                usageCalls++;
                if (delay) { entered.TrySetResult(); await release.Task; }
            }
            return Success(request.RequestUri.AbsolutePath);
        }));
        using var controller = new MonitorController(new(), new MemoryVault(), _ => { }, factory: (s, v, r) => new(s, v, r, http));
        await controller.LoginAsync("https://example.invalid", "admin@example.com", "password");
        delay = true;
        var first = controller.RefreshAsync();
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var second = controller.RefreshAsync();
        release.TrySetResult();
        await Task.WhenAll(first, second).WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(4, usageCalls); // Two accounts for the initial fetch and one shared refresh.
        Assert.False(controller.State.Busy);
    }

    [Fact]
    public async Task SelectionChangedDuringRefreshCannotReintroduceDeselectedAccount()
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var delay = false;
        using var http = new HttpClient(new FixtureHandler(async request =>
        {
            if (delay && request.RequestUri!.AbsolutePath.EndsWith("/1/usage")) { entered.TrySetResult(); await release.Task; }
            return Success(request.RequestUri!.AbsolutePath);
        }));
        using var controller = new MonitorController(new(), new MemoryVault(), _ => { }, factory: (s, v, r) => new(s, v, r, http));
        await controller.LoginAsync("https://example.invalid", "admin@example.com", "password");
        delay = true;
        var refresh = controller.RefreshAsync();
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var selection = controller.UpdateAsync(controller.State.Preferences with { SelectedIds = [2] });
        release.TrySetResult();
        await Task.WhenAll(refresh, selection).WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(2, Assert.Single(controller.State.Quotas).Account.Id);
    }

    [Fact]
    public async Task OldLoginResponseCannotOverwriteNewEncryptedSession()
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var http = new HttpClient(new FixtureHandler(async request =>
        {
            if (request.RequestUri!.Host == "old.invalid" && request.RequestUri.AbsolutePath.EndsWith("/login"))
            {
                entered.TrySetResult();
                await release.Task;
                return FixtureHandler.Json("{\"access_token\":\"old-access\",\"refresh_token\":\"old-refresh\"}");
            }
            return Success(request.RequestUri.AbsolutePath);
        }));
        var vault = new MemoryVault();
        using var controller = new MonitorController(new(), vault, _ => { }, factory: (s, v, r) => new(s, v, r, http));
        var oldLogin = controller.LoginAsync("https://old.invalid", "old@example.com", "old-password");
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await controller.LoginAsync("https://new.invalid", "new@example.com", "new-password");
        release.TrySetResult();
        await oldLogin.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal("https://new.invalid", controller.State.Server);
        Assert.Equal("https://new.invalid", vault.Session!.Server);
        Assert.Equal("refresh", vault.Session.RefreshToken);
    }

    [Fact]
    public void DemoHonorsSavedSingleAccountSelection()
    {
        using var controller = new MonitorController(new() { Demo = true, SelectedIds = [2] }, new MemoryVault(), _ => { });
        Assert.Equal(2, Assert.Single(controller.State.Quotas).Account.Id);
    }
}
