# Đếm vùng và diện tích (ha) theo phanLoai của ChucNangSuDungDat_A trong một gdb (PyQGIS, không chạy trong CI).
#
#   "E:\2. software\QGIS 4.2.1\bin\python-qgis.bat" scripts/gdb-landuse.py <QuyHoach.gdb>
import os
import sys

os.environ['QT_QPA_PLATFORM'] = 'offscreen'
from qgis.core import QgsApplication, QgsVectorLayer

app = QgsApplication([], False)
app.initQgis()
lyr = QgsVectorLayer(f'{sys.argv[1]}|layername=ChucNangSuDungDat_A', 'r', 'ogr')
agg = {}
for f in lyr.getFeatures():
    k = str(f['phanLoai'])
    n, a = agg.get(k, (0, 0.0))
    agg[k] = (n + 1, a + f.geometry().area() / 1e4)
tot = 0.0
for k, (n, a) in sorted(agg.items(), key=lambda x: -x[1][1]):
    print(f'{n:5d} | {a:9.1f} ha | {k}')
    tot += a
print('tong', sum(n for n, _ in agg.values()), 'vung', round(tot, 1), 'ha')
app.exitQgis()
