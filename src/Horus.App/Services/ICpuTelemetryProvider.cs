namespace Horus.App.Services;

public interface ICpuTelemetryProvider
{
    CpuDescription GetDescription();

    CpuLoadSnapshot ReadLoad();
}

