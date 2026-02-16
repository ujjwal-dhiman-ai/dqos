import { useState, useEffect } from 'react'
import axios from 'axios'
import './App.css'

// --- COMPONENT: Dynamic Table for Results ---
const ResultsTable = ({ data }) => {
  if (!data || data.length === 0) return <div style={{padding:'10px', color:'#666'}}>No Data Returned (Pass)</div>
  
  const headers = Object.keys(data[0])

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      position: 'relative'        // Needed for sticky header context
    }}>
      <table className="rule-table" style={{marginTop: 0, borderCollapse: 'separate', borderSpacing: 0}}>
        <thead style={{position: 'sticky', top: 0, zIndex: 1, backgroundColor: '#f8fafc'}}>
          <tr>
            {headers.map(h => (
              <th key={h} style={{
                fontSize:'0.8rem', 
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
            <tr key={i} style={{borderBottom: '1px solid #f1f5f9'}}>
              {headers.map(h => (
                <td key={h} style={{
                  fontSize:'0.85rem', 
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
  try { parsedData = typeof data === 'string' ? JSON.parse(data) : data } catch(e) { parsedData = [] }

  return (
    <div style={{
      position:'fixed', top:0, left:0, right:0, bottom:0, 
      backgroundColor:'rgba(0,0,0,0.5)', display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', zIndex:1000
    }}>
      <div className="card" style={{width:'80%', maxHeight:'80vh', display:'flex', flexDirection:'column', position:'relative'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem', flexShrink: 0}}>
          <h3 style={{margin: 0}}>Run Results</h3>
          <button onClick={onClose} className="secondary" style={{padding:'5px 10px'}}>Close</button>
        </div>
        <div style={{overflowY:'auto', overflowX:'auto', flex: 1}}>
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
  
  // RULE MANAGEMENT STATE
  const [rules, setRules] = useState([])
  const [ruleName, setRuleName] = useState("")
  const [editingId, setEditingId] = useState(null) // Track if we are editing
  const [sources, setSources] = useState([])
  const [selectedSourceId, setSelectedSourceId] = useState("")
  
  // HISTORY STATE
  const [history, setHistory] = useState([])
  const [modalData, setModalData] = useState(null) // For the popup
  
  // DATA HUB FORM STATE
  const [newSourceName, setNewSourceName] = useState("")
  const [newSourceUrl, setNewSourceUrl] = useState("")
  const [newSourceType, setNewSourceType] = useState("") // Default to postgres

  // NEW
  const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

  useEffect(() => {
    // Always fetch sources because we need them for the dropdown in Playground
    fetchSources()
    if (activeTab === 'rules') fetchRules()
    if (activeTab === 'history') fetchHistory()
  }, [activeTab])

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

  const createSource = async () => {
    try {
      await axios.post(`${API_URL}/sources/`, { name: newSourceName, connection_url: newSourceUrl, type: newSourceType })
      alert("Source Added!")
      setNewSourceName(""); setNewSourceUrl(""); setNewSourceType("")
      fetchSources()
    } catch(err) { alert("Error adding source") }
  }

  const runAdHoc = async () => {
    setResult(null)
    if (!selectedSourceId) return alert("Please select a Data Source first!")
    try {
      let parsedParams = {}
      try { parsedParams = JSON.parse(params) } catch (e) { return alert("Invalid JSON Params") }
      
      const res = await axios.post(`${API_URL}/run-adhoc`, { 
        sql, params: parsedParams, source_id: selectedSourceId 
      })
      setResult(res.data.data)
    } catch (err) {
      alert("Error: " + (err.response?.data?.detail || err.message))
    }
  }

  const saveOrUpdateRule = async () => {
    if(!ruleName) return alert("Please name your rule!")
    if(!selectedSourceId) return alert("Data Source is required!")
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
      if(activeTab === 'playground') setActiveTab('rules')
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
      if(activeTab === 'history') fetchHistory()
    } catch (err) { alert("Execution Failed: " + err.response?.data?.detail) }
  }

  return (
    <div className="container">
      {modalData && <DataModal data={modalData} onClose={() => setModalData(null)} />}

      <nav className="sidebar">
        <h2>DQ OS</h2>
        <button onClick={() => setActiveTab('datahub')} className={activeTab === 'datahub' ? 'active' : ''}>
          Data Hub
        </button>
        <button onClick={() => setActiveTab('playground')} className={activeTab === 'playground' ? 'active' : ''}>
          Playground
        </button>
        <button onClick={() => { setActiveTab('rules'); setEditingId(null); setRuleName("") }} className={activeTab === 'rules' ? 'active' : ''}>
          Saved Rules
        </button>
        <button onClick={() => setActiveTab('history')} className={activeTab === 'history' ? 'active' : ''}>
          Run History
        </button>
      </nav>

      <main className="content">
        {/* TAB 1: PLAYGROUND */}
        {activeTab === 'playground' && (
          <div className="card">
             <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <h3>{editingId ? `Editing Rule #${editingId}` : "SQL Editor"}</h3>
              {editingId && <button className="small-btn" onClick={() => {setEditingId(null); setRuleName(""); setSql("")}} style={{background:'#64748b'}}>Cancel Edit</button>}
            </div>

            {/* SOURCE SELECTOR */}
            <div style={{marginBottom: '1rem'}}>
              <label style={{fontWeight:'bold', color:'#64748b', display:'block', marginBottom:'5px'}}>Target Data Source</label>
              <select 
                value={selectedSourceId} 
                onChange={(e) => setSelectedSourceId(e.target.value)}
                style={{width:'100%', padding:'10px', borderRadius:'6px', color: '#2a303d', border:'1px solid #cbd5e1', background:'white'}}
              >
                <option value="">-- Select a Database --</option>
                {sources.map(s => <option key={s.id} value={s.id}>{s.name} ({s.type})</option>)}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '20px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <label style={{fontWeight:'bold', color:'#64748b', marginBottom:'5px'}}>SQL Query</label>
                <textarea value={sql} onChange={(e) => setSql(e.target.value)} rows={12} placeholder="SELECT * FROM table..." />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <label style={{fontWeight:'bold', color:'#64748b', marginBottom:'5px'}}>Params (JSON)</label>
                <textarea value={params} onChange={(e) => setParams(e.target.value)} rows={12} style={{fontFamily:'monospace', fontSize:'0.85rem'}} />
              </div>
            </div>

            <div className="actions">
              <input placeholder="Rule Name" value={ruleName} onChange={(e) => setRuleName(e.target.value)} style={{flex: 1}} />
              <button onClick={saveOrUpdateRule} className="secondary">{editingId ? "Update" : "Save"}</button>
              <button onClick={runAdHoc} className="primary">Run Now</button>
            </div>

            {result && (
              <div className="results" style={{height: '400px', display: 'flex', flexDirection: 'column', marginTop: '20px', background:'white', padding:'10px', border:'1px solid #e2e8f0', borderRadius:'8px'}}>
                <h4>Result Preview ({result.length} rows)</h4>
                <ResultsTable data={result} />
              </div>
            )}
          </div>
        )}

        {/* TAB 2: RULES */}
        {activeTab === 'rules' && (
          <div className="card">
            <h3>Your Rule Library</h3>
            <table className="rule-table">
              <thead><tr><th>ID</th><th>Name</th><th>Source</th><th>Actions</th></tr></thead>
              <tbody>
                {rules.map(r => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{r.name}</td>
                    <td>
                      {/* Show Source Name if available */}
                      {sources.find(s => s.id === r.source_id)?.name || "Unknown"}
                    </td>
                    <td style={{display:'flex', gap:'10px'}}>
                      <button onClick={() => executeRule(r.id)} className="small-btn">Run</button>
                      <button onClick={() => editRule(r)} className="small-btn" style={{background:'#64748b'}}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 3: DATA HUB (NEW) */}
        {activeTab === 'datahub' && (
          <div className="card">
            <h3>Data Hub Configuration</h3>
            
            <div style={{background:'#f8fafc', padding:'20px', borderRadius:'8px', marginBottom:'20px', border: '1px solid #e2e8f0'}}>
              <h4 style={{marginBottom:'15px', color:'#334155'}}>Add New Data Source</h4>
              
              <div style={{display:'grid', gridTemplateColumns:'1fr 2fr', gap:'15px', marginBottom:'15px'}}>
                <div>
                  <label style={{display:'block', marginBottom:'5px', fontSize:'0.9rem', fontWeight:'600', color:'#64748b'}}>Friendly Name</label>
                  <input 
                    placeholder="e.g. Sales DB (SQL Server)" 
                    value={newSourceName} 
                    onChange={(e) => setNewSourceName(e.target.value)} 
                  />
                </div>
                <div>
                  <label style={{display:'block', marginBottom:'5px', fontSize:'0.9rem', fontWeight:'600', color:'#64748b'}}>Connection URL</label>
                  <input 
                    placeholder="dialect+driver://user:pass@host/db" 
                    value={newSourceUrl} 
                    onChange={(e) => setNewSourceUrl(e.target.value)} 
                    style={{fontFamily: 'monospace'}}
                  />
                </div>
                <div>
                  <label style={{display:'block', marginBottom:'5px', fontSize:'0.9rem', fontWeight:'600', color:'#64748b'}}>Type</label>
                  <input 
                    placeholder="postgres, mysql, mssql, etc." 
                    value={newSourceType} 
                    onChange={(e) => setNewSourceType(e.target.value)} 
                  />
                </div>
              </div>

              <div style={{display:'flex', gap:'10px'}}>
                <button 
                  onClick={async () => {
                    if(!newSourceUrl) return alert("Enter a URL first");
                    try {
                      const res = await axios.post(`${API_URL}/test-connection`, { connection_url: newSourceUrl });
                      if(res.data.status === 'success') alert("✅ " + res.data.message);
                      else alert("❌ " + res.data.message);
                    } catch(e) { alert("Test Failed: " + e.message) }
                  }} 
                  className="secondary"
                >
                  Test Connection
                </button>

                <button onClick={createSource} className="primary">
                  Add Source
                </button>
              </div>
            </div>

            <table className="rule-table">
              <thead><tr><th>ID</th><th>Name</th><th>Connection String</th><th>Type</th></tr></thead>
              <tbody>
                {sources.map(s => (
                  <tr key={s.id}>
                    <td>{s.id}</td>
                    <td>{s.name}</td>
                    <td style={{fontFamily:'monospace', fontSize:'0.85rem', color:'#475569'}}>{s.connection_url}</td>
                    <td>{s.type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 4: HISTORY */}
        {activeTab === 'history' && (
          <div className="card">
            <h3>Execution Logs</h3>
            <table className="rule-table">
              <thead><tr><th>Time</th><th>Rule</th><th>Status</th><th>Data</th></tr></thead>
              <tbody>
                {history.map(run => (
                  <tr key={run.id}>
                    <td>{run.executed_at}</td>
                    <td>{run.rule}</td>
                    <td><span className={`status-badge ${run.status === 'PASS' ? 'pass' : 'fail'}`}>{run.status}</span></td>
                    <td><button className="secondary" style={{padding:'4px 8px', fontSize:'0.75rem'}} onClick={() => setModalData(run.result)}>View Results</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}

export default App