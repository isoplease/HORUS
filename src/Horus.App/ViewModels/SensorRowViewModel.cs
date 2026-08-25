using CommunityToolkit.Mvvm.ComponentModel;

namespace Horus.App.ViewModels;

public partial class SensorRowViewModel : ViewModelBase
{
    private double? _currentValue;
    private double? _minimumValue;
    private double? _maximumValue;

    public SensorRowViewModel(
        string name,
        string description,
        string unit = "",
        bool isDevice = false)
    {
        Name = name;
        Description = description;
        Unit = unit;
        IsDevice = isDevice;
    }

    public string Name { get; }

    public string Description { get; }

    public bool IsDevice { get; }

    public string Prefix => IsDevice ? "▾" : "↳";

    public string Unit { get; }

    [ObservableProperty]
    public partial string Current { get; set; } = "—";

    [ObservableProperty]
    public partial string Minimum { get; set; } = "—";

    [ObservableProperty]
    public partial string Maximum { get; set; } = "—";

    public void UpdateValue(double value)
    {
        _currentValue = value;
        _minimumValue = _minimumValue.HasValue ? Math.Min(_minimumValue.Value, value) : value;
        _maximumValue = _maximumValue.HasValue ? Math.Max(_maximumValue.Value, value) : value;
        UpdateDisplayValues();
    }

    public void ResetExtremes()
    {
        _minimumValue = _currentValue;
        _maximumValue = _currentValue;
        UpdateDisplayValues();
    }

    private void UpdateDisplayValues()
    {
        Current = Format(_currentValue);
        Minimum = Format(_minimumValue);
        Maximum = Format(_maximumValue);
    }

    private static string Format(double? value) => value.HasValue ? $"{value.Value:F1}" : "—";
}
