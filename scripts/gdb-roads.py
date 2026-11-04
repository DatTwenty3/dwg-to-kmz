# In tên + chiều dài các đoạn đường của MangLuoiGiaoThongDuongBo_L trong một gdb (PyQGIS/GDAL, không chạy trong CI).
#
#   "E:\2. software\QGIS 4.2.1\bin\python-qgis.bat" scripts/gdb-roads.py <QuyHoach.gdb> [tên chứa]
import os
import sys

os.environ['QT_QPA_PLATFORM'] = 'offscreen'
from qgis.core import QgsApplication, QgsVectorLayer

path = sys.argv[1]
needle = sys.argv[2].lower() if len(sys.argv) > 2 else ''
app = QgsApplication([], False)
app.initQgis()
lyr = QgsVectorLayer(f'{path}|layername=MangLuoiGiaoThongDuongBo_L', 'r', 'ogr')
print('valid', lyr.isValid(), 'n', lyr.featureCount())
tot = {}
for f in lyr.getFeatures():
    name = str(f['tenDuong'] or '')
    if needle and needle not in name.lower():
        continue
    tot.setdefault(name, []).append(round(f.geometry().length()))
    print(f['OBJECTID'], name, '| loai', f['loaiDuong'], '| cap', f['capDuong'], '| dai', round(f.geometry().length()))
print({k: (len(v), sum(v)) for k, v in tot.items()})
app.exitQgis()
