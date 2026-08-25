using Horus.App.Models;

namespace Horus.App.Services;

public interface ISettingsService
{
    AppSettings Load();

    Task SaveAsync(AppSettings settings, CancellationToken cancellationToken = default);
}

