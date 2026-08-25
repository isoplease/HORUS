namespace Horus.App.Services;

public sealed record CpuDescription(string Name, int PhysicalCoreCount, int LogicalProcessorCount);

public sealed record LogicalProcessorLoad(int Group, int Number, double Value);

public sealed record CpuLoadSnapshot(double Total, IReadOnlyList<LogicalProcessorLoad> LogicalProcessors);

