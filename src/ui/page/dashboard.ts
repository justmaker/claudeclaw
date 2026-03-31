export function dashboardPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ClaudeClaw Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; padding: 24px; }
    h1 { font-size: 1.5rem; margin-bottom: 24px; color: #f59e0b; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
    .card { background: #1e293b; border-radius: 12px; padding: 20px; border: 1px solid #334155; }
    .card h2 { font-size: 1rem; color: #94a3b8; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 500; }
    .stat { font-size: 2rem; font-weight: 700; color: #f1f5f9; }
    .stat-label { font-size: 0.8rem; color: #64748b; margin-top: 2px; }
    .stat-row { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 8px; }
    .stat-item { flex: 1; min-width: 80px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { text-align: left; padding: 6px 8px; font-size: 0.85rem; }
    th { color: #94a3b8; border-bottom: 1px solid #334155; }
    td { color: #cbd5e1; border-bottom: 1px solid #1e293b; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
    .badge-green { background: #065f46; color: #6ee7b7; }
    .badge-yellow { background: #713f12; color: #fcd34d; }
    .badge-gray { background: #374151; color: #9ca3af; }
    .refresh-info { font-size: 0.75rem; color: #475569; text-align: right; margin-top: 16px; }
    .error { color: #f87171; font-size: 0.85rem; }
    a { color: #38bdf8; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .nav { margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="nav"><a href="/">← Main UI</a></div>
  <h1>🦞 ClaudeClaw Dashboard</h1>
  <div class="grid">
    <div class="card" id="status-card">
      <h2>⚙️ Status</h2>
      <div id="status-content">Loading...</div>
    </div>
    <div class="card" id="queue-card">
      <h2>📋 Queue</h2>
      <div id="queue-content">Loading...</div>
    </div>
    <div class="card" id="sessions-card">
      <h2>💬 Sessions</h2>
      <div id="sessions-content">Loading...</div>
    </div>
    <div class="card" id="metrics-card">
      <h2>📊 Metrics (7 days)</h2>
      <div id="metrics-content">Loading...</div>
    </div>
  </div>
  <div class="refresh-info">Auto-refresh every 10s · <span id="last-update">-</span></div>

  <script>
    function fmt(ms) {
      const s = Math.floor(ms / 1000);
      if (s < 60) return s + 's';
      if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      return h + 'h ' + m + 'm';
    }

    async function load(url) {
      try {
        const r = await fetch(url);
        return await r.json();
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }

    async function refresh() {
      const [status, queue, sessions, metrics] = await Promise.all([
        load('/api/status'),
        load('/api/queue'),
        load('/api/sessions'),
        load('/api/metrics?days=7'),
      ]);

      // Status
      const sc = document.getElementById('status-content');
      if (status.ok) {
        sc.innerHTML =
          '<div class="stat-row">' +
          '<div class="stat-item"><div class="stat">' + fmt(status.uptime_ms) + '</div><div class="stat-label">Uptime</div></div>' +
          '<div class="stat-item"><div class="stat">' + (status.session_count ?? 0) + '</div><div class="stat-label">Sessions</div></div>' +
          '</div>' +
          '<div style="margin-top:8px;font-size:0.85rem;color:#94a3b8;">' +
          'Model: <strong>' + (status.model || 'default') + '</strong> · ' +
          'PID: ' + status.pid + ' · ' +
          'Heartbeat: <span class="badge ' + (status.heartbeat_enabled ? 'badge-green' : 'badge-gray') + '">' + (status.heartbeat_enabled ? 'ON' : 'OFF') + '</span>' +
          '</div>';
      } else {
        sc.innerHTML = '<div class="error">Failed to load status</div>';
      }

      // Queue
      const qc = document.getElementById('queue-content');
      if (queue.ok) {
        qc.innerHTML =
          '<div class="stat-row">' +
          '<div class="stat-item"><div class="stat">' + queue.running + '</div><div class="stat-label">Running</div></div>' +
          '<div class="stat-item"><div class="stat">' + queue.queued + '</div><div class="stat-label">Queued</div></div>' +
          '</div>';
      } else {
        qc.innerHTML = '<div class="error">Failed to load queue</div>';
      }

      // Sessions
      const ssc = document.getElementById('sessions-content');
      if (sessions.ok) {
        if (sessions.sessions.length === 0) {
          ssc.innerHTML = '<div style="color:#64748b;">No active sessions</div>';
        } else {
          let html = '<table><tr><th>ID</th><th>Turns</th><th>Last Used</th></tr>';
          for (const s of sessions.sessions) {
            const ago = s.last_used_at ? fmt(Date.now() - new Date(s.last_used_at).getTime()) + ' ago' : '-';
            html += '<tr><td>' + s.session_id_short + '…</td><td>' + (s.turn_count ?? '-') + '</td><td>' + ago + '</td></tr>';
          }
          html += '</table>';
          ssc.innerHTML = html;
        }
      } else {
        ssc.innerHTML = '<div class="error">Failed to load sessions</div>';
      }

      // Metrics
      const mc = document.getElementById('metrics-content');
      if (metrics.ok) {
        mc.innerHTML =
          '<div class="stat-row">' +
          '<div class="stat-item"><div class="stat">' + metrics.total_sessions + '</div><div class="stat-label">Total Sessions</div></div>' +
          '<div class="stat-item"><div class="stat">' + (metrics.success_rate || '0%') + '</div><div class="stat-label">Success Rate</div></div>' +
          '</div>' +
          '<div style="margin-top:8px;font-size:0.85rem;color:#94a3b8;">' +
          'Input tokens: ' + (metrics.total_input_tokens ?? 0).toLocaleString() + ' · ' +
          'Output tokens: ' + (metrics.total_output_tokens ?? 0).toLocaleString() + ' · ' +
          'Avg duration: ' + fmt(metrics.avg_duration_ms || 0) +
          '</div>';
      } else {
        mc.innerHTML = '<div class="error">Failed to load metrics</div>';
      }

      document.getElementById('last-update').textContent = new Date().toLocaleTimeString();
    }

    refresh();
    setInterval(refresh, 10000);
  </script>
</body>
</html>`;
}
