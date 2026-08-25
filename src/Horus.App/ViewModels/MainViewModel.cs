using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Horus.App.Models;
using Horus.App.Services;
using Avalonia.Threading;
using System.Collections.ObjectModel;
using System.Management;

namespace Horus.App.ViewModels;

public partial class MainViewModel : ViewModelBase
{
    public IReadOnlyList<string> TemperatureUnits { get; } = ["°C", "°F"];

    private readonly ISettingsService _settingsService;
    private readonly IStartupService _startupService;
    private readonly AppSettings _settings;
    private readonly ICpuTelemetryProvider? _cpuTelemetryProvider;
    private readonly DispatcherTimer _refreshTimer;
    private SensorRowViewModel? _totalLoadRow;
    private readonly List<SensorRowViewModel> _logicalLoadRows = [];
    private bool _isInitializing = true;
    private bool _isRefreshing;

    public ObservableCollection<SensorRowViewModel> Sensors { get; } = [];

    public MainViewModel()
        : this(new JsonSettingsService(), new WindowsStartupService())
    {
    }

    public MainViewModel(ISettingsService settingsService, IStartupService startupService)
    {
        _settingsService = settingsService;
        _startupService = startupService;
        _settings = settingsService.Load();

        StartWithWindows = startupService.IsSupported && startupService.IsEnabled();
        StartupSettingAvailable = startupService.IsSupported;
        _settings.StartWithWindows = StartWithWindows;

        if (OperatingSystem.IsWindows())
        {
            _cpuTelemetryProvider = new WindowsCpuTelemetryProvider();
            BuildProcessorRows(_cpuTelemetryProvider.GetDescription());
        }
        else
        {
            BuildProcessorRows(new CpuDescription("Unsupported platform", 0, Environment.ProcessorCount));
        }

        _refreshTimer = new DispatcherTimer(TimeSpan.FromSeconds(1), DispatcherPriority.Background, RefreshCpuReadings);
        _refreshTimer.Start();
        _isInitializing = false;
    }

    [ObservableProperty]
    public partial bool StartWithWindows { get; set; }

    [ObservableProperty]
    public partial bool StartupSettingAvailable { get; set; }

    [ObservableProperty]
    public partial string StatusMessage { get; set; } = "Live CPU load · Windows WMI/CIM user-mode provider";

    [ObservableProperty]
    public partial string SelectedTemperatureUnit { get; set; } = "°C";

    [ObservableProperty]
    public partial int AlertLogCount { get; set; }

    partial void OnStartWithWindowsChanged(bool value)
    {
        if (_isInitializing)
        {
            return;
        }

        try
        {
            _startupService.SetEnabled(value);
            _settings.StartWithWindows = value;
            _ = SaveSettingsAsync();
            StatusMessage = value
                ? "HORUS will start with Windows"
                : "Start with Windows disabled";
        }
        catch (Exception exception)
        {
            StatusMessage = $"Could not update the startup setting: {exception.Message}";
            _isInitializing = true;
            StartWithWindows = !value;
            _isInitializing = false;
        }
    }

    private async Task SaveSettingsAsync()
    {
        try
        {
            await _settingsService.SaveAsync(_settings);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            StatusMessage = $"Could not save settings: {exception.Message}";
        }
    }

    private void BuildProcessorRows(CpuDescription processor)
    {
        Sensors.Add(new SensorRowViewModel(
            processor.Name,
            $"Processor · {processor.PhysicalCoreCount} physical cores · {processor.LogicalProcessorCount} logical processors",
            isDevice: true));

        _totalLoadRow = new SensorRowViewModel(
            "CPU Total Load",
            "Average utilization across all logical processors",
            "%");
        Sensors.Add(_totalLoadRow);

        for (var index = 0; index < processor.LogicalProcessorCount; index++)
        {
            var row = new SensorRowViewModel(
                $"Logical Processor #{index + 1} Load",
                "Windows Processor Information counter",
                "%");
            _logicalLoadRows.Add(row);
            Sensors.Add(row);
        }
    }

    private async void RefreshCpuReadings(object? sender, EventArgs eventArgs)
    {
        if (_cpuTelemetryProvider is null || Sensors.Count == 0 || _isRefreshing)
        {
            return;
        }

        _isRefreshing = true;
        try
        {
            var snapshot = await Task.Run(_cpuTelemetryProvider.ReadLoad);
            _totalLoadRow?.UpdateValue(snapshot.Total);

            for (var index = 0; index < snapshot.LogicalProcessors.Count && index < _logicalLoadRows.Count; index++)
            {
                _logicalLoadRows[index].UpdateValue(snapshot.LogicalProcessors[index].Value);
            }
        }
        catch (ManagementException exception)
        {
            StatusMessage = $"CPU telemetry unavailable: {exception.Message}";
        }
        finally
        {
            _isRefreshing = false;
        }
    }

    [RelayCommand]
    private void ResetMinMax()
    {
        foreach (var sensor in Sensors.Where(sensor => !sensor.IsDevice))
        {
            sensor.ResetExtremes();
        }

        StatusMessage = "Minimum and maximum values reset";
    }
}
