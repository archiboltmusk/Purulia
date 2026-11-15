/* Private dossiers stay in memory until the user explicitly exports encrypted bytes. */
(function(root){'use strict';
async function encryptDossier(value,password){
 if(typeof password!=='string'||password.length<12)throw new TypeError('Use a passphrase of at least 12 characters');
 const cleartext=new TextEncoder().encode(JSON.stringify(value));if(cleartext.length>60000)throw new TypeError('Private draft exceeds 60 KB');
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
 const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt']);
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('Parishkar-private-dossier-v1')},key,cleartext);
 const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
 return {format:'Parishkar-private-dossier-v1',algorithm:'AES-256-GCM',kdf:'PBKDF2-SHA256',iterations:310000,salt:b64(salt),iv:b64(iv),ciphertext:b64(ciphertext)};
}
async function decryptDossier(envelope,password){
 if(envelope?.format!=='Parishkar-private-dossier-v1'||envelope.iterations!==310000)throw new TypeError('Unsupported encrypted dossier');
 if(typeof envelope.ciphertext!=='string'||envelope.ciphertext.length>81000)throw new TypeError('Invalid encrypted dossier size');
 const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
 const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
 const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:bytes(envelope.salt),iterations:310000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt']);
 const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(envelope.iv),additionalData:new TextEncoder().encode(envelope.format)},key,bytes(envelope.ciphertext));
 return JSON.parse(new TextDecoder().decode(clear));
}
const api={encryptDossier,decryptDossier};if(typeof module==='object'&&module.exports)module.exports=api;else root.ParishkarPrivate=api;
})(typeof globalThis!=='undefined'?globalThis:this);
