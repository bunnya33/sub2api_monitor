using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace QuotaMonitor.Core;

public sealed class ApiException(string message, int status = 0, TimeSpan retryAfter = default) : Exception(message)
{
    public int Status { get; } = status;
    public TimeSpan RetryAfter { get; } = retryAfter;
}

public sealed record UsageResult(IReadOnlyDictionary<int, AccountQuota> Usage, IReadOnlyDictionary<int, string> Errors, TimeSpan RetryAfter);

public sealed class Sub2ApiClient : IDisposable
{
    private readonly HttpClient _http;
    private readonly bool _ownsHttp;
    private readonly ISessionVault _vault;
    private readonly SemaphoreSlim _tokenLock = new(1);
    private string _accessToken = "", _refreshToken = "", _temporaryToken = "", _email = "";
    private DateTimeOffset _expiresAt = DateTimeOffset.MaxValue;
    private bool _remember, _authorized;
    public string Server { get; }

    public Sub2ApiClient(string server, ISessionVault vault, bool remember, HttpClient? http = null)
    {
        Server = NormalizeServer(server);
        _vault = vault;
        _remember = remember;
        _ownsHttp = http is null;
        _http = http ?? new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = Timeout.InfiniteTimeSpan };
    }

    public static string NormalizeServer(string value)
    {
        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri) || uri.Scheme is not ("https" or "http")
            || uri.UserInfo.Length > 0 || uri.Query.Length > 0 || uri.Fragment.Length > 0)
            throw new ApiException("请输入完整的 HTTP 或 HTTPS 服务器地址，不能包含密码或查询参数");
        var path = uri.AbsolutePath.TrimEnd('/');
        if (path.EndsWith("/api/v1", StringComparison.Ordinal)) path = path[..^7];
        return uri.GetLeftPart(UriPartial.Authority) + path;
    }

    private async Task<JsonElement> RawAsync(string path, object? body, string? token, CancellationToken cancellation)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        deadline.CancelAfter(TimeSpan.FromSeconds(20));
        using var request = new HttpRequestMessage(body is null ? HttpMethod.Get : HttpMethod.Post, Server + "/api/v1" + path);
        request.Headers.Accept.Add(new("application/json"));
        if (token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (body is not null) request.Content = JsonContent.Create(body);
        try
        {
            using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            using var input = await response.Content.ReadAsStreamAsync(deadline.Token);
            using var buffer = new MemoryStream();
            var block = new byte[8192];
            int read;
            while ((read = await input.ReadAsync(block, deadline.Token)) > 0)
            {
                if (buffer.Length + read > 4 * 1024 * 1024) throw new ApiException("服务器响应过大");
                buffer.Write(block, 0, read);
            }
            JsonElement root = default;
            try
            {
                using var document = JsonDocument.Parse(buffer.ToArray());
                root = document.RootElement.Clone();
            }
            catch (JsonException) when (!response.IsSuccessStatusCode) { }
            catch (JsonException) { throw new ApiException("服务器没有返回 JSON，请检查地址是否指向 sub2api"); }
            var code = root.ValueKind == JsonValueKind.Object && root.TryGetProperty("code", out var c)
                && c.ValueKind == JsonValueKind.Number && c.TryGetInt32(out var n) ? n : 0;
            if (!response.IsSuccessStatusCode || code is not (0 or 200))
            {
                var retry = response.Headers.RetryAfter;
                var delay = retry?.Delta ?? (retry?.Date is { } date ? date - DateTimeOffset.UtcNow : TimeSpan.Zero);
                throw new ApiException(Text(root, "message") ?? $"请求失败 ({(int)response.StatusCode})",
                    (int)response.StatusCode, delay > TimeSpan.Zero ? delay : TimeSpan.Zero);
            }
            if (root.ValueKind != JsonValueKind.Object) throw new ApiException("服务器响应格式错误");
            return root.TryGetProperty("data", out var data) ? data.Clone() : root;
        }
        catch (OperationCanceledException) when (!cancellation.IsCancellationRequested) { throw new ApiException("请求超时，请检查服务器和网络"); }
        catch (HttpRequestException) { throw new ApiException("无法连接服务器，请检查地址、网络和 HTTPS 证书"); }
    }

    private void AcceptTokens(JsonElement data)
    {
        _accessToken = Text(data, "access_token") ?? throw new ApiException("登录响应缺少访问令牌");
        if (_accessToken.Length == 0) throw new ApiException("登录响应包含空访问令牌");
        _refreshToken = Text(data, "refresh_token") ?? _refreshToken;
        _expiresAt = Number(data, "expires_in") is { } seconds && seconds > 0 && seconds < 31536000
            ? DateTimeOffset.UtcNow.AddSeconds(seconds) : DateTimeOffset.MaxValue;
    }

    private void Persist()
    {
        if (!_authorized) return;
        if (_remember && _refreshToken.Length > 0) _vault.Save(new(Server, _email, _refreshToken));
        else _vault.Clear();
    }

    private async Task AuthorizeAsync(CancellationToken cancellation)
    {
        var user = await RequestAsync("/auth/me", null, cancellation);
        if (Text(user, "role") != "admin")
        {
            _accessToken = _refreshToken = "";
            _vault.Clear();
            throw new ApiException("该账号没有管理员权限，无法读取上游账号额度", 403);
        }
        _email = Text(user, "email") ?? _email;
        _authorized = true;
        Persist();
    }

    public async Task<bool> LoginAsync(string email, string password, CancellationToken cancellation = default)
    {
        _email = email.Trim();
        if (_email.Length == 0 || password.Length == 0) throw new ApiException("请填写邮箱和密码");
        var data = await RawAsync("/auth/login", new { email = _email, password }, null, cancellation);
        if (data.ValueKind != JsonValueKind.Object) throw new ApiException("服务器登录响应格式错误");
        if (data.TryGetProperty("requires_2fa", out var required) && required.ValueKind == JsonValueKind.True)
        {
            _temporaryToken = Text(data, "temp_token") ?? throw new ApiException("验证响应缺少临时令牌");
            return true;
        }
        AcceptTokens(data);
        await AuthorizeAsync(cancellation);
        return false;
    }

    public async Task VerifyAsync(string code, CancellationToken cancellation = default)
    {
        if (_temporaryToken.Length == 0) throw new ApiException("验证会话已失效，请重新登录");
        if (code.Length != 6 || code.Any(c => c is < '0' or > '9')) throw new ApiException("请输入 6 位验证码");
        var data = await RawAsync("/auth/login/2fa", new { temp_token = _temporaryToken, totp_code = code }, null, cancellation);
        AcceptTokens(data);
        await AuthorizeAsync(cancellation);
        _temporaryToken = "";
    }

    public async Task RestoreAsync(SavedSession session, CancellationToken cancellation = default)
    {
        _email = session.Email;
        _refreshToken = session.RefreshToken;
        await RefreshTokensAsync(_accessToken, cancellation);
        await AuthorizeAsync(cancellation);
    }

    private async Task RefreshTokensAsync(string attemptedToken, CancellationToken cancellation)
    {
        await _tokenLock.WaitAsync(cancellation);
        try
        {
            // Late 401 responses reuse the token already renewed by another request.
            if (_accessToken != attemptedToken) return;
            if (_refreshToken.Length == 0) throw new ApiException("登录已过期，请重新登录", 401);
            AcceptTokens(await RawAsync("/auth/refresh", new { refresh_token = _refreshToken }, null, cancellation));
            Persist();
        }
        finally { _tokenLock.Release(); }
    }

    private async Task<JsonElement> RequestAsync(string path, object? body, CancellationToken cancellation)
    {
        if (_expiresAt <= DateTimeOffset.UtcNow.AddSeconds(15)) await RefreshTokensAsync(_accessToken, cancellation);
        var attemptedToken = _accessToken;
        try { return await RawAsync(path, body, attemptedToken, cancellation); }
        catch (ApiException error) when (error.Status == 401 && _refreshToken.Length > 0)
        {
            await RefreshTokensAsync(attemptedToken, cancellation);
            return await RawAsync(path, body, _accessToken, cancellation);
        }
    }

    public async Task<IReadOnlyList<Account>> ListAccountsAsync(CancellationToken cancellation = default)
    {
        var accounts = new List<Account>();
        for (var page = 1; page <= 100; page++)
        {
            var data = await RequestAsync($"/admin/accounts?page={page}&page_size=100&lite=true", null, cancellation);
            if (data.ValueKind != JsonValueKind.Object || !data.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array)
                throw new ApiException("无法识别服务器返回的账号列表");
            foreach (var item in items.EnumerateArray())
            {
                if (!item.TryGetProperty("id", out var id) || !id.TryGetInt32(out var value) || value <= 0) continue;
                // Credentials in the administrator response are deliberately excluded from this model.
                accounts.Add(new(value, Text(item, "name") ?? $"账号 {value}", Text(item, "platform") ?? "unknown",
                    Text(item, "type") ?? "unknown", Text(item, "status") ?? "unknown"));
            }
            if (items.GetArrayLength() == 0 || (Number(data, "total") is { } total && accounts.Count >= total)) return accounts;
        }
        throw new ApiException("账号数量超过客户端分页限制");
    }

    public async Task<UsageResult> UsagesAsync(IReadOnlyList<Account> accounts, CancellationToken cancellation = default)
    {
        var usage = new Dictionary<int, AccountQuota>();
        var errors = new Dictionary<int, string>();
        var delay = TimeSpan.Zero;
        // sub2api 0.2.8 has individual usage endpoints. Keep requests bounded and honor rate limits.
        foreach (var account in accounts)
        {
            if (delay > TimeSpan.Zero) { errors[account.Id] = "服务器限流，本轮暂缓读取"; continue; }
            try
            {
                var source = account.Platform == "anthropic" && account.Type is "oauth" or "setup-token" ? "passive" : "active";
                var data = await RequestAsync($"/admin/accounts/{account.Id}/usage?source={source}&force=false", null, cancellation);
                var quota = MapUsage(account, data, DateTimeOffset.UtcNow);
                if (quota.Error is not null) errors[account.Id] = quota.Error;
                else usage[account.Id] = quota;
            }
            catch (ApiException error) when (error.Status is not (401 or 403))
            {
                errors[account.Id] = error.Message;
                if (error.Status == 429) delay = error.RetryAfter > TimeSpan.Zero ? error.RetryAfter : TimeSpan.FromSeconds(30);
            }
        }
        return new(usage, errors, delay);
    }

    public static AccountQuota MapUsage(Account account, JsonElement data, DateTimeOffset now)
    {
        if (data.ValueKind != JsonValueKind.Object) throw new ApiException("无法识别服务器额度格式");
        QuotaWindow? Window(string property)
        {
            if (!data.TryGetProperty(property, out var window) || Number(window, "utilization") is not { } used || used < 0) return null;
            var resetsAt = Date(window, "resets_at");
            if (resetsAt is null && Number(window, "remaining_seconds") is { } seconds && seconds >= 0 && seconds < 31536000)
                resetsAt = now.AddSeconds(seconds);
            return new(used, resetsAt);
        }
        return new(account, Window("five_hour"), Window("seven_day"), Text(data, "source") ?? "snapshot",
            Date(data, "updated_at"), now, Text(data, "error") is { Length: > 0 } error ? error : null);
    }

    private static DateTimeOffset? Date(JsonElement data, string key) => DateTimeOffset.TryParse(Text(data, key),
        CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var date) ? date : null;
    private static string? Text(JsonElement data, string key) => data.ValueKind == JsonValueKind.Object
        && data.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    private static double? Number(JsonElement data, string key) => data.ValueKind == JsonValueKind.Object
        && data.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.Number
        && value.TryGetDouble(out var number) && double.IsFinite(number) ? number : null;

    public void SetRemember(bool remember) { _remember = remember; Persist(); }
    public async Task LogoutAsync()
    {
        var token = _refreshToken;
        _accessToken = _refreshToken = _temporaryToken = "";
        _authorized = false;
        _vault.Clear();
        if (token.Length == 0) return;
        try { await RawAsync("/auth/logout", new { refresh_token = token }, null, CancellationToken.None); }
        catch (Exception error) when (error is ApiException or OperationCanceledException) { }
    }
    public void Dispose() { if (_ownsHttp) _http.Dispose(); }
}
