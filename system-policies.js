/* Proposals are never treated as statutes or regulatory authority. */
(function(root){
'use strict';
const sources={
 apple:'https://developer.apple.com/design/human-interface-guidelines/design-principles/',
 wbAcb:'https://acb.wb.gov.in/faq',wbVigilance:'https://svc.wb.gov.in/',
 cvc:'https://portal.cvc.gov.in/',pidpi:'https://dda.gov.in/vigilance/PIDPI_complaints',
 grievance:'https://pgportal.gov.in/',abha:'https://ors.gov.in/healthid/index.jsp',
 nmc:'https://www.nmc.org.in/MCIRest/open/getDocument?path=%2FDocuments%2FPublic%2FPortal%2FLatestNews%2FPublic+Notice+dt+26-07-2025.pdf',
 fhir:'https://www.nrces.in/ndhm/fhir/r4/index.html',uidai:'https://uidai.gov.in/hi/biometric-devices',
 municipality:'https://www.legislative.gov.in/static/uploads/2025/07/359f70a69695affb9d72f8393102bd2e.pdf',
 twin:'https://smartcityresearch.iiit.ac.in/partners/projects/digitaltwin/'
};
const sectors=[
 {id:'governance',name:'Governance & justice',available:['Evidence preparation','Official-channel referral','User-entered reference tracking','Versioned decisions and appeals'],proposals:['Statutory approval deadlines','Court administration reform','Political-finance reform'],guard:'The platform issues no licences, court orders, fines or findings of guilt.'},
 {id:'economy',name:'Jobs & local economy',available:['Reviewed local services','Unit-aware quotes','Resource-constrained intervention planning'],proposals:['Verified employment incentives','Agricultural income reform','Independent MSME audits'],guard:'Payment, subsidy and employment claims require authorised systems and independent audit. No funds move here.'},
 {id:'health',name:'Healthcare & workforce',available:['Facility navigation','Timestamped medicine availability','Private workforce concern dossiers','Metadata-only audit review rules'],proposals:['Primary-care financing reform','Training-capacity expansion','Workforce protection'],guard:'No patient records, Aadhaar or biometric collection. No automated diagnosis, denial of care, claim suspension, payroll deduction or accreditation penalty.'},
 {id:'education',name:'Education & skills',available:['Evidence and intervention framework','Source-backed public facility information'],proposals:['Independent learning-gain assessments','Paid apprenticeships'],guard:'Learning measures need independent sampling and context. Essential funding must not be automatically cut on a single score.'},
 {id:'environment',name:'Environment & infrastructure',available:['Asset graph','Signed telemetry protocol','Calibration/freshness checks','Explicitly exploratory water and rainfall scenarios'],proposals:['Legally authorised emissions enforcement','Groundwater and crop reform','Municipal devolution'],guard:'Sensor alarms request investigation. Simulations do not certify structures, water safety, evacuation routes or regulatory violations.'},
 {id:'trust',name:'Institutional trust',available:['Append-only observations','Independent review','Conflicts register','Private-by-default allegations'],proposals:['Independent statistical oversight','Public-interest governance reform'],guard:'A signature proves message integrity and key control; it does not prove the described event occurred.'}
];
function authority(kind,scope){
 if(kind==='service')return {name:'CPGRAMS — official service grievance portal',url:sources.grievance,mode:'external',note:'Prepare the facts here. Filing and acknowledgement occur on the official portal.'};
 if(scope==='wb')return {name:'West Bengal Anti-Corruption Branch',url:'https://acb.wb.gov.in/',mode:'external',note:'For alleged corruption involving public servants under West Bengal administrative control. Check the official procedure and required identity details.'};
 if(scope==='central')return {name:'Central Vigilance Commission',url:sources.cvc,mode:'external',note:'Central vigilance jurisdiction is limited. State-government complaints require the appropriate state authority.'};
 if(scope==='pidpi')return {name:'PIDPI procedure — read before preparing',url:sources.pidpi,mode:'postal_procedure',note:'This is a distinct postal procedure for eligible central-jurisdiction disclosures. This website cannot file it electronically or promise statutory whistleblower protection.'};
 return {name:'Authority not configured',url:null,mode:'unconfigured',note:'Verify the relevant state authority on its official government website. No complaint has been sent.'};
}
function permits(action){return ['discover','prepare_dossier','export_encrypted','review_evidence','suggest_intervention','simulate_scenario'].includes(action);}
function healthcareSignals(records){
 const flags=[];const seen=new Map();
 for(const r of records){
  if(r.signatureVerified!==true){flags.push({id:r.id,kind:'unverified_source',action:'quarantine_for_review'});continue;}
  if(!r.sourceId||!Number.isFinite(Date.parse(r.at))){flags.push({id:r.id,kind:'missing_provenance',action:'request_source_correction'});continue;}
  if(r.externalRecordHash){const prior=seen.get(r.externalRecordHash);if(prior&&prior.subjectToken!==r.subjectToken)flags.push({id:r.id,kind:'possible_reused_artifact',action:'independent_review',note:'Reuse or image similarity is not a finding of fraud.'});else seen.set(r.externalRecordHash,r);}
  if(r.attendance===true&&r.activityCount===0)flags.push({id:r.id,kind:'activity_discrepancy',action:'request_context',note:'Teaching, leave, outages and case mix require review. No payroll or accreditation action.'});
 }
 return {flags,decision:'review_only',denyCare:false,withholdPayment:false,imposePenalty:false};
}
function reorderAdvice({onHand,onOrder,reserved,averageDailyUse,leadDays,safetyDays,packSize=1}){
 const values=[onHand,onOrder,reserved,averageDailyUse,leadDays,safetyDays,packSize];if(!values.every(Number.isFinite)||values.some(n=>n<0)||packSize<=0)throw new TypeError('Use non-negative stock and lead-time figures');
 const target=Math.ceil(averageDailyUse*(leadDays+safetyDays)),available=onHand+onOrder-reserved,quantity=Math.max(0,Math.ceil((target-available)/packSize)*packSize);
 return {target,available,quantity,action:quantity?'Procurement review required':'No replenishment indicated by these inputs',automaticDispatch:false,assumption:'Recent average consumption and lead time remain representative; account for expiry and demand changes separately.'};
}
const api={sources,sectors,authority,permits,healthcareSignals,reorderAdvice};if(typeof module==='object'&&module.exports)module.exports=api;else root.ParishkarPolicies=api;
})(typeof globalThis!=='undefined'?globalThis:this);
