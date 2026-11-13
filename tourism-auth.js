/* Uses the same Supabase Auth storage as the site's existing moderator pages. */
(function(root){
 let pending;
 root.tourismClient=()=>pending||(pending=new Promise((resolve,reject)=>{
  const config=root.KASA_CONFIG;
  if(!config?.SUPABASE_URL||!config?.SUPABASE_ANON_KEY){reject(new Error('not_configured'));return}
  const create=()=>resolve(root.supabase.createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY));
  if(root.supabase){create();return}
  const script=document.createElement('script');
  const timeout=setTimeout(()=>reject(new Error('sdk_timeout')),12000);
  script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
  script.onload=()=>{clearTimeout(timeout);root.supabase?create():reject(new Error('sdk_unavailable'))};
  script.onerror=()=>{clearTimeout(timeout);reject(new Error('sdk_unavailable'))};
  document.head.append(script);
 }));
})(window);
