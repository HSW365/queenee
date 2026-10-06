(function(){
  var API='https://lsxdlmrjrcivxwgfkpop.supabase.co/functions/v1/queenee',MAIL='hsw365media@gmail.com';
  var $=function(s){return document.querySelector(s)},$$=function(s){return [].slice.call(document.querySelectorAll(s))};
  var fmt=function(n){return '$'+Number(n).toLocaleString('en-US')};
  var modal=$('#qn-modal'),form=$('#qn-form'),order=null,price=null,last=null;
  if(!modal||!form)return;
  document.body.appendChild(modal);
  var wave=$('#qn-wave');for(var i=0;i<26;i++){var b=document.createElement('i');b.style.animationDelay=(-(i*37%150)/100)+'s';wave.appendChild(b)}
  fetch(API).then(function(r){return r.json()}).then(function(d){price=d.prices.website;setPrice()}).catch(function(){});
  function setPrice(){
    $('#qn-due').textContent=price?fmt(price):'';
    $('#qn-termstext').textContent=price?'I understand the website is a one-time '+fmt(price)+' build.':'I understand this is a one-time payment for the website build.';
  }
  setPrice();
  var panes=['#qn-form','#qn-paystep','#qn-donestep'];
  function show(id){panes.forEach(function(p){$(p).classList.toggle('qn-hide',p!==id)});modal.scrollTop=0}
  function open(){last=document.activeElement;modal.classList.add('qn-on');document.documentElement.style.overflow='hidden';show(order?(order.done?'#qn-donestep':'#qn-paystep'):'#qn-form');setTimeout(function(){(order?$('#qn-close'):$('#qn-projectName')).focus()},60)}
  function close(){modal.classList.remove('qn-on');document.documentElement.style.overflow='';if(last&&last.focus)last.focus()}
  var L={artist:['About the artist','Artist or band name *','Genre','Links to your music, videos and socials','City you rep'],
         business:['About the business','Business name *','Type of business','Main services or products','City / service area'],
         other:['About the project','Name for the site *','What it is (podcast, book, event...)','Links we should see','City']};
  function labels(){var l=L[form.clientType.value]||L.other;$('#qn-about').textContent=l[0];$('#qn-lp').textContent=l[1];$('#qn-lc').textContent=l[2];$('#qn-ll').textContent=l[3];$('#qn-lo').textContent=l[4]}
  $$('[data-qn-open]').forEach(function(b){b.addEventListener('click',function(e){e.preventDefault();open()})});
  $('#qn-close').onclick=close;$('#qn-doneclose').onclick=close;
  modal.addEventListener('click',function(e){if(e.target===modal)close()});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&modal.classList.contains('qn-on'))close()});
  form.addEventListener('change',function(){$('#qn-urlwrap').classList.toggle('qn-hide',form.siteType.value!=='rebuild');labels();$('#qn-err').style.display='none'});
  if(location.hash==='#signup')open();

  function api(body){
    var ac=new AbortController(),t=setTimeout(function(){ac.abort()},30000);
    return fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:ac.signal})
      .then(function(r){return r.json().catch(function(){return {}}).then(function(d){if(!r.ok)throw Error(d.error||'That did not save. Try again.');return d})},
            function(){throw Error('Could not reach QUEENEE. Check your connection and try again, or email '+MAIL+'.')})
      .finally(function(){clearTimeout(t)});
  }
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var f=form.elements,err=$('#qn-err'),v=function(k){return f[k].value.trim()};
    var bad=function(m){err.textContent=m;err.style.display='block';err.scrollIntoView({block:'center',behavior:'smooth'})};
    err.style.display='none';
    var body={action:'order',plan:'website',source:'shopify',clientType:form.clientType.value,siteType:form.siteType.value,currentUrl:v('currentUrl'),projectName:v('projectName'),category:v('category'),links:v('links'),location:v('location'),goal:v('goal'),name:v('name'),phone:v('phone'),email:v('email'),notes:v('notes'),company_website:f.company_website.value};
    if(!body.projectName||!body.name||!body.email)return bad('The name for the site, your name and your email are required.');
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email))return bad('Enter a valid email address.');
    if(body.siteType==='rebuild'&&!body.currentUrl)return bad('Enter your current website address, or choose "I need a new website".');
    if(!$('#qn-terms').checked)return bad('Check the box to confirm the price.');
    var btn=$('#qn-submit');btn.disabled=true;btn.textContent='Saving your details...';
    api(body).then(function(d){
      order={id:d.id,token:d.token,amount:d.amountDue,email:body.email,pay:d.payment,comp:d.comp};
      if(d.comp)finish('comp');else payStep();
    }).catch(function(x){bad(x.message)}).finally(function(){btn.disabled=false;btn.textContent='Save and choose how to pay'});
  });
  function payStep(){
    var o=order,p=o.pay,amt=fmt(o.amount);
    $('#qn-oid').textContent=o.id;$$('.qn-oidtext').forEach(function(e){e.textContent=o.id});
    $('#qn-paydue').textContent=amt;$$('.qn-amt').forEach(function(e){e.textContent=amt});
    $('#qn-cashtag').textContent=p.cashtag;$('#qn-cashopen').href='https://cash.app/'+encodeURIComponent(p.cashtag).replace('%24','$')+'/'+o.amount;
    $('#qn-zelle').textContent=p.zelle;$('#qn-payee').textContent=p.payee;
    $('#qn-mcash').classList.toggle('qn-hide',!p.cashtag);$('#qn-mzelle').classList.toggle('qn-hide',!p.zelle);$('#qn-mcard').classList.toggle('qn-hide',!p.stripe);
    show('#qn-paystep');
  }
  function finish(kind){
    order.done=true;var o=order;
    $('#qn-donetag').textContent=kind==='comp'?'OWNER ORDER':'PAYMENT REPORTED';
    $('#qn-donetitle').textContent=kind==='comp'?'Order saved':'You are in the build queue';
    var t=$('#qn-donetext');t.textContent='';
    var add=function(s,bold){var n=bold?document.createElement('b'):document.createTextNode(s);if(bold)n.textContent=s;t.appendChild(n)};
    if(kind==='comp'){add('Order ');add(o.id,1);add(' is saved with no payment due.')}
    else{add('Order ');add(o.id,1);add('. We match your payment to this order number, then email ');add(o.email,1);add(' to start your build. Keep this number for your records.')}
    show('#qn-donestep');
  }
  var payErr=function(m){var e=$('#qn-payerr');e.textContent=m;e.style.display=m?'block':'none'};
  $('#qn-cashopen').addEventListener('click',function(){api({action:'pay',id:order.id,token:order.token,method:'cashapp'}).catch(function(){})});
  $$('[data-qn-sent]').forEach(function(b){b.addEventListener('click',function(){
    payErr('');b.disabled=true;
    api({action:'pay',id:order.id,token:order.token,method:b.getAttribute('data-qn-sent'),reported:true}).then(function(){finish('paid')}).catch(function(x){payErr(x.message)}).finally(function(){b.disabled=false});
  })});
  $('#qn-cardgo').addEventListener('click',function(){
    var b=$('#qn-cardgo');b.disabled=true;b.textContent='Opening secure checkout...';
    var go=function(){var u=new URL(order.pay.stripe);u.searchParams.set('client_reference_id',order.id);u.searchParams.set('prefilled_email',order.email);location.href=u.toString()};
    api({action:'pay',id:order.id,token:order.token,method:'card'}).then(go,go);
  });
  $$('[data-qn-copy]').forEach(function(b){b.addEventListener('click',function(){
    var t=document.getElementById(b.getAttribute('data-qn-copy')).textContent;
    var done=function(s){b.textContent=s;setTimeout(function(){b.textContent='Copy'},1600)};
    if(navigator.clipboard)navigator.clipboard.writeText(t).then(function(){done('Copied')},function(){done('Select and copy')});else done('Select and copy');
  })});
})();
