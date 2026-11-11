import { useState } from 'react';
import { ArrowDown, ArrowRight, Check, ClipboardList, FileCheck2, PackageCheck, ShieldCheck, Truck, Wallet } from 'lucide-react';
import { Brand } from './Brand';
import { ThemeToggle } from './Theme';
import './landing.css';

const workspace = '/?workspace=1';
const guest = '/?workspace=1&guest=1';
const examples = [
  { label: 'Original plan', covered: 12, cost: '$156', note: 'Both suppliers can deliver within two days.', supplier: 'Summit Textiles', blankets: '$96', units: 12 },
  { label: 'Supplier runs short', covered: 8, cost: '$104', note: 'Only 8 blankets are available by the deadline, so the plan covers 8 households.', supplier: 'Summit Textiles', blankets: '$64', units: 8 },
  { label: 'Shelter budget drops', covered: 9, cost: '$117', note: 'A $72 shelter budget buys 9 blankets. The hygiene grant still pays for kits only.', supplier: 'Summit Textiles', blankets: '$72', units: 9 },
];
const steps = [
  { icon: ClipboardList, title: 'Enter what households need', body: 'Set a delivery deadline. Add the supplies each household needs and the offers you have from suppliers.' },
  { icon: ShieldCheck, title: 'Check what grants can cover', body: 'Add spending rules yourself, or upload a grant document and review the suggested rules against the source.' },
  { icon: PackageCheck, title: 'Approve a plan and track delivery', body: 'Compare what you can buy, approve purchases, test PayPal checkout, and download a PDF purchase record.' },
];

export function Landing() {
  const [example, setExample] = useState(0);
  const plan = examples[example];
  return <div className="landing" id="top">
    <a className="landing-skip" href="#landing-content">Skip to content</a>
    <header className="landing-header landing-wrap">
      <a href="/" className="landing-brand"><Brand /></a>
      <nav aria-label="Main navigation"><a href="#workflow">How it works</a><a href="#example">Example plan</a></nav>
      <div className="landing-nav-actions"><ThemeToggle /><a className="landing-signin" href={workspace}>Sign in</a></div>
    </header>
    <main id="landing-content">
      <section className="landing-hero landing-wrap" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <p className="landing-kicker"><span /> Relief purchasing planner</p>
          <h1 id="landing-title">Get relief supplies <em>where they’re needed.</em></h1>
          <p className="landing-intro">Find out how many households you can supply on time. Build a purchasing plan around grant rules, supplier stock, and your delivery deadline.</p>
          <div className="landing-actions">
            <a className="landing-primary" href={guest}>Try the planner <ArrowRight size={18} aria-hidden="true" /></a>
            <a className="landing-secondary" href="#example">See an example <ArrowDown size={16} aria-hidden="true" /></a>
          </div>
          <p className="landing-microcopy">No account needed to build a plan.</p>
        </div>
        <div className="landing-hero-art">
          <img src="/brand/relief-supplies.webp" alt="Volunteers packing blankets and hygiene supplies in a relief warehouse" width="960" height="640" fetchPriority="high" />
          <div className="landing-hero-card">
            <span className="landing-card-icon"><PackageCheck size={21} aria-hidden="true" /></span>
            <div><span>Example plan · Winter shelter</span><strong>12 households covered</strong></div>
            <span className="landing-ready"><Check size={13} aria-hidden="true" /> On time</span>
          </div>
        </div>
      </section>
      <section className="landing-example" id="example" aria-labelledby="example-title">
        <div className="landing-wrap landing-example-inner">
          <div className="landing-example-copy">
            <p className="landing-kicker"><span /> Example plan</p>
            <h2 id="example-title">See what changes before you buy.</h2>
            <p>A winter shelter needs one blanket and one hygiene kit per household. See how fewer blankets or a smaller grant changes the plan.</p>
            <div className="landing-example-options" role="group" aria-label="Example conditions">
              {examples.map((item, index) => <button key={item.label} type="button" aria-pressed={example === index} onClick={() => setExample(index)}>{item.label}<ArrowRight size={16} aria-hidden="true" /></button>)}
            </div>
          </div>
          <article className="landing-preview" aria-live="polite">
            <div className="landing-preview-head"><div><span>Winter shelter</span><h3>Purchasing plan</h3></div><span className="landing-preview-time"><Truck size={16} aria-hidden="true" /> Within 2 days</span></div>
            <div className="landing-preview-stats"><div><strong>{plan.covered}<small> / 12</small></strong><span>Households covered</span></div><div><strong>{plan.cost}</strong><span>Planned cost</span></div></div>
            <div className="landing-preview-line"><span className="landing-card-icon"><Wallet size={18} aria-hidden="true" /></span><div><strong>{plan.units} thermal blankets</strong><span>{plan.supplier} · Shelter fund</span></div><strong>{plan.blankets}</strong></div>
            <div className="landing-preview-line"><span className="landing-card-icon"><FileCheck2 size={18} aria-hidden="true" /></span><div><strong>{plan.units} hygiene kits</strong><span>Clearwater Supplies · Hygiene grant</span></div><strong>${plan.units * 5}</strong></div>
            <p className="landing-preview-note">{plan.note}</p>
          </article>
        </div>
      </section>
      <section className="landing-workflow landing-wrap" id="workflow" aria-labelledby="workflow-title">
        <h2 id="workflow-title">From urgent needs to approved purchases.</h2>
        <div className="landing-steps">{steps.map(({ icon: Icon, title, body }) => <article key={title}><span className="landing-card-icon"><Icon size={22} aria-hidden="true" /></span><h3>{title}</h3><p>{body}</p></article>)}</div>
      </section>
      <section className="landing-bottom landing-wrap" aria-labelledby="start-title">
        <div><h2 id="start-title">Build your first relief plan.</h2><p>Start with your own data. Checkout uses PayPal test money.</p></div>
        <a className="landing-primary" href={guest}>Try the planner <ArrowRight size={18} aria-hidden="true" /></a>
      </section>
    </main>
    <footer className="landing-footer landing-wrap"><a href="#top" className="landing-brand"><Brand /></a><a href={workspace}>Open workspace <ArrowRight size={16} aria-hidden="true" /></a></footer>
  </div>;
}
