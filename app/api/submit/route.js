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
    ['License Type',       b.licenseType === 'commercial' ? 'Commercial (paying customer)' : 'Evaluation / NFR trial'],
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
// Email brand kit ("ace26"). Table layout + inline CSS only, no SVG / web fonts,
// 600px max, safe for Gmail and Outlook. Shared by every outgoing email.
// ─────────────────────────────────────────────────────────────────────────────

const EM = {
  ink: '#121316', body: '#1F2125', sec: '#5F6670', muted: '#757B85',
  hair: '#E9EBEE', ctl: '#DDE0E4', alt: '#F6F6F7', s2: '#FAFAFB',
  orange: '#FF6600', accent: '#BF4D00', tint: '#FFF5EC', tint2: '#FFE8D6',
  tealText: '#236B61', tealTint: '#E3F4F1',
  red: '#C0392B', redText: '#9B2C1F', redTint: '#FDECEA',
};
const EM_FONT = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const EMF = `font-family:${EM_FONT};`;
const EM_LOGO = 'https://onboarding.acemq.com/redesign/logo.png';
const EM_TBL = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"';

// Vertical spacer (table based so Outlook honours it).
const emGap = (n) => `<table ${EM_TBL}><tr><td height="${n}" style="height:${n}px;line-height:${n}px;font-size:0;mso-line-height-rule:exactly;">&nbsp;</td></tr></table>`;

// Eyebrow: 24px orange dash + uppercase 12px accent label.
const emEyebrow = (text) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
  <td width="24" valign="middle" style="width:24px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="24"><tr><td height="2" bgcolor="${EM.orange}" style="height:2px;line-height:2px;font-size:0;mso-line-height-rule:exactly;background:${EM.orange};">&nbsp;</td></tr></table></td>
  <td valign="middle" style="padding-left:10px;${EMF}font-size:12px;line-height:16px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:${EM.accent};">${text}</td>
</tr></table>`;

const emH1 = (html, size = 30) => `<h1 style="margin:0;${EMF}font-size:${size}px;line-height:1.15;font-weight:800;letter-spacing:-0.02em;color:${EM.ink};">${html}</h1>`;
const emSub = (html) => `<p style="margin:0 0 8px;${EMF}font-size:14px;line-height:20px;font-weight:700;letter-spacing:-0.005em;color:${EM.ink};">${html}</p>`;
const emDivider = () => `${emGap(28)}<table ${EM_TBL}><tr><td height="1" bgcolor="${EM.hair}" style="height:1px;line-height:1px;font-size:0;background:${EM.hair};">&nbsp;</td></tr></table>${emGap(28)}`;

// Section label row: eyebrow on the left, optional status pill on the right.
const emSectionHead = (label, statusHtml) => `
<table ${EM_TBL}><tr>
  <td valign="middle">${emEyebrow(label)}</td>
  ${statusHtml ? `<td valign="middle" align="right" style="${EMF}">${statusHtml}</td>` : ''}
</tr></table>`;

const emPill = (label, bg, fg) => `<span style="display:inline-block;background:${bg};color:${fg};border-radius:999px;padding:3px 10px;${EMF}font-size:11px;line-height:16px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;">${label}</span>`;

// Hairline data table wrapper + header / cell helpers.
const emTable = (inner) => `<table ${EM_TBL} style="border-collapse:collapse;border-top:1px solid ${EM.hair};">${inner}</table>`;
const emHead = (labels) => `<tr>${labels.map(l => `<td valign="bottom" style="padding:10px 12px 10px 0;border-bottom:1px solid ${EM.ctl};${EMF}font-size:11px;line-height:16px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:${EM.muted};">${l}</td>`).join('')}</tr>`;
const emTd = (html, extra = '') => `<td valign="top" style="padding:10px 12px 10px 0;border-bottom:1px solid ${EM.hair};${EMF}font-size:13px;line-height:19px;color:${EM.ink};word-break:break-word;${extra}">${html}</td>`;
const emAccent = `color:${EM.accent};`;

// Soft tile (rounded, hairline border, very faint fill) around a nested key/value table.
const emTile = (inner) => `
<table ${EM_TBL} bgcolor="${EM.s2}" style="background:${EM.s2};border:1px solid ${EM.hair};border-radius:12px;border-collapse:separate;border-spacing:0;">
  <tr><td style="padding:4px 20px;"><table ${EM_TBL} style="border-collapse:collapse;">${inner}</table></td></tr>
</table>`;

const emCallout = (inner) => `
<table ${EM_TBL} bgcolor="${EM.tint}" style="background:${EM.tint};border:1px solid ${EM.tint2};border-radius:12px;border-collapse:separate;border-spacing:0;">
  <tr><td style="padding:16px 20px;${EMF}font-size:14px;line-height:22px;color:${EM.body};">${inner}</td></tr>
</table>`;

// Bulletproof orange pill button.
const emButton = (href, label) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
  <td bgcolor="${EM.orange}" style="background:${EM.orange};border-radius:999px;">
    <a href="${href}" style="display:inline-block;padding:13px 28px;${EMF}font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">${label}</a>
  </td>
</tr></table>`;

// Footer: hairline, small secondary text, accent links. `lines` = array of HTML strings.
const emFooter = (lines) => `
<tr><td class="px" style="padding:0 40px 32px;">
  <table ${EM_TBL}>
    <tr><td height="1" bgcolor="${EM.hair}" style="height:1px;line-height:1px;font-size:0;background:${EM.hair};">&nbsp;</td></tr>
    <tr><td style="padding-top:18px;${EMF}font-size:12px;line-height:19px;color:${EM.sec};">${lines.join('<br>')}</td></tr>
  </table>
</td></tr>`;
const emLink = (href, text) => `<a href="${href}" style="color:${EM.accent};text-decoration:none;">${text}</a>`;

// Page chrome: grey page, white hairline card, 3px orange top rule, logo header row.
function emShell({ body, footerLines, ruleColor = EM.orange }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>AceMQ</title>
<style>@media only screen and (max-width:620px){.px{padding-left:22px!important;padding-right:22px!important;}}</style>
</head>
<body style="margin:0;padding:0;background:${EM.alt};${EMF}color:${EM.body};-webkit-text-size-adjust:100%;">
<table ${EM_TBL} bgcolor="${EM.alt}" style="background:${EM.alt};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
      <tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid ${EM.hair};border-radius:20px;overflow:hidden;box-shadow:0 1px 2px rgba(18,19,22,.04),0 8px 24px rgba(18,19,22,.04);">
        <table ${EM_TBL}>
          <tr><td height="3" bgcolor="${ruleColor}" style="height:3px;line-height:3px;font-size:0;mso-line-height-rule:exactly;background:${ruleColor};">&nbsp;</td></tr>
          <tr><td class="px" style="padding:24px 40px;border-bottom:1px solid ${EM.hair};">
            <table ${EM_TBL}><tr>
              <td valign="middle"><img src="${EM_LOGO}" width="113" height="31" alt="AceMQ" style="display:block;border:0;"></td>
              <td valign="middle" align="right" style="${EMF}font-size:11px;line-height:16px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:${EM.muted};">THE #1 RABBITMQ PARTNER</td>
            </tr></table>
          </td></tr>
          ${body}
          ${emFooter(footerLines)}
        </table>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
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

  const ok  = (label) => emPill(label, EM.tealTint, EM.tealText);
  const err = (label) => emPill(label, EM.redTint, EM.redText);
  const na  = (label) => emPill(label, EM.alt, EM.sec);

  // `alt` is kept for call-site compatibility; the brand kit uses hairlines, not zebra fills.
  const row = (label, value, alt, noLine) => `
    <tr>
      <td valign="top" style="padding:11px 16px 11px 0;${noLine ? '' : `border-bottom:1px solid ${EM.hair};`}${EMF}font-size:11px;line-height:20px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:${EM.muted};width:38%;">${label}</td>
      <td valign="top" style="padding:11px 0;${noLine ? '' : `border-bottom:1px solid ${EM.hair};`}${EMF}font-size:14px;line-height:20px;color:${EM.ink};word-break:break-word;">${value}</td>
    </tr>`;

  let sections = '';

  // ── ENGAGEMENT ──
  if (services.engagement) {
    const status = fusebaseError ? err('Error') : fusebaseResult ? ok('Provisioned') : na('Skipped');
    const leadRow = { firstName: submitter.firstName, lastName: submitter.lastName, title: submitter.jobTitle || '', email: submitter.email, role: 'Lead Stakeholder' };
    const allParticipants = [leadRow, ...(engagementParticipants || [])];
    const participantRows = allParticipants.map((p) => `
      <tr>
        ${emTd(`${p.firstName || ''} ${p.lastName || ''}`)}
        ${emTd(p.title || p.jobTitle || '—', `color:${EM.sec};`)}
        ${emTd(String(p.email).replace('@', '@<wbr>'), emAccent)}
        ${emTd(p.role || '—')}
      </tr>`).join('');

    sections += `${sections ? emDivider() : ''}
    <div>
      ${emSectionHead('🤝 Engagement', status)}
      ${emGap(12)}
      ${emTable(`
        ${row('Portal Domain', fusebaseResult ? `<a href="https://${fusebaseResult.domain}" style="color:${EM.accent};text-decoration:none;">${fusebaseResult.domain}</a>` : '—', false)}
        ${row('Users Invited', fusebaseResult ? String(fusebaseResult.usersInvited) : '—', true)}
        ${kickoffDate ? row('Kickoff Date', kickoffDate, false) : ''}
        ${teamTimezone ? row('Timezone', teamTimezone, true) : ''}
        ${schedulingPref ? row('Scheduling', schedulingPref, false) : ''}
        ${fusebaseError ? row('Error', `<span style="color:${EM.redText};">${fusebaseError}</span>`, true) : ''}
      `)}
      ${emGap(22)}
      ${emSub(`Participants (${allParticipants.length})`)}
      ${emTable(`
        ${emHead(['Name', 'Title', 'Email', 'Role'])}
        ${participantRows}
      `)}
    </div>`;
  }

  // ── LICENSE ──
  if (services.license) {
    const jfrogStatus = jfrogError ? err('Error') : jfrogResult ? ok('Provisioned') : na('Skipped');
    const jsmStatus   = jsmError   ? err('Error') : jsmResult   ? ok('Provisioned') : na('Skipped');

    const allJFrogUsers = [...(jfrogResult?.invited || []), ...(jfrogResult?.updated || [])];
    const jfrogUserRows = allJFrogUsers.map((e) => `
      <tr>
        ${emTd(e, emAccent)}
        ${emTd(jfrogResult?.invited?.includes(e) ? '(invited — new account)' : '(added to group)', `font-size:12px;color:${EM.sec};`)}
      </tr>`).join('');
    const jfrogFailRows = (jfrogResult?.failed || []).map(f => `
      <tr><td colspan="2" style="padding:10px 12px;border-bottom:1px solid ${EM.hair};background:${EM.redTint};${EMF}font-size:13px;line-height:19px;color:${EM.redText};">${f}</td></tr>`).join('');

    sections += `${sections ? emDivider() : ''}
    <div>
      ${emSectionHead('🔑 License')}
      ${emGap(14)}

      <!-- JFrog -->
      ${emSub(`JFrog Artifactory &nbsp;${jfrogStatus}`)}
      ${emTable(`
        ${row('Group', jfrogResult?.groupName || '—', false)}
        ${row('Permission Target', jfrogResult?.permName || '—', true)}
        ${row('Group Created', jfrogResult ? (jfrogResult.groupCreated ? 'Yes (new)' : 'No (existing)') : '—', false)}
        ${row('Perm Created', jfrogResult ? (jfrogResult.permCreated ? 'Yes (new)' : 'No (existing)') : '—', true)}
        ${jfrogError ? row('Error', `<span style="color:${EM.redText};">${jfrogError}</span>`, false) : ''}
      `)}
      ${allJFrogUsers.length > 0 ? `
      ${emGap(14)}
      ${emTable(`
        ${emHead(['Email', 'Status'])}
        ${jfrogUserRows}
        ${jfrogFailRows}
      `)}` : ''}
      ${emGap(22)}

      <!-- Technical details -->
      ${emSub('Technical Configuration')}
      ${emTable(`
        ${technical?.rmqProduct    ? row('RabbitMQ Product', technical.rmqProduct, false) : ''}
        ${technical?.cpuCoreCount  ? row('CPU Cores', `${technical.cpuCoreCount} ${technical.cpuCoreType || ''}`.trim(), true) : ''}
        ${technical?.deploymentEnv ? row('Deployment', technical.deploymentEnv, false) : ''}
        ${envUse?.length           ? row('Environment Use', envUse.join(', '), true) : ''}
        ${packaging?.length        ? row('Packaging', packaging.join(', '), false) : ''}
      `)}
      ${emGap(22)}

      <!-- JSM -->
      ${emSub(`Jira Service Management &nbsp;${jsmStatus}`)}
      ${emTable(`
        ${row('Org Name', jsmResult?.orgName || '—', false)}
        ${row('Org ID', jsmResult?.orgId || '—', true)}
        ${row('Org Created', jsmResult ? (jsmResult.orgCreated ? 'Yes (new)' : 'No (existing)') : '—', false)}
        ${row('Users Added', jsmResult ? String(jsmResult.usersAdded?.length || 0) : '—', true)}
        ${jsmError ? row('Error', `<span style="color:${EM.redText};">${jsmError}</span>`, false) : ''}
      `)}
    </div>`;
  }

  // ── SUPPORT ──
  if (services.support) {
    const jsmStatus = jsmError ? err('Error') : jsmResult ? ok('Provisioned') : na('Skipped');
    const supportUserRows = (supportUsers || []).map((u) => `
      <tr>
        ${emTd(`${u.firstName || ''} ${u.lastName || ''}`)}
        ${emTd(u.email, emAccent)}
      </tr>`).join('');

    sections += `${sections ? emDivider() : ''}
    <div>
      ${emSectionHead('🎫 Support', jsmStatus)}
      ${emGap(12)}
      ${emTable(`
        ${row('Org Name', jsmResult?.orgName || '—', false)}
        ${row('Users Added', jsmResult ? String(jsmResult.usersAdded?.length || 0) : '—', true)}
        ${jsmError ? row('Error', `<span style="color:${EM.redText};">${jsmError}</span>`, false) : ''}
      `)}
      ${supportUsers?.length > 0 ? `
      ${emGap(14)}
      ${emTable(`
        ${emHead(['Name', 'Email'])}
        ${supportUserRows}
      `)}` : ''}
    </div>`;
  }

  // ── ACEMQ BROKER ──
  if (services.broker) {
    const status = brokerJfrogError ? err('Error') : brokerJfrogResult ? ok('Provisioned') : na('Skipped');
    const users  = [...(brokerJfrogResult?.invited || []), ...(brokerJfrogResult?.updated || [])];
    const userRows = users.map((e) => `
      <tr>
        ${emTd(esc(e), emAccent)}
        ${emTd(brokerJfrogResult.invited.includes(e) ? '(invited — new account)' : '(added to group)', `font-size:12px;color:${EM.sec};`)}
      </tr>`).join('');
    const failRows = (brokerJfrogResult?.failed || []).map(f => `
      <tr><td colspan="2" style="padding:10px 12px;border-bottom:1px solid ${EM.hair};background:${EM.redTint};${EMF}font-size:13px;line-height:19px;color:${EM.redText};">${esc(f)}</td></tr>`).join('');

    sections += `${sections ? emDivider() : ''}
    <div>
      ${emSectionHead('📦 AceMQ Broker')}
      ${emGap(14)}
      ${emSub(`JFrog Artifactory &nbsp;${status}`)}
      ${emTable(`
        ${row('Group', esc(brokerJfrogResult?.groupName || '—'), false)}
        ${row('Permission Target', esc(brokerJfrogResult?.permName || '—'), true)}
        ${brokerJfrogError ? row('Error', `<span style="color:${EM.redText};">${esc(brokerJfrogError)}</span>`, false) : ''}
      `)}
      ${users.length || failRows ? `
      ${emGap(14)}
      ${emTable(`
        ${emHead(['Email', 'Status'])}
        ${userRows}${failRows}
      `)}` : ''}
      ${emGap(22)}
      ${emSub('Environment &amp; Go-Live')}
      ${emTable(`
        ${brokerRows(broker).map(([l, v], i) => row(l, esc(v), i % 2 === 1)).join('')}
        ${broker?.comments ? row('Comments', esc(broker.comments), false) : ''}
      `)}
    </div>`;
  }

  const hasErrors = fusebaseError || jfrogError || jsmError || brokerJfrogError;

  const summary = [
    ['Submitter', `${submitter.firstName} ${submitter.lastName} &lt;${submitter.email}&gt;`],
    submitter.jobTitle && ['Title', submitter.jobTitle],
    submitter.phone    && ['Phone', submitter.phone],
    ['Services', svcList],
    ['Report PDF', pdfGenerated ? ok('Attached') : err('Failed')],
    ['Overall Status', hasErrors ? err('Errors — review below') : ok('All systems provisioned')],
  ].filter(Boolean).map(([l, v], i, a) => row(l, v, false, i === a.length - 1)).join('');

  return emShell({
    ruleColor: hasErrors ? EM.red : EM.orange,
    footerLines: [
      `<strong style="color:${EM.ink};">AceMQ, an Ace8 company</strong>`,
      `© ${new Date().getFullYear()} AceMQ, an Ace8 Company · Sent automatically by ${emLink('https://onboarding.acemq.com', 'onboarding.acemq.com')} · ${emLink('mailto:support@acemq.com', 'support@acemq.com')}`,
    ],
    body: `
        <tr><td class="px" style="padding:36px 40px 40px;">
          ${emEyebrow(`New Submission — ${date}`)}
          ${emGap(14)}
          ${emH1(company)}
          <p style="margin:8px 0 0;${EMF}font-size:15px;line-height:22px;color:${EM.sec};">AceMQ — Internal Onboarding Report</p>
          ${emGap(28)}

          <!-- Summary -->
          ${emTile(summary)}
          ${emGap(32)}

          <!-- Per-service sections -->
          ${sections}

        </td></tr>`,
  });
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

  const kv = (label, value, noLine) => `
      <tr>
        <td valign="top" style="padding:11px 16px 11px 0;${noLine ? '' : `border-bottom:1px solid ${EM.hair};`}${EMF}font-size:11px;line-height:20px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:${EM.muted};width:38%;">${label}</td>
        <td valign="top" style="padding:11px 0;${noLine ? '' : `border-bottom:1px solid ${EM.hair};`}${EMF}font-size:14px;line-height:20px;color:${EM.ink};word-break:break-word;">${value}</td>
      </tr>`;
  const note = (html) => `<p style="margin:16px 0 0;${EMF}font-size:14px;line-height:22px;color:${EM.sec};">${html}</p>`;

  let sectionsHtml = '';

  if (services.engagement) {
    const leadRow = { firstName: submitter.firstName, lastName: submitter.lastName, title: submitter.jobTitle || '', email: submitter.email, role: 'Lead Stakeholder' };
    const allParticipants = [leadRow, ...(engagementParticipants || [])];
    const participantRows = allParticipants.map(p => `
      <tr>
        ${emTd(`${p.firstName || ''} ${p.lastName || ''}`)}
        ${emTd(p.title || p.jobTitle || '—', `color:${EM.sec};`)}
        ${emTd(String(p.email).replace('@', '@<wbr>'), emAccent)}
        ${emTd(p.role)}
      </tr>`).join('');

    sectionsHtml += `${sectionsHtml ? emDivider() : ''}
    <div>
      ${emSectionHead('Engagement')}
      ${emGap(12)}
      ${emTable(`
        ${kickoffDate ? kv('Kickoff Date', kickoffDate) : ''}
        ${teamTimezone ? kv('Team Timezone', teamTimezone) : ''}
        ${schedulingPref ? kv('Scheduling', schedulingPref) : ''}
      `)}
      ${emGap(22)}
      ${emSub('Participants')}
      ${emTable(`
        ${emHead(['Name', 'Title', 'Email', 'Role'])}
        ${participantRows}
      `)}
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

    const licRowsHtml = licRows.map(([l, v]) => kv(l, v)).join('');

    const portalRowsHtml = (portalUsers || []).map(e => `<tr>${emTd(e, emAccent)}</tr>`).join('');

    sectionsHtml += `${sectionsHtml ? emDivider() : ''}
    <div>
      ${emSectionHead('License')}
      ${emGap(12)}
      ${emTable(licRowsHtml)}
      ${portalUsers?.length ? `
      ${emGap(22)}
      ${emSub('Portal Users')}
      ${emTable(`
        ${emHead(['Email'])}
        ${portalRowsHtml}
      `)}` : ''}
      ${note('Your JFrog Artifactory credentials will be emailed to each portal user shortly. A setup guide is attached to this email.')}
    </div>`;
  }

  if (services.broker && broker) {
    const rowsHtml = brokerRows(broker).map(([l, v]) => kv(esc(l), esc(v))).join('');
    const users = [submitter.email, ...(broker.users || [])];

    sectionsHtml += `${sectionsHtml ? emDivider() : ''}
    <div>
      ${emSectionHead('AceMQ Broker')}
      ${emGap(12)}
      ${emTable(rowsHtml)}
      ${emGap(22)}
      ${emSub('Repository Access')}
      <p style="margin:0;${EMF}font-size:14px;line-height:22px;color:${EM.accent};">${users.map(esc).join('<br>')}</p>
      ${note(`Each person above will receive a separate email with their AceMQ Artifactory login for the AceMQ Broker project. Full documentation is at ${emLink('https://broker.acemq.com', 'broker.acemq.com')}.`)}
    </div>`;
  }

  if (services.support) {
    const supportRowsHtml = (supportUsers || []).map((u) => `
      <tr>
        ${emTd(`${u.firstName || ''} ${u.lastName || ''}`)}
        ${emTd(u.email, emAccent)}
      </tr>`).join('');

    sectionsHtml += `${sectionsHtml ? emDivider() : ''}
    <div>
      ${emSectionHead('Support')}
      ${emGap(12)}
      ${emTable(`
        ${emHead(['Name', 'Email'])}
        ${supportRowsHtml}
      `)}
      ${note('Your support portal access has been provisioned. You will receive a separate email from our support system.')}
    </div>`;
  }

  const summary = [
    ['Company', `<strong>${company}</strong>`],
    ['Services', svcList.join('&nbsp;&nbsp;·&nbsp;&nbsp;')],
    ['Date', date],
  ].map(([l, v], i, a) => kv(l, v, i === a.length - 1)).join('');

  return emShell({
    footerLines: [
      `<strong style="color:${EM.ink};">AceMQ, an Ace8 company</strong>`,
      `© ${new Date().getFullYear()} AceMQ, an Ace8 Company · ${emLink('mailto:support@acemq.com', 'support@acemq.com')} · ${emLink('https://acemq.com', 'acemq.com')}`,
    ],
    body: `
        <tr><td class="px" style="padding:40px;">
          ${emEyebrow('Onboarding Confirmed')}
          ${emGap(14)}
          ${emH1(`Welcome, ${submitter.firstName}!`)}
          <p style="margin:16px 0 0;${EMF}font-size:16px;line-height:26px;color:${EM.body};">
            Thank you for completing your onboarding with AceMQ. Your submission has been received and our team will be in touch within <strong style="color:${EM.ink};">1 business day</strong> to get everything kicked off.
          </p>
          ${emGap(28)}

          <!-- Summary card -->
          ${emTile(summary)}
          ${emGap(32)}

          <!-- Per-service detail sections -->
          ${sectionsHtml}
          ${sectionsHtml ? emGap(32) : ''}

          ${emCallout(`
              Your full onboarding report is attached to this email as a PDF for your records.
              ${services.license ? 'The JFrog Pull Guide is also attached to help you get started with your license.' : ''}
          `)}
          ${emGap(24)}

          <p style="margin:0;${EMF}font-size:14px;line-height:22px;color:${EM.sec};">
            Questions? Reach out to us at ${emLink('mailto:support@acemq.com', 'support@acemq.com')}
          </p>
        </td></tr>`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF report — pdf-lib, AceMQ "ace26" brand (white, hairlines, orange accent).
// Standard fonts only (Helvetica); every string goes through toWinAnsi.
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

  // Logo is cosmetic: never let a missing file break report generation.
  let logo = null;
  try { logo = await doc.embedPng(fs.readFileSync(path.join(process.cwd(), 'public', 'redesign', 'logo.png'))); } catch (_) {}

  const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
  const INK    = hex('#121316');
  const SEC    = hex('#5F6670');
  const MUTED  = hex('#757B85');
  const HAIR   = hex('#E9EBEE');
  const CTL    = hex('#DDE0E4');
  const SURF   = hex('#FAFAFB');
  const ORANGE = hex('#FF6600');
  const ACCENT = hex('#BF4D00');
  const TINT   = hex('#FFF5EC');
  const TINT2  = hex('#FFE8D6');

  const W = 595, H = 842;
  const ML = 56, MR = 56;
  const BW = W - ML - MR;
  const TOP = H - 64;     // first baseline area on every page
  const BOTTOM = 76;      // content never goes below this (footer lives under it)

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
  let y = TOP;

  // Wrap text to maxW; sanitizes first (so measuring never throws) and hard-breaks over-long tokens.
  function wrapLines(text, font, size, maxW) {
    const words = toWinAnsi(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (let w of words) {
      while (font.widthOfTextAtSize(w, size) > maxW && w.length > 1) {
        let n = w.length - 1;
        while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > maxW) n--;
        if (cur) { lines.push(cur); cur = ''; }
        lines.push(w.slice(0, n));
        w = w.slice(n);
      }
      const trial = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(trial, size) > maxW && cur) { lines.push(cur); cur = w; }
      else cur = trial;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  // Rounded rectangle via SVG path (pdf-lib has no borderRadius). yTop = top edge in PDF coords.
  function roundRect(x, yTop, w, h, r, { fill, stroke, sw = 0.6 }) {
    r = Math.min(r, h / 2, w / 2);
    const k = 0.5523 * r;
    const d = `M ${r} 0 L ${w - r} 0 C ${w - r + k} 0 ${w} ${r - k} ${w} ${r} L ${w} ${h - r} C ${w} ${h - r + k} ${w - r + k} ${h} ${w - r} ${h} L ${r} ${h} C ${r - k} ${h} 0 ${h - r + k} 0 ${h - r} L 0 ${r} C 0 ${r - k} ${r - k} 0 ${r} 0 Z`;
    page.drawSvgPath(d, { x, y: yTop, ...(fill ? { color: fill } : {}), ...(stroke ? { borderColor: stroke, borderWidth: sw } : {}) });
  }

  function hairline(yy, color = HAIR, thickness = 0.6) {
    page.drawLine({ start: { x: ML, y: yy }, end: { x: ML + BW, y: yy }, thickness, color });
  }

  function ensureSpace(needed) {
    if (y - needed < BOTTOM) {
      page = patchDrawText(doc.addPage([W, H]));
      y = TOP;
    }
  }

  // ── COVER ──
  if (logo) {
    const lw = 104, lh = lw * logo.height / logo.width;
    page.drawImage(logo, { x: ML, y: y - lh, width: lw, height: lh });
    y -= lh;
  } else {
    y -= 18;
    page.drawText('AceMQ', { x: ML, y, font: bold, size: 20, color: INK });
  }
  y -= 44;
  // eyebrow: orange dash + uppercase label
  page.drawRectangle({ x: ML, y: y + 2.6, width: 24, height: 1.5, color: ORANGE });
  page.drawText('ONBOARDING REPORT', { x: ML + 34, y, font: bold, size: 8, color: ACCENT, characterSpacing: 1.7 });
  y -= 38;
  page.drawText('AceMQ Onboarding Report', { x: ML, y, font: bold, size: 32, color: INK, characterSpacing: -0.7 });
  y -= 26;
  {
    const sub = `${company}  ·  Prepared by AceMQ  ·  ${date}`;
    if (regular.widthOfTextAtSize(toWinAnsi(sub), 11) <= BW) {
      page.drawText(sub, { x: ML, y, font: regular, size: 11, color: SEC });
    } else {
      const sl = wrapLines(sub, regular, 11, BW);
      sl.forEach((ln, i) => page.drawText(ln, { x: ML, y: y - i * 15, font: regular, size: 11, color: SEC }));
      y -= (sl.length - 1) * 15;
    }
  }
  y -= 34;

  // Services chips (tint pills instead of a filled bar)
  {
    const CH = 19, SZ = 7, CS = 0.8, PX = 11, GAP = 6;
    const labelW = bold.widthOfTextAtSize('SERVICES', SZ) + CS * 8;
    let cx = ML + labelW + 14;
    let rowTop = y;
    page.drawText('SERVICES', { x: ML, y: rowTop - CH + 6.5, font: bold, size: SZ, color: MUTED, characterSpacing: CS });
    svcNames.forEach((s) => {
      const label = toWinAnsi(s).toUpperCase();
      const cw = bold.widthOfTextAtSize(label, SZ) + CS * label.length + PX * 2;
      if (cx + cw > ML + BW) { cx = ML; rowTop -= CH + 8; }
      roundRect(cx, rowTop, cw, CH, CH / 2, { fill: TINT, stroke: TINT2, sw: 0.6 });
      page.drawText(label, { x: cx + PX, y: rowTop - CH + 6.5, font: bold, size: SZ, color: ACCENT, characterSpacing: CS });
      cx += cw + GAP;
    });
    y = rowTop - CH - 30;
  }

  hairline(y, CTL, 0.8);
  y -= 34;

  // Submission details table
  page.drawText('Submission Details', { x: ML, y, font: bold, size: 14, color: INK, characterSpacing: -0.2 });
  y -= 20;

  const COL1  = BW * 0.3;

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

  // ── Helpers ──

  const HEAD_H = 19;
  function drawColHeads(heads, xs) {
    heads.forEach((h, i) => {
      page.drawText(h.toUpperCase(), { x: xs[i], y: y - 12, font: bold, size: 6.5, color: MUTED, characterSpacing: 0.9 });
    });
    hairline(y - HEAD_H, CTL, 0.8);
    y -= HEAD_H;
  }

  // Key/value table: muted uppercase labels, ink values, hairline rows. Rows grow to fit wrapped values.
  function drawKVTable(rows, heads = ['Detail', 'Value'], boldLabels = []) {
    const VAL = 9, LH = 12, PADY = 7.5;
    const valW = BW - COL1 - 12;
    const prepared = rows.map(([l, v]) => {
      const font = boldLabels.includes(l) ? bold : regular;
      const lines = wrapLines(String(v || '—'), font, VAL, valW);
      return { l, font, lines, h: lines.length * LH + PADY * 2 };
    });
    ensureSpace(HEAD_H + (prepared[0] ? prepared[0].h : 0) + 2);
    drawColHeads(heads, [ML, ML + COL1]);
    prepared.forEach((r) => {
      ensureSpace(r.h + 2);
      const by = y - PADY - 7;
      page.drawText(r.l.toUpperCase(), { x: ML, y: by, font: bold, size: 6.5, color: MUTED, characterSpacing: 0.8 });
      r.lines.forEach((ln, i) => page.drawText(ln, { x: ML + COL1, y: by - i * LH, font: r.font, size: VAL, color: INK }));
      hairline(y - r.h);
      y -= r.h;
    });
    y -= 18;
  }

  // Multi-column grid (participants, support users, single-column lists). Header optional.
  function drawGrid(heads, fracs, rows, size = 8, color = INK) {
    const LH = size + 3.5, PADY = 7;
    const widths = fracs.map((f) => BW * f);
    const xs = widths.map((_, i) => ML + widths.slice(0, i).reduce((a, b) => a + b, 0));
    const prepared = rows.map((cells) => {
      const lines = cells.map((c, ci) => wrapLines(String(c || '—'), regular, size, widths[ci] - 12));
      return { lines, h: Math.max(...lines.map((l) => l.length)) * LH + PADY * 2 };
    });
    ensureSpace((heads.length ? HEAD_H : 0) + (prepared[0] ? prepared[0].h : 0) + 2);
    if (heads.length) drawColHeads(heads, xs);
    prepared.forEach((r) => {
      ensureSpace(r.h + 2);
      r.lines.forEach((cl, ci) => cl.forEach((ln, li) => {
        page.drawText(ln, { x: xs[ci], y: y - PADY - size * 0.8 - li * LH, font: regular, size, color });
      }));
      hairline(y - r.h);
      y -= r.h;
    });
    y -= 18;
  }

  function drawSectionBanner(num, title) {
    ensureSpace(150);
    y -= 14;
    page.drawText(String(num).padStart(2, '0'), { x: ML, y: y - 18, font: bold, size: 24, color: ORANGE, characterSpacing: -0.6 });
    page.drawText(title, { x: ML + 42, y: y - 18, font: bold, size: 13, color: INK, characterSpacing: 0.5 });
    hairline(y - 32, CTL, 0.8);
    y -= 32 + 22;
  }

  function drawSectionHead(text) {
    ensureSpace(70);
    page.drawText(text, { x: ML, y, font: bold, size: 11.5, color: INK, characterSpacing: -0.1 });
    y -= 20;
  }

  function drawSubHead(text) {
    ensureSpace(60);
    page.drawText(text, { x: ML, y, font: bold, size: 9.5, color: INK });
    y -= 16;
  }

  // Free text in a faint tile. Draws in per-page chunks so long text can never run off the page.
  function drawTextBlock(text) {
    if (!text?.trim()) return;
    const LH = 13, SZ = 9, PAD = 11;
    const lines = wrapLines(text, regular, SZ, BW - PAD * 2);
    let i = 0;
    while (i < lines.length) {
      ensureSpace(Math.min(lines.length - i, 3) * LH + PAD * 2 + 2);
      const fit = Math.max(1, Math.floor((y - BOTTOM - PAD * 2) / LH));
      const n = Math.min(lines.length - i, fit);
      const h = n * LH + PAD * 2;
      roundRect(ML, y, BW, h, 10, { fill: SURF, stroke: HAIR, sw: 0.6 });
      lines.slice(i, i + n).forEach((ln, k) => {
        page.drawText(ln, { x: ML + PAD, y: y - PAD - SZ * 0.85 - k * LH, font: regular, size: SZ, color: INK });
      });
      y -= h + 4;
      i += n;
    }
    y -= 14;
  }

  drawKVTable(detailRows, ['Document', 'Detail'], ['Company', 'Services']);

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
      drawGrid(
        ['Name', 'Title', 'Email', 'Role'],
        [0.21, 0.21, 0.38, 0.20],
        allParticipants.map((p) => [`${p.firstName || ''} ${p.lastName || ''}`.trim() || '—', p.title || '—', p.email || '—', p.role || '—']),
        8,
      );
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
      drawGrid([], [1], portalUsers.map((email) => [email]), 8.5);
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
    drawGrid([], [1], [submitter.email, ...(broker.users || [])].map((email) => [email]), 8.5);
    drawTextBlock('Each user receives an AceMQ Artifactory login (acemq.jfrog.io) scoped to the AceMQ Broker project. New users get a temporary password by email and are prompted to change it on first login. Full documentation: broker.acemq.com');

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
      drawGrid(
        ['First Name', 'Last Name', 'Email'],
        [0.28, 0.28, 0.44],
        supportUsers.map((u) => [u.firstName || '—', u.lastName || '—', u.email || '—']),
        8.5,
      );
    } else {
      ensureSpace(18);
      page.drawText('No support users specified.', { x: ML, y, font: regular, size: 9, color: MUTED });
      y -= 16;
    }
  }

  // ── Page chrome on every page: orange top rule + footer with page number ──
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawRectangle({ x: 0, y: H - 3, width: W, height: 3, color: ORANGE });
    p.drawLine({ start: { x: ML, y: 56 }, end: { x: W - MR, y: 56 }, thickness: 0.6, color: CTL });
    p.drawText(toWinAnsi(`AceMQ Onboarding Report  ·  ${dateShort}`), { x: ML, y: 40, font: regular, size: 7.5, color: MUTED });
    const right = toWinAnsi(`AceMQ, an Ace8 company  ·  Page ${i + 1} of ${pages.length}`);
    p.drawText(right, { x: W - MR - regular.widthOfTextAtSize(right, 7.5), y: 40, font: regular, size: 7.5, color: MUTED });
  });

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
// broker:  shared, pre-built groups in the "AceMQ Broker" JFrog project, picked by the license
//          type the customer chose. Their permissions (managed in JFrog) grant read on one folder
//          of acemq-broker-releases-local + acemq-broker-docker-local — staging stays hidden:
//            nfr        → acemq-broker-nfr        / acemq-broker-nfr-read        → nfr-distribution/**
//            commercial → acemq-broker-commercial / acemq-broker-commercial-read → commercial-distribution/**
const JFROG_PRODUCTS = {
  license: { label: 'RabbitMQ license', groupPrefix: 'customer', permSuffix: 'rmq-access', repos: JFROG_REPOS, actions: ['read', 'write'], attachGuide: true },
  broker:           { label: 'AceMQ Broker', sharedGroup: 'acemq-broker-nfr',        sharedPerm: 'acemq-broker-nfr-read',        attachGuide: false, docsUrl: 'https://broker.acemq.com' },
  brokerCommercial: { label: 'AceMQ Broker', sharedGroup: 'acemq-broker-commercial', sharedPerm: 'acemq-broker-commercial-read', attachGuide: false, docsUrl: 'https://broker.acemq.com' },
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
  const jRow = (label, valueHtml, mono, noLine) => `
          <tr>
            <td valign="top" style="padding:11px 16px 11px 0;${noLine ? '' : `border-bottom:1px solid ${EM.hair};`}${EMF}font-size:11px;line-height:20px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:${EM.muted};width:34%;">${label}</td>
            <td valign="top" style="padding:11px 0;${noLine ? '' : `border-bottom:1px solid ${EM.hair};`}${mono ? "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.02em;" : EMF}font-size:14px;line-height:20px;color:${EM.ink};word-break:break-word;">${valueHtml}</td>
          </tr>`;
  const credRows = tempPwd ? jRow('Temp Password', tempPwd, true, true) : '';
  const jNote = (html) => `<p style="margin:20px 0 0;${EMF}font-size:14px;line-height:22px;color:${EM.sec};">${html}</p>`;
  const postLoginNote = tempPwd
    ? jNote('You will be prompted to change your password after your first login.')
    : jNote(`Log in with your existing AceMQ Artifactory credentials.${product.attachGuide ? ' The pull guide attached to this email has step-by-step instructions.' : ''}`);
  const docsNote = product.docsUrl
    ? `<p style="margin:20px 0 0;${EMF}font-size:14px;line-height:22px;color:${EM.body};">Full installation and usage documentation: ${emLink(product.docsUrl, product.docsUrl.replace('https://', ''))}</p>`
    : '';

  const html = emShell({
    footerLines: [
      `<strong style="color:${EM.ink};">AceMQ, an Ace8 company</strong>`,
      `Questions? Contact ${emLink('mailto:support@acemq.com', 'support@acemq.com')}`,
    ],
    body: `
        <tr><td class="px" style="padding:36px 40px 40px;">
          ${emH1(`Your ${product.label} Artifact Access is Ready`, 26)}
          <p style="margin:16px 0 0;${EMF}font-size:15px;line-height:25px;color:${EM.body};">
            Your account on the AceMQ JFrog Artifactory platform has been provisioned as part of
            the <strong style="color:${EM.ink};">${company}</strong> ${product.label} onboarding. You now have access to the
            ${product.label} repositories.
          </p>
          ${emGap(24)}
          ${emTile(`
          ${jRow('Platform', emLink('https://acemq.jfrog.io', 'acemq.jfrog.io'), false, false)}
          ${jRow('Username', email, true, !tempPwd)}
          ${credRows}
          `)}
          ${emGap(28)}
          ${emButton('https://acemq.jfrog.io', 'Log In to AceMQ Artifactory →')}
          ${postLoginNote}
          ${docsNote}
        </td></tr>`,
  });

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
          // Only an explicit 'commercial' answer gets commercial builds; anything else is NFR.
          kind: broker?.licenseType === 'commercial' ? 'brokerCommercial' : 'broker',
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
