# Kiểm tra tệp tổng hợp .qgz của HoSoGIS bằng QGIS thật (PyQGIS). Không chạy trong CI.
#
#   "E:\2. software\QGIS 4.2.1\bin\python-qgis.bat" scripts/qgz-check.py <HoSoGIS\<tên>.qgz> <thư mục ảnh>
#
# In JSON: project đọc được không, hệ tọa độ có hợp lệ + từng lớp có hợp lệ và CÙNG hệ với project không, phạm vi lớp,
# diện tích ranh, chữ biển số tuyến (911, 914, 914C, 915…) và số chấm ranh trong nhóm "Bản vẽ CAD" (cad_chu, cad_diem), khoảng
# cách chấm → ranh (phải ≈ 0), số nét rộng 5 m, bố cục in có xuất được không. Ghi render_full.png / render_zoom.png / layout.png.
# Trên nền "offscreen" chữ hiện thành ô vuông vì thiếu font — không phải lỗi dữ liệu.
import json
import os
import sys

os.environ['QT_QPA_PLATFORM'] = 'offscreen'
from qgis.core import (QgsApplication, QgsGeometry, QgsLayoutExporter, QgsMapRendererParallelJob, QgsMapSettings, QgsProject,
                       QgsRectangle, QgsVectorLayer, QgsWkbTypes)
from qgis.PyQt.QtCore import QSize
from qgis.PyQt.QtGui import QColor

qgz, outdir = sys.argv[1], sys.argv[2]
os.makedirs(outdir, exist_ok=True)
app = QgsApplication([], False)
app.initQgis()
prj = QgsProject()
ok = prj.read(qgz)
res = {'read': ok, 'crs_valid': prj.crs().isValid(), 'crs': prj.crs().description(), 'crs_authid': prj.crs().authid()}
layers = {}
for lyr in prj.mapLayers().values():
    info = {'valid': lyr.isValid(), 'crs_same': lyr.crs() == prj.crs()}
    if lyr.isValid() and isinstance(lyr, QgsVectorLayer):
        info['n'] = lyr.featureCount()
        e = lyr.extent()
        info['extent'] = [round(e.xMinimum()), round(e.yMinimum()), round(e.xMaximum()), round(e.yMaximum())] if not e.isEmpty() else None
    layers[lyr.name()[:60] + ' | ' + lyr.source().split('|')[-1][:40]] = info
res['layers'] = layers
res['bad_layers'] = [k for k, v in layers.items() if not v['valid']]
res['layers_other_crs'] = [k for k, v in layers.items() if not v['crs_same']]

ranh = None
for l in prj.mapLayers().values():
    if 'RanhGioiQuyHoach_A' in l.source() and 'QuyHoach' in l.source():
        ranh = l
        break
rb = None
if ranh is not None and ranh.isValid():
    rb = QgsGeometry.unaryUnion([f.geometry() for f in ranh.getFeatures()])
    res['ranh_area_ha'] = round(rb.area() / 1e4)

SIGNS = ('911', '914', '914B', '914C', '915', '915C', 'QL54', 'QL60')
for l in prj.mapLayers().values():
    src = l.source()
    if not l.isValid() or not isinstance(l, QgsVectorLayer):
        continue
    if 'layername=cad_chu' in src:
        sign = {}
        for f in l.getFeatures():
            t = str(f['chu']).strip()
            if t in SIGNS:
                sign[t] = sign.get(t, 0) + 1
        res['cad_chu_n'] = l.featureCount()
        res['cad_chu_signs'] = sign
    if 'layername=cad_diem' in src:
        dots = [f for f in l.getFeatures() if f['kt'] and float(f['kt']) > 0]
        res['cad_diem_n'] = l.featureCount()
        res['cad_dots'] = len(dots)
        if rb is not None and dots:
            bnd = QgsGeometry(rb.constGet().boundary()) if rb.type() == QgsWkbTypes.PolygonGeometry else rb
            ds = sorted(bnd.distance(f.geometry()) for f in dots)
            res['dots_dist_to_ranh'] = {'median': round(ds[len(ds) // 2], 2), 'p90': round(ds[int(len(ds) * .9)], 2), 'max': round(ds[-1], 1)}
    if 'layername=cad_duong' in src:
        res['cad_duong_n'] = l.featureCount()
        res['cad_duong_rong5'] = len([f for f in l.getFeatures() if f['rong'] and 4.9 <= float(f['rong']) <= 5.1])

root = prj.layerTreeRoot()
res['tree_top'] = [c.name() for c in root.children()]
lm = prj.layoutManager()
res['layouts'] = [l.name() for l in lm.layouts()]
for lay in lm.layouts():
    s = QgsLayoutExporter.ImageExportSettings()
    s.dpi = 20
    p = os.path.join(outdir, 'layout.png')
    r = QgsLayoutExporter(lay).exportToImage(p, s)
    res['layout_export'] = 'OK' if r == QgsLayoutExporter.Success else f'FAIL {r}'
    break

ext = ranh.extent() if ranh is not None and ranh.isValid() else prj.viewSettings().fullExtent()
ext.scale(1.05)
ms = QgsMapSettings()
ms.setDestinationCrs(prj.crs())
ms.setLayers([n.layer() for n in root.findLayers() if n.isVisible() and n.layer() and n.layer().isValid()])
ms.setExtent(ext)
ms.setOutputSize(QSize(2000, int(2000 * ext.height() / ext.width())))
ms.setBackgroundColor(QColor('white'))
job = QgsMapRendererParallelJob(ms)
job.start()
job.waitForFinished()
job.renderedImage().save(os.path.join(outdir, 'render_full.png'))
c = ext.center()
ms.setExtent(QgsRectangle(c.x() - 1500, c.y() - 1000, c.x() + 1500, c.y() + 1000))
ms.setOutputSize(QSize(2000, 1333))
job = QgsMapRendererParallelJob(ms)
job.start()
job.waitForFinished()
job.renderedImage().save(os.path.join(outdir, 'render_zoom.png'))
print(json.dumps(res, ensure_ascii=False, indent=1))
app.exitQgis()
