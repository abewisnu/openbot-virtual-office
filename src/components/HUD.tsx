import { useEffect, useRef, useState } from "react";
import { useStore, type RoomHighlightRect } from "../store/useStore";
import { PHASE_COLORS, PHASE_LABEL } from "../constants";
import { DAYLIGHT_LABEL, DAYLIGHT_MODES, type DaylightMode } from "../office/DayCycle";
import { FLOOR_STYLE_LABEL, FLOOR_STYLES, PLANT_STYLE_LABEL, PLANT_STYLES, type FloorStyle, type PlantStyle } from "../office/AssetGenerator";
import { AGENT_PHASES } from "../types";
import type { AgentPhase } from "../types";

const ROOM_JUMPS: readonly { label: string; x: number; y: number; box: RoomHighlightRect }[] = [
  { label: "Lounge", x: 240, y: 352, box: { x: 32, y: 192, w: 416, h: 320 } },
  { label: "Meeting", x: 800, y: 400, box: { x: 576, y: 192, w: 448, h: 448 } },
  { label: "Pantry", x: 240, y: 784, box: { x: 32, y: 576, w: 416, h: 384 } },
  { label: "NOC", x: 240, y: 1120, box: { x: 32, y: 992, w: 416, h: 256 } },
  { label: "Desks", x: 1536, y: 544, box: { x: 1152, y: 192, w: 736, h: 768 } },
];

export default function HUD() {
  const {
    notices,
    employees,
    showLabels,
    toggleLabels,
    sidebarFont,
    setSidebarFont,
    themeMode,
    setThemeMode,
    daylightMode,
    setDaylightMode,
    moodyLighting,
    setMoodyLighting,
    floorStyle,
    setFloorStyle,
    plantStyle,
    setPlantStyle,
    helpOpen,
    setHelp,
    settingsOpen,
    setSettings,
    exited,
    setExited,
    source,
    focusAgent,
    focusPoint,
    zoomPercent,
    triggerZoom,
    hoveredAgent,
  } = useStore();
  const [now, setNow] = useState(Date.now());
  const [sidebarVisible, setSidebarVisible] = useState(true);
  // Which "Team activity" row is expanded to show the agents behind its count.
  const [openPhase, setOpenPhase] = useState<AgentPhase | null>(null);
  const [avatar, setAvatar] = useState<{ src: string; version: string } | null>(null);
  const [avatarChecked, setAvatarChecked] = useState(false);
  // Profile name of the person using this OpenBot, taken from OpenBot's own
  // config. `null` means the sidebar keeps its neutral "Workspace" label.
  const [profileName, setProfileName] = useState<string | null>(null);
  const avatarUrl = useRef<string | null>(null);

  // Profile identity (avatar and name) lives in OpenBot's own app-support folder
  // and is exposed by the dev API as image bytes plus a plain name string. Both
  // are re-read on focus and every 20 s so a change made inside OpenBot shows up
  // without a page reload. Nothing is drawn until the first answer arrives, which
  // keeps a reload free of a flash of the built-in mark.
  useEffect(() => {
    let cancelled = false;

    const loadAvatar = async () => {
      try {
        const res = await fetch('/api/office-avatar', { headers: { Accept: 'image/*' }, cache: 'no-store' });
        const type = res.headers.get('content-type') ?? '';
        if (cancelled) return;
        if (res.status !== 200 || !type.startsWith('image/')) {
          setAvatarChecked(true);
          return;
        }
        const version = res.headers.get('x-office-avatar-version') ?? res.headers.get('etag') ?? '';
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setAvatar((prev) => {
          if (prev && prev.src === url) return prev;
          if (avatarUrl.current) URL.revokeObjectURL(avatarUrl.current);
          avatarUrl.current = url;
          return { src: url, version };
        });
        setAvatarChecked(true);
      } catch {
        if (!cancelled) setAvatarChecked(true);
      }
    };

    const loadName = async () => {
      try {
        const res = await fetch('/api/office-profile', {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });
        const type = res.headers.get('content-type') ?? '';
        if (cancelled || res.status !== 200 || !type.includes('application/json')) return;
        const body: unknown = await res.json();
        if (cancelled) return;
        const name = (body as { name?: unknown }).name;
        setProfileName(typeof name === 'string' && name.trim() ? name.trim() : null);
      } catch {
        /* keep the neutral "Workspace" label */
      }
    };

    const load = () => Promise.all([loadAvatar(), loadName()]);

    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    const t = window.setInterval(() => void load(), 20_000);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      window.clearInterval(t);
      if (avatarUrl.current) URL.revokeObjectURL(avatarUrl.current);
      avatarUrl.current = null;
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const recentNotices = notices
    .filter((n) => now - n.ts < 9000)
    .slice(-3)
    .reverse();
  return (
    <>
      {sidebarVisible ? (
        <aside className="hud-sidebar" data-font={sidebarFont} aria-label="Virtual office sidebar">
          <header className="sidebar-header">
            {avatar ? (
              <div className="brand-mark brand-mark-avatar">
                <img src={avatar.src} alt="Profile avatar" />
              </div>
            ) : avatarChecked ? (
              <div className="brand-mark">VO</div>
            ) : (
              /* Nothing drawn until the first answer: no green flash on reload. */
              <div className="brand-mark brand-mark-pending" aria-hidden="true" />
            )}
            <div className="brand-copy">
              <span>VIRTUAL OFFICE</span>
              <strong title={profileName ?? undefined}>{profileName ?? "Workspace"}</strong>
            </div>
            <span className="live-indicator" aria-label="Active session" />
            <button
              className="sidebar-hide-button"
              onClick={() => setSidebarVisible(false)}
              aria-label="Hide sidebar"
              title="Hide sidebar"
            >
              ‹
            </button>
          </header>

          <div className="sidebar-content">
            <section className="sidebar-card clock-card">
              <div className="section-eyebrow">
                <span>OFFICE TIME</span>
                <span className="live-badge">LIVE</span>
              </div>
              <strong className="clock-time">
                {new Date(now).toLocaleTimeString("id-ID", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </strong>
              <span className="muted">
                {new Date(now).toLocaleDateString("id-ID", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </span>
            </section>

            <section className="sidebar-section">
              <div className="section-heading">
                <h2>Team activity</h2>
                <span className="source-badge" data-source={source.source} title={source.reason ?? `source: ${source.source}`}>
                  {source.source === "openbot" ? "Live" : source.source === "mock" ? "Mock" : "Connecting"}
                </span>
                <span>{source.source === "pending" ? "connecting…" : `${employees.length} members`}</span>
              </div>
              <div className="status-list">
                {AGENT_PHASES.map((p) => {
                  const members = employees
                    .filter((e) => e.phase === p)
                    .sort((a, b) => a.name.localeCompare(b.name));
                  const count = members.length;
                  const open = openPhase === p && count > 0;
                  return (
                    <div className="status-group" key={p}>
                      {/* A row is the button: same grid as before, one extra
                          caret cell so the expanded state is visible. Rows with
                          no members stay inert — nothing to list. */}
                      <button
                        type="button"
                        className="status-row"
                        aria-expanded={open}
                        aria-controls={count ? `phase-members-${p}` : undefined}
                        disabled={count === 0}
                        onClick={() => setOpenPhase((cur) => (cur === p ? null : p))}
                      >
                        <i
                          className="dot"
                          style={{ background: PHASE_COLORS[p] }}
                        />
                        <span>{PHASE_LABEL[p]}</span>
                        <span className="status-meta">
                          <strong>{count}</strong>
                          <i className="status-caret" aria-hidden="true">
                            {count ? (open ? "−" : "+") : ""}
                          </i>
                        </span>
                        <div className="status-track">
                          <span
                            style={{
                              width: `${(count / Math.max(employees.length, 1)) * 100}%`,
                              background: PHASE_COLORS[p],
                            }}
                          />
                        </div>
                      </button>
                      {open && (
                        <ul className="status-members" id={`phase-members-${p}`}>
                          {members.map((m) => (
                            <li key={m.id}>
                              <button
                                type="button"
                                onClick={() => focusAgent(m.id)}
                                title={`Locate and follow ${m.name} in the office`}
                              >
                                {m.name}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="sidebar-section updates-section">
              <div className="section-heading">
                <h2>Updates</h2>
                <span className="updates-count">{recentNotices.length}</span>
              </div>
              {recentNotices.length ? (
                <div className="notice-list">
                  {recentNotices.map((n) => (
                    <div key={n.id} className="sidebar-notice">
                      {n.text}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-notices">No recent updates.</p>
              )}
            </section>

            <section className="sidebar-section settings-section">
              <button
                className="settings-toggle"
                onClick={() => setSettings(!settingsOpen)}
                aria-expanded={settingsOpen}
              >
                <span>⚙</span> Settings{" "}
                <span className="settings-chevron">
                  {settingsOpen ? "−" : "+"}
                </span>
              </button>
              {settingsOpen && (
                <>
                  <label className="settings-option">
                    <input
                      type="checkbox"
                      checked={showLabels}
                      onChange={toggleLabels}
                    />
                    <span>Show names &amp; status</span>
                  </label>
                  <label className="settings-option settings-select">
                    <span>Theme</span>
                    <select
                      value={themeMode}
                      onChange={(e) =>
                        setThemeMode(
                          e.target.value === 'light' || e.target.value === 'dark'
                            ? e.target.value
                            : 'system'
                        )
                      }
                    >
                      <option value="system">System</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </label>
                  <label className="settings-option settings-select">
                    <span>Atmosphere</span>
                    <select
                      value={daylightMode}
                      onChange={(e) => {
                        const v = e.target.value as DaylightMode;
                        if (DAYLIGHT_MODES.includes(v)) setDaylightMode(v);
                      }}
                    >
                      {DAYLIGHT_MODES.map((m) => (
                        <option key={m} value={m}>
                          {DAYLIGHT_LABEL[m]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label
                    className="settings-option"
                    title="Enable Low-Key dark ambient shadows, Pools of Light, and warm lamps at night/dusk"
                  >
                    <input
                      type="checkbox"
                      checked={moodyLighting}
                      onChange={(e) => setMoodyLighting(e.target.checked)}
                    />
                    <span>Moody night lighting</span>
                  </label>
                  <label className="settings-option settings-select">
                    <span>Floor style</span>
                    <select
                      value={floorStyle}
                      onChange={(e) => {
                        const v = e.target.value as FloorStyle;
                        if (FLOOR_STYLES.includes(v)) setFloorStyle(v);
                      }}
                    >
                      {FLOOR_STYLES.map((f) => (
                        <option key={f} value={f}>
                          {FLOOR_STYLE_LABEL[f]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="settings-option settings-select">
                    <span>Plant style</span>
                    <select
                      value={plantStyle}
                      onChange={(e) => {
                        const v = e.target.value as PlantStyle;
                        if (PLANT_STYLES.includes(v)) setPlantStyle(v);
                      }}
                    >
                      {PLANT_STYLES.map((p) => (
                        <option key={p} value={p}>
                          {PLANT_STYLE_LABEL[p]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="settings-option settings-select">
                    <span>Sidebar font</span>
                    <select
                      value={sidebarFont}
                      onChange={(e) =>
                        setSidebarFont(e.target.value === 'pixel' ? 'pixel' : 'mono')
                      }
                    >
                      <option value="mono">Monospace</option>
                      <option value="pixel">Geist Pixel</option>
                    </select>
                  </label>
                </>
              )}
            </section>
          </div>

          <footer className="sidebar-footer">
            <div className="sidebar-actions">
              <button type="button" onClick={() => setHelp(true)} className="action-btn">
                <span className="action-icon" aria-hidden="true">?</span>
                <span className="action-label">Help</span>
              </button>
              <button type="button" onClick={() => setExited(true)} className="action-btn action-btn--exit">
                <span className="action-icon" aria-hidden="true">⏻</span>
                <span className="action-label">Exit</span>
              </button>
            </div>
            <div className="sidebar-links">
              <a href="https://github.com/nightly-labs/openbot-virtual-office" target="_blank" rel="noopener noreferrer" className="footer-link" title="GitHub repository">
                <svg className="footer-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.835 1.305 3.525.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.37 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.855 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
                <span className="footer-label">GitHub</span>
              </a>
              <a href="https://openbot.run" target="_blank" rel="noopener noreferrer" className="footer-link" title="OpenBot website">
                <svg className="footer-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1.46l1-.39L9 14.5v-3.8c0-.54.45-.99.99-.99.34 0 .67.14.9.36.23.23.36.57.36.9 0 .07-.1.53-.1.94L8.34 15H10l-.6 1.89c-.08.32-.14.75-.14 1.04 0 4.08 3.04 7.44 7 7.93v-1.02z"/></svg>
                <span className="footer-label">Website</span>
              </a>
            </div>
            <div className="sidebar-controls">
              <span className="section-eyebrow">Camera Controls</span>
              <div className="control-row">
                <kbd>WASD</kbd>
                <span className="control-sep" aria-hidden="true">/</span>
                <kbd>↑↓←→</kbd>
                <span className="control-desc">Move</span>
              </div>
              <div className="control-row">
                <kbd>Drag</kbd>
                <span className="control-sep" aria-hidden="true">·</span>
                <kbd>Scroll</kbd>
                <span className="control-desc">Pan / Zoom</span>
              </div>
            </div>
          </footer>
        </aside>
      ) : (
        <button
          className="sidebar-reopen-button"
          onClick={() => setSidebarVisible(true)}
          aria-label="Show sidebar"
          title="Show sidebar"
        >
          <span aria-hidden="true">☰</span> Show menu
        </button>
      )}

      {helpOpen && (
        <div className="overlay" onClick={() => setHelp(false)}>
          <div className="panel modal" onClick={(e) => e.stopPropagation()}>
            <h3>Virtual Office – Help</h3>
            <p>
              2D 32-bit pixel-art office (elevated top-down).{' '}
              {source.source === 'openbot'
                ? 'Connected live to OpenBot agent telemetry.'
                : 'Running mock demo data; statuses rotate automatically.'}
            </p>
            <ul>
              <li>WASD / arrows / mouse drag: move camera</li>
              <li>Scroll, +/- or toolbar: zoom (pixels stay crisp)</li>
              <li>Top-right bar: quick-jump to Lounge, Meeting, Pantry, NOC or Desks</li>
              <li>Click a character or desk: inspect details &amp; toggle Follow</li>
              <li>Settings → Atmosphere: switch Clock, Dawn, Day, Dusk or Night</li>
              {source.source === 'mock' && <li>E: randomize mock employee status</li>}
            </ul>
            <button onClick={() => setHelp(false)}>Close</button>
          </div>
        </div>
      )}
      {exited && (
        <div className="overlay solid">
          <div className="panel modal">
            <h3>You have exited</h3>
            <p>Virtual Office session ended.</p>
            <button onClick={() => setExited(false)}>Re-enter</button>
          </div>
        </div>
      )}

      <div className="stage-controls" role="toolbar" aria-label="Office camera controls">
        <div className="stage-rooms">
          {ROOM_JUMPS.map((room) => (
            <button
              key={room.label}
              type="button"
              onClick={() => focusPoint(room.x, room.y, 1.25, room.box)}
              title={`Jump camera to ${room.label} (125%)`}
            >
              {room.label}
            </button>
          ))}
        </div>
        <div className="stage-zoom">
          <button
            type="button"
            onClick={() => triggerZoom("out")}
            aria-label="Zoom out"
            title="Zoom out (−)"
          >
            −
          </button>
          <button
            type="button"
            className="stage-zoom-readout"
            onClick={() => triggerZoom("reset")}
            title="Reset zoom to 75%"
          >
            {zoomPercent}%
          </button>
          <button
            type="button"
            onClick={() => triggerZoom("in")}
            aria-label="Zoom in"
            title="Zoom in (+)"
          >
            +
          </button>
        </div>
      </div>

      {hoveredAgent && (
        <div
          className="canvas-hover-tip"
          style={{
            left: Math.min(
              typeof window !== "undefined" ? Math.max(12, window.innerWidth - 252) : hoveredAgent.screenX + 14,
              Math.max(12, hoveredAgent.screenX + 14),
            ),
            top: Math.max(12, Math.min(
              typeof window !== "undefined" ? window.innerHeight - 64 : hoveredAgent.screenY - 54,
              hoveredAgent.screenY - 54,
            )),
          }}
        >
          <div className="hover-tip-head">
            <span className="hover-tip-dot" style={{ background: hoveredAgent.phaseColor }} />
            <strong>{hoveredAgent.name}</strong>
            <span className="hover-tip-phase">{hoveredAgent.phaseLabel}</span>
          </div>
          <div className="hover-tip-sub">
            {hoveredAgent.role} · {hoveredAgent.zone}
          </div>
        </div>
      )}
    </>
  );
}
