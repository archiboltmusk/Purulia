/* ══════════════════════════════════════════════════════════
   PURULIA 2040 — SHARED RUNTIME  (patched)
   ══════════════════════════════════════════════════════════ */

/* ── Global modal flag ──
   Any overlay that opens (palette, help, share popup) sets this.
   Global keydown handlers check it before acting, so keys don't
   fire into the wrong modal. */
window.__pkModal = null;

/* ── Escape helper (used by popups / palette) ── */
function escHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

/* ── Page Transitions ── */
(function(){
  var de=document.documentElement;
  var rm=window.matchMedia('(prefers-reduced-motion:reduce)').matches;

  /* SAFETY: if we faded out on the previous page but the pgt flag is
     stuck (e.g. script crashed), force opacity back to 1 after 3s. */
  if(sessionStorage.getItem('pgt')){
    setTimeout(function(){ de.style.opacity='1'; }, 3000);
  }

  if(sessionStorage.getItem('pgt')){
    sessionStorage.removeItem('pgt');
    if(!rm){
      de.style.transition='opacity .28s ease';
      requestAnimationFrame(function(){requestAnimationFrame(function(){de.style.opacity='1';});});
    } else {
      de.style.opacity='1';
    }
  }

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

/* ── Cursor ──
   Skip on touch devices and when #cur/#curR are missing. */
(function(){
  var cur=document.getElementById('cur'), curR=document.getElementById('curR');
  if(!cur || !curR) return;
  if(window.matchMedia('(pointer:coarse)').matches) return;

  var mx=window.innerWidth/2, my=window.innerHeight/2, rx=mx, ry=my;

  document.addEventListener('mousemove',function(e){
    mx=e.clientX; my=e.clientY;
    cur.style.left=mx+'px'; cur.style.top=my+'px';
  },{passive:true});

  (function anim(){
    rx+=(mx-rx)*.11; ry+=(my-ry)*.11;
    curR.style.left=rx+'px'; curR.style.top=ry+'px';
    requestAnimationFrame(anim);
  })();

  /* FIX: delegated hover — works for elements added after load
     (share popup buttons, WhatsApp float, back-to-top, etc.) */
  document.addEventListener('mouseover',function(e){
    var el=e.target.closest('a,button,select,input,textarea');
    if(!el || el._curHover) return;
    el._curHover=true;
    curR.style.width='44px'; curR.style.height='44px';
    curR.style.borderColor='rgba(212,136,42,.9)';
  },{passive:true});

  document.addEventListener('mouseout',function(e){
    var el=e.target.closest('a,button,select,input,textarea');
    if(!el || !el._curHover) return;
    el._curHover=false;
    curR.style.width='28px'; curR.style.height='28px';
    curR.style.borderColor='rgba(212,136,42,.45)';
  },{passive:true});
})();

/* ── Progress bar ── */
(function(){
  var pb=document.getElementById('pbar');
  if(!pb) return;
  window.addEventListener('scroll',function(){
    pb.style.width=(window.scrollY/(document.body.scrollHeight-window.innerHeight)*100)+'%';
  },{passive:true});
})();

/* ── Reveal ── */
(function(){
  var rvs=document.querySelectorAll('.rv');
  if(!rvs.length) return;
  var rvo=new IntersectionObserver(function(es){
    es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('on');rvo.unobserve(e.target);}});
  },{threshold:.07});
  rvs.forEach(function(el,i){el.style.transitionDelay=(i%5)*.06+'s';rvo.observe(el);});
})();

/* ── Deep dive accordion ── */
function tog(id){
  var card=document.getElementById(id);
  if(!card) return;
  var body=card.querySelector('.ddb');
  if(!body) return;
  var isOpen=card.classList.contains('open');
  document.querySelectorAll('.ddc').forEach(function(c){
    c.classList.remove('open');
    var b=c.querySelector('.ddb'); if(b) b.style.maxHeight='0';
  });
  if(!isOpen){
    card.classList.add('open');
    body.style.maxHeight=body.scrollHeight+'px';
    setTimeout(function(){if(card.classList.contains('open'))body.style.maxHeight=body.scrollHeight+'px';},400);
  }
}

/* ── Audience selector ── */
function showAud(id,btn){
  document.querySelectorAll('.aud-panel').forEach(function(p){p.classList.remove('active');});
  document.querySelectorAll('.aud-btn').forEach(function(b){b.classList.remove('active');});
  var panel=document.getElementById('aud-'+id);
  if(panel)panel.classList.add('active');
  if(btn)btn.classList.add('active');
  history.replaceState(null,'','#aud-'+id);
}

/* ── Share section ── */
var shareMsgs={
  doctors:'77.9% of young children anaemic. 38 infant deaths per 1,000 births, twice the state rate. Purulia needs doctors — send this to every doctor from Purulia you know:',
  engineers:'Build water systems from scratch. Design solar grids for tribal hamlets. First-principles engineering that actually matters. Purulia 2040:',
  architects:'A district being redesigned from zero. Medical college, railway station, crafts cluster — all open briefs, right now. Purulia 2040:',
  politicians:'The schemes exist. Purulia still ranks last in West Bengal on child anaemia and women\'s literacy. This blueprint shows how to deliver:',
  students:'Every system is telling young people from Purulia to leave. This is the counter-argument — share with every student you know:',
  entrepreneurs:'Structural gaps mean first-mover advantages. The enterprise case for Purulia 2040:',
  business:'Dry laterite land, a state single window for clearances, and forest produce that leaves the district raw. The business case for Purulia 2040:',
  artists:'Chhau is on UNESCO\'s heritage list. Dokra is an ancient lost-wax craft. The world wants what Purulia has — it just doesn\'t know where to find it yet:',
  diaspora:'For everyone from Purulia who left. The sentence "there\'s nothing here for someone with ambition" is becoming past tense:',
  impact:'If this model works in Purulia, it can work in similar districts across India. A case for patient impact capital:'
};

function shareSection(id){
  var url=window.location.origin+window.location.pathname+'#aud-'+id;
  var msg=shareMsgs[id]||'A complete transformation blueprint for Purulia, West Bengal — Purulia 2040:';

  if(navigator.share&&/Mobi|Android/i.test(navigator.userAgent)){
    navigator.share({title:'Purulia 2040',text:msg,url:url});
    return;
  }

  var existing=document.getElementById('sharePopup');
  if(existing)existing.remove();

  var wa='https://wa.me/?text='+encodeURIComponent(msg+' '+url);
  var tw='https://twitter.com/intent/tweet?text='+encodeURIComponent(msg)+'&url='+encodeURIComponent(url);
  var li='https://www.linkedin.com/sharing/share-offsite/?url='+encodeURIComponent(url);

  var popup=document.createElement('div');
  popup.id='sharePopup';
  popup.setAttribute('role','dialog');
  popup.setAttribute('aria-label','Share this note');
  popup.innerHTML=
    '<button class="sp-close" aria-label="Close">✕</button>'+
    '<div class="sp-title">Share this note</div>'+
    '<div class="sp-msg">'+escHtml(msg)+'</div>'+
    '<div class="sp-btns">'+
      '<a class="sp-btn sp-wa" href="'+wa+'" target="_blank" rel="noopener">WhatsApp</a>'+
      '<a class="sp-btn sp-tw" href="'+tw+'" target="_blank" rel="noopener">Twitter / X</a>'+
      '<a class="sp-btn sp-li" href="'+li+'" target="_blank" rel="noopener">LinkedIn</a>'+
      '<button class="sp-btn" data-copy="'+escHtml(url)+'">Copy Link</button>'+
    '</div>';
  document.body.appendChild(popup);
  window.__pkModal='share';
  setTimeout(function(){popup.classList.add('sp-show');},10);

  popup.querySelector('.sp-close').addEventListener('click',function(){
    popup.remove(); if(window.__pkModal==='share')window.__pkModal=null;
  });
  popup.querySelector('[data-copy]').addEventListener('click',function(){
    copyShareLink(this.getAttribute('data-copy'));
  });

  /* Auto-dismiss after 15s (was 8) */
  setTimeout(function(){
    if(popup.parentElement) popup.remove();
    if(window.__pkModal==='share') window.__pkModal=null;
  },15000);
}

function copyShareLink(url){
  navigator.clipboard.writeText(url).then(function(){
    showToast('Link copied to clipboard');
    var p=document.getElementById('sharePopup');
    if(p){p.remove(); if(window.__pkModal==='share')window.__pkModal=null;}
  });
}

/* ── Toast ── */
var toastTimer=null;
function showToast(msg){
  var t=document.getElementById('toast');
  if(!t){ console.warn('showToast:', msg); return; }
  clearTimeout(toastTimer);
  t.textContent=msg;
  t.classList.add('show');
  toastTimer=setTimeout(function(){t.classList.remove('show');},2800);
}

/* ── Form submit — saved privately in Supabase (only moderators can read it) ── */
async function p2040Submit(fields){
  var c=window.KASA_CONFIG||{};
  if(!c.SUPABASE_URL||!c.SUPABASE_ANON_KEY) throw new Error('Form not configured.');
  var res=await fetch(c.SUPABASE_URL+'/rest/v1/rpc/p2040_submit',{
    method:'POST',
    headers:{'Content-Type':'application/json',apikey:c.SUPABASE_ANON_KEY,Authorization:'Bearer '+c.SUPABASE_ANON_KEY},
    body:JSON.stringify(fields)
  });
  if(!res.ok){
    var detail='';
    try{detail=(await res.json()).details||'';}catch(e){}
    var err=new Error(detail||'Could not send.'); err.fromServer=!!detail; throw err;
  }
}

async function submitForm(){
  var nameEl=document.getElementById('f-name');
  var roleEl=document.getElementById('f-role');
  var locEl =document.getElementById('f-location');
  var msgEl =document.getElementById('f-message');
  var conEl =document.getElementById('f-contact');
  if(!nameEl||!roleEl||!conEl) return;

  var name=nameEl.value.trim();
  var role=roleEl.value;
  var location=locEl?locEl.value.trim():'';
  var message=msgEl?msgEl.value.trim():'';
  var contact=conEl.value.trim();

  if(!name||!role||!contact){
    showToast('Please fill in your name, role, and contact');
    return;
  }

  var btn=document.querySelector('.form-submit');
  if(btn){btn.disabled=true;btn.textContent='Sending…';}

  try{
    await p2040Submit({p_kind:'join', p_name:name, p_role:role, p_location:location||null, p_contact:contact, p_message:message||null});

    var wrap=document.getElementById('formWrap');
    var fs=document.getElementById('formSuccess');
    if(wrap) wrap.style.display='none';
    if(fs)  fs.style.display='block';
    var fsName=document.getElementById('fsName');
    if(fsName) fsName.textContent='Thank you, '+name+'.';
    var dots=fs?fs.querySelectorAll('.fs-tl-dot'):[];
    if(dots[0]){setTimeout(function(){dots[0].parentElement.classList.add('fs-done');},200);}
    var shareBtns=document.getElementById('fsShareBtns');
    if(shareBtns){
      var url=window.location.origin+(window.location.pathname.includes('join')?window.location.pathname.replace('join.html',''):window.location.pathname);
      var msg='I just connected with the Purulia 2040 blueprint team. If you care about transforming a district — read this:';
      shareBtns.innerHTML=
        '<a class="ss-btn ss-wa" href="https://wa.me/?text='+encodeURIComponent(msg+' '+url)+'" target="_blank" rel="noopener">WhatsApp</a>'+
        '<a class="ss-btn ss-tw" href="https://twitter.com/intent/tweet?text='+encodeURIComponent(msg)+'&url='+encodeURIComponent(url)+'" target="_blank" rel="noopener">Twitter</a>'+
        '<a class="ss-btn ss-li" href="https://www.linkedin.com/sharing/share-offsite/?url='+encodeURIComponent(url)+'" target="_blank" rel="noopener">LinkedIn</a>';
    }
    showToast('Welcome, '+name+'. We\'ll respond personally within 48 hours.');
  }catch(err){
    if(btn){btn.disabled=false;btn.textContent='I Want to Be Part of This →';}
    showToast(err.fromServer?err.message:'Could not send — please email thelosthillproject@gmail.com directly.');
  }
}

/* ── Bar chart animation ── */
(function(){
  var barObs=new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(e.isIntersecting){
        e.target.querySelectorAll('.bar-fill').forEach(function(b,i){
          setTimeout(function(){b.style.width=b.dataset.w+'%';},i*150);
        });
        barObs.unobserve(e.target);
      }
    });
  },{threshold:.3});
  document.querySelectorAll('.chart-wrap').forEach(function(c){barObs.observe(c);});
})();

/* ── Handle hash on load ── */
window.addEventListener('load',function(){
  var hash=window.location.hash;
  if(!hash)return;
  if(hash==='#groundtruth'){
    var gt=document.getElementById('groundtruth');
    if(gt) gt.scrollIntoView();
    return;
  }
  if(hash.startsWith('#aud-')){
    var id=hash.replace('#aud-','');
    var btn=document.querySelector('.aud-btn[onclick*="\''+id+'\'"]');
    showAud(id,btn);
    setTimeout(function(){
      var sec=document.getElementById('audience');
      if(sec)sec.scrollIntoView({behavior:'smooth'});
    },150);
    return;
  }
  var el=document.querySelector(hash);
  if(el)el.scrollIntoView();
});

/* ── Nav dropdown ── */
function toggleMenu(){
  var t=document.getElementById('navToggle');
  var d=document.getElementById('navDropdown');
  if(!t||!d)return;
  t.classList.toggle('open');
  d.classList.toggle('open');
}
document.addEventListener('click',function(e){
  if(!e.target.closest('.nav-mob')){
    var t=document.getElementById('navToggle');
    var d=document.getElementById('navDropdown');
    if(t)t.classList.remove('open');
    if(d)d.classList.remove('open');
  }
});

/* Active page highlight */
(function(){
  var p=window.location.pathname.split('/').pop()||'index.html';
  document.querySelectorAll('.nd-item').forEach(function(a){
    if(a.getAttribute('href')===p)a.classList.add('nd-active');
  });
  document.querySelectorAll('.nl-item').forEach(function(a){
    if(a.getAttribute('href')===p)a.classList.add('nl-active');
  });
})();

/* ── WhatsApp floating share button ── */
(function(){
  var pageMsgs={
    'index.html':'A complete blueprint to transform an entire district — Purulia 2040. Worth reading and sharing:',
    'blueprint.html':'The full 15-year blueprint for transforming Purulia. Six pillars, complete economics — read it:',
    'audience.html':'This blueprint for Purulia 2040 was written for every kind of person who can help. Find your role:',
    'data.html':'The hard data on Purulia — why this district is primed for transformation right now:',
    'join.html':'This blueprint needs people, not just readers. Here\'s how to get involved with Purulia 2040:',
    'map.html':'Explore every project and zone in the Purulia 2040 transformation plan — interactive map:',
    'kasa.html':'Purulia Kasa — report garbage in 30 seconds and hold your ward accountable. Try it:'
  };
  var page=window.location.pathname.split('/').pop()||'index.html';
  var msg=pageMsgs[page]||'A complete transformation blueprint for Purulia, West Bengal:';
  var url=window.location.origin+(window.location.pathname.includes('index.html')?window.location.pathname.replace('index.html',''):window.location.pathname);

  var btn=document.createElement('a');
  btn.id='waFloat';
  btn.href='https://wa.me/?text='+encodeURIComponent(msg+' '+url);
  btn.target='_blank';
  btn.rel='noopener noreferrer';
  btn.setAttribute('aria-label','Share on WhatsApp');
  btn.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg><span>Share</span>';
  document.body.appendChild(btn);

  /* Dismissable close button */
  var close=document.createElement('button');
  close.className='wa-close';
  close.setAttribute('aria-label','Dismiss share button');
  close.textContent='✕';
  btn.appendChild(close);
  close.addEventListener('click',function(e){
    e.preventDefault();
    e.stopPropagation();
    btn.remove();
  });

  var shown=false;
  window.addEventListener('scroll',function(){
    var pct=window.scrollY/(document.body.scrollHeight-window.innerHeight||1);
    if(!shown&&pct>.22){shown=true;btn.classList.add('wa-show');}
  },{passive:true});
})();

/* ── Inline share strip population ── */
(function(){
  var strip=document.getElementById('shareStrip');
  if(!strip)return;
  var page=window.location.pathname.split('/').pop()||'index.html';
  var baseUrl=window.location.origin+window.location.pathname.replace('index.html','');
  var stripMsgs={
    'index.html':'A complete blueprint to transform Purulia into Eastern India\'s green economy frontier. Worth 5 minutes:',
    'blueprint.html':'The full 15-year plan to transform a district — six pillars, complete economics, real funding sources. Purulia 2040:'
  };
  var msg=stripMsgs[page]||stripMsgs['index.html'];
  var url=baseUrl.endsWith('/')?baseUrl:baseUrl+'/';
  strip.innerHTML=
    '<a class="ss-btn ss-wa" href="https://wa.me/?text='+encodeURIComponent(msg+' '+url)+'" target="_blank" rel="noopener">WhatsApp</a>'+
    '<a class="ss-btn ss-tw" href="https://twitter.com/intent/tweet?text='+encodeURIComponent(msg)+'&url='+encodeURIComponent(url)+'" target="_blank" rel="noopener">Twitter / X</a>'+
    '<a class="ss-btn ss-li" href="https://www.linkedin.com/sharing/share-offsite/?url='+encodeURIComponent(url)+'" target="_blank" rel="noopener">LinkedIn</a>'+
    '<button class="ss-btn" data-copy="'+escHtml(url)+'">Copy Link</button>';
  strip.querySelector('[data-copy]').addEventListener('click',function(){
    copyShareLink(this.getAttribute('data-copy'));
  });
})();

/* ════════════════════════════════════════════════
   ENHANCEMENTS
   ════════════════════════════════════════════════ */

/* ── PAGE LOADER — hard cap at 2.5s ── */
(function(){
  var ld=document.getElementById('loader');
  if(!ld)return;
  var done=false;
  function hide(){
    if(done) return;
    done=true;
    ld.classList.add('ld-out');
    setTimeout(function(){if(ld.parentElement)ld.remove();},750);
  }
  var cap=setTimeout(hide,2500);
  if(document.readyState==='complete')setTimeout(hide,380);
  else window.addEventListener('load',function(){setTimeout(hide,380);});
})();

/* ── HERO CANVAS PARTICLE SYSTEM (lighter on mobile) ── */
(function(){
  var cv=document.getElementById('heroCanvas');
  if(!cv)return;
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;

  var ctx=cv.getContext('2d');
  var W=0,H=0,pts=[],animId=0;
  var isMobile=window.innerWidth<768;
  var COUNT=isMobile?28:65;
  var DO_LINES=!isMobile;
  var mx=window.innerWidth/2,my=window.innerHeight/2;

  function mkPt(forceY){
    return{
      x:Math.random()*W,
      y:forceY!==undefined?forceY:Math.random()*H,
      r:Math.random()*2.2+.7,
      vx:(Math.random()-.5)*.22,
      vy:-(Math.random()*.28+.07),
      o:Math.random()*.5+.18
    };
  }
  function resize(){
    var dpr=window.devicePixelRatio||1;
    W=cv.offsetWidth||window.innerWidth;
    H=cv.offsetHeight||window.innerHeight;
    cv.width=W*dpr;cv.height=H*dpr;
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  function init(){
    resize();
    pts=[];
    for(var i=0;i<COUNT;i++)pts.push(mkPt());
  }
  init();
  window.addEventListener('resize',init,{passive:true});
  document.addEventListener('mousemove',function(e){mx=e.clientX;my=e.clientY;},{passive:true});

  function frame(){
    ctx.clearRect(0,0,W,H);
    pts.forEach(function(p){
      var dx=mx-p.x, dy=my-p.y, d=Math.hypot(dx,dy);
      if(d<180){
        var f=(180-d)/180*.09;
        p.vx+=dx/d*f; p.vy+=dy/d*f;
      }
      p.vx*=.968; p.vy*=.968;
      p.x+=p.vx; p.y+=p.vy-.13;
      if(p.y<-10||p.x<-25||p.x>W+25){
        Object.assign(p,mkPt(H+5));
      }
      ctx.beginPath();
      ctx.arc(p.x,p.y,p.r,0,6.2832);
      ctx.fillStyle='rgba(212,136,42,'+p.o+')';
      ctx.fill();
    });

    if(DO_LINES){
      ctx.lineWidth=.35;
      for(var i=0;i<pts.length;i++){
        for(var j=i+1;j<pts.length;j++){
          var dx=pts[i].x-pts[j].x, dy=pts[i].y-pts[j].y;
          var d=Math.hypot(dx,dy);
          if(d<72){
            ctx.strokeStyle='rgba(212,136,42,'+((1-d/72)*.13)+')';
            ctx.beginPath();
            ctx.moveTo(pts[i].x,pts[i].y);
            ctx.lineTo(pts[j].x,pts[j].y);
            ctx.stroke();
          }
        }
      }
    }
    animId=requestAnimationFrame(frame);
  }
  frame();
  document.addEventListener('visibilitychange',function(){
    if(document.hidden){cancelAnimationFrame(animId);}
    else{frame();}
  });
})();

/* ── NUMBER COUNTER ANIMATION ── */
(function(){
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  var els=document.querySelectorAll('.cs-val[data-count]');
  if(!els.length)return;

  function easedCount(el){
    var tgt=parseFloat(el.dataset.count);
    var sfx=el.dataset.suffix||'';
    var pfx=el.dataset.prefix||'';
    var dec=(el.dataset.count.indexOf('.')>=0)?el.dataset.count.split('.')[1].length:0;
    var dur=1700;
    var t0=performance.now();
    function fmt(v){return pfx+(dec?v.toFixed(dec):Math.round(v))+sfx;}
    el.textContent=fmt(0);
    (function tick(now){
      var p=Math.min((now-t0)/dur,1);
      var e=1-Math.pow(1-p,4);
      el.textContent=fmt(tgt*e);
      if(p<1)requestAnimationFrame(tick);
      else el.textContent=fmt(tgt);
    })(t0);
  }

  var obs=new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if(!en.isIntersecting)return;
      easedCount(en.target);
      obs.unobserve(en.target);
    });
  },{threshold:.5});
  els.forEach(function(el){obs.observe(el);});
})();

/* ── HERO STAT COUNTERS (h-bar) ── */
(function(){
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  var els=document.querySelectorAll('.hb-n[data-hcount]');
  if(!els.length)return;
  setTimeout(function(){
    els.forEach(function(el){
      var tgt=parseInt(el.dataset.hcount,10);
      var dur=1400;
      var t0=performance.now();
      var orig=el.textContent;
      (function tick(now){
        var p=Math.min((now-t0)/dur,1);
        var e=1-Math.pow(1-p,3);
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
  document.querySelectorAll('.btn-a,.btn-c').forEach(function(b){
    b.addEventListener('mousemove',function(e){
      var r=b.getBoundingClientRect();
      var x=(e.clientX-r.left-r.width/2)*.22;
      var y=(e.clientY-r.top-r.height/2)*.22;
      b.style.transform='translateY(-3px) scale(1.03) translate('+x+'px,'+y+'px)';
    });
    b.addEventListener('mouseleave',function(){
      b.style.removeProperty('transform');
    });
  });
})();

/* ── 3D CARD TILT EFFECT ── */
(function(){
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  if(window.matchMedia('(pointer:coarse)').matches)return;
  document.querySelectorAll('.pill,.crisis-stat,.mom-item').forEach(function(c){
    c.addEventListener('mousemove',function(e){
      var r=c.getBoundingClientRect();
      var nx=(e.clientX-r.left)/r.width-.5;
      var ny=(e.clientY-r.top)/r.height-.5;
      c.style.transform='perspective(700px) rotateY('+(nx*7)+'deg) rotateX('+(-ny*7)+'deg) translateY(-8px) scale(1.013)';
    });
    c.addEventListener('mouseleave',function(){
      c.style.removeProperty('transform');
    });
  });
})();

/* ── HERO PARALLAX ── */
(function(){
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  if(window.matchMedia('(pointer:coarse)').matches)return;
  var hm=document.querySelector('.h-main');
  if(!hm)return;
  var raf=null,tx=0,ty=0,cx=0,cy=0;
  document.addEventListener('mousemove',function(e){
    tx=(e.clientX/window.innerWidth-.5)*10;
    ty=(e.clientY/window.innerHeight-.5)*5;
    if(!raf)raf=requestAnimationFrame(update);
  },{passive:true});
  function update(){
    cx+=(tx-cx)*.07; cy+=(ty-cy)*.07;
    hm.style.transform='translate('+cx+'px,'+cy+'px)';
    raf=(Math.abs(tx-cx)>.01||Math.abs(ty-cy)>.01)?requestAnimationFrame(update):null;
  }
})();

/* ── ENHANCED CURSOR: COLOUR SHIFT BY SECTION ── */
(function(){
  var sections=[
    {id:'crisis',color:'rgba(224,80,80,.45)'},
    {id:'reframe',color:'rgba(212,136,42,.45)'},
    {id:'pillars',color:'rgba(212,136,42,.45)'},
    {id:'momentum',color:'rgba(109,184,138,.4)'},
    {id:'path-finder',color:'rgba(212,136,42,.45)'}
  ];
  var curRing=document.getElementById('curR');
  if(!curRing)return;
  var obs=new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if(!en.isIntersecting)return;
      var sec=sections.filter(function(s){return s.id===en.target.id;})[0];
      if(sec)curRing.style.borderColor=sec.color;
    });
  },{threshold:.4,rootMargin:'-30% 0px -30% 0px'});
  sections.forEach(function(s){
    var el=document.getElementById(s.id);
    if(el)obs.observe(el);
  });
})();

/* ── LANGUAGE SWITCHER ── */
(function(){
  var T={
    en:{kicker0:'West Bengal, India',kicker1:'District Transformation Blueprint',kicker2:'2026 → 2040',heroL1:'A District',heroL2:'Reborn.',heroL3:'Purulia 2040',heroLead:'Purulia is not a problem to be managed.<br>It is an <strong>opportunity waiting for one generation\'s worth of will.</strong><br>This is the complete blueprint — for everyone who wants to play a part.',heroCta:'I Want to Help →',heroSub1:'Read the blueprint',heroSub2:'Find your role'},
    bn:{kicker0:'পশ্চিমবঙ্গ, ভারত',kicker1:'জেলা রূপান্তর পরিকল্পনা',kicker2:'২০২৬ → ২০৪০',heroL1:'একটি জেলার',heroL2:'পুনর্জন্ম।',heroL3:'পুরুলিয়া ২০৪০',heroLead:'পুরুলিয়া কোনো সমস্যা নয় যা সামলাতে হবে।<br>এটি একটি <strong>সুযোগ — এক প্রজন্মের সংকল্পের অপেক্ষায়।</strong><br>এটি সম্পূর্ণ পরিকল্পনা — প্রত্যেকের জন্য যারা অংশ নিতে চান।',heroCta:'আমি সাহায্য করতে চাই →',heroSub1:'পরিকল্পনা পড়ুন',heroSub2:'আপনার ভূমিকা খুঁজুন'},
    hi:{kicker0:'पश्चिम बंगाल, भारत',kicker1:'जिला परिवर्तन खाका',kicker2:'२०२६ → २०४०',heroL1:'एक जिला',heroL2:'पुनर्जन्म।',heroL3:'पुरुलिया २०४०',heroLead:'पुरुलिया कोई समस्या नहीं है जिसे संभाला जाए।<br>यह एक <strong>अवसर है — एक पीढ़ी की इच्छाशक्ति की प्रतीक्षा में।</strong><br>यह पूरी योजना है — हर उस व्यक्ति के लिए जो भाग लेना चाहता है।',heroCta:'मैं मदद करना चाहता हूँ →',heroSub1:'खाका पढ़ें',heroSub2:'अपनी भूमिका खोजें'}
  };

  window.setLang=function(lang){
    if(!T[lang])return;
    var strings=T[lang];
    document.querySelectorAll('[data-i18n]').forEach(function(el){
      var k=el.dataset.i18n;
      if(strings[k]!==undefined)el.textContent=strings[k];
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function(el){
      var k=el.dataset.i18nHtml;
      if(strings[k]!==undefined)el.innerHTML=strings[k];
    });
    document.documentElement.lang=lang;
    localStorage.setItem('p2040lang',lang);
    document.querySelectorAll('.lang-btn').forEach(function(b){
      b.classList.toggle('lang-active',b.dataset.lang===lang);
    });
  };

  var saved=localStorage.getItem('p2040lang');
  if(saved&&saved!=='en'&&T[saved])window.setLang(saved);
})();

/* ── FOLLOW / NEWSLETTER ── */
window.followSubmit=async function(){
  var input=document.getElementById('followEmail');
  var email=input?input.value.trim():'';
  if(!email||email.indexOf('@')<0){showToast('Please enter a valid email address.');return;}
  var btn=document.querySelector('.follow-btn');
  if(btn){btn.textContent='Sending…';btn.disabled=true;}
  try{
    await p2040Submit({p_kind:'follow', p_name:null, p_role:null, p_location:null, p_contact:email, p_message:null});
    var form=document.getElementById('followForm');
    if(form)form.innerHTML='<span class="follow-thanks">You\'re in — we\'ll be in touch.</span>';
    showToast('Subscribed. Updates coming your way.');
  }catch(e){
    if(btn){btn.textContent='Follow →';btn.disabled=false;}
    showToast(e.fromServer?e.message:'Could not subscribe — try the full form instead.');
  }
};

/* ── LIVE CLOCK IN MOMENTUM HEADER (minute-aligned) ── */
(function(){
  var el=document.getElementById('liveTime');
  if(!el)return;
  function update(){
    el.textContent=new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
  }
  update();
  (function scheduleNext(){
    var now=Date.now();
    var ms=60000-(now%60000);
    setTimeout(function(){update();scheduleNext();},ms);
  })();
})();

/* ── STAGGERED PILLAR CARD ENTRANCE ── */
(function(){
  var pills=document.querySelectorAll('.pill.rv');
  pills.forEach(function(p,i){p.style.transitionDelay=(i*.08+.04)+'s';});
})();

/* ── LINK PREFETCH ON HOVER (guarded for metered connections) ── */
(function(){
  if(navigator.connection&&(navigator.connection.saveData||/2g|slow-2g/.test(navigator.connection.effectiveType)))return;
  var seen=new Set();
  document.addEventListener('mouseover',function(e){
    var a=e.target.closest('a[href]');
    if(!a)return;
    var h=a.getAttribute('href');
    if(!h||h.charAt(0)==='#'||h.startsWith('http')||h.startsWith('mailto:')||h.startsWith('tel:'))return;
    var page=h.split('#')[0];
    if(!page||seen.has(page))return;
    seen.add(page);
    var lnk=document.createElement('link');
    lnk.rel='prefetch';lnk.href=page;
    document.head.appendChild(lnk);
  },{passive:true});
})();

/* ── BACK TO TOP ── */
(function(){
  var btn=document.createElement('button');
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
  var t=document.querySelector('.ticker-t');
  if(!t)return;
  var ticker=t.closest('.ticker');
  if(!ticker)return;
  ticker.addEventListener('mouseenter',function(){t.style.animationPlayState='paused';});
  ticker.addEventListener('mouseleave',function(){t.style.animationPlayState='running';});
})();

/* ── COMMAND PALETTE (⌘K / Ctrl+K) ── */
(function(){
  var PAGES=[
    {href:'index.html',label:'Home',desc:'Overview & manifesto'},
    {href:'blueprint.html',label:'Blueprint',desc:'The 15-year plan'},
    {href:'data.html',label:'Ground Truth',desc:'Verified data & charts'},
    {href:'audience.html',label:'For You',desc:'Find your role'},
    {href:'join.html',label:'Join',desc:'Get involved'},
    {href:'map.html',label:'District Map',desc:'Interactive map'},
    {href:'blueprint.html#deepdives',label:'Deep Dives',desc:'All 6 pillars expanded'},
    {href:'blueprint.html#timeline',label:'Timeline',desc:'2026 → 2040 roadmap'},
    {href:'blueprint.html#economics',label:'Economics',desc:'Revenue projections'},
    {href:'data.html#solution-matrix',label:'Solution Matrix',desc:'Every problem, specific answer'},
    {href:'data.html#data-charts',label:'Data Charts',desc:'Visualised statistics'},
    {href:'join.html#respond',label:'Join Now',desc:'Five people. Eighteen months.'}
  ];

  var pal=document.createElement('div');
  pal.id='cmdpal';
  pal.setAttribute('role','dialog');
  pal.setAttribute('aria-modal','true');
  pal.setAttribute('aria-label','Command palette');

  var inner=document.createElement('div'); inner.id='cmdpal-inner';
  var inp=document.createElement('input');
  inp.type='text';inp.id='cmdpal-input';inp.placeholder='Go to…';
  inp.setAttribute('aria-label','Search pages');
  inp.setAttribute('autocomplete','off');
  inner.appendChild(inp);

  var res=document.createElement('div'); res.id='cmdpal-results';
  PAGES.forEach(function(p){
    var d=document.createElement('div');
    d.className='cmd-item';d.dataset.href=p.href;
    d.innerHTML=escHtml(p.label)+'<span>'+escHtml(p.desc)+'</span>';
    res.appendChild(d);
  });
  inner.appendChild(res);

  var hint=document.createElement('div');
  hint.id='cmdpal-hint';
  hint.innerHTML='<span>↑↓ navigate</span><span>↵ open</span><span>Esc close</span>';
  inner.appendChild(hint);
  pal.appendChild(inner);
  document.body.appendChild(pal);

  var idx=0;
  function open(){pal.classList.add('open');window.__pkModal='palette';inp.value='';filter('');setIdx(0);inp.focus();}
  function close(){pal.classList.remove('open');if(window.__pkModal==='palette')window.__pkModal=null;}
  function vis(){return Array.prototype.slice.call(res.querySelectorAll('.cmd-item:not(.cmd-hide)'));}
  function setIdx(i){
    var items=vis();
    idx=Math.max(0,Math.min(i,items.length-1));
    items.forEach(function(el,j){el.classList.toggle('cmd-on',j===idx);});
    if(items[idx])items[idx].scrollIntoView({block:'nearest'});
  }
  function filter(q){
    var qq=q.toLowerCase();
    res.querySelectorAll('.cmd-item').forEach(function(el){
      el.classList.toggle('cmd-hide',!!qq&&el.textContent.toLowerCase().indexOf(qq)<0);
    });
    setIdx(0);
  }
  function go(){
    var items=vis();
    if(!items[idx])return;
    var href=items[idx].dataset.href;
    close();
    var de=document.documentElement;
    if(window.matchMedia('(prefers-reduced-motion:reduce)').matches){
      window.location.href=href;
    } else {
      de.style.transition='opacity .2s ease';de.style.opacity='0';
      setTimeout(function(){sessionStorage.setItem('pgt','1');window.location.href=href;},200);
    }
  }

  document.addEventListener('keydown',function(e){
    if((e.metaKey||e.ctrlKey)&&e.key==='k'){
      e.preventDefault();
      pal.classList.contains('open')?close():open();
      return;
    }
    if(!pal.classList.contains('open'))return;
    if(e.key==='Escape'){close();}
    else if(e.key==='ArrowDown'){e.preventDefault();setIdx(idx+1);}
    else if(e.key==='ArrowUp'){e.preventDefault();setIdx(idx-1);}
    else if(e.key==='Enter'){go();}
  });

  inp.addEventListener('input',function(){filter(this.value);});
  pal.addEventListener('click',function(e){
    if(e.target===pal){close();return;}
    var item=e.target.closest('.cmd-item');
    if(item){idx=vis().indexOf(item);go();}
  });
})();

/* ── READING TIME ── */
(function(){
  var hd=document.querySelector('.page-hd');
  if(!hd)return;
  var words=document.body.innerText.trim().split(/\s+/).length;
  var mins=Math.max(1,Math.round(words/220));
  var el=document.createElement('div');
  el.className='reading-time';
  el.textContent='~ '+mins+' min read';
  hd.appendChild(el);
})();

/* ── COPY STAT BUTTONS ── */
(function(){
  document.querySelectorAll('.gt-card').forEach(function(card){
    var label=card.querySelector('.gt-card-label');
    var val=card.querySelector('.gt-card-val');
    var src=card.querySelector('.gt-card-src');
    if(!label||!val)return;
    var btn=document.createElement('button');
    btn.className='gt-copy';btn.setAttribute('aria-label','Copy stat');btn.textContent='copy';
    btn.addEventListener('click',function(){
      var text=label.textContent+': '+val.textContent+(src?'\n'+src.textContent:'');
      navigator.clipboard.writeText(text).then(function(){showToast('Stat copied to clipboard');});
    });
    card.appendChild(btn);
  });
})();

/* ── KEYBOARD SHORTCUT HELP (?) ── */
(function(){
  var SHORTCUTS=[
    ['⌘K / Ctrl+K','Open command palette'],
    ['↑ ↓ + Enter','Navigate palette'],
    ['Esc','Close palette / overlay'],
    ['Tab','Keyboard navigation (accessibility)'],
    ['R','Toggle reading mode']
  ];

  var overlay=document.createElement('div');
  overlay.id='kbhelp';
  overlay.setAttribute('role','dialog');
  overlay.setAttribute('aria-modal','true');
  overlay.setAttribute('aria-label','Keyboard shortcuts');

  var box=document.createElement('div'); box.id='kbhelp-box';
  var title=document.createElement('div'); title.id='kbhelp-title'; title.textContent='Keyboard Shortcuts';
  box.appendChild(title);

  var table=document.createElement('div'); table.id='kbhelp-table';
  SHORTCUTS.forEach(function(s){
    var row=document.createElement('div');
    row.className='kbh-row';
    row.innerHTML='<kbd>'+escHtml(s[0])+'</kbd><span>'+escHtml(s[1])+'</span>';
    table.appendChild(row);
  });
  box.appendChild(table);
  var closeEl=document.createElement('div');
  closeEl.id='kbhelp-close';closeEl.textContent='Press Esc or ? to close';
  box.appendChild(closeEl);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  function openHelp(){overlay.classList.add('open');window.__pkModal='help';}
  function closeHelp(){overlay.classList.remove('open');if(window.__pkModal==='help')window.__pkModal=null;}

  document.addEventListener('keydown',function(e){
    var tag=(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA');
    if(e.key==='?'&&!e.metaKey&&!e.ctrlKey&&!tag&&!window.__pkModal){
      overlay.classList.contains('open')?closeHelp():openHelp();
    }
    if(e.key==='Escape'&&overlay.classList.contains('open'))closeHelp();
  });
  overlay.addEventListener('click',function(e){if(e.target===overlay)closeHelp();});
})();

/* ════════════════════════════════════════════════
   V3 ENHANCEMENTS
   ════════════════════════════════════════════════ */

/* ── Ambient Candlelight Cursor ── */
(function(){
  if(window.matchMedia('(pointer:coarse)').matches)return;
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  var glow=document.createElement('div');
  glow.id='ambientGlow';
  glow.setAttribute('aria-hidden','true');
  document.body.appendChild(glow);
  var gx=window.innerWidth/2,gy=window.innerHeight/2,agx=gx,agy=gy;
  document.addEventListener('mousemove',function(e){gx=e.clientX;gy=e.clientY;},{passive:true});
  (function animGlow(){
    agx+=(gx-agx)*.055;
    agy+=(gy-agy)*.055;
    glow.style.left=agx+'px';glow.style.top=agy+'px';
    requestAnimationFrame(animGlow);
  })();
})();

/* ── Text Scramble on Hero "Reborn." ── */
(function(){
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  var el=document.querySelector('h1.hero-h .l2');
  if(!el)return;
  var original=el.textContent;
  var chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789*#@!?/\\|';
  var stepsPerChar=9;
  var totalFrames=original.length*stepsPerChar;
  var frame=0;
  function scramble(){
    var revealed=Math.floor(frame/stepsPerChar);
    var out='';
    for(var i=0;i<original.length;i++){
      if(i<revealed){out+=original[i];}
      else if(' .,;:'.indexOf(original[i])>=0){out+=original[i];}
      else{out+=chars[Math.floor(Math.random()*chars.length)];}
    }
    el.textContent=out;
    if(frame<totalFrames){frame++;requestAnimationFrame(scramble);}
    else{el.textContent=original;el.classList.remove('scrambling');}
  }
  setTimeout(function(){el.classList.add('scrambling');scramble();},680);
})();

/* ── Countdown to 2040 ── */
(function(){
  var hBtns=document.querySelector('.h-btns');
  if(!hBtns)return;
  var cd=document.createElement('div');
  cd.className='hero-countdown';
  cd.setAttribute('aria-live','polite');
  cd.setAttribute('aria-label','Time remaining until 2040 target');
  hBtns.parentNode.insertBefore(cd,hBtns.nextSibling);
  function update(){
    var target=new Date('2040-01-01T00:00:00');
    var diff=target-new Date();
    if(diff<=0){cd.innerHTML='The 2040 horizon has arrived.';return;}
    var years=Math.floor(diff/(1000*60*60*24*365.25));
    diff-=years*(1000*60*60*24*365.25);
    var months=Math.floor(diff/(1000*60*60*24*30.44));
    diff-=months*(1000*60*60*24*30.44);
    var days=Math.floor(diff/(1000*60*60*24));
    cd.innerHTML=
      '<span class="cd-val">'+years+'</span>yr '+
      '<span class="cd-val">'+months+'</span>mo '+
      '<span class="cd-val">'+days+'</span>d until 2040';
  }
  update();
  setInterval(update,3600000);
})();

/* ── Section Navigation Dots (accessible) ── */
(function(){
  var DEFS=[
    {id:'hero',label:'Intro'},{id:'crisis',label:'Reality'},{id:'reframe',label:'The Case'},
    {id:'pillars',label:'Pillars'},{id:'path-finder',label:'Your Role'},{id:'momentum',label:'Momentum'},
    {id:'deepdives',label:'Deep Dives'},{id:'timeline',label:'Timeline'},{id:'economics',label:'Economics'},
    {id:'audience',label:'Audience'},{id:'groundtruth',label:'Ground Truth'},{id:'solution-matrix',label:'Solutions'},
    {id:'respond',label:'Join'},{id:'fivepeople',label:'Five People'},{id:'sprint',label:'Sprint'},{id:'livefeed',label:'Live Feed'}
  ];
  var found=[];
  DEFS.forEach(function(def){
    var sec=document.getElementById(def.id);
    if(sec)found.push({sec:sec,label:def.label});
  });
  if(found.length<2)return;
  var wrap=document.createElement('div');
  wrap.id='secdots';
  wrap.setAttribute('role','navigation');
  wrap.setAttribute('aria-label','Section navigation');
  document.body.appendChild(wrap);

  var dots=found.map(function(f){
    var d=document.createElement('button');
    d.className='sd-dot';
    d.dataset.label=f.label;
    d.type='button';
    d.setAttribute('aria-label','Jump to '+f.label);
    d.addEventListener('click',function(){f.sec.scrollIntoView({behavior:'smooth',block:'start'});});
    wrap.appendChild(d);
    return d;
  });

  var activeIdx=-1;
  var obs=new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if(!en.isIntersecting)return;
      var idx=found.findIndex?found.findIndex(function(f){return f.sec===en.target;}):-1;
      if(idx<0||idx===activeIdx)return;
      activeIdx=idx;
      dots.forEach(function(d,i){d.classList.toggle('sd-active',i===idx);});
    });
  },{threshold:0.15,rootMargin:'-15% 0px -60% 0px'});
  found.forEach(function(f){obs.observe(f.sec);});
})();

/* ── Reading Mode (press R) ── */
(function(){
  var html=document.documentElement;
  var badge=document.createElement('div');
  badge.className='rm-badge';
  badge.setAttribute('aria-hidden','true');
  badge.textContent='Reading mode — press R to exit';
  document.body.appendChild(badge);

  var navRight=document.querySelector('.nav-right');
  if(navRight){
    var btn=document.createElement('button');
    btn.className='nav-rm';
    btn.id='navRmBtn';
    btn.setAttribute('aria-label','Toggle reading mode');
    btn.setAttribute('title','Reading mode (R)');
    btn.textContent='▣ Read';
    navRight.insertBefore(btn,navRight.firstChild);
    btn.addEventListener('click',toggle);
  }

  function toggle(){
    var on=html.classList.toggle('rm-on');
    localStorage.setItem('p2040rm',on?'1':'0');
  }

  document.addEventListener('keydown',function(e){
    var tag=(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA');
    /* FIX: don't fire if a modal is open or user is typing */
    if(e.key==='r'&&!e.metaKey&&!e.ctrlKey&&!tag&&!window.__pkModal){
      toggle();
    }
  });

  if(localStorage.getItem('p2040rm')==='1'){
    html.classList.add('rm-on');
    /* FIX: show badge on load so user knows reading mode persisted */
    setTimeout(function(){badge.classList.add('rm-show');
      setTimeout(function(){badge.classList.remove('rm-show');},3500);
    },400);
  }
})();

/* ── Path Finder: event delegation ── */
(function(){
  var grid=document.getElementById('pfGrid');
  if(!grid)return;
  grid.addEventListener('click',function(e){
    var card=e.target.closest('.pf-role-card[data-role]');
    if(card&&typeof window.pfSelect==='function')window.pfSelect(card.dataset.role);
  });
})();

/* ── Word-by-word reveal (preserves HTML) ── */
(function(){
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  /* FIX: skip elements that contain HTML children — we can't safely
     split them without destroying markup. Only split plain-text headings. */
  function isPlain(el){
    for(var i=0;i<el.childNodes.length;i++){
      if(el.childNodes[i].nodeType!==3)return false;
    }
    return true;
  }
  function splitWords(el){
    if(!el)return;
    if(!isPlain(el))return;
    var text=el.textContent;
    var words=text.split(' ');
    el.innerHTML=words.map(function(w,i){
      return '<span class="word-wrap"><span class="word-inner" style="animation-delay:'+(i*0.07+0.05)+'s">'+escHtml(w||'')+'</span></span>';
    }).join(' ');
  }
  var targets=[
    document.querySelector('#crisis .sh'),
    document.querySelector('#pillars .sh'),
    document.querySelector('#path-finder .sh')
  ].filter(Boolean);
  if(!targets.length)return;
  var wo=new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if(en.isIntersecting){splitWords(en.target);wo.unobserve(en.target);}
    });
  },{threshold:.4});
  targets.forEach(function(t){wo.observe(t);});
})();

/* ── Crisis counter: flash on completion ── */
(function(){
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  document.querySelectorAll('.cs-val[data-count]').forEach(function(el){
    var obs=new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if(!en.isIntersecting)return;
        obs.unobserve(en.target);
        setTimeout(function(){
          en.target.classList.add('counted');
          setTimeout(function(){en.target.classList.remove('counted');},500);
        },1750);
      });
    },{threshold:.5});
    obs.observe(el);
  });
})();

/* ── Wire up nav elements that lost inline onclick ── */
(function(){
  var followBtn=document.querySelector('.follow-btn');
  if(followBtn&&!followBtn.hasAttribute('onclick')){
    followBtn.addEventListener('click',function(){
      if(typeof window.followSubmit==='function')window.followSubmit();
    });
  }
  var cmdBtn=document.querySelector('.nav-cmd');
  if(cmdBtn&&!cmdBtn.hasAttribute('onclick')){
    cmdBtn.addEventListener('click',function(){
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}));
    });
  }
  var navToggle=document.getElementById('navToggle');
  if(navToggle&&!navToggle.hasAttribute('onclick')){
    navToggle.addEventListener('click',function(){
      if(typeof toggleMenu==='function')toggleMenu();
    });
  }
  document.querySelectorAll('.lang-btn:not([onclick])').forEach(function(btn){
    btn.addEventListener('click',function(){
      if(typeof window.setLang==='function')window.setLang(this.dataset.lang);
    });
  });
})();
