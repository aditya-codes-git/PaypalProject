import { useState } from 'react';
import { ArrowDown, ArrowRight, Check, ChevronDown, ClipboardList, Clock3, FileCheck2, PackageCheck, ShieldCheck, Truck, Wallet } from 'lucide-react';
import { Brand } from './Brand';
import { ThemeToggle } from './Theme';
import './landing.css';

const workspace = '/?workspace=1';
const guest = '/?workspace=1&guest=1';
const target = 12;
const hygienePrice = 5;
const examples = [
  { label: 'Original plan', units: 12, price: 8, supplier: 'Summit Textiles', reason: 'All 12 kits fit the plan', note: 'The shelter fund pays for blankets. The hygiene grant pays for hygiene kits. Both suppliers can deliver within two days.' },
  { label: 'Supplier runs short', units: 8, price: 8, supplier: 'Summit Textiles', reason: 'Blanket stock limits coverage', note: 'Only 8 blankets are available by the deadline. Even with enough hygiene kits and funding, only 8 households can receive both supplies.' },
  { label: 'Shelter budget drops', units: 9, price: 8, supplier: 'Summit Textiles', reason: 'The shelter budget limits coverage', note: 'A $72 shelter budget buys 9 blankets at $8 each. The hygiene grant can only pay for kits, so it cannot cover the remaining blankets.' },
  { label: 'Cheaper supplier arrives late', units: 12, price: 9, supplier: 'Northstar Relief Goods', reason: 'The deadline changes the supplier', note: 'Summit’s $8 blankets now arrive after the deadline. Northstar’s $9 blankets arrive within two days, so all 12 households still get a complete kit.' },
];
const constraints = [
  { icon: PackageCheck, title: 'Complete kits', body: 'A household is covered when it gets every supply on its list.' },
  { icon: Wallet, title: 'Grant rules', body: 'Each purchase must use funding that allows that type of supply.' },
  { icon: Clock3, title: 'Stock and deadlines', body: 'An offer counts only for stock the supplier can deliver on time.' },
];
const steps = [
  { icon: ClipboardList, title: 'Enter needs and offers', body: 'Add your household target, supplies per household, delivery deadline, and supplier quotes.' },
  { icon: ShieldCheck, title: 'Confirm funding rules', body: 'Enter restrictions yourself or review suggestions from a grant document against the quoted source.' },
  { icon: PackageCheck, title: 'Review what to buy', body: 'See which offers fit, which grant pays for each purchase, and how many households get a complete kit.' },
  { icon: FileCheck2, title: 'Track what happens next', body: 'Approve the plan, test checkout with PayPal, log deliveries, and download a PDF purchase record.' },
];
const questions = [
  { question: 'What if I can’t supply every household?', answer: 'The plan shows how many complete kits you can buy within your limits. Update a supplier offer, budget, or deadline and generate another plan to see what changes.' },
  { question: 'How does ReliefOps use AI?', answer: 'AI suggests grant terms from uploaded documents. You review the source and confirm the terms. The purchasing planner then uses the confirmed rules, prices, stock, and delivery dates to calculate a plan.' },
  { question: 'Do I need an account or real money?', answer: 'You can build a plan as a guest with your own data. Sign in to save it, review grant documents, or approve purchases. Checkout uses PayPal sandbox test money.' },
];

export function Landing() {
  const [example, setExample] = useState(0);
  const plan = examples[example];
  const blanketCost = plan.units * plan.price;
  const hygieneCost = plan.units * hygienePrice;
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
          <h1 id="landing-title">Know what to buy. <em>Know who it will reach.</em></h1>
          <p className="landing-intro">ReliefOps helps relief teams decide which supplies to buy, which grants can pay, and how many households can receive a complete kit by the deadline.</p>
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
      <section className="landing-constraints landing-wrap" aria-labelledby="constraints-title">
        <h2 id="constraints-title">What makes a purchase plan work?</h2>
        <p className="landing-constraints-intro">The planner tries to cover as many households as possible, then looks for the lowest cost for that coverage.</p>
        <div>{constraints.map(({ icon: Icon, title, body }) => <article key={title}><span className="landing-card-icon"><Icon size={21} aria-hidden="true" /></span><div><h3>{title}</h3><p>{body}</p></div></article>)}</div>
      </section>
      <section className="landing-example" id="example" aria-labelledby="example-title">
        <div className="landing-wrap landing-example-inner">
          <div className="landing-example-copy">
            <p className="landing-kicker"><span /> Example plan</p>
            <h2 id="example-title">See what changes before you buy.</h2>
            <p>A winter shelter needs blankets and hygiene kits for 12 households within two days. Pick a scenario to see what ReliefOps would buy, how it would pay, and why.</p>
            <div className="landing-example-options" role="group" aria-label="Example conditions">
              {examples.map((item, index) => <button key={item.label} type="button" aria-pressed={example === index} onClick={() => setExample(index)}>{item.label}<ArrowRight size={16} aria-hidden="true" /></button>)}
            </div>
          </div>
          <article className="landing-preview" aria-labelledby="preview-title">
            <div className="landing-preview-head"><div><span>Winter shelter</span><h3 id="preview-title">Purchasing plan</h3></div><span className="landing-preview-time"><Truck size={16} aria-hidden="true" /> Within 2 days</span></div>
            <p className="sr-only" role="status">{plan.units} of {target} households covered. ${blanketCost + hygieneCost} planned cost. {plan.reason}.</p>
            <div className="landing-preview-result" key={example}>
              <div className="landing-preview-stats"><div><strong>{plan.units}<small> / {target}</small></strong><span>Households covered</span></div><div><strong>${blanketCost + hygieneCost}</strong><span>Planned cost</span></div></div>
              <div className="landing-coverage" aria-hidden="true">{Array.from({ length: target }, (_, index) => <span key={index} className={index < plan.units ? 'covered' : undefined} style={{ animationDelay: `${index * 30}ms` }} />)}</div>
              <div className="landing-preview-line"><span className="landing-card-icon"><Wallet size={18} aria-hidden="true" /></span><div><strong>{plan.units} thermal blankets</strong><span>{plan.supplier} · Shelter fund</span></div><strong>${blanketCost}</strong></div>
              <div className="landing-preview-line"><span className="landing-card-icon"><FileCheck2 size={18} aria-hidden="true" /></span><div><strong>{plan.units} hygiene kits</strong><span>Clearwater Supplies · Hygiene grant</span></div><strong>${hygieneCost}</strong></div>
              <div className="landing-preview-note"><strong>{plan.reason}</strong><p>{plan.note}</p></div>
            </div>
          </article>
        </div>
      </section>
      <section className="landing-workflow landing-wrap" id="workflow" aria-labelledby="workflow-title">
        <h2 id="workflow-title">From urgent needs to delivery records.</h2>
        <div className="landing-steps">{steps.map(({ icon: Icon, title, body }) => <article key={title}><span className="landing-card-icon"><Icon size={22} aria-hidden="true" /></span><h3>{title}</h3><p>{body}</p></article>)}</div>
      </section>
      <section className="landing-questions landing-wrap" aria-labelledby="questions-title">
        <h2 id="questions-title">Good to know before you start.</h2>
        <div>{questions.map(({ question, answer }) => <details key={question}><summary>{question}<ChevronDown size={18} aria-hidden="true" /></summary><p>{answer}</p></details>)}</div>
      </section>
      <section className="landing-bottom landing-wrap" aria-labelledby="start-title">
        <div><h2 id="start-title">Build your first relief plan.</h2><p>Start with your own data. Checkout uses PayPal test money.</p></div>
        <a className="landing-primary" href={guest}>Try the planner <ArrowRight size={18} aria-hidden="true" /></a>
      </section>
    </main>
    <footer className="landing-footer landing-wrap"><a href="#top" className="landing-brand"><Brand /></a><a href={workspace}>Open workspace <ArrowRight size={16} aria-hidden="true" /></a></footer>
  </div>;
}
