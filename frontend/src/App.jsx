import { useState, useEffect } from 'react'
import axios from 'axios'
import './App.css'

// --- COMPONENT: Dynamic Table for Results ---
const ResultsTable = ({ data }) => {
  if (!data || data.length === 0) return <div style={{ padding: '10px', color: '#666' }}>No Data Returned (Pass)</div>

  const headers = Object.keys(data[0])

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      position: 'relative'        // Needed for sticky header context
    }}>
      <table className="rule-table" style={{ marginTop: 0, borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: '#f8fafc' }}>
          <tr>
            {headers.map(h => (
              <th key={h} style={{
                fontSize: '0.8rem',
                padding: '12px',
                textAlign: 'left',
                borderBottom: '2px solid #e2e8f0',
                backgroundColor: '#f8fafc', // Ensures text doesn't show through header on scroll
                whiteSpace: 'nowrap'
              }}>
                {h.toUpperCase()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
              {headers.map(h => (
                <td key={h} style={{
                  fontSize: '0.85rem',
                  padding: '10px',
                  borderBottom: '1px solid #f1f5f9',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {typeof row[h] === 'object' ? JSON.stringify(row[h]) : row[h]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// --- COMPONENT: Modal for History Details ---
const DataModal = ({ data, onClose }) => {
  if (!data) return null;
  let parsedData = [];
  try { parsedData = typeof data === 'string' ? JSON.parse(data) : data } catch (e) { parsedData = [] }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', zIndex: 1000
    }}>
      <div className="card" style={{ width: '80%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexShrink: 0 }}>
          <h3 style={{ margin: 0 }}>Run Results</h3>
          <button onClick={onClose} className="secondary" style={{ padding: '5px 10px' }}>Close</button>
        </div>
        <div style={{ overflowY: 'auto', overflowX: 'auto', flex: 1 }}>
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

  // SCHEDULE STATE
  const [schedules, setSchedules] = useState([])
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [scheduleData, setScheduleData] = useState({ rule_id: null, name: '', cron: '0 0 * * *' }) // Default: Daily at midnight

  // NEW
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

  const resetForm = () => {
    setEditingSourceId(null);
    setNewSourceName("");
    setNewSourceUrl("");
    setNewSourceType("");
    setConnMode('form'); // Reset to default mode
    setDbCreds({ host: 'localhost', port: '5432', user: 'postgres', password: '', dbname: 'postgres' });
  }

  const resetPlayground = () => {
    setEditingId(null);
    setRuleName("");
    setSql("SELECT * FROM table...");
    setParams("{}");
    setSelectedSourceId("");
    setResult(null);
  }

  const saveOrUpdateSource = async () => {
    if (!newSourceName || !newSourceUrl) return alert("Please fill in all fields");

    const payload = {
      name: newSourceName,
      connection_url: newSourceUrl,
      type: newSourceType || 'postgres'
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
      alert("Error: " + (err.response?.data?.detail || err.message));
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
    if (!selectedSourceId) return alert("Please select a Data Source first!");
    if (!sql.trim()) return alert("SQL Query cannot be empty.");

    let parsedParams = {};
    try {
      parsedParams = params.trim() ? JSON.parse(params) : {};
    } catch (e) {
      return alert("Invalid JSON format in the Params field.");
    }

    setPgIsRunning(true);
    setResult(null); // Clear previous results

    try {
      // 1. MATCH YOUR BACKEND ENDPOINT EXACTLY
      const res = await axios.post(`${API_URL}/run-adhoc`, {
        source_id: parseInt(selectedSourceId),
        sql: sql,             // Changed to match your AdHocCheck model
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
    if (!ruleName) return alert("Please name your rule!")
    if (!selectedSourceId) return alert("Data Source is required!")
    try {
      // Parse params from the text box
      let parsedParams = {}
      try { parsedParams = JSON.parse(params) } catch (e) { return alert("Invalid JSON in Parameters") }

      // Send params in payload
      const payload = {
        name: ruleName,
        sql: sql,
        params: parsedParams, // <--- SENDING PARAMS NOW
        source_id: selectedSourceId // <--- SENDING SOURCE ID NOW
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


  return (
    <div className="container">
      {modalData && <DataModal data={modalData} onClose={() => setModalData(null)} />}

      {/* SCHEDULE CREATION MODAL */}
      {showScheduleModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(2px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
          {/* Modal Container - Removed className="card" to prevent unwanted height stretching */}
          <div style={{
            width: '100%', maxWidth: '450px',
            background: '#ffffff', borderRadius: '8px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden'
          }}>

            {/* Modal Header */}
            <div style={{ padding: '20px 25px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: '#0f172a', fontSize: '1.15rem' }}>Schedule Rule #{scheduleData.rule_id}</h3>
              <button
                onClick={() => setShowScheduleModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#94a3b8', lineHeight: 1 }}
                title="Close"
              >
                &times;
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '25px' }}>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: '#334155', fontSize: '0.9rem' }}>Schedule Name</label>
                <input
                  value={scheduleData.name}
                  onChange={e => setScheduleData({ ...scheduleData, name: e.target.value })}
                  placeholder="e.g. Nightly User Check"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: '#334155', fontSize: '0.9rem' }}>Frequency</label>
                <select
                  value={scheduleData.cron}
                  onChange={e => setScheduleData({ ...scheduleData, cron: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', color: 'rgb(45, 48, 53)',border: '1px solid #cbd5e1', fontSize: '0.95rem', background: 'white' }}
                >
                  <option value="* * * * *">Every Minute (Testing)</option>
                  <option value="0 * * * *">Every Hour</option>
                  <option value="0 0 * * *">Daily at Midnight</option>
                  <option value="0 0 * * 0">Weekly (Sunday)</option>
                </select>

                {/* Helpful subtext showing the raw cron string */}
                <p style={{ margin: '8px 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                  Cron Expression: <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>{scheduleData.cron}</code>
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{ padding: '15px 25px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                className="secondary"
                onClick={() => setShowScheduleModal(false)}
                style={{ padding: '8px 16px', background: 'white', border: '1px solid #cbd5e1', color: '#475569', fontWeight: '600', borderRadius: '6px' }}
              >
                Cancel
              </button>
              <button
                className="primary"
                onClick={handleScheduleSubmit}
                style={{ padding: '8px 16px', fontWeight: '600', borderRadius: '6px' }}
              >
                Save Schedule
              </button>
            </div>

          </div>
        </div>
      )}

      <nav className="sidebar">
        <h2>DQ OS</h2>
        <button onClick={() => { setActiveTab('datahub'); resetPlayground(); }} className={activeTab === 'datahub' ? 'active' : ''}>
          Data Hub
        </button>
        <button onClick={() => setActiveTab('playground')} className={activeTab === 'playground' ? 'active' : ''}>
          PlayGround
        </button>
        <button onClick={() => { setActiveTab('schedules'); resetPlayground(); }} className={activeTab === 'schedules' ? 'active' : ''}>
          Automations
        </button>
        <button onClick={() => { setActiveTab('rules'); resetPlayground(); }} className={activeTab === 'rules' ? 'active' : ''}>
          Saved Rules
        </button>
        <button onClick={() => { setActiveTab('history'); resetPlayground(); }} className={activeTab === 'history' ? 'active' : ''}>
          Run History
        </button>
      </nav>

      <main className="content">
        {/* TAB 1: PLAYGROUND (REDESIGNED & EXPANDED) */}
        {activeTab === 'playground' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', minHeight: '85vh', width: '100%' }}>

            {/* TOP PANEL: SQL EDITOR */}
            <div className="card" style={{ width: '100%', padding: '30px', background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px', borderBottom: '1px solid #f1f5f9', paddingBottom: '15px' }}>
                <div>
                  <h2 style={{ margin: 0, color: '#0f172a' }}>{editingId ? `Editing Rule #${editingId}` : "Data Quality PlayGround"}</h2>
                  <p style={{ margin: '5px 0 0 0', color: '#64748b' }}>Write, test, and save data quality rules.</p>
                </div>
                {/* Uses the new reset helper on cancel */}
                {editingId && <button className="small-btn" onClick={resetPlayground} style={{ background: '#64748b' }}>Cancel Edit</button>}
              </div>

              {/* Target Source Dropdown */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: '#334155' }}>Target Data Source</label>
                <select
                  value={selectedSourceId}
                  onChange={(e) => setSelectedSourceId(e.target.value)}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', color: '#0f172a', border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', fontSize: '0.95rem' }}
                >
                  <option value="">-- Select a Database --</option>
                  {sources.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.type?.toUpperCase() || 'DB'})</option>
                  ))}
                </select>
              </div>

              {/* Editor Split: Query & Params */}
              <div style={{ display: 'flex', gap: '20px', height: '400px', marginBottom: '25px' }}>
                <div style={{ flex: 2, display: 'flex', flexDirection: 'column' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: '#334155' }}>SQL Query</label>
                  <textarea
                    value={sql}
                    onChange={(e) => setSql(e.target.value)}
                    style={{ flex: 1, minHeight: '220px', padding: '15px', fontFamily: 'monospace', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', resize: 'vertical' }}
                  />
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: '#334155' }}>Params (JSON)</label>
                  <textarea
                    value={params}
                    onChange={(e) => setParams(e.target.value)}
                    style={{ flex: 1, minHeight: '220px', padding: '15px', fontFamily: 'monospace', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', resize: 'vertical' }}
                  />
                </div>
              </div>

              {/* Bottom Action Bar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '20px', background: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '15px' }}>
                  <label style={{ fontWeight: '600', color: '#334155', whiteSpace: 'nowrap' }}>Rule Name:</label>
                  <input
                    placeholder="e.g. Check Null Emails"
                    value={ruleName}
                    onChange={(e) => setRuleName(e.target.value)}
                    style={{ width: '100%', maxWidth: '400px', padding: '12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={saveOrUpdateRule} className="secondary" style={{ padding: '12px 24px', background: 'white', border: '1px solid #cbd5e1', color: '#334155', fontWeight: '600' }}>
                    💾 {editingId ? "Update Rule" : "Save Rule"}
                  </button>
                  <button
                    className="primary"
                    onClick={runAdHoc}
                    disabled={pgIsRunning}
                    style={{ padding: '12px 24px', fontWeight: '600', opacity: pgIsRunning ? 0.7 : 1 }}
                  >
                    {pgIsRunning ? '⏳ Executing...' : '▶ Run Query'}
                  </button>
                </div>
              </div>
            </div>

            {/* BOTTOM PANEL: SEPARATE RESULTS VIEW */}
            {result && (
              <div className="card" style={{ width: '100%', padding: '30px', background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', flex: 1, display: 'flex', flexDirection: 'column' }}>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <h3 style={{ margin: 0, color: '#0f172a' }}>Query Results</h3>
                  {result.status === 'success' && (
                    <span className={`status-badge ${result.rule_status === 'PASS' ? 'pass' : 'fail'}`}>
                      {result.rule_status === 'PASS' ? '✅ PASS' : '❌ FAIL'} ({result.data?.length || 0} anomaly rows)
                    </span>
                  )}
                </div>

                {result.status === 'error' ? (
                  <div style={{ background: '#fef2f2', color: '#991b1b', padding: '20px', borderRadius: '8px', border: '1px solid #fecaca', fontFamily: 'monospace' }}>
                    <strong>Execution Error:</strong><br /><br />
                    {result.message}
                  </div>
                ) : (
                  // *** ADDED maxHeight AND overflowY HERE TO FORCE THE VERTICAL SCROLLER ***
                  <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                    <table className="rule-table" style={{ width: '100%', margin: 0, borderCollapse: 'collapse' }}>
                      <thead style={{ position: 'sticky', top: 0, zIndex: 5, background: '#f8fafc', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                        <tr>
                          {result.columns?.map((col, idx) => (
                            <th key={idx} style={{ padding: '12px 15px', textAlign: 'left', fontWeight: '600', color: '#475569', borderBottom: '1px solid #e2e8f0' }}>
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.data?.length === 0 ? (
                          <tr>
                            <td colSpan={result.columns?.length || 1} style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                              Query returned 0 rows. Rule Passed!
                            </td>
                          </tr>
                        ) : (
                          result.data?.map((row, rowIndex) => (
                            <tr key={rowIndex} style={{ borderBottom: '1px solid #f1f5f9' }}>
                              {result.columns?.map((col, colIndex) => (
                                <td key={colIndex} style={{ padding: '12px 15px', color: '#334155', fontSize: '0.9rem' }}>
                                  {typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col])}
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
            )}

          </div>
        )}

        {/* TAB 2: RULES */}
        {activeTab === 'rules' && (
          <div className="card">
            <h3>Your Rule Library</h3>
            <table className="rule-table">
              <thead><tr><th>ID</th><th>Name</th><th>Source</th><th>Actions</th><th>Set Trigger</th></tr></thead>
              <tbody>
                {rules.map(r => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{r.name}</td>
                    <td>
                      {/* Show Source Name if available */}
                      {sources.find(s => s.id === r.source_id)?.name || "Unknown"}
                    </td>
                    <td style={{ display: 'flex', gap: '10px' }}>
                      <button onClick={() => executeRule(r.id)} className="small-btn">Run</button>
                      <button onClick={() => editRule(r)} className="small-btn" style={{ background: '#64748b' }}>Edit</button>

                    </td>
                    <td>
                      {/* NEW SCHEDULE BUTTON */}
                      <button
                        onClick={() => {
                          setScheduleData({ rule_id: r.id, name: `${r.name}`, cron: '0 0 * * *' });
                          setShowScheduleModal(true);
                        }}
                        className="small-btn"
                        style={{ background: '#7a9e68', border: '1px solid #065b11' }}
                      >
                        ⏰ Schedule
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 3: DATA HUB (Dynamic Height - No Internal Scroll) */}
        {activeTab === 'datahub' && (
          <div className="card" style={{
            padding: '30px',
            display: 'flex',
            flexDirection: 'column',
            // 1. FIX: Constrain height for List, let it grow for Form
            height: dataHubView === 'list' ? '85vh' : 'auto',
            minHeight: '85vh',
          }}>

            {/* HEADER */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', borderBottom: '1px solid #e2e8f0', paddingBottom: '20px' }}>
              <div>
                <h2 style={{ margin: 0, color: '#0f172a' }}>Data Configuration</h2>
                <p style={{ margin: '5px 0 0 0', color: '#64748b' }}>Manage your database connections.</p>
              </div>

              <div style={{ display: 'flex', background: '#f1f5f9', padding: '4px', borderRadius: '8px' }}>
                <button
                  onClick={() => { setDataHubView('list'); setEditingSourceId(null); setNewSourceName(""); setNewSourceUrl(""); setNewSourceType(""); resetForm(); }}
                  style={{
                    background: dataHubView === 'list' ? '#ffffff' : 'transparent',
                    color: dataHubView === 'list' ? '#0f172a' : '#64748b',
                    fontWeight: '600', padding: '8px 20px', borderRadius: '6px', border: 'none',
                    boxShadow: dataHubView === 'list' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', cursor: 'pointer', transition: 'all 0.2s'
                  }}
                >
                  Managed Sources
                </button>
                <button
                  onClick={() => { setDataHubView('create'); setEditingSourceId(null); setNewSourceName(""); setNewSourceUrl(""); setNewSourceType(""); resetForm(); }}
                  style={{
                    background: dataHubView === 'create' ? '#ffffff' : 'transparent',
                    color: dataHubView === 'create' ? '#0f172a' : '#64748b',
                    fontWeight: '600', padding: '8px 20px', borderRadius: '6px', border: 'none',
                    boxShadow: dataHubView === 'create' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', cursor: 'pointer', transition: 'all 0.2s'
                  }}
                >
                  {editingSourceId ? "✏️ Editing Source" : "+ New Connection"}
                </button>
              </div>
            </div>

            {/* CONTENT AREA - Grows Dynamically */}
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              // 2. FIX: 'hidden' forces the child to handle scrolling. 'visible' lets the form grow.
              overflow: dataHubView === 'list' ? 'hidden' : 'visible'
            }}>

              {/* VIEW 1: LIST */}
              {dataHubView === 'list' && (
                // Added flex: 1 and overflow: auto here to create the internal scroll area
                <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                  <table className="rule-table" style={{ margin: 0, width: '100%', border: 'none' }}>
                    <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      <tr>
                        <th style={{ padding: '15px' }}>Name</th>
                        <th style={{ padding: '15px' }}>Type</th>
                        {/* <th style={{ padding: '15px' }}>Connection URL</th> */}
                        <th style={{ padding: '15px', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sources.map(s => (
                        <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '15px', fontWeight: '500' }}>{s.name}</td>
                          <td style={{ padding: '15px' }}>
                            <span style={{ background: '#e0f2fe', color: '#0284c7', padding: '4px 10px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase' }}>
                              {s.type || 'DB'}
                            </span>
                          </td>
                          {/* <td style={{ padding: '15px', fontFamily: 'monospace', color: '#64748b', fontSize: '0.85rem' }}>
                            {s.connection_url ? s.connection_url.replace(/:[^:@]+@/, ':*****@') : ''}
                          </td> */}
                          <td style={{ padding: '15px', textAlign: 'right' }}>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                              <button
                                onClick={() => {
                                  setEditingSourceId(s.id);
                                  setNewSourceName(s.name);
                                  setNewSourceUrl(s.connection_url);
                                  setNewSourceType(s.type);
                                  setConnMode('url');
                                  setDataHubView('create');
                                }}
                                className="small-btn" style={{ background: 'white', border: '1px solid #cbd5e1', color: '#334155' }}
                              >
                                ✏️ Edit
                              </button>
                              <button
                                onClick={() => deleteSource(s.id)}
                                className="small-btn" style={{ background: '#fff1f2', border: '1px solid #fecaca', color: '#e11d48' }}
                              >
                                🗑️ Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {sources.length === 0 && (
                        <tr><td colSpan="4" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>No data sources found.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* VIEW 2: FORM (CREATE / EDIT) - Grows infinitely */}
              {dataHubView === 'create' && (
                <div style={{ maxWidth: '800px', margin: '0 auto', width: '100%', marginTop: '20px', paddingBottom: '40px' }}>
                  <div style={{ background: '#ffffff', padding: '40px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>

                    {/* Title */}
                    <div style={{ marginBottom: '30px', borderBottom: '1px solid #f1f5f9', paddingBottom: '20px' }}>
                      <h3 style={{ margin: 0, color: '#0f172a', fontSize: '1.25rem' }}>
                        {editingSourceId ? `Edit Source #${editingSourceId}` : "Connect New Data Source"}
                      </h3>
                      <p style={{ color: '#64748b', margin: '5px 0 0 0', fontSize: '0.9rem' }}>
                        Configure access to your database.
                      </p>
                    </div>

                    {/* 1. Basic Info Row */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '30px' }}>
                      <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: '#334155', fontSize: '0.9rem' }}>Friendly Name <span style={{ color: 'red' }}>*</span></label>
                        <input
                          placeholder="e.g. Production Snowflake"
                          value={newSourceName}
                          onChange={(e) => setNewSourceName(e.target.value)}
                          style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: '#334155', fontSize: '0.9rem' }}>Database Type</label>
                        <select
                          value={newSourceType}
                          onChange={(e) => setNewSourceType(e.target.value)}
                          style={{ width: '100%', padding: '12px', borderRadius: '8px', color: '#1c2027', border: '1px solid #cbd5e1', background: 'white', fontSize: '0.95rem' }}
                        >
                          <option value="">-- Select Type --</option>
                          <option value="postgres">PostgreSQL</option>
                          <option value="mysql">MySQL</option>
                          <option value="mssql">SQL Server</option>
                          <option value="snowflake">Snowflake</option>
                          <option value="oracle">Oracle</option>
                        </select>
                      </div>
                    </div>

                    {/* 2. Connection Method Toggle */}
                    <div style={{ background: '#f1f5f9', padding: '5px', borderRadius: '8px', display: 'flex', marginBottom: '30px' }}>
                      <button
                        onClick={() => setConnMode('form')}
                        style={{
                          flex: 1, padding: '10px', borderRadius: '6px', border: 'none', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s',
                          background: connMode === 'form' ? 'white' : 'transparent',
                          color: connMode === 'form' ? '#0f172a' : '#64748b',
                          boxShadow: connMode === 'form' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                        }}
                      >
                        🧱 Form Builder
                      </button>
                      <button
                        onClick={() => setConnMode('url')}
                        style={{
                          flex: 1, padding: '10px', borderRadius: '6px', border: 'none', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s',
                          background: connMode === 'url' ? 'white' : 'transparent',
                          color: connMode === 'url' ? '#0f172a' : '#64748b',
                          boxShadow: connMode === 'url' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                        }}
                      >
                        🔗 Raw Connection String
                      </button>
                    </div>

                    {/* 3A. The Form Builder */}
                    {connMode === 'form' && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '30px' }}>
                        <div>
                          <label style={{ fontSize: '0.85rem', fontWeight: '600', color: '#64748b' }}>Host / Server IP</label>
                          <input
                            value={dbCreds.host}
                            onChange={(e) => setDbCreds({ ...dbCreds, host: e.target.value })}
                            placeholder="localhost"
                            style={{ width: '100%', padding: '10px', marginTop: '5px', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.85rem', fontWeight: '600', color: '#64748b' }}>Port</label>
                          <input
                            value={dbCreds.port}
                            onChange={(e) => setDbCreds({ ...dbCreds, port: e.target.value })}
                            placeholder="5432"
                            style={{ width: '100%', padding: '10px', marginTop: '5px', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.85rem', fontWeight: '600', color: '#64748b' }}>Username</label>
                          <input
                            value={dbCreds.user}
                            onChange={(e) => setDbCreds({ ...dbCreds, user: e.target.value })}
                            placeholder="user"
                            style={{ width: '100%', padding: '10px', marginTop: '5px', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.85rem', fontWeight: '600', color: '#64748b' }}>Password</label>
                          <input
                            type="password"
                            value={dbCreds.password}
                            onChange={(e) => setDbCreds({ ...dbCreds, password: e.target.value })}
                            placeholder="••••••"
                            style={{ width: '100%', padding: '10px', marginTop: '5px', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                          />
                        </div>
                        <div style={{ gridColumn: 'span 2' }}>
                          <label style={{ fontSize: '0.85rem', fontWeight: '600', color: '#64748b' }}>Database Name</label>
                          <input
                            value={dbCreds.dbname}
                            onChange={(e) => setDbCreds({ ...dbCreds, dbname: e.target.value })}
                            placeholder="my_database"
                            style={{ width: '100%', padding: '10px', marginTop: '5px', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                          />
                        </div>
                      </div>
                    )}

                    {/* 3B. The URL Input */}
                    <div style={{ marginBottom: '30px' }}>
                      <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: '#334155', fontSize: '0.9rem' }}>
                        Connection String {connMode === 'form' && <span style={{ color: '#0ea5e9' }}>(Auto-Generated)</span>}
                      </label>
                      <div style={{ position: 'relative' }}>
                        <input
                          placeholder="dialect+driver://user:pass@host/db"
                          value={newSourceUrl}
                          readOnly={connMode === 'form'}
                          onChange={(e) => setNewSourceUrl(e.target.value)}
                          style={{
                            width: '100%', padding: '15px', borderRadius: '8px',
                            border: '1px solid #cbd5e1', fontFamily: 'monospace', fontSize: '0.9rem',
                            background: connMode === 'form' ? '#f8fafc' : 'white',
                            color: connMode === 'form' ? '#64748b' : '#0f172a'
                          }}
                        />
                      </div>
                    </div>

                    {/* 4. Action Buttons */}
                    <div style={{ display: 'flex', gap: '15px', paddingTop: '20px', borderTop: '1px solid #f1f5f9' }}>
                      <button
                        className="secondary"
                        style={{ flex: 1, padding: '14px', justifyContent: 'center' }}
                        onClick={async () => {
                          if (!newSourceUrl) return alert("Enter a URL first");
                          try {
                            const res = await axios.post(`${API_URL}/test-connection`, { connection_url: newSourceUrl });
                            if (res.data.status === 'success') alert("✅ " + res.data.message);
                            else alert("❌ " + res.data.message);
                          } catch (e) { alert("Test Failed: " + e.message) }
                        }}
                      >
                        Test Connection
                      </button>

                      <button
                        className="primary"
                        style={{ flex: 1, padding: '14px', justifyContent: 'center' }}
                        onClick={saveOrUpdateSource}
                      >
                        {editingSourceId ? "Update Source" : "Save Source"}
                      </button>
                    </div>

                    <div style={{ marginTop: '20px', textAlign: 'center' }}>
                      <button
                        onClick={() => { setDataHubView('list'); setEditingSourceId(null); resetForm(); }}
                        style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', textDecoration: 'underline' }}
                      >
                        Cancel and go back
                      </button>
                    </div>

                  </div>
                </div>
              )}

            </div>
          </div>
        )}

        {/* TAB 4: HISTORY */}
        {activeTab === 'history' && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '85vh', overflow: 'hidden' }}>
            <h3 style={{ marginBottom: '15px' }}>Execution Logs</h3>

            {/* Scrollable Container */}
            <div style={{
              flex: 1,
              overflow: 'auto',
              border: '1px solid #e2e8f0',
              borderRadius: '6px'
            }}>
              <table className="rule-table" style={{ marginTop: 0, width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                {/* Sticky Header */}
                <thead style={{ position: 'sticky', top: 0, zIndex: 5, backgroundColor: '#f8fafc' }}>
                  <tr>
                    <th style={{ padding: '12px', borderBottom: '2px solid #e2e8f0', textAlign: 'left', background: '#f8fafc' }}>Time</th>
                    <th style={{ padding: '12px', borderBottom: '2px solid #e2e8f0', textAlign: 'left', background: '#f8fafc' }}>Rule</th>
                    <th style={{ padding: '12px', borderBottom: '2px solid #e2e8f0', textAlign: 'left', background: '#f8fafc' }}>Status</th>
                    <th style={{ padding: '12px', borderBottom: '2px solid #e2e8f0', textAlign: 'left', background: '#f8fafc' }}>Triggered By</th> {/* NEW HEADER */}
                    <th style={{ padding: '12px', borderBottom: '2px solid #e2e8f0', textAlign: 'left', background: '#f8fafc' }}>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(run => (
                    <tr key={run.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px', borderBottom: '1px solid #f1f5f9' }}>{run.executed_at}</td>
                      <td style={{ padding: '10px', borderBottom: '1px solid #f1f5f9' }}>{run.rule}</td>
                      <td style={{ padding: '10px', borderBottom: '1px solid #f1f5f9' }}>
                        <span className={`status-badge ${run.status === 'PASS' ? 'pass' : run.status === 'FAIL' ? 'fail' : 'error'}`}>
                          {run.status}
                        </span>
                      </td>
                      {/* NEW TRIGGER COLUMN */}
                      <td style={{ padding: '10px', borderBottom: '1px solid #f1f5f9' }}>
                        {run.triggered_by === 'Manual' ? (
                          <span style={{ background: '#f1f5f9', color: '#475569', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '600', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            👤 Manual
                          </span>
                        ) : (
                          <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '600', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            ⏰ {run.triggered_by}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px', borderBottom: '1px solid #f1f5f9' }}>
                        <button className="secondary" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={() => setModalData(run.result)}>
                          View Results
                        </button>
                      </td>
                    </tr>
                  ))}
                  {history.length === 0 && (
                    <tr><td colSpan="5" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>No execution logs found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: AUTOMATIONS / SCHEDULES */}
        {activeTab === 'schedules' && (
          <div className="card">
            <h3>Active Triggers</h3>
            <p style={{ color: '#64748b', marginBottom: '20px' }}>Rules that are configured to run automatically.</p>
            <table className="rule-table">
              <thead style={{ background: '#f8fafc' }}>
                <tr>
                  <th>Schedule Name</th>
                  <th>Target Rule</th>
                  <th>Frequency (Cron)</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map(s => (
                  <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ fontWeight: '500' }}>{s.name}</td>
                    <td>{s.rule_name}</td>
                    <td>
                      <span style={{ background: '#f1f5f9', color: '#475569', padding: '4px 10px', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                        {s.cron === '* * * * *' ? 'Every Minute' : s.cron === '0 * * * *' ? 'Hourly' : s.cron === '0 0 * * *' ? 'Daily' : s.cron === '0 0 * * 0' ? 'Weekly' : s.cron}
                      </span>
                    </td>

                    {/* NEW STATUS BADGE */}
                    <td>
                      {s.is_active ? (
                        <span style={{ background: '#dcfce7', color: '#166534', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '700' }}>ACTIVE</span>
                      ) : (
                        <span style={{ background: '#f1f5f9', color: '#64748b', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '700' }}>PAUSED</span>
                      )}
                    </td>

                    {/* NEW DUAL ACTIONS */}
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        <button
                          onClick={() => toggleSchedule(s.rule_id)}
                          className="small-btn"
                          style={{
                            background: s.is_active ? '#fff7ed' : '#ecfdf5',
                            border: s.is_active ? '1px solid #fdba74' : '1px solid #6ee7b7',
                            color: s.is_active ? '#c2410c' : '#047857'
                          }}
                        >
                          {s.is_active ? '⏸ Pause' : '▶ Resume'}
                        </button>
                        <button
                          onClick={() => deleteSchedule(s.rule_id)}
                          className="small-btn"
                          style={{ background: '#fff1f2', border: '1px solid #fecaca', color: '#e11d48' }}
                        >
                          🗑️ Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {schedules.length === 0 && (
                  <tr><td colSpan="5" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>No active schedules.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}

export default App