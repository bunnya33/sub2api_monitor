namespace QuotaMonitor.Core;

public sealed class MonitorController : IDisposable
{
    private readonly ISessionVault _vault;
    private readonly Action<AppSnapshot> _save;
    private readonly Func<string, ISessionVault, bool, Sub2ApiClient> _factory;
    private CancellationTokenSource _sessionCancellation = new();
    private Sub2ApiClient? _client;
    private int _generation, _selectionVersion;
    private Task? _refresh;
    public AppSnapshot State { get; private set; }
    public event Action<AppSnapshot>? Changed;

    public MonitorController(Preferences settings, ISessionVault vault, Action<AppSnapshot> save,
        string server = "", string email = "", Func<string, ISessionVault, bool, Sub2ApiClient>? factory = null)
    {
        _vault = vault;
        _save = save;
        _factory = factory ?? ((s, v, r) => new(s, v, r));
        State = new(settings.Normalize(), ConnectionStatus.Disconnected, server, email, "未登录", [], []);
        if (settings.Demo) EnableDemo();
    }

    private sealed class ScopedVault(MonitorController owner, int generation) : ISessionVault
    {
        public SavedSession? Load() => owner._vault.Load();
        public void Save(SavedSession value) { if (generation == owner._generation) owner._vault.Save(value); }
        public void Clear() { if (generation == owner._generation) owner._vault.Clear(); }
    }

    private void Publish(bool save = false)
    {
        if (save) _save(State);
        Changed?.Invoke(State);
    }
    private void Schedule(TimeSpan delay = default) => State = State with { NextRefresh = State.Preferences.AutoRefresh
        && State.Status is ConnectionStatus.Connected or ConnectionStatus.Demo
        ? DateTimeOffset.UtcNow + (delay > TimeSpan.FromSeconds(State.Preferences.RefreshSeconds)
            ? delay : TimeSpan.FromSeconds(State.Preferences.RefreshSeconds)) : null };
    private Account[] Selected() => State.Accounts.Where(a => State.Preferences.SelectedIds.Contains(a.Id)).ToArray();

    public static AccountQuota[] DemoQuotas(DateTimeOffset now) =>
    [
        new(new(1, "示例 C1", "anthropic", "oauth", "active"), new(32, now.AddMinutes(138)), new(58, now.AddHours(78)), "demo", now, now),
        new(new(2, "示例 O2", "openai", "oauth", "active"), new(19, now.AddMinutes(245)), new(84, now.AddHours(36)), "demo", now, now)
    ];
    private void EnableDemo()
    {
        var quotas = DemoQuotas(DateTimeOffset.UtcNow);
        var ids = State.Preferences.SelectedIds.Where(id => id is 1 or 2).ToArray();
        if (ids.Length == 0) ids = [1, 2];
        State = State with { Preferences = State.Preferences with { Demo = true, SelectedIds = ids },
            Status = ConnectionStatus.Demo, Message = "演示数据", Accounts = quotas.Select(q => q.Account).ToArray(),
            Quotas = quotas.Where(q => ids.Contains(q.Account.Id)).ToArray(), LastRefresh = DateTimeOffset.UtcNow, Error = null };
        Schedule();
    }

    public async Task StartAsync()
    {
        if (State.Preferences.Demo || !State.Preferences.RememberSession) return;
        var saved = _vault.Load();
        if (saved is null) return;
        var generation = ++_generation;
        _client = _factory(saved.Server, new ScopedVault(this, generation), true);
        var client = _client;
        State = State with { Server = saved.Server, Email = saved.Email, Status = ConnectionStatus.Authenticating, Message = "正在恢复登录" };
        Publish();
        try
        {
            await client.RestoreAsync(saved, _sessionCancellation.Token);
            await ConnectedAsync(client, generation);
        }
        catch (OperationCanceledException) { }
        catch (Exception error) when (error is ApiException or IOException)
        { if (generation == _generation) Fail(error, true); }
    }

    public async Task LoginAsync(string server, string email, string password)
    {
        server = Sub2ApiClient.NormalizeServer(server);
        var resetIds = State.Preferences.Demo || State.Server != server;
        CancelSession();
        var generation = ++_generation;
        _client = _factory(server, new ScopedVault(this, generation), State.Preferences.RememberSession);
        var client = _client;
        State = State with { Preferences = State.Preferences with { Demo = false, SelectedIds = resetIds ? [] : State.Preferences.SelectedIds },
            Server = server, Email = email.Trim(), Status = ConnectionStatus.Authenticating, Message = "正在登录",
            Accounts = [], Quotas = [], LastRefresh = null, Error = null };
        Publish(true);
        try
        {
            var twoFactor = await client.LoginAsync(email, password, _sessionCancellation.Token);
            if (generation != _generation) return;
            if (twoFactor) { State = State with { Status = ConnectionStatus.TwoFactor, Message = "请输入双重验证码" }; Publish(); }
            else await ConnectedAsync(client, generation);
        }
        catch (OperationCanceledException) { }
        catch (Exception error) when (error is ApiException or IOException)
        { if (generation == _generation) Fail(error, true); }
    }

    public async Task VerifyAsync(string code)
    {
        if (_client is null || State.Status != ConnectionStatus.TwoFactor) return;
        var client = _client;
        var generation = _generation;
        try { await client.VerifyAsync(code, _sessionCancellation.Token); await ConnectedAsync(client, generation); }
        catch (OperationCanceledException) { }
        catch (ApiException error)
        { if (generation == _generation) { State = State with { Message = error.Message, Error = error.Message }; Publish(); } }
    }

    private async Task ConnectedAsync(Sub2ApiClient client, int generation)
    {
        if (generation != _generation) return;
        var accounts = await client.ListAccountsAsync(_sessionCancellation.Token);
        if (generation != _generation) return;
        var ids = State.Preferences.SelectedIds.Where(id => accounts.Any(a => a.Id == id)).ToArray();
        if (ids.Length == 0)
        {
            var preferred = accounts.Where(a => a.Platform is "anthropic" or "openai" && a.Type is "oauth" or "setup-token").ToArray();
            ids = (preferred.Length > 0 ? preferred : accounts).Take(2).Select(a => a.Id).ToArray();
        }
        State = State with { Accounts = accounts, Preferences = State.Preferences with { SelectedIds = ids },
            Quotas = accounts.Where(a => ids.Contains(a.Id)).Select(a => new AccountQuota(a)).ToArray(),
            Status = ConnectionStatus.Connected, Message = "已登录 · 管理员", Error = null };
        Schedule();
        Publish(true);
        await RefreshAsync();
    }

    private void CancelSession()
    {
        _generation++;
        _sessionCancellation.Cancel();
        _sessionCancellation.Dispose();
        _sessionCancellation = new();
        var old = _client;
        _client = null;
        _refresh = null;
        State = State with { Busy = false, NextRefresh = null };
        _vault.Clear();
        if (old is not null) _ = RetireAsync(old);
    }
    private static async Task RetireAsync(Sub2ApiClient client)
    {
        try { await client.LogoutAsync(); }
        finally { client.Dispose(); }
    }
    public void Logout()
    {
        CancelSession();
        State = State with { Preferences = State.Preferences with { Demo = false }, Status = ConnectionStatus.Disconnected,
            Message = "未登录", Accounts = [], Quotas = [], LastRefresh = null, Error = null };
        Publish(true);
    }

    public async Task UpdateAsync(Preferences settings)
    {
        var previous = State.Preferences;
        settings = settings.Normalize();
        var selectionChanged = !settings.SelectedIds.SequenceEqual(previous.SelectedIds);
        State = State with { Preferences = settings };
        if (settings.Demo != previous.Demo)
        {
            CancelSession();
            State = State with { Preferences = settings with { SelectedIds = [] } };
            if (settings.Demo) EnableDemo();
            else State = State with { Status = ConnectionStatus.Disconnected, Message = "未登录", Accounts = [], Quotas = [], LastRefresh = null, Error = null };
        }
        _client?.SetRemember(settings.RememberSession);
        if (selectionChanged)
        {
            _selectionVersion++;
            State = State with { Quotas = State.Preferences.Demo
                ? DemoQuotas(DateTimeOffset.UtcNow).Where(q => State.Preferences.SelectedIds.Contains(q.Account.Id)).ToArray()
                : Selected().Select(a => State.Quotas.FirstOrDefault(q => q.Account.Id == a.Id) ?? new AccountQuota(a)).ToArray() };
        }
        if (settings.AutoRefresh != previous.AutoRefresh || settings.RefreshSeconds != previous.RefreshSeconds) Schedule();
        Publish(true);
        if (selectionChanged && State.Status == ConnectionStatus.Connected)
        {
            if (_refresh is not null) await _refresh;
            await RefreshAsync();
        }
    }

    public Task PollAsync() => State.NextRefresh <= DateTimeOffset.UtcNow && !State.Busy ? RefreshAsync() : Task.CompletedTask;

    public async Task RefreshAsync()
    {
        if (_refresh is not null) { await _refresh; return; }
        if (State.Status is not (ConnectionStatus.Connected or ConnectionStatus.Demo)) return;
        var task = RefreshCoreAsync();
        _refresh = task;
        try { await task; }
        finally { if (ReferenceEquals(_refresh, task)) _refresh = null; }
    }

    private async Task RefreshCoreAsync()
    {
        var generation = _generation;
        var selection = _selectionVersion;
        var cancellation = _sessionCancellation.Token;
        State = State with { Busy = true };
        Publish();
        var delay = TimeSpan.Zero;
        try
        {
            if (State.Preferences.Demo)
                State = State with { Quotas = DemoQuotas(DateTimeOffset.UtcNow).Where(q => State.Preferences.SelectedIds.Contains(q.Account.Id)).ToArray(),
                    LastRefresh = DateTimeOffset.UtcNow, Error = null };
            else if (_client is not null)
            {
                var accounts = Selected();
                var result = await _client.UsagesAsync(accounts, cancellation);
                if (generation != _generation || selection != _selectionVersion) return;
                delay = result.RetryAfter;
                State = State with { Quotas = accounts.Select(a => result.Usage.TryGetValue(a.Id, out var quota) ? quota
                    : (State.Quotas.FirstOrDefault(q => q.Account.Id == a.Id) ?? new AccountQuota(a)) with
                        { Error = result.Errors.GetValueOrDefault(a.Id, "刷新失败") }).ToArray(),
                    Error = result.Errors.Count > 0 ? $"{result.Errors.Count} 个账号刷新失败" : null,
                    LastRefresh = result.Usage.Count > 0 ? DateTimeOffset.UtcNow : State.LastRefresh };
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception error) when (error is ApiException or IOException)
        {
            if (generation != _generation) return;
            if (error is ApiException api) delay = api.RetryAfter;
            if (delay < TimeSpan.FromSeconds(15)) delay = TimeSpan.FromSeconds(15);
            Fail(error);
        }
        finally
        {
            if (generation == _generation) { State = State with { Busy = false }; Schedule(delay); Publish(); }
        }
    }

    private void Fail(Exception error, bool auth = false)
    {
        var unauthorized = error is ApiException { Status: 401 or 403 };
        State = State with { Error = error.Message, Quotas = State.Quotas.Select(q => q with { Error = error.Message }).ToArray() };
        if (auth || unauthorized) State = State with { Status = error is ApiException { Status: 401 } ? ConnectionStatus.Expired : ConnectionStatus.Error,
            Message = error.Message, NextRefresh = null };
        if (unauthorized) _vault.Clear();
        Publish();
    }

    public void Dispose()
    {
        _generation++;
        _sessionCancellation.Cancel();
        _sessionCancellation.Dispose();
        _client?.Dispose();
    }
}
