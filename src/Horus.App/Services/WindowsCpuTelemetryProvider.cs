using System.Globalization;
using System.Management;
using System.Runtime.Versioning;

namespace Horus.App.Services;

[SupportedOSPlatform("windows")]
public sealed class WindowsCpuTelemetryProvider : ICpuTelemetryProvider
{
    public CpuDescription GetDescription()
    {
        using var searcher = new ManagementObjectSearcher(
            "root\\CIMV2",
            "SELECT Name, NumberOfCores, NumberOfLogicalProcessors FROM Win32_Processor");

        var names = new List<string>();
        var physicalCores = 0;
        var logicalProcessors = 0;

        foreach (ManagementObject processor in searcher.Get())
        {
            names.Add(NormalizeName(Convert.ToString(processor["Name"], CultureInfo.InvariantCulture)));
            physicalCores += Convert.ToInt32(processor["NumberOfCores"], CultureInfo.InvariantCulture);
            logicalProcessors += Convert.ToInt32(processor["NumberOfLogicalProcessors"], CultureInfo.InvariantCulture);
        }

        return new CpuDescription(
            names.Count == 0 ? "Unknown processor" : string.Join(" + ", names.Distinct()),
            physicalCores,
            logicalProcessors);
    }

    public CpuLoadSnapshot ReadLoad()
    {
        using var searcher = new ManagementObjectSearcher(
            "root\\CIMV2",
            "SELECT Name, PercentProcessorTime FROM Win32_PerfFormattedData_Counters_ProcessorInformation");

        var total = 0d;
        var logicalProcessors = new List<LogicalProcessorLoad>();

        foreach (ManagementObject sample in searcher.Get())
        {
            var name = Convert.ToString(sample["Name"], CultureInfo.InvariantCulture) ?? string.Empty;
            var load = Math.Clamp(
                Convert.ToDouble(sample["PercentProcessorTime"], CultureInfo.InvariantCulture),
                0,
                100);

            if (name == "_Total")
            {
                total = load;
                continue;
            }

            var parts = name.Split(',');
            if (parts.Length == 2 &&
                int.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var group) &&
                int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var number))
            {
                logicalProcessors.Add(new LogicalProcessorLoad(group, number, load));
            }
        }

        return new CpuLoadSnapshot(
            total,
            logicalProcessors.OrderBy(item => item.Group).ThenBy(item => item.Number).ToArray());
    }

    private static string NormalizeName(string? name)
    {
        return string.Join(' ', (name ?? string.Empty)
            .Replace("(R)", string.Empty, StringComparison.Ordinal)
            .Replace("(TM)", string.Empty, StringComparison.Ordinal)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }
}

