import type { Metadata } from 'next';
import GdbChecker from '@/components/GdbChecker';

export const metadata: Metadata = {
  title: 'Kiểm tra CSDL GIS theo Thông tư 16/2025/TT-BXD · LEDAT-GIS',
  description: 'Kiểm tra tên geodatabase, nhóm dữ liệu, lớp dữ liệu và trường thuộc tính của hồ sơ GIS quy hoạch theo Thông tư 16/2025/TT-BXD.',
};

export default function Page() {
  return <GdbChecker />;
}
