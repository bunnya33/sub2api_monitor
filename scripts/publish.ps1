param([switch]$FrameworkDependent)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$projectPath = Join-Path $projectRoot 'src\QuotaMonitor.Desktop\QuotaMonitor.Desktop.csproj'
$outputPath = Join-Path $projectRoot 'release\win-x64'
if ($FrameworkDependent) {
    dotnet publish $projectPath -c Release -r win-x64 --self-contained false -o $outputPath
} else {
    dotnet publish $projectPath -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o $outputPath
}
if ($LASTEXITCODE -ne 0) { throw 'Publish failed.' }
Write-Output (Join-Path $outputPath 'Sub2APIQuotaMonitor.exe')
