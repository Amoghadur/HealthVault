import { useEffect, useState } from 'react';
import { consentPresentation } from '../lib/consentUi';
import './ConsentUI.css';

export function ConsentStatus({ detail }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (detail?.status !== 'active' || !detail?.expiresAt) return;
    const initial = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [detail?.status, detail?.expiresAt]);
  const view = consentPresentation(detail, now);
  return <div className={`consent-status consent-${view.status}`}>
    <div role="status" aria-live="polite"><strong>{view.label}</strong><span> — {view.description}</span></div>
    {view.countdown && <div className={`consent-countdown${view.endingSoon ? ' consent-ending' : ''}`}>
      <span role="timer" aria-live="off">{view.countdown}</span>
      {view.endingSoon && <span> · Less than one minute left</span>}
    </div>}
    {detail?.expiresAt && Number.isFinite(Date.parse(detail.expiresAt)) &&
      <small>Scheduled expiry: {new Date(detail.expiresAt).toLocaleString()}</small>}
  </div>;
}

export function ConsentDuration({ value, onChange, disabled }) {
  return <fieldset className="consent-duration" disabled={disabled}>
    <legend>Access duration <span>(maximum 60 minutes)</span></legend>
    <div>{[5, 15, 30, 60].map(minutes => <button key={minutes} type="button"
      aria-pressed={value === minutes} onClick={() => onChange(minutes)}>
      {minutes} min
    </button>)}</div>
    <small>Temporary access ends automatically. You can revoke it sooner.</small>
  </fieldset>;
}
