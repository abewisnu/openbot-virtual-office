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
  const [logo, setLogo] = useState<{ src: string; version: string } | null>(null);
  const [logoChecked, setLogoChecked] = useState(false);
  const logoUrl = useRef<string | null>(null);

  // The workspace logo lives in OpenBot's own app-support folder and is exposed
  // by the dev API only as image bytes. It is re-read on focus and every 20 s so
  // a logo replaced inside OpenBot shows up without a page reload. Nothing is
  // drawn until the first answer arrives, which keeps the reload free of a
  // flash of the built-in mark.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
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
