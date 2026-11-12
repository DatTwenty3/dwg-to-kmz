# Overlaps between polygons of the SAME class and SAME phanLoai in a geodatabase (PyQGIS):
#   "E:\2. software\QGIS 4.2.1\bin\python-qgis.bat" scripts\gdb-overlaps.py <X.gdb> [layer ...]
# Prints, per layer and phanLoai, how many pairs overlap by more than 1 m2, how much area overlaps, and how the pairs split into
# "contained" (the smaller lies >= 95 % inside the other: a duplicate or a patch), "partial" and "touching" (< 1 m2, only the edge).
import sys

from qgis.core import QgsApplication, QgsSpatialIndex, QgsVectorLayer, QgsWkbTypes

QgsApplication.setPrefixPath('', True)
app = QgsApplication([], False)
app.initQgis()

path = sys.argv[1]
wanted = set(sys.argv[2:])
probe = QgsVectorLayer(path, 'probe', 'ogr')
names = [s.split('!!::!!')[1] for s in probe.dataProvider().subLayers()] if probe.isValid() else []
for name in names:
    if wanted and name not in wanted:
        continue
    lyr = QgsVectorLayer(f'{path}|layername={name}', name, 'ogr')
    if not lyr.isValid() or QgsWkbTypes.geometryType(lyr.wkbType()) != QgsWkbTypes.PolygonGeometry:
        continue
    fields = [f.name() for f in lyr.fields()]
    if 'phanLoai' not in fields or lyr.featureCount() == 0:
        continue
    feats = {f.id(): f for f in lyr.getFeatures()}
    idx = QgsSpatialIndex()
    for f in feats.values():
        idx.addFeature(f)
    stats = {}
    for fid, f in feats.items():
        g = f.geometry()
        if g.isNull() or not g.isGeosValid():
            g = g.makeValid()
        pl = f['phanLoai'] or ''
        for oid in idx.intersects(g.boundingBox()):
            if oid <= fid:
                continue
            o = feats[oid]
            if (o['phanLoai'] or '') != pl:
                continue
            og = o.geometry()
            if not og.isGeosValid():
                og = og.makeValid()
            inter = g.intersection(og)
            a = inter.area() if not inter.isNull() else 0.0
            s = stats.setdefault(pl, {'pairs': 0, 'contained': 0, 'partial': 0, 'touch': 0, 'area': 0.0})
            if a < 1.0:
                s['touch'] += 1
                continue
            s['pairs'] += 1
            s['area'] += a
            small = min(g.area(), og.area())
            s['contained' if small > 0 and a / small >= 0.95 else 'partial'] += 1
    total = sum(s['pairs'] for s in stats.values())
    print(f'=== {name}: {lyr.featureCount()} features, {total} overlapping same-phanLoai pairs')
    for pl, s in sorted(stats.items(), key=lambda kv: -kv[1]['pairs']):
        if s['pairs']:
            print(f"  {s['pairs']:5d} pairs ({s['contained']} contained, {s['partial']} partial), overlap {s['area'] / 1e4:9.2f} ha | {pl}")
app.exitQgis()
