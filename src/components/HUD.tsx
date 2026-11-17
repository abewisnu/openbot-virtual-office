import { useEffect, useRef, useState } from "react";
import { useStore } from "../store/useStore";
import { PHASE_COLORS, PHASE_LABEL } from "../constants";
import { AGENT_PHASES } from "../types";
import type { AgentPhase } from "../types";

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
    helpOpen,
    setHelp,
    settingsOpen,
    setSettings,
    exited,
    setExited,
    source,
    select,
  } = useStore();
  const [now, setNow] = useState(Date.now());
  const [sidebarVisible, setSidebarVisible] = useState(true);
  // Which "Team activity" row is expanded to show the agents behind its count.
  const [openPhase, setOpenPhase] = useState<AgentPhase | null>(null);
  const [logo, setLogo] = useState<{ src: string; version: string } | null>(null);
  const [logoChecked, setLogoChecked] = useState(false);
  // Profile name of the person using this OpenBot, taken from OpenBot's own
  // config. `null` means the sidebar keeps its neutral "Workspace" label.
  const [profileName, setProfileName] = useState<string | null>(null);
  const logoUrl = useRef<string | null>(null);

  // Workspace identity (logo and name) lives in OpenBot's own app-support folder
  // and is exposed by the dev API as image bytes plus a plain name string. Both
  // are re-read on focus and every 20 s so a change made inside OpenBot shows up
  // without a page reload. Nothing is drawn until the first answer arrives, which
  // keeps a reload free of a flash of the built-in mark.
  useEffect(() => {
    let cancelled = false;

    const loadLogo = async () => {
      try {
        const res = await fetch('/api/office-logo', { headers: { Accept: 'image/*' }, cache: 'no-store' });
        const type = res.headers.get('content-type') ?? '';
        if (cancelled) return;
        if (res.status !== 200 || !type.startsWith('image/')) {
          setLogoChecked(true);
          return;
        }
        const version = res.headers.get('x-office-logo-version') ?? res.headers.get('etag') ?? '';
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setLogo((prev) => {
          if (prev && prev.src === url) return prev;
          if (logoUrl.current) URL.revokeObjectURL(logoUrl.current);
          logoUrl.current = url;
          return { src: url, version };
        });
        setLogoChecked(true);
      } catch {
        if (!cancelled) setLogoChecked(true);
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

    const load = () => Promise.all([loadLogo(), loadName()]);

    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    const t = window.setInterval(() => void load(), 20_000);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      window.clearInterval(t);
      if (logoUrl.current) URL.revokeObjectURL(logoUrl.current);
      logoUrl.current = null;
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
            {logo ? (
              <div className="brand-mark brand-mark-logo">
                <img src={logo.src} alt="Workspace logo" />
              </div>
            ) : logoChecked ? (
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
                                onClick={() => select(m.id)}
                                title={`Show ${m.name} in the office`}
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
              <button onClick={() => setHelp(true)}>? Help</button>
              <button className="exit-button" onClick={() => setExited(true)}>
                ⏻ Exit
              </button>
            </div>
            <div className="sidebar-controls">
              <span className="section-eyebrow">CAMERA CONTROLS</span>
              <p>
                <kbd>WASD</kbd> / <kbd>↑↓←→</kbd> move
              </p>
              <p>
                <kbd>Drag</kbd> pan · <kbd>Scroll</kbd> zoom
              </p>
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
              2D pixel-art office world (elevated top-down). All data is
              mock; employee status changes automatically.
            </p>
            <ul>
              <li>WASD / arrows / mouse drag: move camera</li>
              <li>Scroll or +/-: zoom (pixels stay sharp)</li>
              <li>Click a character: view info &amp; change status</li>
              <li>E: randomize employee status</li>
            </ul>
            <button onClick={() => setHelp(false)}>Close</button>
          </div>
        </div>
      )}
      {exited && (
        <div className="overlay solid">
          <div className="panel modal">
            <h3>You have exited</h3>
            <p>Virtual Office demo session ended.</p>
            <button onClick={() => setExited(false)}>Re-enter</button>
          </div>
        </div>
      )}
    </>
  );
}
