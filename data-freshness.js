/* A retrieval date is distinct from the period a figure describes. */
(function(root){
'use strict';
function freshness(source,now=Date.now()){
 const read=source?.read||source?.checked_at;
 if(typeof read!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(read)||!Number.isFinite(Date.parse(read))||new Date(read).toISOString().slice(0,10)!==read)return {state:'Check date not recorded',read:null};
 const age=Math.floor((now-Date.parse(read))/86400000);
 if(age<0)return {state:'Check date is in the future',read};
 const maxAge=/jal jeevan|dashboard/i.test(source.name||'')?45:180;
 return {state:age>maxAge?'Source needs rechecking':'Source checked within review window',read,age,maxAge};
}
function mount(data){
 if(typeof document==='undefined'||document.getElementById('data-freshness'))return;
 const sources=data?.sources;if(!sources)return;
 const panel=document.createElement('details');panel.id='data-freshness';panel.className='data-freshness';
 const summary=document.createElement('summary');summary.textContent='Data sources, dates & freshness';panel.append(summary);
 const intro=document.createElement('p');intro.textContent='A recent source check does not make an old survey current. Census figures describe 2011; NFHS-5 describes 2019–21. Review windows: 45 days for live dashboards, 180 days for other source checks.';panel.append(intro);
 const list=document.createElement('ul');
 for(const [key,source] of Object.entries(sources)){
  const s=freshness(source),li=document.createElement('li'),label=document.createElement('strong');label.textContent=(source.name||key)+': ';li.append(label,document.createTextNode(s.state+(s.read?' · checked '+s.read:'')+'. '));
  if(source.url&&/^https?:\/\//.test(source.url)){const link=document.createElement('a');link.href=source.url;link.target='_blank';link.rel='noopener';link.textContent='View source';li.append(link);}
  list.append(li);
 }
 const correction=document.createElement('a');correction.href='join.html#respond';correction.textContent='Report an outdated figure or suggest a source →';panel.append(list,correction);
 const footer=document.querySelector('footer');if(footer)footer.before(panel);else(document.querySelector('main')||document.body).append(panel);
}
const api={freshness,mount};if(typeof module==='object'&&module.exports)module.exports=api;else root.DataFreshness=api;
})(typeof globalThis!=='undefined'?globalThis:this);
