using Avalonia.Controls;
using Horus.App.ViewModels;

namespace Horus.App.Views;

public partial class SensorGraphWindow : Window
{
    public SensorGraphWindow()
    {
        InitializeComponent();
    }

    public SensorGraphWindow(SensorRowViewModel sensor)
        : this()
    {
        DataContext = sensor;
        Title = $"{sensor.Name} — HORUS";
    }
}
