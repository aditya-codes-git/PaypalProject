import { useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronDown, ClipboardList, Clock3, FileCheck2, PackageCheck, ShieldCheck, Truck, Wallet } from 'lucide-react';
import { LazyMotion, domAnimation, useReducedMotion, useScroll, useTransform } from 'motion/react';
import * as m from 'motion/react-m';
import { Brand } from './Brand';
import { LandingPayPal } from './LandingPayPal';
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
  const reduceMotion = useReducedMotion();
  const hero = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: hero, offset: ['start start', 'end start'] });
  const artOffset = useTransform(scrollYProgress, [0, 1], [0, 100]);
  const reveal = {
    initial: reduceMotion ? false as const : { opacity: 0.35, y: 26 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.18 },
    transition: { duration: reduceMotion ? 0 : 0.65, ease: 'easeOut' as const },
  };
  const enterArt = (delay: number, x: number) => ({
    initial: reduceMotion ? false as const : { opacity: 0, x, y: 46, scale: 0.86 },
    animate: { opacity: 1, x: 0, y: 0, scale: 1 },
    transition: { type: 'spring' as const, stiffness: 85, damping: 15, delay: reduceMotion ? 0 : delay },
  });
  const plan = examples[example];
  const blanketCost = plan.units * plan.price;
  const hygieneCost = plan.units * hygienePrice;
  return <LazyMotion features={domAnimation}><div className="landing" id="top">
    <a className="landing-skip" href="#landing-content">Skip to content</a>
    <header className="landing-header landing-wrap">
      <a href="/" className="landing-brand"><Brand /></a>
      <nav aria-label="Main navigation"><a href="#example">Example plan</a><a href="#workflow">How it works</a><a href="#paypal">PayPal checkout</a></nav>
      <div className="landing-nav-actions"><ThemeToggle animate /><a className="landing-signin" href={workspace}>Sign in</a></div>
    </header>
    <main id="landing-content">
      <section ref={hero} className="landing-hero" aria-labelledby="landing-title">
        <m.div className="landing-hero-copy" initial={reduceMotion ? false : { opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.68, ease: 'easeOut' }}>
          <div className="landing-hero-mark"><img src="/brand/reliefops-mark.png" alt="" width="38" height="38" /></div>
          <h1 id="landing-title">Plan what to buy. <em>Know who it reaches.</em></h1>
          <p className="landing-intro">Turn supplier quotes and grant rules into a relief purchasing plan. See how many households you can supply by the deadline.</p>
          <div className="landing-actions">
            <a className="landing-primary" href={guest}>Try the planner <ArrowUpRight size={17} aria-hidden="true" /></a>
            <a className="landing-secondary" href="#example">See an example <ArrowDown size={15} aria-hidden="true" /></a>
          </div>
        </m.div>
        <m.div className="landing-hero-art" aria-hidden="true" style={{ y: reduceMotion ? 0 : artOffset }}>
          <m.div className="landing-hero-grant" {...enterArt(0.18, -34)}>
            <FileCheck2 size={22} /><strong>Shelter fund</strong><span>Approved spending</span><p>Blankets only</p>
          </m.div>
          <m.img className="landing-kit" src="/brand/relief-kit-cutout.webp" alt="" width="900" height="900" fetchPriority="high" {...enterArt(0.34, -36)} />
          <m.div className="landing-hero-stock" {...enterArt(0.28, 38)}>
            <div><Truck size={16} /> Summit Textiles</div><strong>12 blankets</strong><span>In stock · 2-day delivery</span>
          </m.div>
          <m.div className="landing-hero-plan" {...enterArt(0.45, 36)}>
            <span><PackageCheck size={16} /> Winter shelter</span>
            <strong>12<small>/12</small></strong><p>Households covered</p>
            <div><Check size={14} /> Within budget <Check size={14} /> On time</div>
          </m.div>
        </m.div>
        <p className="landing-hero-caption">Winter shelter · Illustrative plan</p>
      </section>
      <section className="landing-example" id="example" aria-labelledby="example-title">
        <div className="landing-wrap landing-example-inner">
          <m.div className="landing-example-copy" {...reveal}>
            <p className="landing-kicker"><span /> Interactive example</p>
            <h2 id="example-title">Test a plan before you buy.</h2>
            <p>A winter shelter needs blankets and hygiene kits for 12 households within two days. Change a condition to see what you can still buy.</p>
            <div className="landing-example-options" role="group" aria-label="Example conditions">
              {examples.map((item, index) => <m.button key={item.label} type="button" aria-pressed={example === index} onClick={() => setExample(index)} whileTap={reduceMotion ? undefined : { scale: 0.98 }}>{item.label}<ArrowRight size={16} aria-hidden="true" /></m.button>)}
            </div>
          </m.div>
          <m.article className="landing-preview" aria-labelledby="preview-title" {...reveal}>
            <div className="landing-preview-head"><div><span>Winter shelter</span><h3 id="preview-title">Purchasing plan</h3></div><span className="landing-preview-time"><Truck size={16} aria-hidden="true" /> Within 2 days</span></div>
            <p className="sr-only" role="status">{plan.units} of {target} households covered. ${blanketCost + hygieneCost} planned cost. {plan.reason}.</p>
            <m.div className="landing-preview-result" key={example} initial={reduceMotion ? false : { opacity: 0.25, y: 13 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.36 }}>
              <div className="landing-preview-stats"><div><strong>{plan.units}<small> / {target}</small></strong><span>Households covered</span></div><div><strong>${blanketCost + hygieneCost}</strong><span>Planned cost</span></div></div>
              <div className="landing-coverage" aria-hidden="true">{Array.from({ length: target }, (_, index) => (
                <span key={index}>{index < plan.units && <m.span className="covered" initial={reduceMotion ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: reduceMotion ? 0 : 0.28, delay: reduceMotion ? 0 : index * 0.027 }} />}</span>
              ))}</div>
              <div className="landing-preview-line"><span className="landing-card-icon"><Wallet size={18} aria-hidden="true" /></span><div><strong>{plan.units} thermal blankets</strong><span>{plan.supplier} · Shelter fund</span></div><strong>${blanketCost}</strong></div>
              <div className="landing-preview-line"><span className="landing-card-icon"><FileCheck2 size={18} aria-hidden="true" /></span><div><strong>{plan.units} hygiene kits</strong><span>Clearwater Supplies · Hygiene grant</span></div><strong>${hygieneCost}</strong></div>
              <div className="landing-preview-note"><strong>{plan.reason}</strong><p>{plan.note}</p></div>
            </m.div>
          </m.article>
        </div>
      </section>
      <section className="landing-workflow landing-wrap" id="workflow" aria-labelledby="workflow-title">
        <m.div className="landing-workflow-art" {...reveal}>
          <div>
            <h2 id="workflow-title">From grant rules to relief kits.</h2>
            <p>ReliefOps looks for the most complete kits you can deliver by the deadline, then the lowest cost at that coverage.</p>
          </div>
          <img src="/brand/relief-blanket-cutout.webp" alt="" width="1000" height="667" loading="lazy" />
        </m.div>
        <div className="landing-workflow-body">
          <div className="landing-constraints">{constraints.map(({ icon: Icon, title, body }) => <article key={title}><span className="landing-card-icon"><Icon size={19} aria-hidden="true" /></span><div><h3>{title}</h3><p>{body}</p></div></article>)}</div>
          <ol className="landing-steps">{steps.map(({ icon: Icon, title, body }) => <li key={title}><Icon size={19} aria-hidden="true" /><div><h3>{title}</h3><p>{body}</p></div></li>)}</ol>
        </div>
      </section>
      <LandingPayPal />
      <section className="landing-records" id="records" aria-labelledby="records-title">
        <div className="landing-wrap">
          <m.div className="landing-records-heading" {...reveal}>
            <h2 id="records-title">Keep a record of what you approved and what arrived.</h2>
            <p>Review the grant terms before you commit. After delivery, compare what you received with what you ordered and export the purchase record.</p>
          </m.div>
          <div className="landing-record-grid">
            <m.article className="landing-record-card" {...reveal}>
              <span className="landing-card-icon"><ShieldCheck size={21} aria-hidden="true" /></span>
              <h3>Check each rule against the grant</h3>
              <p>Review the source passage alongside the suggested restriction, then confirm what the grant can cover.</p>
              <figure className="landing-source-sample">
                <figcaption>Sample grant excerpt</figcaption>
                <blockquote>“Shelter funds may be used to purchase thermal blankets.”</blockquote>
                <span><Check size={15} aria-hidden="true" /> Eligible purchase · Thermal blankets</span>
              </figure>
            </m.article>
            <m.article className="landing-record-card" {...reveal}>
              <span className="landing-card-icon"><FileCheck2 size={21} aria-hidden="true" /></span>
              <h3>Document what actually arrived</h3>
              <p>Log deliveries against approved purchases. The PDF records amounts, funding allocations, and delivery receipts.</p>
              <div className="landing-receipt-sample">
                <strong>Sample delivery receipt</strong>
                <dl><div><dt>Ordered</dt><dd>12 blankets</dd></div><div><dt>Received</dt><dd>10 blankets</dd></div><div><dt>Outstanding</dt><dd>2 blankets</dd></div></dl>
              </div>
            </m.article>
          </div>
        </div>
      </section>
      <m.section className="landing-questions landing-wrap" id="questions" aria-labelledby="questions-title" {...reveal}>
        <h2 id="questions-title">Good to know before you start.</h2>
        <div>{questions.map(({ question, answer }) => <details key={question}><summary>{question}<ChevronDown size={18} aria-hidden="true" /></summary><p>{answer}</p></details>)}</div>
      </m.section>
      <section className="landing-bottom landing-wrap" aria-labelledby="start-title">
        <div><h2 id="start-title">Build your first relief plan.</h2><p>Start with your own data. Checkout uses PayPal test money.</p></div>
        <a className="landing-primary" href={guest}>Try the planner <ArrowRight size={18} aria-hidden="true" /></a>
      </section>
    </main>
    <footer className="landing-footer">
      <div className="landing-wrap">
        <div className="landing-footer-main">
          <div><a href="#top" className="landing-brand"><Brand /></a><p>Purchase planning for relief teams.</p></div>
          <nav aria-label="Explore ReliefOps"><strong>Explore</strong><a href="#example">Example plan</a><a href="#workflow">How it works</a><a href="#paypal">PayPal checkout</a><a href="#records">Purchase records</a></nav>
          <nav aria-label="Get started"><strong>Get started</strong><a href={guest}>Try the planner</a><a href={workspace}>Open workspace</a><a href="#questions">Common questions</a></nav>
          <nav aria-label="Project resources"><strong>Project</strong><a href="https://github.com/aditya-codes-git/PaypalProject">Source code <ArrowUpRight size={14} aria-hidden="true" /></a></nav>
        </div>
        <div className="landing-footer-base"><p>PayPal sandbox · Test payments only</p><a href="#top">Back to top <ArrowUpRight size={15} aria-hidden="true" /></a></div>
      </div>
    </footer>
  </div></LazyMotion>;
}
