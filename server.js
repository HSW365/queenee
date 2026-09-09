const express=require('express');
const dns=require('dns').promises;
const net=require('net');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {load}=require('cheerio');

const app=express();
const PORT=process.env.PORT||3000;
const STRIPE_URL=process.env.STRIPE_PAYMENT_URL||'https://buy.stripe.com/6oU7sL4L5dMO182b3Z3VC0o';
const ADMIN_TOKEN=process.env.QUEENEE_ADMIN_TOKEN||'';
const DATA_DIR=path.join(__dirname,'data');
const DATA_FILE=path.join(DATA_DIR,'intakes.json');

app.use(express.json({limit:'128kb'}));
app.use(express.urlencoded({extended:false}));

function privateIp(ip){
  if(net.isIP(ip)===4){const p=ip.split('.').map(Number);return p[0]===10||p[0]===127||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)}
  return net.isIP(ip)===6&&(ip==='::1'||/^f[cd]/i.test(ip)||/^fe80:/i.test(ip));
}
function clean(s){return String(s||'').replace(/\s+/g,' ').trim().slice(0,1000)}
function normalize(raw){return /^https?:\/\//i.test(String(raw||''))?String(raw).trim():'https://'+String(raw||'').trim()}
async function target(raw){
  let u;try{u=new URL(normalize(raw))}catch{throw Error('Enter a valid website URL.')}
  if(!/^https?:$/.test(u.protocol)||u.username||u.password)throw Error('Only public HTTP/HTTPS URLs are supported.');
  const a=await dns.lookup(u.hostname,{all:true}).catch(()=>[]);
  if(!a.length||a.some(x=>privateIp(x.address)))throw Error('That public domain could not be safely resolved.');
  return u;
}
function readData(){try{return JSON.parse(fs.readFileSync(DATA_FILE,'utf8'))}catch{return []}}
function writeData(rows){fs.mkdirSync(DATA_DIR,{recursive:true});fs.writeFileSync(DATA_FILE,JSON.stringify(rows,null,2))}
function saveIntake(input){const rows=readData();const id='Q-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(3).toString('hex').toUpperCase();const row={id,createdAt:new Date().toISOString(),status:'new',...input};rows.push(row);writeData(rows);return row}
function admin(req,res,next){if(!ADMIN_TOKEN||req.get('x-queenee-admin')!==ADMIN_TOKEN)return res.status(401).json({error:'Unauthorized'});next()}

async function analyze(raw){
  const u=await target(raw);const ac=new AbortController();const tm=setTimeout(()=>ac.abort(),10000);let html;
  try{const r=await fetch(u,{signal:ac.signal,redirect:'follow',headers:{'User-Agent':'QUEENEE/3.0 website analyzer'}});if(!r.ok)throw Error('Website returned HTTP '+r.status);html=await r.text()}finally{clearTimeout(tm)}
  html=html.slice(0,3000000);const $=load(html);
  const title=clean($('title').first().text());
  const description=clean($('meta[name="description"]').attr('content'));
  const headings=$('h1,h2,h3').map((_,e)=>clean($(e).text())).get().filter(Boolean).slice(0,30);
  const links=$('a[href]').map((_,e)=>({text:clean($(e).text()),href:$(e).attr('href')||''})).get().slice(0,100);
  const cta=links.filter(x=>/book|quote|contact|call|schedule|start|get started|buy|shop|appointment|consult|request/i.test(x.text)).length;
  const nav=links.filter(x=>x.text).slice(0,20).map(x=>x.text);
  const plan=[];
  if(!title)plan.push('Add a clear benefit-led page title.');
  if(!description)plan.push('Add a concise meta description.');
  if(headings.length<3)plan.push('Strengthen service, proof, FAQ and offer hierarchy.');
  if(cta===0)plan.push('Add prominent calls to action and lead capture.');
  if(links.length<4)plan.push('Improve navigation and internal pathways.');
  plan.push('Use mobile-first responsive layouts and accessible controls.','Structure business content for search and AI assistants.','Review performance, trust signals and conversion paths.');
  return {domain:u.hostname.replace(/^www\./,''),url:u.toString(),title,description,headings,nav,linksTotal:links.length,cta,images:$('img').length,forms:$('form').length,plan};
}

app.post('/api/analyze',async(req,res)=>{try{res.json(await analyze(req.body?.url))}catch(e){res.status(400).json({error:e.name==='AbortError'?'Website timed out while being read.':e.message||'Analysis failed.'})}});

app.post('/api/intake',async(req,res)=>{
  try{
    const body=req.body||{};if(!body.name||!body.email||!body.business||!body.url)throw Error('Name, email, business name and website URL are required.');
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email))throw Error('Enter a valid email address.');
    const result=await analyze(body.url).catch(e=>({error:e.message}));
    const row=saveIntake({name:clean(body.name),email:clean(body.email),business:clean(body.business),url:normalize(body.url),phone:clean(body.phone),goal:clean(body.goal),services:clean(body.services),notes:clean(body.notes),analysis:result});
    res.status(201).json({ok:true,id:row.id,status:row.status,paymentUrl:STRIPE_URL,analysis:result});
  }catch(e){res.status(400).json({error:e.message||'Intake failed.'})}
});

app.get('/api/intake/:id',admin,(req,res)=>{const row=readData().find(x=>x.id===req.params.id);if(!row)return res.status(404).json({error:'Intake not found'});res.json(row)});
app.get('/api/intakes',admin,(req,res)=>res.json(readData().slice(-100).reverse()));
app.patch('/api/intake/:id',admin,(req,res)=>{const rows=readData();const i=rows.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:'Intake not found'});rows[i].status=clean(req.body?.status)||rows[i].status;rows[i].updatedAt=new Date().toISOString();writeData(rows);res.json(rows[i])});

app.get('/api/checkout',(req,res)=>res.redirect(STRIPE_URL));
app.get('/health',(req,res)=>res.json({ok:true,service:'QUEENEE',version:'3.0.0',payment:'configured',features:['website-analysis','customer-intake','lead-storage','stripe-checkout','admin-api']}));
app.get('/api/config',(req,res)=>res.json({websitePrice:500,callTwinUrl:'https://github.com/HSW365/calltwin',paymentConfigured:Boolean(STRIPE_URL)}));

app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.use(express.static(__dirname));
app.use((req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.listen(PORT,()=>console.log('QUEENEE listening on '+PORT));
