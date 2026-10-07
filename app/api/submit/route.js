import { NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

const HS_TOKEN        = process.env.HUBSPOT_TOKEN;
const HS_PORTAL_ID    = process.env.HUBSPOT_PORTAL_ID    || '3925227';
const HS_FORM_GUID    = process.env.HUBSPOT_FORM_GUID    || '325ed46c-382b-4d0e-89f3-6b17bf81df6e';

const MJ_API_KEY      = process.env.MAILJET_API_KEY      || 'bbbbe6000d4db8179e4eafaa9b1c432b';
const MJ_SECRET_KEY   = process.env.MAILJET_SECRET_KEY   || 'c72154c82ee4e1577e536302fb38e7a1';

const JFROG_URL       = process.env.JFROG_URL            || 'https://acemq.jfrog.io';
const JFROG_TOKEN     = process.env.JFROG_ACCESS_TOKEN;

const JIRA_BASE_URL       = process.env.JIRA_BASE_URL        || 'https://acemq.atlassian.net';
const JIRA_EMAIL_ADDR     = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN      = process.env.JIRA_API_TOKEN;
const JIRA_SERVICE_DESK_ID = process.env.JIRA_SERVICE_DESK_ID || '1';

const FUSEBASE_TOKEN             = process.env.FUSEBASE_API_TOKEN;
const FUSEBASE_ORG_ID            = process.env.FUSEBASE_ORG_ID            || 'u25yx9';
const FUSEBASE_MASTER_PORTAL_ID  = process.env.FUSEBASE_MASTER_PORTAL_ID  || 'jiiin9o066qk6uh194n3icwl';
const FUSEBASE_MCP_URL           = 'https://gate-mcp.thefusebase.com/mcp';

const CLICKUP_TOKEN = process.env.CLICKUP_API_TOKEN;
const CLICKUP_LISTS = {
  engagement: process.env.CLICKUP_LIST_ENGAGEMENT || '901417509173', // AceMQ Engagement Pipeline
  license:    process.env.CLICKUP_LIST_LICENSE    || '901417984298', // AceMQ License Onboarding
  support:    process.env.CLICKUP_LIST_SUPPORT    || '901417984379', // AceMQ Support Onboarding
};
const HS_BASE = 'https://api.hubapi.com';

// ─────────────────────────────────────────────────────────────────────────────
// HubSpot helpers
// ─────────────────────────────────────────────────────────────────────────────

async function hsGet(path) {
  const r = await fetch(`${HS_BASE}${path}`, {
    headers: { Authorization: `Bearer ${HS_TOKEN}`, 'Content-Type': 'application/json' },
  });
  if (!r.ok) return null;
  return r.json();
}

async function hsPost(path, body) {
  const r = await fetch(`${HS_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${HS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

async function upsertContact(submitter, company) {
  const email = submitter.email.toLowerCase().trim();

  // Try to find existing
  const search = await hsPost('/crm/v3/objects/contacts/search', {
    filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
    properties: ['email', 'firstname', 'lastname'],
    limit: 1,
  });

  const props = {
    email,
    firstname: submitter.firstName,
    lastname: submitter.lastName,
    company,
    jobtitle: submitter.jobTitle || '',
    phone: submitter.phone || '',
  };

  if (search?.results?.length > 0) {
    const id = search.results[0].id;
    await fetch(`${HS_BASE}/crm/v3/objects/contacts/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${HS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: props }),
    });
    return id;
  }

  const created = await hsPost('/crm/v3/objects/contacts', { properties: props });
  return created?.id;
}

async function findOrCreateCompany(companyName) {
  const search = await hsPost('/crm/v3/objects/companies/search', {
    filterGroups: [{ filters: [{ propertyName: 'name', operator: 'EQ', value: companyName }] }],
    properties: ['name'],
    limit: 1,
  });

  if (search?.results?.length > 0) return search.results[0].id;

  const created = await hsPost('/crm/v3/objects/companies', {
    properties: { name: companyName, domain: '' },
  });
  return created?.id;
}

async function associateContactToCompany(contactId, companyId) {
  await fetch(
    `${HS_BASE}/crm/v4/objects/contact/${contactId}/associations/company/${companyId}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${HS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 }]),
    }
  );
}

async function createEngagementNote(contactId, companyId, noteBody) {
  const note = await hsPost('/crm/v3/objects/notes', {
    properties: {
      hs_note_body: noteBody,
      hs_timestamp: new Date().toISOString(),
    },
    associations: [
      { to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] },
      ...(companyId ? [{ to: { id: companyId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 188 }] }] : []),
    ],
  });
  return note;
}

async function submitHubSpotForm(submitter, company, services, extra = {}) {
  const selectedServices = [
    services.engagement && 'Engagement',
    services.license    && 'License',
    services.support    && 'Support',
    services.broker     && 'AceMQ Broker',
  ].filter(Boolean).join(', ');

  const fields = [
    { name: 'email',     value: submitter.email },
    { name: 'firstname', value: submitter.firstName },
    { name: 'lastname',  value: submitter.lastName },
    { name: 'company',   value: company },
  ];

  if (submitter.phone)    fields.push({ name: 'phone',    value: submitter.phone });
  if (submitter.jobTitle) fields.push({ name: 'jobtitle', value: submitter.jobTitle });

  fields.push({ name: 'services_selected', value: selectedServices });

  // ── LICENSE section ──
  if (services.license && extra.technical) {
    const t = extra.technical;
    if (t.rmqProduct)    fields.push({ name: 'rmq_product',    value: t.rmqProduct });
    if (t.cpuCoreCount)  fields.push({ name: 'cpu_core_count', value: String(t.cpuCoreCount) });
    if (t.cpuCoreType)   fields.push({ name: 'cpu_core_type',  value: t.cpuCoreType });
    if (t.deploymentEnv) fields.push({ name: 'deployment_env', value: t.deploymentEnv });
    if (extra.envUse?.length)      fields.push({ name: 'environment_use',  value: extra.envUse.join(', ') });
    if (extra.packaging?.length)   fields.push({ name: 'packaging_format', value: extra.packaging.join(', ') });
    if (extra.portalUsers?.length) fields.push({ name: 'portal_users',     value: extra.portalUsers.join(', ') });
  }

  // ── ENGAGEMENT section ──
  if (services.engagement) {
    if (extra.kickoffDate)    fields.push({ name: 'kickoff_date',    value: extra.kickoffDate });
    if (extra.teamTimezone)   fields.push({ name: 'team_timezone',   value: extra.teamTimezone });
    if (extra.schedulingPref) fields.push({ name: 'scheduling_pref', value: extra.schedulingPref });
  }

  // Combine free-text comments from both services into one message field (avoids duplicate field name)
  const messageParts = [];
  if (services.engagement && extra.engagementDescription) messageParts.push(`[Engagement]\n${extra.engagementDescription}`);
  if (services.license && extra.comments)                 messageParts.push(`[License]\n${extra.comments}`);
  if (services.broker && extra.broker) {
    const b = extra.broker;
    messageParts.push(`[AceMQ Broker]\n${brokerRows(b).map(([l, v]) => `${l}: ${v}`).join('\n')}${b.users?.length ? `\nRepo Users: ${b.users.join(', ')}` : ''}${b.comments ? `\nComments: ${b.comments}` : ''}`);
  }
  if (messageParts.length) fields.push({ name: 'message', value: messageParts.join('\n\n') });

  await fetch(
    `https://api.hsforms.com/submissions/v3/integration/submit/${HS_PORTAL_ID}/${HS_FORM_GUID}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields, context: { pageName: 'AceMQ Combined Onboarding' } }),
    }
  );
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// [label, value] pairs describing an AceMQ Broker submission, in display order.
function brokerRows(b) {
  if (!b) return [];
  return [
    ['Product',            'AceMQ Broker (current LTS)'],
    ['Deployment',         b.deploymentEnv],
    ['Environment Use',    (b.envUse || []).join(', ')],
    ['Packaging',          (b.packaging || []).join(', ')],
    ['Install Type',       b.installType],
    ['Can Take Downtime',  b.downtime],
    ['Blue/Green Envs',    b.blueGreen],
  ].filter(([, v]) => v);
}

// ─────────────────────────────────────────────────────────────────────────────
// Mailjet helper
// ─────────────────────────────────────────────────────────────────────────────

async function sendMailjetEmail({ toEmail, toName, subject, html, pdfBase64, pdfFilename, attachments }) {
  const credentials = Buffer.from(`${MJ_API_KEY}:${MJ_SECRET_KEY}`).toString('base64');

  // attachments: [{ base64, filename }] — takes priority over legacy pdfBase64/pdfFilename
  const atts = attachments
    ? attachments.map(a => ({ ContentType: 'application/pdf', Filename: a.filename, Base64Content: a.base64 }))
    : pdfBase64
      ? [{ ContentType: 'application/pdf', Filename: pdfFilename || 'onboarding.pdf', Base64Content: pdfBase64 }]
      : [];

  const body = {
    Messages: [
      {
        From:        { Email: 'team@acemq.com', Name: 'AceMQ Team' },
        To:          [{ Email: toEmail, Name: toName }],
        Subject:     subject,
        HTMLPart:    html,
        Attachments: atts,
      },
    ],
  };

  const res = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.ErrorMessage || `Mailjet error ${res.status}`);
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Note body builder
// ─────────────────────────────────────────────────────────────────────────────

function buildNoteBody({ submitter, company, services,
  engagementParticipants, kickoffDate, teamTimezone, schedulingPref,
  engagementDescription, technical, envUse, packaging, comments, portalUsers, supportUsers, broker }) {

  const selectedServices = [
    services.engagement && 'Engagement',
    services.license    && 'License',
    services.support    && 'Support',
    services.broker     && 'AceMQ Broker',
  ].filter(Boolean).join(', ');

  let note = `AceMQ Combined Onboarding Submission\n`;
  note += `Company: ${company}\n`;
  note += `Submitter: ${submitter.firstName} ${submitter.lastName} <${submitter.email}>\n`;
  if (submitter.jobTitle) note += `Title: ${submitter.jobTitle}\n`;
  if (submitter.phone)    note += `Phone: ${submitter.phone}\n`;
  note += `Services: ${selectedServices}\n\n`;

  if (services.engagement) {
    note += `--- ENGAGEMENT ---\n`;
    if (kickoffDate)           note += `Est. Kickoff: ${kickoffDate}\n`;
    if (teamTimezone)          note += `Timezone: ${teamTimezone}\n`;
    if (schedulingPref)        note += `Scheduling: ${schedulingPref}\n`;
    note += `Participants:\n`;
    note += `  ${submitter.firstName} ${submitter.lastName}${submitter.jobTitle ? ` · ${submitter.jobTitle}` : ''} · ${submitter.email} · Lead Stakeholder\n`;
    if (engagementParticipants?.length) {
      engagementParticipants.forEach(p => {
        note += `  ${p.firstName} ${p.lastName}${p.title ? ` · ${p.title}` : ''} · ${p.email} · ${p.role}\n`;
      });
    }
    if (engagementDescription) note += `Comments: ${engagementDescription}\n`;
    note += '\n';
  }

  if (services.license) {
    note += `--- LICENSE ---\n`;
    note += `Product: ${technical.rmqProduct || '—'}\n`;
    note += `CPU: ${technical.cpuCoreCount || '—'} ${technical.cpuCoreType || ''}\n`;
    note += `Deployment: ${technical.deploymentEnv || '—'}\n`;
    note += `Env Use: ${envUse.join(', ') || '—'}\n`;
    note += `Packaging: ${packaging.join(', ') || '—'}\n`;
    if (comments) note += `Comments: ${comments}\n`;
    if (portalUsers?.length) note += `Portal Users: ${portalUsers.join(', ')}\n`;
    note += '\n';
  }

  if (services.broker && broker) {
    note += `--- ACEMQ BROKER ---\n`;
    brokerRows(broker).forEach(([l, v]) => { note += `${l}: ${v}\n`; });
    if (broker.users?.length) note += `Repo Users: ${broker.users.join(', ')}\n`;
    if (broker.comments) note += `Comments: ${broker.comments}\n`;
    note += '\n';
  }

  if (services.support || services.engagement) {
    note += `--- SUPPORT USERS ---\n`;
    supportUsers?.forEach(u => {
      note += `  ${u.firstName} ${u.lastName} <${u.email}>\n`;
    });
  }

  return note;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal team email — comprehensive provisioning summary
// ─────────────────────────────────────────────────────────────────────────────

function buildInternalEmailHtml({
  submitter, company, services,
  engagementParticipants, kickoffDate, teamTimezone, schedulingPref,
  technical, envUse, packaging, portalUsers, supportUsers,
  fusebaseResult, fusebaseError,
  jfrogResult, jfrogError,
  jsmResult, jsmError,
  broker, brokerJfrogResult, brokerJfrogError,
  pdfGenerated,
}) {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const svcList = [
    services.engagement && '🤝 Engagement',
    services.license    && '🔑 License',
    services.support    && '🎫 Support',
    services.broker     && '📦 AceMQ Broker',
  ].filter(Boolean).join('&nbsp;&nbsp;·&nbsp;&nbsp;');

  const ok  = (label) => `<span style="display:inline-block;background:#d4edda;color:#155724;border-radius:4px;padding:1px 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">${label}</span>`;
  const err = (label) => `<span style="display:inline-block;background:#f8d7da;color:#721c24;border-radius:4px;padding:1px 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">${label}</span>`;
  const na  = (label) => `<span style="display:inline-block;background:#e9ecef;color:#6c757d;border-radius:4px;padding:1px 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">${label}</span>`;

  const row = (label, value, alt) => `
    <tr style="${alt ? 'background:#f8f8f8;' : ''}border-top:1px solid #eee;">
      <td style="padding:8px 12px;font-size:12px;color:#999;font-weight:700;text-transform:uppercase;width:38%;white-space:nowrap;">${label}</td>
      <td style="padding:8px 12px;font-size:13px;color:#161616;">${value}</td>
    </tr>`;

  let sections = '';

  // ── ENGAGEMENT ──
  if (services.engagement) {
    const status = fusebaseError ? err('Error') : fusebaseResult ? ok('Provisioned') : na('Skipped');
    const leadRow = { firstName: submitter.firstName, lastName: submitter.lastName, title: submitter.jobTitle || '', email: submitter.email, role: 'Lead Stakeholder' };
    const allParticipants = [leadRow, ...(engagementParticipants || [])];
    const participantRows = allParticipants.map((p, i) => `
      <tr style="${i % 2 === 0 ? '' : 'background:#f8f8f8;'}border-top:1px solid #eee;">
        <td style="padding:6px 10px;font-size:12px;">${p.firstName || ''} ${p.lastName || ''}</td>
        <td style="padding:6px 10px;font-size:12px;color:#666;">${p.title || p.jobTitle || '—'}</td>
        <td style="padding:6px 10px;font-size:12px;color:#FF6600;">${p.email}</td>
        <td style="padding:6px 10px;font-size:12px;">${p.role || '—'}</td>
      </tr>`).join('');

    sections += `
    <div style="margin-bottom:28px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <p style="margin:0;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#FF6600;">🤝 Engagement</p>
        &nbsp;${status}
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#fff;border:1px solid #eee;border-radius:6px;overflow:hidden;margin-bottom:10px;">
        ${row('Portal Domain', fusebaseResult ? `<a href="https://${fusebaseResult.domain}" style="color:#FF6600;">${fusebaseResult.domain}</a>` : '—', false)}
        ${row('Users Invited', fusebaseResult ? String(fusebaseResult.usersInvited) : '—', true)}
        ${kickoffDate ? row('Kickoff Date', kickoffDate, false) : ''}
        ${teamTimezone ? row('Timezone', teamTimezone, true) : ''}
        ${schedulingPref ? row('Scheduling', schedulingPref, false) : ''}
        ${fusebaseError ? row('Error', `<span style="color:#721c24;">${fusebaseError}</span>`, true) : ''}
      </table>
      <p style="margin:6px 0 4px;font-size:12px;font-weight:700;color:#161616;">Participants (${allParticipants.length})</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #eee;border-radius:6px;overflow:hidden;">
        <tr style="background:#161616;">
          <td style="padding:6px 10px;font-size:11px;color:#fff;font-weight:700;">Name</td>
          <td style="padding:6px 10px;font-size:11px;color:#fff;font-weight:700;">Title</td>
          <td style="padding:6px 10px;font-size:11px;color:#fff;font-weight:700;">Email</td>
          <td style="padding:6px 10px;font-size:11px;color:#fff;font-weight:700;">Role</td>
        </tr>
        ${participantRows}
      </table>
    </div>`;
  }

  // ── LICENSE ──
  if (services.license) {
    const jfrogStatus = jfrogError ? err('Error') : jfrogResult ? ok('Provisioned') : na('Skipped');
    const jsmStatus   = jsmError   ? err('Error') : jsmResult   ? ok('Provisioned') : na('Skipped');

    const allJFrogUsers = [...(jfrogResult?.invited || []), ...(jfrogResult?.updated || [])];
    const jfrogUserRows = allJFrogUsers.map((e, i) => `
      <tr style="${i % 2 === 0 ? '' : 'background:#f8f8f8;'}border-top:1px solid #eee;">
        <td style="padding:6px 10px;font-size:12px;color:#FF6600;">${e}</td>
        <td style="padding:6px 10px;font-size:11px;color:#666;">${jfrogResult?.invited?.includes(e) ? '(invited — new account)' : '(added to group)'}</td>
      </tr>`).join('');
    const jfrogFailRows = (jfrogResult?.failed || []).map(f => `
      <tr style="border-top:1px solid #eee;background:#fff5f5;">
        <td colspan="2" style="padding:6px 10px;font-size:12px;color:#721c24;">${f}</td>
      </tr>`).join('');

    sections += `
    <div style="margin-bottom:28px;">
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#FF6600;">🔑 License</p>

      <!-- JFrog -->
      <div style="margin-bottom:12px;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#161616;">JFrog Artifactory &nbsp;${jfrogStatus}</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#fff;border:1px solid #eee;border-radius:6px;overflow:hidden;margin-bottom:6px;">
          ${row('Group', jfrogResult?.groupName || '—', false)}
          ${row('Permission Target', jfrogResult?.permName || '—', true)}
          ${row('Group Created', jfrogResult ? (jfrogResult.groupCreated ? 'Yes (new)' : 'No (existing)') : '—', false)}
          ${row('Perm Created', jfrogResult ? (jfrogResult.permCreated ? 'Yes (new)' : 'No (existing)') : '—', true)}
          ${jfrogError ? row('Error', `<span style="color:#721c24;">${jfrogError}</span>`, false) : ''}
        </table>
        ${allJFrogUsers.length > 0 ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #eee;border-radius:6px;overflow:hidden;">
          <tr style="background:#161616;">
            <td style="padding:6px 10px;font-size:11px;color:#fff;font-weight:700;">Email</td>
            <td style="padding:6px 10px;font-size:11px;color:#fff;font-weight:700;">Status</td>
          </tr>
          ${jfrogUserRows}
          ${jfrogFailRows}
        </table>` : ''}
      </div>

      <!-- Technical details -->
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#161616;">Technical Configuration</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#fff;border:1px solid #eee;border-radius:6px;overflow:hidden;margin-bottom:10px;">
        ${technical?.rmqProduct    ? row('RabbitMQ Product', technical.rmqProduct, false) : ''}
        ${technical?.cpuCoreCount  ? row('CPU Cores', `${technical.cpuCoreCount} ${technical.cpuCoreType || ''}`.trim(), true) : ''}
        ${technical?.deploymentEnv ? row('Deployment', technical.deploymentEnv, false) : ''}
        ${envUse?.length           ? row('Environment Use', envUse.join(', '), true) : ''}
        ${packaging?.length        ? row('Packaging', packaging.join(', '), false) : ''}
      </table>

      <!-- JSM -->
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#161616;">Jira Service Management &nbsp;${jsmStatus}</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#fff;border:1px solid #eee;border-radius:6px;overflow:hidden;">
        ${row('Org Name', jsmResult?.orgName || '—', false)}
        ${row('Org ID', jsmResult?.orgId || '—', true)}
        ${row('Org Created', jsmResult ? (jsmResult.orgCreated ? 'Yes (new)' : 'No (existing)') : '—', false)}
        ${row('Users Added', jsmResult ? String(jsmResult.usersAdded?.length || 0) : '—', true)}
        ${jsmError ? row('Error', `<span style="color:#721c24;">${jsmError}</span>`, false) : ''}
      </table>
    </div>`;
  }

  // ── SUPPORT ──
  if (services.support) {
    const jsmStatus = jsmError ? err('Error') : jsmResult ? ok('Provisioned') : na('Skipped');
    const supportUserRows = (supportUsers || []).map((u, i) => `
      <tr style="${i % 2 === 0 ? '' : 'background:#f8f8f8;'}border-top:1px solid #eee;">
        <td style="padding:6px 10px;font-size:12px;">${u.firstName || ''} ${u.lastName || ''}</td>
        <td style="padding:6px 10px;font-size:12px;color:#FF6600;">${u.email}</td>
      </tr>`).join('');

    sections += `
    <div style="margin-bottom:28px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <p style="margin:0;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#FF6600;">🎫 Support</p>
        &nbsp;${jsmStatus}
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#fff;border:1px solid #eee;border-radius:6px;overflow:hidden;margin-bottom:10px;">
        ${row('Org Name', jsmResult?.orgName || '—', false)}
        ${row('Users Added', jsmResult ? String(jsmResult.usersAdded?.length || 0) : '—', true)}
        ${jsmError ? row('Error', `<span style="color:#721c24;">${jsmError}</span>`, false) : ''}
      </table>
      ${supportUsers?.length > 0 ? `
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #eee;border-radius:6px;overflow:hidden;">
        <tr style="background:#161616;">
          <td style="padding:6px 10px;font-size:11px;color:#fff;font-weight:700;">Name</td>
          <td style="padding:6px 10px;font-size:11px;color:#fff;font-weight:700;">Email</td>
        </tr>
        ${supportUserRows}
      </table>` : ''}
    </div>`;
  }

  // ── ACEMQ BROKER ──
  if (services.broker) {
    const status = brokerJfrogError ? err('Error') : brokerJfrogResult ? ok('Provisioned') : na('Skipped');
    const users  = [...(brokerJfrogResult?.invited || []), ...(brokerJfrogResult?.updated || [])];
    const userRows = users.map((e, i) => `
      <tr style="${i % 2 === 0 ? '' : 'background:#f8f8f8;'}border-top:1px solid #eee;">
        <td style="padding:6px 10px;font-size:12px;color:#FF6600;">${esc(e)}</td>
        <td style="padding:6px 10px;font-size:11px;color:#666;">${brokerJfrogResult.invited.includes(e) ? '(invited — new account)' : '(added to group)'}</td>
      </tr>`).join('');
    const failRows = (brokerJfrogResult?.failed || []).map(f => `
      <tr style="border-top:1px solid #eee;background:#fff5f5;"><td colspan="2" style="padding:6px 10px;font-size:12px;color:#721c24;">${esc(f)}</td></tr>`).join('');

    sections += `
    <div style="margin-bottom:28px;">
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#FF6600;">📦 AceMQ Broker</p>
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#161616;">JFrog Artifactory &nbsp;${status}</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#fff;border:1px solid #eee;border-radius:6px;overflow:hidden;margin-bottom:6px;">
        ${row('Group', esc(brokerJfrogResult?.groupName || '—'), false)}
        ${row('Permission Target', esc(brokerJfrogResult?.permName || '—'), true)}
        ${brokerJfrogError ? row('Error', `<span style="color:#721c24;">${esc(brokerJfrogError)}</span>`, false) : ''}
      </table>
      ${users.length || failRows ? `
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #eee;border-radius:6px;overflow:hidden;margin-bottom:10px;">
        <tr style="background:#161616;">
          <td style="padding:6px 10px;font-size:11px;color:#fff;font-weight:700;">Email</td>
          <td style="padding:6px 10px;font-size:11px;color:#fff;font-weight:700;">Status</td>
        </tr>
        ${userRows}${failRows}
      </table>` : ''}
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#161616;">Environment &amp; Go-Live</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#fff;border:1px solid #eee;border-radius:6px;overflow:hidden;">
        ${brokerRows(broker).map(([l, v], i) => row(l, esc(v), i % 2 === 1)).join('')}
        ${broker?.comments ? row('Comments', esc(broker.comments), false) : ''}
      </table>
    </div>`;
  }

  const hasErrors = fusebaseError || jfrogError || jsmError || brokerJfrogError;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.08);">
        <tr><td style="background:#000;padding:24px 36px;">
          <p style="margin:0;color:#8FD5CC;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;">THE #1 RABBITMQ PARTNER</p>
          <p style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:700;">AceMQ — Internal Onboarding Report</p>
        </td></tr>
        <tr><td style="background:${hasErrors ? '#c0392b' : '#FF6600'};height:4px;"></td></tr>
        <tr><td style="padding:32px 36px;">
          <p style="margin:0 0 6px;color:#FF6600;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;">New Submission — ${date}</p>
          <h1 style="margin:0 0 20px;color:#161616;font-size:24px;font-weight:700;">${company}</h1>

          <!-- Summary -->
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f8f8f8;border-radius:8px;overflow:hidden;margin-bottom:28px;">
            ${row('Submitter', `${submitter.firstName} ${submitter.lastName} &lt;${submitter.email}&gt;`, false)}
            ${submitter.jobTitle ? row('Title', submitter.jobTitle, true) : ''}
            ${submitter.phone    ? row('Phone', submitter.phone, false) : ''}
            ${row('Services', svcList, submitter.phone ? false : true)}
            ${row('Report PDF', pdfGenerated ? ok('Attached') : err('Failed'), false)}
            ${hasErrors ? row('Overall Status', err('Errors — review below'), true) : row('Overall Status', ok('All systems provisioned'), true)}
          </table>

          <!-- Per-service sections -->
          ${sections}

        </td></tr>
        <tr><td style="background:#000;padding:16px 36px;text-align:center;">
          <p style="margin:0;color:#666;font-size:11px;">© ${new Date().getFullYear()} AceMQ, an Ace8 Company · Sent automatically by onboarding.acemq.com</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildCustomerEmailHtml({ submitter, company, services, engagementParticipants,
  kickoffDate, teamTimezone, schedulingPref, technical, envUse, packaging, portalUsers, supportUsers, broker }) {

  const svcList = [
    services.engagement && '🤝 Engagement',
    services.license    && '🔑 License',
    services.support    && '🎫 Support',
    services.broker     && '📦 AceMQ Broker',
  ].filter(Boolean);

  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  let sectionsHtml = '';

  if (services.engagement) {
    const leadRow = { firstName: submitter.firstName, lastName: submitter.lastName, title: submitter.jobTitle || '', email: submitter.email, role: 'Lead Stakeholder' };
    const allParticipants = [leadRow, ...(engagementParticipants || [])];
    const participantRows = allParticipants.map(p => `
      <tr style="border-top:1px solid #eee;">
        <td style="padding:8px 12px;font-size:13px;">${p.firstName || ''} ${p.lastName || ''}</td>
        <td style="padding:8px 12px;font-size:13px;color:#666;">${p.title || p.jobTitle || '—'}</td>
        <td style="padding:8px 12px;font-size:13px;color:#FF6600;">${p.email}</td>
        <td style="padding:8px 12px;font-size:13px;">${p.role}</td>
      </tr>`).join('');

    sectionsHtml += `
    <div style="margin-bottom:28px;">
      <p style="margin:0 0 8px;color:#FF6600;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;">Engagement</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f8f8f8;border-radius:6px;overflow:hidden;margin-bottom:12px;">
        ${kickoffDate ? `<tr><td style="padding:8px 12px;font-size:12px;color:#999;font-weight:700;text-transform:uppercase;width:38%;">Kickoff Date</td><td style="padding:8px 12px;font-size:13px;">${kickoffDate}</td></tr>` : ''}
        ${teamTimezone ? `<tr style="border-top:1px solid #eee;"><td style="padding:8px 12px;font-size:12px;color:#999;font-weight:700;text-transform:uppercase;">Team Timezone</td><td style="padding:8px 12px;font-size:13px;">${teamTimezone}</td></tr>` : ''}
        ${schedulingPref ? `<tr style="border-top:1px solid #eee;"><td style="padding:8px 12px;font-size:12px;color:#999;font-weight:700;text-transform:uppercase;">Scheduling</td><td style="padding:8px 12px;font-size:13px;">${schedulingPref}</td></tr>` : ''}
      </table>
      <p style="margin:12px 0 6px;font-size:12px;font-weight:700;color:#161616;">Participants</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:6px;overflow:hidden;">
        <tr style="background:#161616;">
          <td style="padding:8px 12px;font-size:11px;color:#fff;font-weight:700;">Name</td>
          <td style="padding:8px 12px;font-size:11px;color:#fff;font-weight:700;">Title</td>
          <td style="padding:8px 12px;font-size:11px;color:#fff;font-weight:700;">Email</td>
          <td style="padding:8px 12px;font-size:11px;color:#fff;font-weight:700;">Role</td>
        </tr>
        ${participantRows}
      </table>
    </div>`;
  }

  if (services.license) {
    const licRows = [
      technical?.rmqProduct    && ['RabbitMQ Product', technical.rmqProduct],
      technical?.cpuCoreCount  && ['CPU Cores', `${technical.cpuCoreCount} ${technical.cpuCoreType || ''}`.trim()],
      technical?.deploymentEnv && ['Deployment', technical.deploymentEnv],
      envUse?.length           && ['Environment Use', envUse.join(', ')],
      packaging?.length        && ['Packaging', packaging.join(', ')],
    ].filter(Boolean);

    const licRowsHtml = licRows.map(([l, v], i) => `
      <tr style="${i > 0 ? 'border-top:1px solid #eee;' : ''}">
        <td style="padding:8px 12px;font-size:12px;color:#999;font-weight:700;text-transform:uppercase;width:38%;">${l}</td>
        <td style="padding:8px 12px;font-size:13px;">${v}</td>
      </tr>`).join('');

    const portalRowsHtml = (portalUsers || []).map(e => `
      <tr style="border-top:1px solid #eee;"><td style="padding:8px 12px;font-size:13px;color:#FF6600;">${e}</td></tr>`).join('');

    sectionsHtml += `
    <div style="margin-bottom:28px;">
      <p style="margin:0 0 8px;color:#FF6600;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;">License</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f8f8f8;border-radius:6px;overflow:hidden;margin-bottom:12px;">
        ${licRowsHtml}
      </table>
      ${portalUsers?.length ? `
      <p style="margin:12px 0 6px;font-size:12px;font-weight:700;color:#161616;">Portal Users</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f8f8f8;border-radius:6px;overflow:hidden;">
        <tr style="background:#161616;"><td style="padding:8px 12px;font-size:11px;color:#fff;font-weight:700;">Email</td></tr>
        ${portalRowsHtml}
      </table>` : ''}
      <p style="margin:12px 0 0;font-size:13px;color:#666;">Your JFrog Artifactory credentials will be emailed to each portal user shortly. A setup guide is attached to this email.</p>
    </div>`;
  }

  if (services.broker && broker) {
    const rowsHtml = brokerRows(broker).map(([l, v], i) => `
      <tr style="${i > 0 ? 'border-top:1px solid #eee;' : ''}">
        <td style="padding:8px 12px;font-size:12px;color:#999;font-weight:700;text-transform:uppercase;width:38%;">${esc(l)}</td>
        <td style="padding:8px 12px;font-size:13px;">${esc(v)}</td>
      </tr>`).join('');
    const users = [submitter.email, ...(broker.users || [])];

    sectionsHtml += `
    <div style="margin-bottom:28px;">
      <p style="margin:0 0 8px;color:#FF6600;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;">AceMQ Broker</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f8f8f8;border-radius:6px;overflow:hidden;margin-bottom:12px;">
        ${rowsHtml}
      </table>
      <p style="margin:12px 0 6px;font-size:12px;font-weight:700;color:#161616;">Repository Access</p>
      <p style="margin:0;font-size:13px;color:#FF6600;">${users.map(esc).join('<br>')}</p>
      <p style="margin:12px 0 0;font-size:13px;color:#666;">Each person above will receive a separate email with their AceMQ Artifactory login for the AceMQ Broker repository.</p>
    </div>`;
  }

  if (services.support) {
    const supportRowsHtml = (supportUsers || []).map((u, i) => `
      <tr style="${i > 0 ? 'border-top:1px solid #eee;' : ''}">
        <td style="padding:8px 12px;font-size:13px;">${u.firstName || ''} ${u.lastName || ''}</td>
        <td style="padding:8px 12px;font-size:13px;color:#FF6600;">${u.email}</td>
      </tr>`).join('');

    sectionsHtml += `
    <div style="margin-bottom:28px;">
      <p style="margin:0 0 8px;color:#FF6600;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;">Support</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f8f8f8;border-radius:6px;overflow:hidden;">
        <tr style="background:#161616;">
          <td style="padding:8px 12px;font-size:11px;color:#fff;font-weight:700;">Name</td>
          <td style="padding:8px 12px;font-size:11px;color:#fff;font-weight:700;">Email</td>
        </tr>
        ${supportRowsHtml}
      </table>
      <p style="margin:12px 0 0;font-size:13px;color:#666;">Your support portal access has been provisioned. You will receive a separate email from our support system.</p>
    </div>`;
  }

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.08);">
        <tr><td style="background:#000;padding:28px 40px;">
          <p style="margin:0;color:#8FD5CC;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;">THE #1 RABBITMQ PARTNER</p>
          <p style="margin:6px 0 0;color:#fff;font-size:24px;font-weight:700;">AceMQ</p>
        </td></tr>
        <tr><td style="background:#FF6600;height:4px;"></td></tr>
        <tr><td style="padding:40px;">
          <p style="margin:0 0 8px;color:#FF6600;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;">Onboarding Confirmed</p>
          <h1 style="margin:0 0 8px;color:#161616;font-size:26px;font-weight:700;">Welcome, ${submitter.firstName}!</h1>
          <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.6;">
            Thank you for completing your onboarding with AceMQ. Your submission has been received and our team will be in touch within <strong>1 business day</strong> to get everything kicked off.
          </p>

          <!-- Summary card -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8f8;border-radius:8px;margin-bottom:28px;">
            <tr><td style="padding:20px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:7px 0;color:#999;font-size:12px;font-weight:700;text-transform:uppercase;width:40%;">Company</td>
                  <td style="padding:7px 0;color:#161616;font-size:14px;font-weight:700;">${company}</td>
                </tr>
                <tr>
                  <td style="padding:7px 0;color:#999;font-size:12px;font-weight:700;text-transform:uppercase;">Services</td>
                  <td style="padding:7px 0;color:#161616;font-size:14px;">${svcList.join('&nbsp;&nbsp;·&nbsp;&nbsp;')}</td>
                </tr>
                <tr>
                  <td style="padding:7px 0;color:#999;font-size:12px;font-weight:700;text-transform:uppercase;">Date</td>
                  <td style="padding:7px 0;color:#161616;font-size:14px;">${date}</td>
                </tr>
              </table>
            </td></tr>
          </table>

          <!-- Per-service detail sections -->
          ${sectionsHtml}

          <div style="background:#fff8f3;border-left:3px solid #FF6600;border-radius:4px;padding:16px 20px;margin-bottom:24px;">
            <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">
              Your full onboarding report is attached to this email as a PDF for your records.
              ${services.license ? 'The JFrog Pull Guide is also attached to help you get started with your license.' : ''}
            </p>
          </div>

          <p style="margin:0;font-size:14px;color:#555;line-height:1.6;">
            Questions? Reach out to us at <a href="mailto:support@acemq.com" style="color:#FF6600;">support@acemq.com</a>
          </p>
        </td></tr>
        <tr><td style="background:#000;padding:20px 40px;text-align:center;">
          <p style="margin:0;color:#666;font-size:11px;">© ${new Date().getFullYear()} AceMQ, an Ace8 Company · support@acemq.com · acemq.com</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF report — pdf-lib, matches AceMQ Standard Doc Format (same as Redis tool)
// ─────────────────────────────────────────────────────────────────────────────

function toWinAnsi(str) {
  return String(str ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x00-\xFF—–‘’“”•…€™]/g, '?'); // WinAnsi = Latin-1 + these cp1252 extras
}

function patchDrawText(page) {
  const orig = page.drawText.bind(page);
  page.drawText = (text, opts) => orig(toWinAnsi(text), opts);
  return page;
}

async function buildReportPdf({
  submitter, company, services,
  engagementParticipants, kickoffDate, teamTimezone, schedulingPref, timeSlotPref, engagementDescription,
  technical, envUse, packaging, comments, portalUsers, supportUsers, broker,
}) {
  const doc     = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);

  const BLACK  = rgb(0,    0,    0);
  const ORANGE = rgb(1,    0.4,  0);
  const DARK   = rgb(0.1,  0.1,  0.1);
  const LIGHT  = rgb(0.6,  0.6,  0.6);
  const WHITE  = rgb(1,    1,    1);
  const ROWALT = rgb(0.98, 0.98, 0.98);
  const BRDR   = rgb(0.91, 0.91, 0.91);

  const W = 595, H = 842;
  const ML = 56, MR = 56;
  const BW = W - ML - MR;

  const date      = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const dateShort = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
  const subName   = [submitter.firstName, submitter.lastName].filter(Boolean).join(' ');
  const svcNames  = [
    services.engagement && 'Engagement',
    services.license    && 'License',
    services.support    && 'Support',
    services.broker     && 'AceMQ Broker',
  ].filter(Boolean);

  let page = patchDrawText(doc.addPage([W, H]));
  let y = H - 56;

  function wrapLines(text, font, size, maxW) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const trial = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(trial, size) > maxW && cur) { lines.push(cur); cur = w; }
      else cur = trial;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  function ensureSpace(needed) {
    if (y - needed < 56) {
      page = patchDrawText(doc.addPage([W, H]));
      y = H - 56;
      drawFooter(page);
    }
  }

  function drawFooter(p) {
    const fy = 36;
    p.drawLine({ start: { x: ML, y: fy + 12 }, end: { x: W - MR, y: fy + 12 }, thickness: 0.5, color: LIGHT, opacity: 0.5 });
    p.drawText('AceMQ · an ace8 company', { x: ML, y: fy, font: regular, size: 7, color: LIGHT });
    const right = `AceMQ Onboarding Report  ·  ${dateShort}`;
    p.drawText(right, { x: W - MR - regular.widthOfTextAtSize(right, 7), y: fy, font: regular, size: 7, color: LIGHT });
  }

  drawFooter(page);

  // ── COVER ──
  page.drawRectangle({ x: ML, y: y - 2, width: BW, height: 2, color: ORANGE });
  y -= 16;
  page.drawText('ONBOARDING REPORT', { x: ML, y, font: bold, size: 7.5, color: ORANGE, characterSpacing: 1.8 });
  y -= 14;
  page.drawText('AceMQ Onboarding Report', { x: ML, y, font: bold, size: 22, color: BLACK });
  y -= 28;
  page.drawText(`${company}  ·  Prepared by AceMQ  ·  ${date}`, { x: ML, y, font: regular, size: 10, color: LIGHT });
  y -= 20;
  page.drawRectangle({ x: ML, y: y - 18, width: BW, height: 18, color: ORANGE });
  page.drawText(`SERVICES:  ${svcNames.join('  ·  ').toUpperCase()}`, { x: ML + 10, y: y - 13, font: bold, size: 7.5, color: WHITE, characterSpacing: 0.6 });
  y -= 30;

  // Submission details table
  y -= 6;
  page.drawText('Submission Details', { x: ML, y, font: bold, size: 13, color: BLACK });
  y -= 12;

  const COL1  = BW * 0.3;
  const ROW_H = 16;

  const detailRows = [
    ['Title',          'AceMQ Onboarding Report'],
    ['Services',       svcNames.join(', ')],
    ['Submitted By',   subName],
    ['Company',        company],
    ...(submitter.jobTitle ? [['Job Title',  submitter.jobTitle]] : []),
    ['Email',          submitter.email],
    ...(submitter.phone    ? [['Phone',      submitter.phone]]    : []),
    ['Date Submitted', date],
    ['Prepared By',    'AceMQ — Program Management'],
  ];

  page.drawRectangle({ x: ML, y: y - ROW_H, width: BW, height: ROW_H, color: DARK });
  page.drawText('Document', { x: ML + 6,       y: y - ROW_H + 5, font: bold, size: 8, color: WHITE });
  page.drawText('Detail',   { x: ML + COL1 + 6, y: y - ROW_H + 5, font: bold, size: 8, color: WHITE });
  y -= ROW_H;

  detailRows.forEach(([l, v], i) => {
    ensureSpace(ROW_H + 2);
    if (i % 2 === 1) page.drawRectangle({ x: ML, y: y - ROW_H, width: BW, height: ROW_H, color: ROWALT });
    page.drawLine({ start: { x: ML, y: y - ROW_H }, end: { x: ML + BW, y: y - ROW_H }, thickness: 0.4, color: BRDR });
    page.drawText(l, { x: ML + 6, y: y - ROW_H + 5, font: regular, size: 8, color: LIGHT });
    const vf = (l === 'Company' || l === 'Services') ? bold : regular;
    page.drawText(String(v || '—'), { x: ML + COL1 + 6, y: y - ROW_H + 5, font: vf, size: 8, color: DARK, maxWidth: BW - COL1 - 12 });
    y -= ROW_H;
  });
  y -= 16;

  // ── Helpers ──

  function drawSectionBanner(num, title) {
    ensureSpace(36);
    y -= 8;
    page.drawRectangle({ x: ML, y: y - 18, width: BW, height: 18, color: ORANGE });
    page.drawText(`${num}.  ${title}`, { x: ML + 10, y: y - 13, font: bold, size: 8, color: WHITE, characterSpacing: 0.8 });
    y -= 28;
  }

  function drawSectionHead(text) {
    ensureSpace(22);
    page.drawText(text, { x: ML, y, font: bold, size: 12, color: BLACK });
    y -= 16;
  }

  function drawSubHead(text) {
    ensureSpace(18);
    page.drawText(text, { x: ML, y, font: bold, size: 10, color: DARK });
    y -= 14;
  }

  function drawKVTable(rows) {
    page.drawRectangle({ x: ML, y: y - ROW_H, width: BW, height: ROW_H, color: DARK });
    page.drawText('Detail', { x: ML + 6,       y: y - ROW_H + 5, font: bold, size: 8, color: WHITE });
    page.drawText('Value',  { x: ML + COL1 + 6, y: y - ROW_H + 5, font: bold, size: 8, color: WHITE });
    y -= ROW_H;
    rows.forEach(([l, v], i) => {
      ensureSpace(ROW_H + 2);
      if (i % 2 === 1) page.drawRectangle({ x: ML, y: y - ROW_H, width: BW, height: ROW_H, color: ROWALT });
      page.drawLine({ start: { x: ML, y: y - ROW_H }, end: { x: ML + BW, y: y - ROW_H }, thickness: 0.4, color: BRDR });
      page.drawText(l, { x: ML + 6, y: y - ROW_H + 5, font: regular, size: 8, color: LIGHT });
      page.drawText(String(v || '—'), { x: ML + COL1 + 6, y: y - ROW_H + 5, font: regular, size: 8, color: DARK, maxWidth: BW - COL1 - 12 });
      y -= ROW_H;
    });
    y -= 8;
  }

  function drawTextBlock(text) {
    if (!text?.trim()) return;
    const LH = 13, SZ = 8.5, AW = BW - 16;
    const lines = wrapLines(text, regular, SZ, AW);
    const blockH = lines.length * LH + 10;
    ensureSpace(blockH);
    page.drawRectangle({ x: ML, y: y - blockH + 10, width: 3, height: blockH - 10, color: ORANGE });
    lines.forEach((line, i) => {
      page.drawText(line, { x: ML + 10, y: y - i * LH, font: regular, size: SZ, color: DARK });
    });
    y -= blockH;
  }

  let sn = 1;

  // ── ENGAGEMENT ──
  if (services.engagement) {
    drawSectionBanner(sn++, 'ENGAGEMENT ONBOARDING');
    drawSectionHead('Engagement Details');

    const engRows = [
      ['Est. Kickoff Date',      kickoffDate],
      ['Team Timezone',          teamTimezone],
      ['Scheduling Preference',  schedulingPref],
      ['Time Preference',        timeSlotPref],
    ].filter(([, v]) => v);
    if (engRows.length) drawKVTable(engRows);

    {
      const leadRow = { firstName: submitter.firstName, lastName: submitter.lastName, title: submitter.jobTitle || '', email: submitter.email, role: 'Lead Stakeholder' };
      const allParticipants = [leadRow, ...(engagementParticipants || [])];
      drawSubHead('Participants');
      const PC = [BW * 0.25, BW * 0.22, BW * 0.28, BW * 0.25];
      const PRH = 15;
      ensureSpace(PRH + 2);
      page.drawRectangle({ x: ML, y: y - PRH, width: BW, height: PRH, color: DARK });
      let xo = ML;
      ['Name', 'Title', 'Email', 'Role'].forEach((h, ci) => {
        page.drawText(h, { x: xo + 4, y: y - PRH + 5, font: bold, size: 7.5, color: WHITE, maxWidth: PC[ci] - 8 });
        xo += PC[ci];
      });
      y -= PRH;
      allParticipants.forEach((p, i) => {
        ensureSpace(PRH + 2);
        if (i % 2 === 1) page.drawRectangle({ x: ML, y: y - PRH, width: BW, height: PRH, color: ROWALT });
        page.drawLine({ start: { x: ML, y: y - PRH }, end: { x: ML + BW, y: y - PRH }, thickness: 0.4, color: BRDR });
        xo = ML;
        [`${p.firstName || ''} ${p.lastName || ''}`.trim() || '—', p.title || '—', p.email || '—', p.role || '—'].forEach((c, ci) => {
          page.drawText(c, { x: xo + 4, y: y - PRH + 5, font: regular, size: 7.5, color: DARK, maxWidth: PC[ci] - 8 });
          xo += PC[ci];
        });
        y -= PRH;
      });
      y -= 8;
    }

    if (engagementDescription?.trim()) {
      drawSubHead('Additional Comments');
      drawTextBlock(engagementDescription);
    }
  }

  // ── LICENSE ──
  if (services.license) {
    drawSectionBanner(sn++, 'LICENSE SETUP');
    drawSectionHead('Technical Environment');

    const licRows = [
      ['RabbitMQ Product',   technical?.rmqProduct],
      ['CPU Core Count',     technical?.cpuCoreCount],
      ['CPU Core Type',      technical?.cpuCoreType],
      ['Deployment Env',     technical?.deploymentEnv],
      ['Environment Use',    envUse?.join(', ')],
      ['Packaging Format',   packaging?.join(', ')],
    ].filter(([, v]) => v);
    if (licRows.length) drawKVTable(licRows);

    if (portalUsers?.length) {
      drawSubHead('Portal Users');
      portalUsers.forEach((email, i) => {
        ensureSpace(14);
        if (i % 2 === 0) page.drawRectangle({ x: ML, y: y - 13, width: BW, height: 13, color: ROWALT });
        page.drawLine({ start: { x: ML, y: y - 13 }, end: { x: ML + BW, y: y - 13 }, thickness: 0.4, color: BRDR });
        page.drawText(email, { x: ML + 6, y: y - 8, font: regular, size: 8, color: DARK });
        y -= 13;
      });
      y -= 8;
    }

    if (comments?.trim()) {
      drawSubHead('Additional Comments');
      drawTextBlock(comments);
    }
  }

  // ── ACEMQ BROKER ──
  if (services.broker && broker) {
    drawSectionBanner(sn++, 'ACEMQ BROKER SETUP');
    drawSectionHead('Environment & Go-Live Readiness');
    drawKVTable(brokerRows(broker));

    drawSubHead('Repository Access');
    [submitter.email, ...(broker.users || [])].forEach((email, i) => {
      ensureSpace(14);
      if (i % 2 === 0) page.drawRectangle({ x: ML, y: y - 13, width: BW, height: 13, color: ROWALT });
      page.drawLine({ start: { x: ML, y: y - 13 }, end: { x: ML + BW, y: y - 13 }, thickness: 0.4, color: BRDR });
      page.drawText(email, { x: ML + 6, y: y - 8, font: regular, size: 8, color: DARK });
      y -= 13;
    });
    y -= 8;
    drawTextBlock('Each user receives an AceMQ Artifactory login (acemq.jfrog.io) scoped to the AceMQ Broker repository. New users get a temporary password by email and are prompted to change it on first login.');

    if (broker.comments?.trim()) {
      drawSubHead('Additional Comments');
      drawTextBlock(broker.comments);
    }
  }

  // ── SUPPORT ──
  if (services.support) {
    drawSectionBanner(sn++, 'SUPPORT SETUP');
    drawSectionHead('Support Users');

    if (supportUsers?.length) {
      const SC = [BW * 0.28, BW * 0.28, BW * 0.44];
      const SRH = 15;
      ensureSpace(SRH + 2);
      page.drawRectangle({ x: ML, y: y - SRH, width: BW, height: SRH, color: DARK });
      let xo = ML;
      ['First Name', 'Last Name', 'Email'].forEach((h, ci) => {
        page.drawText(h, { x: xo + 4, y: y - SRH + 5, font: bold, size: 7.5, color: WHITE, maxWidth: SC[ci] - 8 });
        xo += SC[ci];
      });
      y -= SRH;
      supportUsers.forEach((u, i) => {
        ensureSpace(SRH + 2);
        if (i % 2 === 1) page.drawRectangle({ x: ML, y: y - SRH, width: BW, height: SRH, color: ROWALT });
        page.drawLine({ start: { x: ML, y: y - SRH }, end: { x: ML + BW, y: y - SRH }, thickness: 0.4, color: BRDR });
        xo = ML;
        [u.firstName || '—', u.lastName || '—', u.email || '—'].forEach((c, ci) => {
          page.drawText(c, { x: xo + 4, y: y - SRH + 5, font: regular, size: 8, color: DARK, maxWidth: SC[ci] - 8 });
          xo += SC[ci];
        });
        y -= SRH;
      });
    } else {
      ensureSpace(18);
      page.drawText('No support users specified.', { x: ML, y, font: regular, size: 8.5, color: LIGHT });
      y -= 16;
    }
  }

  return Buffer.from(await doc.save());
}

// ─────────────────────────────────────────────────────────────────────────────
// JFrog provisioning
//
// Pattern inferred from all existing customers:
//   group:       customer-{slug}
//   permission:  perm-{slug}-rmq-access
//   repos:       ossrabbitmq-rabbitmq-oss, rabbitmq-docker-remote,
//                rabbitmq-helmoci-remote, rabbitmq-operator-docker-remote
//   access:      read + annotate + write
// ─────────────────────────────────────────────────────────────────────────────

const JFROG_REPOS = [
  'ossrabbitmq-rabbitmq-oss',
  'rabbitmq-docker-remote',
  'rabbitmq-helmoci-remote',
  'rabbitmq-operator-docker-remote',
];

// license: per-company group + permission over the Tanzu/OSS repos.
// broker:  one shared, pre-built group in the "AceMQ Broker" JFrog project. Its permission
//          (acemq-broker-customer-read, managed in JFrog) grants read on
//          acemq-broker-releases-local + acemq-broker-docker-local only — staging stays hidden.
const JFROG_PRODUCTS = {
  license: { label: 'RabbitMQ license', groupPrefix: 'customer', permSuffix: 'rmq-access', repos: JFROG_REPOS, actions: ['read', 'write'], attachGuide: true },
  broker:  { label: 'AceMQ Broker', sharedGroup: 'acemq-broker-customers', sharedPerm: 'acemq-broker-customer-read', attachGuide: false },
};

const MAX_JFROG_USERS = 25;
const EMAIL_RE = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;

function slugifyCompany(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function jfrog(method, path, body) {
  const res = await fetch(`${JFROG_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${JFROG_TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function ensureJFrogGroup(groupName) {
  const { status } = await jfrog('GET', `/access/api/v2/groups/${groupName}`);
  if (status === 200) return false; // already existed
  await jfrog('POST', '/access/api/v2/groups', {
    name: groupName,
    description: `Customer access group — ${groupName.replace('customer-', '')}`,
    auto_join: false,
  });
  return true; // newly created
}

async function ensureJFrogPermission(permName, groupName, product) {
  const { status } = await jfrog('GET', `/artifactory/api/v2/security/permissions/${encodeURIComponent(permName)}`);
  if (status === 200) return false; // already existed

  await jfrog('PUT', `/artifactory/api/v2/security/permissions/${encodeURIComponent(permName)}`, {
    name: permName,
    repo: {
      actions: {
        groups: {
          [groupName]: product.actions,
        },
      },
      repositories: product.repos,
      'include-patterns': ['**'],
      'exclude-patterns': [],
    },
  });
  return true; // newly created
}

async function sendJFrogInviteEmail(email, tempPwd, company, product) {
  // tempPwd is null for existing JFrog users — they get access notification without credentials.
  const credRows = tempPwd ? `
          <tr style="border-top:1px solid #eee;">
            <td style="padding:12px 16px;font-size:13px;color:#666;">Temp Password</td>
            <td style="padding:12px 16px;font-size:14px;font-family:monospace;letter-spacing:1px;">${tempPwd}</td>
          </tr>` : '';
  const postLoginNote = tempPwd
    ? `<p style="margin:20px 0 0;font-size:13px;color:#888;line-height:1.5;">You will be prompted to change your password after your first login.</p>`
    : `<p style="margin:20px 0 0;font-size:13px;color:#888;line-height:1.5;">Log in with your existing AceMQ Artifactory credentials. The pull guide attached to this email has step-by-step instructions.</p>`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;">
      <div style="background:#FF6B00;padding:24px 32px;">
        <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:1px;">AceMQ</span>
      </div>
      <div style="padding:32px;">
        <h2 style="margin:0 0 16px;font-size:22px;">Your ${product.label} Artifact Access is Ready</h2>
        <p style="margin:0 0 20px;line-height:1.6;">
          Your account on the AceMQ JFrog Artifactory platform has been provisioned as part of
          the <strong>${company}</strong> ${product.label} onboarding. You now have access to the
          ${product.label} repositories.
        </p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;background:#f8f8f8;border-radius:6px;">
          <tr>
            <td style="padding:12px 16px;font-size:13px;color:#666;width:120px;">Platform</td>
            <td style="padding:12px 16px;font-size:14px;"><a href="https://acemq.jfrog.io" style="color:#FF6B00;">acemq.jfrog.io</a></td>
          </tr>
          <tr style="border-top:1px solid #eee;">
            <td style="padding:12px 16px;font-size:13px;color:#666;">Username</td>
            <td style="padding:12px 16px;font-size:14px;font-family:monospace;">${email}</td>
          </tr>
          ${credRows}
        </table>
        <a href="https://acemq.jfrog.io" style="display:inline-block;background:#FF6B00;color:#fff;text-decoration:none;padding:12px 28px;border-radius:4px;font-weight:700;font-size:15px;">
          Log In to AceMQ Artifactory →
        </a>
        ${postLoginNote}
        <hr style="margin:32px 0;border:none;border-top:1px solid #eee;">
        <p style="margin:0;font-size:13px;color:#888;">
          AceMQ · an ace8 company<br>
          Questions? Contact <a href="mailto:support@acemq.com" style="color:#FF6B00;">support@acemq.com</a>
        </p>
      </div>
    </div>`;

  let guidePdf = null;
  if (product.attachGuide) try {
    const guidePath = path.join(process.cwd(), 'public', 'AceMQ-JFrog-RabbitMQ-Pull-Guide.pdf');
    guidePdf = fs.readFileSync(guidePath).toString('base64');
  } catch (_) {}

  await sendMailjetEmail({
    toEmail:     email,
    toName:      email,
    subject:     `Your ${product.label} Artifact Access is Ready`,
    html,
    pdfBase64:   guidePdf,
    pdfFilename: 'AceMQ-JFrog-RabbitMQ-Pull-Guide.pdf',
  });
}

async function provisionJFrogUser(email, groupName, company, product) {
  const username = email.toLowerCase().trim();
  const { status, data } = await jfrog('GET', `/access/api/v2/users/${encodeURIComponent(username)}`);

  if (status === 200) {
    // User exists — add to group (merge with existing groups)
    const existingGroups = data.groups || [];
    const groups = [...new Set([...existingGroups, groupName])];
    const patchRes = await jfrog('PATCH', `/access/api/v2/users/${encodeURIComponent(username)}`, { groups });
    if (patchRes.status >= 400) {
      throw new Error(`PATCH failed (${patchRes.status}): ${JSON.stringify(patchRes.data)}`);
    }
    // Existing users still need the access email + pull guide — they're getting new repo access
    await sendJFrogInviteEmail(username, null, company, product);
    return 'updated';
  } else {
    // New user — create with a temporary password and send credentials via email
    const tempPwd = require('crypto').randomBytes(10).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) + 'Aa1!';
    const createRes = await jfrog('POST', '/access/api/v2/users', {
      username,
      email: username,
      password: tempPwd,
      groups: [groupName],
      realm: 'internal',
      profileUpdatable: true,
      disableUIAccess: false,
    });
    if (createRes.status >= 400) {
      throw new Error(`Create user failed (${createRes.status}): ${JSON.stringify(createRes.data)}`);
    }
    await sendJFrogInviteEmail(username, tempPwd, company, product);
    return 'invited';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Jira Service Management helpers
// ─────────────────────────────────────────────────────────────────────────────

function jiraAuth() {
  return 'Basic ' + Buffer.from(`${JIRA_EMAIL_ADDR}:${JIRA_API_TOKEN}`).toString('base64');
}

async function jira(method, path, body) {
  const res = await fetch(`${JIRA_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: jiraAuth(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-ExperimentalApi': 'opt-in',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  return { status: res.status, data };
}

async function findJSMOrg(companyName) {
  // Pages through all orgs on the service desk looking for a name match
  let start = 0;
  while (true) {
    const { data } = await jira('GET', `/rest/servicedeskapi/servicedesk/${JIRA_SERVICE_DESK_ID}/organization?start=${start}&limit=50`);
    const values = data?.values || [];
    const match = values.find(o => o.name.toLowerCase() === companyName.toLowerCase());
    if (match) return match;
    if (data?.isLastPage || values.length === 0) return null;
    start += values.length;
  }
}

async function createJSMOrg(companyName) {
  // Create org then associate it with the service desk
  const { data: org } = await jira('POST', '/rest/servicedeskapi/organization', { name: companyName });
  await jira('POST', `/rest/servicedeskapi/servicedesk/${JIRA_SERVICE_DESK_ID}/organization`, { organizationId: org.id });
  return org;
}

async function resolveJSMAccountId(email, fullName) {
  // Search for existing Atlassian account
  const { data } = await jira('GET', `/rest/api/3/user/search?query=${encodeURIComponent(email)}&maxResults=1`);
  if (Array.isArray(data) && data.length > 0) return data[0].accountId;

  // Not found — create as a JSM portal customer (triggers Atlassian invite email)
  const { data: customer } = await jira('POST', '/rest/servicedeskapi/customer', {
    email,
    fullName: fullName || email,
  });
  return customer?.accountId || null;
}

async function addUsersToJSMOrg(orgId, users) {
  // users: array of { email, fullName } or plain email strings
  const normalized = users.map(u => typeof u === 'string' ? { email: u, fullName: u } : u);
  const accountIds = (await Promise.all(normalized.map(u => resolveJSMAccountId(u.email, u.fullName)))).filter(Boolean);
  if (accountIds.length === 0) return;
  await jira('POST', `/rest/servicedeskapi/organization/${orgId}/user`, { accountIds });
}

async function provisionJSMAccess({ company, submitterEmail, portalUsers, supportUsers }) {
  // Combine portal users (from license section) and support users (from support section),
  // deduplicating by email so no one is added twice.
  const seen = new Set();
  const users = [];
  const add = (email, fullName) => {
    const e = (email || '').toLowerCase().trim();
    if (!e || seen.has(e)) return;
    seen.add(e);
    users.push({ email: e, fullName: fullName || e });
  };

  add(submitterEmail);
  (portalUsers || []).forEach(e => add(e));
  (supportUsers || []).forEach(u => add(u.email, `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email));

  const emails = users.map(u => u.email);

  let org = await findJSMOrg(company);
  const orgCreated = !org;
  if (!org) {
    org = await createJSMOrg(company);
  }

  await addUsersToJSMOrg(org.id, users);

  return { orgId: org.id, orgName: org.name, orgCreated, usersAdded: emails };
}

// ─────────────────────────────────────────────────────────────────────────────
// FuseBase portal provisioning (via Gate MCP HTTP/SSE)
// ─────────────────────────────────────────────────────────────────────────────

async function fusebaseInit() {
  const res = await fetch(FUSEBASE_MCP_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${FUSEBASE_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 'init', method: 'initialize',
      params: {
        protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 'acemq-onboarding', version: '1.0' },
      },
    }),
  });
  const sessionId = res.headers.get('mcp-session-id');
  if (!sessionId) throw new Error('FuseBase: no MCP session ID returned');
  return sessionId;
}

async function fusebaseTool(sessionId, opId, args) {
  const res = await fetch(FUSEBASE_MCP_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${FUSEBASE_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: opId, method: 'tools/call',
      params: { name: 'tool_call', arguments: { opId, args } },
    }),
  });

  const text = await res.text();
  const match = text.match(/^data: (.+)$/m);
  if (!match) throw new Error(`FuseBase ${opId}: unexpected response format`);

  const envelope = JSON.parse(match[1]);
  if (envelope.result?.isError) {
    const msg = envelope.result.content?.[0]?.text || 'unknown error';
    throw new Error(`FuseBase ${opId}: ${msg}`);
  }

  const raw = JSON.parse(envelope.result?.content?.[0]?.text || '{}');
  if (!raw.ok) throw new Error(`FuseBase ${opId} failed: ${JSON.stringify(raw.error)}`);
  return raw.data;
}

async function provisionFuseBasePortal({ company, engagementParticipants, submitterEmail, submitterName }) {
  const slug   = slugifyCompany(company);
  const domain = `${slug}.portal.acemq.com`;

  const sessionId = await fusebaseInit();

  // 1. New workspace — each portal needs its own
  const ws = await fusebaseTool(sessionId, 'createWorkspace', {
    orgId: FUSEBASE_ORG_ID,
    body: { title: `${company} - Internal Space` },
  });

  // 2. Duplicate master portal into the new workspace
  // duplicatePortal returns { portal: { id, domain, ... } }
  const { portal } = await fusebaseTool(sessionId, 'duplicatePortal', {
    orgId:    FUSEBASE_ORG_ID,
    portalId: FUSEBASE_MASTER_PORTAL_ID,
    body: { domain, workspaceId: ws.id, name: `${company} - Engagement Portal` },
  });

  // 3. Invite all engagement users as clients with full access
  const seen = new Set();
  const invitations = [];
  const addInvitee = (email, fullName) => {
    const e = (email || '').toLowerCase().trim();
    if (!e || seen.has(e)) return;
    seen.add(e);
    invitations.push({ email: e, fullName: fullName?.trim() || e, orgRole: 'client', isFullAccess: true });
  };

  addInvitee(submitterEmail, submitterName);
  (engagementParticipants || []).forEach(p =>
    addInvitee(p.email, `${p.firstName || ''} ${p.lastName || ''}`)
  );

  if (invitations.length > 0) {
    await fusebaseTool(sessionId, 'bulkInviteToPortal', {
      orgId:    FUSEBASE_ORG_ID,
      portalId: portal.id,
      body: { invitations, background: false },
    });
  }

  return { domain, workspaceId: ws.id, portalId: portal.id, usersInvited: invitations.length };
}

async function provisionJFrogAccess({ company, submitterEmail, portalUsers, kind = 'license' }) {
  const product   = JFROG_PRODUCTS[kind];
  const slug      = slugifyCompany(company);
  const groupName = product.sharedGroup || `${product.groupPrefix}-${slug}`;
  const permName  = product.sharedPerm  || `perm-${slug}-${product.permSuffix}`;

  // Shared groups are managed in JFrog; per-company ones are created here.
  // Group must exist before creating the permission target that references it.
  const groupCreated = product.sharedGroup ? false : await ensureJFrogGroup(groupName);
  const permCreated  = product.sharedGroup ? false : await ensureJFrogPermission(permName, groupName, product);

  // Emails become JFrog usernames and URL segments — reject anything that isn't a plain address.
  const all     = [...new Set([submitterEmail, ...(portalUsers || [])].map(e => String(e || '').toLowerCase().trim()))].filter(Boolean);
  const emails  = all.filter(e => EMAIL_RE.test(e));
  // Public form: cap how many accounts + emails one submission can create.
  if (emails.length > MAX_JFROG_USERS) throw new Error(`Too many users (${emails.length}); max ${MAX_JFROG_USERS} per submission`);
  const results = await Promise.allSettled(emails.map(e => provisionJFrogUser(e, groupName, company, product)));

  const invited = [], updated = [], failed = all.filter(e => !EMAIL_RE.test(e)).map(e => `${e}: invalid email`);
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      (r.value === 'invited' ? invited : updated).push(emails[i]);
    } else {
      failed.push(`${emails[i]}: ${r.reason?.message}`);
    }
  });

  return { groupName, permName, groupCreated, permCreated, invited, updated, failed };
}

// ─────────────────────────────────────────────────────────────────────────────
// ClickUp — onboarding pipeline tasks
// ─────────────────────────────────────────────────────────────────────────────

async function clickup(method, endpoint, body) {
  const res = await fetch(`https://api.clickup.com/api/v2${endpoint}`, {
    method,
    headers: { Authorization: CLICKUP_TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status >= 400) throw new Error(`ClickUp ${method} ${endpoint} failed (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

// Finds the task named after `company` in the list (any status, case-insensitive) and
// moves it to "onboarding"; creates it in "onboarding" if no matching task exists yet.
async function upsertOnboardingTask(listId, company) {
  const { tasks = [] } = await clickup('GET', `/list/${listId}/task?include_closed=true&subtasks=true`);
  const match = tasks.find(t => t.name.trim().toLowerCase() === company.trim().toLowerCase());
  if (match) {
    await clickup('PUT', `/task/${match.id}`, { status: 'onboarding' });
    return { action: 'moved', taskId: match.id };
  }
  const created = await clickup('POST', `/list/${listId}/task`, { name: company, status: 'onboarding' });
  return { action: 'created', taskId: created.id };
}

async function syncClickUpPipelines({ company, services }) {
  const results = {};
  const selected = Object.entries(CLICKUP_LISTS).filter(([key]) => services[key]);
  for (const [key, listId] of selected) {
    results[key] = await upsertOnboardingTask(listId, company);
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      submitter, company, services,
      engagementParticipants,
      kickoffDate, teamTimezone, schedulingPref, timeSlotPref, engagementDescription,
      technical, envUse, packaging, comments, portalUsers, supportUsers, broker,
    } = body;

    if (!submitter?.email || !company) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const errors = [];

    // HubSpot CRM
    if (HS_TOKEN) {
      try {
        const [contactId, companyId] = await Promise.all([
          upsertContact(submitter, company),
          findOrCreateCompany(company),
        ]);

        if (contactId && companyId) {
          await associateContactToCompany(contactId, companyId);
        }

        const noteBody = buildNoteBody({
          submitter, company, services,
          engagementParticipants, kickoffDate, teamTimezone, schedulingPref,
          engagementDescription, technical, envUse, packaging, comments, portalUsers, supportUsers, broker,
        });

        if (contactId) {
          await createEngagementNote(contactId, companyId, noteBody);
        }

        await submitHubSpotForm(submitter, company, services, {
          technical, envUse, packaging, portalUsers, comments,
          kickoffDate, teamTimezone, schedulingPref, engagementDescription, broker,
        });
      } catch (hsErr) {
        console.error('HubSpot error:', hsErr);
        errors.push(`HubSpot: ${hsErr.message}`);
      }
    }

    // Generate PDF server-side
    let pdfBuffer = null;
    let pdfBase64 = null;
    try {
      pdfBuffer = await buildReportPdf({
        submitter, company, services,
        engagementParticipants, kickoffDate, teamTimezone, schedulingPref, timeSlotPref, engagementDescription,
        technical, envUse, packaging, comments, portalUsers, supportUsers, broker,
      });
      pdfBase64 = pdfBuffer.toString('base64');
    } catch (pdfErr) {
      console.error('PDF build error:', pdfErr);
      errors.push(`PDF: ${pdfErr.message}`);
    }

    const reportFilename = `AceMQ-Onboarding-${company.replace(/\s+/g, '-')}.pdf`;

    // ── Customer confirmation email (send early — doesn't depend on provisioning results) ──
    try {
      const customerAtts = [];
      if (pdfBase64) customerAtts.push({ base64: pdfBase64, filename: reportFilename });
      if (services.license) {
        try {
          const guidePath = path.join(process.cwd(), 'public', 'AceMQ-JFrog-RabbitMQ-Pull-Guide.pdf');
          customerAtts.push({ base64: fs.readFileSync(guidePath).toString('base64'), filename: 'AceMQ-JFrog-RabbitMQ-Pull-Guide.pdf' });
        } catch (_) {}
      }
      const submitterName = `${submitter.firstName} ${submitter.lastName}`.trim();
      await sendMailjetEmail({
        toEmail:     submitter.email,
        toName:      submitterName,
        subject:     `Your AceMQ Onboarding is Confirmed — ${company}`,
        html:        buildCustomerEmailHtml({
          submitter, company, services,
          engagementParticipants, kickoffDate, teamTimezone, schedulingPref,
          technical, envUse, packaging, portalUsers, supportUsers, broker,
        }),
        attachments: customerAtts,
      });
    } catch (custMjErr) {
      console.error('Customer confirmation email error:', custMjErr);
      errors.push(`CustomerEmail: ${custMjErr.message}`);
    }

    // ── Provisioning — collect all results before sending internal email ──

    let fusebaseResult = null, fusebaseError = null;
    let jfrogResult    = null, jfrogError    = null;
    let jsmResult      = null, jsmError      = null;
    let clickupResult  = null, clickupError  = null;
    let brokerJfrogResult = null, brokerJfrogError = null;

    // ClickUp — move/create the onboarding pipeline task for each selected service
    if (CLICKUP_TOKEN) {
      try {
        clickupResult = await syncClickUpPipelines({ company, services });
        console.log('ClickUp:', clickupResult);
      } catch (cuErr) {
        console.error('ClickUp sync error:', cuErr);
        clickupError = cuErr.message;
        errors.push(`ClickUp: ${cuErr.message}`);
      }
    }

    // FuseBase — engagement portal
    if (services.engagement && FUSEBASE_TOKEN) {
      try {
        fusebaseResult = await provisionFuseBasePortal({
          company,
          engagementParticipants: engagementParticipants || [],
          submitterEmail: submitter.email,
          submitterName: `${submitter.firstName} ${submitter.lastName}`.trim(),
        });
        console.log(`FuseBase: portal=${fusebaseResult.domain} portalId=${fusebaseResult.portalId} users=${fusebaseResult.usersInvited}`);
      } catch (fbErr) {
        console.error('FuseBase portal provisioning error:', fbErr);
        fusebaseError = fbErr.message;
        errors.push(`FuseBase: ${fbErr.message}`);
      }
    }

    // JFrog — license artifact access
    if (services.license && JFROG_TOKEN) {
      try {
        jfrogResult = await provisionJFrogAccess({
          company,
          submitterEmail: submitter.email,
          portalUsers: portalUsers || [],
        });
        jfrogResult.failed.forEach(f => errors.push(`JFrog: ${f}`));
        console.log(`JFrog: group=${jfrogResult.groupName} invited=${jfrogResult.invited.length} updated=${jfrogResult.updated.length} failed=${jfrogResult.failed.length}`);
      } catch (jfErr) {
        console.error('JFrog provisioning error:', jfErr);
        jfrogError = jfErr.message;
        errors.push(`JFrog: ${jfErr.message}`);
      }
    }

    // JFrog — AceMQ Broker repo access (separate group + permission from licensing)
    if (services.broker && JFROG_TOKEN) {
      try {
        brokerJfrogResult = await provisionJFrogAccess({
          company,
          submitterEmail: submitter.email,
          portalUsers: broker?.users || [],
          kind: 'broker',
        });
        brokerJfrogResult.failed.forEach(f => errors.push(`JFrog Broker: ${f}`));
        console.log(`JFrog Broker: group=${brokerJfrogResult.groupName} invited=${brokerJfrogResult.invited.length} updated=${brokerJfrogResult.updated.length} failed=${brokerJfrogResult.failed.length}`);
      } catch (bjErr) {
        console.error('JFrog broker provisioning error:', bjErr);
        brokerJfrogError = bjErr.message;
        errors.push(`JFrog Broker: ${bjErr.message}`);
      }
    }

    // JSM — support + license portal access
    if ((services.license || services.support) && JIRA_API_TOKEN) {
      try {
        jsmResult = await provisionJSMAccess({
          company,
          submitterEmail: submitter.email,
          portalUsers: portalUsers || [],
          supportUsers: supportUsers || [],
        });
        console.log(`JSM: org="${jsmResult.orgName}" id=${jsmResult.orgId} created=${jsmResult.orgCreated} users=${jsmResult.usersAdded.length}`);
      } catch (jsmErr) {
        console.error('JSM provisioning error:', jsmErr);
        jsmError = jsmErr.message;
        errors.push(`JSM: ${jsmErr.message}`);
      }
    }

    // ── Internal team email — one comprehensive email with all results ──
    try {
      const selectedServices = [
        services.engagement && 'Engagement',
        services.license    && 'License',
        services.support    && 'Support',
        services.broker     && 'AceMQ Broker',
      ].filter(Boolean).join(' + ');

      await sendMailjetEmail({
        toEmail:     'onboarding@acemq.com',
        toName:      'AceMQ Onboarding Team',
        subject:     `New Onboarding — ${company} (${selectedServices})`,
        html:        buildInternalEmailHtml({
          submitter, company, services,
          engagementParticipants, kickoffDate, teamTimezone, schedulingPref,
          technical, envUse, packaging, portalUsers, supportUsers,
          fusebaseResult, fusebaseError,
          jfrogResult, jfrogError,
          jsmResult, jsmError,
          broker, brokerJfrogResult, brokerJfrogError,
          pdfGenerated: !!pdfBase64,
        }),
        pdfBase64,
        pdfFilename: reportFilename,
      });
    } catch (mjErr) {
      console.error('Internal email error:', mjErr);
      errors.push(`InternalEmail: ${mjErr.message}`);
    }

    return NextResponse.json({
      ok: true,
      pdfBase64,
      warnings: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('Submit error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
