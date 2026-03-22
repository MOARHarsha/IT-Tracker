// scripts/weekly-report.js
const https = require('https');

const JSONBIN_API_KEY    = process.env.JSONBIN_API_KEY;
const JSONBIN_BIN_ID     = process.env.JSONBIN_BIN_ID;
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID= process.env.EMAILJS_WEEKLY_TEMPLATE_ID || "template_e55mib8";
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY;
const EMAILJS_PRIVATE_KEY= process.env.EMAILJS_PRIVATE_KEY;
const EMAIL_TO           = process.env.EMAIL_TO;

function today() { return new Date().toISOString().split('T')[0]; }
function weekAgo() { var d=new Date(); d.setDate(d.getDate()-7); return d.toISOString().split('T')[0]; }
function isOverdue(i) { if(!i.due||i.sta==='Resolved') return false; return i.due<today(); }
function daysOverdue(due) { return Math.floor((new Date(today())-new Date(due))/86400000); }
function fmtDate(d) {
  if(!d) return '—';
  var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var p=d.split('-'); return p[2]+' '+months[parseInt(p[1])-1]+' '+p[0];
}

function fetchIssues() {
  return new Promise((resolve,reject) => {
    const req = https.request({
      hostname:'api.jsonbin.io', path:`/v3/b/${JSONBIN_BIN_ID}/latest`, method:'GET',
      headers:{'X-Master-Key':JSONBIN_API_KEY,'X-Access-Key':JSONBIN_API_KEY}
    }, res => {
      let data='';
      res.on('data',c=>data+=c);
      res.on('end',()=>{ try{ const p=JSON.parse(data); resolve(Array.isArray(p.record)?p.record:[]); }catch(e){reject(e);} });
    });
    req.on('error',reject); req.end();
  });
}

function sendEmail(subject, htmlMessage, toEmail) {
  return new Promise((resolve,reject) => {
    const payload = JSON.stringify({
      service_id:EMAILJS_SERVICE_ID, template_id:EMAILJS_TEMPLATE_ID,
      user_id:EMAILJS_PUBLIC_KEY, accessToken:EMAILJS_PRIVATE_KEY,
      template_params:{ to_email:toEmail, subject, message:htmlMessage, reply_to:'jagruth.gowda@moaradvisory.com' }
    });
    const req = https.request({
      hostname:'api.emailjs.com', path:'/api/v1.0/email/send', method:'POST',
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}
    }, res => {
      let data='';
      res.on('data',c=>data+=c);
      res.on('end',()=>{ if(res.statusCode===200) resolve(data); else reject(new Error(`EmailJS ${res.statusCode}: ${data}`)); });
    });
    req.on('error',reject); req.write(payload); req.end();
  });
}

function buildHTML(issues) {
  const nTotal=issues.length;
  const nOpen=issues.filter(i=>i.sta==='Open').length;
  const nProg=issues.filter(i=>i.sta==='In Progress').length;
  const nRes=issues.filter(i=>i.sta==='Resolved').length;
  const nCrit=issues.filter(i=>i.pri==='Critical').length;
  const nOver=issues.filter(i=>isOverdue(i)).length;
  const newW=issues.filter(i=>i.date>=weekAgo()).length;
  const resW=issues.filter(i=>i.sta==='Resolved'&&i.date>=weekAgo()).length;
  const dateStr=new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

  function tile(label,val,color) {
    return `<td style="padding:0 5px;text-align:center;">
      <div style="background:#1e2330;border:1px solid #2a3045;border-radius:8px;padding:14px 10px;min-width:80px;">
        <div style="font-family:monospace;font-size:26px;font-weight:700;color:${color};line-height:1;">${val}</div>
        <div style="font-size:9px;color:#6b7591;text-transform:uppercase;letter-spacing:1px;margin-top:4px;">${label}</div>
      </div></td>`;
  }

  function badge(text,bg,color) {
    return `<span style="font-family:monospace;font-size:9px;font-weight:700;padding:3px 8px;border-radius:4px;background:${bg};color:${color};border:1px solid ${color}44;">${text}</span>`;
  }

  function issueRow(i,bg) {
    const over=isOverdue(i);
    const priC={'Critical':'#f75959','High':'#f7a84f','Medium':'#a0b8ff','Low':'#6b7591','Unset':'#6b7591'};
    const staC={'Open':'#f7a84f','In Progress':'#4f8ef7','Resolved':'#00e5b0'};
    const leftB=over?'border-left:3px solid #c77dff;':'border-left:3px solid transparent;';
    return `<tr style="border-bottom:1px solid #2a3045;${leftB}background:${bg};">
      <td style="padding:10px 12px;font-family:monospace;font-size:10px;color:#4f8ef7;white-space:nowrap;">${i.id}</td>
      <td style="padding:10px 12px;font-size:11px;color:#e8ecf4;font-weight:600;max-width:180px;">${i.title}</td>
      <td style="padding:10px 12px;font-size:10px;color:#6b7591;white-space:nowrap;">${i.cat||'—'}</td>
      <td style="padding:10px 12px;">${badge(i.pri||'UNSET','#1e2330',priC[i.pri||'Unset'])}</td>
      <td style="padding:10px 12px;">${badge(i.sta||'OPEN','#1e2330',staC[i.sta]||'#f7a84f')}</td>
      <td style="padding:10px 12px;font-family:monospace;font-size:10px;color:${over?'#c77dff':'#6b7591'};">
        ${over?'⚠ '+daysOverdue(i.due)+'d overdue':(i.due?fmtDate(i.due):'—')}</td>
      <td style="padding:10px 12px;font-size:10px;color:#6b7591;">${i.rep||'—'}</td>
    </tr>`;
  }

  function sectionHead(title,color) {
    return `<tr><td colspan="7" style="padding:14px 12px 6px;">
      <div style="font-family:monospace;font-size:9px;text-transform:uppercase;letter-spacing:1px;color:${color};border-left:3px solid ${color};padding-left:8px;">${title}</div>
    </td></tr>`;
  }

  function tableHeader() {
    return `<tr style="background:#1e2330;border-bottom:1px solid #2a3045;">
      ${['ISSUE ID','TITLE','CATEGORY','PRIORITY','STATUS','DUE DATE','REPORTER'].map(h=>
        `<th style="padding:9px 12px;font-family:monospace;font-size:8px;text-transform:uppercase;letter-spacing:.9px;color:#6b7591;font-weight:400;text-align:left;white-space:nowrap;">${h}</th>`
      ).join('')}
    </tr>`;
  }

  const overdueList=issues.filter(i=>isOverdue(i)).sort((a,b)=>daysOverdue(b.due)-daysOverdue(a.due));
  const critList=issues.filter(i=>i.pri==='Critical'&&i.sta!=='Resolved');
  const newList=issues.filter(i=>i.date>=weekAgo()).sort((a,b)=>b.ts-a.ts);

  return `
<div style="background:#0d0f14;padding:0;font-family:Arial,sans-serif;">
<table cellpadding="0" cellspacing="0" width="100%" style="max-width:700px;margin:0 auto;background:#0d0f14;">

  <!-- HEADER -->
  <tr><td style="background:#161a23;border-radius:12px 12px 0 0;padding:20px 28px;border-bottom:1px solid #2a3045;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>
        <span style="background:#4f8ef7;color:#fff;font-family:monospace;font-size:11px;font-weight:700;padding:5px 10px;border-radius:6px;letter-spacing:1px;">MOAR</span>
        <span style="font-size:15px;font-weight:700;color:#e8ecf4;margin-left:10px;vertical-align:middle;">IT Issue Tracker</span>
        <div style="font-size:10px;color:#6b7591;margin-top:5px;text-transform:uppercase;letter-spacing:.8px;font-family:monospace;">Weekly Report &middot; ${dateStr}</div>
      </td>
      <td align="right" valign="middle">
        <span style="font-size:10px;color:#00e5b0;background:rgba(0,229,176,0.08);border:1px solid rgba(0,229,176,0.2);padding:5px 12px;border-radius:20px;font-family:monospace;">&#9679; Live Data</span>
      </td>
    </tr></table>
  </td></tr>

  <!-- THIS WEEK HIGHLIGHT -->
  <tr><td style="background:#161a23;padding:16px 28px 0;">
    <div style="background:#1e2330;border:1px solid #2a3045;border-radius:8px;padding:12px 16px;">
      <span style="font-size:12px;color:#e8ecf4;">
        This week &nbsp;&#8226;&nbsp;
        <strong style="color:#4f8ef7;">${newW} new issue${newW!==1?'s':''}</strong>
        &nbsp;&#8226;&nbsp;
        <strong style="color:#00e5b0;">${resW} resolved</strong>
        ${nOver>0?`&nbsp;&#8226;&nbsp;<strong style="color:#c77dff;">&#9888; ${nOver} overdue</strong>`:''}
      </span>
    </div>
  </td></tr>

  <!-- STAT TILES -->
  <tr><td style="background:#161a23;padding:16px 28px;">
    <table cellpadding="0" cellspacing="0"><tr>
      ${tile('Total',nTotal,'#e8ecf4')}
      ${tile('Open',nOpen,'#f7a84f')}
      ${tile('In Progress',nProg,'#4f8ef7')}
      ${tile('Resolved',nRes,'#00e5b0')}
      ${tile('Critical',nCrit,'#f75959')}
      ${tile('Overdue',nOver,'#c77dff')}
    </tr></table>
  </td></tr>

  <!-- ISSUES TABLE -->
  <tr><td style="background:#161a23;padding:0 28px 24px;">
    <table cellpadding="0" cellspacing="0" width="100%" style="background:#161a23;border:1px solid #2a3045;border-radius:10px;overflow:hidden;border-collapse:collapse;">
      ${tableHeader()}
      ${overdueList.length>0 ? sectionHead('&#9888; Overdue — Needs Immediate Attention','#c77dff')+overdueList.map((i,idx)=>issueRow(i,idx%2===0?'#161a23':'#1a1f2b')).join('') : ''}
      ${critList.length>0 ? sectionHead('&#128308; Critical — Open Issues','#f75959')+critList.map((i,idx)=>issueRow(i,idx%2===0?'#161a23':'#1a1f2b')).join('') : ''}
      ${newList.length>0 ? sectionHead('&#128197; Logged This Week','#4f8ef7')+newList.map((i,idx)=>issueRow(i,idx%2===0?'#161a23':'#1a1f2b')).join('') :
        '<tr><td colspan="7" style="padding:30px;text-align:center;color:#6b7591;font-family:monospace;font-size:11px;">&#10003; No new issues logged this week</td></tr>'}
    </table>
  </td></tr>

  <!-- CTA BUTTON -->
  <tr><td style="background:#161a23;padding:0 28px 28px;text-align:center;">
    <a href="https://moarharsha.github.io/IT-Tracker/" style="display:inline-block;background:#4f8ef7;color:#fff;font-size:12px;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none;font-family:Arial,sans-serif;">View Live Tracker &amp; Download CSV &#8594;</a>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="padding:16px 28px;text-align:center;border-top:1px solid #2a3045;">
    <div style="font-size:9px;color:#6b7591;font-family:monospace;line-height:1.8;">
      MOAR Advisory Services &middot; IT Issue Tracker &middot; Automated Weekly Report<br>
      Sent every Monday at 8:00 AM IST &middot; Reply to Jagruth for queries
    </div>
  </td></tr>

</table>
</div>`;
}

async function main() {
  console.log(`[${today()}] MOAR IT — Weekly report starting...`);
  const issues = await fetchIssues();
  console.log(`Fetched ${issues.length} issues.`);
  const nOpen=issues.filter(i=>i.sta==='Open').length;
  const nCrit=issues.filter(i=>i.pri==='Critical').length;
  const nOver=issues.filter(i=>isOverdue(i)).length;
  const newW=issues.filter(i=>i.date>=weekAgo()).length;
  const subject=`[MOAR IT] Weekly Report — ${newW} new · ${nOpen} open · ${nCrit} critical${nOver>0?' · ⚠ '+nOver+' overdue':''}`;
  const htmlMessage=buildHTML(issues);
  const recipients=EMAIL_TO.split(',').map(e=>e.trim()).filter(Boolean);
  for(const email of recipients) {
    await sendEmail(subject, htmlMessage, email);
    console.log(`✓ Sent to ${email}`);
  }
  console.log(`✓ Done.`);
}

main().catch(err=>{ console.error('Error:',err.message); process.exit(1); });
