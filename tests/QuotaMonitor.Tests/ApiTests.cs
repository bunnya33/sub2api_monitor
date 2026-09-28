using System.Net;
using System.Text;
using System.Text.Json;
using QuotaMonitor.Core;

namespace QuotaMonitor.Tests;

internal sealed class MemoryVault : ISessionVault
{
    public SavedSession? Session;
    public SavedSession? Load() => Session;
    public void Save(SavedSession session) => Session = session;
    public void Clear() => Session = null;
}

internal sealed class FixtureHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> handle) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => handle(request);
    internal static HttpResponseMessage Json(string json, HttpStatusCode code = HttpStatusCode.OK) =>
        new(code) { Content = new StringContent("{\"code\":0,\"data\":" + json + "}", Encoding.UTF8, "application/json") };
}

public class ApiTests
{
    [Fact]
    public async Task TwoFactorUses028FieldNamesAndPersistsOnlyAfterAdminCheck()
    {
        var vault = new MemoryVault();
        var verified = false;
        using var http = new HttpClient(new FixtureHandler(async request =>
        {
            var path = request.RequestUri!.AbsolutePath;
            if (path.EndsWith("/login")) return FixtureHandler.Json("{\"requires_2fa\":true,\"temp_token\":\"temporary\"}");
            if (path.EndsWith("/login/2fa"))
            {
                using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
                Assert.Equal("temporary", body.RootElement.GetProperty("temp_token").GetString());
                Assert.Equal("123456", body.RootElement.GetProperty("totp_code").GetString());
                Assert.Null(vault.Session);
                verified = true;
                return FixtureHandler.Json("{\"access_token\":\"access\",\"refresh_token\":\"refresh\"}");
            }
            Assert.True(verified);
            Assert.Equal("Bearer", request.Headers.Authorization!.Scheme);
            Assert.Null(vault.Session);
            return FixtureHandler.Json("{\"role\":\"admin\",\"email\":\"admin@example.com\"}");
        }));
        using var client = new Sub2ApiClient("https://example.invalid/", vault, true, http);
        Assert.True(await client.LoginAsync("admin@example.com", "password"));
        Assert.Null(vault.Session);
        await client.VerifyAsync("123456");
        Assert.Equal("refresh", vault.Session!.RefreshToken);
    }

    [Fact]
    public async Task NonAdminCannotPersistOrFetchUpstreamCredentials()
    {
        var vault = new MemoryVault();
        using var http = new HttpClient(new FixtureHandler(request => Task.FromResult(request.RequestUri!.AbsolutePath.EndsWith("/login")
            ? FixtureHandler.Json("{\"access_token\":\"access\",\"refresh_token\":\"refresh\"}") : FixtureHandler.Json("{\"role\":\"user\"}"))));
        using var client = new Sub2ApiClient("https://example.invalid", vault, true, http);
        var error = await Assert.ThrowsAsync<ApiException>(() => client.LoginAsync("user@example.com", "password"));
        Assert.Equal(403, error.Status);
        Assert.Null(vault.Session);
    }

    [Fact]
    public async Task Version028UsesPassiveClaudeAndCachedOpenAIWithoutBatchOrForce()
    {
        var paths = new List<string>();
        using var http = new HttpClient(new FixtureHandler(request =>
        {
            paths.Add(request.RequestUri!.PathAndQuery);
            return Task.FromResult(request.RequestUri.AbsolutePath.EndsWith("/login") ? FixtureHandler.Json("{\"access_token\":\"access\"}")
                : request.RequestUri.AbsolutePath.EndsWith("/me") ? FixtureHandler.Json("{\"role\":\"admin\"}")
                : FixtureHandler.Json("{\"five_hour\":{\"utilization\":32},\"seven_day\":{\"utilization\":58}}"));
        }));
        using var client = new Sub2ApiClient("https://example.invalid/api/v1", new MemoryVault(), false, http);
        await client.LoginAsync("admin@example.com", "password");
        var result = await client.UsagesAsync([new(1, "Claude", "anthropic", "oauth", "active"), new(2, "OpenAI", "openai", "oauth", "active")]);
        Assert.Equal(2, result.Usage.Count);
        Assert.Contains("/api/v1/admin/accounts/1/usage?source=passive&force=false", paths);
        Assert.Contains("/api/v1/admin/accounts/2/usage?source=active&force=false", paths);
        Assert.DoesNotContain(paths, path => path.Contains("batch") || path.Contains("force=true"));
    }

    [Fact]
    public async Task RateLimitSkipsRemainingRequestsAndPropagatesRetryAfter()
    {
        var usageCalls = 0;
        using var http = new HttpClient(new FixtureHandler(request =>
        {
            if (request.RequestUri!.AbsolutePath.EndsWith("/login")) return Task.FromResult(FixtureHandler.Json("{\"access_token\":\"access\"}"));
            if (request.RequestUri.AbsolutePath.EndsWith("/me")) return Task.FromResult(FixtureHandler.Json("{\"role\":\"admin\"}"));
            usageCalls++;
            var response = FixtureHandler.Json("{}", HttpStatusCode.TooManyRequests);
            response.Headers.RetryAfter = new(TimeSpan.FromSeconds(120));
            return Task.FromResult(response);
        }));
        using var client = new Sub2ApiClient("https://example.invalid", new MemoryVault(), false, http);
        await client.LoginAsync("admin@example.com", "password");
        var result = await client.UsagesAsync([new(1, "A", "anthropic", "oauth", "active"), new(2, "B", "openai", "oauth", "active")]);
        Assert.Equal(1, usageCalls);
        Assert.Equal(2, result.Errors.Count);
        Assert.Equal(TimeSpan.FromSeconds(120), result.RetryAfter);
    }

    [Fact]
    public async Task LateUnauthorizedResponsesUseAlreadyRefreshedToken()
    {
        var requests = 0;
        var refreshes = 0;
        var secondEntered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var firstRefreshed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var http = new HttpClient(new FixtureHandler(async request =>
        {
            var path = request.RequestUri!.AbsolutePath;
            if (path.EndsWith("/login")) return FixtureHandler.Json("{\"access_token\":\"old\",\"refresh_token\":\"refresh\"}");
            if (path.EndsWith("/me")) return FixtureHandler.Json("{\"role\":\"admin\"}");
            if (path.EndsWith("/refresh"))
            {
                Interlocked.Increment(ref refreshes);
                firstRefreshed.TrySetResult();
                return FixtureHandler.Json("{\"access_token\":\"new\",\"refresh_token\":\"rotated\"}");
            }
            if (request.Headers.Authorization!.Parameter == "old")
            {
                var current = Interlocked.Increment(ref requests);
                if (current == 1) await secondEntered.Task;
                else { secondEntered.TrySetResult(); await firstRefreshed.Task; await Task.Delay(20); }
                return FixtureHandler.Json("{}", HttpStatusCode.Unauthorized);
            }
            Assert.Equal("new", request.Headers.Authorization.Parameter);
            return FixtureHandler.Json("{\"items\":[],\"total\":0}");
        }));
        var vault = new MemoryVault();
        using var client = new Sub2ApiClient("https://example.invalid", vault, true, http);
        await client.LoginAsync("admin@example.com", "password");
        await Task.WhenAll(client.ListAccountsAsync(), client.ListAccountsAsync()).WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(1, refreshes);
        Assert.Equal("rotated", vault.Session!.RefreshToken);
    }

    [Theory]
    [InlineData("https://example.com/api/v1/", "https://example.com")]
    [InlineData("https://example.com/sub/", "https://example.com/sub")]
    public void ServerBasePathNormalizes(string input, string expected) => Assert.Equal(expected, Sub2ApiClient.NormalizeServer(input));
}
