namespace Horus.App.Services;

public interface IStartupService
{
    bool IsSupported { get; }

    bool IsEnabled();

    void SetEnabled(bool enabled);
}

