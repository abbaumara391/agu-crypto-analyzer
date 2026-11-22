"use strict";

/* =========================================
AGU CRYPTO ANALYZER
Owner: Umar Mohammed
Version: 1.1
========================================= */

const API = {
spot: [
"https://data-api.binance.vision/api/v3",
"https://api.binance.com/api/v3"
],
futures: [
"https://fapi.binance.com/fapi/v1"
]
};

const ASSETS = [
"BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT",
"XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT",
"LINKUSDT", "TONUSDT"
];

const $ = id => document.getElementById(id);

let monitoring = false;
let monitorTimer = null;
let lastAlert = {};
let alertBusy = false;

/* =========================================
HELPERS
========================================= */

function money(value) {
if (!Number.isFinite(value)) return "N/A";

return new Intl.NumberFormat("en-US", {
minimumFractionDigits: 2,
maximumFractionDigits: value >= 1000 ? 2 : 6
}).format(value);
}

function toast(message) {
const box = $("toast");
if (!box) return;

box.textContent = message;
box.classList.add("show");

setTimeout(() => box.classList.remove("show"), 4000);
}

async function request(url) {
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 12000);

try {
const response = await fetch(url, {
method: "GET",
cache: "no-store",
signal: controller.signal
});

if (!response.ok) {
  throw new Error("HTTP " + response.status);
}

return await response.json();

} finally {
clearTimeout(timeout);
}
}

function setConnection(online, message) {
const box = $("connection");

if (!box) return;

box.textContent = online ? "● Online" : "● Offline";
box.className = online ? "pill green" : "pill muted";

if (message) {
box.title = message;
}
}

/* =========================================
SPOT API WITH FALLBACK
========================================= */

async function spotRequest(path, params = {}) {
const query = new URLSearchParams(params).toString();

let lastError;

for (const base of API.spot) {
try {
const url = base + path + (query ? "?" + query : "");

  return await request(url);

} catch (error) {
  lastError = error;
  console.warn("Spot endpoint failed:", base, error.message);
}

}

throw new Error(
"All Spot endpoints failed. " +
(lastError?.message || "Unknown network error")
);
}

/* =========================================
FUTURES API
========================================= */

async function futuresRequest(path, params = {}) {
const query = new URLSearchParams(params).toString();

const url =
API.futures[0] +
path +
(query ? "?" + query : "");

return request(url);
}

/* =========================================
LIVE MARKET WATCH
========================================= */

async function loadMarkets() {
const grid = $("marketGrid");

try {
const data = await spotRequest("/ticker/24hr");

const selected = data
  .filter(item => ASSETS.includes(item.symbol))
  .sort((a, b) =>
    ASSETS.indexOf(a.symbol) -
    ASSETS.indexOf(b.symbol)
  );

if (!selected.length) {
  throw new Error("No matching market symbols returned.");
}

const html = selected.map(item => {
  const change = Number(item.priceChangePercent);
  const positive = change >= 0;

  return `
    <article class="market-card">
      <div class="coin">
        ${item.symbol.replace("USDT", "")}
      </div>

      <span class="price">
        $${money(Number(item.lastPrice))}
      </span>

      <span class="${positive ? "positive" : "negative"}">
        ${positive ? "+" : ""}${change.toFixed(2)}%
      </span>

      <div class="muted-note">24-hour change</div>
    </article>
  `;
}).join("");

grid.innerHTML = html;

localStorage.setItem("agu_market_cache", html);
localStorage.setItem("agu_market_cache_time", Date.now());

setConnection(true, "Live Spot market data connected.");

} catch (error) {
console.error("Market loading error:", error);

const cached = localStorage.getItem("agu_market_cache");

grid.innerHTML = cached
  ? cached +
    '<p class="muted-note">Cached data — not live prices.</p>'
  : '<p class="muted-note">Market connection failed: ' +
    error.message + '</p>';

setConnection(false, error.message);

}
}

/* =========================================
TECHNICAL INDICATORS
========================================= */

function ema(values, period) {
if (values.length < period) return null;

const multiplier = 2 / (period + 1);

let result = values
.slice(0, period)
.reduce((sum, value) => sum + value, 0) / period;

for (let i = period; i < values.length; i++) {
result =
(values[i] - result) * multiplier + result;
}

return result;
}

function sma(values, period) {
if (values.length < period) return null;

const recent = values.slice(-period);

return recent.reduce(
(sum, value) => sum + value,
0
) / period;
}

function calculateRSI(values, period = 14) {
if (values.length <= period) return null;

let gains = 0;
let losses = 0;

for (let i = 1; i <= period; i++) {
const change = values[i] - values[i - 1];

if (change > 0) gains += change;
else losses -= change;

}

let averageGain = gains / period;
let averageLoss = losses / period;

for (let i = period + 1; i < values.length; i++) {
const change = values[i] - values[i - 1];

averageGain =
  (averageGain * (period - 1) +
  Math.max(change, 0)) / period;

averageLoss =
  (averageLoss * (period - 1) +
  Math.max(-change, 0)) / period;

}

if (averageLoss === 0) return 100;

const rs = averageGain / averageLoss;

return 100 - (100 / (1 + rs));
}

function calculateMACD(values) {
const fast = ema(values, 12);
const slow = ema(values, 26);

if (fast === null || slow === null) return null;

return fast - slow;
}

function calculateATR(candles, period = 14) {
if (candles.length <= period) return null;

const ranges = [];

for (let i = 1; i < candles.length; i++) {
const current = candles[i];
const previous = candles[i - 1];

ranges.push(Math.max(
  current.high - current.low,
  Math.abs(current.high - previous.close),
  Math.abs(current.low - previous.close)
));

}

return sma(ranges, period);
}

/* =========================================
SUPPORT AND RESISTANCE
========================================= */

function findLevels(candles) {
const recent = candles.slice(-50);

return {
support: Math.min(...recent.map(c => c.low)),
resistance: Math.max(...recent.map(c => c.high))
};
}

/* =========================================
MARKET DATA
========================================= */

async function getCandles(symbol, interval, marketType) {
const params = {
symbol: symbol,
interval: interval,
limit: "200"
};

let raw;

if (marketType === "futures") {
raw = await futuresRequest("/klines", params);
} else {
raw = await spotRequest("/klines", params);
}

if (!Array.isArray(raw) || raw.length < 50) {
throw new Error("Insufficient candle data received.");
}

return raw.map(candle => ({
time: Number(candle[0]),
open: Number(candle[1]),
high: Number(candle[2]),
low: Number(candle[3]),
close: Number(candle[4]),
volume: Number(candle[5])
}));
}

/* =========================================
ANALYSIS ENGINE
========================================= */

function analyzeCandles(candles) {
const closes = candles.map(c => c.close);

const price = closes[closes.length - 1];

const rsi = calculateRSI(closes);
const ema20 = ema(closes, 20);
const ema50 = ema(closes, 50);
const ema200 = ema(closes, 200);
const macd = calculateMACD(closes);
const atr = calculateATR(candles);

const levels = findLevels(candles);

let bullish = 0;
let bearish = 0;

if (ema20 !== null && ema50 !== null) {
if (ema20 > ema50) bullish++;
else bearish++;
}

if (ema50 !== null && ema200 !== null) {
if (ema50 > ema200) bullish++;
else bearish++;
}

if (rsi !== null) {
if (rsi > 50 && rsi < 70) bullish++;
if (rsi < 50 && rsi > 30) bearish++;
}

if (macd !== null) {
if (macd > 0) bullish++;
else bearish++;
}

if (ema20 !== null) {
if (price > ema20) bullish++;
else bearish++;
}

let signal = "WAIT";

if (bullish >= 4 && bullish > bearish) {
signal = "BUY";
} else if (bearish >= 4 && bearish > bullish) {
signal = "SELL";
}

let stopLoss = null;
let takeProfit1 = null;
let takeProfit2 = null;
let takeProfit3 = null;

if (atr !== null && atr > 0) {
if (signal === "BUY") {
stopLoss = price - atr * 1.5;
takeProfit1 = price + atr * 1.5;
takeProfit2 = price + atr * 2.5;
takeProfit3 = price + atr * 3.5;
}

if (signal === "SELL") {
  stopLoss = price + atr * 1.5;
  takeProfit1 = price - atr * 1.5;
  takeProfit2 = price - atr * 2.5;
  takeProfit3 = price - atr * 3.5;
}

}

return {
price,
signal,
bullish,
bearish,
rsi,
ema20,
ema50,
ema200,
macd,
atr,
support: levels.support,
resistance: levels.resistance,
stopLoss,
takeProfit1,
takeProfit2,
takeProfit3
};
}

/* =========================================
DISPLAY ANALYSIS
========================================= */

function displayAnalysis(result, symbol, interval, marketType) {
const box = $("analysisResult");

const signalClass =
result.signal === "BUY"
? "signal-buy"
: result.signal === "SELL"
? "signal-sell"
: "signal-wait";

function metric(title, value) {
return "<div class="metric"> <span>${title}</span> <strong>${value}</strong> </div>";
}

box.className = "analysis-result";

box.innerHTML = `
<div class="signal-banner">

  <p class="eyebrow">
    ${symbol} · ${interval} · ${marketType.toUpperCase()}
  </p>

  <h3 class="${signalClass}">
    ${result.signal}
  </h3>

  <p>Reference price: $${money(result.price)}</p>

  <p class="muted-note">
    Bullish factors: ${result.bullish} |
    Bearish factors: ${result.bearish}
  </p>

</div>

<div class="metrics">

  ${metric("RSI (14)", result.rsi?.toFixed(2) ?? "N/A")}
  ${metric("EMA 20", money(result.ema20))}
  ${metric("EMA 50", money(result.ema50))}
  ${metric("EMA 200", money(result.ema200))}
  ${metric("MACD", money(result.macd))}
  ${metric("ATR (14)", money(result.atr))}
  ${metric("Support", "$" + money(result.support))}
  ${metric("Resistance", "$" + money(result.resistance))}
  ${metric("Entry reference", "$" + money(result.price))}
  ${metric("Stop loss", "$" + money(result.stopLoss))}
  ${metric("Take profit 1", "$" + money(result.takeProfit1))}
  ${metric("Take profit 2", "$" + money(result.takeProfit2))}
  ${metric("Take profit 3", "$" + money(result.takeProfit3))}

</div>

<p class="disclaimer">
  Automated technical analysis, not verified profitable signals.
  Entry and exit levels are illustrative volatility references.
  Always independently verify market conditions.
</p>

`;
}

/* =========================================
FREE ANALYSIS COUNTER
========================================= */

function getCredits() {
return Number(
localStorage.getItem("agu_free_credits") ?? 4
);
}

function updateCredits() {
$("credits").textContent = getCredits() + " / 4";
}

/* =========================================
RUN ANALYSIS
========================================= */

async function runAnalysis(isAlert = false) {
if (!isAlert && getCredits() <= 0) {
toast("Your free analysis allowance has been used.");
return null;
}

const symbol = isAlert
? $("alertSymbol").value
: $("symbol").value;

const interval = isAlert
? $("alertInterval").value
: $("interval").value;

const marketType = isAlert
? "spot"
: $("marketType").value;

try {
const candles = await getCandles(
symbol,
interval,
marketType
);

const result = analyzeCandles(candles);

if (!isAlert) {
  const remaining = Math.max(0, getCredits() - 1);

  localStorage.setItem(
    "agu_free_credits",
    remaining
  );

  updateCredits();

  displayAnalysis(
    result,
    symbol,
    interval,
    marketType
  );
}

return result;

} catch (error) {
console.error("Analysis error:", error);

if (!isAlert) {
  $("analysisResult").textContent =
    "Analysis failed: " + error.message;
}

return null;

}
}

/* =========================================
SOUND AND NOTIFICATIONS
========================================= */

function playAlertSound() {
try {
const AudioContext =
window.AudioContext ||
window.webkitAudioContext;

if (!AudioContext) return;

const context = new AudioContext();
const oscillator = context.createOscillator();
const gain = context.createGain();

oscillator.connect(gain);
gain.connect(context.destination);

oscillator.frequency.value = 880;
gain.gain.value = 0.15;

oscillator.start();

setTimeout(() => {
  oscillator.stop();
  context.close();
}, 350);

} catch (error) {
console.warn("Sound unavailable:", error);
}
}

async function enableNotifications() {
if (!("Notification" in window)) {
toast("Notifications are not supported.");
return;
}

const permission = await Notification.requestPermission();

toast(
permission === "granted"
? "Browser notifications enabled."
: "Notification permission was not granted."
);
}

function sendAlert(symbol, interval, signal, price) {
const message =
symbol + " " + signal +
" on " + interval +
" near $" + money(price);

playAlertSound();

if (
"Notification" in window &&
Notification.permission === "granted"
) {
new Notification("AGU Crypto Analyzer", {
body: message
});
}

const log = $("alertLog");

const item = document.createElement("div");

item.className = "alert-item";

item.textContent =
new Date().toLocaleTimeString() +
" — " + message;

log.prepend(item);

while (log.children.length > 10) {
log.lastElementChild.remove();
}
}

/* =========================================
SMART MONITORING
========================================= */

async function monitorMarket() {
if (!monitoring || alertBusy) return;

alertBusy = true;

try {
const symbol = $("alertSymbol").value;
const interval = $("alertInterval").value;

const result = await runAnalysis(true);

if (!result || result.signal === "WAIT") return;

const key = symbol + "_" + interval;
const previous = lastAlert[key];

if (previous !== result.signal) {
  sendAlert(
    symbol,
    interval,
    result.signal,
    result.price
  );

  lastAlert[key] = result.signal;
}

} finally {
alertBusy = false;
}
}

function startMonitoring() {
if (monitoring) {
monitoring = false;

clearInterval(monitorTimer);

$("monitorBtn").textContent = "Start monitoring";
$("alertStatus").textContent = "Monitoring is off.";

return;

}

monitoring = true;

$("monitorBtn").textContent = "Stop monitoring";

$("alertStatus").textContent =
"Monitoring every 60 seconds while this page remains open.";

monitorMarket();

monitorTimer = setInterval(
monitorMarket,
60000
);
}

/* =========================================
NETWORK STATUS
========================================= */

window.addEventListener("online", () => {
loadMarkets();
});

window.addEventListener("offline", () => {
setConnection(false, "Browser reports no internet connection.");
});

/* =========================================
INITIALIZATION
========================================= */

document.addEventListener("DOMContentLoaded", () => {
$("year").textContent = new Date().getFullYear();

updateCredits();

loadMarkets();

$("refreshBtn").addEventListener(
"click",
loadMarkets
);

$("analyzeBtn").addEventListener(
"click",
() => runAnalysis(false)
);

$("notifyBtn").addEventListener(
"click",
enableNotifications
);

$("monitorBtn").addEventListener(
"click",
startMonitoring
);

if ("serviceWorker" in navigator) {
navigator.serviceWorker.register("./sw.js")
.catch(error => {
console.warn("Service worker failed:", error);
});
}

setInterval(loadMarkets, 60000);
});
