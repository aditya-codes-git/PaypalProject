export function Brand({ className = '' }: { className?: string }) {
  return <span className={`brand-lockup ${className}`}><img src="/brand/reliefops-mark.png" alt="" width="30" height="30" /><span>ReliefOps</span></span>;
}

export function AuthArtwork() {
  return <div className="auth-artwork" aria-label="ReliefOps connects needs, funding rules, and supplier offers to a purchasing plan">
    <div className="art-grid" />
    <svg className="art-connectors" viewBox="0 0 500 310" preserveAspectRatio="none" fill="none" aria-hidden="true"><path d="M115 65H195Q220 65 220 90V155M115 155H245M115 245H195Q220 245 220 220V155M280 155H385" stroke="currentColor" strokeWidth="1.5" /><circle cx="220" cy="155" r="4" fill="currentColor" /><circle cx="365" cy="155" r="3" fill="currentColor" /></svg>
    <div className="art-node node-needs"><span className="art-dot violet" />Supplies needed</div>
    <div className="art-node node-funds"><span className="art-dot blue" />Available funding</div>
    <div className="art-node node-suppliers"><span className="art-dot amber" />Supplier offers</div>
    <div className="art-center"><img src="/brand/reliefops-mark.png" alt="" /></div>
    <div className="art-node node-plan"><span className="art-dot green" />What to buy</div>
  </div>;
}
