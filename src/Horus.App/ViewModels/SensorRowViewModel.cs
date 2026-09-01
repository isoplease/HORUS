using CommunityToolkit.Mvvm.ComponentModel;
using LiveChartsCore;
using LiveChartsCore.Defaults;
using LiveChartsCore.SkiaSharpView;
using System.Collections.ObjectModel;

namespace Horus.App.ViewModels;

public partial class SensorRowViewModel : ViewModelBase
{
    private const int MaximumChartPoints = 60;
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

        ChartValues = [];
        Series =
        [
            new LineSeries<DateTimePoint>
            {
                Name = name,
                Values = ChartValues,
                Fill = null,
                GeometrySize = 0,
                LineSmoothness = 0,
                AnimationsSpeed = TimeSpan.FromMilliseconds(150),
            },
        ];

        XAxes =
        [
            new Axis
            {
                Labeler = value => new DateTime((long)value).ToString("HH:mm:ss"),
                UnitWidth = TimeSpan.FromSeconds(1).Ticks,
                MinStep = TimeSpan.FromSeconds(10).Ticks,
            },
        ];

        YAxes =
        [
            new Axis
            {
                Name = string.IsNullOrWhiteSpace(unit) ? "Value" : unit,
                MinLimit = unit == "%" ? 0 : null,
                MaxLimit = unit == "%" ? 100 : null,
                Labeler = value => $"{value:F1}",
            },
        ];
    }

    public string Name { get; }

    public string Description { get; }

    public bool IsDevice { get; }

    public string Prefix => IsDevice ? "▾" : "↳";

    public string Unit { get; }

    public bool CanGraph => !IsDevice;

    public ObservableCollection<DateTimePoint> ChartValues { get; }

    public IReadOnlyList<ISeries> Series { get; }

    public IReadOnlyList<Axis> XAxes { get; }

    public IReadOnlyList<Axis> YAxes { get; }

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
        ChartValues.Add(new DateTimePoint(DateTime.Now, value));
        while (ChartValues.Count > MaximumChartPoints)
        {
            ChartValues.RemoveAt(0);
        }

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
