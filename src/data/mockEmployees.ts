import type { Employee } from '../types';

// Fallback used ONLY when the real OpenBot database cannot be read. Each
// entry carries a deterministic phase + activity so the office still renders
// a believable live scene even without a live source.
const P = (name: string, role: string, color: string | null, hue: number, status: Employee['status'], workstation: string): Employee => ({
  id: workstation,
  name,
  role,
  avatarColor: color,
  avatarHue: hue,
  phase: status === 'working' ? 'ready' : 'idle',
  activity: status === 'working' ? { kind: 'working', variant: 'turn', priority: 4 } : null,
  status,
  position: { x: 0, y: 0 },
  currentWorkstation: workstation,
  unreadCount: 0,
});

export const mockEmployees: Employee[] = [
  P('Andi Pratama', 'Frontend Developer', '#4f86c6', 215, 'working', 'WS-01'),
  P('Sari Dewi', 'UI/UX Designer', '#c65f8a', 330, 'working', 'WS-02'),
  P('Budi Santoso', 'Backend Engineer', '#5aa469', 140, 'working', 'WS-03'),
  P('Maya Putri', 'Product Manager', '#d9a441', 45, 'meeting', 'WS-04'),
  P('Rizky Hidayat', 'DevOps Engineer', '#8a6fc6', 260, 'working', 'WS-05'),
  P('Nadia Rahma', 'QA Engineer', '#d9684f', 15, 'chatting', 'WS-06'),
  P('Dimas Aditya', 'Data Analyst', '#3fa7a0', 180, 'working', 'WS-07'),
  P('Lina Wijaya', 'HR Specialist', '#e08aa0', 340, 'break', 'WS-08'),
  P('Fajar Nugroho', 'Tech Lead', '#6a7fa0', 220, 'meeting', 'WS-09'),
  P('Citra Lestari', 'Marketing', '#c9b24a', 50, 'idle', 'WS-10'),
];
