using Microsoft.Win32;

namespace Horus.App.Services;

public sealed class WindowsStartupService : IStartupService
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "HORUS";

    public bool IsSupported => OperatingSystem.IsWindows();

    public bool IsEnabled()
    {
        if (!OperatingSystem.IsWindows())
        {
            return false;
        }

        using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath);
        return key?.GetValue(ValueName) is string value &&
               string.Equals(value, GetCommand(), StringComparison.OrdinalIgnoreCase);
    }

    public void SetEnabled(bool enabled)
    {
        if (!OperatingSystem.IsWindows())
        {
            return;
        }

        using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath, true);
        if (enabled)
        {
            key.SetValue(ValueName, GetCommand(), RegistryValueKind.String);
        }
        else
        {
            key.DeleteValue(ValueName, false);
        }
    }

    private static string GetCommand()
    {
        var executablePath = Environment.ProcessPath
            ?? throw new InvalidOperationException("The application path could not be determined.");
        return $"\"{executablePath}\" --background";
    }
}
