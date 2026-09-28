using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace QuotaMonitor.Desktop;

internal sealed record AppConfig(Preferences Preferences, string Server = "", string Email = "",
    double? X = null, double? Y = null, DockEdge Edge = DockEdge.None);

internal sealed class LocalStore : ISessionVault
{
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true, PropertyNameCaseInsensitive = true };
    public string DirectoryPath { get; }
    public LocalStore(string directory) { DirectoryPath = directory; Directory.CreateDirectory(directory); }
    public AppConfig LoadConfig()
    {
        var path = Path.Combine(DirectoryPath, "settings.json");
        try
        {
            if (!File.Exists(path)) return new(new());
            var config = JsonSerializer.Deserialize<AppConfig>(File.ReadAllText(path), Json);
            if (config?.Preferences is null) throw new JsonException();
            return config with { Preferences = config.Preferences.Normalize(), Edge = Enum.IsDefined(config.Edge) ? config.Edge : DockEdge.None,
                X = config.X is { } x && double.IsFinite(x) ? x : null, Y = config.Y is { } y && double.IsFinite(y) ? y : null };
        }
        catch (JsonException)
        {
            File.Copy(path, path + ".invalid-" + DateTime.UtcNow.ToString("yyyyMMddHHmmss"), true);
            return new(new());
        }
    }
    public void SaveConfig(AppConfig config) => AtomicWrite(Path.Combine(DirectoryPath, "settings.json"), JsonSerializer.SerializeToUtf8Bytes(config, Json));
    public SavedSession? Load()
    {
        var path = Path.Combine(DirectoryPath, "session.dpapi");
        if (!File.Exists(path)) return null;
        byte[]? plain = null;
        try
        {
            plain = Dpapi.Transform(File.ReadAllBytes(path), true);
            var session = JsonSerializer.Deserialize<SavedSession>(plain);
            if (session is null || string.IsNullOrWhiteSpace(session.Server) || string.IsNullOrWhiteSpace(session.RefreshToken)) return null;
            _ = Sub2ApiClient.NormalizeServer(session.Server);
            return session;
        }
        catch (Exception error) when (error is CryptographicException or JsonException or ApiException) { return null; }
        finally { if (plain is not null) CryptographicOperations.ZeroMemory(plain); }
    }
    public void Save(SavedSession session)
    {
        var plain = JsonSerializer.SerializeToUtf8Bytes(session);
        try { AtomicWrite(Path.Combine(DirectoryPath, "session.dpapi"), Dpapi.Transform(plain, false)); }
        finally { CryptographicOperations.ZeroMemory(plain); }
    }
    public void Clear()
    {
        var path = Path.Combine(DirectoryPath, "session.dpapi");
        if (File.Exists(path)) File.Delete(path);
    }
    private static void AtomicWrite(string path, byte[] bytes)
    {
        var temporary = path + ".tmp";
        File.WriteAllBytes(temporary, bytes);
        File.Move(temporary, path, true);
    }
}

internal static class Dpapi
{
    [StructLayout(LayoutKind.Sequential)] private struct Blob { public int Length; public nint Data; }
    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CryptProtectData(ref Blob input, string description, ref Blob entropy, nint reserved, nint prompt, uint flags, out Blob output);
    [DllImport("crypt32.dll", SetLastError = true)]
    private static extern bool CryptUnprotectData(ref Blob input, nint description, ref Blob entropy, nint reserved, nint prompt, uint flags, out Blob output);
    [DllImport("kernel32.dll")] private static extern nint LocalFree(nint memory);
    internal static byte[] Transform(byte[] data, bool decrypt)
    {
        var input = new Blob { Length = data.Length, Data = Marshal.AllocHGlobal(data.Length) };
        var salt = Encoding.UTF8.GetBytes("Sub2APIQuotaMonitor/session/v1");
        var entropy = new Blob { Length = salt.Length, Data = Marshal.AllocHGlobal(salt.Length) };
        Blob output = default;
        try
        {
            Marshal.Copy(data, 0, input.Data, data.Length);
            Marshal.Copy(salt, 0, entropy.Data, salt.Length);
            var success = decrypt ? CryptUnprotectData(ref input, 0, ref entropy, 0, 0, 1, out output)
                : CryptProtectData(ref input, "Quota Monitor", ref entropy, 0, 0, 1, out output);
            if (!success) throw new CryptographicException(Marshal.GetLastWin32Error());
            var result = new byte[output.Length];
            Marshal.Copy(output.Data, result, 0, result.Length);
            return result;
        }
        finally
        {
            Marshal.Copy(new byte[data.Length], 0, input.Data, data.Length);
            Marshal.FreeHGlobal(input.Data);
            Marshal.FreeHGlobal(entropy.Data);
            if (output.Data != 0) LocalFree(output.Data);
        }
    }
}
