using Horus.App.ViewModels;

namespace Horus.App.Tests;

public sealed class SensorRowViewModelTests
{
    [Fact]
    public void UpdateValueTracksCurrentMinimumAndMaximum()
    {
        var sensor = new SensorRowViewModel("CPU Package Power", "Test sensor", "W");

        sensor.UpdateValue(42.5);
        sensor.UpdateValue(18.25);
        sensor.UpdateValue(67.75);

        Assert.Equal(67.75.ToString("F1"), sensor.Current);
        Assert.Equal(18.25.ToString("F1"), sensor.Minimum);
        Assert.Equal(67.75.ToString("F1"), sensor.Maximum);
        Assert.Equal("W", sensor.Unit);
    }

    [Fact]
    public void ChartKeepsOnlyTheLatestSixtySamples()
    {
        var sensor = new SensorRowViewModel("CPU Total Load", "Test sensor", "%");

        for (var value = 0; value < 75; value++)
        {
            sensor.UpdateValue(value);
        }

        Assert.Equal(60, sensor.ChartValues.Count);
        Assert.Equal(15, sensor.ChartValues[0].Value);
        Assert.Equal(74, sensor.ChartValues[^1].Value);
    }

    [Fact]
    public void ResetExtremesUsesTheCurrentValue()
    {
        var sensor = new SensorRowViewModel("GPU Power", "Test sensor", "W");
        sensor.UpdateValue(20);
        sensor.UpdateValue(80);
        sensor.UpdateValue(45);

        sensor.ResetExtremes();

        Assert.Equal(45d.ToString("F1"), sensor.Minimum);
        Assert.Equal(45d.ToString("F1"), sensor.Maximum);
    }

    [Fact]
    public void DeviceRowsCannotOpenGraphs()
    {
        var device = new SensorRowViewModel("Processor", "Device group", isDevice: true);

        Assert.False(device.CanGraph);
    }
}
