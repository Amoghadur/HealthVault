import AuditDashboard from './components/AuditDashboard';
import { CONTRACT_ADDRESS } from './lib/blockchain';
import { StatusMessage } from './components/ui';

export default function AdminView({ account }) {
  return (
    <div className="role-view admin-view">
      <StatusMessage type="info">
        Network-wide statistics and anomaly detection are not implemented. This workspace shows
        verified activity involving your wallet; choosing this role does not grant access to other
        users' backend logs.
      </StatusMessage>

      <div
        className="panel network-details spatial-panel"
        style={{
          padding: '28px 32px',
          marginBottom: '24px',
        }}
      >
        <span className="section-label" style={{ marginBottom: '8px' }}>
          SMART CONTRACT DEPLOYMENT
        </span>
        <h2
          style={{
            fontSize: '18px',
            fontWeight: 600,
            color: 'var(--text-primary)',
            margin: '4px 0 8px 0',
          }}
        >
          Connected Sepolia Contract
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 12px 0' }}>
          Ethereum Sepolia Testnet · Chain ID 11155111
        </p>
        <code
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            background: 'var(--bg-surface-subtle)',
            padding: '8px 14px',
            borderRadius: 'var(--radius-pill)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--primary-dark)',
            display: 'inline-block',
            overflowWrap: 'anywhere',
          }}
        >
          {CONTRACT_ADDRESS}
        </code>
      </div>

      <AuditDashboard account={account} />
    </div>
  );
}
