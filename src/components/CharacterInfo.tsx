import Avatar from './Avatar';
import { useStore } from '../store/useStore';
import { badgeFor, formatBytes } from '../constants';

export default function CharacterInfo() {
  const { employees, selectedId, live, select, followSelected, setFollowSelected } = useStore();
  const emp = employees.find((e) => e.id === selectedId);
  if (!emp) return null;
  const badge = badgeFor(emp);
  return (
    <aside className="panel info" aria-label={`${emp.name} details`}>
      <button className="close" onClick={() => select(null)} aria-label="Close details">×</button>
      <Avatar employee={emp} />
      <div className="info-identity">
        <h3>{emp.name}</h3>
        <p className="muted">{emp.role}</p>
        <div className="badge-row">
          <span className="badge" style={{ background: badge.color }} title={badge.label} />
          <span className="badge-label">{badge.label}</span>
          {badge.note && <span className="badge-note">{badge.note}</span>}
          <button
            type="button"
            className="follow-btn"
            aria-pressed={followSelected}
            onClick={() => setFollowSelected(!followSelected)}
            title={followSelected ? 'Stop following agent' : 'Center and follow agent'}
          >
            {followSelected ? 'Following' : 'Follow'}
          </button>
        </div>
      </div>
      <dl className="info-facts">
        <dt>Activity</dt><dd>{live.task}</dd>
        <dt>Zone</dt><dd>{live.zone}</dd>
        <dt>Workstation</dt><dd>{emp.currentWorkstation ?? '—'}</dd>
        <dt>Disk</dt><dd>{formatBytes(emp.workspaceBytes)}</dd>
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
