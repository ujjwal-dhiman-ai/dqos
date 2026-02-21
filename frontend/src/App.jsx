import { useState, useEffect } from 'react'
import axios from 'axios'
import './App.css'

// --- Skeleton Loader ---
const Skeleton = ({ rows = 5 }) => (
  <div style={{ padding: '12px' }}>
    {Array(rows).fill(0).map((_, i) => (
      <div key={i} className="skeleton sk-row" style={{ opacity: 1 - i * 0.12 }} />
    ))}
  </div>
)

// --- Empty State ---
const EmptyState = ({ icon, title, sub, action }) => (
  <div className="empty-state">
    <div className="empty-icon">{icon}</div>
    <div className="empty-title">{title}</div>
    {sub && <div className="empty-sub">{sub}</div>}
    {action}
  </div>
)

// --- Results Table ---
const ResultsTable = ({ data }) => {
  if (!data || data.length === 0) return (
    <EmptyState icon="✓" title="Zero rows returned" sub="This is expected for a passing rule — no anomalies detected." />
  )
  const headers = Object.keys(data[0])
  return (
    <div className="table-wrapper scrollable">
      <table className="rule-table">
        <thead><tr>{headers.map(h => <th key={h}>{h.toUpperCase()}</th>)}</tr></thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              {headers.map(h => (
                <td key={h} className="mono" style={{ minWidth: 120, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {typeof row[h] === 'object' ? JSON.stringify(row[h]) : String(row[h] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// --- History Results Modal ---
const DataModal = ({ data, onClose }) => {
  if (!data) return null
  let parsedData = []
  try { parsedData = typeof data === 'string' ? JSON.parse(data) : data } catch (e) { parsedData = [] }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <span className="modal-title">Run Results</span>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>×</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
          <ResultsTable data={parsedData} />
        </div>
      </div>
    </div>
  )
}

function App() {
  const [activeTab, setActiveTab] = useState('playground')

  // PLAYGROUND STATE
  const [sql, setSql] = useState("SELECT * FROM table...")
  const [params, setParams] = useState('{}')
  const [result, setResult] = useState(null)
  const [pgIsRunning, setPgIsRunning] = useState(false)

  // RULE MANAGEMENT STATE
  const [rules, setRules] = useState([])
  const [ruleName, setRuleName] = useState("")
  const [editingId, setEditingId] = useState(null) // Track if we are editing


  // HISTORY STATE
  const [history, setHistory] = useState([])
  const [modalData, setModalData] = useState(null) // For the popup

  // DATA HUB FORM STATE
  const [sources, setSources] = useState([])
  const [selectedSourceId, setSelectedSourceId] = useState("")
  const [editingSourceId, setEditingSourceId] = useState(null);
  const [newSourceName, setNewSourceName] = useState("")
  const [newSourceUrl, setNewSourceUrl] = useState("")
  const [newSourceType, setNewSourceType] = useState("") // Default to postgres
  const [dataHubView, setDataHubView] = useState('list') // Options: 'list', 'create'
  const [connMode, setConnMode] = useState('url'); // Options: 'url' or 'form'
  const [dbCreds, setDbCreds] = useState({
    host: 'localhost',
    port: '5432',
    user: 'postgres',
    password: '',
    dbname: 'postgres'
  });
  const [sourceErrors, setSourceErrors] = useState({})
  const [playgroundErrors, setPlaygroundErrors] = useState({})

  // SCHEDULE STATE
  const [schedules, setSchedules] = useState([])
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [scheduleData, setScheduleData] = useState({ rule_id: null, name: '', cron: '0 0 * * *' }) // Default: Daily at midnight

  // DARK MODE
  const [darkMode, setDarkMode] = useState(false)

  const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";


  const fetchSchedules = async () => {
    try { const res = await axios.get(`${API_URL}/schedules/`); setSchedules(res.data) }
    catch (err) { console.error(err) }
  }

  useEffect(() => {
    fetchSources()
    if (activeTab === 'rules') fetchRules()
    if (activeTab === 'history') fetchHistory()
    if (activeTab === 'schedules') fetchSchedules() // <--- NEW
  }, [activeTab])

  // HELPER: Auto-generate URL when form changes
  useEffect(() => {
    if (connMode === 'form') {
      let generatedUrl = "";
      const { host, port, user, password, dbname } = dbCreds;

      // Basic logic to construct URL based on selected Type
      if (newSourceType.includes('postgres')) {
        generatedUrl = `postgresql://${user}:${password}@${host}:${port}/${dbname}`;
      } else if (newSourceType.includes('mysql')) {
        generatedUrl = `mysql+pymysql://${user}:${password}@${host}:${port}/${dbname}`;
      } else if (newSourceType.includes('mssql')) {
        generatedUrl = `mssql+pyodbc://${user}:${password}@${host}/${dbname}?driver=ODBC+Driver+17+for+SQL+Server`;
      } else if (newSourceType.includes('snowflake')) {
        generatedUrl = `snowflake://${user}:${password}@${host}/${dbname}`;
      }
      setNewSourceUrl(generatedUrl);
    }
  }, [dbCreds, newSourceType, connMode]);

  const handleScheduleSubmit = async () => {
    try {
      await axios.post(`${API_URL}/schedules/`, {
        rule_id: scheduleData.rule_id,
        name: scheduleData.name,
        cron_expression: scheduleData.cron
      });
      alert("Rule Scheduled Successfully!");
      setShowScheduleModal(false);
      fetchSchedules();
    } catch (err) { alert("Failed to schedule: " + err.message); }
  }

  const deleteSchedule = async (ruleId) => {
    if (!window.confirm("Remove this schedule?")) return;
    try {
      await axios.delete(`${API_URL}/schedules/${ruleId}`);
      fetchSchedules();
    } catch (err) { alert("Failed to delete: " + err.message); }
  }

  const toggleSchedule = async (ruleId) => {
    try {
      await axios.put(`${API_URL}/schedules/${ruleId}/toggle`);
      fetchSchedules(); // Refresh to update the UI buttons
    } catch (err) {
      alert("Failed to toggle: " + (err.response?.data?.detail || err.message));
    }
  }

  const fetchSources = async () => {
    try { const res = await axios.get(`${API_URL}/sources/`); setSources(res.data) }
    catch (err) { console.error(err) }
  }

  const fetchRules = async () => {
    try { const res = await axios.get(`${API_URL}/rules/`); setRules(res.data) }
    catch (err) { console.error(err) }
  }

  const fetchHistory = async () => {
    try { const res = await axios.get(`${API_URL}/history/`); setHistory(res.data) }
    catch (err) { console.error(err) }
  }

  const parseConnectionUrl = (url) => {
    if (!url) return null;
    try {
      // Normalize dialect+driver:// to a plain dialect:// so URL() can parse it
      const normalized = url.replace(/^([a-z]+)\+[a-z0-9]+:\/\//, '$1://');
      const parsed = new URL(normalized);
      return {
        host: parsed.hostname || 'localhost',
        port: parsed.port || '5432',
        user: decodeURIComponent(parsed.username || ''),
        password: decodeURIComponent(parsed.password || ''),
        dbname: (parsed.pathname || '').replace(/^\//, '')
      };
    } catch (e) {
      return null;
    }
  };

  const resetForm = () => {
    setEditingSourceId(null);
    setNewSourceName("");
    setNewSourceUrl("");
    setNewSourceType("");
    setConnMode('form'); // Reset to default mode
    setDbCreds({ host: 'localhost', port: '5432', user: 'postgres', password: '', dbname: 'postgres' });
    setSourceErrors({});
  }

  const resetPlayground = () => {
    setEditingId(null);
    setRuleName("");
    setSql("SELECT * FROM table...");
    setParams("{}");
    setSelectedSourceId("");
    setResult(null);
    setPlaygroundErrors({});
  }

  const validateSourceForm = () => {
    const errors = {}
    const trimmedName = newSourceName.trim()
    const trimmedType = newSourceType.trim()
    const trimmedUrl = newSourceUrl.trim()

    if (!trimmedName) errors.name = 'Source name is required.'
    if (!trimmedType) errors.type = 'Database type is required.'
    if (!trimmedUrl) errors.connection_url = 'Connection string is required.'

    if (connMode === 'form') {
      const { host, port, user, password, dbname } = dbCreds
      if (!host.trim()) errors.host = 'Host is required.'
      if (!port.trim()) errors.port = 'Port is required.'
      else if (!/^\d+$/.test(port.trim()) || Number(port.trim()) <= 0) errors.port = 'Port must be a positive number.'
      if (!user.trim()) errors.user = 'Username is required.'
      if (!password.trim()) errors.password = 'Password is required.'
      if (!dbname.trim()) errors.dbname = 'Database name is required.'
    }

    setSourceErrors(errors)
    return {
      isValid: Object.keys(errors).length === 0,
      trimmedName,
      trimmedType,
      trimmedUrl
    }
  }

  const validatePlayground = ({ requireRuleName = false } = {}) => {
    const errors = {}

    let sourceId = Number(selectedSourceId)
    if (!selectedSourceId || !Number.isInteger(sourceId) || sourceId <= 0) {
      errors.source_id = 'Please select a valid Data Source.'
      sourceId = null
    }

    const trimmedSql = sql.trim()
    if (!trimmedSql) errors.sql = 'SQL Query is required.'

    if (requireRuleName && !ruleName.trim()) errors.rule_name = 'Rule name is required.'

    let parsedParams = {}
    try {
      parsedParams = params.trim() ? JSON.parse(params) : {}
      if (typeof parsedParams !== 'object' || parsedParams === null || Array.isArray(parsedParams)) {
        errors.params = 'Parameters must be a valid JSON object.'
      }
    } catch {
      errors.params = 'Invalid JSON format in Parameters.'
    }

    setPlaygroundErrors(errors)
    return {
      isValid: Object.keys(errors).length === 0,
      sourceId,
      trimmedSql,
      parsedParams
    }
  }

  const saveOrUpdateSource = async () => {
    const { isValid, trimmedName, trimmedType, trimmedUrl } = validateSourceForm()
    if (!isValid) return

    const payload = {
      name: trimmedName,
      connection_url: trimmedUrl,
      type: trimmedType
    };

    try {
      if (editingSourceId) {
        // UPDATE EXISTING
        await axios.put(`${API_URL}/sources/${editingSourceId}`, payload);
        alert("Source Updated!");
      } else {
        // CREATE NEW
        await axios.post(`${API_URL}/sources/`, payload);
        alert("Source Created!");
      }

      resetForm();

      // Reset Form & View
      await fetchSources();
      setDataHubView('list');

    } catch (err) {
      setSourceErrors(prev => ({ ...prev, form: err.response?.data?.detail || err.message }))
    }
  }

  const deleteSource = async (id) => {
    if (!window.confirm("Are you sure? This cannot be undone.")) return;
    try {
      await axios.delete(`${API_URL}/sources/${id}`);
      alert("Source deleted");
      fetchSources();
    } catch (err) {
      alert("Error: " + (err.response?.data?.detail || err.message));
    }
  }

  const runAdHoc = async () => {
    const { isValid, sourceId, trimmedSql, parsedParams } = validatePlayground()
    if (!isValid) return

    setPgIsRunning(true);
    setResult(null); // Clear previous results

    try {
      // 1. MATCH YOUR BACKEND ENDPOINT EXACTLY
      const res = await axios.post(`${API_URL}/run-adhoc`, {
        source_id: sourceId,
        sql: trimmedSql,
        params: parsedParams
      });

      const responseData = res.data.data;

      // Extract column names dynamically
      let columns = [];
      if (responseData && responseData.length > 0) {
        columns = Object.keys(responseData[0]);
      }

      // 2. DETERMINE PASS/FAIL LOCALLY
      // Since your /run-adhoc doesn't return PASS/FAIL, we calculate it here: 0 rows = PASS
      const isPass = responseData.length === 0;

      // Update Result state
      setResult({
        status: 'success',
        rule_status: isPass ? 'PASS' : 'FAIL',
        columns: columns,
        data: responseData
      });

    } catch (err) {
      setResult({
        status: 'error',
        message: err.response?.data?.detail || err.message || "Execution failed."
      });
    } finally {
      setPgIsRunning(false);
    }
  }

  const saveOrUpdateRule = async () => {
    const { isValid, sourceId, trimmedSql, parsedParams } = validatePlayground({ requireRuleName: true })
    if (!isValid) return

    try {
      // Send params in payload
      const payload = {
        name: ruleName.trim(),
        sql: trimmedSql,
        params: parsedParams,
        source_id: sourceId
      }

      if (editingId) {
        await axios.put(`${API_URL}/rules/${editingId}`, payload)
        alert("Rule Updated!")
      } else {
        await axios.post(`${API_URL}/rules/`, payload)
        alert("Rule Saved!")
      }

      setEditingId(null)
      setRuleName("")
      setPlaygroundErrors({})
      fetchRules()
      if (activeTab === 'playground') setActiveTab('rules')
    } catch (err) {
      alert("Error: " + (err.response?.data?.detail || err.message))
    }
  }

  const editRule = (rule) => {
    setSql(rule.sql_query)
    setRuleName(rule.name)
    // Load params back into the text box
    // The backend now returns them in the 'params' field (dict), so we stringify it
    setParams(JSON.stringify(rule.params || {}, null, 2))
    setSelectedSourceId(rule.source_id) // <--- Load saved source
    setEditingId(rule.id)
    setResult(null)
    setActiveTab('playground')
  }

  const executeRule = async (id) => {
    try {
      const res = await axios.post(`${API_URL}/run-rule/${id}`, {})
      alert(`Status: ${res.data.status}\nRows: ${res.data.data.length}`)
      if (activeTab === 'history') fetchHistory()
    } catch (err) { alert("Execution Failed: " + err.response?.data?.detail) }
  }

  const deleteRule = async (id) => {
    if (!window.confirm("Are you sure you want to delete this rule?")) return
    try {
      await axios.delete(`${API_URL}/rules/${id}`)
      setRules(prev => prev.filter(r => r.id !== id))
      if (editingId === id) resetPlayground()
      fetchRules()
    } catch (err) {
      alert("Error deleting rule: " + (err.response?.data?.detail || err.message))
    }
  }


  return (
    <div className={`container${darkMode ? ' dark' : ''}`}>

      {/* ”—€ History Results Modal ”—€ */}
      {modalData && <DataModal data={modalData} onClose={() => setModalData(null)} />}

      {/* ”—€ Schedule Creation Modal ”—€ */}
      {showScheduleModal && (
        <div className="modal-overlay" onClick={() => setShowScheduleModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Schedule Rule #{scheduleData.rule_id}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowScheduleModal(false)}>&#x2715;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Schedule Name</label>
                <input
                  value={scheduleData.name}
                  onChange={e => setScheduleData({ ...scheduleData, name: e.target.value })}
                  placeholder="e.g. Nightly User Check"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Frequency</label>
                <select
                  value={scheduleData.cron}
                  onChange={e => setScheduleData({ ...scheduleData, cron: e.target.value })}
                >
                  <option value="* * * * *">Every Minute (Testing)</option>
                  <option value="0 * * * *">Every Hour</option>
                  <option value="0 0 * * *">Daily at Midnight</option>
                  <option value="0 0 * * 0">Weekly (Sunday)</option>
                </select>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  Cron expression: <code style={{ fontFamily: 'monospace', background: 'var(--bg-card-alt)', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border-color)' }}>{scheduleData.cron}</code>
                </span>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowScheduleModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleScheduleSubmit}>Save Schedule</button>
            </div>
          </div>
        </div>
      )}

      {/* ――――――――――――――――――――――――――――――――――――――――
          SIDEBAR
          ―――――――――――――――――――――――――――――――――――――――― */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-icon">⚡</div>
          <div>
            <div className="brand-name">DQ OS</div>
            <div className="brand-sub">Data Quality</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <span className="nav-section-label">Workspace</span>
          {[
            { id: 'datahub', icon: '⊞', label: 'Data Hub' },
            { id: 'playground', icon: '⚡', label: 'Playground' },
            { id: 'rules', icon: '≡', label: 'Rule Library' },
            { id: 'schedules', icon: '⏱', label: 'Automations' },
            { id: 'history', icon: '≈', label: 'Run History' },
          ].map(item => (
            <button
              key={item.id}
              className={`nav-btn${activeTab === item.id ? ' active' : ''}`}
              onClick={() => { setActiveTab(item.id); if (item.id !== 'playground') resetPlayground(); }}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="sidebar-version">v1.0.0</span>
          <button
            className={`dark-toggle${darkMode ? ' on' : ''}`}
            onClick={() => setDarkMode(d => !d)}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          />
        </div>
      </aside>

      {/* ――――――――――――――――――――――――――――――――――――――――
          MAIN CONTENT
          ―――――――――――――――――――――――――――――――――――――――― */}
      <div className="main-content">

        {/* Top bar */}
        <header className="topbar">
          <div className="topbar-left">
            <div className="topbar-title">
              {{ datahub: 'Data Hub', playground: editingId ? `Editing Rule #${editingId}` : 'SQL Playground', rules: 'Rule Library', schedules: 'Automations', history: 'Run History' }[activeTab]}
            </div>
            <div className="topbar-sub">
              {{ datahub: 'Manage database connections', playground: 'Write, test & save data quality rules', rules: 'All saved validation rules', schedules: 'Scheduled rule executions', history: 'Execution logs & audit trail' }[activeTab]}
            </div>
          </div>
          <div className="topbar-right">
            {activeTab === 'playground' && (
              <>
                {/* {editingId && <button className="btn btn-secondary btn-sm" onClick={resetPlayground}>&#x2715; Cancel Edit</button>} */}
              </>
            )}
            {activeTab === 'history' && (
              <button className="btn btn-secondary btn-sm" onClick={fetchHistory}>&#x21BB; Refresh</button>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="page-content">

          {/* ―――――――――― PLAYGROUND ―――――――――― */}
          {activeTab === 'playground' && (
            <>
              {/* Stats row */}
              <div className="stat-grid">
                <div className="stat-card">
                  <div className="stat-header">
                    <span className="stat-label">Data Sources</span>
                    <div className="stat-icon indigo">⊞</div>
                  </div>
                  <div className="stat-value">{sources.length}</div>
                  <div className="stat-sub">Connected databases</div>
                </div>
                <div className="stat-card">
                  <div className="stat-header">
                    <span className="stat-label">Saved Rules</span>
                    <div className="stat-icon amber">≡</div>
                  </div>
                  <div className="stat-value">{rules.length}</div>
                  <div className="stat-sub">Validation rules</div>
                </div>
                <div className="stat-card">
                  <div className="stat-header">
                    <span className="stat-label">Passed (all-time)</span>
                    <div className="stat-icon green">✓</div>
                  </div>
                  <div className="stat-value">{history.filter(h => h.status === 'PASS').length}</div>
                  <div className="stat-sub">Successful checks</div>
                </div>
                <div className="stat-card">
                  <div className="stat-header">
                    <span className="stat-label">Failed (all-time)</span>
                    <div className="stat-icon red">✗</div>
                  </div>
                  <div className="stat-value">{history.filter(h => h.status === 'FAIL').length}</div>
                  <div className="stat-sub">Anomalies detected</div>
                </div>
              </div>

              {/* SQL Editor Card */}
              <div className="card">
                <div className="card-header">
                  <div>
                    <div className="card-title">SQL Editor</div>
                    <div className="card-subtitle">Write an anomaly query — rows returned = validation failures</div>
                  </div>
                </div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {/* Source selector */}
                  <div className="form-group">
                    <label className="form-label">Target Data Source <span className="required">*</span></label>
                    <select value={selectedSourceId} onChange={e => {
                      setSelectedSourceId(e.target.value)
                      setPlaygroundErrors(prev => ({ ...prev, source_id: undefined }))
                    }}>
                      <option value="">— Select a database —</option>
                      {sources.map(s => (
                        <option key={s.id} value={s.id}>{s.name} ({(s.type || 'DB').toUpperCase()})</option>
                      ))}
                    </select>
                    {playgroundErrors.source_id && <div className="field-error">{playgroundErrors.source_id}</div>}
                  </div>

                  {/* Editor split */}
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
                    <div className="form-group">
                      <label className="form-label">SQL Query</label>
                      <textarea
                        value={sql}
                        onChange={e => {
                          setSql(e.target.value)
                          setPlaygroundErrors(prev => ({ ...prev, sql: undefined }))
                        }}
                        className="code-input"
                        style={{ minHeight: 240 }}
                        spellCheck={false}
                      />
                      {playgroundErrors.sql && <div className="field-error">{playgroundErrors.sql}</div>}
                    </div>
                    <div className="form-group">
                      <label className="form-label">Parameters (JSON)</label>
                      <textarea
                        value={params}
                        onChange={e => {
                          setParams(e.target.value)
                          setPlaygroundErrors(prev => ({ ...prev, params: undefined }))
                        }}
                        className="code-input"
                        style={{ minHeight: 240 }}
                        spellCheck={false}
                      />
                      {playgroundErrors.params && <div className="field-error">{playgroundErrors.params}</div>}
                    </div>
                  </div>

                  {/* Rule name + action bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--bg-card-alt)', borderRadius: 'var(--radius)', border: '1px solid var(--border-color)' }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label className="form-label">Rule Name</label>
                      <input
                        placeholder="e.g. Check Null Emails"
                        value={ruleName}
                        onChange={e => {
                          setRuleName(e.target.value)
                          setPlaygroundErrors(prev => ({ ...prev, rule_name: undefined }))
                        }}
                        style={{ maxWidth: 380 }}
                      />
                      {playgroundErrors.rule_name && <div className="field-error">{playgroundErrors.rule_name}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', paddingTop: 20, flexShrink: 0 }}>
                      {editingId && <button className="btn btn-secondary btn-sm" onClick={resetPlayground}>&#x2715; Cancel Edit</button>}
                      <button className="btn btn-secondary" onClick={saveOrUpdateRule}>
                        &#x1F4BE; {editingId ? 'Update Rule' : 'Save Rule'}
                      </button>
                      <button className="btn btn-primary" onClick={runAdHoc} disabled={pgIsRunning}>
                        {pgIsRunning ? '... Running...' : '▶ Run Query'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Results Card */}
              {result && (
                <div className="card">
                  <div className="card-header">
                    <div>
                      <div className="card-title">Query Results</div>
                      <div className="card-subtitle">
                        {result.status === 'success' ? `${result.data?.length ?? 0} row${result.data?.length !== 1 ? 's' : ''} returned` : 'Execution error'}
                      </div>
                    </div>
                    {result.status === 'success' && (
                      <span className={`status-badge ${result.rule_status === 'PASS' ? 'pass' : 'fail'}`}>
                        {result.rule_status === 'PASS' ? '✓ PASS' : '✗ FAIL'} — {result.data?.length ?? 0} anomaly rows
                      </span>
                    )}
                  </div>
                  <div className="card-body">
                    {result.status === 'error' ? (
                      <div className="error-box"><strong>Execution Error:</strong>{'\n\n'}{result.message}</div>
                    ) : (
                      <div className="table-wrapper scrollable">
                        <table className="rule-table">
                          <thead><tr>{result.columns?.map((col, i) => <th key={i}>{col}</th>)}</tr></thead>
                          <tbody>
                            {result.data?.length === 0 ? (
                              <tr>
                                <td colSpan={result.columns?.length || 1}>
                                  <EmptyState icon="✓" title="Zero rows — rule passed" sub="No anomalies detected in the target dataset." />
                                </td>
                              </tr>
                            ) : (
                              result.data.map((row, ri) => (
                                <tr key={ri}>
                                  {result.columns.map((col, ci) => (
                                    <td key={ci} className="mono">
                                      {typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col] ?? '')}
                                    </td>
                                  ))}
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ―――――――――― RULE LIBRARY ―――――――――― */}
          {activeTab === 'rules' && (
            <div className="card" style={{ flex: 1 }}>
              <div className="card-header">
                <div>
                  <div className="card-title">Rule Library</div>
                  <div className="card-subtitle">{rules.length} rule{rules.length !== 1 ? 's' : ''} saved</div>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => { resetPlayground(); setActiveTab('playground'); }}>+ New Rule</button>
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                {rules.length === 0 ? (
                  <EmptyState
                    icon="≡"
                    title="No rules yet"
                    sub="Head to the Playground to write and save your first validation rule."
                    action={<button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={() => setActiveTab('playground')}>Open Playground</button>}
                  />
                ) : (
                  <table className="rule-table">
                    <thead><tr><th>Name</th><th>Data Source</th><th>Actions</th><th>Schedule</th></tr></thead>
                    <tbody>
                      {rules.map(r => (
                        <tr key={r.id}>
                          {/* <td className="text-muted text-xs font-mono">{r.id}</td> */}
                          <td className="strong">{r.name}</td>
                          <td><span className="type-pill">{sources.find(s => s.id === r.source_id)?.name || 'Unknown'}</span></td>
                          <td>
                            <div style={{ display: 'flex', gap: 7 }}>
                              <button className="btn btn-primary btn-sm" onClick={() => executeRule(r.id)}>&#x25B6; Run</button>
                              <button className="btn btn-secondary btn-sm" onClick={() => editRule(r)}>&#x270F; Edit</button>
                              <button className="btn btn-danger btn-sm" onClick={() => deleteRule(r.id)}>Delete</button>
                            </div>
                          </td>
                          <td>
                            <button
                              className="btn btn-success btn-sm"
                              onClick={() => { setScheduleData({ rule_id: r.id, name: r.name, cron: '0 0 * * *' }); setShowScheduleModal(true); }}
                            >&#x23F1; Schedule</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ―――――――――― DATA HUB ―――――――――― */}
          {activeTab === 'datahub' && (
            <>
              {/* List View */}
              {dataHubView === 'list' && (
                <div className="card" style={{ flex: 1 }}>
                  <div className="card-header">
                    <div>
                      <div className="card-title">Connected Sources</div>
                      <div className="card-subtitle">{sources.length} connection{sources.length !== 1 ? 's' : ''} registered</div>
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={() => { setDataHubView('create'); setEditingSourceId(null); resetForm(); }}>+ New Connection</button>
                  </div>
                  <div style={{ flex: 1, overflow: 'auto' }}>
                    {sources.length === 0 ? (
                      <EmptyState
                        icon="⊞"
                        title="No connections yet"
                        sub="Add your first database connection to start running quality checks."
                        action={<button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={() => setDataHubView('create')}>Add Connection</button>}
                      />
                    ) : (
                      <table className="rule-table">
                        <thead><tr><th>Name</th><th>Type</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
                        <tbody>
                          {sources.map(s => (
                            <tr key={s.id}>
                              <td className="strong">{s.name}</td>
                              <td><span className="type-pill">{s.type || 'DB'}</span></td>
                              <td style={{ textAlign: 'right' }}>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7 }}>
                                  <button className="btn btn-secondary btn-sm" onClick={() => {
                                    setEditingSourceId(s.id);
                                    setNewSourceName(s.name);
                                    setNewSourceUrl(s.connection_url);
                                    setNewSourceType(s.type);
                                    setConnMode('url');
                                    const creds = parseConnectionUrl(s.connection_url);
                                    if (creds) setDbCreds(creds);
                                    setDataHubView('create');
                                  }}>&#x270F; Edit</button>
                                  <button className="btn btn-danger btn-sm" onClick={() => deleteSource(s.id)}>Delete</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}

              {/* Create / Edit Form */}
              {dataHubView === 'create' && (
                <div className="card" style={{ maxWidth: 720, width: '100%', margin: '0 auto' }}>
                  <div className="card-header">
                    <div>
                      <div className="card-title">{editingSourceId ? `Edit Source #${editingSourceId}` : 'New Data Connection'}</div>
                      <div className="card-subtitle">Configure database credentials</div>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setDataHubView('list'); setEditingSourceId(null); resetForm(); }}>&#x2190; Back</button>
                  </div>
                  <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* Basic info */}
                    <div className="form-grid-2">
                      <div className="form-group">
                        <label className="form-label">Friendly Name <span className="required">*</span></label>
                        <input required placeholder="e.g. Production — Snowflake" value={newSourceName} onChange={e => {
                          setNewSourceName(e.target.value)
                          setSourceErrors(prev => ({ ...prev, name: undefined, form: undefined }))
                        }} />
                        {sourceErrors.name && <div className="field-error">{sourceErrors.name}</div>}
                      </div>
                      <div className="form-group">
                        <label className="form-label">Database Type <span className="required">*</span></label>
                        <select required value={newSourceType} onChange={e => {
                          setNewSourceType(e.target.value)
                          setSourceErrors(prev => ({ ...prev, type: undefined, form: undefined }))
                        }}>
                          <option value="">— Select type —</option>
                          <option value="postgres">PostgreSQL</option>
                          <option value="mysql">MySQL</option>
                          <option value="mssql">SQL Server</option>
                          <option value="snowflake">Snowflake</option>
                          <option value="oracle">Oracle</option>
                        </select>
                        {sourceErrors.type && <div className="field-error">{sourceErrors.type}</div>}
                      </div>
                    </div>

                    {/* Method toggle */}
                    <div>
                      <label className="form-label" style={{ marginBottom: 6, display: 'block' }}>Connection Method</label>
                      <div className="tab-toggle">
                        <button className={`tab-toggle-btn${connMode === 'form' ? ' active' : ''}`} onClick={() => setConnMode('form')}>Form Builder</button>
                        <button className={`tab-toggle-btn${connMode === 'url' ? ' active' : ''}`} onClick={() => setConnMode('url')}>&#x1F517; Connection String</button>
                      </div>
                    </div>

                    {/* Form builder fields */}
                    {connMode === 'form' && (
                      <div className="form-grid-2">
                        {[['Host / Server', 'host', 'localhost'], ['Port', 'port', '5432'], ['Username', 'user', 'user'], ['Password', 'password', '']].map(([label, key, ph]) => (
                          <div className="form-group" key={key}>
                            <label className="form-label">{label} <span className="required">*</span></label>
                            <input required type={key === 'password' ? 'password' : 'text'} placeholder={ph} value={dbCreds[key]} onChange={e => {
                              setDbCreds({ ...dbCreds, [key]: e.target.value })
                              setSourceErrors(prev => ({ ...prev, [key]: undefined, form: undefined }))
                            }} />
                            {sourceErrors[key] && <div className="field-error">{sourceErrors[key]}</div>}
                          </div>
                        ))}
                        <div className="form-group col-span-2">
                          <label className="form-label">Database Name <span className="required">*</span></label>
                          <input required placeholder="my_database" value={dbCreds.dbname} onChange={e => {
                            setDbCreds({ ...dbCreds, dbname: e.target.value })
                            setSourceErrors(prev => ({ ...prev, dbname: undefined, form: undefined }))
                          }} />
                          {sourceErrors.dbname && <div className="field-error">{sourceErrors.dbname}</div>}
                        </div>
                      </div>
                    )}

                    {/* Connection string */}
                    <div className="form-group">
                      <label className="form-label">
                        Connection String <span className="required">*</span> {connMode === 'form' && <span style={{ color: 'var(--accent)', fontWeight: 500 }}>(auto-generated)</span>}
                      </label>
                      <input
                        required
                        placeholder="dialect+driver://user:pass@host/db"
                        value={newSourceUrl}
                        readOnly={connMode === 'form'}
                        onChange={e => {
                          setNewSourceUrl(e.target.value)
                          setSourceErrors(prev => ({ ...prev, connection_url: undefined, form: undefined }))
                        }}
                        className="font-mono"
                        style={{ opacity: connMode === 'form' ? 0.7 : 1 }}
                      />
                      {sourceErrors.connection_url && <div className="field-error">{sourceErrors.connection_url}</div>}
                    </div>
                    {sourceErrors.form && <div className="field-error">{sourceErrors.form}</div>}

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 11, paddingTop: 6, borderTop: '1px solid var(--border-subtle)' }}>
                      <button className="btn btn-secondary" style={{ flex: 1 }} onClick={async () => {
                        if (!newSourceUrl) return alert('Enter a URL first');
                        try {
                          const res = await axios.post(`${API_URL}/test-connection`, { connection_url: newSourceUrl });
                          alert((res.data.status === 'success' ? 'OK ' : 'FAIL ') + res.data.message);
                        } catch (e) { alert('Test Failed: ' + e.message); }
                      }}>Test Connection</button>
                      <button className="btn btn-primary" style={{ flex: 1 }} onClick={saveOrUpdateSource}>
                        {editingSourceId ? 'Update Source' : 'Save Source'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ―――――――――― RUN HISTORY ―――――――――― */}
          {activeTab === 'history' && (
            <div className="card" style={{ flex: 1 }}>
              <div className="card-header">
                <div>
                  <div className="card-title">Execution Logs</div>
                  <div className="card-subtitle">{history.length} run{history.length !== 1 ? 's' : ''} recorded</div>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={fetchHistory}>&#x21BB; Refresh</button>
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                {history.length === 0 ? (
                  <EmptyState
                    icon="≈"
                    title="No runs yet"
                    sub="Execute a rule from the Rule Library to start seeing logs here."
                  />
                ) : (
                  <table className="rule-table">
                    <thead><tr><th>Time</th><th>Rule</th><th>Status</th><th>Triggered By</th><th>Data</th></tr></thead>
                    <tbody>
                      {history.map(run => (
                        <tr key={run.id}>
                          <td className="mono text-muted">{run.executed_at}</td>
                          <td className="strong">{run.rule}</td>
                          <td>
                            <span className={`status-badge ${run.status === 'PASS' ? 'pass' : run.status === 'FAIL' ? 'fail' : 'error'}`}>
                              {run.status}
                            </span>
                          </td>
                          <td>
                            {run.triggered_by === 'Manual'
                              ? <span className="badge badge-gray">&#x1F464; Manual</span>
                              : <span className="badge badge-blue">&#x23F1; {run.triggered_by}</span>}
                          </td>
                          <td>
                            <button className="btn btn-secondary btn-sm" onClick={() => setModalData(run.result)}>View Results</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ―――――――――― AUTOMATIONS ―――――――――― */}
          {activeTab === 'schedules' && (
            <div className="card" style={{ flex: 1 }}>
              <div className="card-header">
                <div>
                  <div className="card-title">Active Triggers</div>
                  <div className="card-subtitle">Rules configured to run automatically</div>
                </div>
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                {schedules.length === 0 ? (
                  <EmptyState
                    icon="⏱"
                    title="No schedules yet"
                    sub="Go to the Rule Library and click 'Schedule' on any rule to automate its execution."
                    action={<button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={() => setActiveTab('rules')}>Go to Rule Library</button>}
                  />
                ) : (
                  <table className="rule-table">
                    <thead><tr><th>Schedule Name</th><th>Target Rule</th><th>Frequency</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
                    <tbody>
                      {schedules.map(s => (
                        <tr key={s.id}>
                          <td className="strong">{s.name}</td>
                          <td>{s.rule_name}</td>
                          <td>
                            <span className="badge badge-gray font-mono">
                              {s.cron === '* * * * *' ? 'Every Minute' : s.cron === '0 * * * *' ? 'Hourly' : s.cron === '0 0 * * *' ? 'Daily' : s.cron === '0 0 * * 0' ? 'Weekly' : s.cron}
                            </span>
                          </td>
                          <td>{s.is_active ? <span className="badge badge-green">Active</span> : <span className="badge badge-gray">Paused</span>}</td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7 }}>
                              <button
                                className={`btn btn-sm ${s.is_active ? 'btn-danger' : 'btn-success'}`}
                                onClick={() => toggleSchedule(s.rule_id)}
                              >{s.is_active ? '⏸ Pause' : '▶ Resume'}</button>
                              <button className="btn btn-danger btn-sm" onClick={() => deleteSchedule(s.rule_id)}>Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  )
}

export default App
