# Liệt kê các vùng đất hình chữ nhật (4 đỉnh, góc vuông) trong ChucNangSuDungDat_A của một gdb — để soi "ô khoanh nhãn tên"
# còn sót (PyQGIS/GDAL, không chạy trong CI).
#
#   "E:\2. software\QGIS 4.2.1\bin\python-qgis.bat" scripts/gdb-rects.py <QuyHoach.gdb>
import os
import sys

os.environ['QT_QPA_PLATFORM'] = 'offscreen'
from qgis.core import QgsApplication, QgsVectorLayer

app = QgsApplication([], False)
app.initQgis()
lyr = QgsVectorLayer(f'{sys.argv[1]}|layername=ChucNangSuDungDat_A', 'r', 'ogr')
print('valid', lyr.isValid(), 'n', lyr.featureCount())
rows = []
for f in lyr.getFeatures():
    g = f.geometry()
    pts = g.asMultiPolygon()[0][0] if g.isMultipart() else g.asPolygon()[0]
    if len(pts) != 5:
        continue
    box = g.orientedMinimumBoundingBox()
    if g.area() / box[1] < 0.985:
        continue
    w, h = sorted((box[3], box[4]))
    c = g.centroid().asPoint()
    rows.append((str(f['phanLoai']), round(h), round(w), round(c.x()), round(c.y()), str(f['tenDoiTuong'] or '')[:30]))
for r in sorted(rows):
    print(' | '.join(map(str, r)))
print('rectangles', len(rows))
app.exitQgis()
