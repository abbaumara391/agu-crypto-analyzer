"use strict";

/* =========================================================
AGU CRYPTO ANALYZER V3.3
Owner: Umar Mohammed

MARKET DATA:
Binance public market endpoints.

SECURITY:

No exchange API secrets.

No real order execution.

No payment processing.

No live trading.

Paper trading is browser-side simulation.

Existing V3.2 paper accounts are migrated.
========================================================= */


const VERSION = "3.3";

const API = {
spot: "https://data-api.binance.vision/api/v3",
futures: "https://fapi.binance.com/fapi/v1"
};

const ASSETS = [
"BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT",
"XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT",
"LINKUSDT", "TONUSDT"
];

const TF = {
"1m": { ms: 60000 },
"5m": { ms: 300000 },
"10m": { ms: 600000, source: "5m" },
"15m": { ms: 900000 },
"30m": { ms: 1800000 },
"1h": { ms: 3600000 },
"4h": { ms: 14400000 },
"1d": { ms: 86400000 },
"1w": { ms: 604800000 }
};

const HIGHER = {
"1m": ["5m", "15m"],
"5m": ["15m", "1h"],
"10m": ["30m", "1h"],
"15m": ["1h", "4h"],
"30m": ["1h", "4h"],
"1h": ["4h", "1d"],
"4h": ["1d", "1w"],
"1d": ["1w"],
"1w": []
};

const $ = id => document.getElementById(id);

const STORE = {
credits: "agu_free_credits",
theme: "agu_theme_v32",

market: "agu_market_cache_v3",
marketTime: "agu_market_cache_time_v3",

alerts: "agu_alert_log_v3",
alertState: "agu_alert_state_v3",

paper: "agu_paper_account_v33",
oldPaper: "agu_paper_account_v32",

risk: "agu_paper_risk_v33",
oldRisk: "agu_paper_risk_v32",

backtest: "agu_last_backtest_v33"
};

const STARTING_BALANCE = 10000;

const FEE_RATE = 0.001;
const SLIPPAGE_RATE = 0.0005;

const DEFAULT_RISK = {
balance: STARTING_BALANCE,
riskPercent: 1,
dailyLossLimit: 3,

stopATR: 1.5,
targetRR: 2,

trailingEnabled: false,
trailingATR: 1.5
};

let monitoring = false;
let monitorTimer = null;

let lastAnalysis = null;
let lastMarketPrices = {};
let lastMarketPriceTimes = {};
const MAX_PRICE_AGE_MS = 60000;

let busyAnalysis = false;
let managingPaper = false;

/* =========================================================
UTILITIES
========================================================= */

function money(value) {
if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "N/A";

return "$" + Number(value).toLocaleString("en-US", {
minimumFractionDigits: 2,
maximumFractionDigits: 6
});
}

function number(value, digits = 2) {
if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "N/A";

return Number(value).toLocaleString("en-US", {
maximumFractionDigits: digits
});
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function isValidPositivePrice(value) {
  if (value === null || value === undefined || value === "") return false;
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function toast(message) {
const el = $("toast");

if (!el) return;

el.textContent = message;
el.classList.add("show");

clearTimeout(toast.timer);

toast.timer = setTimeout(() => {
el.classList.remove("show");
}, 3500);
}

function readJSON(key, fallback) {
try {
const value = localStorage.getItem(key);
return value ? JSON.parse(value) : fallback;
} catch {
return fallback;
}
}

function saveJSON(key, value) {
try {
localStorage.setItem(key, JSON.stringify(value));
return true;
} catch {
toast("Browser storage unavailable or full.");
return false;
}
}

function sleep(ms) {
return new Promise(resolve => setTimeout(resolve, ms));
}

function setButtonLoading(button, loading, text) {
if (!button) return;

button.disabled = loading;

if (loading) {
if (!button.dataset.originalText) {
button.dataset.originalText = button.textContent;
}

button.textContent = text || "Please wait…";

} else if (button.dataset.originalText) {
button.textContent = button.dataset.originalText;
delete button.dataset.originalText;
}
}

function utcTime(time) {
return new Date(time).toLocaleString();
}

function apiURL(market) {
return API[market === "futures" ? "futures" : "spot"];
}

function dayKey(time = Date.now()) {
return new Date(time).toISOString().slice(0, 10);
}

async function request(url) {
const controller = new AbortController();

const timer = setTimeout(
() => controller.abort(),
15000
);

try {
const response = await fetch(url, {
signal: controller.signal,
cache: "no-store"
});

if (!response.ok) {      
  throw new Error(      
    "Market server returned HTTP " + response.status      
  );      
}      
  
return await response.json();

} finally {
clearTimeout(timer);
}
}

/* =========================================================
THEME
========================================================= */

function applyTheme() {
const theme =
localStorage.getItem(STORE.theme) || "dark";

document.body.dataset.theme = theme;

const button = $("themeBtn");

if (button) {
button.textContent =
theme === "dark"
? " White Mode"
: " Dark Mode";
}

const meta = document.querySelector(
'meta[name="theme-color"]'
);

if (meta) {
meta.content =
theme === "dark"
? "#071a2e"
: "#f3f7fc";
}
}

function toggleTheme() {
const current =
localStorage.getItem(STORE.theme) || "dark";

const next =
current === "dark" ? "light" : "dark";

localStorage.setItem(STORE.theme, next);

applyTheme();
}
/* =========================================================
MARKET DATA
========================================================= */

async function loadMarkets() {
const grid = $("marketGrid");

try {
const data = await request(
API.spot + "/ticker/24hr"
);

const selected = data
.filter(item => ASSETS.includes(item.symbol))
.sort((a, b) =>
ASSETS.indexOf(a.symbol) -
ASSETS.indexOf(b.symbol)
);

if (!selected.length) {
throw new Error("Market prices unavailable.");
}

selected.forEach(item => {
  const price = Number(item.lastPrice);
  if (Number.isFinite(price) && price > 0) {
    lastMarketPrices[item.symbol] = price;
    lastMarketPriceTimes[item.symbol] = Date.now();
  }
});

saveJSON(STORE.market, selected);

localStorage.setItem(
STORE.marketTime,
String(Date.now())
);

renderMarkets(selected);

const connection = $("connection");

if (connection) {
connection.textContent = "Live market data";
connection.className = "pill green";
}

// V3.3 automatic paper-position monitoring.
await managePaperPositions();

} catch (error) {
const cached = readJSON(STORE.market, []);

if (cached.length) {
// Cached values are for display only, never execution/equity.
renderMarkets(cached, true);

const connection = $("connection");

if (connection) {
connection.textContent = "Cached snapshot";
connection.className = "pill muted";
}

} else if (grid) {
grid.innerHTML = `
<div class="loading">
Unable to retrieve market data.
Check your internet connection.
</div>
`;
}

console.error(error);

}
}

function renderMarkets(data, cached = false) {
const grid = $("marketGrid");

if (!grid) return;

grid.innerHTML = data.map(item => {
const change = Number(item.priceChangePercent);

const positive = change >= 0;

return `
  <div class="market-card">

    <span class="coin">
      ${esc(item.symbol)}
    </span>

    <span class="price">
      ${money(item.lastPrice)}
    </span>

    <span class="${positive ? "positive" : "negative"}">
      ${positive ? "+" : ""}${number(change)}%
    </span>

    ${cached
      ? '<small class="muted-note">Cached snapshot — not live</small>'
      : ""}

  </div>
`;

}).join("");
}

/* =========================================================
CANDLE DATA
========================================================= */

function convert(raw) {
return raw.map(c => ({
time: Number(c[0]),
open: Number(c[1]),
high: Number(c[2]),
low: Number(c[3]),
close: Number(c[4]),
volume: Number(c[5]),
closeTime: Number(c[6])
}));
}

function aggregate10m(candles) {
const groups = new Map();

candles.forEach(c => {
const start =
Math.floor(c.time / 600000) * 600000;

if (!groups.has(start)) {
groups.set(start, []);
}

groups.get(start).push(c);

});

return [...groups.entries()]
.map(([time, group]) => {
group.sort((a, b) => a.time - b.time);

if (group.length !== 2) return null;

return {
time,
open: group[0].open,

high: Math.max(
...group.map(c => c.high)
),

low: Math.min(
...group.map(c => c.low)
),

close: group[group.length - 1].close,

volume: group.reduce(
(sum, c) => sum + c.volume,
0
),

closeTime: time + 600000 - 1
};

})
.filter(Boolean);

}

async function getCandles(
symbol,
interval,
market = "spot",
limit = 500
) {
const config = TF[interval];

if (!config) {
throw new Error("Unsupported timeframe.");
}

limit = Math.max(
200,
Math.min(1000, Number(limit) || 500)
);

const sourceInterval =
config.source || interval;

const sourceLimit =
interval === "10m"
? Math.min(1000, limit * 2 + 10)
: Math.min(1000, limit);

const url =
apiURL(market) +
"/klines?symbol=" + encodeURIComponent(symbol) +
"&interval=" + sourceInterval +
"&limit=" + sourceLimit;

const raw = await request(url);

let candles = convert(raw);

if (interval === "10m") {
candles = aggregate10m(candles);
}

const now = Date.now();

candles = candles.filter(
c => c.closeTime < now
);

candles = candles.slice(-limit);

/*
V3.3 FIX:
V3.2 required 220 candles.
That requirement conflicted with the 200-candle
backtesting option.

EMA200 requires 200 observations.
Backtesting can now use 200 candles.
*/

const minimum = 200;

if (candles.length < minimum) {
throw new Error(
"Not enough completed candles. Received " +
candles.length +
"; need at least " +
minimum +
"."
);
}

const last = candles[candles.length - 1];

if (
now - last.closeTime >
config.ms * 2.2
) {
throw new Error("Market candles appear stale.");
}

return candles;
}
/* =========================================================
INDICATORS
========================================================= */

function emaSeries(values, period) {
const result =
Array(values.length).fill(null);

if (values.length < period) return result;

const multiplier = 2 / (period + 1);

let sum = 0;

for (let i = 0; i < period; i++) {
sum += values[i];
}

let previous = sum / period;

result[period - 1] = previous;

for (let i = period; i < values.length; i++) {
previous =
(values[i] - previous) *
multiplier + previous;

result[i] = previous;

}

return result;
}

function ema(values, period) {
const series = emaSeries(values, period);

return series[series.length - 1];
}

function sma(values, period) {
if (values.length < period) return null;

const part = values.slice(-period);

return part.reduce(
(a, b) => a + b,
0
) / period;
}

function rsi(values, period = 14) {
if (values.length <= period) return null;

let gain = 0;
let loss = 0;

for (let i = 1; i <= period; i++) {
const diff =
values[i] - values[i - 1];

if (diff > 0) gain += diff;      
else loss -= diff;

}

let avgGain = gain / period;
let avgLoss = loss / period;

for (let i = period + 1; i < values.length; i++) {
const diff =
values[i] - values[i - 1];

avgGain =      
  (      
    avgGain * (period - 1) +      
    Math.max(diff, 0)      
  ) / period;      
  
avgLoss =      
  (      
    avgLoss * (period - 1) +      
    Math.max(-diff, 0)      
  ) / period;

}

if (avgLoss === 0 && avgGain === 0) return 50;
if (avgLoss === 0) return 100;

return 100 - (
100 / (1 + avgGain / avgLoss)
);
}

function macd(values) {
const fast = emaSeries(values, 12);
const slow = emaSeries(values, 26);

const line = values.map((_, i) => {
if (
fast[i] === null ||
slow[i] === null
) {
return null;
}

return fast[i] - slow[i];

});

const valid = line.filter(
v => v !== null
);

const signalValid = emaSeries(valid, 9);

const signal =
signalValid[signalValid.length - 1];

const currentLine =
line[line.length - 1];

if (
signal === null ||
currentLine === null
) {
return {
line: null,
signal: null,
histogram: null
};
}

return {
line: currentLine,
signal,
histogram: currentLine - signal
};
}

function atr(candles, period = 14) {
if (candles.length < period + 1) {
return null;
}

const ranges = [];

for (let i = 1; i < candles.length; i++) {
const c = candles[i];

const previous =      
  candles[i - 1].close;      
  
ranges.push(Math.max(      
  c.high - c.low,      
  Math.abs(c.high - previous),      
  Math.abs(c.low - previous)      
));

}

return sma(ranges, period);
}

function adx(candles, period = 14) {
if (candles.length < period * 2 + 1) {
return null;
}

const tr = [];
const plus = [];
const minus = [];

for (let i = 1; i < candles.length; i++) {
const current = candles[i];
const previous = candles[i - 1];

const up =      
  current.high - previous.high;      
  
const down =      
  previous.low - current.low;      
  
plus.push(      
  up > down && up > 0 ? up : 0      
);      
  
minus.push(      
  down > up && down > 0 ? down : 0      
);      
  
tr.push(Math.max(      
  current.high - current.low,      
  Math.abs(current.high - previous.close),      
  Math.abs(current.low - previous.close)      
));

}

const dx = [];

for (let i = period - 1; i < tr.length; i++) {
const start = i - period + 1;

const trSum = tr      
  .slice(start, i + 1)      
  .reduce((a, b) => a + b, 0);      
  
const plusSum = plus      
  .slice(start, i + 1)      
  .reduce((a, b) => a + b, 0);      
  
const minusSum = minus      
  .slice(start, i + 1)      
  .reduce((a, b) => a + b, 0);      
  
if (!trSum) continue;      
  
const pdi = 100 * plusSum / trSum;      
const mdi = 100 * minusSum / trSum;      
  
const total = pdi + mdi;      
  
dx.push(      
  total      
    ? 100 * Math.abs(pdi - mdi) / total      
    : 0      
);

}

return sma(dx, period);
}

function bollinger(values, period = 20) {
if (values.length < period) return null;

const part = values.slice(-period);

const middle = sma(values, period);

const variance = part.reduce(
(sum, value) =>
sum + Math.pow(value - middle, 2),
0
) / period;

const deviation = Math.sqrt(variance);

return {
middle,
upper: middle + 2 * deviation,
lower: middle - 2 * deviation
};
}

/* =========================================================
SUPPORT / RESISTANCE
========================================================= */

function findLevels(candles, price) {
const data = candles.slice(-120);

const highs = [];
const lows = [];

for (let i = 2; i < data.length - 2; i++) {
const c = data[i];

if (      
  c.high > data[i - 1].high &&      
  c.high > data[i - 2].high &&      
  c.high >= data[i + 1].high &&      
  c.high >= data[i + 2].high      
) {      
  highs.push(c.high);      
}      
  
if (      
  c.low < data[i - 1].low &&      
  c.low < data[i - 2].low &&      
  c.low <= data[i + 1].low &&      
  c.low <= data[i + 2].low      
) {      
  lows.push(c.low);      
}

}

const resistance = highs
.filter(v => v > price)
.sort((a, b) => a - b);

const support = lows
.filter(v => v < price)
.sort((a, b) => b - a);

return {
support: support[0] ||
Math.min(...data.map(c => c.low)),

resistance: resistance[0] ||      
  Math.max(...data.map(c => c.high))

};
}

function fibonacci(candles) {
const data = candles.slice(-100);

const high = Math.max(
...data.map(c => c.high)
);

const low = Math.min(
...data.map(c => c.low)
);

const range = high - low;

return {
"23.6%": high - range * 0.236,
"38.2%": high - range * 0.382,
"50.0%": high - range * 0.5,
"61.8%": high - range * 0.618,
"78.6%": high - range * 0.786
};
}

function candlePattern(candles) {
if (candles.length < 2) {
return "None detected";
}

const current =
candles[candles.length - 1];

const previous =
candles[candles.length - 2];

const body = Math.abs(
current.close - current.open
);

const range =
current.high - current.low;

if (!range) return "None detected";

const lowerWick =
Math.min(current.open, current.close) -
current.low;

const upperWick =
current.high -
Math.max(current.open, current.close);

if (
lowerWick > body * 2 &&
upperWick < body * 1.2
) {
return "Hammer-like candle";
}

if (
upperWick > body * 2 &&
lowerWick < body * 1.2
) {
return "Shooting-star-like candle";
}

if (
current.close > current.open &&
previous.close < previous.open &&
current.close >= previous.open &&
current.open <= previous.close
) {
return "Bullish engulfing";
}

if (
current.close < current.open &&
previous.close > previous.open &&
current.open >= previous.close &&
current.close <= previous.open
) {
return "Bearish engulfing";
}

if (body / range < 0.1) {
return "Doji-like candle";
}

return "No major pattern";
}

function volumeRatio(candles) {
if (candles.length < 22) return null;

const current =
candles[candles.length - 1].volume;

const previous =
candles.slice(-21, -1);

const average = previous.reduce(
(sum, c) => sum + c.volume,
0
) / 20;

return average > 0
? current / average
: null;
}
/* =========================================================
BASE ANALYSIS
========================================================= */

function analyze(candles) {
const closes =
candles.map(c => c.close);

const price =
closes[closes.length - 1];

const e20 = ema(closes, 20);
const e50 = ema(closes, 50);
const e200 = ema(closes, 200);

const strength = rsi(closes);
const momentum = macd(closes);

const volatility = atr(candles);
const trendPower = adx(candles);

const bands = bollinger(closes);

if (
[e20, e50, e200, strength, volatility, trendPower]
.some(v => !Number.isFinite(v)) ||

!Number.isFinite(momentum.histogram)

) {
throw new Error(
"Insufficient data for reliable indicators."
);
}

const ratio = volumeRatio(candles);

const levels = findLevels(candles, price);

const fib = fibonacci(candles);

const pattern = candlePattern(candles);

let bullish = 0;
let bearish = 0;

const evidence = [];

if (e20 > e50 && e50 > e200) {
bullish++;
evidence.push("Bullish EMA20/50/200 alignment");
}

if (e20 < e50 && e50 < e200) {
bearish++;
evidence.push("Bearish EMA20/50/200 alignment");
}

if (price > e20) {
bullish++;
evidence.push("Price above EMA20");
} else {
bearish++;
evidence.push("Price below EMA20");
}

if (strength >= 52 && strength <= 68) {
bullish++;
evidence.push("Bullish RSI range");
}

if (strength <= 48 && strength >= 32) {
bearish++;
evidence.push("Bearish RSI range");
}

if (momentum.histogram > 0) {
bullish++;
evidence.push("Positive MACD histogram");
} else {
bearish++;
evidence.push("Negative MACD histogram");
}

if (pattern === "Bullish engulfing") {
bullish++;
}

if (pattern === "Bearish engulfing") {
bearish++;
}

if (ratio !== null && ratio >= 1) {
evidence.push(
"Volume above previous 20-candle average"
);
}

const upTrend =
e20 > e50 && e50 > e200;

const downTrend =
e20 < e50 && e50 < e200;

const volumeConfirmed =
ratio !== null && ratio >= 1;

const strongADX =
trendPower >= 18;

let signal = "WAIT";

let reason =
"The required conditions are not fully aligned.";

if (
bullish >= 4 &&
bullish > bearish &&
upTrend &&
strength >= 52 &&
strength <= 68 &&
momentum.histogram > 0 &&
volumeConfirmed &&
strongADX
) {
signal = "BUY";
}

if (
bearish >= 4 &&
bearish > bullish &&
downTrend &&
strength <= 48 &&
strength >= 32 &&
momentum.histogram < 0 &&
volumeConfirmed &&
strongADX
) {
signal = "SELL";
}

if (signal === "WAIT") {
const missing = [];

if (!volumeConfirmed) {
missing.push("volume confirmation");
}

if (!strongADX) {
missing.push("ADX trend strength");
}

if (momentum.histogram === 0) {
missing.push("MACD direction");
}

if (missing.length) {
reason = "Missing: " + missing.join(", ") + ".";
} else {
reason =
"Trend, momentum and directional evidence conflict.";
}

}

const riskDistance =
volatility * 1.5;

let stop = null;
let target1 = null;
let target2 = null;
let rewardRisk = null;

if (signal === "BUY") {
stop = price - riskDistance;

target1 = price + riskDistance * 1.5;
target2 = price + riskDistance * 2.5;

if (levels.resistance > price) {
target1 = Math.min(
target1,
levels.resistance
);
}

rewardRisk =
(target1 - price) / (price - stop);

if (rewardRisk < 1.2) {
signal = "WAIT";

reason =
"Nearest resistance does not provide the required reward-to-risk ratio.";

stop = target1 = target2 = rewardRisk = null;
}

}

if (signal === "SELL") {
stop = price + riskDistance;

target1 = price - riskDistance * 1.5;
target2 = price - riskDistance * 2.5;

if (levels.support < price) {
target1 = Math.max(
target1,
levels.support
);
}

rewardRisk =
(price - target1) / (stop - price);

if (rewardRisk < 1.2) {
signal = "WAIT";

reason =
"Nearest support does not provide the required reward-to-risk ratio.";

stop = target1 = target2 = rewardRisk = null;
}

}

if (signal !== "WAIT") {
reason =
"The base timeframe satisfies the configured strategy conditions.";
}

return {
signal,
price,

e20,
e50,
e200,

rsi: strength,
macd: momentum,

atr: volatility,
adx: trendPower,

volumeRatio: ratio,

pattern,
levels,
fib,
bands,

bullish,
bearish,
evidence,

reason,

stop,
target1,
target2,

rewardRisk,

candleTime:
candles[candles.length - 1].closeTime

};
}
/* =========================================================
MULTI-TIMEFRAME CONFIRMATION
========================================================= */

function classifyTrend(candles) {
const closes =
candles.map(c => c.close);

const e20 = ema(closes, 20);
const e50 = ema(closes, 50);
const e200 = ema(closes, 200);

const strength = rsi(closes);
const momentum = macd(closes);

const up =
e20 > e50 && e50 > e200;

const down =
e20 < e50 && e50 < e200;

if (
up &&
closes[closes.length - 1] > e20 &&
strength > 50 &&
momentum.histogram > 0
) {
return "Bullish";
}

if (
down &&
closes[closes.length - 1] < e20 &&
strength < 50 &&
momentum.histogram < 0
) {
return "Bearish";
}

return "Mixed";
}

async function getMTF(symbol, interval, market) {
const timeframes =
HIGHER[interval] || [];

if (!timeframes.length) {
return {
items: [],
available: 0,
direction: "No higher timeframe available"
};
}

const items = [];

for (const tf of timeframes) {
try {
const candles =
await getCandles(symbol, tf, market, 300);

items.push({
timeframe: tf,
trend: classifyTrend(candles),
error: null
});

} catch (error) {
items.push({
timeframe: tf,
trend: "Unavailable",
error: error.message
});
}

}

const available = items.filter(
item => item.trend !== "Unavailable"
);

return {
items,
available: available.length,
direction: "Higher-timeframe context"
};
}

function applyMTF(base, mtf) {
if (base.signal === "WAIT") {
return {
...base,
grade: "Weak",
gradeReason:
"The base timeframe has not produced a valid setup."
};
}

const direction =
base.signal === "BUY"
? "Bullish"
: "Bearish";

const available = mtf.items.filter(
item => item.trend !== "Unavailable"
);

const opposite = available.filter(
item =>
item.trend !== "Mixed" &&
item.trend !== direction
);

const aligned = available.filter(
item => item.trend === direction
);

if (opposite.length) {
return {
...base,

signal: "WAIT",

grade: "Weak",

stop: null,
target1: null,
target2: null,
rewardRisk: null,

reason:
"Higher-timeframe conflict detected. No trade setup approved."
};

}

let grade = "Weak";

let gradeReason =
"Higher-timeframe confirmation is limited.";

if (
available.length &&
aligned.length === available.length
) {
grade =
available.length >= 2
? "Strong"
: "Moderate";

gradeReason =
"Higher-timeframe trends agree with the base signal.";

} else if (aligned.length > 0) {
grade = "Moderate";

gradeReason =
"At least one higher timeframe supports the base signal.";

}

if (!available.length) {
grade = "Weak";

gradeReason =
"Higher-timeframe data unavailable; base signal only.";

}

if (!mtf.items.length) {
grade = "Moderate";

gradeReason =
"Weekly analysis has no higher timeframe available.";

}

return {
...base,
grade,
gradeReason
};
}
function displayAnalysis(
result,
symbol,
market,
interval,
mtf
) {
const output = $("analysisResult");

if (!output) return;

const signalClass =
result.signal === "BUY"
? "signal-buy"
: result.signal === "SELL"
? "signal-sell"
: "signal-wait";

const tradeHTML =
result.signal === "WAIT"
? "<p>No entry, stop-loss or take-profit is issued for a WAIT signal.</p>"
: `
<div class="result-grid">

<div class="result-stat">
        <span>Reference entry</span>
        <strong>${money(result.price)}</strong>
      </div>

      <div class="result-stat">
        <span>Stop-loss</span>
        <strong>${money(result.stop)}</strong>
      </div>

      <div class="result-stat">
        <span>Take profit 1</span>
        <strong>${money(result.target1)}</strong>
      </div>

      <div class="result-stat">
        <span>Take profit 2</span>
        <strong>${money(result.target2)}</strong>
      </div>

      <div class="result-stat">
        <span>Reward/risk</span>
        <strong>${number(result.rewardRisk)} : 1</strong>
      </div>

    </div>
  `;

output.innerHTML = `
<div class="result-card">

<div class="signal-banner">

    <h3 class="${signalClass}">
      ${result.signal}
    </h3>

    <p>
      ${esc(symbol)} · ${esc(market)} · ${esc(interval)}
    </p>

    <p>
      Reference price: <b>${money(result.price)}</b>
    </p>

    <p>
      Last completed candle:
      ${utcTime(result.candleTime)}
    </p>

    <p>${esc(result.reason)}</p>

  </div>

  <h3>Technical indicators</h3>

  <div class="metrics">

    <div class="metric">
      <span>EMA20</span>
      <strong>${money(result.e20)}</strong>
    </div>

    <div class="metric">
      <span>EMA50</span>
      <strong>${money(result.e50)}</strong>
    </div>

    <div class="metric">
      <span>EMA200</span>
      <strong>${money(result.e200)}</strong>
    </div>

    <div class="metric">
      <span>RSI14</span>
      <strong>${number(result.rsi)}</strong>
    </div>

    <div class="metric">
      <span>MACD histogram</span>
      <strong>${number(result.macd.histogram, 5)}</strong>
    </div>

    <div class="metric">
      <span>ADX</span>
      <strong>${number(result.adx)}</strong>
    </div>

    <div class="metric">
      <span>ATR</span>
      <strong>${money(result.atr)}</strong>
    </div>

    <div class="metric">
      <span>Volume ratio</span>
      <strong>
        ${result.volumeRatio === null
          ? "N/A"
          : number(result.volumeRatio) + "x"}
      </strong>
    </div>

  </div>

  <h3>Trade plan</h3>

  ${tradeHTML}

  <h3>Support and resistance</h3>

  <div class="metrics">

    <div class="metric">
      <span>Support</span>
      <strong>${money(result.levels.support)}</strong>
    </div>

    <div class="metric">
      <span>Resistance</span>
      <strong>${money(result.levels.resistance)}</strong>
    </div>

  </div>

  <h3>Fibonacci reference levels</h3>

  <div class="metrics">

    ${Object.entries(result.fib).map(
      ([key, value]) => `
        <div class="metric">
          <span>${key}</span>
          <strong>${money(value)}</strong>
        </div>
      `
    ).join("")}

  </div>

  <p class="muted-note">
    Candlestick observation:
    ${esc(result.pattern)}
  </p>

  <p class="muted-note">
    Evidence count:
    ${result.bullish} bullish · ${result.bearish} bearish.
  </p>

</div>

`;

const grade = $("signalGrade");

if (grade) {
grade.innerHTML = `
<div class="result-card">

<b class="grade-${result.grade.toLowerCase()}">
      ${result.grade} signal grade
    </b>

    <p>${esc(result.gradeReason)}</p>

    <small>
      Grade measures evidence alignment,
      not probability of profit.
    </small>

  </div>
`;

}

const trend = $("trendSummary");

if (trend) {
const text =
result.e20 > result.e50 &&
result.e50 > result.e200
? "Bullish base-timeframe structure"
: result.e20 < result.e50 &&
result.e50 < result.e200
? "Bearish base-timeframe structure"
: "Mixed base-timeframe structure";

trend.innerHTML = `
  <div class="result-card">
    <b>${esc(text)}</b>
    <p>
      RSI: ${number(result.rsi)}
      · ADX: ${number(result.adx)}
    </p>
  </div>
`;

}

renderMTF(mtf);

lastAnalysis = {
result,
symbol,
market,
interval,
mtf
};
}

function renderMTF(mtf) {
const status = $("mtfStatus");
const container = $("timeframeConfirmation");

if (!container) return;

if (!mtf.items.length) {
container.innerHTML = `<div class="metric"><span>Higher timeframe</span><strong>Not available for weekly analysis</strong></div>`;

if (status) {
  status.textContent = "Weekly analysis";
}

return;

}

container.innerHTML = mtf.items.map(item => `
<div class="metric">

<span>${esc(item.timeframe)}</span>

  <strong>${esc(item.trend)}</strong>

  ${item.error
    ? `<small>${esc(item.error)}</small>`
    : ""}

</div>

`).join("");

if (status) {
status.textContent =
mtf.available +
" / " +
mtf.items.length +
" confirmations available";
}
}
/* =========================================================
FREE ANALYSIS CREDITS
========================================================= */

function getCredits() {
const stored =
localStorage.getItem(STORE.credits);

if (stored === null) {
localStorage.setItem(STORE.credits, "4");
return 4;
}

return Math.max(
0,
Math.min(4, Number(stored) || 0)
);
}

function updateCredits() {
const el = $("credits");

if (el) {
el.textContent = getCredits() + " / 4";
}
}

function useCredit() {
const current = getCredits();

if (current <= 0) {
toast("Your free analysis allowance is exhausted.");
return false;
}

localStorage.setItem(
STORE.credits,
String(current - 1)
);

updateCredits();

return true;
}

/* =========================================================
RUN ANALYSIS
========================================================= */

async function runAnalysis(isAlert = false) {
if (busyAnalysis) return;

const button = $("analyzeBtn");

if (!isAlert && getCredits() <= 0) {
toast("Your free analyses are finished.");
return;
}

busyAnalysis = true;

if (!isAlert) {
setButtonLoading(button, true, "Analyzing…");
}

try {
const symbol = isAlert
? $("alertSymbol").value
: $("symbol").value;

const interval = isAlert
  ? $("alertInterval").value
  : $("interval").value;

const market = isAlert
  ? "spot"
  : $("marketType").value;

const candles = await getCandles(
  symbol,
  interval,
  market,
  500
);

const base = analyze(candles);

let mtf = {
  items: [],
  available: 0
};

if (!isAlert) {
  mtf = await getMTF(
    symbol,
    interval,
    market
  );
}

const result = applyMTF(base, mtf);

if (!isAlert) {
  if (!useCredit()) return;

  displayAnalysis(
    result,
    symbol,
    market,
    interval,
    mtf
  );

  toast("Analysis completed.");

} else {
  await processAlert(
    result,
    symbol,
    interval,
    candles
  );
}

} catch (error) {
console.error(error);

if (!isAlert) {
  const output = $("analysisResult");

  if (output) {
    output.innerHTML =
      `<div class="risk-warning">${esc(error.message)}</div>`;
  }

  toast(error.message);
}

} finally {
busyAnalysis = false;

if (!isAlert) {
  setButtonLoading(button, false);
}

}
}
/* =========================================================
BACKTESTING V3.3
========================================================= */

function calculateBacktestTrade(
candles,
index,
feeRate,
slippageRate
) {
const historical =
candles.slice(0, index);

if (historical.length < 200) {
return null;
}

let analysis;

try {
analysis = analyze(historical);
} catch {
return null;
}

if (analysis.signal === "WAIT") {
return null;
}

const entryCandle = candles[index];

const side =
analysis.signal === "BUY"
? "LONG"
: "SHORT";

const rawEntry = entryCandle.open;
if (!Number.isFinite(rawEntry) || rawEntry <= 0) return null;

const entry = side === "LONG"
  ? rawEntry * (1 + slippageRate)
  : rawEntry * (1 - slippageRate);

const stop = analysis.stop;
const target = analysis.target1;

if (
!Number.isFinite(stop) ||
!Number.isFinite(target) ||
(side === "LONG" && (stop >= entry || target <= entry)) ||
(side === "SHORT" && (stop <= entry || target >= entry))
) {
return null;
}

const rawEntryInvalid = side === "LONG"
  ? (rawEntry <= stop || rawEntry >= target)
  : (rawEntry >= stop || rawEntry <= target);
if (rawEntryInvalid) return null;

const risk = Math.abs(entry - stop);
if (risk <= 0) return null;

let exit = null;
let outcome = "OPEN";
let exitIndex = index;

const maxHold = Math.min(
candles.length - 1,
index + 50
);

for (let j = index; j <= maxHold; j++) {
const c = candles[j];

// A gap through a stop fills at the worse opening price, not at the stop.
if (j > index) {
  const stopGap = side === "LONG" ? c.open <= stop : c.open >= stop;
  const targetGap = side === "LONG" ? c.open >= target : c.open <= target;
  if (stopGap) {
    exit = c.open;
    outcome = "LOSS";
    exitIndex = j;
    break;
  }
  if (targetGap) {
    exit = c.open;
    outcome = "WIN";
    exitIndex = j;
    break;
  }
}

const stopHit =
  side === "LONG"
    ? c.low <= stop
    : c.high >= stop;

const targetHit =
  side === "LONG"
    ? c.high >= target
    : c.low <= target;

// Conservative execution:
// stop is assumed first if both levels are touched.

if (stopHit) {
  exit = stop;
  outcome = "LOSS";
  exitIndex = j;
  break;
}

if (targetHit) {
  exit = target;
  outcome = "WIN";
  exitIndex = j;
  break;
}

}

if (exit === null) {
exitIndex = maxHold;
exit = candles[exitIndex].close;
outcome = "TIME EXIT";
}

const executionExit =
side === "LONG"
? exit * (1 - slippageRate)
: exit * (1 + slippageRate);

const direction =
side === "LONG" ? 1 : -1;

const grossReturn =
direction *
(executionExit - entry) / entry;

const fees = feeRate * 2;

const netReturn = grossReturn - fees;

const rewardRisk =
risk / entry > 0
? netReturn / (risk / entry)
: 0;

return {
side,
entry,
exit: executionExit,

stop,
target,

outcome,

grossReturn,
netReturn,

rewardRisk,

exitIndex
};
}

function calculateBacktestStatistics(trades) {
  const wins = trades.filter(t => t.netReturn > 1e-12);
  const losses = trades.filter(t => t.netReturn < -1e-12);
  const breakeven = trades.length - wins.length - losses.length;
  const winRate = trades.length ? wins.length / trades.length * 100 : null;
  const grossProfit = wins.reduce((sum, t) => sum + t.netReturn, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.netReturn, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : null);
  const averageWin = wins.length ? grossProfit / wins.length : null;
  const averageLoss = losses.length ? grossLoss / losses.length : null;
  const expectancy = trades.length
    ? trades.reduce((sum, t) => sum + t.netReturn, 0) / trades.length
    : null;

  let equity = 10000;
  let peak = equity;
  let maxDrawdown = 0;
  let maximumWinningStreak = 0;
  let maximumLosingStreak = 0;
  let winningStreak = 0;
  let losingStreak = 0;

  for (const trade of trades) {
    equity *= 1 + trade.netReturn;
    peak = Math.max(peak, equity);
    const drawdown = peak > 0 ? (peak - equity) / peak * 100 : 0;
    maxDrawdown = Math.max(maxDrawdown, drawdown);

    if (trade.netReturn > 1e-12) {
      winningStreak++;
      losingStreak = 0;
    } else if (trade.netReturn < -1e-12) {
      losingStreak++;
      winningStreak = 0;
    } else {
      winningStreak = 0;
      losingStreak = 0;
    }
    maximumWinningStreak = Math.max(maximumWinningStreak, winningStreak);
    maximumLosingStreak = Math.max(maximumLosingStreak, losingStreak);
  }

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    breakeven,
    winRate,
    grossProfit,
    grossLoss,
    profitFactor,
    averageWin,
    averageLoss,
    expectancy,
    equity,
    totalReturn: (equity - 10000) / 10000 * 100,
    maxDrawdown,
    maximumWinningStreak,
    maximumLosingStreak
  };
}

async function runBacktest() {
const button = $("backtestBtn");
const output = $("backtestResult");

if (!output) return;

setButtonLoading(
button,
true,
"Testing history…"
);

output.innerHTML = `<div class="loading">Downloading historical candles and testing strategy…</div>`;

try {
const symbol = $("backtestSymbol").value;

const market = $("backtestMarket").value;

const interval = $("backtestInterval").value;

const limit = Number(
  $("backtestCandles").value
);

const candles = await getCandles(
  symbol,
  interval,
  market,
  limit
);

if (candles.length <= 200) {
  throw new Error("Only 200 completed candles are available. The first 200 are reserved for indicator warm-up; at least 201 candles are required to test an entry.");
}

const trades = [];

let index = 200;

while (index < candles.length - 1) {
  const trade = calculateBacktestTrade(
    candles,
    index,
    FEE_RATE,
    SLIPPAGE_RATE
  );

  if (trade) {
    trades.push(trade);

    index = Math.max(
      index + 1,
      trade.exitIndex + 1
    );

  } else {
    index++;
  }

  if (index % 15 === 0) {
    await sleep(0);
  }
}

const stats =
  calculateBacktestStatistics(trades);

saveJSON(STORE.backtest, {
  symbol,
  market,
  interval,

  candles: candles.length,

  ...stats,

  time: Date.now()
});

output.innerHTML = `
  <div class="result-card">

    <h3>V3.3 Backtest Results</h3>

    <p>
      ${esc(symbol)}
      · ${esc(market)}
      · ${esc(interval)}
    </p>

    <p>
      Completed historical candles:
      ${candles.length}
    </p>

    <div class="result-grid">

      <div class="result-stat">
        <span>Total trades</span>
        <strong>${stats.totalTrades}</strong>
      </div>

      <div class="result-stat">
        <span>Winning trades</span>
        <strong>${stats.wins}</strong>
      </div>
      <div class="result-stat">
        <span>Losing trades</span>
        <strong>${stats.losses}</strong>
      </div>

      <div class="result-stat">
        <span>Breakeven trades</span>
        <strong>${stats.breakeven}</strong>
      </div>

      <div class="result-stat">
        <span>Win rate</span>
        <strong>${stats.winRate === null ? "N/A" : number(stats.winRate) + "%"}</strong>
      </div>

      <div class="result-stat">
        <span>Profit factor</span>
        <strong>
          ${stats.profitFactor === null ? "N/A" : Number.isFinite(stats.profitFactor) ? number(stats.profitFactor) : ""}
        </strong>
      </div>

      <div class="result-stat">
        <span>Expectancy per trade</span>
        <strong>${stats.expectancy === null ? "N/A" : number(stats.expectancy * 100) + "%"}</strong>
      </div>

      <div class="result-stat">
        <span>Average winning return</span>
        <strong>${stats.averageWin === null ? "N/A" : number(stats.averageWin * 100) + "%"}</strong>
      </div>

      <div class="result-stat">
        <span>Average losing return</span>
        <strong>${stats.averageLoss === null ? "N/A" : number(stats.averageLoss * 100) + "%"}</strong>
      </div>

      <div class="result-stat">
        <span>Final simulated equity</span>
        <strong>${money(stats.equity)}</strong>
      </div>

      <div class="result-stat">
        <span>Net return</span>
        <strong>${number(stats.totalReturn)}%</strong>
      </div>

      <div class="result-stat">
        <span>Maximum drawdown</span>
        <strong>${number(stats.maxDrawdown)}%</strong>
      </div>

      <div class="result-stat">
        <span>Maximum winning streak</span>
        <strong>${stats.maximumWinningStreak}</strong>
      </div>

      <div class="result-stat">
        <span>Maximum losing streak</span>
        <strong>${stats.maximumLosingStreak}</strong>
      </div>

    </div>

    <h3>Execution assumptions</h3>

    <p>Entry: next candle open after signal.</p>

    <p>Fees: assumed 0.10% per side.</p>

    <p>Slippage: assumed 0.05% per side.</p>

    <p>
      If stop-loss and target are touched
      in the same candle, stop-loss is
      assumed first.
    </p>

    <div class="risk-warning">
      These are simulated historical results,
      not live performance.

      The simulation does not establish
      future profitability.
    </div>

  </div>
`;

toast("V3.3 backtest completed.");

} catch (error) {
output.innerHTML =
`<div class="risk-warning">${esc(error.message)}</div>`;

toast(error.message);

} finally {
setButtonLoading(button, false);
}
}
/* =========================================================
PAPER ACCOUNT MIGRATION V3.2 -> V3.3
========================================================= */

function defaultPaperAccount() {
return {
balance: STARTING_BALANCE,

initialBalance: STARTING_BALANCE,

positions: [],

history: [],

realized: 0,

daily: {
  date: dayKey(),
  startEquity: STARTING_BALANCE,
  locked: false
},

created: Date.now(),

version: VERSION

};
}

function migratePaperAccount() {
let account = readJSON(
STORE.paper,
null
);

if (account) {
return normalizePaperAccount(account);
}

// Read existing V3.2 account.
const old = readJSON(
STORE.oldPaper,
null
);

if (!old) {
return defaultPaperAccount();
}

/*
Preserve:
- Existing virtual balance.
- Existing positions.
- Existing trade history.
- Realized profit/loss.
- Initial account balance.

Legacy positions are not assigned invented
stop-loss or take-profit levels.

*/

account = {
...old,

positions: Array.isArray(old.positions)
  ? old.positions.map(position => {
      const stopLoss = isValidPositivePrice(position.stopLoss)
        ? Number(position.stopLoss) : null;
      const takeProfit = isValidPositivePrice(position.takeProfit)
        ? Number(position.takeProfit) : null;
      const entry = Number(position.entry) || 0;
      return {
        ...position,
        stopLoss,
        takeProfit,
        trailingEnabled: false,
        trailingDistance: null,
        highestPrice: Number(position.highestPrice) || entry,
        lowestPrice: Number(position.lowestPrice) || entry,
        legacyProtection: !stopLoss || !takeProfit
      };
    })
  : [],

history: Array.isArray(old.history)
  ? old.history
  : [],

daily: {
  date: dayKey(),
  startEquity: (Number(old.balance) || 0) +
    (Array.isArray(old.positions) ? old.positions.reduce((sum, position) => sum + (Number(position.amount) || 0), 0) : 0),
  locked: false
},

version: VERSION

};

normalizePaperAccount(account);

if (saveJSON(STORE.paper, account)) {
toast(
"V3.2 paper account migrated. Existing trades preserved."
);
}

return account;
}

function normalizePaperAccount(account) {
account = account || defaultPaperAccount();

account.balance =
Number(account.balance) || 0;

account.initialBalance =
Number(account.initialBalance) ||
STARTING_BALANCE;

account.realized =
Number(account.realized) || 0;

account.positions =
Array.isArray(account.positions)
? account.positions
: [];

account.history =
Array.isArray(account.history)
? account.history
: [];

account.positions.forEach(position => {
if (!position.id) {
position.id =
String(Date.now()) +
Math.random().toString(36).slice(2, 8);
}

position.amount =
  Number(position.amount) || 0;

position.entry =
  Number(position.entry) || 0;

position.openingFee =
  Number(position.openingFee) || 0;

position.stopLoss = isValidPositivePrice(position.stopLoss)
  ? Number(position.stopLoss) : null;
position.takeProfit = isValidPositivePrice(position.takeProfit)
  ? Number(position.takeProfit) : null;
position.legacyProtection = Boolean(position.legacyProtection) ||
  !position.stopLoss || !position.takeProfit;

position.trailingEnabled =
  Boolean(position.trailingEnabled);

position.highestPrice =
  Number(position.highestPrice) ||
  position.entry;

position.lowestPrice =
  Number(position.lowestPrice) ||
  position.entry;

});

if (!account.daily) {
account.daily = {
  date: dayKey(),
  startEquity: account.balance + account.positions.reduce(
    (sum, position) => sum + (Number(position.amount) || 0), 0
  ),
  locked: false
};
}

account.version = VERSION;

return account;
}

function getPaperAccount() {
return migratePaperAccount();
}

function savePaperAccount(account) {
account.version = VERSION;

if (saveJSON(STORE.paper, account)) {
renderPaperAccount();
return true;
}

return false;
}

/* =========================================================
RISK SETTINGS MIGRATION
========================================================= */

function getRiskSettings() {
let settings = readJSON(
STORE.risk,
null
);

if (!settings) {
settings = readJSON(
STORE.oldRisk,
null
);
}

settings = {
...DEFAULT_RISK,
...(settings || {})
};

settings.riskPercent =
Number(settings.riskPercent) || 1;

settings.dailyLossLimit =
Number(settings.dailyLossLimit) || 3;

settings.stopATR =
Number(settings.stopATR) || 1.5;

settings.targetRR =
Number(settings.targetRR) || 2;

settings.trailingATR =
Number(settings.trailingATR) || 1.5;

settings.trailingEnabled =
Boolean(settings.trailingEnabled);

saveJSON(STORE.risk, settings);

return settings;
}
/* =========================================================
PAPER ACCOUNT EQUITY
========================================================= */

function calculatePositionPnL(position, price) {
  const entry = Number(position?.entry);
  const amount = Number(position?.amount);
  const current = Number(price);

  if (
    !Number.isFinite(entry) || entry <= 0 ||
    !Number.isFinite(amount) || amount < 0 ||
    !Number.isFinite(current) || current <= 0
  ) return null;

  const direction = position.side === "LONG" ? 1 : -1;

  return direction * (current - entry) / entry * amount;
}

function getPositionPrice(position) {
  const symbol = position?.symbol;
  const price = Number(lastMarketPrices[symbol]);
  const timestamp = Number(lastMarketPriceTimes[symbol]);

  if (!Number.isFinite(price) || price <= 0 || !timestamp) {
    return null;
  }

  if (Date.now() - timestamp > MAX_PRICE_AGE_MS) {
    return null;
  }

  return price;
}

function calculatePaperEquity(account) {
  let equity = Number(account.balance);

  if (!Number.isFinite(equity)) return null;

  for (const position of account.positions || []) {
    const marketPrice = getPositionPrice(position);

    if (marketPrice === null) return null;

    const executionExit = position.side === "LONG"
      ? marketPrice * (1 - SLIPPAGE_RATE)
      : marketPrice * (1 + SLIPPAGE_RATE);

    const gross = calculatePositionPnL(
      position,
      executionExit
    );

    if (!Number.isFinite(gross)) return null;

    const quantity = Number(position.quantity) > 0
      ? Number(position.quantity)
      : Number(position.amount) / Number(position.entry);

    const estimatedClosingFee =
      quantity * executionExit * FEE_RATE;

    equity +=
      Number(position.amount) +
      gross -
      estimatedClosingFee;
  }

  return equity;
}

function ensureDailyBaseline(account) {
  const today = dayKey();

  if (!account.daily || account.daily.date !== today) {
    const equity = calculatePaperEquity(account);

    // Do not reset the daily baseline using stale/missing prices.
    if (equity === null) return false;

    account.daily = {
      date: today,
      startEquity: equity,
      locked: false
    };

    saveJSON(STORE.paper, account);
  }

  return true;
}

function getDailyEquityLoss(account) {
  if (!ensureDailyBaseline(account)) return null;

  const equity = calculatePaperEquity(account);

  if (equity === null) return null;

  const starting = Number(account.daily.startEquity);

  if (!Number.isFinite(starting) || starting <= 0) {
    return null;
  }

  return Math.max(0, starting - equity);
}

function getDailyLossLimitAmount(account) {
  const settings = getRiskSettings();

  const baseline =
    Number(account.daily?.startEquity) ||
    Number(account.initialBalance);

  return Number.isFinite(baseline) && baseline > 0
    ? baseline * settings.dailyLossLimit / 100
    : null;
}

function isDailyLossLocked(account) {
  if (account.daily?.locked) return true;

  const limit = getDailyLossLimitAmount(account);
  const loss = getDailyEquityLoss(account);

  // Fail closed for new entries if the equity cannot be valued.
  if (limit === null || loss === null) {
    return account.positions.length > 0;
  }

  return loss >= limit;
}

/* =========================================================
PAPER ACCOUNT PRICE
========================================================= */

async function currentPrice(symbol) {
  const data = await request(
    API.spot + "/ticker/price?symbol=" +
    encodeURIComponent(symbol)
  );

  const price = Number(data.price);

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(
      "Invalid market price for " + symbol + "."
    );
  }

  lastMarketPrices[symbol] = price;
  lastMarketPriceTimes[symbol] = Date.now();

  return price;
}
/* =========================================================
PAPER ACCOUNT DISPLAY
========================================================= */

function renderPaperAccount() {
const account = getPaperAccount();

ensureDailyBaseline(account);

const equity =
calculatePaperEquity(account);

let unrealized = 0;

account.positions.forEach(position => {
const price = getPositionPrice(position);
if (price !== null) unrealized += calculatePositionPnL(position, price);
});

if ($("paperBalance")) {
$("paperBalance").textContent =
money(account.balance);
}

if ($("paperOpenCount")) {
$("paperOpenCount").textContent =
account.positions.length;
}

if ($("paperClosedCount")) {
$("paperClosedCount").textContent =
account.history.length;
}

if ($("paperPnL")) {
$("paperPnL").textContent =
money(account.realized);
}

const positions = $("paperPositions");

if (positions) {
positions.innerHTML =
account.positions.length
? `
<table>

<thead>
          <tr>
            <th>Asset</th>
            <th>Side</th>
            <th>Entry</th>
            <th>Current</th>
            <th>Stop</th>
            <th>Target</th>
            <th>P/L</th>
            <th>Action</th>
          </tr>
        </thead>
  
        <tbody>
  
          ${account.positions.map(position => {
            const price =
              getPositionPrice(position);
  
            const pnl = price === null
              ? null
              : calculatePositionPnL(position, price);
  
            return `
              <tr>
  
                <td>${esc(position.symbol)}</td>
  
                <td>${esc(position.side)}</td>
  
                <td>${money(position.entry)}</td>
  
                <td>${price === null ? "Unavailable" : money(price)}</td>
  
                <td>
                  ${position.stopLoss
                    ? money(position.stopLoss)
                    : "Not set"}
                </td>
  
                <td>
                  ${position.takeProfit
                    ? money(position.takeProfit)
                    : "Not set"}
                </td>
  
                <td class="${pnl === null ? "muted-note" : pnl >= 0 ? "positive" : "negative"}">
                  ${pnl === null ? "N/A — price unavailable" : money(pnl)}
                </td>
  
                <td>
                  <button
                    class="outline"
                    data-close-paper="${esc(position.id)}">
                    Close
                  </button>
                </td>
  
              </tr>
            `;
          }).join("")}
  
        </tbody>
  
      </table>
    `
    : '<p class="muted-note">No open simulated positions.</p>';

}

const history = $("paperHistory");

if (history) {
history.innerHTML =
account.history.length
? `
<table>

<thead>
          <tr>
            <th>Asset</th>
            <th>Side</th>
            <th>Entry</th>
            <th>Exit</th>
            <th>Profit/Loss</th>
            <th>Closed</th>
          </tr>
        </thead>
  
        <tbody>
  
          ${account.history
            .slice()
            .reverse()
            .slice(0, 100)
            .map(trade => `
              <tr>
  
                <td>${esc(trade.symbol)}</td>
  
                <td>${esc(trade.side)}</td>
  
                <td>${money(trade.entry)}</td>
  
                <td>${money(trade.exit)}</td>
  
                <td class="${trade.pnl >= 0 ? "positive" : "negative"}">
                  ${money(trade.pnl)}
                </td>
  
                <td>
                  ${esc(new Date(
                    trade.closedAt
                  ).toLocaleString())}
                </td>
  
              </tr>
            `).join("")}
  
        </tbody>
  
      </table>
    `
    : '<p class="muted-note">No simulated trades yet.</p>';

}

updateRiskDisplay();
}
/* =========================================================
AUTOMATIC PAPER TRADE EXECUTION
========================================================= */

async function createPaperTradePlan(
symbol,
side,
entry,
settings
) {
let volatility = null;

// Prefer the latest matching analysis.
if (
lastAnalysis &&
lastAnalysis.symbol === symbol &&
lastAnalysis.result.atr > 0
) {
volatility =
lastAnalysis.result.atr;
}

// Otherwise obtain fresh ATR data.
if (!volatility) {
const candles = await getCandles(
symbol,
"15m",
"spot",
250
);

volatility = atr(candles);

}

if (!Number.isFinite(volatility) || volatility <= 0) {
throw new Error(
"Unable to calculate a reliable stop distance."
);
}

const stopDistance =
volatility * settings.stopATR;

let stopLoss;
let takeProfit;

if (side === "LONG") {
stopLoss = entry - stopDistance;

takeProfit =
  entry + stopDistance * settings.targetRR;

} else {
stopLoss = entry + stopDistance;

takeProfit =
  entry - stopDistance * settings.targetRR;

}

if (
stopLoss <= 0 ||
takeProfit <= 0 ||
!Number.isFinite(stopLoss) ||
!Number.isFinite(takeProfit)
) {
throw new Error("Invalid protective levels.");
}

return {
stopLoss,
takeProfit,
stopDistance,
atr: volatility
};
}

/* =========================================================
RISK-BASED POSITION SIZING
========================================================= */

function calculatePositionSize(
equity,
availableBalance,
entry,
stopDistance,
settings,
manualCap
) {
if (
equity <= 0 ||
availableBalance <= 0 ||
entry <= 0 ||
stopDistance <= 0
) {
throw new Error("Invalid position sizing inputs.");
}

const riskBudget = equity === null
  ? null
  : equity * settings.riskPercent / 100;

const stopFraction =
stopDistance / entry;

if (
!Number.isFinite(stopFraction) ||
stopFraction <= 0
) {
throw new Error("Invalid stop distance.");
}

// Include estimated stop-exit slippage and both trading fees in the risk budget.
const estimatedRiskFraction = stopFraction + SLIPPAGE_RATE + (2 * FEE_RATE);
const calculatedNotional = riskBudget / estimatedRiskFraction;

// Reserve enough virtual balance for opening fees.
const availableNotional =
availableBalance / (1 + FEE_RATE);

let amount = Math.min(
calculatedNotional,
availableNotional
);

// Optional existing amount field acts as a maximum cap.
if (
Number.isFinite(manualCap) &&
manualCap > 0
) {
amount = Math.min(amount, manualCap);
}

if (amount < 10) {
throw new Error(
"Calculated position is too small. Check available virtual balance."
);
}

return {
amount,

riskBudget,

actualRisk:
  amount * estimatedRiskFraction,

quantity:
  amount / entry

};
}
/* =========================================================
OPEN PAPER TRADE
========================================================= */

async function openPaperTrade() {
const symbol =
$("paperSymbol").value;

const side =
$("paperSide").value;

if (!["LONG", "SHORT"].includes(side)) {
toast("Select a valid simulated trading direction.");
return;
}

const account = getPaperAccount();

const settings = getRiskSettings();

ensureDailyBaseline(account);

if (isDailyLossLocked(account)) {
  toast(account.positions.some(p => getPositionPrice(p) === null)
    ? "Fresh prices are unavailable for existing positions. New paper trades are blocked until data reconnects."
    : "Daily equity-loss protection is active. New positions are blocked.");
  return;
}

try {
const marketPrice = await currentPrice(symbol);

const price = side === "LONG"
  ? marketPrice * (1 + SLIPPAGE_RATE)
  : marketPrice * (1 - SLIPPAGE_RATE);

const plan = await createPaperTradePlan(
  symbol,
  side,
  price,
  settings
);

const equity = calculatePaperEquity(account);

if (equity === null) {
  throw new Error("Fresh prices are required for every open position before another paper trade can be opened.");
}

const manualCap =
  Number($("paperAmount")?.value);

const sizing = calculatePositionSize(
  equity,
  account.balance,
  price,
  plan.stopDistance,
  settings,
  manualCap
);

const amount = sizing.amount;

const openingFee =
  amount * FEE_RATE;

const position = {
  id:
    String(Date.now()) +
    Math.random().toString(36).slice(2, 8),

  symbol,
  side,

  amount,

  quantity: sizing.quantity,

  entry: price,

  stopLoss: plan.stopLoss,

  takeProfit: plan.takeProfit,

  trailingEnabled:
    settings.trailingEnabled,

  trailingDistance:
    plan.atr * settings.trailingATR,

  highestPrice: price,

  lowestPrice: price,

  openingFee,

  riskBudget: sizing.riskBudget,

  actualRisk: sizing.actualRisk,

  openedAt: Date.now(),

  legacyProtection: false,

  protectionStatus: "ACTIVE"
};

const required =
  amount + openingFee;

if (required > account.balance) {
  throw new Error(
    "Insufficient virtual balance after estimated fees."
  );
}

account.balance -= required;

account.positions.push(position);

if (!savePaperAccount(account)) {
  throw new Error(
    "Unable to save the new paper position."
  );
}

const status = $("paperStatus");

if (status) {
  status.textContent =
    "PAPER " + side +
    " opened for " + symbol +
    " at " + money(price) +
    ". Position: " + money(amount) +
    ". Risk budget: " + money(sizing.riskBudget) +
    ". Stop: " + money(plan.stopLoss) +
    ". Target: " + money(plan.takeProfit) +
    ".";
}

toast(
  "Paper position opened with automatic protection."
);

} catch (error) {
console.error(error);
toast(error.message);
}
}
/* =========================================================
CLOSE PAPER TRADE
========================================================= */

async function closePaperTradeAtPrice(
id,
exit,
reason = "MANUAL"
) {
const account = getPaperAccount();

const index =
account.positions.findIndex(
position => position.id === id
);

if (index < 0) return false;

const position =
account.positions[index];

if (
!Number.isFinite(exit) ||
exit <= 0
) {
return false;
}

const marketExit = exit;
const executionExit = position.side === "LONG"
  ? marketExit * (1 - SLIPPAGE_RATE)
  : marketExit * (1 + SLIPPAGE_RATE);
const direction = position.side === "LONG" ? 1 : -1;

const gross = direction *
  (executionExit - position.entry) / position.entry * position.amount;

const closingFee = (Number(position.quantity) > 0
  ? Number(position.quantity) * executionExit
  : position.amount) * FEE_RATE;

const pnl =
gross -
position.openingFee -
closingFee;

account.balance +=
position.amount +
gross -
closingFee;

account.realized += pnl;

account.history.push({
...position,

exit: executionExit,
marketExit,

pnl,

gross,

closingFee,

closeReason: reason,

closedAt: Date.now()

});

account.positions.splice(index, 1);

return savePaperAccount(account);
}

async function closePaperTrade(id) {
const account = getPaperAccount();

const position =
account.positions.find(
item => item.id === id
);

if (!position) return;

try {
const exit =
await currentPrice(position.symbol);

const saved = await closePaperTradeAtPrice(
  id,
  exit,
  "MANUAL"
);

if (saved) {
  toast("Paper position closed.");
}

} catch (error) {
toast(error.message);
}
}
/* =========================================================
AUTOMATIC TRAILING STOP
========================================================= */

function updateTrailingStop(position, price) {
if (!position.trailingEnabled) return false;

const distance =
Number(position.trailingDistance);

if (!Number.isFinite(distance) || distance <= 0) {
return false;
}

let changed = false;

if (position.side === "LONG") {
position.highestPrice = Math.max(
Number(position.highestPrice) || position.entry,
price
);

// Activate only after a favorable move.
if (position.highestPrice > position.entry) {
  const newStop =
    position.highestPrice - distance;

  if (
    !position.stopLoss ||
    newStop > position.stopLoss
  ) {
    position.stopLoss = newStop;
    changed = true;
  }
}

} else {
position.lowestPrice = Math.min(
Number(position.lowestPrice) || position.entry,
price
);

if (position.lowestPrice < position.entry) {
  const newStop =
    position.lowestPrice + distance;

  if (
    !position.stopLoss ||
    newStop < position.stopLoss
  ) {
    position.stopLoss = newStop;
    changed = true;
  }
}

}

return changed;
}

/* =========================================================
DAILY LOSS PROTECTION
========================================================= */

async function enforceDailyLossProtection() {
  const account = getPaperAccount();
  try {
    for (const position of account.positions) {
      await currentPrice(position.symbol);
    }
  } catch (error) {
    console.warn("Daily loss protection paused: fresh prices unavailable.", error);
    return false;
  }

  const loss = getDailyEquityLoss(account);
  const limit = getDailyLossLimitAmount(account);
  if (loss === null || limit === null) return false;
  if (!account.daily?.locked && loss < limit) return false;
  if (account.daily?.locked && account.positions.length === 0) return true;

  account.daily.locked = true;
  saveJSON(STORE.paper, account);

  for (const position of [...account.positions]) {
    try {
      const freshPrice = await currentPrice(position.symbol);
      await closePaperTradeAtPrice(position.id, freshPrice, "DAILY_LOSS_PROTECTION");
    } catch (error) {
      console.error("Daily protection close failed:", error);
    }
  }

  const latest = getPaperAccount();
  latest.daily.locked = true;
  saveJSON(STORE.paper, latest);
  renderPaperAccount();
  toast("Daily equity-loss limit reached. Paper trading locked for today.");
  return true;
}

/* =========================================================
AUTOMATIC PAPER POSITION MONITOR
========================================================= */

async function managePaperPositions() {
if (managingPaper) return;

managingPaper = true;

try {
let account = getPaperAccount();

if (!account.positions.length) {
  updateRiskDisplay();
  return;
}

ensureDailyBaseline(account);

let changed = false;

for (const position of [...account.positions]) {
  try {
    const price =
      await currentPrice(position.symbol);

    if (position.legacyProtection || !position.stopLoss || !position.takeProfit) {
      continue;
    }

    const updated = updateTrailingStop(position, price);

    if (updated) {
      changed = true;
    }

    const stopHit =
      position.stopLoss &&
      (
        position.side === "LONG"
          ? price <= position.stopLoss
          : price >= position.stopLoss
      );

    const targetHit =
      position.takeProfit &&
      (
        position.side === "LONG"
          ? price >= position.takeProfit
          : price <= position.takeProfit
      );

    if (stopHit || targetHit) {
      const reason = stopHit
        ? position.trailingEnabled
          ? "STOP_LOSS_OR_TRAILING_STOP"
          : "STOP_LOSS"
        : "TAKE_PROFIT";

      await closePaperTradeAtPrice(
        position.id,
        price,
        reason
      );

      toast(
        position.symbol +
        " paper position automatically closed: " +
        reason
      );
    }

  } catch (error) {
    console.error(
      "Paper position monitoring:",
      error
    );
  }
}

account = getPaperAccount();

if (changed) {
  saveJSON(STORE.paper, account);
}

// Calculate daily loss using actual account equity,
// including unrealized losses.
const locked =
  await enforceDailyLossProtection();

if (!locked) {
  renderPaperAccount();
}

} finally {
managingPaper = false;
}
}
/* =========================================================
RESET PAPER ACCOUNT
========================================================= */

function resetPaperAccount() {
if (!confirm(
"Reset the simulated account and delete its trade history?"
)) {
return;
}

saveJSON(
STORE.paper,
defaultPaperAccount()
);

renderPaperAccount();

toast("Paper account reset.");
}

/* =========================================================
RISK MANAGEMENT DISPLAY
========================================================= */

function updateRiskDisplay() {
const account = getPaperAccount();

const settings = getRiskSettings();

ensureDailyBaseline(account);

const equity =
calculatePaperEquity(account);

const dailyLimit =
getDailyLossLimitAmount(account);

const dailyLoss =
getDailyEquityLoss(account);

const riskBudget = equity === null
  ? null
  : equity * settings.riskPercent / 100;

const remaining = dailyLimit === null || dailyLoss === null
  ? null
  : Math.max(0, dailyLimit - dailyLoss);

const output = $("riskResult");

if (!output) return;

output.innerHTML = `
<div class="result-card">

<h3>V3.3 Risk Management</h3>      
  
  <p>      
    <b>SIMULATED PAPER TRADING ONLY</b>      
  </p>
  <p class="muted-note">Risk budget is a target maximum loss at the stop. Actual risk may be lower when position size is capped by available balance or the manual amount field.</p>
  <p class="muted-note">The risk-balance setting is informational; it does not change funds in the active paper account.</p>      
  
  <div class="result-grid">      
  
    <div class="result-stat">      
      <span>Account equity</span>      
      <strong>${equity === null ? "N/A — fresh prices required" : money(equity)}</strong>      
    </div>      
  
    <div class="result-stat">      
      <span>Available balance</span>      
      <strong>${money(account.balance)}</strong>      
    </div>      
  
    <div class="result-stat">      
      <span>Unrealized P/L</span>      
      <strong>${account.positions.some(p => getPositionPrice(p) === null)
        ? "N/A — fresh prices required"
        : money(account.positions.reduce((sum, p) => sum + calculatePositionPnL(p, getPositionPrice(p)), 0))}</strong>      
    </div>      
  
    <div class="result-stat">      
      <span>Risk budget per trade</span>      
      <strong>${money(riskBudget)}</strong>      
    </div>      
  
    <div class="result-stat">      
      <span>Daily loss limit</span>      
      <strong>${money(dailyLimit)}</strong>      
    </div>      
  
    <div class="result-stat">      
      <span>Daily equity loss</span>      
      <strong>${money(dailyLoss)}</strong>      
    </div>      
  
    <div class="result-stat">      
      <span>Remaining daily allowance</span>      
      <strong>${money(remaining)}</strong>      
    </div>      
  
  </div>      
  
  <h3>Automatic protection settings</h3>      
  
  <div class="metric">      
  
    <label>      
      <input      
        type="checkbox"      
        id="paperTrailingEnabled"      
        ${settings.trailingEnabled ? "checked" : ""}      
      >      
  
      Enable trailing stop      
    </label>      
  
  </div>      
  
  <div class="metric">      
  
    <label>      
      Trailing stop ATR multiplier      
  
      <input      
        type="number"      
        id="paperTrailingATR"      
        min="0.5"      
        max="5"      
        step="0.5"      
        value="${settings.trailingATR}"      
      >      
    </label>      
  
  </div>      
  
  <div class="metric">      
  
    <label>      
      Stop-loss ATR multiplier      
  
      <input      
        type="number"      
        id="paperStopATR"      
        min="0.5"      
        max="5"      
        step="0.5"      
        value="${settings.stopATR}"      
      >      
    </label>      
  
  </div>      
  
  <div class="metric">      
  
    <label>      
      Take-profit reward/risk ratio      
  
      <input      
        type="number"      
        id="paperTargetRR"      
        min="1"      
        max="5"      
        step="0.5"      
        value="${settings.targetRR}"      
      >      
    </label>      
  
  </div>      
  
  <button      
    type="button"      
    id="savePaperProtectionBtn"      
    class="outline">      
    Save protection settings      
  </button>      
  
  <p class="${      
    isDailyLossLocked(account)      
      ? "risk-warning"      
      : "risk-safe"      
  }">      
  
    ${
      account.positions.some(p => getPositionPrice(p) === null)
        ? "FRESH PRICE DATA UNAVAILABLE — New positions blocked; automatic protection is paused until prices reconnect."
        : isDailyLossLocked(account)
          ? "DAILY LOSS PROTECTION ACTIVE — New positions blocked."
          : "Daily equity-loss protection is active."
    }      
  
  </p>      
  
  <small>      
    Daily loss is calculated from account equity,      
    including unrealized profit and loss.      
  </small>      
  
</div>

`;

$("savePaperProtectionBtn")
?.addEventListener(
"click",
savePaperProtectionSettings
);
}

function savePaperProtectionSettings() {
const settings = getRiskSettings();

const trailingEnabled =
$("paperTrailingEnabled")?.checked || false;

const trailingATR =
Number($("paperTrailingATR")?.value);

const stopATR =
Number($("paperStopATR")?.value);

const targetRR =
Number($("paperTargetRR")?.value);

if (
!Number.isFinite(trailingATR) ||
trailingATR < 0.5 ||
trailingATR > 5
) {
toast("Invalid trailing stop multiplier.");
return;
}

if (
!Number.isFinite(stopATR) ||
stopATR < 0.5 ||
stopATR > 5
) {
toast("Invalid stop-loss multiplier.");
return;
}

if (
!Number.isFinite(targetRR) ||
targetRR < 1 ||
targetRR > 5
) {
toast("Invalid reward/risk ratio.");
return;
}

settings.trailingEnabled = trailingEnabled;

settings.trailingATR = trailingATR;

settings.stopATR = stopATR;

settings.targetRR = targetRR;

saveJSON(STORE.risk, settings);

updateRiskDisplay();

toast("Paper protection settings saved.");
}

/* =========================================================
RISK SETTINGS
========================================================= */

function saveRiskSettings() {
const balance =
Number($("riskBalance").value);

const riskPercent =
Number($("riskPercent").value);

const dailyLossLimit =
Number($("dailyLossLimit").value);

if (
!Number.isFinite(balance) ||
balance < 100
) {
toast("Enter a valid virtual account balance.");
return;
}

if (![0.5, 1, 2].includes(riskPercent)) {
toast("Invalid risk percentage.");
return;
}

if (![2, 3, 5].includes(dailyLossLimit)) {
toast("Invalid daily loss limit.");
return;
}

const settings = getRiskSettings();

settings.balance = balance;

settings.riskPercent = riskPercent;

settings.dailyLossLimit = dailyLossLimit;

saveJSON(STORE.risk, settings);

updateRiskDisplay();

toast("Risk settings saved.");
}
/* =========================================================
ALERT SYSTEM
========================================================= */

function playAlertSound() {
try {
const AudioContext =
window.AudioContext ||
window.webkitAudioContext;

if (!AudioContext) return;

const context = new AudioContext();

const oscillator =
  context.createOscillator();

const gain =
  context.createGain();

oscillator.frequency.value = 800;

gain.gain.value = 0.08;

oscillator.connect(gain);

gain.connect(context.destination);

oscillator.start();

setTimeout(() => {
  oscillator.stop();
  context.close();
}, 350);

} catch (error) {
console.warn(
"Alert sound unavailable.",
error
);
}
}

async function enableNotifications() {
if (!("Notification" in window)) {
toast(
"Browser notifications are not supported."
);
return;
}

const permission =
await Notification.requestPermission();

toast(
permission === "granted"
? "Notifications enabled."
: "Notification permission was not granted."
);
}

function saveAlert(message) {
const log = readJSON(
STORE.alerts,
[]
);

log.push({
message,
time: Date.now()
});

saveJSON(
STORE.alerts,
log.slice(-50)
);

renderAlertLog();
}

function renderAlertLog() {
const container = $("alertLog");

if (!container) return;

const log = readJSON(
STORE.alerts,
[]
);

if (!log.length) {
container.innerHTML =
'<p class="muted-note">No alerts yet.</p>';

return;

}

container.innerHTML =
log.slice().reverse().map(item => `
<div class="alert-item">

${esc(item.message)}      
  
    <br>      
  
    <small>      
      ${esc(new Date(item.time).toLocaleString())}      
    </small>      
  
  </div>      
`).join("");

}

async function processAlert(
result,
symbol,
interval
) {
if (result.signal === "WAIT") return;

const key =
symbol + "_" + interval;

const states = readJSON(
STORE.alertState,
{}
);

const last = states[key];

const identity =
result.signal + "_" + result.candleTime;

if (last === identity) return;

states[key] = identity;

saveJSON(
STORE.alertState,
states
);

const message =
symbol +
" " +
result.signal +
" signal on " +
interval +
". Price: " +
money(result.price);

saveAlert(message);

playAlertSound();

if (
"Notification" in window &&
Notification.permission === "granted"
) {
new Notification(
"AGU Crypto Analyzer",
{ body: message }
);
}

if (navigator.vibrate) {
navigator.vibrate([150, 80, 150]);
}
}

function toggleMonitoring() {
const button = $("monitorBtn");

if (monitoring) {
clearInterval(monitorTimer);

monitorTimer = null;

monitoring = false;

if (button) {
  button.textContent = "Start monitoring";
}

if ($("alertStatus")) {
  $("alertStatus").textContent =
    "Monitoring is off.";
}

return;

}

monitoring = true;

if (button) {
button.textContent = "Stop monitoring";
}

if ($("alertStatus")) {
$("alertStatus").textContent =
"Monitoring is active while this page remains open.";
}

runAnalysis(true);

monitorTimer = setInterval(() => {
if (
document.visibilityState === "visible"
) {
runAnalysis(true);
}
}, 60000);

toast("Smart monitoring started.");
}

/* =========================================================
SECURITY STATUS
========================================================= */

function renderSecurityStatus() {
const el = $("securityStatus");

if (!el) return;

el.innerHTML = `
<div class="risk-warning">

<b>AGU CRYPTO ANALYZER V3.3 SECURITY STATUS</b>      
  
  <p>      
    Market data is retrieved from public Binance endpoints.      
  </p>      
  
  <p>      
    No exchange API secret is stored by this application.      
  </p>      
  
  <p>      
    No real orders can be executed.      
  </p>      
  
  <p>      
    No real money is deposited, withdrawn or transferred.      
  </p>      
  
  <p>      
    Paper trading is simulated inside browser storage.      
  </p>      
  
  <p>      
    Automatic stop-loss and take-profit are      
    browser-side simulations.      
  </p>      
  
  <p>      
    Automatic paper monitoring requires the      
    application to remain open and connected.      
  </p>      
  
  <p>      
    LocalStorage is not secure account storage.      
  </p>      
  
  <p>      
    Authenticated backend, server-side permissions,      
    encrypted credentials, audit logs and      
    independent execution infrastructure      
    are not installed.      
  </p>      
  
  <b>      
    REAL EXCHANGE TRADING: DISABLED      
  </b>      
  
</div>

`;
}

/* =========================================================
INITIALIZATION
========================================================= */

function initialize() {
applyTheme();

updateCredits();

renderAlertLog();

// Automatically migrate V3.2 paper account.
migratePaperAccount();

getRiskSettings();

renderPaperAccount();

renderSecurityStatus();

loadMarkets();

if ($("year")) {
$("year").textContent =
new Date().getFullYear();
}

$("themeBtn")
?.addEventListener(
"click",
toggleTheme
);

$("refreshBtn")
?.addEventListener(
"click",
loadMarkets
);

$("analyzeBtn")
?.addEventListener(
"click",
() => runAnalysis(false)
);

$("notifyBtn")
?.addEventListener(
"click",
enableNotifications
);

$("monitorBtn")
?.addEventListener(
"click",
toggleMonitoring
);

$("backtestBtn")
?.addEventListener(
"click",
runBacktest
);

$("paperOpenBtn")
?.addEventListener(
"click",
openPaperTrade
);

$("paperResetBtn")
?.addEventListener(
"click",
resetPaperAccount
);

$("saveRiskBtn")
?.addEventListener(
"click",
saveRiskSettings
);

$("paperPositions")
?.addEventListener(
"click",
event => {
const button =
event.target.closest(
"[data-close-paper]"
);

if (button) {
      closePaperTrade(
        button.dataset.closePaper
      );
    }
  }
);

// Refresh market data every minute.
setInterval(
loadMarkets,
60000
);

// Independently monitor simulated positions.
setInterval(
managePaperPositions,
15000
);

// Refresh account display.
setInterval(
renderPaperAccount,
30000
);

if ("serviceWorker" in navigator) {
navigator.serviceWorker.register("./sw.js")
.catch(error =>
console.warn("Service worker:", error)
);
}

console.log(
"AGU CRYPTO ANALYZER V" +
VERSION +
" initialized."
);
}

document.addEventListener(
"DOMContentLoaded",
initialize
);
