# CLAUDE.md — DWG/DXF → Google Hybrid Map → KML/KMZ

@AGENTS.md

Web app hiển thị bản vẽ **DWG/DXF** trên nền bản đồ **Google Maps Hybrid**, giữ nguyên **chữ tiếng Việt** và **bảng (table)**, cho phép **xuất KML/KMZ**. Deploy lên **Vercel**.

## Mục tiêu sản phẩm

1. Người dùng kéo-thả file `.dwg` hoặc `.dxf` (đến ~50 MB).
2. Chọn hệ tọa độ của bản vẽ (mặc định VN-2000, chọn tỉnh/kinh tuyến trục; hoặc UTM/WGS84/EPSG tùy chỉnh).
3. Bản vẽ hiển thị chồng lên Google Hybrid: đường, polyline, cung, đường tròn, hatch (tô), block, **text/mtext tiếng Việt**, **bảng**.
4. Bật/tắt layer, xem thuộc tính đối tượng khi click.
5. Xuất `.kml` / `.kmz` (giữ layer thành Folder, màu, text thành nhãn, tiếng Việt UTF-8 chuẩn).

## Ràng buộc kỹ thuật quan trọng

- **Xử lý hoàn toàn phía client** (trình duyệt + Web Worker). KHÔNG upload file lên serverless function — Vercel giới hạn body 4.5 MB và timeout. Không cần backend.
- **Không dùng Google Maps API / API key.** Nền Google Hybrid lấy trực tiếp từ tile XYZ (quyết định của chủ dự án):
  `https://mt{0-3}.google.com/vt/lyrs=y&hl=vi&x={x}&y={y}&z={z}` (`lyrs`: `y` hybrid, `s` vệ tinh, `m` đường, `p` địa hình).
  Đây là endpoint không chính thức → luôn hiển thị attribution "© Google", và phải có **nền dự phòng** Esri World Imagery (`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`) tự bật khi tile Google lỗi liên tục. URL tile để trong `src/lib/map/basemaps.ts`, không rải khắp code.
- Parse nặng (DWG WASM, chuyển tọa độ) chạy trong **Web Worker**, UI không được đơ.
- Tiếng Việt là yêu cầu cốt lõi: mọi chuỗi phải đi qua `src/lib/text/` để chuẩn hóa về **Unicode NFC** trước khi render hay export.

## Tech stack

| Mảng | Thư viện |
|---|---|
| Framework | Next.js (App Router) + TypeScript strict, `output` mặc định cho Vercel |
| Đọc DWG | `@mlightcad/libredwg-web` (LibreDWG biên dịch WASM) — load động, chỉ trong worker |
| Đọc DXF | `dxf-parser` (fallback/đối chiếu: parser tự viết cho entity thiếu như ACAD_TABLE) |
| Bản đồ | `maplibre-gl` với raster source tile Google Hybrid (không cần key) |
| Vẽ overlay | `deck.gl` qua `MapboxOverlay` từ `@deck.gl/mapbox` (`PathLayer`, `PolygonLayer`, `TextLayer`) |
| Phép chiếu | `proj4` |
| KMZ | `jszip` |
| Style | Tailwind CSS |
| Test | Vitest (unit), Playwright (e2e) |

## Kiến trúc & thư mục

```
src/
  app/                    # Next.js routes, layout, page chính
  components/             # UI: FileDropzone, CrsPicker, LayerPanel, MapView, ExportButton
  lib/
    cad/
      types.ts            # ★ HỢP ĐỒNG DỮ LIỆU CHUNG (CadDocument IR) — mọi agent dùng
      dwg/                # DWG → IR (libredwg-web)
      dxf/                # DXF → IR
      normalize/          # explode block/INSERT, tessellate arc/circle/ellipse/spline/bulge, table → cells
    text/                 # decode codepage, TCVN3/VNI → Unicode, MTEXT format codes, NFC
    geo/                  # định nghĩa CRS VN-2000 theo tỉnh, transform IR → WGS84
    map/                  # IR(WGS84) → deck.gl layers
    export/               # IR(WGS84) → KML string, KMZ blob
  workers/
    cad.worker.ts         # parse + normalize + transform, trả IR qua postMessage (Transferable)
tests/
  fixtures/               # file DWG/DXF mẫu (có tiếng Việt TCVN3, VNI, Unicode; có bảng)
  unit/  e2e/
```

### Luồng dữ liệu

```
File ──► cad.worker ──► parser (dwg|dxf) ──► CadDocument (raw, tọa độ bản vẽ)
                         ──► normalize (explode, tessellate, table) ──► text decode
                         ──► geo.transform(CRS) ──► CadDocument (WGS84)
UI ◄── IR ──► map/ (deck.gl layers on Google Hybrid)
          └─► export/ (KML/KMZ download)
```

### Hợp đồng dữ liệu (`src/lib/cad/types.ts`)

Mọi module giao tiếp **chỉ** qua IR này. Thay đổi `types.ts` phải cập nhật tất cả nơi dùng và test.

```ts
export type Vec2 = [number, number];            // [x,y] bản vẽ hoặc [lng,lat] sau transform
export interface CadLayer { name: string; color: string /* #rrggbb */; visible: boolean; }
export type CadEntity =
  | { kind: 'polyline'; layer: string; color: string; width?: number; points: Vec2[]; closed: boolean; handle?: string }
  | { kind: 'polygon';  layer: string; color: string; fillOpacity: number; rings: Vec2[][]; handle?: string } // HATCH/SOLID
  | { kind: 'text';     layer: string; color: string; text: string /* Unicode NFC, đã bỏ format code */;
      position: Vec2; height: number /* đơn vị bản vẽ */; rotation: number /* độ */;
      hAlign: 'left'|'center'|'right'; vAlign: 'baseline'|'bottom'|'middle'|'top'; handle?: string }
  | { kind: 'table';    layer: string; color: string; origin: Vec2; rotation: number;
      rows: number; cols: number; rowHeights: number[]; colWidths: number[];
      cells: { r: number; c: number; rowSpan: number; colSpan: number; text: string }[]; handle?: string }
  | { kind: 'point';    layer: string; color: string; position: Vec2; handle?: string };
export interface CadDocument {
  units: 'mm'|'cm'|'m'|'unitless'|string;
  crs: string | null;           // proj4 string hiện tại của tọa độ; null = chưa biết
  layers: CadLayer[];
  entities: CadEntity[];
  bbox: [Vec2, Vec2];
  warnings: string[];           // entity bỏ qua / không hỗ trợ — hiển thị cho người dùng
}
```

## Các điểm khó (đọc trước khi code)

1. **Tiếng Việt trong CAD** — bản vẽ VN thường dùng 3 kiểu:
   - Unicode thật (font Arial/Times) → giữ nguyên, chỉ NFC.
   - **TCVN3/ABC** (font `.VnTime`, `.VnArial`…, style font tên bắt đầu `.Vn`) → chuỗi là byte 8-bit, phải map bảng TCVN3 → Unicode.
   - **VNI** (font `VNI-Times`, `VNI-*`) → map tổ hợp VNI → Unicode.
   - **Nhận diện chủ yếu theo NỘI DUNG**, font/tên style chỉ là gợi ý phụ. Đã kiểm chứng trên fixture thật: `libredwg-web` trả `font: ""` cho hầu hết TEXTSTYLE, và tên style không đáng tin (style tên `Vn.Times` lại chứa chữ VNI).
     Quy tắc: chuỗi có ký tự ngoài Latin-1 (≥ U+0100) → Unicode thật. Ngược lại đếm cặp "nguyên âm + ký tự dấu VNI" (`[aeiouyơư][ÙØÛÕÏÂÁÀÅÃÄÊÉÈÚÜË…]`) và ký tự `Ñ Ö Ô` → VNI; dấu hiệu TCVN3 tương tự với bảng TCVN3. Sau đó **bỏ phiếu theo style**: style mà đa số chuỗi là VNI thì chuỗi mơ hồ (vd. `P. THÔÙI BÌNH`) trong style đó cũng là VNI.
   - VNI → Unicode: thay ký tự dấu đứng sau nguyên âm bằng combining mark rồi `normalize('NFC')`: `Ù/ù`=sắc, `Ø/ø`=huyền, `Û/û`=hỏi, `Õ/õ`=ngã, `Ï/ï`=nặng; `Â`=^, `Á À Å Ã Ä`=^+thanh; `Ê`=˘(trăng), `É È Ú Ü Ë`=˘+thanh. Ký tự đơn: `Ñ`=Đ, `Ô`=Ơ, `Ö`=Ư, `Ò`=Ị, `Ó`=Ĩ, `Æ`=Ỉ, `Î`=Ỵ (kèm chữ thường tương ứng). Bản thử trong phiên phân tích đã giải đúng 100% mẫu của fixture.
   - DWG/DXF cũ (< R2007) lưu theo `$DWGCODEPAGE` (thường `ANSI_1258` hoặc `ANSI_1252`) — decode bằng `TextDecoder('windows-1258')`, rồi mới xét TCVN3/VNI.
   - MTEXT: bỏ `\P`(→ xuống dòng), `\f...;`, `\H..;`, `\W..;`, `\pi..;`, `\C..;`, `{}`, `\~`, `%%c`(Ø), `%%d`(°), `%%p`(±), `\U+XXXX`. TEXT cũng có `%%U`/`%%u`/`%%O` (gạch chân/trên) → bỏ, không phân biệt hoa thường.
2. **deck.gl `TextLayer` mặc định chỉ có ASCII** → phải đặt `characterSet` gồm toàn bộ ký tự tiếng Việt (hoặc `'auto'`) và `fontFamily` hỗ trợ tiếng Việt (vd. `Roboto, Arial`). Kích thước chữ dùng `sizeUnits: 'meters'` theo `height` bản vẽ.
3. **Bảng (ACAD_TABLE)** — đọc ô từ entity; nếu không đọc được, fallback explode block ẩn danh `*T…` mà table tham chiếu (lines + mtext). Không được làm mất bảng âm thầm — ghi `warnings`.
4. **Block/INSERT** lồng nhau: áp dụng ma trận (scale, rotation, translation, extrusion OCS) đệ quy; ATTRIB cũng là text.
5. **VN-2000**: TM múi 3°, `k=0.9999`, `x_0=500000`, kinh tuyến trục theo tỉnh (Thông tư 973/2001/TT-TCĐC), kèm `+towgs84` 7 tham số chuẩn:
   `+proj=tmerc +lat_0=0 +lon_0={KTT} +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 +towgs84=-191.90441429,-39.30318279,-111.45032835,-0.00928836,0.01975479,-0.00427372,0.252906278 +units=m +no_defs`
   Bản vẽ VN thường có X(Northing)/Y(Easting) đảo — UI có tùy chọn "đổi X/Y". Đơn vị mm → chia 1000.
   **Mã EPSG**: người dùng hay nhập mã (vd. `9209` = VN-2000 / TM-3 105-30). `src/lib/geo/epsg.ts` có bảng offline các mã VN-2000 (4756, 3405/3406, 5896–5899, 6956–6959, 9205–9218) + UTM 32648/32649 + 4326; `resolveCrsInput` nhận mã EPSG / proj4 / WKT và `transformDocument` cũng chấp nhận mã EPSG. Không gọi epsg.io lúc chạy.
   Có nút "Kiểm tra vị trí": nếu bbox sau transform nằm ngoài Việt Nam → cảnh báo sai CRS.
   **KTT thực tế của bản vẽ có thể khác KTT của tỉnh hiện hành**: sau sáp nhập 2025 (34 đơn vị, TT 24/2025/TT-BNNMT) bản vẽ cũ thường dùng KTT của tỉnh cũ; Lai Châu có hai giá trị (TT 973: 103°00', TT 24/2025: 104°45'). Fixture Cần Thơ dùng KTT **105°00'** — đúng KTT chính thức của Cần Thơ (105°45' là của TP.HCM/Long An…, dùng nhầm sẽ lệch ~80 km sang Đông). Vì vậy auto-detect phải thử nhiều KTT (KTT tỉnh, KTT các tỉnh cũ, dãy 102–108.5°, múi 3° và 6°, UTM 48/49), chọn phương án rơi vào ranh tỉnh, và người dùng luôn xem lại bằng mắt trên nền ảnh. Giữa múi 3° (k=0.9999) và 6° (k=0.9996) cùng KTT 105° lệch ~330 m theo hướng Bắc–Nam → cần chỉnh tay khi so với ảnh.
6. **KML**: toạ độ `lng,lat[,alt]`; màu KML là `aabbggrr` (không phải rrggbb!); text → `Placemark` + `Point` + `IconStyle scale 0` + `LabelStyle`; bảng → đường kẻ + nhãn từng ô, và `description` HTML của bảng; layer → `Folder`. File UTF-8 có `<?xml version="1.0" encoding="UTF-8"?>`, escape `& < > " '`. KMZ = zip chứa `doc.kml`.
7. **Hatch dạng mẫu (pattern) mang màu sử dụng đất**: trong bản đồ quy hoạch, màu các loại đất chủ yếu nằm ở hatch mẫu (CLAY, GRASS, AR-B88, NET…), không phải hatch SOLID (fixture: 944 hatch mẫu vs 948 SOLID chỉ ở layer đường/cây xanh). Vì vậy hatch mẫu được xuất thành `polygon` có `pattern` và `fillOpacity` 0.35 (SOLID: 0.5) — **không được** chỉ vẽ đường biên. Vẽ đường mẫu chi tiết (từ `definitionLines`) là cải tiến sau.
8. **Hiệu năng**: bản vẽ lớn (>200k entity) — gộp theo layer thành binary attributes cho deck.gl, không tạo object React mỗi entity. Tessellate cung với sai số chord ~ 0.1% bán kính, tối đa 64 đoạn.
9. **Đặc thù `libredwg-web`** (đã kiểm chứng với v0.7.14):
   - `dwg_read_data` có thể báo mã lỗi khác 0 nhưng vẫn đọc được (fixture báo 68 = `VALUEOUTOFBOUNDS | UNHANDLEDCLASS`). Mã < 128 là cảnh báo, chỉ ≥ 128 (`DWG_ERR_CRITICAL`) mới là lỗi thật.
   - `db.entities` chứa **cả Model Space lẫn Paper Space** → lọc theo `ownerBlockRecordSoftId` = handle của `*Model_Space`; nếu không, khung tên ở paper space (tọa độ quanh 0,0) sẽ rơi xuống biển gần xích đạo.
   - `ATTRIB` có dạng `{ type: 'ATTRIB', text: { text, startPoint, textHeight, styleName, … } }` — nội dung nằm trong `e.text.text`.
   - Header `$EXTMIN/$EXTMAX` có thể sai (fixture có EXTMAX y = 2.224.052) → tự tính bbox, dùng percentile 1–99 % để loại điểm lạc.
   - Giấy phép **GPL-3.0** — xem mục "Giấy phép" bên dưới.
10. **Tile Google trực tiếp**: MapLibre vẽ raster bằng WebGL nên tile phải có header CORS — **kiểm chứng đầu tiên** trên localhost và bản deploy Vercel. Nếu bị chặn CORS → chuyển sang Leaflet (`L.tileLayer` dùng thẻ `<img>`, không cần CORS) + `deck.gl-leaflet`, giữ nguyên `buildLayers`. Dùng xoay vòng subdomain `mt0–mt3`, `maxzoom: 21`, `tileSize: 256`. Không proxy tile qua Vercel function (tốn băng thông, dễ bị chặn IP).

## Chiều ngược: KMZ/KML → DXF

- Không xuất DWG: `libredwg-web` được build với `disable-write`, bộ ghi DWG của LibreDWG còn thử nghiệm (chỉ R2000). Chủ dự án chọn **DXF** (AutoCAD mở trực tiếp, Save As → DWG).
- Luồng: `src/lib/kml` (`parseKmlFile`, parser XML tự viết — không DOMParser, chạy trong worker) → CadDocument WGS84 (`crs` khác null) → UI hiển thị trực tiếp; bước 2 thành "Hệ tọa độ đích (DXF)" (mặc định VN-2000 KTT tỉnh, múi 3°) → `projectDocument` (`src/lib/geo/project.ts`, nghịch đảo đúng của `transformDocument`, round-trip < 1 mm) → `toDxf` (`src/lib/export/dxf.ts`, `@tarikjabiri/dxf`, AC1021 UTF-8, style `VN-ARIAL` = arial.ttf). Với nguồn DWG/DXF, DXF được ghi lại theo hệ tọa độ gốc đang áp dụng.
- Kiểm tra bằng AutoCAD thật: `powershell -ExecutionPolicy Bypass -File scripts/verify-dxf-autocad.ps1 <file.dxf>` (accoreconsole mở DXF và SAVEAS DWG). Đã chạy với Ninh Kiều: DWG → KMZ → DXF 16,4 MB mở được, lưu DWG 5,85 MB, đọc lại đủ 3.174 TEXT tiếng Việt.
- Lỗi của `@tarikjabiri/dxf` đã vá trong `dxf.ts` (AutoCAD từ chối nếu thiếu): bỏ group 47 trong HATCH solid; layer `Defpoints` đổi tên; layer "0" của bản vẽ dùng lại layer "0" mặc định. Nâng cấp thư viện → chạy lại `tests/unit/export/dxf.test.ts` + script AutoCAD.

## Fixture thật: `dwg/10-QHPK Ninh Kieu - SDĐ (1).dwg`

Bản đồ quy hoạch sử dụng đất phân khu Ninh Kiều, Cần Thơ, 4.4 MB, DWG **R2007** (`AC1021`), `INSUNITS=6` (mét). Các agent dùng file này làm chuẩn nghiệm thu:
- Model Space 8.643 object (đếm riêng `*Model_Space`, không tính 1.301 object Paper Space): HATCH 1892, LWPOLYLINE 4541, POLYLINE2D 5, TEXT 707, MTEXT 7, INSERT 1180 (kèm 2454 ATTRIB; block ký hiệu như `Khieu`, `xr vong tron chi tieu…`), LINE 111, POINT 93, ARC 79, CIRCLE 25; OLE2FRAME/WIPEOUT bỏ qua kèm warning. Sau explode: ~9.957 polyline, 3.174 text, 1.902 polygon, 93 point. Toàn bộ luồng đọc + giải mã ~1 s (Node). Không có ACAD_TABLE — bảng chú giải và khung tên là đường kẻ + text.
- 366 layer, tên layer có cả tiếng Việt Unicode (`NKIEU-KT-QHCT_Đất quân sự`).
- Chữ: MTEXT khung tên là **Unicode** (`BẢN ĐỒ QUY HOẠCH SỬ DỤNG ĐẤT`); ~1.050 TEXT/ATTRIB là **VNI** (`ÑAÁT TRÖÔØNG MAÀM NON` → `ĐẤT TRƯỜNG MẦM NON`, `P. THÔÙI BÌNH` → `P. THỚI BÌNH`) ở các style `AVO-DAM`, `VNI-HELVE`, `VNI`, `Vn.Times`, `helve-b`, `QUANHUYEN`.
- Tọa độ ~E 580.900 / N 1.107.400 → với VN-2000 KTT 105°: ≈ 10.013°N, 105.740°E (Ninh Kiều). Nghiệm thu: tim đường và ranh lô khớp nền ảnh.
- Kiểm thử e2e không được sinh ra chữ có ký tự VNI còn sót (dùng `VNI_LEFTOVER_RE` export từ `@/lib/text`; không dùng `[ÙÕØ]` đơn lẻ vì `CHÙA`, `VÕ` là chữ Việt thật và `Ø` là ký hiệu đường kính).

## Giấy phép

`@mlightcad/libredwg-web` (và LibreDWG) là **GPL-3.0**. Gửi JS/WASM tới trình duyệt người dùng là phân phối phần mềm → mã nguồn app phải phát hành theo GPL-3.0 (đặt `LICENSE`, công khai source). Nếu cần giữ mã nguồn đóng thì phải thay phần đọc DWG (vd. ODA Drawings SDK có phí) — đây là quyết định của chủ dự án, không được tự thay đổi.

## Lệnh

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # phải pass trước khi deploy
npm run lint
npm run typecheck    # tsc --noEmit
npm test             # vitest
npm run test:e2e     # playwright
```

Deploy: `vercel` (preview) / `vercel --prod`. Không cần biến môi trường cho bản đồ. File `.wasm` của libredwg phải được serve từ `public/` hoặc import qua bundler; kiểm tra `next.config` không chặn WASM.

## Thiết kế giao diện

- **Thương hiệu "LEDAT-GIS — Geospatial Solutions"** (tác giả LEDAT). Logo gốc `LEDAT-GIS-icon.svg` (chữ "LD" + ghim bản đồ, navy `#0e1f3b`) → hằng `LOGO_PATH`/`LOGO_VIEWBOX`/`BRAND_NAVY` trong `src/components/brand.ts`, dùng cho `<Logo/>`, nhãn giữa mã QR và icon. Bố cục thương hiệu như ảnh logo: mark bên trái, chữ `LEDAT-GIS` (Montserrat 700, lớp `ui-wordmark`) + `GEOSPATIAL SOLUTIONS` (`Tagline.tsx`: từng ký tự dàn đều `justify-between` cho đúng bằng bề rộng chữ LEDAT-GIS — cha phải là flex cột `items-stretch`) bên phải — ở hero trang chủ và header bảng điều khiển. **Icon**: `node scripts/gen-icons.mjs` (sharp) sinh `src/app/favicon.ico`, `icon.svg` (tự đổi trắng khi tab tối), `apple-icon.png` 180 (nền trắng cho iOS), `public/icons/icon-192/512.png` + `icon-maskable-512.png`; `src/app/manifest.ts` (PWA Android) và `metadata.appleWebApp` trong `layout.tsx`. Đổi logo → sửa `brand.ts` rồi chạy lại script. Luồng 3 trang trong `App.tsx` (state `stage`): **Trang chủ** `Landing.tsx` (nền trắng, chữ LEDAT-GIS hiện dần, dòng "Đưa các định dạng [.dwg/.dxf/.kmz/.kml gõ–xóa kiểu typewriter] của bạn lên bản đồ", khung thả file) → **Chọn hệ tọa độ** `CrsStep.tsx` hiển thị ngay dưới hero của Landing (prop `panel`, cùng một `<Landing>` nên hero không render lại; chỉ với DWG/DXF; KMZ/KML đã có tọa độ nên vào thẳng bản đồ) → **Bản đồ**. Hiệu ứng gõ chữ chạy cả khi `prefers-reduced-motion` (chỉ đổi chữ tại chỗ). **Nền động trang chủ** (`Backdrop` trong `Landing.tsx`): vùng màu loang (aurora) mờ trôi chậm, đường đồng mức dạng sóng tuần hoàn trượt ngang liên tục (`wavePath` + `ui-wave` dịch đúng 1 chu kỳ để lặp liền mạch), tuyến khảo sát nét đứt chạy (`ui-march`) có điểm di chuyển (`animateMotion`), parallax nhẹ theo chuột. Chủ dự án muốn nền luôn động: khi `prefers-reduced-motion` (Windows tắt "Animation effects" cũng báo vậy) sóng/aurora vẫn chạy nhưng chậm hơn nhiều, chỉ tắt điểm di chuyển và parallax.
- **Chuyển cảnh**: mọi đổi trang đi qua `go()` trong `App.tsx` (View Transitions API + `flushSync`; bỏ qua khi tab ẩn hoặc trình duyệt không hỗ trợ, rejection được nuốt). Tiêu đề/phụ đề có `view-transition-name` `ledat-title`/`ledat-subtitle` để morph. Vào bản đồ: bảng trượt từ trái (`ui-slide-in-left`, fill `backwards` để không phá transform thu gọn), pill nền rơi xuống, bản đồ bay từ toàn cảnh VN tới bản vẽ (`fitBounds` lần đầu 2,6 s, `essential: true`). Khi `prefers-reduced-motion`: hiệu ứng vào cảnh chỉ còn mờ dần (không dịch chuyển), hiệu ứng liên tục (nền trôi, ping, shimmer) tắt.
- **Trang bản đồ**: `MapPanel.tsx` = header (logo, Home, thu gọn) + chip file (thống kê, "Đổi file", chip cảnh báo xổ danh sách) + 3 tab **Layer · Tọa độ · Xuất** (luôn mounted để giữ state). Thanh trạng thái dưới bản đồ hiện lat/lng con trỏ, X/Y theo hệ bản vẽ (`createInversePointTransformer`), zoom.
- **Kiểu layer do người dùng chỉnh** (`LayerStyle` trong `types.ts`: màu, `width` px, `dash`, `fillOpacity`): App giữ `styles`, `styledDoc = applyLayerStyles(doc, styles)` (`src/lib/cad/style.ts`) cấp cho **cả** `buildLayers` và exporter. Popover `LayerStyleEditor.tsx` (12 màu + màu tự do, độ dày 0,5–8 px, liền/gạch/chấm/gạch-chấm, độ đặc vùng tô, đặt lại; áp hàng loạt cho layer đang lọc & hiện). Bản đồ: nét đứt qua `PathStyleExtension` (gạch-chấm chỉ xấp xỉ vì extension chỉ có 1 cặp dash/gap). KML: không có nét đứt → xuất nét liền + cảnh báo trong tab Xuất. DXF: LTYPE DASHED/DOT/DASHDOT (gạch 2 m / hở 1 m theo đơn vị bản vẽ) + lineweight (1 px ≈ 0,25 mm), đã kiểm bằng AutoCAD.
- **Nhiều file chồng nhau**: worker giữ nhiều bản vẽ theo `docId` (`CadPipeline.parse/transform/release`); danh sách file (`FileList.tsx`) có ẩn/hiện, độ trong suốt, thứ tự vẽ, xóa; các tab Layer/Tọa độ/Xuất làm việc trên file đang chọn.
- **Vẽ thêm (tab "Vẽ")**: `src/lib/cad/sketch.ts` (`SketchFeature`: đường / vùng / điểm, `[lng,lat]`, style riêng, nhãn) → `sketchToDocument` tạo CadDocument WGS84 với **mỗi nét = một layer** (layer.style = style của nét) nên dùng lại toàn bộ pipeline kiểu/bản đồ/xuất. Vùng = polygon + polyline viền (để độ dày/nét đứt hiện ở viền). Nhập liệu trên bản đồ: `useDraw.ts` (cùng cơ chế với đo đạc: hút đỉnh, nhấp đúp/Enter xong, Backspace, Esc; loại trừ với công cụ đo). Render như một "file" giả id `sketch` trên cùng; bấm vào nét → chọn trong tab Vẽ (không mở popup). Lưu `localStorage` key `ledat-gis:sketches:v1` (chỉ là tiện ích, đọc/ghi trong try/catch).
- **Chia sẻ bản đồ (phương án A — link, không máy chủ)**: `src/lib/cad/share.ts` nén {tên, mô tả, nền, nét vẽ} → JSON rút gọn (tọa độ số nguyên 1e-7° ≈ 1 cm, mã hóa chênh lệch) → `CompressionStream('deflate-raw')` → base64url trong `#m=…` (fragment không gửi lên server). `fromWire` kiểm tra/làm sạch mọi trường vì link do ai cũng tạo được. `ShareDialog.tsx`: link + chép + QR (`brandedQr` trong `components/qr.ts`: `uqr` `encode`, ô bo góc, mắt định vị navy (cùng màu chủ đạo), nhãn "logo + LEDAT-GIS / GEOSPATIAL SOLUTIONS" ở giữa (cao 14 % mã; trong SVG hai dòng dùng `textLength` cùng bề rộng, trong PNG dòng tagline được dàn từng ký tự theo bề rộng chữ LEDAT-GIS) với ECC **M**; ảnh PNG vẽ chữ nhãn bằng canvas vì SVG qua `<img>` không dùng được web font — không dùng Q vì mã dày khó quét, đã đo bằng jsQR; link quá dài cho M → mức L không logo; chỉ khi link ≤ ~2 900 ký tự; cảnh báo khi > 8 000). Nút "Tải mã QR (PNG)": 1080 px, QR + tên bản đồ bên dưới. Trang chủ có nút "Tạo bản đồ mới" (`openBlankMap`: bản đồ trống thật sự — xóa nét vẽ, tên về "Bản đồ chưa đặt tên", hỏi xác nhận nếu bản đồ đang lưu trên máy có nét vẽ; bản đồ cũ có nét vẽ hiện nút "Tiếp tục với <tên>"). Mở link → `sharedView`: **không** ghi `localStorage` (không đè bản đồ riêng của người nhận) cho tới khi bấm "Lưu vào máy này"; link hỏng → báo lỗi, không đổi chế độ khi đang xem link khác. Tên bản đồ → tiêu đề tab, tên file xuất; bản đồ chỉ có nét vẽ xuất DXF theo VN-2000 của tỉnh chứa nét vẽ. **Xem trước link trong ứng dụng chat**: fragment `#m=` không tới máy chủ, nên `buildShareUrl` thêm tên bản đồ vào query `?t=` (`SHARE_TITLE_PARAM`, `cleanShareTitle` cắt 80 ký tự, NFC, bỏ ký tự điều khiển; app bỏ qua `t`, fragment vẫn là nguồn dữ liệu) → `generateMetadata` trong `src/app/page.tsx` đặt title/description/`og:*`/`twitter:*` theo tên (vì vậy route `/` là dynamic), ảnh `src/app/og/route.tsx` (`ImageResponse` 1200×630: logo + LEDAT-GIS/GEOSPATIAL SOLUTIONS + tên bản đồ; không có `t` → thẻ chung của trang, dùng trong `layout.tsx`). Font ảnh trong `assets/fonts` (OFL): Be Vietnam Pro phải là **một file TTF đầy đủ** — bản tách subset làm Satori vẽ cả từ có dấu bằng font dự phòng. "Lưu vào máy này"/"Tạo bản đồ mới" xóa cả `?t=` lẫn `#m=` khỏi thanh địa chỉ. Link không kèm file DWG/DXF/KMZ (quá lớn) — muốn chia sẻ cả bản vẽ cần phương án B (máy chủ), chưa làm.
- **Xuất gộp**: `src/lib/cad/merge.ts` `mergeDocuments` gộp các file đang hiện (chỉ layer đang hiện, đã áp kiểu) + nét vẽ; tên layer `"<tên file> – <layer>"`. Tab Xuất có "Nguồn: File đang chọn / Gộp tất cả" (mặc định gộp khi có nét vẽ). DXF gộp dùng hệ tọa độ của file đang chọn; đã kiểm bằng AutoCAD (DASHED + lineweight + nhãn tiếng Việt còn nguyên).
- **Vị trí của tôi**: `GeolocateControl` của MapLibre (nút nhỏ trên cụm zoom, `trackUserLocation` — chấm xanh + vòng sai số cập nhật liên tục; kéo bản đồ thì thôi bám theo). Lỗi quyền/timeout → `notice` tiếng Việt; quyền bị chặn từ trước thì MapLibre vô hiệu nút. Cần HTTPS (Vercel) hoặc localhost.
- **Đo đạc** (`src/lib/geo/measure.ts` — Karney/GeographicLib; UI `MeasureToolbar`, `MeasureCard`, `useMeasure`): đo dài và đo diện tích chỉ hiển thị **một** giá trị bình thường (theo mặt đất, ellipsoid WGS84) — **không** tách "WGS84 / VN-2000" (chủ dự án yêu cầu). Chỉ công cụ **tọa độ điểm** mới hiện cả vĩ độ/kinh độ WGS84 và X/Y theo hệ bản vẽ.
- **Chọn hệ tọa độ = chọn tỉnh từ danh sách** (`<select>` nhóm theo 34 tỉnh hiện hành, mỗi lựa chọn là một tỉnh cũ trước sáp nhập kèm KTT; không ô tìm kiếm, không danh sách "phương án gợi ý" — chủ dự án đã bỏ). Chọn → VN-2000 KTT đó, múi 3°, giữ đơn vị/đổi X/Y. `suggestCrs` vẫn chạy ngầm để chọn sẵn tỉnh + KTT tốt nhất khi mở file. Trường hợp đặc biệt (múi 6°, EPSG, proj4, offset) nằm trong "Thiết lập thủ công". Animation là CSS `ui-*` trong `globals.css`, tôn trọng `prefers-reduced-motion`.
- **Chỉ giao diện sáng**, phong cách tối giản: bản đồ tràn màn hình, bảng điều khiển nổi bên trái (`.ui-floating`, rộng 384px, **mặc định ẩn** sau nút "Bảng điều khiển" — trên điện thoại nút chỉ còn logo để không đè pill nền; `fitPadding` trong `MapView.tsx` bỏ phần chừa cho bảng khi màn hình hẹp, vì MapLibre không fit nếu padding vượt khung), các bước đánh số 1–4 (Bản vẽ → Hệ tọa độ → Layer → Xuất), chọn nền bản đồ dạng pill ở góc trên phải.
- Màu: xám `zinc` trung tính; **navy thương hiệu `#0e1f3b`** cho chữ đậm và nút chính — thực hiện bằng cách ánh xạ lại `zinc-800/900/950` trong `@theme` (`globals.css`), nên cứ dùng `zinc-900` như cũ; màu nhấn duy nhất `blue-600` (trạng thái chọn/focus, chữ "GIS" shimmer navy→xanh, nút CTA gradient navy→xanh); `amber` cho cảnh báo, `emerald`/`red` cho kết quả kiểm tra. Không thêm màu thương hiệu khác.
- Font giao diện **Be Vietnam Pro** (`--font-ui`); chữ thương hiệu **Montserrat** (`--font-brand`, chỉ cho wordmark/tagline/nhãn QR); chữ trên bản đồ dùng Roboto (`--font-roboto`) cho atlas deck.gl.
- Dùng các lớp dùng chung trong `src/app/globals.css` (`ui-input`, `ui-btn`, `ui-btn-primary`, `ui-btn-ghost`, `ui-chip`, `ui-card`, `ui-floating`, `ui-segment`, `ui-check`, `ui-label`) và icon SVG trong `src/components/icons.tsx` — không thêm thư viện UI/icon, không dùng `dark:`.

## Quy ước code

- TypeScript strict, không `any` ở ranh giới module; hàm thuần trong `lib/` (không phụ thuộc DOM) để test được trong Node.
- UI text bằng tiếng Việt; tên biến/hàm bằng tiếng Anh.
- Mỗi module `lib/*` có unit test với fixture thật. Bug tiếng Việt → thêm test case chuỗi cụ thể.
- Không thêm dependency nặng mà không ghi lý do trong PR/commit.

## Phân công agents (`.claude/agents/`)

| Agent | Phạm vi sở hữu | Phụ thuộc |
|---|---|---|
| `architect-lead` | Scaffold Next.js, `types.ts`, worker, ghép module, điều phối | — |
| `cad-parser` | `lib/cad/dwg`, `lib/cad/dxf`, `lib/cad/normalize` | `types.ts` |
| `vietnamese-text` | `lib/text/` (codepage, TCVN3, VNI, MTEXT) | — |
| `geo-crs` | `lib/geo/` (VN-2000 theo tỉnh, UTM, transform, sanity check) | `types.ts` |
| `map-ui` | `components/`, `lib/map/`, `app/` UI | IR, `lib/text` |
| `kml-exporter` | `lib/export/` | IR, `lib/text` |
| `qa-deploy` | `tests/`, fixtures, CI, cấu hình & deploy Vercel | tất cả |

### Thứ tự thực hiện

1. **Phase 0** – `architect-lead`: scaffold, `types.ts`, worker skeleton.
2. **Phase 1 (song song)** – `cad-parser`, `vietnamese-text`, `geo-crs`, `kml-exporter` (dùng IR giả lập để test).
3. **Phase 2** – `map-ui`: ghép bản đồ + panel + export button.
4. **Phase 3** – `qa-deploy`: e2e với fixture thật, `npm run build`, deploy preview Vercel.

Mỗi agent chỉ sửa file trong phạm vi của mình; cần đổi `types.ts` thì báo `architect-lead`. Khi xong, chạy `npm run typecheck && npm test` trước khi báo cáo.
