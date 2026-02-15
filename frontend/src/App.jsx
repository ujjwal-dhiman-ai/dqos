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
  
  // HISTORY STATE
  const [history, setHistory] = useState([])
  const [modalData, setModalData] = useState(null) // For the popup
  
  const API_URL = "http://localhost:8000"

  useEffect(() => {
    if (activeTab === 'rules') fetchRules()
    if (activeTab === 'history') fetchHistory()
  }, [activeTab])

  const fetchRules = async () => {
    try { const res = await axios.get(`${API_URL}/rules/`); setRules(res.data) }
    catch (err) { console.error(err) }
  }

  const fetchHistory = async () => {
    try { const res = await axios.get(`${API_URL}/history/`); setHistory(res.data) }
    catch (err) { console.error(err) }
  }

  const runAdHoc = async () => {
    setResult(null)
    try {
      let parsedParams = {}
      try { parsedParams = JSON.parse(params) } catch (e) { return alert("Invalid JSON in Parameters") }

      const res = await axios.post(`${API_URL}/run-adhoc`, { sql, params: parsedParams })
      setResult(res.data.data) // Store just the array of rows
    } catch (err) {
      alert("Error: " + (err.response?.data?.detail || err.message))
    }
  }

  const saveOrUpdateRule = async () => {
    if(!ruleName) return alert("Please name your rule!")
    
    try {
      // Parse params from the text box
      let parsedParams = {}
      try { parsedParams = JSON.parse(params) } catch (e) { return alert("Invalid JSON in Parameters") }

      // Send params in payload
      const payload = { 
        name: ruleName, 
        sql: sql,
        params: parsedParams // <--- SENDING PARAMS NOW
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
    setEditingId(rule.id)
    setResult(null)
    setActiveTab('playground')
  }

  const executeRule = async (id) => {
    try {
      const res = await axios.post(`${API_URL}/run-rule/${id}`, {})
      alert(`Status: ${res.data.status}\nRows: ${res.data.data.length}`)
      if(activeTab === 'history') fetchHistory()
    } catch (err) {
      alert("Execution Failed")
    }
  }

  return (
    <div className="container">
      {modalData && <DataModal data={modalData} onClose={() => setModalData(null)} />}

      <nav className="sidebar">
        <h2>DQ OS</h2>
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
            
            <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '20px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <label style={{marginBottom: '5px', fontWeight: 'bold', color: '#64748b'}}>SQL Query</label>
                <textarea value={sql} onChange={(e) => setSql(e.target.value)} rows={12} placeholder="SELECT * FROM table..." />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <label style={{marginBottom: '5px', fontWeight: 'bold', color: '#64748b'}}>Params (JSON)</label>
                <textarea value={params} onChange={(e) => setParams(e.target.value)} rows={12} placeholder="{}"  style={{ fontFamily: 'monospace', fontSize: '0.85rem' }} />
              </div>
            </div>

            <div className="actions">
              <input placeholder="Rule Name" value={ruleName} onChange={(e) => setRuleName(e.target.value)} style={{flex: 1}} />
              <button onClick={saveOrUpdateRule} className="secondary">
                {editingId ? "Update Rule" : "Save as Rule"}
              </button>
              <button onClick={runAdHoc} className="primary">Run Now</button>
            </div>

            {result && (
              <div className="results">
                <h4>Result Preview ({result.length} rows)</h4>
                <div style={{
                  overflowX: 'auto',
                  overflowY: 'auto',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  marginTop: '1rem',
                  maxHeight: '240px'
                }}>
                  <ResultsTable data={result} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: RULES */}
        {activeTab === 'rules' && (
          <div className="card">
            <h3>Your Rule Library</h3>
            <table className="rule-table">
              <thead><tr><th>ID</th><th>Name</th><th>Actions</th></tr></thead>
              <tbody>
                {rules.map(r => (
                  <tr key={r.id}>
                    <td style={{width:'50px'}}>{r.id}</td>
                    <td>{r.name}</td>
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

        {/* TAB 3: HISTORY */}
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
                    <td>
                      <button className="secondary" style={{padding:'4px 8px', fontSize:'0.75rem'}} onClick={() => setModalData(run.result)}>
                        View Results
                      </button>
                    </td>
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