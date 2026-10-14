# Building footprints (Google Open Buildings shapefile, VN-2000) -> PMTiles vector tiles for the map.
# One-time conversion with the GDAL that ships with QGIS (>= 3.8 writes PMTiles). Keeps only what the map needs:
#   a = footprint area (m2, integer) - the map derives the extruded height from it (src/lib/map/buildings.ts).
# Vinh Long (1.6 M buildings, zoom 13-15): ~70 MB, ~7 min.
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/buildings-to-pmtiles.ps1 <in.shp> <out.pmtiles> [minConfidence] [minZoom] [maxZoom]
param(
  [Parameter(Mandatory = $true)][string]$In,
  [Parameter(Mandatory = $true)][string]$Out,
  [double]$MinConfidence = 0,
  [int]$MinZoom = 13,
  [int]$MaxZoom = 15,
  [string]$QgisBin = 'E:\2. software\QGIS 4.2.1\bin'
)
$ErrorActionPreference = 'Stop'
$layer = [IO.Path]::GetFileNameWithoutExtension($In)
$sql = "SELECT GEOMETRY, CAST(area_in_me AS integer) AS a FROM `"$layer`" WHERE confidence >= $MinConfidence"
if (Test-Path $Out) { Remove-Item $Out }
$cmd = "call `"$QgisBin\o4w_env.bat`" >nul && ogr2ogr -f PMTiles `"$Out`" `"$In`" -dialect SQLite -sql `"$sql`" -nln nha -t_srs EPSG:3857 -dsco MINZOOM=$MinZoom -dsco MAXZOOM=$MaxZoom -progress"
cmd /c $cmd
if ($LASTEXITCODE -ne 0) { throw "ogr2ogr failed ($LASTEXITCODE)" }
'{0}: {1:N1} MB' -f $Out, ((Get-Item $Out).Length / 1MB)
