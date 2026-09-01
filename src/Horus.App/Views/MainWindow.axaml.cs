using Avalonia.Controls;
using Avalonia.Input;
using Horus.App.ViewModels;

namespace Horus.App.Views;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
    }

    private void SensorRow_DoubleTapped(object? sender, TappedEventArgs eventArgs)
    {
        if (sender is not Control { DataContext: SensorRowViewModel { CanGraph: true } sensor })
        {
            return;
        }

        new SensorGraphWindow(sensor).Show(this);
        eventArgs.Handled = true;
    }
}
