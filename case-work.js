/* Public work-order status and disputes, without exposing private work photos. */
(async()=>{
 const id=new URLSearchParams(location.search).get('id');if(!id||!/^[a-f0-9-]{1,64}$/i.test(id))return;
 const cfg=window.KASA_CONFIG||{},sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
 try{
  const {data,error}=await sb.rpc('kasa_partner_board');if(error)return;
  const orders=(data?.orders||[]).filter(o=>String(o.report_id)===id);if(!orders.length)return;
  const section=document.createElement('section');section.className='cf-panel';section.id='case-work-orders';
  const heading=document.createElement('h2');heading.textContent='Municipal work orders';section.append(heading);
  for(const o of orders){
   const row=document.createElement('div'),p=document.createElement('p');p.textContent=`${o.office} · ${String(o.state).replaceAll('_',' ')} · Order ${o.order_no||o.order_id}`;row.append(p);
   if(['verified','paid'].includes(o.state)){
    const button=document.createElement('button');button.type='button';button.textContent='Reopen disputed work';const status=document.createElement('p');status.setAttribute('role','status');
    button.onclick=async()=>{
     const reason=(prompt('Describe why the work needs reopening (at least 10 characters). Do not include private contact details.')||'').trim();if(!reason)return;if(reason.length<10){status.textContent='Describe the problem in at least 10 characters.';return;}
     button.disabled=true;
     try{const r=await sb.rpc('kasa_partner_reopen',{p_order:o.order_id,p_reason:reason});if(r.error)throw r.error;p.textContent=`${o.office} · Reopened for officer review`;status.textContent='Reopened. New work evidence and independent verification will be needed.';button.remove();}
     catch(e){status.textContent=e.message||'Could not reopen. Try again later.';button.disabled=false;}
    };row.append(button,status);
   }
   section.append(row);
  }
  document.getElementById('cf-main')?.after(section);
 }catch{/* An unavailable optional work-order board must not hide the case. */}
})();
