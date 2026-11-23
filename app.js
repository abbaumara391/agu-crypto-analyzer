"use strict";

/* AGU CRYPTO ANALYZER — V3.1 RELIABILITY ENGINE
   Owner: Umar Mohammed | Spot + USDT-M Futures | No auto-trading
*/

const API={
 spot:"https://data-api.binance.vision/api/v3",
 futures:"https://fapi.binance.com/fapi/v1"
};

const ASSETS=[
 "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT",
 "DOGEUSDT","ADAUSDT","AVAXUSDT","LINKUSDT","TONUSDT"
];

const TF={
 "1m":{native:"1m",ms:60000},
 "5m":{native:"5m",ms:300000},
 "10m":{base:"5m",ms:600000},
 "15m":{native:"15m",ms:900000},
 "30m":{native:"30m",ms:1800000},
 "1h":{native:"1h",ms:3600000},
 "4h":{native:"4h",ms:14400000},
 "1d":{native:"1d",ms:86400000},
 "1w":{native:"1w",ms:604800000}
};

const $=id=>document.getElementById(id);

const CREDIT="agu_free_credits";
const MC="agu_market_cache_v3";
const MT="agu_market_cache_time_v3";
const AK="agu_alert_state_v3";
const LK="agu_alert_log_v3";

let monitoring=false;
let monitorTimer=null;
let alertBusy=false;
let lastAlert=readJSON(AK,{});

function readJSON(k,d){
 try{return JSON.parse(localStorage.getItem(k))??d}
 catch(_){return d}
}

function money(v){
 if(!Number.isFinite(Number(v)))return "N/A";
 let n=Number(v);
 return new Intl.NumberFormat("en-US",{
  minimumFractionDigits:2,
  maximumFractionDigits:n>=1000?2:8
 }).format(n);
}

function esc(s){
 return String(s).replace(/[&<>"']/g,c=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",
  '"':"&quot;","'":"&#39;"
 }[c]));
}

function toast(s){
 let e=$("toast");
 if(e){
  e.textContent=s;
  e.classList.add("show");
  setTimeout(()=>e.classList.remove("show"),4000);
 }
}

function url(base,path,p={}){
 let q=new URLSearchParams(p).toString();
 return base+path+(q?"?"+q:"");
}

async function request(u){
 if(!navigator.onLine)throw Error("Device is offline.");

 let c=new AbortController();
 let t=setTimeout(()=>c.abort(),20000);

 try{
  let r=await fetch(u,{cache:"no-store",signal:c.signal});
  if(!r.ok)throw Error("Market API HTTP "+r.status);
  return await r.json();
 }catch(e){
  if(e.name==="AbortError")throw Error("Market request timed out.");
  throw e;
 }finally{
  clearTimeout(t);
 }
}

function connection(state,msg){
 let e=$("connection");
 if(!e)return;

 e.textContent=state==="live"?"● Live":
 state==="cached"?"● Cached":"● Offline";

 e.className=state==="live"?"pill green":"pill muted";
 e.title=msg||"";
}

function base(m){
 return m==="futures"?API.futures:API.spot;
}

async function marketReq(m,path,p={}){
 return request(url(base(m),path,p));
}

/* MARKET WATCH */

function showMarkets(items,stamp){
 let g=$("marketGrid");
 if(!g)return;

 g.innerHTML=items.map(x=>{
  let ch=Number(x.priceChangePercent);
  let up=ch>=0;

  return `
   <article class="market-card">
    <div class="coin">${esc(x.symbol.replace("USDT",""))}</div>
    <span class="price">$${money(Number(x.lastPrice))}</span>
    <span class="${up?"positive":"negative"}">
     ${up?"+":""}${ch.toFixed(2)}%
    </span>
    <div class="muted-note">24-hour change</div>
   </article>
  `;
 }).join("")+(stamp?
 `<p class="muted-note">
 Cached snapshot: ${new Date(stamp).toLocaleString()}
 — NOT live prices.
 </p>`:"");
}

async function loadMarkets(){
 let g=$("marketGrid");
 if(!g)return;

 try{
  let d=await request(url(API.spot,"/ticker/24hr"));

  if(!Array.isArray(d))throw Error("Unexpected API response");

  let a=d.filter(x=>ASSETS.includes(x.symbol))
   .sort((x,y)=>ASSETS.indexOf(x.symbol)-ASSETS.indexOf(y.symbol));

  if(a.length!==ASSETS.length)
   throw Error("Incomplete market response");

  showMarkets(a);

  localStorage.setItem(MC,JSON.stringify(a));
  localStorage.setItem(MT,String(Date.now()));

  connection("live","Live prices received "+new Date().toLocaleString());

 }catch(e){
  console.warn(e);

  let a=readJSON(MC,null);
  let t=Number(localStorage.getItem(MT))||null;

  if(a?.length){
   showMarkets(a,t);
   connection("cached","Cached only. "+e.message);
  }else{
   g.innerHTML=`<p class="muted-note">
    Market data unavailable: ${esc(e.message)}
   </p>`;
   connection("offline",e.message);
  }
 }
}

/* CANDLE DATA */

function convert(raw){
 if(!Array.isArray(raw))throw Error("Invalid candle response");

 return raw.map(c=>({
  time:+c[0],
  open:+c[1],
  high:+c[2],
  low:+c[3],
  close:+c[4],
  volume:+c[5],
  closeTime:+c[6]
 })).filter(c=>
  Object.values(c).every(Number.isFinite)&&
  c.high>=c.low
 );
}

function aggregate(a,ms){
 let map=new Map();

 for(let c of a){
  let t=Math.floor(c.time/ms)*ms;
  let g=map.get(t);

  if(!g){
   map.set(t,{
    time:t,
    open:c.open,
    high:c.high,
    low:c.low,
    close:c.close,
    volume:c.volume,
    closeTime:t+ms-1
   });
  }else{
   g.high=Math.max(g.high,c.high);
   g.low=Math.min(g.low,c.low);
   g.close=c.close;
   g.volume+=c.volume;
  }
 }

 return [...map.values()].sort((a,b)=>a.time-b.time);
}

async function getCandles(symbol,interval,market){
 let cfg=TF[interval];

 if(!cfg)throw Error("Unsupported timeframe "+interval);

 let raw=await marketReq(market,"/klines",{
  symbol,
  interval:cfg.native||cfg.base,
  limit:"500"
 });

 let a=convert(raw);

 if(cfg.base)a=aggregate(a,cfg.ms);

 let now=Date.now();

 a=a.filter(c=>c.closeTime<now).slice(-400);

 let min=interval==="1w"?200:220;

 if(a.length<min){
  throw Error(
   `Insufficient completed candles for ${interval}: ${a.length}; need ${min}.`
  );
 }

 let last=a.at(-1);
 let age=now-last.closeTime;

 if(age>cfg.ms*2.2){
  throw Error("Latest completed candle is stale; analysis stopped.");
 }

 return{
  candles:a,
  lastCandleClose:last.closeTime,
  age
 };
}

/* INDICATORS */

function sma(a,n){
 if(a.length<n)return null;
 return a.slice(-n).reduce((x,y)=>x+y,0)/n;
}

function ema(a,n){
 if(a.length<n)return null;

 let v=a.slice(0,n).reduce((x,y)=>x+y,0)/n;
 let k=2/(n+1);

 for(let i=n;i<a.length;i++){
  v+=(a[i]-v)*k;
 }

 return v;
}

function rsi(a,n=14){
 if(a.length<=n)return null;

 let g=0,l=0;

 for(let i=1;i<=n;i++){
  let d=a[i]-a[i-1];
  g+=Math.max(d,0);
  l+=Math.max(-d,0);
 }

 g/=n;
 l/=n;

 for(let i=n+1;i<a.length;i++){
  let d=a[i]-a[i-1];

  g=(g*(n-1)+Math.max(d,0))/n;
  l=(l*(n-1)+Math.max(-d,0))/n;
 }

 return l===0?
  (g===0?50:100):
  100-100/(1+g/l);
}

function macd(a){
 let series=[];

 for(let i=26;i<=a.length;i++){
  let p=a.slice(0,i);
  series.push(ema(p,12)-ema(p,26));
 }

 if(series.length<9)return null;

 let line=series.at(-1);
 let signal=ema(series,9);

 return{
  line,
  signal,
  histogram:line-signal
 };
}

function atr(a,n=14){
 let tr=[];

 for(let i=1;i<a.length;i++){
  let c=a[i],p=a[i-1];

  tr.push(Math.max(
   c.high-c.low,
   Math.abs(c.high-p.close),
   Math.abs(c.low-p.close)
  ));
 }

 if(tr.length<n)return null;

 let v=tr.slice(0,n).reduce((x,y)=>x+y,0)/n;

 for(let i=n;i<tr.length;i++){
  v=(v*(n-1)+tr[i])/n;
 }

 return v;
}

function adx(a,n=14){
 if(a.length<2*n+2)return null;

 let tr=[],pd=[],md=[];

 for(let i=1;i<a.length;i++){
  let c=a[i],p=a[i-1];
  let u=c.high-p.high;
  let d=p.low-c.low;

  tr.push(Math.max(
   c.high-c.low,
   Math.abs(c.high-p.close),
   Math.abs(c.low-p.close)
  ));

  pd.push(u>d&&u>0?u:0);
  md.push(d>u&&d>0?d:0);
 }

 let ts=tr.slice(0,n).reduce((x,y)=>x+y,0);
 let ps=pd.slice(0,n).reduce((x,y)=>x+y,0);
 let ms=md.slice(0,n).reduce((x,y)=>x+y,0);

 let dx=[];

 for(let i=n;i<tr.length;i++){
  if(i>n){
   ts=ts-ts/n+tr[i];
   ps=ps-ps/n+pd[i];
   ms=ms-ms/n+md[i];
  }

  if(ts<=0)continue;

  let p=100*ps/ts;
  let m=100*ms/ts;

  dx.push(p+m?100*Math.abs(p-m)/(p+m):0);
 }

 if(dx.length<n)return null;

 let v=dx.slice(0,n).reduce((x,y)=>x+y,0)/n;

 for(let i=n;i<dx.length;i++){
  v=(v*(n-1)+dx[i])/n;
 }

 return v;
}

function boll(a,n=20){
 if(a.length<n)return null;

 let m=sma(a,n);
 let v=a.slice(-n).reduce((s,x)=>s+(x-m)**2,0)/n;
 let d=Math.sqrt(v);

 return{
  upper:m+2*d,
  middle:m,
  lower:m-2*d
 };
}

function levels(a){
 let x=a.slice(-100);

 let lo=Math.min(...x.map(c=>c.low));
 let hi=Math.max(...x.map(c=>c.high));
 let r=hi-lo;

 return{
  support:lo,
  resistance:hi,
  fib:r>0?{
   level236:hi-r*.236,
   level382:hi-r*.382,
   level500:hi-r*.5,
   level618:hi-r*.618,
   level786:hi-r*.786
  }:null
 };
}

function pattern(a){
 let c=a.at(-1),p=a.at(-2);
 let b=Math.abs(c.close-c.open);
 let r=c.high-c.low;

 if(r<=0)return "No clear pattern";

 let u=c.high-Math.max(c.open,c.close);
 let l=Math.min(c.open,c.close)-c.low;

 if(p.close<p.open&&c.close>c.open&&
 c.close>=p.open&&c.open<=p.close)
  return "Bullish engulfing";

 if(p.close>p.open&&c.close<p.open&&
 c.close<=p.open&&c.open>=p.close)
  return "Bearish engulfing";

 if(b/r<.1)return "Doji";
 if(l>b*2&&u<b)return "Hammer-like candle";
 if(u>b*2&&l<b)return "Shooting-star-like candle";

 return "No clear pattern";
}

function volume(a){
 let v=a.map(c=>c.volume);
 let avg=sma(v.slice(-21,-1),20);
 let cur=v.at(-1);

 return{
  current:cur,
  average:avg,
  ratio:avg>0?cur/avg:null
 };
}

/* V3.1 SIGNAL ENGINE */

function analyze(a){

 const c=a.map(x=>x.close);
 const price=c.at(-1);

 const R=rsi(c);
 const e20=ema(c,20);
 const e50=ema(c,50);
 const e200=ema(c,200);

 const M=macd(c);
 const A=atr(a);
 const D=adx(a);
 const B=boll(c);
 const L=levels(a);
 const V=volume(a);
 const P=pattern(a);

 let bull=0;
 let bear=0;
 let evidence=[];

 const add=(side,msg)=>{
  if(side==="bull")bull++;
  else bear++;

  evidence.push(msg);
 };

 /* EMA trend */

 if(e20!==null&&e50!==null){
  add(
   e20>e50?"bull":"bear",
   e20>e50?"EMA20 above EMA50":"EMA20 below EMA50"
  );
 }

 if(e50!==null&&e200!==null){
  add(
   e50>e200?"bull":"bear",
   e50>e200?"EMA50 above EMA200":"EMA50 below EMA200"
  );
 }

 /* RSI confirmation */

 if(R!==null){
  if(R>=52&&R<=68){
   add("bull","RSI bullish range");
  }else if(R<=48&&R>=32){
   add("bear","RSI bearish range");
  }else{
   evidence.push("RSI neutral or extended");
  }
 }

 /* MACD confirmation */

 if(M){
  if(M.histogram>0){
   add("bull","MACD histogram positive");
  }else if(M.histogram<0){
   add("bear","MACD histogram negative");
  }else{
   evidence.push("MACD histogram flat");
  }
 }

 /* Price position */

 if(e20!==null){
  add(
   price>e20?"bull":"bear",
   price>e20?"Price above EMA20":"Price below EMA20"
  );
 }

 /* Candlestick confirmation */

 if(P==="Bullish engulfing")add("bull",P);
 if(P==="Bearish engulfing")add("bear",P);

 /* Volume confirmation */

 if(V?.ratio!==null&&V?.ratio!==undefined){

  if(V.ratio>=1.0){
   evidence.push("Volume confirms participation (≥1.00× average)");
  }else{
   evidence.push("Volume below average; confirmation missing");
  }
 }

 const volumeOK=
  Number.isFinite(V?.ratio)&&V.ratio>=1.0;

 const macdBull=!!M&&M.histogram>0;
 const macdBear=!!M&&M.histogram<0;

 const trendBull=
  e20!==null&&e50!==null&&e200!==null&&
  e20>e50&&e50>e200&&price>e20;

 const trendBear=
  e20!==null&&e50!==null&&e200!==null&&
  e20<e50&&e50<e200&&price<e20;

 /* Signal decision */

 let signal="WAIT";
 let reason="";

 if(D===null||D<18){

  reason="Trend strength is below the minimum ADX threshold";

 }else if(!volumeOK){

  reason="Volume confirmation is missing (below 1.00× average)";

 }else if(
  bull>=4&&bull>bear&&trendBull&&
  macdBull&&R!==null&&R>=52&&R<=68
 ){

  signal="BUY";

 }else if(
  bear>=4&&bear>bull&&trendBear&&
  macdBear&&R!==null&&R>=32&&R<=48
 ){

  signal="SELL";

 }else{

  reason="Trend, momentum and directional evidence are not sufficiently aligned";
 }

 /* ATR risk and market-structure-aware targets */

 let sl=null;
 let t1=null;
 let t2=null;
 let t3=null;
 let dist=null;
 let rr=null;
 let structureNote="";

 if(signal!=="WAIT"){

  dist=A*1.5;
  const pct=dist/price;

  if(!Number.isFinite(dist)||dist<=0||pct<.001||pct>.15){

   signal="WAIT";
   reason="Setup rejected: stop distance outside safety limits";

  }else{

   const risk=dist;
   const buffer=A*.15;

   if(signal==="BUY"){

    const room=L.resistance-price;

    if(room<=buffer){

     signal="WAIT";
     reason="Nearby resistance leaves insufficient upside room";

    }else{

     const cap=L.resistance-buffer;

     t1=Math.min(price+risk,cap);
     t2=Math.min(price+risk*2.5,cap);
     t3=Math.min(price+risk*3.5,cap);

     rr=(t1-price)/risk;

     if(rr<1.2){

      signal="WAIT";
      reason="Resistance limits the first target below 1.2R";

     }else{

      sl=price-risk;
      structureNote=
       "Targets capped below the 100-candle resistance zone.";

     }
    }

   }else{

    const room=price-L.support;

    if(room<=buffer){

     signal="WAIT";
     reason="Nearby support leaves insufficient downside room";

    }else{

     const floor=L.support+buffer;

     t1=Math.max(price-risk,floor);
     t2=Math.max(price-risk*2.5,floor);
     t3=Math.max(price-risk*3.5,floor);

     rr=(price-t1)/risk;

     if(rr<1.2){

      signal="WAIT";
      reason="Support limits the first target below 1.2R";

     }else{

      sl=price+risk;
      structureNote=
       "Targets capped above the 100-candle support zone.";

     }
    }
   }
  }
 }

 if(signal==="WAIT"){

  sl=t1=t2=t3=dist=rr=null;

  if(reason)evidence.push("WAIT: "+reason);
 }

 return{
  price,signal,bull,bear,
  rsi:R,
  ema20:e20,
  ema50:e50,
  ema200:e200,
  macd:M,
  atr:A,
  adx:D,
  boll:B,
  levels:L,
  volume:V,
  pattern:P,
  sl,t1,t2,t3,dist,rr,
  evidence,
  reason,
  structureNote
 };
}

/* RESULT RENDERING */

function display(r,symbol,interval,market,info){

 let box=$("analysisResult");
 if(!box)return;

 let cls=r.signal==="BUY"?"signal-buy":
 r.signal==="SELL"?"signal-sell":"signal-wait";

 let metric=(t,v)=>
 `<div class="metric"><span>${esc(t)}</span><strong>${v}</strong></div>`;

 let f=r.levels.fib;
 let b=r.boll;
 let m=r.macd;
 let v=r.volume;

 box.className="analysis-result";

 box.innerHTML=`

 <div class="signal-banner">

  <p class="eyebrow">
   ${esc(symbol)} · ${esc(interval)} · ${esc(market.toUpperCase())}
  </p>

  <h3 class="${cls}">${r.signal}</h3>

  <p>Reference price: $${money(r.price)}</p>

  <p class="muted-note">
   Last completed candle:
   ${new Date(info.lastCandleClose).toLocaleString()}
  </p>

  <p class="muted-note">
   Bullish factors: ${r.bull} | Bearish factors: ${r.bear}
  </p>

  <p class="muted-note">
   Evidence: ${r.evidence.map(esc).join(" · ")||"No directional evidence"}
  </p>

 </div>

 <h3>Momentum and trend</h3>

 <div class="metrics">

  ${metric("RSI (14)",r.rsi?.toFixed(2)??"N/A")}
  ${metric("EMA 20",money(r.ema20))}
  ${metric("EMA 50",money(r.ema50))}
  ${metric("EMA 200",money(r.ema200))}
  ${metric("MACD line",money(m?.line))}
  ${metric("MACD signal",money(m?.signal))}
  ${metric("MACD histogram",money(m?.histogram))}
  ${metric("ADX (14)",money(r.adx))}
  ${metric("ATR (14)",money(r.atr))}
  ${metric("Candlestick",esc(r.pattern))}

 </div>

 <h3>Volatility and volume</h3>

 <div class="metrics">

  ${metric("Bollinger upper",money(b?.upper))}
  ${metric("Bollinger middle",money(b?.middle))}
  ${metric("Bollinger lower",money(b?.lower))}
  ${metric("Current volume",money(v?.current))}
  ${metric("Previous 20-candle average",money(v?.average))}
  ${metric("Volume ratio",v?.ratio?.toFixed(2)??"N/A")}

 </div>

 <h3>Market structure · 100-candle swing range</h3>

 <div class="metrics">

  ${metric("Support / swing low","$"+money(r.levels.support))}
  ${metric("Resistance / swing high","$"+money(r.levels.resistance))}
  ${metric("Fib 23.6%",money(f?.level236))}
  ${metric("Fib 38.2%",money(f?.level382))}
  ${metric("Fib 50%",money(f?.level500))}
  ${metric("Fib 61.8%",money(f?.level618))}
  ${metric("Fib 78.6%",money(f?.level786))}

 </div>

 <h3>Trade planning references</h3>

 ${
  r.signal==="WAIT"?
  '<p class="muted-note">No valid trade setup. Entry, stop loss and targets are intentionally not provided.</p>'
  :
  `
   <div class="metrics">

    ${metric("Entry reference","$"+money(r.price))}
    ${metric("Stop loss","$"+money(r.sl))}
    ${metric("Take profit 1","$"+money(r.t1))}
    ${metric("Take profit 2","$"+money(r.t2))}
    ${metric("Take profit 3","$"+money(r.t3))}
    ${metric("Stop distance","$"+money(r.dist))}
    ${metric("Reward / risk to TP1",r.rr?.toFixed(2)+" : 1")}

   </div>

   ${r.structureNote?
   `<p class="muted-note">${esc(r.structureNote)}</p>`:""}
  `
 }

 <p class="disclaimer">
 Completed-candle technical analysis only.
 Estimates are not guaranteed predictions.
 No backtested win rate is claimed.
 This tool does not place trades.
 </p>

 <p class="disclaimer">
 Educational market analysis only. Not financial advice.
 Crypto trading can result in substantial losses.
 Never risk money you cannot afford to lose.
 </p>

 `;
}

/* FREE ANALYSES */

function credits(){
 let n=localStorage.getItem(CREDIT);

 if(n===null)return 4;

 n=Number(n);

 return Number.isFinite(n)?
 Math.max(0,Math.min(4,Math.floor(n))):4;
}

function updateCredits(){
 let e=$("credits");
 if(e)e.textContent=credits()+" / 4";
}

async function runAnalysis(alert=false){

 if(!alert&&credits()<=0){
  toast("Your free analysis allowance has been used.");
  return null;
 }

 let symbol=alert?
 $("alertSymbol")?.value:
 $("symbol")?.value;

 let interval=alert?
 $("alertInterval")?.value:
 $("interval")?.value;

 let market=alert?"spot":$("marketType")?.value;

 if(!symbol||!TF[interval]){
  if(!alert)toast("Select a valid asset and timeframe.");
  return null;
 }

 let btn=$("analyzeBtn");

 if(!alert&&btn){
  btn.disabled=true;
  btn.textContent="Analyzing…";
 }

 try{

  let info=await getCandles(symbol,interval,market);
  let r=analyze(info.candles);

  if(!alert){
   localStorage.setItem(CREDIT,String(Math.max(0,credits()-1)));
   updateCredits();
   display(r,symbol,interval,market,info);
  }

  return{...r,info};

 }catch(e){

  console.error(e);

  if(!alert){
   let box=$("analysisResult");

   if(box){
    box.className="analysis-empty";
    box.textContent="Analysis stopped: "+e.message;
   }
  }

  return null;

 }finally{

  if(!alert&&btn){
   btn.disabled=false;
   btn.textContent="Analyze market";
  }
 }
}

/* SMART ALERTS */

function sound(){

 try{

  let C=window.AudioContext||window.webkitAudioContext;
  if(!C)return;

  let c=new C();
  let o=c.createOscillator();
  let g=c.createGain();

  o.connect(g);
  g.connect(c.destination);

  o.frequency.value=880;
  g.gain.value=.12;

  o.start();

  setTimeout(()=>{
   o.stop();
   c.close();
  },300);

 }catch(e){
  console.warn(e);
 }
}

async function enableNotifications(){

 if(!("Notification"in window)){
  toast("Notifications are not supported.");
  return;
 }

 try{

  let p=await Notification.requestPermission();

  toast(
   p==="granted"?
   "Browser notifications enabled.":
   "Notification permission not granted."
  );

 }catch(_){
  toast("Could not request notification permission.");
 }
}

function alertLog(){

 let log=$("alertLog");
 if(!log)return;

 let entries=readJSON(LK,[]);

 if(!entries.length)return;

 log.innerHTML="";

 entries.slice(0,10).forEach(x=>{
  let d=document.createElement("div");
  d.className="alert-item";
  d.textContent=x;
  log.appendChild(d);
 });
}

function sendAlert(s,t,signal,p){

 let msg=s+" "+signal+" on "+t+" near $"+money(p);

 sound();

 if("Notification"in window&&Notification.permission==="granted"){

  try{
   new Notification("AGU Crypto Analyzer",{body:msg});
  }catch(e){
   console.warn(e);
  }
 }

 let entry=new Date().toLocaleString()+" — "+msg;

 let items=readJSON(LK,[]);

 items.unshift(entry);

 localStorage.setItem(LK,JSON.stringify(items.slice(0,10)));

 let log=$("alertLog");

 if(log){

  if(log.querySelector(".muted-note"))log.innerHTML="";

  let d=document.createElement("div");
  d.className="alert-item";
  d.textContent=entry;

  log.prepend(d);

  while(log.children.length>10)
   log.lastElementChild.remove();
 }
}

async function monitor(){

 if(!monitoring||alertBusy)return;

 alertBusy=true;

 try{

  let s=$("alertSymbol")?.value;
  let t=$("alertInterval")?.value;

  let r=await runAnalysis(true);

  if(!r)return;

  let key=s+"_"+t;

  if(r.signal!=="WAIT"){

   let state=r.signal+"_"+r.info.lastCandleClose;

   if(lastAlert[key]!==state){

    sendAlert(s,t,r.signal,r.price);

    lastAlert[key]=state;

    localStorage.setItem(AK,JSON.stringify(lastAlert));
   }
  }

  let status=$("alertStatus");

  if(status){
   status.textContent=
   "Monitoring active. Last completed candle checked: "+
   new Date(r.info.lastCandleClose).toLocaleString()+".";
  }

 }catch(e){
  console.warn("Monitor:",e);

 }finally{
  alertBusy=false;
 }
}

function startMonitoring(){

 let b=$("monitorBtn");
 let s=$("alertStatus");

 if(monitoring){

  monitoring=false;

  clearInterval(monitorTimer);
  monitorTimer=null;

  if(b)b.textContent="Start monitoring";
  if(s)s.textContent="Monitoring is off.";

  return;
 }

 monitoring=true;

 if(b)b.textContent="Stop monitoring";

 if(s){
  s.textContent=
  "Monitoring every 60 seconds while this page remains open. Fresh completed candles required.";
 }

 monitor();

 monitorTimer=setInterval(monitor,60000);
}

/* INITIALIZATION */

window.addEventListener("online",loadMarkets);

window.addEventListener("offline",()=>{
 connection("offline","Browser reports no internet connection.");
});

document.addEventListener("DOMContentLoaded",()=>{

 let y=$("year");

 if(y)y.textContent=new Date().getFullYear();

 updateCredits();
 alertLog();
 loadMarkets();

 $("refreshBtn")?.addEventListener("click",loadMarkets);

 $("analyzeBtn")?.addEventListener("click",()=>runAnalysis(false));

 $("notifyBtn")?.addEventListener("click",enableNotifications);

 $("monitorBtn")?.addEventListener("click",startMonitoring);

 if("serviceWorker"in navigator){

  navigator.serviceWorker.register("./sw.js")
  .catch(e=>console.warn("Service worker:",e));
 }

 setInterval(loadMarkets,60000);

});
