import { useRef, useState } from 'react';
import { ArrowDown, ArrowRight, Check, CircleDollarSign, ExternalLink, FileCheck2, LockKeyhole, Wallet } from 'lucide-react';
import { useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react';
import * as m from 'motion/react-m';

const stages = [
  { title: 'Reserve the budget', icon: Wallet, status: 'Funds reserved', reserved: '$96.00', spent: '$0.00', note: 'Approving the purchase sets aside $96 from the shelter fund in ReliefOps, so it’s accounted for when you plan again.' },
  { title: 'Approve in PayPal', icon: ExternalLink, status: 'Awaiting buyer approval', reserved: '$96.00', spent: '$0.00', note: 'ReliefOps sends the approved amount to PayPal. A sandbox buyer opens checkout and approves the test payment there.' },
  { title: 'Confirm the payment', icon: CircleDollarSign, status: 'Paid in sandbox', reserved: '$0.00', spent: '$96.00', note: 'After checkout, ReliefOps confirms the payment with PayPal. When PayPal reports it complete, the amount moves from reserved to spent.' },
  { title: 'Keep the purchase record', icon: FileCheck2, status: 'Ready for delivery', reserved: '$0.00', spent: '$96.00', note: 'The PayPal payment reference stays with the approved purchase. You can log what actually arrives and export the record as a PDF.' },
];

export function LandingPayPal() {
  const [active, setActive] = useState(0);
  const reducedMotion = useReducedMotion();
  const track = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();
  const stage = stages[active];

  function scrollRange() {
    if (!track.current || !scene.current) return null;
    const distance = track.current.clientHeight - scene.current.offsetHeight;
    if (distance <= 0) return null;
    const inset = Number.parseFloat(getComputedStyle(scene.current).top);
    return { start: track.current.getBoundingClientRect().top + window.scrollY - inset, distance };
  }

  useMotionValueEvent(scrollY, 'change', position => {
    const range = scrollRange();
    if (!range) return;
    const index = Math.floor((position - range.start) / range.distance * stages.length);
    setActive(Math.max(0, Math.min(index, stages.length - 1)));
  });

  function selectStage(index: number) {
    setActive(index);
    const range = scrollRange();
    if (range) window.scrollTo({ top: range.start + range.distance * (index + 0.5) / stages.length });
  }

  return <section className="landing-paypal" id="paypal" aria-labelledby="paypal-title">
    <div className="landing-wrap">
      <header className="landing-paypal-intro">
        <p className="landing-kicker"><span /> PayPal integration</p>
        <h2 id="paypal-title">Follow a purchase from grant to payment.</h2>
        <p>PayPal handles checkout. ReliefOps keeps the payment tied to the approved supplies, the grant that paid, and the delivery record.</p>
        <div className="landing-paypal-scroll-hint">
          <m.span aria-hidden="true" initial={false} whileInView={reducedMotion ? undefined : { y: [0, 5, 0] }} viewport={{ once: true }} transition={{ duration: 0.9, repeat: 1 }}>
            <ArrowDown size={19} />
          </m.span>
          <p><strong>Scroll to move through checkout</strong><small>The receipt updates at each step.</small></p>
        </div>
      </header>
      <div ref={track} className="landing-paypal-track">
        <div ref={scene} className="landing-paypal-inner">
          <div>
            <div className="landing-paypal-progress">
              <span>Step {active + 1} of {stages.length}</span>
              <div aria-hidden="true">{stages.map(({ title }, index) => <span key={title} className={index <= active ? 'is-reached' : undefined} />)}</div>
            </div>
            <ol className="landing-paypal-steps" aria-label="Sample purchase journey">
              {stages.map(({ title, icon: Icon }, index) => (
                <li key={title}>
                  <button type="button" aria-pressed={index === active} aria-controls="paypal-receipt" onClick={() => selectStage(index)}>
                    <span className="landing-paypal-step-icon">{index < active ? <Check size={17} aria-hidden="true" /> : <Icon size={17} aria-hidden="true" />}</span>
                    <span>{title}</span>
                    <ArrowRight className="landing-paypal-step-arrow" size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ol>
            <p className="landing-paypal-sandbox"><LockKeyhole size={15} aria-hidden="true" /> Interactive example · PayPal sandbox · No real payment</p>
          </div>
          <div className="landing-paypal-stage">
            <article className="landing-paypal-receipt" id="paypal-receipt" aria-label="Sample purchase">
              <div className="landing-paypal-receipt-top"><span>Sample purchase</span><strong>PayPal</strong></div>
              <div className="landing-paypal-purchase"><h3>12 thermal blankets</h3><p>Summit Textiles · Shelter fund</p><strong>$96.00 <small>USD</small></strong></div>
              <m.div className="landing-paypal-state" key={stage.title}
                initial={reducedMotion ? false : { opacity: 0.4, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reducedMotion ? 0 : 0.26 }}>
                <dl>
                  <div><dt>Purchase status</dt><dd>{stage.status}</dd></div>
                  <div><dt>Reserved in ReliefOps</dt><dd>{stage.reserved}</dd></div>
                  <div><dt>Spent in ReliefOps</dt><dd>{stage.spent}</dd></div>
                </dl>
                <p>{stage.note}</p>
              </m.div>
              <p className="sr-only" role="status">{stage.status}. {stage.reserved} reserved. {stage.spent} spent.</p>
            </article>
          </div>
        </div>
      </div>
    </div>
    <div className="landing-wrap landing-paypal-followup">
      <p><strong>Unsure whether checkout went through?</strong> Check the existing order’s status with PayPal before trying again. For a paid purchase, you can also request a full refund.</p>
    </div>
  </section>;
}
