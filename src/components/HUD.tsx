import { useEffect, useState } from "react";
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
    helpOpen,
    setHelp,
    settingsOpen,
    setSettings,
    exited,
    setExited,
    source,
  } = useStore();
  const [now, setNow] = useState(Date.now());
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [logoSrc, setLogoSrc] = useState<string | null>(null);

  // The workspace logo lives in OpenBot's own app-support folder and is exposed
  // by the dev API only as image bytes. A 204 (no logo) or a static host that
  // answers with HTML leaves the plain "VO" mark in place.
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetch('/api/office-logo', { headers: { Accept: 'image/*' } })
      .then((r) => {
        const type = r.headers.get('content-type') ?? '';
        if (r.status !== 200 || !type.startsWith('image/')) return null;
        return r.blob();
      })
      .then((blob) => {
        if (!blob || cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setLogoSrc(objectUrl);
      })
      .catch(() => {
        /* keep the built-in mark */
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const phaseCounts = employees.reduce(
    (a, e) => ({ ...a, [e.phase]: (a[e.phase] ?? 0) + 1 }),
    {} as Record<AgentPhase, number>,
  );
  const recentNotices = notices
    .filter((n) => now - n.ts < 9000)
    .slice(-3)
    .reverse();
  return (
    <>
      {sidebarVisible ? (
        <aside className="hud-sidebar" aria-label="Virtual office sidebar">
          <header className="sidebar-header">
            <div className={logoSrc ? 'brand-mark brand-mark-logo' : 'brand-mark'}>
              {logoSrc ? (
                <img src={logoSrc} alt="Workspace logo" />
              ) : (
                'VO'
              )}
            </div>
            <div className="brand-copy">
              <span>VIRTUAL OFFICE</span>
              <strong>Workspace</strong>
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
                  {source.source === "openbot" ? "Live" : "Mock"}
                </span>
                <span>{employees.length} members</span>
              </div>
              <div className="status-list">
                {AGENT_PHASES.map((p) => (
                  <div className="status-row" key={p}>
                    <i
                      className="dot"
                      style={{ background: PHASE_COLORS[p] }}
                    />
                    <span>{PHASE_LABEL[p]}</span>
                    <strong>{phaseCounts[p] ?? 0}</strong>
                    <div className="status-track">
                      <span
                        style={{
                          width: `${((phaseCounts[p] ?? 0) / Math.max(employees.length, 1)) * 100}%`,
                          background: PHASE_COLORS[p],
                        }}
                      />
                    </div>
                  </div>
                ))}
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
                <label className="settings-option">
                  <input
                    type="checkbox"
                    checked={showLabels}
                    onChange={toggleLabels}
                  />
                  <span>Show names &amp; status</span>
                </label>
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
