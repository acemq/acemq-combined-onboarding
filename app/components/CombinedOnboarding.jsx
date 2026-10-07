'use client';

import { useState, useRef, useImperativeHandle, forwardRef } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const DEPLOYMENT_ENV_OPTIONS = [
  'Kubernetes — TKG / TAP / Helm',
  'Linux VM / Bare Metal',
  'Docker / Podman / Container',
  'Windows',
];

const RABBITMQ_PRODUCT_OPTIONS = [
  'Tanzu RabbitMQ 3.13.x — Post 3.13.7',
  'Tanzu RabbitMQ 4.x — Kubernetes only',
  'Open Source RabbitMQ 3.13.x+ — Post 3.13.7',
];

const ENVIRONMENT_USE_OPTIONS = [
  'Development / Testing',
  'Staging / QA',
  'Production',
];

const PACKAGING_FORMAT_OPTIONS = [
  'Helm Chart',
  'OCI Image',
  'DEB',
  'RPM',
  'tar.gz',
  'Windows ZIP',
  'TAP Bundle',
  'TKG Integration',
  'VMware OVA',
];

const BROKER_PACKAGING_OPTIONS = [
  'RPM',
  'DEB',
  'tar.gz',
  'Windows ZIP',
  'OCI Image',
  'Helm Chart',
];

const BROKER_INSTALL_TYPE_OPTIONS = [
  'Migrating from an existing RabbitMQ environment',
  'New installation',
];

const YES_NO_UNSURE = ['Yes', 'No', 'Not sure'];

const SCHEDULING_OPTIONS = [
  'Fixed Reoccurring Time Slot',
  'Dynamically Scheduled Sessions',
];

const TIME_SLOT_OPTIONS = [
  'Mornings (9am–12pm)',
  'Afternoons (12pm–5pm)',
  'Full-day availability',
  'Flexible / No preference',
];

const TIMEZONE_OPTIONS = [
  'Eastern (ET) — UTC-5/4',
  'Central (CT) — UTC-6/5',
  'Mountain (MT) — UTC-7/6',
  'Pacific (PT) — UTC-8/7',
  'Alaska (AKT) — UTC-9/8',
  'Hawaii (HT) — UTC-10',
  'Atlantic (AT) — UTC-4/3',
  'UTC / GMT',
  'London (GMT/BST) — UTC+0/1',
  'Central European (CET) — UTC+1/2',
  'Eastern European (EET) — UTC+2/3',
  'India (IST) — UTC+5:30',
  'Singapore / HKT — UTC+8',
  'Japan (JST) — UTC+9',
  'Sydney (AEST) — UTC+10/11',
  'New Zealand (NZST) — UTC+12/13',
];

const ENGAGEMENT_ROLE_OPTIONS = [
  'Lead Stakeholder',
  'Technical Lead',
  'Architect',
  'Platform Owner',
  'Project Manager',
  'Observer',
  'Other',
];

const ENGAGEMENT_TYPE_OPTIONS = [
  'Architecture Review',
  'Migration',
  'Implementation',
  'Performance Tuning',
  'Training',
  'Other',
];

// ─────────────────────────────────────────────────────────────────────────────
// STEP LIST BUILDER
// ─────────────────────────────────────────────────────────────────────────────

function buildStepList(services) {
  const list = ['contact', 'services'];
  if (services.engagement) list.push('engagement');
  if (services.license) {
    list.push('license-tech');
    list.push('license-usage');
    list.push('license-users');
  }
  if (services.broker) {
    list.push('broker-tech');
    list.push('broker-golive');
    list.push('broker-users');
  }
  if (services.support) list.push('support-users');
  return list;
}

// Labels shown in each section header's "what's left" trail.
const STEP_LABELS = {
  'engagement':    'Engagement details',
  'license-tech':  'License config',
  'license-usage': 'License usage',
  'license-users': 'License users',
  'broker-tech':   'Broker environment',
  'broker-golive': 'Go-live readiness',
  'broker-users':  'Repo access',
  'support-users': 'Support users',
};

// ─────────────────────────────────────────────────────────────────────────────
// UI PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

function BtnOrange({ onClick, disabled, children, className = '' }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`bg-[#FF6600] text-white border-none rounded-[3rem] px-[4rem] py-[1.2rem] text-[1.7rem] font-[400] cursor-pointer hover:opacity-90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all inline-flex items-center gap-[0.8rem] ${className}`}>
      {children}
    </button>
  );
}

function BtnGhost({ onClick, children, className = '' }) {
  return (
    <button onClick={onClick}
      className={`bg-white text-black border border-black rounded-[3rem] px-[3.5rem] py-[1.2rem] text-[1.7rem] font-[400] cursor-pointer hover:bg-[#f5f5f5] active:scale-[0.98] transition-all ${className}`}>
      {children}
    </button>
  );
}

function SectionLabel({ children }) {
  return <p className="text-[#FF6600] text-[1.2rem] font-[400] tracking-[0.15em] uppercase mb-[0.8rem]">{children}</p>;
}

function QHead({ children }) {
  return <h2 className="text-[#000000] text-[2.8rem] leading-[1.3] font-[700] mb-[0.8rem]">{children}</h2>;
}

function QSub({ children, className = '' }) {
  return <p className={`text-[#999999] text-[1.6rem] leading-[1.65] mb-[2.4rem] ${className}`}>{children}</p>;
}

function TF({ type = 'text', placeholder, value, onChange, required }) {
  return (
    <input type={type} placeholder={placeholder} value={value} onChange={onChange} required={required}
      className="w-full bg-white border border-[rgba(0,0,0,0.12)] rounded-[1rem] px-[1.6rem] py-[1.3rem] text-[1.6rem] text-black placeholder:text-[#bbbbbb] outline-none focus:border-[#FF6600] focus:shadow-[0_0_0_3px_rgba(255,102,0,0.08)] transition-all mb-[1rem]" />
  );
}

function TA({ placeholder, value, onChange, rows = 4 }) {
  return (
    <textarea placeholder={placeholder} value={value} onChange={onChange} rows={rows}
      className="w-full bg-white border border-[rgba(0,0,0,0.12)] rounded-[1rem] px-[1.6rem] py-[1.3rem] text-[1.6rem] text-black placeholder:text-[#bbbbbb] outline-none focus:border-[#FF6600] focus:shadow-[0_0_0_3px_rgba(255,102,0,0.08)] transition-all mb-[1rem] resize-y" />
  );
}

function Choice({ selected, onClick, children }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-[1.4rem] border rounded-[1rem] px-[1.6rem] py-[1.3rem] w-full text-left text-[1.6rem] cursor-pointer transition-all mb-[0.8rem] ${
        selected
          ? 'border-[#FF6600] bg-[rgba(255,102,0,0.05)] text-[#000000]'
          : 'border-[rgba(0,0,0,0.1)] bg-[#fafafa] text-[#161616] hover:border-[#FF6600] hover:bg-[rgba(255,102,0,0.03)]'
      }`}>
      <span className={`w-[1.8rem] h-[1.8rem] rounded-full border flex-shrink-0 flex items-center justify-center transition-all ${
        selected ? 'border-[#FF6600] bg-[#FF6600]' : 'border-[rgba(0,0,0,0.2)]'
      }`}>
        {selected && <span className="w-[0.6rem] h-[0.6rem] bg-white rounded-full block" />}
      </span>
      {children}
    </button>
  );
}

function Chip({ selected, onClick, children }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-[1rem] border rounded-[1rem] px-[1.6rem] py-[1.1rem] text-left text-[1.5rem] cursor-pointer transition-all mb-[0.8rem] ${
        selected
          ? 'border-[#FF6600] bg-[rgba(255,102,0,0.07)] text-[#000000]'
          : 'border-[rgba(0,0,0,0.1)] bg-[#fafafa] text-[#161616] hover:border-[#FF6600] hover:bg-[rgba(255,102,0,0.03)]'
      }`}>
      <span className={`w-[1.6rem] h-[1.6rem] rounded-[4px] border flex-shrink-0 flex items-center justify-center transition-all ${
        selected ? 'border-[#FF6600] bg-[#FF6600]' : 'border-[rgba(0,0,0,0.25)]'
      }`}>
        {selected && (
          <svg className="w-[1rem] h-[1rem] stroke-white fill-none" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </span>
      {children}
    </button>
  );
}

function ServiceCheckbox({ checked, onChange, icon, title, desc }) {
  return (
    <label className={`flex items-start gap-[1.6rem] border rounded-[1.4rem] px-[2rem] py-[1.8rem] cursor-pointer transition-all ${
      checked
        ? 'border-[#FF6600] bg-[rgba(255,102,0,0.04)] shadow-[0_0_0_1px_rgba(255,102,0,0.25)]'
        : 'border-[rgba(0,0,0,0.1)] bg-[#fafafa] hover:border-[#FF6600] hover:bg-[rgba(255,102,0,0.02)]'
    }`}>
      <input type="checkbox" checked={checked} onChange={onChange} className="sr-only" />
      <span className={`mt-[0.2rem] w-[2.2rem] h-[2.2rem] rounded-[6px] border flex-shrink-0 flex items-center justify-center transition-all ${
        checked ? 'border-[#FF6600] bg-[#FF6600]' : 'border-[rgba(0,0,0,0.25)] bg-white'
      }`}>
        {checked && (
          <svg className="w-[1.3rem] h-[1.3rem] stroke-white fill-none" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </span>
      <div>
        <div className="flex items-center gap-[0.8rem] mb-[0.4rem]">
          <span className="text-[2rem]">{icon}</span>
          <span className="text-[1.7rem] font-[700] text-[#161616]">{title}</span>
        </div>
        <p className="text-[1.35rem] text-[#666] leading-[1.6]">{desc}</p>
      </div>
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION TRANSITION HEADER
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({ icon, label, accent, stepLabel, steps }) {
  return (
    <div className="rounded-[1.4rem] overflow-hidden mb-[3.2rem]" style={{ border: `1.5px solid ${accent}22` }}>
      {/* Colored top band */}
      <div className="flex items-center gap-[1.4rem] px-[2rem] py-[1.6rem]" style={{ background: `${accent}12` }}>
        <span className="text-[2.4rem] leading-none">{icon}</span>
        <div className="flex-1">
          <p className="text-[1.1rem] font-[700] tracking-[0.12em] uppercase mb-[0.2rem]" style={{ color: accent }}>
            {stepLabel}
          </p>
          <p className="text-[1.8rem] font-[700] text-[#161616]">{label}</p>
        </div>
        <div className="flex items-center gap-[0.6rem]">
          {steps.map((s, i) => (
            <span key={i} className="w-[0.8rem] h-[0.8rem] rounded-full"
              style={{ background: i === 0 ? accent : `${accent}33` }} />
          ))}
        </div>
      </div>
      {/* What's covered */}
      <div className="px-[2rem] py-[1.2rem] bg-white flex flex-wrap gap-x-[2rem] gap-y-[0.4rem]">
        {steps.map((s, i) => (
          <span key={i} className="flex items-center gap-[0.5rem] text-[1.25rem]"
            style={{ color: i === 0 ? '#161616' : '#bbb' }}>
            <span style={{ color: i === 0 ? accent : '#ccc' }}>{i === 0 ? '●' : '○'}</span>
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPPORT USERS EDITOR
// ─────────────────────────────────────────────────────────────────────────────

function SupportUsersEditor({ users, setUsers }) {
  const [draft, setDraft] = useState({ firstName: '', lastName: '', email: '' });
  const [error, setError] = useState('');

  const isEmailValid = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

  const addUser = () => {
    if (!draft.firstName.trim()) { setError('First name is required.'); return; }
    if (!draft.email.trim() || !isEmailValid(draft.email)) { setError('A valid email address is required.'); return; }
    if (users.some(u => u.email.toLowerCase() === draft.email.toLowerCase().trim())) {
      setError('This email is already in the list.'); return;
    }
    setUsers([...users, { firstName: draft.firstName.trim(), lastName: draft.lastName.trim(), email: draft.email.trim() }]);
    setDraft({ firstName: '', lastName: '', email: '' });
    setError('');
  };

  const removeUser = (idx) => setUsers(users.filter((_, i) => i !== idx));

  return (
    <div>
      <div className="bg-[#fafafa] border border-[rgba(0,0,0,0.08)] rounded-[1.2rem] p-[1.6rem] mb-[1.6rem]">
        <p className="text-[1.3rem] font-[600] text-[#161616] mb-[1.2rem]">Add a user</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-[1rem]">
          <input placeholder="First Name *" value={draft.firstName}
            onChange={e => { setDraft(d => ({ ...d, firstName: e.target.value })); setError(''); }}
            className="w-full bg-white border border-[rgba(0,0,0,0.12)] rounded-[1rem] px-[1.6rem] py-[1.2rem] text-[1.5rem] text-black placeholder:text-[#bbbbbb] outline-none focus:border-[#FF6600] transition-all mb-[1rem]" />
          <input placeholder="Last Name" value={draft.lastName}
            onChange={e => setDraft(d => ({ ...d, lastName: e.target.value }))}
            className="w-full bg-white border border-[rgba(0,0,0,0.12)] rounded-[1rem] px-[1.6rem] py-[1.2rem] text-[1.5rem] text-black placeholder:text-[#bbbbbb] outline-none focus:border-[#FF6600] transition-all mb-[1rem]" />
        </div>
        <input type="email" placeholder="Email Address *" value={draft.email}
          onChange={e => { setDraft(d => ({ ...d, email: e.target.value })); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && addUser()}
          className="w-full bg-white border border-[rgba(0,0,0,0.12)] rounded-[1rem] px-[1.6rem] py-[1.2rem] text-[1.5rem] text-black placeholder:text-[#bbbbbb] outline-none focus:border-[#FF6600] transition-all mb-[1rem]" />
        {error && <p className="text-[#c0392b] text-[1.3rem] mb-[1rem]">{error}</p>}
        <button onClick={addUser}
          className="bg-[#FF6600] text-white rounded-[0.8rem] px-[2rem] py-[1rem] text-[1.4rem] cursor-pointer hover:opacity-90 transition-all">
          + Add User
        </button>
      </div>
      {users.length > 0 && (
        <div className="border border-[rgba(0,0,0,0.08)] rounded-[1.2rem] overflow-hidden mb-[1.6rem]">
          <div className="bg-[#f5f5f5] grid grid-cols-[1fr_1fr_1.5fr_auto] px-[1.6rem] py-[1rem] text-[1.2rem] font-[700] text-[#666] uppercase tracking-[0.05em]">
            <span>First Name</span><span>Last Name</span><span>Email</span><span></span>
          </div>
          {users.map((u, i) => (
            <div key={i} className={`grid grid-cols-[1fr_1fr_1.5fr_auto] px-[1.6rem] py-[1.2rem] text-[1.4rem] items-center ${i % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'} border-t border-[rgba(0,0,0,0.06)]`}>
              <span className="text-[#161616] font-[600]">{u.firstName}</span>
              <span className="text-[#666]">{u.lastName || '—'}</span>
              <span className="text-[#FF6600]">{u.email}</span>
              <button onClick={() => removeUser(i)} className="text-[#c0392b] hover:text-[#a93226] text-[1.8rem] leading-none cursor-pointer px-[0.8rem]">×</button>
            </div>
          ))}
        </div>
      )}
      {users.length === 0 && (
        <p className="text-[#bbbbbb] text-[1.3rem] text-center py-[1.2rem]">No users added yet.</p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ENGAGEMENT PARTICIPANTS EDITOR
// ─────────────────────────────────────────────────────────────────────────────

const EngagementParticipantsEditor = forwardRef(function EngagementParticipantsEditor({ participants, setParticipants }, ref) {
  const [draft, setDraft] = useState({ firstName: '', lastName: '', title: '', email: '', role: '' });
  const [error, setError] = useState('');

  const isEmailValid = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

  // Called from parent handleSubmit to auto-add any in-progress draft.
  // Returns the flushed participant object so the caller can merge it synchronously,
  // since setState is async and wouldn't be visible in the same render cycle.
  useImperativeHandle(ref, () => ({
    tryFlushDraft: () => {
      const email = draft.email.trim();
      const firstName = draft.firstName.trim();
      if (!email || !isEmailValid(email) || !firstName || !draft.role) return null;
      if (participants.some(p => p.email.toLowerCase() === email.toLowerCase())) return null;
      const participant = {
        firstName,
        lastName: draft.lastName.trim(),
        title: draft.title.trim(),
        email,
        role: draft.role,
      };
      setParticipants(prev => [...prev, participant]);
      setDraft({ firstName: '', lastName: '', title: '', email: '', role: '' });
      return participant;
    },
  }));

  const addParticipant = () => {
    if (!draft.firstName.trim()) { setError('First name is required.'); return; }
    if (!draft.email.trim() || !isEmailValid(draft.email)) { setError('A valid email address is required.'); return; }
    if (!draft.role) { setError('Please select an engagement role.'); return; }
    if (participants.some(p => p.email.toLowerCase() === draft.email.toLowerCase().trim())) {
      setError('This email is already added.'); return;
    }
    setParticipants([...participants, {
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      title: draft.title.trim(),
      email: draft.email.trim(),
      role: draft.role,
    }]);
    setDraft({ firstName: '', lastName: '', title: '', email: '', role: '' });
    setError('');
  };

  const removeParticipant = (idx) => setParticipants(participants.filter((_, i) => i !== idx));

  return (
    <div>
      <div className="bg-[#fafafa] border border-[rgba(0,0,0,0.08)] rounded-[1.2rem] p-[1.6rem] mb-[1.6rem]">
        <p className="text-[1.3rem] font-[600] text-[#161616] mb-[1.2rem]">Add a participant</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-[1rem]">
          <input placeholder="First Name *" value={draft.firstName}
            onChange={e => { setDraft(d => ({ ...d, firstName: e.target.value })); setError(''); }}
            className="w-full bg-white border border-[rgba(0,0,0,0.12)] rounded-[1rem] px-[1.6rem] py-[1.2rem] text-[1.5rem] text-black placeholder:text-[#bbbbbb] outline-none focus:border-[#FF6600] transition-all mb-[1rem]" />
          <input placeholder="Last Name" value={draft.lastName}
            onChange={e => setDraft(d => ({ ...d, lastName: e.target.value }))}
            className="w-full bg-white border border-[rgba(0,0,0,0.12)] rounded-[1rem] px-[1.6rem] py-[1.2rem] text-[1.5rem] text-black placeholder:text-[#bbbbbb] outline-none focus:border-[#FF6600] transition-all mb-[1rem]" />
        </div>
        <input placeholder="Job Title" value={draft.title}
          onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
          className="w-full bg-white border border-[rgba(0,0,0,0.12)] rounded-[1rem] px-[1.6rem] py-[1.2rem] text-[1.5rem] text-black placeholder:text-[#bbbbbb] outline-none focus:border-[#FF6600] transition-all mb-[1rem]" />
        <input type="email" placeholder="Email Address *" value={draft.email}
          onChange={e => { setDraft(d => ({ ...d, email: e.target.value })); setError(''); }}
          className="w-full bg-white border border-[rgba(0,0,0,0.12)] rounded-[1rem] px-[1.6rem] py-[1.2rem] text-[1.5rem] text-black placeholder:text-[#bbbbbb] outline-none focus:border-[#FF6600] transition-all mb-[1rem]" />
        <select value={draft.role} onChange={e => { setDraft(d => ({ ...d, role: e.target.value })); setError(''); }}
          className="w-full bg-white border border-[rgba(0,0,0,0.12)] rounded-[1rem] px-[1.6rem] py-[1.2rem] text-[1.5rem] text-black outline-none focus:border-[#FF6600] transition-all mb-[1rem] cursor-pointer">
          <option value="">Engagement Role *</option>
          {ENGAGEMENT_ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        {error && <p className="text-[#c0392b] text-[1.3rem] mb-[1rem]">{error}</p>}
        <button onClick={addParticipant}
          className="bg-[#FF6600] text-white rounded-[0.8rem] px-[2rem] py-[1rem] text-[1.4rem] cursor-pointer hover:opacity-90 transition-all">
          + Add Participant
        </button>
      </div>
      {participants.length > 0 && (
        <div className="border border-[rgba(0,0,0,0.08)] rounded-[1.2rem] overflow-hidden mb-[1.6rem]">
          <div className="bg-[#f5f5f5] grid grid-cols-[1fr_1.4fr_1fr_auto] px-[1.6rem] py-[1rem] text-[1.2rem] font-[700] text-[#666] uppercase tracking-[0.05em]">
            <span>Name</span><span>Email</span><span>Role</span><span></span>
          </div>
          {participants.map((p, i) => (
            <div key={i} className={`grid grid-cols-[1fr_1.4fr_1fr_auto] px-[1.6rem] py-[1.2rem] text-[1.4rem] items-center ${i % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'} border-t border-[rgba(0,0,0,0.06)]`}>
              <div>
                <span className="text-[#161616] font-[600] block">{p.firstName} {p.lastName}</span>
                {p.title && <span className="text-[#999] text-[1.2rem]">{p.title}</span>}
              </div>
              <span className="text-[#FF6600] text-[1.3rem] truncate">{p.email}</span>
              <span className="text-[#666]">{p.role}</span>
              <button onClick={() => removeParticipant(i)} className="text-[#c0392b] hover:text-[#a93226] text-[1.8rem] leading-none cursor-pointer px-[0.8rem]">×</button>
            </div>
          ))}
        </div>
      )}
      {participants.length === 0 && (
        <p className="text-[#bbbbbb] text-[1.3rem] text-center py-[1.2rem]">No participants added yet.</p>
      )}
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL TAG INPUT
// ─────────────────────────────────────────────────────────────────────────────

const EmailTagInput = forwardRef(function EmailTagInput({ emails, setEmails }, ref) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  const isValid = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

  // Called from parent handleSubmit to auto-confirm any email typed but not yet added,
  // matching the same pattern as EngagementParticipantsEditor.tryFlushDraft().
  useImperativeHandle(ref, () => ({
    tryFlushInput: () => {
      const val = input.trim();
      if (!val || !isValid(val) || emails.includes(val)) return null;
      setEmails(prev => [...prev, val]);
      setInput('');
      return val;
    },
  }));

  const addEmail = () => {
    const val = input.trim();
    if (!val) return;
    if (!isValid(val)) { setError('Please enter a valid email address.'); return; }
    if (emails.includes(val)) { setError('This email is already added.'); return; }
    setEmails([...emails, val]);
    setInput('');
    setError('');
  };

  const removeEmail = (email) => setEmails(emails.filter(e => e !== email));

  return (
    <div>
      <div className="flex gap-[1rem] mb-[1rem]">
        <input type="email" placeholder="teammate@company.com" value={input}
          onChange={e => { setInput(e.target.value); setError(''); }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addEmail(); } }}
          className="flex-1 bg-white border border-[rgba(0,0,0,0.12)] rounded-[1rem] px-[1.6rem] py-[1.3rem] text-[1.6rem] text-black placeholder:text-[#bbbbbb] outline-none focus:border-[#FF6600] focus:shadow-[0_0_0_3px_rgba(255,102,0,0.08)] transition-all" />
        <button onClick={addEmail}
          className="bg-[#FF6600] text-white rounded-[1rem] px-[2rem] py-[1.3rem] text-[1.5rem] cursor-pointer hover:opacity-90 transition-all flex-shrink-0">
          + Add
        </button>
      </div>
      {error && <p className="text-[#c0392b] text-[1.3rem] mb-[1rem]">{error}</p>}
      {emails.length > 0 && (
        <div className="flex flex-wrap gap-[0.8rem] mb-[1rem]">
          {emails.map(email => (
            <span key={email} className="inline-flex items-center gap-[0.6rem] bg-[rgba(255,102,0,0.08)] border border-[rgba(255,102,0,0.25)] text-[#FF6600] text-[1.3rem] px-[1.2rem] py-[0.5rem] rounded-[2rem]">
              {email}
              <button onClick={() => removeEmail(email)} className="text-[#FF6600] hover:text-[#cc5200] cursor-pointer leading-none text-[1.5rem]">×</button>
            </span>
          ))}
        </div>
      )}
      <p className="text-[#bbbbbb] text-[1.2rem]">Press Enter or comma to add each address.</p>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// FOOTER (PDF is generated server-side — see app/api/submit/route.js)
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// FOOTER
// ─────────────────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="bg-black flex-shrink-0 relative z-10">
      <div className="max-w-[1300px] mx-auto px-[5.6rem] pt-[5rem] pb-[3rem]">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-[4rem]">
          <div>
            <img src="/redesign/ace_logo_footer.png" alt="AceMQ" style={{ width: '10rem' }} className="mb-[1.6rem]" />
            <p className="text-[#D0D5DD] text-[1.3rem] leading-[1.7]">The #1 RabbitMQ Partner.<br />Expert consulting, licensing, and support for enterprise messaging.</p>
          </div>
          <div>
            <p className="text-white text-[1.4rem] font-[700] mb-[1.4rem]">Contact</p>
            <div className="flex flex-col gap-[1rem]">
              <div className="flex items-center gap-[0.8rem] text-[#D0D5DD] text-[1.3rem]">
                <img src="/redesign/message.svg" alt="" className="w-[1.4rem] h-[1.4rem] opacity-60" />
                onboarding@acemq.com
              </div>
              <div className="flex items-center gap-[0.8rem] text-[#D0D5DD] text-[1.3rem]">
                <img src="/redesign/phone.svg" alt="" className="w-[1.4rem] h-[1.4rem] opacity-60" />
                +1 305-204-2607
              </div>
              <div className="flex items-center gap-[0.8rem] text-[#D0D5DD] text-[1.3rem]">
                <img src="/redesign/location.svg" alt="" className="w-[1.4rem] h-[1.4rem] opacity-60" />
                United States
              </div>
            </div>
          </div>
          <div>
            <p className="text-white text-[1.4rem] font-[700] mb-[1.4rem]">Navigate</p>
            <div className="flex flex-col gap-[0.8rem]">
              <a href="https://acemq.com/rabbitmq/licensing" target="_blank" rel="noopener noreferrer" className="text-[#D0D5DD] text-[1.3rem] hover:text-white transition-colors">RabbitMQ Licensing</a>
              <a href="https://acemq.com/rabbitmq" target="_blank" rel="noopener noreferrer" className="text-[#D0D5DD] text-[1.3rem] hover:text-white transition-colors">RabbitMQ Services</a>
              <a href="https://acemq.com/support" target="_blank" rel="noopener noreferrer" className="text-[#D0D5DD] text-[1.3rem] hover:text-white transition-colors">RabbitMQ Support</a>
            </div>
          </div>
        </div>
        <div className="border-t border-[#475467] mt-[3rem] pt-[2rem] text-center">
          <p className="text-[#D0D5DD] text-[1.1rem]">© {new Date().getFullYear()} AceMQ, an Ace8 Company. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function CombinedOnboarding() {
  // ── Navigation ──
  const [stepIdx, setStepIdx] = useState(0);
  const [stepList, setStepList] = useState(['intro', 'contact', 'services']);
  const [submitting, setSubmitting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [pdfB64, setPdfB64] = useState(null);

  // ── Contact Info ──
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [company, setCompany] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [phone, setPhone] = useState('');

  // ── Service Selection ──
  const [services, setServices] = useState({ engagement: false, support: false, license: false, broker: false });

  // ── Engagement fields ──
  const participantsEditorRef = useRef(null);
  const portalEmailsRef = useRef(null);
  const [engagementParticipants, setEngagementParticipants] = useState([]);
  const [kickoffDate, setKickoffDate] = useState('');
  const [teamTimezone, setTeamTimezone] = useState('');
  const [schedulingPref, setSchedulingPref] = useState('');
  const [timeSlotPref, setTimeSlotPref] = useState('');
  const [engagementDescription, setEngagementDescription] = useState('');

  // ── License fields ──
  const [cpuCoreCount, setCpuCoreCount] = useState('');
  const [cpuCoreType, setCpuCoreType] = useState('');
  const [deploymentEnv, setDeploymentEnv] = useState('');
  const [rmqProduct, setRmqProduct] = useState('');
  const [envUse, setEnvUse] = useState([]);
  const [packaging, setPackaging] = useState([]);
  const [comments, setComments] = useState('');
  const [portalEmails, setPortalEmails] = useState([]);

  // ── AceMQ Broker fields ──
  const brokerEmailsRef = useRef(null);
  const [broker, setBroker] = useState({
    cpuCoreCount: '', cpuCoreType: '', deploymentEnv: '', envUse: [], packaging: [],
    installType: '', downtime: '', blueGreen: '', comments: '',
  });
  const [brokerUsers, setBrokerUsers] = useState([]);
  const setB = (k, v) => setBroker(b => ({ ...b, [k]: v }));
  const toggleB = (k, v) => setBroker(b => ({ ...b, [k]: b[k].includes(v) ? b[k].filter(x => x !== v) : [...b[k], v] }));

  // ── Support fields ──
  const [supportUsers, setSupportUsers] = useState([]);

  const toggleArr = (arr, setArr, val) =>
    setArr(arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val]);

  const isEmailValid = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  const currentStep = stepList[stepIdx];
  const isIntro = currentStep === 'intro';
  // Exclude 'intro' from step counting — form starts at contact
  const formStepList = stepList.filter(s => s !== 'intro');
  const formSteps = formStepList.filter(s => s !== 'contact' && s !== 'services');
  const totalFormSteps = 2 + formSteps.length;
  const formStepIdx = stepIdx - 1; // 0-based within form steps (contact = 0)
  const currentFormStepNum = formStepIdx + 1;
  const pct = formStepList.length > 1
    ? Math.round((formStepIdx / (formStepList.length - 1)) * 100)
    : 0;

  const isLastStep = stepIdx === stepList.length - 1;
  const remainingSteps = stepList.slice(stepIdx).map(s => STEP_LABELS[s]).filter(Boolean);

  const scrollTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  const goNext = () => { setStepIdx(i => i + 1); scrollTop(); };
  const goBack = () => { setStepIdx(i => i - 1); scrollTop(); };

  const confirmServices = () => {
    const list = ['intro', ...buildStepList(services)];
    setStepList(list);
    setStepIdx(3); // intro(0) → contact(1) → services(2) → first dynamic(3)
    scrollTop();
  };

  const submitterInfo = { firstName, lastName, email: workEmail, jobTitle, phone };

  const handleSubmit = async () => {
    // Auto-flush any participant typed but not yet added — returned synchronously
    // because setState is async and wouldn't be visible in this render cycle.
    const flushedParticipant = participantsEditorRef.current?.tryFlushDraft() ?? null;
    const allEngagementParticipants = flushedParticipant
      ? [...engagementParticipants, flushedParticipant]
      : engagementParticipants;

    // Auto-flush any portal email typed but not yet confirmed (same pattern as above).
    const flushedEmail = portalEmailsRef.current?.tryFlushInput() ?? null;
    const allPortalEmails = flushedEmail ? [...portalEmails, flushedEmail] : portalEmails;
    const flushedBrokerEmail = brokerEmailsRef.current?.tryFlushInput() ?? null;
    const allBrokerUsers = flushedBrokerEmail ? [...brokerUsers, flushedBrokerEmail] : brokerUsers;

    setSubmitting(true);
    setProcessing(true);
    setSubmitError(null);
    scrollTop();
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submitter: submitterInfo,
          company,
          services,
          engagementParticipants: allEngagementParticipants,
          kickoffDate,
          teamTimezone,
          schedulingPref,
          timeSlotPref,
          engagementDescription,
          technical: { cpuCoreCount, cpuCoreType, deploymentEnv, rmqProduct },
          envUse,
          packaging,
          comments,
          portalUsers: allPortalEmails,
          supportUsers,
          broker: services.broker ? { ...broker, users: allBrokerUsers } : undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server error ${res.status}`);
      }

      const data = await res.json();
      if (data.pdfBase64) setPdfB64(data.pdfBase64);
      setSubmitted(true);
    } catch (err) {
      setProcessing(false);
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadPDF = () => {
    if (!pdfB64) return;
    const bytes = Uint8Array.from(atob(pdfB64), c => c.charCodeAt(0));
    const blob  = new Blob([bytes], { type: 'application/pdf' });
    const url   = URL.createObjectURL(blob);
    const link  = document.createElement('a');
    link.href = url;
    link.download = `AceMQ-Onboarding-${company.replace(/\s+/g, '-')}.pdf`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const anyServiceSelected = services.engagement || services.support || services.license || services.broker;

  return (
    <div className="min-h-screen grid-bg flex flex-col relative">

      {/* NAV */}
      <nav className="bg-white border-b border-[rgba(0,0,0,0.08)] px-[5.6rem] py-[1.8rem] flex items-center justify-between flex-shrink-0 relative z-10">
        <img src="/redesign/logo.png" alt="AceMQ" style={{ width: '11.3rem' }} />
        <p className="text-[1.2rem] text-[#999999] tracking-[0.05em] hidden sm:block">AceMQ Onboarding</p>
      </nav>

      {/* PROGRESS BAR */}
      {!submitted && !processing && !isIntro && stepIdx > 0 && (
        <div className="bg-white border-b border-[rgba(0,0,0,0.06)] px-[5.6rem] py-[1.4rem] flex-shrink-0 relative z-10">
          <div className="flex justify-between text-[1.2rem] text-[#999999] mb-[0.8rem]">
            <span>Step {currentFormStepNum} of {totalFormSteps}</span>
            <span>{pct}%</span>
          </div>
          <div className="h-[2px] bg-[rgba(0,0,0,0.08)] rounded-full">
            <div className="h-full bg-[#FF6600] rounded-full transition-all duration-500 ease-in-out" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* MAIN CARD */}
      <div className={`flex-1 flex items-start justify-center px-[1.5rem] sm:px-[5.6rem] pb-[8rem] relative z-[1] ${isIntro ? 'py-[7rem]' : 'py-[5.2rem]'}`}>
        <div className={`bg-white border border-[rgba(0,0,0,0.08)] rounded-[2rem] w-full relative overflow-hidden shadow-[0_2px_40px_rgba(0,0,0,0.06)] ${
          currentStep === 'support-users' ? 'max-w-[72rem]' : isIntro ? 'max-w-[66rem]' : 'max-w-[62rem]'
        }`}
          style={{ padding: isIntro ? 'clamp(4rem, 6vw, 6.4rem) clamp(3.2rem, 6vw, 7.2rem)' : 'clamp(3.2rem, 5vw, 5.2rem) clamp(2.4rem, 5vw, 5.6rem)' }}>

          {!submitted && !processing && !isIntro && (
            <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#FF6600]" />
          )}

          <div key={currentStep + (submitted ? '-success' : '')} className="animate-fade-slide">

            {/* ── INTRO ── */}
            {currentStep === 'intro' && !submitted && (
              <div className="text-center">
                {/* Rainbow top stripe */}
                <div className="absolute top-0 left-0 right-0 h-[5px] bg-gradient-to-r from-[#FF6600] via-[#FF8C40] to-[#8FD5CC]" />

                {/* Badge */}
                <div className="inline-flex items-center gap-[0.6rem] border border-[rgba(0,0,0,0.1)] rounded-full px-[1.4rem] py-[0.6rem] mb-[3.2rem]">
                  <span className="w-[0.7rem] h-[0.7rem] rounded-full bg-[#FF6600] inline-block" />
                  <span className="text-[1.2rem] tracking-[0.12em] text-[#444] uppercase font-[500]">AceMQ Onboarding</span>
                </div>

                {/* Headline */}
                <h1 className="text-[#000000] text-[4rem] leading-[1.15] font-[700] mb-[0.4rem]">
                  Your AceMQ
                </h1>
                <h1 className="text-[#8FD5CC] text-[4rem] leading-[1.15] font-[700] mb-[2.4rem]">
                  Onboarding Process
                </h1>

                {/* Subtitle */}
                <p className="text-[#666] text-[1.6rem] leading-[1.7] max-w-[46rem] mx-auto mb-[4rem]">
                  Complete your engagement, support portal, license, and AceMQ Broker setup in a single guided experience. You'll receive a branded PDF report on completion.
                </p>

                {/* Feature tiles */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-[1.4rem] mb-[4.4rem]">
                  {[
                    { icon: '🤝', title: 'Engagement', desc: 'Professional services, migrations & architecture' },
                    { icon: '🎫', title: 'Support Portal', desc: 'Submit & track RabbitMQ issues 24/7' },
                    { icon: '🔑', title: 'License Onboarding', desc: 'JFrog image access & portal provisioning' },
                    { icon: '📦', title: 'AceMQ Broker', desc: 'LTS broker builds via JFrog repo access' },
                  ].map(({ icon, title, desc }) => (
                    <div key={title} className="border border-[rgba(0,0,0,0.08)] rounded-[1.4rem] bg-[#fafafa] px-[2rem] py-[2.4rem] flex flex-col items-center gap-[0.8rem]">
                      <span className="text-[2.8rem]">{icon}</span>
                      <p className="text-[1.5rem] font-[700] text-[#161616]">{title}</p>
                      <p className="text-[1.25rem] text-[#888] leading-[1.5]">{desc}</p>
                    </div>
                  ))}
                </div>

                {/* CTA */}
                <BtnOrange onClick={goNext} className="text-[1.9rem] px-[5.6rem] py-[1.6rem]">
                  Get Started →
                </BtnOrange>

                {/* Footer pills */}
                <div className="flex items-center justify-center flex-wrap gap-[2rem] mt-[2.4rem]">
                  {['~5 minutes', 'PDF report included', 'Select only what you need'].map(t => (
                    <span key={t} className="flex items-center gap-[0.5rem] text-[1.2rem] text-[#999]">
                      <svg className="w-[1.2rem] h-[1.2rem] stroke-[#27ae60] fill-none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* ── CONTACT INFO ── */}
            {currentStep === 'contact' && !submitted && (
              <div>
                <div className="absolute top-0 left-0 right-0 h-[4px] bg-gradient-to-r from-[#FF6600] via-[#FF8C40] to-[#8FD5CC]" />
                <SectionLabel>Step 1 — Contact Information</SectionLabel>
                <QHead>Tell us about yourself</QHead>
                <QSub>We'll use this to set up your account and send your onboarding report.</QSub>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-[1rem]">
                  <TF placeholder="First Name *" value={firstName} onChange={e => setFirstName(e.target.value)} />
                  <TF placeholder="Last Name *" value={lastName} onChange={e => setLastName(e.target.value)} />
                </div>
                <TF placeholder="Company Name *" value={company} onChange={e => setCompany(e.target.value)} />
                <TF type="email" placeholder="Work Email *" value={workEmail} onChange={e => setWorkEmail(e.target.value)} />
                <TF placeholder="Job Title (optional)" value={jobTitle} onChange={e => setJobTitle(e.target.value)} />
                <TF type="tel" placeholder="Phone Number (optional)" value={phone} onChange={e => setPhone(e.target.value)} />
                <div className="flex items-center justify-between mt-[3rem] pt-[2.2rem] border-t border-[rgba(0,0,0,0.08)]">
                  <BtnGhost onClick={goBack}>← Back</BtnGhost>
                  <BtnOrange
                    onClick={goNext}
                    disabled={!firstName.trim() || !lastName.trim() || !company.trim() || !isEmailValid(workEmail)}>
                    Continue →
                  </BtnOrange>
                </div>
              </div>
            )}

            {/* ── SERVICE SELECTION ── */}
            {currentStep === 'services' && !submitted && (
              <div>
                <SectionLabel>Step 2 — Select Your Onboarding</SectionLabel>
                <QHead>Which onboarding do you need?</QHead>
                <QSub>Select all that apply. We'll guide you through each one in a single experience.</QSub>
                <div className="flex flex-col gap-[1.2rem] mb-[2.4rem]">
                  <ServiceCheckbox
                    checked={services.engagement}
                    onChange={e => setServices(s => ({ ...s, engagement: e.target.checked }))}
                    icon="🤝"
                    title="Engagement Onboarding"
                    desc="For new AceMQ professional services engagements — consulting, migration, architecture review, and more."
                  />
                  <ServiceCheckbox
                    checked={services.support}
                    onChange={e => setServices(s => ({ ...s, support: e.target.checked }))}
                    icon="🎫"
                    title="Support Onboarding"
                    desc="Set up your team's access to the RabbitMQ Support Portal and Jira ticket system."
                  />
                  <ServiceCheckbox
                    checked={services.license}
                    onChange={e => setServices(s => ({ ...s, license: e.target.checked }))}
                    icon="🔑"
                    title="License Onboarding"
                    desc="Provision your RabbitMQ license, JFrog image access, and portal users."
                  />
                  <ServiceCheckbox
                    checked={services.broker}
                    onChange={e => setServices(s => ({ ...s, broker: e.target.checked }))}
                    icon="📦"
                    title="AceMQ Broker"
                    desc="Get access to the AceMQ Broker — our patched, long-term-supported RabbitMQ distribution — through JFrog."
                  />
                </div>
                <div className="flex items-center justify-between mt-[3rem] pt-[2.2rem] border-t border-[rgba(0,0,0,0.08)]">
                  <BtnGhost onClick={goBack}>← Back</BtnGhost>
                  <BtnOrange onClick={confirmServices} disabled={!anyServiceSelected}>
                    Continue →
                  </BtnOrange>
                </div>
              </div>
            )}

            {/* ── ENGAGEMENT DETAILS ── */}
            {currentStep === 'engagement' && !submitted && (
              <div>
                <SectionHeader
                  icon="🤝"
                  label="Engagement Onboarding"
                  accent="#FF6600"
                  stepLabel="Section — Engagement"
                  steps={remainingSteps}
                />
                <QHead>Tell us about your engagement</QHead>
                <QSub>Help us understand your team, goals, and scheduling so we can hit the ground running.</QSub>

                <p className="text-[1.4rem] font-[600] text-[#161616] mb-[1rem]">Lead Stakeholder</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-[1rem]">
                  <TF placeholder="Lead Stakeholder Name" value={`${firstName} ${lastName}`.trim()} onChange={() => {}} />
                  <TF type="email" placeholder="Lead Stakeholder Email" value={workEmail} onChange={() => {}} />
                </div>
                <TF type="tel" placeholder="Lead Stakeholder Phone (optional)" value={phone} onChange={() => {}} />

                <p className="text-[1.4rem] font-[600] text-[#161616] mb-[1rem] mt-[1.6rem]">Engagement Participants *</p>
                <EngagementParticipantsEditor
                  ref={participantsEditorRef}
                  participants={engagementParticipants}
                  setParticipants={setEngagementParticipants}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-[1rem] mt-[1.6rem]">
                  <div>
                    <p className="text-[1.4rem] font-[600] text-[#161616] mb-[1rem]">Estimated Kickoff Date</p>
                    <input type="date" value={kickoffDate} onChange={e => setKickoffDate(e.target.value)}
                      className="w-full bg-white border border-[rgba(0,0,0,0.12)] rounded-[1rem] px-[1.6rem] py-[1.3rem] text-[1.6rem] text-black outline-none focus:border-[#FF6600] focus:shadow-[0_0_0_3px_rgba(255,102,0,0.08)] transition-all mb-[1rem]" />
                  </div>
                  <div>
                    <p className="text-[1.4rem] font-[600] text-[#161616] mb-[1rem]">Team Time Zone</p>
                    <select value={teamTimezone} onChange={e => setTeamTimezone(e.target.value)}
                      className="w-full bg-white border border-[rgba(0,0,0,0.12)] rounded-[1rem] px-[1.6rem] py-[1.3rem] text-[1.6rem] text-black outline-none focus:border-[#FF6600] focus:shadow-[0_0_0_3px_rgba(255,102,0,0.08)] transition-all mb-[1rem] cursor-pointer">
                      <option value="">Select Timezone</option>
                      {TIMEZONE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </div>
                </div>

                <p className="text-[1.4rem] font-[600] text-[#161616] mb-[1rem]">Engagement Session — Scheduling Preference *</p>
                <select value={schedulingPref} onChange={e => setSchedulingPref(e.target.value)}
                  className="w-full bg-white border border-[rgba(0,0,0,0.12)] rounded-[1rem] px-[1.6rem] py-[1.3rem] text-[1.6rem] text-black outline-none focus:border-[#FF6600] focus:shadow-[0_0_0_3px_rgba(255,102,0,0.08)] transition-all mb-[1rem] cursor-pointer">
                  <option value="">Please Select</option>
                  {SCHEDULING_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>

                <p className="text-[1.4rem] font-[600] text-[#161616] mb-[1rem] mt-[1rem]">Engagement Session — Time Preference <span className="text-[#999] font-[400]">(optional)</span></p>
                <select value={timeSlotPref} onChange={e => setTimeSlotPref(e.target.value)}
                  className="w-full bg-white border border-[rgba(0,0,0,0.12)] rounded-[1rem] px-[1.6rem] py-[1.3rem] text-[1.6rem] text-black outline-none focus:border-[#FF6600] focus:shadow-[0_0_0_3px_rgba(255,102,0,0.08)] transition-all mb-[1rem] cursor-pointer">
                  <option value="">Please Select</option>
                  {TIME_SLOT_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>

                <p className="text-[1.4rem] font-[600] text-[#161616] mb-[1rem] mt-[1rem]">Other Comments or Details <span className="text-[#999] font-[400]">(optional)</span></p>
                <TA
                  placeholder="Any other context, constraints, or goals for this engagement…"
                  value={engagementDescription}
                  onChange={e => setEngagementDescription(e.target.value)}
                  rows={4}
                />

                {isLastStep && submitError && (
                  <p className="text-[#c0392b] text-[1.3rem] mt-[1rem] bg-[rgba(192,57,43,0.07)] border border-[rgba(192,57,43,0.2)] rounded-[0.8rem] px-[1.2rem] py-[0.8rem]">
                    {submitError}
                  </p>
                )}

                <div className="flex items-center justify-between mt-[3rem] pt-[2.2rem] border-t border-[rgba(0,0,0,0.08)]">
                  <BtnGhost onClick={goBack}>← Back</BtnGhost>
                  {!isLastStep ? (
                    <BtnOrange onClick={goNext} disabled={engagementParticipants.length === 0 || !schedulingPref}>
                      Continue →
                    </BtnOrange>
                  ) : (
                    <BtnOrange onClick={handleSubmit} disabled={submitting || engagementParticipants.length === 0 || !schedulingPref}>
                      {submitting ? 'Submitting…' : 'Submit & Get Report →'}
                    </BtnOrange>
                  )}
                </div>
              </div>
            )}

            {/* ── LICENSE TECHNICAL ── */}
            {currentStep === 'license-tech' && !submitted && (
              <div>
                <SectionHeader
                  icon="🔑"
                  label="License Onboarding"
                  accent="#5bb8ad"
                  stepLabel="Section — License"
                  steps={remainingSteps}
                />
                <QHead>Technical configuration</QHead>
                <QSub>This helps us deliver the right license for your infrastructure.</QSub>

                <p className="text-[1.4rem] font-[600] text-[#161616] mb-[0.6rem]">CPU Core Count *</p>
                <TF placeholder="e.g. 16" value={cpuCoreCount} onChange={e => setCpuCoreCount(e.target.value)} />

                <p className="text-[1.4rem] font-[600] text-[#161616] mb-[1rem] mt-[0.6rem]">CPU Core Type *</p>
                {['vCPU', 'Physical CPU'].map(opt => (
                  <Choice key={opt} selected={cpuCoreType === opt} onClick={() => setCpuCoreType(opt)}>{opt}</Choice>
                ))}

                <p className="text-[1.4rem] font-[600] text-[#161616] mb-[1rem] mt-[2rem]">Deployment Environment *</p>
                {DEPLOYMENT_ENV_OPTIONS.map(opt => (
                  <Choice key={opt} selected={deploymentEnv === opt} onClick={() => setDeploymentEnv(opt)}>{opt}</Choice>
                ))}

                <p className="text-[1.4rem] font-[600] text-[#161616] mb-[1rem] mt-[2rem]">RabbitMQ Product *</p>
                {RABBITMQ_PRODUCT_OPTIONS.map(opt => (
                  <Choice key={opt} selected={rmqProduct === opt} onClick={() => setRmqProduct(opt)}>{opt}</Choice>
                ))}

                <div className="flex items-center justify-between mt-[3rem] pt-[2.2rem] border-t border-[rgba(0,0,0,0.08)]">
                  <BtnGhost onClick={goBack}>← Back</BtnGhost>
                  <BtnOrange onClick={goNext} disabled={!cpuCoreCount.trim() || !cpuCoreType || !deploymentEnv || !rmqProduct}>
                    Continue →
                  </BtnOrange>
                </div>
              </div>
            )}

            {/* ── LICENSE USAGE ── */}
            {currentStep === 'license-usage' && !submitted && (
              <div>
                <SectionLabel>License Onboarding</SectionLabel>
                <QHead>Usage & packaging</QHead>
                <QSub>Select all that apply to help us configure the right license scope.</QSub>

                <p className="text-[1.4rem] font-[600] text-[#161616] mb-[1rem]">Environment Use <span className="text-[#999] font-[400]">(select all that apply)</span></p>
                {ENVIRONMENT_USE_OPTIONS.map(opt => (
                  <Chip key={opt} selected={envUse.includes(opt)} onClick={() => toggleArr(envUse, setEnvUse, opt)}>{opt}</Chip>
                ))}

                <p className="text-[1.4rem] font-[600] text-[#161616] mb-[1rem] mt-[2.4rem]">Packaging Format <span className="text-[#999] font-[400]">(select all that apply)</span></p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-[1rem]">
                  {PACKAGING_FORMAT_OPTIONS.map(opt => (
                    <Chip key={opt} selected={packaging.includes(opt)} onClick={() => toggleArr(packaging, setPackaging, opt)}>{opt}</Chip>
                  ))}
                </div>

                <p className="text-[1.4rem] font-[600] text-[#161616] mb-[1rem] mt-[2.4rem]">Additional Comments <span className="text-[#999] font-[400]">(optional)</span></p>
                <TA placeholder="Any other details about your environment or requirements…" value={comments} onChange={e => setComments(e.target.value)} />

                <div className="flex items-center justify-between mt-[3rem] pt-[2.2rem] border-t border-[rgba(0,0,0,0.08)]">
                  <BtnGhost onClick={goBack}>← Back</BtnGhost>
                  <BtnOrange onClick={goNext} disabled={envUse.length === 0 || packaging.length === 0}>
                    Continue →
                  </BtnOrange>
                </div>
              </div>
            )}

            {/* ── LICENSE PORTAL USERS ── */}
            {currentStep === 'license-users' && !submitted && (
              <div>
                <SectionLabel>License Onboarding</SectionLabel>
                <QHead>License portal users</QHead>
                <QSub>
                  Add everyone who needs access to the RabbitMQ licensing portal. Your email{' '}
                  <span className="text-[#FF6600]">{workEmail}</span> is included automatically.
                </QSub>

                {/* JFrog Pull Guide reference panel */}
                <div className="bg-[#f8f8f8] border border-[rgba(0,0,0,0.08)] rounded-[1.4rem] p-[2rem] mb-[2.8rem]">
                  <div className="flex items-start gap-[1.4rem]">
                    <span className="text-[2.4rem] mt-[0.2rem] flex-shrink-0">📦</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[1.5rem] font-[700] text-[#161616] mb-[0.5rem]">Your report includes a complete JFrog Pull Guide</p>
                      <p className="text-[1.3rem] text-[#666] leading-[1.6] mb-[1.4rem]">Once credentials are issued, your PDF onboarding report will contain step-by-step instructions for pulling Tanzu RabbitMQ images through AceMQ's JFrog Artifactory cache — including:</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-[1.5rem] gap-y-[0.5rem] mb-[1.6rem]">
                        {[
                          'Generate a scoped JFrog access token',
                          'Authenticate Docker, Podman & nerdctl',
                          'Pull with ARM64 & FIPS variant tags',
                          'Create Kubernetes imagePullSecrets',
                          'Helm values.yaml override for AceMQ cache',
                          'Pin images by SHA256 digest for compliance',
                        ].map(item => (
                          <div key={item} className="flex items-start gap-[0.7rem] text-[1.25rem] text-[#444]">
                            <span className="text-[#FF6600] font-[700] flex-shrink-0 mt-[0.1rem]">→</span>
                            <span>{item}</span>
                          </div>
                        ))}
                      </div>
                      <div className="bg-white border border-[rgba(0,0,0,0.08)] rounded-[0.8rem] px-[1.4rem] py-[1rem]">
                        <p className="text-[1.1rem] font-[700] text-[#999] uppercase tracking-[0.06em] mb-[0.4rem]">Registry endpoint</p>
                        <code className="text-[1.35rem] text-[#161616] font-[600]">acemq.jfrog.io / rabbitmq-docker-remote / vmware-tanzu-rabbitmq</code>
                      </div>
                    </div>
                  </div>
                </div>

                <EmailTagInput ref={portalEmailsRef} emails={portalEmails} setEmails={setPortalEmails} />

                {isLastStep && submitError && (
                  <p className="text-[#c0392b] text-[1.3rem] mt-[1rem] bg-[rgba(192,57,43,0.07)] border border-[rgba(192,57,43,0.2)] rounded-[0.8rem] px-[1.2rem] py-[0.8rem]">
                    {submitError}
                  </p>
                )}

                <div className="flex items-center justify-between mt-[3rem] pt-[2.2rem] border-t border-[rgba(0,0,0,0.08)]">
                  <BtnGhost onClick={goBack}>← Back</BtnGhost>
                  {!isLastStep ? (
                    <BtnOrange onClick={goNext}>Continue →</BtnOrange>
                  ) : (
                    <BtnOrange onClick={handleSubmit} disabled={submitting}>
                      {submitting ? 'Submitting…' : 'Submit & Get Report →'}
                    </BtnOrange>
                  )}
                </div>
              </div>
            )}

            {/* ── ACEMQ BROKER — ENVIRONMENT ── */}
            {currentStep === 'broker-tech' && !submitted && (
              <div>
                <SectionHeader
                  icon="📦"
                  label="AceMQ Broker Onboarding"
                  accent="#c45200"
                  stepLabel="Section — AceMQ Broker"
                  steps={remainingSteps}
                />
                <QHead>Your broker environment</QHead>
                <QSub>Tell us where the AceMQ Broker will run so we can give you the right builds.</QSub>

                <div className="bg-[#fafafa] border border-[rgba(0,0,0,0.08)] rounded-[1rem] px-[1.6rem] py-[1.2rem] mb-[2rem]">
                  <p className="text-[1.1rem] font-[700] text-[#999] uppercase tracking-[0.06em] mb-[0.2rem]">Product</p>
                  <p className="text-[1.5rem] font-[700] text-[#161616]">AceMQ Broker <span className="text-[#999] font-[400] text-[1.3rem]">— current LTS release</span></p>
                </div>

                <p className="text-[1.4rem] font-[600] text-[#161616] mb-[0.6rem]">CPU Core Count *</p>
                <TF placeholder="e.g. 16" value={broker.cpuCoreCount} onChange={e => setB('cpuCoreCount', e.target.value)} />

                <p className="text-[1.4rem] font-[600] text-[#161616] mb-[1rem] mt-[0.6rem]">CPU Core Type *</p>
                {['vCPU', 'Physical CPU'].map(opt => (
                  <Choice key={opt} selected={broker.cpuCoreType === opt} onClick={() => setB('cpuCoreType', opt)}>{opt}</Choice>
                ))}

                <p className="text-[1.4rem] font-[600] text-[#161616] mb-[1rem] mt-[2rem]">Deployment Environment *</p>
                {DEPLOYMENT_ENV_OPTIONS.map(opt => (
                  <Choice key={opt} selected={broker.deploymentEnv === opt} onClick={() => setB('deploymentEnv', opt)}>{opt}</Choice>
                ))}

                <p className="text-[1.4rem] font-[600] text-[#161616] mb-[1rem] mt-[2rem]">Environment Use * <span className="text-[#999] font-[400]">(select all that apply)</span></p>
                {ENVIRONMENT_USE_OPTIONS.map(opt => (
                  <Chip key={opt} selected={broker.envUse.includes(opt)} onClick={() => toggleB('envUse', opt)}>{opt}</Chip>
                ))}

                <p className="text-[1.4rem] font-[600] text-[#161616] mb-[1rem] mt-[2.4rem]">Packaging Format * <span className="text-[#999] font-[400]">(select all that apply)</span></p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-[1rem]">
                  {BROKER_PACKAGING_OPTIONS.map(opt => (
                    <Chip key={opt} selected={broker.packaging.includes(opt)} onClick={() => toggleB('packaging', opt)}>{opt}</Chip>
                  ))}
                </div>

                <div className="flex items-center justify-between mt-[3rem] pt-[2.2rem] border-t border-[rgba(0,0,0,0.08)]">
                  <BtnGhost onClick={goBack}>← Back</BtnGhost>
                  <BtnOrange onClick={goNext} disabled={!broker.cpuCoreCount.trim() || !broker.cpuCoreType || !broker.deploymentEnv || broker.envUse.length === 0 || broker.packaging.length === 0}>
                    Continue →
                  </BtnOrange>
                </div>
              </div>
            )}

            {/* ── ACEMQ BROKER — GO-LIVE READINESS ── */}
            {currentStep === 'broker-golive' && !submitted && (
              <div>
                <SectionLabel>AceMQ Broker Onboarding</SectionLabel>
                <QHead>Go-live readiness</QHead>
                <QSub>This helps us plan your installation or migration path.</QSub>

                <p className="text-[1.4rem] font-[600] text-[#161616] mb-[1rem]">Is this a migration or a new installation? *</p>
                {BROKER_INSTALL_TYPE_OPTIONS.map(opt => (
                  <Choice key={opt} selected={broker.installType === opt} onClick={() => setB('installType', opt)}>{opt}</Choice>
                ))}

                <p className="text-[1.4rem] font-[600] text-[#161616] mb-[1rem] mt-[2rem]">Can your environment support full downtime during cutover? *</p>
                {YES_NO_UNSURE.map(opt => (
                  <Choice key={opt} selected={broker.downtime === opt} onClick={() => setB('downtime', opt)}>{opt}</Choice>
                ))}

                <p className="text-[1.4rem] font-[600] text-[#161616] mb-[1rem] mt-[2rem]">Do you have multiple environments available for a blue/green migration? *</p>
                {YES_NO_UNSURE.map(opt => (
                  <Choice key={opt} selected={broker.blueGreen === opt} onClick={() => setB('blueGreen', opt)}>{opt}</Choice>
                ))}

                <p className="text-[1.4rem] font-[600] text-[#161616] mb-[1rem] mt-[2.4rem]">Additional Comments <span className="text-[#999] font-[400]">(optional)</span></p>
                <TA placeholder="Current RabbitMQ / Erlang versions, OS, cluster layout, timelines…" value={broker.comments} onChange={e => setB('comments', e.target.value)} />

                <div className="flex items-center justify-between mt-[3rem] pt-[2.2rem] border-t border-[rgba(0,0,0,0.08)]">
                  <BtnGhost onClick={goBack}>← Back</BtnGhost>
                  <BtnOrange onClick={goNext} disabled={!broker.installType || !broker.downtime || !broker.blueGreen}>
                    Continue →
                  </BtnOrange>
                </div>
              </div>
            )}

            {/* ── ACEMQ BROKER — REPO ACCESS ── */}
            {currentStep === 'broker-users' && !submitted && (
              <div>
                <SectionLabel>AceMQ Broker Onboarding</SectionLabel>
                <QHead>Who needs repository access?</QHead>
                <QSub>
                  Add everyone who should be able to download AceMQ Broker builds. Your email{' '}
                  <span className="text-[#FF6600]">{workEmail}</span> is included automatically.
                </QSub>

                <div className="bg-[#f8f8f8] border border-[rgba(0,0,0,0.08)] rounded-[1.4rem] p-[2rem] mb-[2.8rem]">
                  <div className="flex items-start gap-[1.4rem]">
                    <span className="text-[2.4rem] mt-[0.2rem] flex-shrink-0">📦</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[1.5rem] font-[700] text-[#161616] mb-[0.5rem]">JFrog access to the AceMQ Broker repository</p>
                      <p className="text-[1.3rem] text-[#666] leading-[1.6]">Each person gets an AceMQ Artifactory login scoped to the AceMQ Broker repository only. New users receive a temporary password by email; existing users can sign in with their current credentials.</p>
                    </div>
                  </div>
                </div>

                <EmailTagInput ref={brokerEmailsRef} emails={brokerUsers} setEmails={setBrokerUsers} />

                {isLastStep && submitError && (
                  <p className="text-[#c0392b] text-[1.3rem] mt-[1rem] bg-[rgba(192,57,43,0.07)] border border-[rgba(192,57,43,0.2)] rounded-[0.8rem] px-[1.2rem] py-[0.8rem]">
                    {submitError}
                  </p>
                )}

                <div className="flex items-center justify-between mt-[3rem] pt-[2.2rem] border-t border-[rgba(0,0,0,0.08)]">
                  <BtnGhost onClick={goBack}>← Back</BtnGhost>
                  {!isLastStep ? (
                    <BtnOrange onClick={goNext}>Continue →</BtnOrange>
                  ) : (
                    <BtnOrange onClick={handleSubmit} disabled={submitting}>
                      {submitting ? 'Submitting…' : 'Submit & Get Report →'}
                    </BtnOrange>
                  )}
                </div>
              </div>
            )}

            {/* ── SUPPORT PORTAL USERS ── */}
            {currentStep === 'support-users' && !submitted && (
              <div>
                <SectionHeader
                  icon="🎫"
                  label="Support Portal Onboarding"
                  accent="#161616"
                  stepLabel="Section — Support"
                  steps={remainingSteps}
                />
                <QHead>Who needs support access?</QHead>
                <QSub>
                  Add each team member who should be able to create and manage support tickets.{' '}
                  <span className="text-[#FF6600]">{firstName} {lastName}</span> is included automatically.
                </QSub>

                <SupportUsersEditor users={supportUsers} setUsers={setSupportUsers} />

                {submitError && (
                  <p className="text-[#c0392b] text-[1.3rem] mt-[1rem] bg-[rgba(192,57,43,0.07)] border border-[rgba(192,57,43,0.2)] rounded-[0.8rem] px-[1.2rem] py-[0.8rem]">
                    {submitError}
                  </p>
                )}

                <div className="flex items-center justify-between mt-[3rem] pt-[2.2rem] border-t border-[rgba(0,0,0,0.08)]">
                  <BtnGhost onClick={goBack}>← Back</BtnGhost>
                  <BtnOrange onClick={handleSubmit} disabled={submitting || supportUsers.length === 0}>
                    {submitting ? (
                      <span className="flex items-center gap-[0.8rem]">
                        <svg className="w-[1.6rem] h-[1.6rem] animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                        Submitting…
                      </span>
                    ) : 'Submit & Get Report →'}
                  </BtnOrange>
                </div>
              </div>
            )}

            {/* ── SUCCESS ── */}
            {processing && !submitted && (
              <div className="text-center py-[3rem]">
                <div className="w-[7rem] h-[7rem] rounded-full border-[3px] border-[rgba(255,102,0,0.15)] border-t-[#FF6600] animate-spin mx-auto mb-[2.4rem]" />
                <QHead>Setting Everything Up…</QHead>
                <QSub className="max-w-[44rem] mx-auto mb-[3rem]">
                  We're provisioning your services. This usually takes 15–30 seconds — please don't close this page.
                </QSub>
                <div className="flex flex-col gap-[1rem] max-w-[36rem] mx-auto text-left">
                  {services.engagement && (
                    <div className="flex items-center gap-[1.2rem] bg-[rgba(255,102,0,0.04)] border border-[rgba(255,102,0,0.15)] rounded-[1rem] px-[1.6rem] py-[1.2rem]">
                      <div className="w-[1.6rem] h-[1.6rem] rounded-full border-[2px] border-[rgba(255,102,0,0.3)] border-t-[#FF6600] animate-spin flex-shrink-0" />
                      <span className="text-[1.4rem] text-[#444]">Creating engagement portal…</span>
                    </div>
                  )}
                  {services.license && (
                    <div className="flex items-center gap-[1.2rem] bg-[rgba(91,184,173,0.06)] border border-[rgba(91,184,173,0.2)] rounded-[1rem] px-[1.6rem] py-[1.2rem]">
                      <div className="w-[1.6rem] h-[1.6rem] rounded-full border-[2px] border-[rgba(91,184,173,0.3)] border-t-[#5bb8ad] animate-spin flex-shrink-0" />
                      <span className="text-[1.4rem] text-[#444]">Provisioning JFrog access…</span>
                    </div>
                  )}
                  {services.broker && (
                    <div className="flex items-center gap-[1.2rem] bg-[rgba(196,82,0,0.05)] border border-[rgba(196,82,0,0.2)] rounded-[1rem] px-[1.6rem] py-[1.2rem]">
                      <div className="w-[1.6rem] h-[1.6rem] rounded-full border-[2px] border-[rgba(196,82,0,0.3)] border-t-[#c45200] animate-spin flex-shrink-0" />
                      <span className="text-[1.4rem] text-[#444]">Granting AceMQ Broker repo access…</span>
                    </div>
                  )}
                  {services.support && (
                    <div className="flex items-center gap-[1.2rem] bg-[rgba(22,22,22,0.04)] border border-[rgba(22,22,22,0.1)] rounded-[1rem] px-[1.6rem] py-[1.2rem]">
                      <div className="w-[1.6rem] h-[1.6rem] rounded-full border-[2px] border-[rgba(22,22,22,0.15)] border-t-[#161616] animate-spin flex-shrink-0" />
                      <span className="text-[1.4rem] text-[#444]">Setting up support portal…</span>
                    </div>
                  )}
                  <div className="flex items-center gap-[1.2rem] bg-white border border-[rgba(0,0,0,0.08)] rounded-[1rem] px-[1.6rem] py-[1.2rem]">
                    <div className="w-[1.6rem] h-[1.6rem] rounded-full border-[2px] border-[rgba(0,0,0,0.1)] border-t-[#888] animate-spin flex-shrink-0" />
                    <span className="text-[1.4rem] text-[#444]">Generating your PDF report…</span>
                  </div>
                </div>
              </div>
            )}

            {submitted && (
              <div className="text-center py-[2rem]">
                <div className="w-[6rem] h-[6rem] bg-[rgba(39,174,96,0.1)] rounded-full flex items-center justify-center mx-auto mb-[2rem]">
                  <svg className="w-[3rem] h-[3rem] stroke-[#27ae60] fill-none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <QHead>Onboarding Complete!</QHead>
                <QSub className="max-w-[48rem] mx-auto">
                  Your onboarding has been submitted for <strong>{company}</strong>.
                  Our team will be in touch within <strong>1 business day</strong>.
                </QSub>

                <div className="bg-[rgba(255,102,0,0.04)] border border-[rgba(255,102,0,0.2)] rounded-[1.6rem] p-[2.4rem] mb-[2rem] max-w-[50rem] mx-auto">
                  <div className="text-[2.4rem] mb-[1rem]">📄</div>
                  <p className="text-[1.6rem] font-[700] text-[#161616] mb-[0.6rem]">Download Your Onboarding Report</p>
                  <p className="text-[1.3rem] text-[#666] mb-[2rem]">
                    Your AceMQ-branded PDF has been emailed to our team. Download a copy for your records.
                  </p>
                  <BtnOrange onClick={handleDownloadPDF} className="mx-auto">
                    Download PDF Report →
                  </BtnOrange>
                </div>

                <div className="bg-[rgba(143,213,204,0.07)] border border-[rgba(143,213,204,0.3)] rounded-[1.2rem] p-[1.6rem] max-w-[50rem] mx-auto mb-[2rem] text-left">
                  <p className="text-[1.3rem] font-[700] text-[#161616] mb-[0.8rem]">What happens next?</p>
                  <div className="flex flex-col gap-[0.6rem]">
                    {services.engagement && (
                      <div className="flex items-start gap-[0.8rem] text-[1.3rem] text-[#444]">
                        <span className="text-[#FF6600] font-[700] flex-shrink-0">🤝</span>
                        <span>Our Program Manager will align a kickoff call.</span>
                      </div>
                    )}
                    {services.support && (
                      <div className="flex items-start gap-[0.8rem] text-[1.3rem] text-[#444]">
                        <span className="text-[#FF6600] font-[700] flex-shrink-0">🎫</span>
                        <span>Portal invitation emails sent to all support users within 1 business day.</span>
                      </div>
                    )}
                    {services.license && (
                      <div className="flex items-start gap-[0.8rem] text-[1.3rem] text-[#444]">
                        <span className="text-[#FF6600] font-[700] flex-shrink-0">🔑</span>
                        <span>Your license configuration is being processed. JFrog access will be set up.</span>
                      </div>
                    )}
                    {services.broker && (
                      <div className="flex items-start gap-[0.8rem] text-[1.3rem] text-[#444]">
                        <span className="text-[#FF6600] font-[700] flex-shrink-0">📦</span>
                        <span>AceMQ Broker repository credentials are being emailed to each user you listed.</span>
                      </div>
                    )}
                  </div>
                </div>

                <p className="text-[1.3rem] text-[#999]">
                  Questions? Email{' '}
                  <a href="mailto:onboarding@acemq.com" className="text-[#FF6600] hover:underline">onboarding@acemq.com</a>
                  {' '}or call +1 305-204-2607
                </p>
              </div>
            )}

          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
