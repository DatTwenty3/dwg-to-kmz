import type { Metadata } from 'next';
import DwgToGdb from '@/components/DwgToGdb';

export const metadata: Metadata = {
  title: 'Bóc tách DWG → CSDL GIS theo Thông tư 16 · LEDAT-GIS',
  description:
    'Thả thư mục bản vẽ DWG của hồ sơ quy hoạch: nhận diện từng bản đồ, ghép layer vào lớp dữ liệu Thông tư 16/2025/TT-BXD và xuất HoSoGIS (File Geodatabase).',
};

export default function Page() {
  return <DwgToGdb />;
}
