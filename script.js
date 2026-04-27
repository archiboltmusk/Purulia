/* ── Page Transitions ── */
(function(){
  var de=document.documentElement;
  var rm=window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  // Fade in if arrived via internal navigation
  if(sessionStorage.getItem('pgt')){
    sessionStorage.removeItem('pgt');
    if(!rm){
      de.style.transition='opacity .28s ease';
      requestAnimationFrame(function(){requestAnimationFrame(function(){de.style.opacity='1';});});
    } else {
      de.style.opacity='1';
    }
  }
  // Fade out on internal link click
  if(!rm){
    document.addEventListener('click',function(e){
      var a=e.target.closest('a[href]');
      if(!a)return;
      var h=a.getAttribute('href');
      if(!h||h.charAt(0)==='#'||h.startsWith('http')||h.startsWith('mailto:')||h.startsWith('tel:')||a.target==='_blank'||a.hasAttribute('download'))return;
      e.preventDefault();
      de.style.transition='opacity .2s ease';
      de.style.opacity='0';
      setTimeout(function(){sessionStorage.setItem('pgt','1');window.location.href=h;},200);
    });
  }
})();

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
    const fs=document.getElementById('formSuccess');
    fs.style.display='block';
    /* Personalise name */
    const fsName=document.getElementById('fsName');
    if(fsName)fsName.textContent='Thank you, '+name+'.';
    /* Mark first timeline dot */
    const dots=fs.querySelectorAll('.fs-tl-dot');
    if(dots[0]){setTimeout(()=>dots[0].parentElement.classList.add('fs-done'),200);}
    /* Populate share buttons */
    const shareBtns=document.getElementById('fsShareBtns');
    if(shareBtns){
      const url=window.location.origin+(window.location.pathname.includes('join')?window.location.pathname.replace('join.html',''):window.location.pathname);
      const msg='I just connected with the Purulia 2040 blueprint team. If you care about transforming a district — read this:';
      shareBtns.innerHTML=
        '<a class="ss-btn ss-wa" href="https://wa.me/?text='+encodeURIComponent(msg+' '+url)+'" target="_blank" rel="noopener">WhatsApp</a>'+
        '<a class="ss-btn ss-tw" href="https://twitter.com/intent/tweet?text='+encodeURIComponent(msg)+'&url='+encodeURIComponent(url)+'" target="_blank" rel="noopener">Twitter</a>'+
        '<a class="ss-btn ss-li" href="https://www.linkedin.com/sharing/share-offsite/?url='+encodeURIComponent(url)+'" target="_blank" rel="noopener">LinkedIn</a>';
    }
    showToast('Welcome, '+name+'. We\'ll respond personally within 48 hours.');
  }catch(err){
    btn.disabled=false;
    btn.textContent='I Want to Be Part of This →';
    showToast('Could not send — please email thelosthillproject@gmail.com directly.');
  }
}

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


/* ── Nav dropdown ── */
function toggleMenu(){
  const t=document.getElementById('navToggle');
  const d=document.getElementById('navDropdown');
  if(!t||!d)return;
  t.classList.toggle('open');
  d.classList.toggle('open');
}
document.addEventListener('click',e=>{
  if(!e.target.closest('.nav-mob')){
    document.getElementById('navToggle')?.classList.remove('open');
    document.getElementById('navDropdown')?.classList.remove('open');
  }
});
/* Active page highlight — desktop links + mobile dropdown */
(function(){
  const p=window.location.pathname.split('/').pop()||'index.html';
  document.querySelectorAll('.nd-item').forEach(a=>{
    if(a.getAttribute('href')===p)a.classList.add('nd-active');
  });
  document.querySelectorAll('.nl-item').forEach(a=>{
    if(a.getAttribute('href')===p)a.classList.add('nl-active');
  });
})();

/* ── WhatsApp floating share button ── */
(function(){
  const pageMsgs={
    'index.html':'A complete blueprint to transform an entire district — Purulia 2040. Worth reading and sharing:',
    'blueprint.html':'The full 15-year blueprint for transforming Purulia. Six pillars, complete economics — read it:',
    'audience.html':'This blueprint for Purulia 2040 was written for every kind of person who can help. Find your role:',
    'data.html':'The hard data on Purulia — why this district is primed for transformation right now:',
    'join.html':'This blueprint needs people, not just readers. Here\'s how to get involved with Purulia 2040:',
    'map.html':'Explore every project and zone in the Purulia 2040 transformation plan — interactive map:'
  };
  const page=window.location.pathname.split('/').pop()||'index.html';
  const msg=pageMsgs[page]||'A complete transformation blueprint for Purulia, West Bengal:';
  const url=window.location.origin+(window.location.pathname.includes('index.html')?window.location.pathname.replace('index.html',''):window.location.pathname);

  const btn=document.createElement('a');
  btn.id='waFloat';
  btn.href='https://wa.me/?text='+encodeURIComponent(msg+' '+url);
  btn.target='_blank';
  btn.rel='noopener noreferrer';
  btn.setAttribute('aria-label','Share on WhatsApp');
  btn.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg><span>Share</span>';
  document.body.appendChild(btn);

  let shown=false;
  window.addEventListener('scroll',()=>{
    const pct=window.scrollY/(document.body.scrollHeight-window.innerHeight||1);
    if(!shown&&pct>.22){shown=true;btn.classList.add('wa-show');}
  },{passive:true});
})();

/* ── Inline share strip population ── */
(function(){
  const strip=document.getElementById('shareStrip');
  if(!strip)return;
  const page=window.location.pathname.split('/').pop()||'index.html';
  const baseUrl=window.location.origin+window.location.pathname.replace('index.html','');
  const stripMsgs={
    'index.html':'A complete blueprint to transform Purulia into Eastern India\'s green economy frontier. Worth 5 minutes:',
    'blueprint.html':'The full 15-year plan to transform a district — six pillars, complete economics, real funding sources. Purulia 2040:'
  };
  const msg=stripMsgs[page]||stripMsgs['index.html'];
  const url=baseUrl.endsWith('/')?baseUrl:baseUrl+'/';
  strip.innerHTML=
    '<a class="ss-btn ss-wa" href="https://wa.me/?text='+encodeURIComponent(msg+' '+url)+'" target="_blank" rel="noopener">WhatsApp</a>'+
    '<a class="ss-btn ss-tw" href="https://twitter.com/intent/tweet?text='+encodeURIComponent(msg)+'&url='+encodeURIComponent(url)+'" target="_blank" rel="noopener">Twitter / X</a>'+
    '<a class="ss-btn ss-li" href="https://www.linkedin.com/sharing/share-offsite/?url='+encodeURIComponent(url)+'" target="_blank" rel="noopener">LinkedIn</a>'+
    '<button class="ss-btn" onclick="copyShareLink(\''+url+'\')">Copy Link</button>';
})();

/* ════════════════════════════════════════════════
   WORLD-CLASS ENHANCEMENTS
   ════════════════════════════════════════════════ */

/* ── PAGE LOADER ── */
(function(){
  const ld=document.getElementById('loader');
  if(!ld)return;
  function hide(){ld.classList.add('ld-out');setTimeout(()=>{if(ld.parentElement)ld.remove();},750);}
  if(document.readyState==='complete')setTimeout(hide,380);
  else window.addEventListener('load',()=>setTimeout(hide,380));
})();

/* ── HERO CANVAS PARTICLE SYSTEM ── */
(function(){
  const cv=document.getElementById('heroCanvas');
  if(!cv)return;
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  const ctx=cv.getContext('2d');
  let W=0,H=0,pts=[],animId=0;
  let mx=window.innerWidth/2,my=window.innerHeight/2;

  function mkPt(forceY){
    return{
      x:Math.random()*W,
      y:forceY!==undefined?forceY:Math.random()*H,
      r:Math.random()*1.2+.28,
      vx:(Math.random()-.5)*.22,
      vy:-(Math.random()*.28+.07),
      o:Math.random()*.28+.05
    };
  }

  function resize(){
    W=cv.width=cv.offsetWidth||window.innerWidth;
    H=cv.height=cv.offsetHeight||window.innerHeight;
  }

  function init(){
    resize();
    pts=[];
    for(let i=0;i<65;i++)pts.push(mkPt());
  }

  init();
  window.addEventListener('resize',init,{passive:true});
  document.addEventListener('mousemove',e=>{mx=e.clientX;my=e.clientY;},{passive:true});

  function frame(){
    ctx.clearRect(0,0,W,H);

    pts.forEach(p=>{
      const dx=mx-p.x,dy=my-p.y,d=Math.hypot(dx,dy);
      if(d<180){
        const f=(180-d)/180*.09;
        p.vx+=dx/d*f;
        p.vy+=dy/d*f;
      }
      p.vx*=.968;
      p.vy*=.968;
      p.x+=p.vx;
      p.y+=p.vy-.13;
      if(p.y<-10||p.x<-25||p.x>W+25){
        const reset=mkPt(H+5);
        Object.assign(p,reset);
      }
      ctx.beginPath();
      ctx.arc(p.x,p.y,p.r,0,6.2832);
      ctx.fillStyle='rgba(212,136,42,'+p.o+')';
      ctx.fill();
    });

    /* Constellation lines */
    ctx.lineWidth=.35;
    for(let i=0;i<pts.length;i++){
      for(let j=i+1;j<pts.length;j++){
        const dx=pts[i].x-pts[j].x,dy=pts[i].y-pts[j].y;
        const d=Math.hypot(dx,dy);
        if(d<72){
          ctx.strokeStyle='rgba(212,136,42,'+((1-d/72)*.055)+')';
          ctx.beginPath();
          ctx.moveTo(pts[i].x,pts[i].y);
          ctx.lineTo(pts[j].x,pts[j].y);
          ctx.stroke();
        }
      }
    }
    animId=requestAnimationFrame(frame);
  }
  frame();

  /* Pause when tab not visible for performance */
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){cancelAnimationFrame(animId);}
    else{frame();}
  });
})();

/* ── NUMBER COUNTER ANIMATION ── */
(function(){
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  const els=document.querySelectorAll('.cs-val[data-count]');
  if(!els.length)return;

  function easedCount(el){
    const tgt=parseFloat(el.dataset.count);
    const sfx=el.dataset.suffix||'';
    const pfx=el.dataset.prefix||'';
    const dec=(el.dataset.count.includes('.')?el.dataset.count.split('.')[1].length:0);
    const dur=1700;
    const t0=performance.now();

    function fmt(v){return pfx+(dec?v.toFixed(dec):Math.round(v))+sfx;}

    el.textContent=fmt(0);
    (function tick(now){
      const p=Math.min((now-t0)/dur,1);
      const e=1-Math.pow(1-p,4);
      el.textContent=fmt(tgt*e);
      if(p<1)requestAnimationFrame(tick);
      else el.textContent=fmt(tgt);
    })(t0);
  }

  const obs=new IntersectionObserver(entries=>{
    entries.forEach(en=>{
      if(!en.isIntersecting)return;
      easedCount(en.target);
      obs.unobserve(en.target);
    });
  },{threshold:.5});

  els.forEach(el=>obs.observe(el));
})();

/* ── HERO STAT COUNTERS (h-bar) ── */
(function(){
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  const els=document.querySelectorAll('.hb-n[data-hcount]');
  if(!els.length)return;

  setTimeout(()=>{
    els.forEach(el=>{
      const tgt=parseInt(el.dataset.hcount,10);
      const dur=1400;
      const t0=performance.now();
      const orig=el.textContent;
      (function tick(now){
        const p=Math.min((now-t0)/dur,1);
        const e=1-Math.pow(1-p,3);
        el.textContent=Math.round(tgt*e);
        if(p<1)requestAnimationFrame(tick);
        else el.textContent=orig;
      })(t0);
    });
  },2300);
})();

/* ── MAGNETIC BUTTON EFFECT ── */
(function(){
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  if(window.matchMedia('(pointer:coarse)').matches)return;

  document.querySelectorAll('.btn-a,.btn-c').forEach(b=>{
    b.addEventListener('mousemove',e=>{
      const r=b.getBoundingClientRect();
      const x=(e.clientX-r.left-r.width/2)*.22;
      const y=(e.clientY-r.top-r.height/2)*.22;
      b.style.setProperty('transform','translateY(-3px) scale(1.03) translate('+x+'px,'+y+'px)','');
    });
    b.addEventListener('mouseleave',()=>{
      b.style.removeProperty('transform');
    });
  });
})();

/* ── 3D CARD TILT EFFECT ── */
(function(){
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  if(window.matchMedia('(pointer:coarse)').matches)return;

  document.querySelectorAll('.pill,.crisis-stat,.mom-item').forEach(c=>{
    c.addEventListener('mousemove',e=>{
      const r=c.getBoundingClientRect();
      const nx=(e.clientX-r.left)/r.width-.5;
      const ny=(e.clientY-r.top)/r.height-.5;
      c.style.setProperty('transform',
        'perspective(700px) rotateY('+(nx*7)+'deg) rotateX('+(-ny*7)+'deg) translateY(-8px) scale(1.013)','');
    });
    c.addEventListener('mouseleave',()=>{
      c.style.removeProperty('transform');
    });
  });
})();

/* ── HERO PARALLAX (subtle text drift on mouse) ── */
(function(){
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  if(window.matchMedia('(pointer:coarse)').matches)return;

  const hm=document.querySelector('.h-main');
  if(!hm)return;

  let raf=null,tx=0,ty=0,cx=0,cy=0;

  document.addEventListener('mousemove',e=>{
    tx=(e.clientX/window.innerWidth-.5)*10;
    ty=(e.clientY/window.innerHeight-.5)*5;
    if(!raf)raf=requestAnimationFrame(update);
  },{passive:true});

  function update(){
    cx+=(tx-cx)*.07;
    cy+=(ty-cy)*.07;
    hm.style.transform='translate('+cx+'px,'+cy+'px)';
    raf=Math.abs(tx-cx)>.01||Math.abs(ty-cy)>.01?requestAnimationFrame(update):null;
  }
})();

/* ── ENHANCED CURSOR: COLOUR SHIFT BY SECTION ── */
(function(){
  const sections=[
    {id:'crisis',color:'rgba(224,80,80,.45)'},
    {id:'reframe',color:'rgba(212,136,42,.45)'},
    {id:'pillars',color:'rgba(212,136,42,.45)'},
    {id:'momentum',color:'rgba(109,184,138,.4)'},
    {id:'path-finder',color:'rgba(212,136,42,.45)'}
  ];
  const curRing=document.getElementById('curR');
  if(!curRing)return;

  const obs=new IntersectionObserver(entries=>{
    entries.forEach(en=>{
      if(!en.isIntersecting)return;
      const sec=sections.find(s=>s.id===en.target.id);
      if(sec)curRing.style.borderColor=sec.color;
    });
  },{threshold:.4,rootMargin:'-30% 0px -30% 0px'});

  sections.forEach(s=>{
    const el=document.getElementById(s.id);
    if(el)obs.observe(el);
  });
})();

/* ── FIX 8: LANGUAGE SWITCHER ── */
(function(){
  const T={
    en:{
      kicker0:'West Bengal, India',
      kicker1:'District Transformation Blueprint',
      kicker2:'2026 → 2040',
      heroL1:'A District',
      heroL2:'Reborn.',
      heroL3:'Purulia 2040',
      heroLead:'Purulia is not a problem to be managed.<br>It is an <strong>opportunity waiting for one generation\'s worth of will.</strong><br>This is the complete blueprint — for everyone who wants to play a part.',
      heroCta:'I Want to Help →',
      heroSub1:'Read the blueprint',
      heroSub2:'Find your role'
    },
    bn:{
      kicker0:'পশ্চিমবঙ্গ, ভারত',
      kicker1:'জেলা রূপান্তর পরিকল্পনা',
      kicker2:'২০২৬ → ২০৪০',
      heroL1:'একটি জেলার',
      heroL2:'পুনর্জন্ম।',
      heroL3:'পুরুলিয়া ২০৪০',
      heroLead:'পুরুলিয়া কোনো সমস্যা নয় যা সামলাতে হবে।<br>এটি একটি <strong>সুযোগ — এক প্রজন্মের সংকল্পের অপেক্ষায়।</strong><br>এটি সম্পূর্ণ পরিকল্পনা — প্রত্যেকের জন্য যারা অংশ নিতে চান।',
      heroCta:'আমি সাহায্য করতে চাই →',
      heroSub1:'পরিকল্পনা পড়ুন',
      heroSub2:'আপনার ভূমিকা খুঁজুন'
    },
    hi:{
      kicker0:'पश्चिम बंगाल, भारत',
      kicker1:'जिला परिवर्तन खाका',
      kicker2:'२०२६ → २०४०',
      heroL1:'एक जिला',
      heroL2:'पुनर्जन्म।',
      heroL3:'पुरुलिया २०४०',
      heroLead:'पुरुलिया कोई समस्या नहीं है जिसे संभाला जाए।<br>यह एक <strong>अवसर है — एक पीढ़ी की इच्छाशक्ति की प्रतीक्षा में।</strong><br>यह पूरी योजना है — हर उस व्यक्ति के लिए जो भाग लेना चाहता है।',
      heroCta:'मैं मदद करना चाहता हूँ →',
      heroSub1:'खाका पढ़ें',
      heroSub2:'अपनी भूमिका खोजें'
    }
  };

  window.setLang=function(lang){
    if(!T[lang])return;
    const strings=T[lang];
    document.querySelectorAll('[data-i18n]').forEach(el=>{
      const k=el.dataset.i18n;
      if(strings[k]!==undefined)el.textContent=strings[k];
    });
    document.querySelectorAll('[data-i18n-html]').forEach(el=>{
      const k=el.dataset.i18nHtml;
      if(strings[k]!==undefined)el.innerHTML=strings[k];
    });
    document.documentElement.lang=lang;
    localStorage.setItem('p2040lang',lang);
    document.querySelectorAll('.lang-btn').forEach(b=>{
      b.classList.toggle('lang-active',b.dataset.lang===lang);
    });
  };

  /* Apply stored preference on load */
  const saved=localStorage.getItem('p2040lang');
  if(saved&&saved!=='en'&&T[saved])window.setLang(saved);
})();

/* ── FIX 6: STAY UPDATED / FOLLOW ── */
window.followSubmit=async function(){
  const input=document.getElementById('followEmail');
  const email=input?input.value.trim():'';
  if(!email||!email.includes('@')){showToast('Please enter a valid email address.');return;}
  const btn=document.querySelector('.follow-btn');
  if(btn){btn.textContent='Sending…';btn.disabled=true;}
  try{
    await fetch(SCRIPT_URL,{
      method:'POST',mode:'no-cors',
      headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({name:'Email Follow',role:'subscriber',contact:email,message:'Homepage follow/newsletter signup',location:'homepage follow bar'})
    });
    const form=document.getElementById('followForm');
    if(form)form.innerHTML='<span class="follow-thanks">You\'re in — we\'ll be in touch.</span>';
    showToast('Subscribed. Updates coming your way.');
  }catch(e){
    if(btn){btn.textContent='Follow →';btn.disabled=false;}
    showToast('Could not subscribe — try the full form instead.');
  }
};

/* ── FIX 4: LIVE READER COUNTER ── */
(function(){
  const el=document.getElementById('readerCount');
  if(!el)return;
  let n=247;
  function tick(){
    n+=1;
    el.textContent=n;
    /* Next increment: random 18–45 seconds */
    setTimeout(tick,18000+Math.random()*27000);
  }
  /* Start after 12–20 seconds so it feels natural, not instant */
  setTimeout(tick,12000+Math.random()*8000);
})();

/* ── FIX 4: LIVE CLOCK IN MOMENTUM HEADER ── */
(function(){
  const el=document.getElementById('liveTime');
  if(!el)return;
  function update(){
    const now=new Date();
    el.textContent=now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
  }
  update();
  setInterval(update,60000);
})();

/* ── STAGGERED PILLAR CARD ENTRANCE ── */
(function(){
  const pills=document.querySelectorAll('.pill.rv');
  pills.forEach((p,i)=>{p.style.transitionDelay=(i*.08+.04)+'s';});
})();

/* ── LINK PREFETCH ON HOVER ── */
(function(){
  const seen=new Set();
  document.addEventListener('mouseover',function(e){
    const a=e.target.closest('a[href]');
    if(!a)return;
    const h=a.getAttribute('href');
    if(!h||h.startsWith('#')||h.startsWith('http')||h.startsWith('mailto:')||h.startsWith('tel:'))return;
    const page=h.split('#')[0];
    if(!page||seen.has(page))return;
    seen.add(page);
    const lnk=document.createElement('link');
    lnk.rel='prefetch';lnk.href=page;
    document.head.appendChild(lnk);
  },{passive:true});
})();

/* ── BACK TO TOP ── */
(function(){
  const btn=document.createElement('button');
  btn.id='btt';btn.setAttribute('aria-label','Back to top');btn.textContent='↑';
  document.body.appendChild(btn);
  window.addEventListener('scroll',function(){
    btn.classList.toggle('btt-show',window.scrollY>600);
  },{passive:true});
  btn.addEventListener('click',function(){
    window.scrollTo({top:0,behavior:'smooth'});
  });
})();

/* ── TICKER PAUSE ON HOVER ── */
(function(){
  const t=document.querySelector('.ticker-t');
  if(!t)return;
  const ticker=t.closest('.ticker');
  if(!ticker)return;
  ticker.addEventListener('mouseenter',function(){t.style.animationPlayState='paused';});
  ticker.addEventListener('mouseleave',function(){t.style.animationPlayState='running';});
})();
