import { useStore } from '../store/useStore';
import { badgeFor, shirtColorFor } from '../constants';
import type { Status } from '../types';

export default function CharacterInfo() {
  const { employees, selectedId, live, select, setStatus } = useStore();
  const emp = employees.find((e) => e.id === selectedId);
  if (!emp) return null;
  const badge = badgeFor(emp);
  return (
    <aside className="panel info">
      <button className="close" onClick={() => select(null)}>×</button>
      <div className="avatar" style={{ background: shirtColorFor(emp) }} />
      <h3>{emp.name}</h3>
      <p className="muted">{emp.role}</p>
      <div className="badge-row">
        <span className="badge" style={{ background: badge.color }} title={badge.label} />
        <span className="badge-label">{badge.label}</span>
        {badge.note && <span className="badge-note">{badge.note}</span>}
      </div>
      <dl>
        <dt>Activity</dt><dd>{live.task}</dd>
        <dt>Zone</dt><dd>{live.zone}</dd>
        <dt>Workstation</dt><dd>{emp.currentWorkstation ?? '—'}</dd>
        <dt>Position</dt><dd>{live.x}, {live.y}</dd>
        {emp.unreadCount !== undefined && emp.unreadCount > 0 && (
          <>
            <dt>Unread</dt>
            <dd>{emp.unreadCount}</dd>
          </>
        )}
      </dl>
    </aside>
  );
}
