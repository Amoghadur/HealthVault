import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../lib/api';
import { StatusMessage, StatCard } from './ui';
import { auditLabels as labels, filterAuditEvents, transactionUrl } from '../lib/audit';
const short = value => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : 'Unknown / unauthenticated';

export default function AuditDashboard({ account }) {
  const [events, setEvents] = useState([]);
  const [coverage, setCoverage] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [wallet, setWallet] = useState('');
  const [source, setSource] = useState('all');
  const [action, setAction] = useState('all');
  const [date, setDate] = useState('');
  const [page, setPage] = useState(1);
  const [blockInput, setBlockInput] = useState('');
  const request = useRef(null);
  const load = useCallback(async (range = '', append = false) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError('');
    try {
      const result = await apiRequest(`/audit${range}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setEvents(previous => {
        const combined = append ? [...previous.filter(e => e.source === 'blockchain'), ...result.events] : result.events;
        return [...new Map(combined.map(e => [e.id, e])).values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      });
      setCoverage(previous => append && !result.coverage ? previous : append && previous && result.coverage ? { ...result.coverage, toBlock: previous.toBlock, latestBlock: result.coverage.latestBlock } : result.coverage);
      setWarnings(result.warnings || []);
      setPage(1);
    } catch (err) { if (!controller.signal.aborted) setError(err.message); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => load(), 0);
    return () => { clearTimeout(timer); request.current?.abort(); };
  }, [account, load]);
  const filtered = filterAuditEvents(events, { source, action, date, query, wallet });
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, pages);
  function changeFilter(setter, value) { setter(value); setPage(1); }
  return <section className="audit-dashboard" aria-label="Audit dashboard">
    <div className="section-heading"><div><p className="eyebrow">VERIFIABLE ACTIVITY</p><h2>Audit dashboard</h2><p>History involving your connected wallet. Each entry identifies its source.</p></div><button className="secondary-button" onClick={() => load()} disabled={loading}>{loading ? 'Loading…' : 'Refresh latest'}</button></div>
    <div className="stat-grid">
      <StatCard label="Loaded events" value={loading && !events.length ? '—' : events.length} detail="Within the loaded history only" />
      <StatCard label="Blockchain events" value={loading && !events.length ? '—' : events.filter(e => e.source === 'blockchain').length} detail="From the deployed Sepolia contract" />
      <StatCard label="Backend activity" value={loading && !events.length ? '—' : events.filter(e => e.source === 'backend').length} detail="Persisted server actions" />
    </div>
    <div className="panel audit-panel">
      <StatusMessage type="error">{error}</StatusMessage>
      {error && events.length > 0 && <StatusMessage type="warning">Showing the previously loaded snapshot. The latest request failed.</StatusMessage>}
      {warnings.map(w => <StatusMessage type="warning" key={w}>{w}</StatusMessage>)}
      <p className="audit-explanation">Blockchain entries are emitted upload, grant, and revoke events; an upload event records a hash, not proof of file availability. Backend entries are server activity since logging was enabled; they are not immutable and do not prove someone read a document. Missing historical views are not reconstructed. Cancelled and reverted transactions emit no retained contract events and are not reconstructed here.</p>
      {coverage && <p className="coverage-note">Sepolia · Blocks {coverage.fromBlock.toLocaleString()}–{coverage.toBlock.toLocaleString()} searched · Head {coverage.latestBlock.toLocaleString()}. This is not all-time history.</p>}
      <form className="audit-range" onSubmit={e => { e.preventDefault(); if (/^\d+$/.test(blockInput)) load(`?toBlock=${blockInput}`); }}>
        <label>Search a historical block window<input aria-label="End block" type="number" min="0" step="1" value={blockInput} onChange={e => setBlockInput(e.target.value)} placeholder="End block number" /></label>
        <button className="secondary-button" disabled={loading || !/^\d+$/.test(blockInput)}>Load preceding 200 blocks</button>
      </form>
      <div className="audit-filters">
        <label>Search<input type="search" placeholder="Action, wallet, record ID or transaction" value={query} onChange={e => changeFilter(setQuery, e.target.value)} /></label>
        <label>Wallet address<input type="search" placeholder="Full or partial wallet" value={wallet} onChange={e => changeFilter(setWallet, e.target.value)} /></label>
        <label>Source<select aria-label="Source" value={source} onChange={e => changeFilter(setSource, e.target.value)}><option value="all">All sources</option><option value="blockchain">Blockchain</option><option value="backend">Backend</option></select></label>
        <label>Action<select aria-label="Action" value={action} onChange={e => changeFilter(setAction, e.target.value)}><option value="all">All actions</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Date (local)<input type="date" value={date} onChange={e => changeFilter(setDate, e.target.value)} /></label>
      </div>
      {loading && <StatusMessage>Reading audit history…</StatusMessage>}
      {!loading && filtered.length === 0 && <div className="empty-state"><strong>{error || warnings.length ? 'No events available in this view' : 'No matching events'}</strong><p>Try another filter or block window. An empty result does not establish that no earlier activity occurred.</p></div>}
      <ol className="audit-list" aria-busy={loading}>
        {filtered.slice((currentPage - 1) * 10, currentPage * 10).map(event => <li className="audit-entry" key={event.id}>
          <span className={`audit-marker ${event.source}`} aria-hidden="true">{event.source === 'blockchain' ? '◇' : '↗'}</span>
          <div className="audit-entry-main"><div className="audit-entry-heading"><h3>{labels[event.action] || event.action}</h3><span className={`source-badge ${event.source}`}>{event.source === 'blockchain' ? 'On-chain event' : 'Backend activity'}</span></div>
            <time dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleString()}</time>
            <dl><div><dt>Actor</dt><dd title={event.actor || ''}>{short(event.actor)}</dd></div><div><dt>Patient</dt><dd title={event.patient || ''}>{short(event.patient)}</dd></div>{event.doctor && <div><dt>Doctor</dt><dd title={event.doctor}>{short(event.doctor)}</dd></div>}{event.recordId && <div><dt>Record</dt><dd>{event.recordId}</dd></div>}</dl>
            {event.source === 'blockchain' ? <>
              <p className="event-detail">Included in block {event.blockNumber} · {event.confirmations} confirmation(s) when fetched</p>
              <div className="audit-transaction"><span className={`transaction-status ${event.transactionStatus === 'success' ? 'verified' : ''}`}>{event.transactionStatus === 'success' ? 'Success · receipt verified' : 'Transaction status not verified'}</span>
                {transactionUrl(event) ? <a href={transactionUrl(event)} target="_blank" rel="noopener noreferrer" title={event.transactionHash} aria-label={`View transaction ${event.transactionHash} on Sepolia Etherscan`}>Tx {short(event.transactionHash)} ↗</a> : <span>Transaction hash unavailable</span>}
              </div>
            </> : <p className="event-detail">Server outcome: {event.outcome}</p>}
          </div>
        </li>)}
      </ol>
      <div className="audit-pagination"><span>{filtered.length} matching entries · Page {currentPage} of {pages}</span><div><button className="secondary-button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</button><button className="secondary-button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
      {coverage?.nextToBlock != null && <button className="secondary-button" disabled={loading} onClick={() => load(`?toBlock=${coverage.nextToBlock}`, true)}>Load older blockchain events</button>}
    </div>
  </section>;
}
