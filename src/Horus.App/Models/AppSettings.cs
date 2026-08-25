namespace Horus.App.Models;

public sealed class AppSettings
{
    public bool StartWithWindows { get; set; }

    public List<TraySensorSettings> TraySensors { get; set; } = [];
}

public sealed class TraySensorSettings
{
    public required string SensorId { get; set; }

    public string Color { get; set; } = "#4CC2FF";
}

