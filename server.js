const express = require('express');
const dns = require('dns').promises;
const net = require('net');
const { load } = require('cheerio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json({limit:'64kb'}));
app.use(express.static(path.join(__dirname)));

function isPrivateIp(ip){
  if(net.isIP(ip)===4){ const p=ip.split('.').map(Number); return p[0]===10 || p[0]===127 || (p[0]===169&&p[1]===254) || (p[0]===172&&p[1]>=16&&p[1]<=31) || (p[0]===192&&p[1]===168); }
  return net.isIP(ip)===6 && (ip==='::1' || ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd') || ip.toLowerCase().startsWith('fe80:'));
}
async function validateTarget(raw){
  let u; try { u=new URL(raw); } catch { throw new Error('Enter a valid website URL.'); }
  if(!['http:','https:'].includes(u.protocol)) throw new Error('Only HTTP and HTTPS websites are supported.');
  if(u.username || u.password) throw new Error('URLs with embedded credentials are not supported.');
  const ips=await dns.lookup(u.hostname,{all:true}).catch(()=>[]);
  if(!ips.length) throw new Error('The domain could not be resolved.');
  if(ips.some(x=>isPrivateIp(x.address))) throw new Error('That destination is not allowed.');
  return u;
}
function clean(s){return String(s||'').replace(/\s+/g,' ').trim();}
function makePlan(data){
 const p=[];
 if(!data.title) p.push('Add a clear, benefit-led page title.');
 if(!data.description) p.push('Add a concise meta description for search and sharing.');
 if(data.headings.length<3) p.push('Strengthen information architecture with clear service, proof and FAQ sections.');
 if(data.links.cta===0) p.push('Add prominent calls to action for calls, bookings, quotes or contact.');
 if(data.links.total<4) p.push('Improve navigation and internal pathways between key business pages.');
 p.push('Build mobile-first responsive layouts and accessible controls.');
 p.push('Organize services, trust signals, FAQs and lead capture around conversion.');
 p.push('Add structured business information so search engines and AI assistants can understand the company.');
 return p.slice(0,8);
}
app.post('/api/analyze', async (req,res)=>{
 try{
  const target=await validateTarget(req.body?.url);
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),10000);
  let html='';
  try{ const r=await fetch(target,{signal:controller.signal,redirect:'manual',headers:{'User-Agent':'QUEENEE-Website-Analyzer/2.0'}}); if(r.status>=300&&r.status<400) throw new Error('Redirected site'); if(!r.ok) throw new Error('Website returned HTTP '+r.status); html=await r.text(); } finally { clearTimeout(timer); }
  if(html.length>3_000_000) html=html.slice(0,3_000_000);
  const $=load(html);
  const title=clean($('title').first().text());
  const description=clean($('meta[name="description"]').attr('content'));
  const headings=$('h1,h2,h3').map((_,el)=>clean($(el).text())).get().filter(Boolean).slice(0,20);
  const links=$('a[href]').map((_,el)=>({text:clean($(el).text()),href:$(el).attr('href')||''})).get();
  const ctaWords=/book|quote|contact|call|schedule|start|get started|buy|shop|appointment|consult/i;
  const cta=links.filter(x=>ctaWords.test(x.text)).length;
  const images=$('img').length;
  const forms=$('form').length;
  const domain=target.hostname.replace(/^www\./,'');
  const data={domain,url:target.toString(),title,description,headings,links:{total:links.length,cta},images,forms,plan:makePlan({title,description,headings,links:{total:links.length,cta}})};
  res.json(data);
 }catch(e){ res.status(400).json({error:e.name==='AbortError'?'Website timed out while being read.':e.message||'Analysis failed.'}); }
});
app.get('/health',(req,res)=>res.json({ok:true,service:'QUEENEE',version:'2.0.0'}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.listen(PORT,()=>console.log(`QUEENEE listening on ${PORT}`));
