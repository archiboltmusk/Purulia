/* ── Cursor ── */
const cur=document.getElementById('cur'),curR=document.getElementById('curR');
let mx=window.innerWidth/2,my=window.innerHeight/2,rx=mx,ry=my;
document.addEventListener('mousemove',e=>{mx=e.clientX;my=e.clientY;cur.style.left=mx+'px';cur.style.top=my+'px';});
(function anim(){rx+=(mx-rx)*.11;ry+=(my-ry)*.11;curR.style.left=rx+'px';curR.style.top=ry+'px';requestAnimationFrame(anim);})();
document.querySelectorAll('a,button,select,input,textarea').forEach(el=>{
  el.addEventListener('mouseenter',()=>{curR.style.width='44px';curR.style.height='44px';curR.style.borderColor='rgba(212,136,42,.9)';});
  el.addEventListener('mouseleave',()=>{curR.style.width='28px';curR.style.height='28px';curR.style.borderColor='rgba(212,136,42,.45)';});
});

/* ── Progress bar ── */
const pb=document.getElementById('pbar');
window.addEventListener('scroll',()=>{pb.style.width=(window.scrollY/(document.body.scrollHeight-window.innerHeight)*100)+'%';},{passive:true});

/* ── Reveal ── */
const rvs=document.querySelectorAll('.rv');
const rvo=new IntersectionObserver(es=>{
  es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('on');rvo.unobserve(e.target);}});
},{threshold:.07});
rvs.forEach((el,i)=>{el.style.transitionDelay=(i%5)*.06+'s';rvo.observe(el);});

/* ── Deep dive accordion ── */
function tog(id){
  const card=document.getElementById(id);
  const body=card.querySelector('.ddb');
  const isOpen=card.classList.contains('open');
  document.querySelectorAll('.ddc').forEach(c=>{
    c.classList.remove('open');
    c.querySelector('.ddb').style.maxHeight='0';
  });
  if(!isOpen){
    card.classList.add('open');
    body.style.maxHeight=body.scrollHeight+'px';
    setTimeout(()=>{if(card.classList.contains('open'))body.style.maxHeight=body.scrollHeight+'px';},400);
  }
}

/* ── Audience selector ── */
function showAud(id,btn){
  document.querySelectorAll('.aud-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.aud-btn').forEach(b=>b.classList.remove('active'));
  const panel=document.getElementById('aud-'+id);
  if(panel){panel.classList.add('active');}
  if(btn)btn.classList.add('active');
  history.replaceState(null,'','#aud-'+id);
}

/* ── Share section ── */
const shareMsgs={
  doctors:'Zero oncologists within 250km. 3.5 million people. This blueprint changes that — send to every doctor from Purulia you know:',
  engineers:'Build water systems from scratch. Design solar grids for tribal hamlets. First-principles engineering that actually matters. Purulia 2040:',
  architects:'A district being redesigned from zero. Medical college, railway station, crafts cluster — all open briefs, right now. Purulia 2040:',
  politicians:'₹3,500Cr of central scheme money sitting undrawn in Purulia. No new budget needed. This blueprint shows exactly how it gets spent:',
  students:'Every system is telling young people from Purulia to leave. This is the counter-argument — share with every student you know:',
  entrepreneurs:'Structural gaps mean first-mover advantages. The enterprise case for Purulia 2040:',
  business:'Pre-cleared land, 300 sunny days, and a single-window clearance being built. The manufacturing case for Purulia 2040:',
  artists:'Chhau is UNESCO-listed. Dokra is 4,000 years old. The world wants what Purulia has — it just doesn\'t know where to find it yet:',
  diaspora:'For everyone from Purulia who left. The sentence "there\'s nothing here for someone with ambition" is becoming past tense:',
  impact:'If this model works in Purulia, it works in 200 similar districts. The most leveraged use of impact capital in India right now:'
};

function shareSection(id){
  const url=window.location.origin+window.location.pathname+'#aud-'+id;
  const msg=shareMsgs[id]||'A complete transformation blueprint for Purulia, West Bengal — Purulia 2040:';

  /* Native share on mobile */
  if(navigator.share&&/Mobi|Android/i.test(navigator.userAgent)){
    navigator.share({title:'Purulia 2040',text:msg,url:url});
    return;
  }

  /* Show share panel on desktop */
  const existing=document.getElementById('sharePopup');
  if(existing)existing.remove();

  const wa=`https://wa.me/?text=${encodeURIComponent(msg+' '+url)}`;
  const tw=`https://twitter.com/intent/tweet?text=${encodeURIComponent(msg)}&url=${encodeURIComponent(url)}`;
  const li=`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;

  const popup=document.createElement('div');
  popup.id='sharePopup';
  popup.innerHTML=`
    <button class="sp-close" onclick="document.getElementById('sharePopup').remove()">✕</button>
    <div class="sp-title">Share this note</div>
    <div class="sp-msg">${msg}</div>
    <div class="sp-btns">
      <a class="sp-btn sp-wa" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>
      <a class="sp-btn sp-tw" href="${tw}" target="_blank" rel="noopener">Twitter / X</a>
      <a class="sp-btn sp-li" href="${li}" target="_blank" rel="noopener">LinkedIn</a>
      <button class="sp-btn" onclick="copyShareLink('${url}')">Copy Link</button>
    </div>`;
  document.body.appendChild(popup);
  setTimeout(()=>popup.classList.add('sp-show'),10);

  /* Auto-dismiss after 8s */
  setTimeout(()=>{if(popup.parentElement)popup.remove();},8000);
}

function copyShareLink(url){
  navigator.clipboard.writeText(url).then(()=>{
    showToast('Link copied to clipboard');
    const p=document.getElementById('sharePopup');
    if(p)p.remove();
  });
}

/* ── Toast ── */
let toastTimer;
function showToast(msg){
  const t=document.getElementById('toast');
  clearTimeout(toastTimer);
  t.textContent=msg;
  t.classList.add('show');
  toastTimer=setTimeout(()=>t.classList.remove('show'),2800);
}

/* ── Form submit — Google Sheets + email via Apps Script ── */
const SCRIPT_URL='https://script.google.com/macros/s/AKfycbxUb515nu7o2tjAy28J2L60SmsH-E7kdPnqTNfW1nYI5p4wUVR8RvEl_X5Ys-93AV5Y/exec';

async function submitForm(){
  if(!SCRIPT_URL){
    showToast('Form not configured — please email thelosthillproject@gmail.com directly.');
    return;
  }

  const name=document.getElementById('f-name').value.trim();
  const role=document.getElementById('f-role').value;
  const location=document.getElementById('f-location').value.trim();
  const message=document.getElementById('f-message').value.trim();
  const contact=document.getElementById('f-contact').value.trim();

  if(!name||!role||!contact){
    showToast('Please fill in your name, role, and contact');
    return;
  }

  const btn=document.querySelector('.form-submit');
  btn.disabled=true;
  btn.textContent='Sending…';

  try{
    // Package the data as a JSON string instead of URL parameters
    const payload = JSON.stringify({
      name, 
      role,
      location: location || 'Not provided',
      contact,
      message: message || '(none)'
    });

    // Send a POST request. text/plain is used to bypass complex CORS preflight checks.
    await fetch(SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: payload
    });

    document.getElementById('formWrap').style.display='none';
    document.getElementById('formSuccess').style.display='block';
    showToast('Thank you, '+name+'. We\'ll be in touch personally.');
  }catch(err){
    btn.disabled=false;
    btn.textContent='I Want to Be Part of This →';
    showToast('Could not send — please email thelosthillproject@gmail.com directly.');
  }
}

/* ── Active nav ── */
const secs=document.querySelectorAll('section[id]');
const nas=document.querySelectorAll('.nav-links a');
window.addEventListener('scroll',()=>{
  let cur2='';
  secs.forEach(s=>{if(window.scrollY>=s.offsetTop-220)cur2=s.id;});
  nas.forEach(a=>{
    const matches=a.getAttribute('href')==='#'+cur2;
    a.classList.toggle('act',matches);
  });
},{passive:true});

/* ── Bar chart animation ── */
const barObs=new IntersectionObserver(entries=>{
  entries.forEach(e=>{
    if(e.isIntersecting){
      e.target.querySelectorAll('.bar-fill').forEach((b,i)=>{
        setTimeout(()=>{b.style.width=b.dataset.w+'%';},i*150);
      });
      barObs.unobserve(e.target);
    }
  });
},{threshold:.3});
document.querySelectorAll('.chart-wrap').forEach(c=>barObs.observe(c));

/* ── Handle hash on load ── */
window.addEventListener('load',()=>{
  const hash=window.location.hash;
  if(!hash)return;
  if(hash==='#groundtruth'){document.getElementById('groundtruth').scrollIntoView();return;}
  if(hash.startsWith('#aud-')){
    const id=hash.replace('#aud-','');
    const btn=document.querySelector(`.aud-btn[onclick*="'${id}'"]`);
    showAud(id,btn);
    setTimeout(()=>{
      const sec=document.getElementById('audience');
      if(sec)sec.scrollIntoView({behavior:'smooth'});
    },150);
    return;
  }
  const el=document.querySelector(hash);
  if(el)el.scrollIntoView();
});

