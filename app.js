"use strict";

/* =========================================================
   AGU CRYPTO ANALYZER V3.2
   Owner: Umar Mohammed
   Market data: Binance public market endpoints

   SECURITY:
   - No exchange API secrets.
   - No real order execution.
   - No payment processing.
   - Paper trading is browser-side simulation.
========================================================= */

const VERSION = "3.2";

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
  paper: "agu_paper_account_v32",
  risk: "agu_paper_risk_v32"
};

const STARTING_BALANCE = 10000;
const FEE_RATE = 0.001;
const SLIPPAGE_RATE = 0.0005;

let monitoring = false;
let monitorTimer = null;
let lastAnalysis = null;
let lastMarketPrices = {};
let busyAnalysis = false;

/* =========================================================
   UTILITIES
========================================================= */

function money(value) {
  if (!Number.isFinite(Number(value))) return "N/A";

  return "$" + Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  });
}

function number(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return "N/A";

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
    "'": "&#039;"
  })[char]);
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
    toast("Browser storage is unavailable or full.");
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
    button.dataset.originalText = button.textContent;
    button.textContent = text || "Please wait…";
  } else if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
  }
}

function utcTime(time) {
  return new Date(time).toLocaleString();
}

function apiURL(market) {
  return API[market === "futures" ? "futures" : "spot"];
}

async function request(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("Market server returned HTTP " + response.status);
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
  const theme = localStorage.getItem(STORE.theme) || "dark";

  document.body.dataset.theme = theme;

  const button = $("themeBtn");

  if (button) {
    button.textContent =
      theme === "dark" ? "☀ White Mode" : "🌙 Dark Mode";
  }

  const meta = document.querySelector('meta[name="theme-color"]');

  if (meta) {
    meta.content = theme === "dark" ? "#071a2e" : "#f3f7fc";
  }
}

function toggleTheme() {
  const current = localStorage.getItem(STORE.theme) || "dark";
  const next = current === "dark" ? "light" : "dark";

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
        ASSETS.indexOf(a.symbol) - ASSETS.indexOf(b.symbol)
      );

    if (!selected.length) {
      throw new Error("Market prices unavailable.");
    }

    selected.forEach(item => {
      lastMarketPrices[item.symbol] = Number(item.lastPrice);
    });

    saveJSON(STORE.market, selected);
    localStorage.setItem(STORE.marketTime, String(Date.now()));

    renderMarkets(selected);

    const connection = $("connection");

    if (connection) {
      connection.textContent = "Live market data";
      connection.className = "pill green";
    }

  } catch (error) {
    const cached = readJSON(STORE.market, []);

    if (cached.length) {
      renderMarkets(cached, true);

      const connection = $("connection");

      if (connection) {
        connection.textContent = "Cached snapshot";
        connection.className = "pill muted";
      }
    } else if (grid) {
      grid.innerHTML =
        '<div class="loading">Unable to retrieve market data. Check your internet connection.</div>';
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
        <span class="coin">${esc(item.symbol)}</span>
        <span class="price">${money(item.lastPrice)}</span>
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
    const start = Math.floor(c.time / 600000) * 600000;

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
        high: Math.max(...group.map(c => c.high)),
        low: Math.min(...group.map(c => c.low)),
        close: group[group.length - 1].close,
        volume: group.reduce((sum, c) => sum + c.volume, 0),
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

  if (!config) throw new Error("Unsupported timeframe.");

  const sourceInterval = config.source || interval;
  const sourceLimit = interval === "10m"
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

  candles = candles.filter(c => c.closeTime < now);

  candles = candles.slice(-limit);

  const minimum = interval === "1w" ? 200 : 220;

  if (candles.length < minimum) {
    throw new Error(
      "Not enough completed candles. Received " +
      candles.length + "; need at least " + minimum + "."
    );
  }

  const last = candles[candles.length - 1];

  if (now - last.closeTime > config.ms * 2.2) {
    throw new Error("Market candles appear stale.");
  }

  return candles;
}

/* =========================================================
   INDICATORS
========================================================= */

function emaSeries(values, period) {
  const result = Array(values.length).fill(null);

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
      (values[i] - previous) * multiplier + previous;

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

  return part.reduce((a, b) => a + b, 0) / period;
}

function rsi(values, period = 14) {
  if (values.length <= period) return null;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];

    if (diff > 0) gain += diff;
    else loss -= diff;
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];

    avgGain =
      (avgGain * (period - 1) + Math.max(diff, 0)) / period;

    avgLoss =
      (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }

  if (avgLoss === 0) return 100;

  return 100 - (100 / (1 + avgGain / avgLoss));
}

function macd(values) {
  const fast = emaSeries(values, 12);
  const slow = emaSeries(values, 26);

  const line = values.map((_, i) => {
    if (fast[i] === null || slow[i] === null) return null;
    return fast[i] - slow[i];
  });

  const valid = line.filter(v => v !== null);

  const signalValid = emaSeries(valid, 9);
  const signal = signalValid[signalValid.length - 1];
  const currentLine = line[line.length - 1];

  if (signal === null || currentLine === null) {
    return { line: null, signal: null, histogram: null };
  }

  return {
    line: currentLine,
    signal,
    histogram: currentLine - signal
  };
}

function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;

  const ranges = [];

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const previous = candles[i - 1].close;

    ranges.push(Math.max(
      c.high - c.low,
      Math.abs(c.high - previous),
      Math.abs(c.low - previous)
    ));
  }

  return sma(ranges, period);
}

function adx(candles, period = 14) {
  if (candles.length < period * 2 + 1) return null;

  const tr = [];
  const plus = [];
  const minus = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    const up = current.high - previous.high;
    const down = previous.low - current.low;

    plus.push(up > down && up > 0 ? up : 0);
    minus.push(down > up && down > 0 ? down : 0);

    tr.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    ));
  }

  const dx = [];

  for (let i = period - 1; i < tr.length; i++) {
    const start = i - period + 1;

    const trSum = tr.slice(start, i + 1).reduce((a, b) => a + b, 0);
    const plusSum = plus.slice(start, i + 1).reduce((a, b) => a + b, 0);
    const minusSum = minus.slice(start, i + 1).reduce((a, b) => a + b, 0);

    if (!trSum) continue;

    const pdi = 100 * plusSum / trSum;
    const mdi = 100 * minusSum / trSum;

    const total = pdi + mdi;

    dx.push(total ? 100 * Math.abs(pdi - mdi) / total : 0);
  }

  return sma(dx, period);
}

function bollinger(values, period = 20) {
  if (values.length < period) return null;

  const part = values.slice(-period);
  const middle = sma(values, period);

  const variance = part.reduce(
    (sum, value) => sum + Math.pow(value - middle, 2), 0
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

function findLevels(candles, price, volatility) {
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

  const fallbackHigh = Math.max(...data.map(c => c.high));
  const fallbackLow = Math.min(...data.map(c => c.low));

  return {
    support: support[0] || fallbackLow,
    resistance: resistance[0] || fallbackHigh
  };
}

function fibonacci(candles) {
  const data = candles.slice(-100);

  const high = Math.max(...data.map(c => c.high));
  const low = Math.min(...data.map(c => c.low));
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
  if (candles.length < 2) return "None detected";

  const current = candles[candles.length - 1];
  const previous = candles[candles.length - 2];

  const body = Math.abs(current.close - current.open);
  const range = current.high - current.low;

  if (!range) return "None detected";

  const lowerWick =
    Math.min(current.open, current.close) - current.low;

  const upperWick =
    current.high - Math.max(current.open, current.close);

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

  if (body / range < 0.1) return "Doji-like candle";

  return "No major pattern";
}

function volumeRatio(candles) {
  if (candles.length < 22) return null;

  const current = candles[candles.length - 1].volume;
  const previous = candles.slice(-21, -1);

  const average =
    previous.reduce((sum, c) => sum + c.volume, 0) / 20;

  return average > 0 ? current / average : null;
}

/* =========================================================
   BASE ANALYSIS
========================================================= */

function analyze(candles) {
  const closes = candles.map(c => c.close);

  const price = closes[closes.length - 1];

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
    throw new Error("Insufficient data for reliable indicators.");
  }

  const ratio = volumeRatio(candles);

  const levels = findLevels(candles, price, volatility);
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

  if (pattern === "Bullish engulfing") bullish++;
  if (pattern === "Bearish engulfing") bearish++;

  if (ratio !== null && ratio >= 1) {
    evidence.push("Volume above previous 20-candle average");
  }

  const upTrend = e20 > e50 && e50 > e200;
  const downTrend = e20 < e50 && e50 < e200;

  const volumeConfirmed = ratio !== null && ratio >= 1;
  const strongADX = trendPower >= 18;

  let signal = "WAIT";
  let reason = "The required conditions are not fully aligned.";

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

    if (!volumeConfirmed) missing.push("volume confirmation");
    if (!strongADX) missing.push("ADX trend strength");
    if (momentum.histogram === 0) missing.push("MACD direction");

    if (missing.length) {
      reason = "Missing: " + missing.join(", ") + ".";
    } else {
      reason = "Trend, momentum and directional evidence conflict.";
    }
  }

  const riskDistance = volatility * 1.5;

  let stop = null;
  let target1 = null;
  let target2 = null;
  let rewardRisk = null;

  if (signal === "BUY") {
    stop = price - riskDistance;

    target1 = price + riskDistance * 1.5;
    target2 = price + riskDistance * 2.5;

    if (levels.resistance > price) {
      target1 = Math.min(target1, levels.resistance);
    }

    rewardRisk = (target1 - price) / (price - stop);

    if (rewardRisk < 1.2) {
      signal = "WAIT";
      reason = "The nearest resistance does not provide the required reward-to-risk ratio.";
      stop = target1 = target2 = rewardRisk = null;
    }
  }

  if (signal === "SELL") {
    stop = price + riskDistance;

    target1 = price - riskDistance * 1.5;
    target2 = price - riskDistance * 2.5;

    if (levels.support < price) {
      target1 = Math.max(target1, levels.support);
    }

    rewardRisk = (price - target1) / (stop - price);

    if (rewardRisk < 1.2) {
      signal = "WAIT";
      reason = "The nearest support does not provide the required reward-to-risk ratio.";
      stop = target1 = target2 = rewardRisk = null;
    }
  }

  if (signal !== "WAIT") {
    reason = "The base timeframe satisfies the configured strategy conditions.";
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
    candleTime: candles[candles.length - 1].closeTime
  };
}

/* =========================================================
   HIGHER TIMEFRAME CONFIRMATION
========================================================= */

function classifyTrend(candles) {
  const closes = candles.map(c => c.close);

  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);

  const strength = rsi(closes);
  const momentum = macd(closes);

  const up = e20 > e50 && e50 > e200;
  const down = e20 < e50 && e50 < e200;

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
  const timeframes = HIGHER[interval] || [];

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
      const candles = await getCandles(symbol, tf, market, 300);

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
      gradeReason: "The base timeframe has not produced a valid setup."
    };
  }

  const direction =
    base.signal === "BUY" ? "Bullish" : "Bearish";

  const available = mtf.items.filter(
    item => item.trend !== "Unavailable"
  );

  const opposite = available.filter(
    item => item.trend !== "Mixed" && item.trend !== direction
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
      reason: "Higher-timeframe conflict detected. No trade setup approved."
    };
  }

  let grade = "Weak";
  let gradeReason = "Higher-timeframe confirmation is limited.";

  if (available.length && aligned.length === available.length) {
    grade = available.length >= 2 ? "Strong" : "Moderate";
    gradeReason = "Higher-timeframe trends agree with the base signal.";
  } else if (aligned.length > 0) {
    grade = "Moderate";
    gradeReason = "At least one higher timeframe supports the base signal.";
  }

  if (!available.length) {
    grade = "Weak";
    gradeReason = "Higher-timeframe data unavailable; base signal only.";
  }

  if (!mtf.items.length) {
    grade = "Moderate";
    gradeReason = "Weekly analysis has no higher timeframe available.";
  }

  return {
    ...base,
    grade,
    gradeReason
  };
}

/* =========================================================
   ANALYSIS DISPLAY
========================================================= */

function displayAnalysis(result, symbol, market, interval, mtf) {
  const output = $("analysisResult");
  if (!output) return;

  const signalClass = result.signal === "BUY"
    ? "signal-buy"
    : result.signal === "SELL"
      ? "signal-sell"
      : "signal-wait";

  const tradeHTML = result.signal === "WAIT"
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
        <h3 class="${signalClass}">${result.signal}</h3>
        <p>${esc(symbol)} · ${esc(market)} · ${esc(interval)}</p>
        <p>Reference price: <b>${money(result.price)}</b></p>
        <p>Last completed candle: ${utcTime(result.candleTime)}</p>
        <p>${esc(result.reason)}</p>
      </div>

      <h3>Technical indicators</h3>

      <div class="metrics">
        <div class="metric"><span>EMA20</span><strong>${money(result.e20)}</strong></div>
        <div class="metric"><span>EMA50</span><strong>${money(result.e50)}</strong></div>
        <div class="metric"><span>EMA200</span><strong>${money(result.e200)}</strong></div>
        <div class="metric"><span>RSI14</span><strong>${number(result.rsi)}</strong></div>
        <div class="metric"><span>MACD histogram</span><strong>${number(result.macd.histogram, 5)}</strong></div>
        <div class="metric"><span>ADX</span><strong>${number(result.adx)}</strong></div>
        <div class="metric"><span>ATR</span><strong>${money(result.atr)}</strong></div>
        <div class="metric"><span>Volume ratio</span><strong>${result.volumeRatio === null ? "N/A" : number(result.volumeRatio) + "x"}</strong></div>
      </div>

      <h3>Trade plan</h3>
      ${tradeHTML}

      <h3>Support and resistance</h3>
      <div class="metrics">
        <div class="metric"><span>Support</span><strong>${money(result.levels.support)}</strong></div>
        <div class="metric"><span>Resistance</span><strong>${money(result.levels.resistance)}</strong></div>
      </div>

      <h3>Fibonacci reference levels</h3>
      <div class="metrics">
        ${Object.entries(result.fib).map(([key, value]) => `
          <div class="metric">
            <span>${key}</span>
            <strong>${money(value)}</strong>
          </div>
        `).join("")}
      </div>

      <p class="muted-note">
        Candlestick observation: ${esc(result.pattern)}
      </p>

      <p class="muted-note">
        Evidence count: ${result.bullish} bullish · ${result.bearish} bearish.
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
        <small>Grade measures evidence alignment, not probability of profit.</small>
      </div>
    `;
  }

  const trend = $("trendSummary");

  if (trend) {
    let text = result.e20 > result.e50 && result.e50 > result.e200
      ? "Bullish base-timeframe structure"
      : result.e20 < result.e50 && result.e50 < result.e200
        ? "Bearish base-timeframe structure"
        : "Mixed base-timeframe structure";

    trend.innerHTML = `
      <div class="result-card">
        <b>${esc(text)}</b>
        <p>RSI: ${number(result.rsi)} · ADX: ${number(result.adx)}</p>
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
    container.innerHTML = `
      <div class="metric">
        <span>Higher timeframe</span>
        <strong>Not available for weekly analysis</strong>
      </div>
    `;

    if (status) status.textContent = "Weekly analysis";

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
      mtf.available + " / " + mtf.items.length + " confirmations available";
  }
}

/* =========================================================
   FREE ANALYSIS CREDITS
========================================================= */

function getCredits() {
  const stored = localStorage.getItem(STORE.credits);

  if (stored === null) {
    localStorage.setItem(STORE.credits, "4");
    return 4;
  }

  return Math.max(0, Math.min(4, Number(stored) || 0));
}

function updateCredits() {
  const el = $("credits");
  if (el) el.textContent = getCredits() + " / 4";
}

function useCredit() {
  const current = getCredits();

  if (current <= 0) {
    toast("Your free analysis allowance is exhausted.");
    return false;
  }

  localStorage.setItem(STORE.credits, String(current - 1));
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

  if (!isAlert) setButtonLoading(button, true, "Analyzing…");

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

    const candles = await getCandles(symbol, interval, market, 500);

    const base = analyze(candles);

    let mtf = { items: [], available: 0 };

    if (!isAlert) {
      const selected = await getMTF(symbol, interval, market);

      mtf = selected;
    }

    const result = applyMTF(base, mtf);

    if (!isAlert) {
      if (!useCredit()) return;

      displayAnalysis(result, symbol, market, interval, mtf);
      toast("Analysis completed.");
    } else {
      await processAlert(result, symbol, interval, candles);
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

    if (!isAlert) setButtonLoading(button, false);
  }
}

/* =========================================================
   BACKTESTING
========================================================= */

function calculateBacktestTrade(
  candles,
  index,
  feeRate,
  slippageRate
) {
  const historical = candles.slice(0, index);

  if (historical.length < 220) return null;

  let analysis;

  try {
    analysis = analyze(historical);
  } catch {
    return null;
  }

  if (analysis.signal === "WAIT") return null;

  const entryCandle = candles[index];

  const side = analysis.signal === "BUY" ? "LONG" : "SHORT";

  const rawEntry = entryCandle.open;

  const entry = side === "LONG"
    ? rawEntry * (1 + slippageRate)
    : rawEntry * (1 - slippageRate);

  const stop = analysis.stop;
  const target = analysis.target1;

  if (!Number.isFinite(stop) || !Number.isFinite(target)) {
    return null;
  }

  const risk = Math.abs(entry - stop);

  if (risk <= 0) return null;

  let exit = null;
  let outcome = "OPEN";
  let exitIndex = index;

  const maxHold = Math.min(candles.length - 1, index + 50);

  for (let j = index; j <= maxHold; j++) {
    const c = candles[j];

    const stopHit = side === "LONG"
      ? c.low <= stop
      : c.high >= stop;

    const targetHit = side === "LONG"
      ? c.high >= target
      : c.low <= target;

    // Conservative rule: if both hit in one candle,
    // assume the stop-loss occurred first.
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

  const executionExit = side === "LONG"
    ? exit * (1 - slippageRate)
    : exit * (1 + slippageRate);

  const direction = side === "LONG" ? 1 : -1;

  const grossReturn =
    direction * (executionExit - entry) / entry;

  const fees = feeRate * 2;

  const netReturn = grossReturn - fees;

  return {
    side,
    entry,
    exit: executionExit,
    stop,
    target,
    outcome,
    netReturn,
    exitIndex
  };
}

async function runBacktest() {
  const button = $("backtestBtn");
  const output = $("backtestResult");

  if (!output) return;

  setButtonLoading(button, true, "Testing history…");

  output.innerHTML =
    '<div class="loading">Downloading historical candles and testing strategy…</div>';

  try {
    const symbol = $("backtestSymbol").value;
    const market = $("backtestMarket").value;
    const interval = $("backtestInterval").value;
    const limit = Number($("backtestCandles").value);

    const candles = await getCandles(
      symbol,
      interval,
      market,
      limit
    );

    const trades = [];

    let index = 220;

    while (index < candles.length - 1) {
      const trade = calculateBacktestTrade(
        candles,
        index,
        FEE_RATE,
        SLIPPAGE_RATE
      );

      if (trade) {
        trades.push(trade);
        index = Math.max(index + 1, trade.exitIndex + 1);
      } else {
        index++;
      }

      if (index % 15 === 0) {
        await sleep(0);
      }
    }

    const wins = trades.filter(t => t.netReturn > 0).length;
    const losses = trades.filter(t => t.netReturn <= 0).length;

    const winRate = trades.length
      ? wins / trades.length * 100
      : 0;

    let equity = 10000;
    let peak = equity;
    let maxDrawdown = 0;

    trades.forEach(trade => {
      equity *= 1 + trade.netReturn;

      peak = Math.max(peak, equity);

      const drawdown = peak
        ? (peak - equity) / peak * 100
        : 0;

      maxDrawdown = Math.max(maxDrawdown, drawdown);
    });

    const totalReturn = (equity - 10000) / 10000 * 100;

    saveJSON("agu_last_backtest_v32", {
      symbol,
      market,
      interval,
      totalTrades: trades.length,
      wins,
      losses,
      winRate,
      equity,
      totalReturn,
      maxDrawdown,
      time: Date.now()
    });

    output.innerHTML = `
      <div class="result-card">
        <h3>Backtest results</h3>
        <p>${esc(symbol)} · ${esc(market)} · ${esc(interval)}</p>
        <p>Completed historical candles: ${candles.length}</p>

        <div class="result-grid">
          <div class="result-stat">
            <span>Total trades</span>
            <strong>${trades.length}</strong>
          </div>
          <div class="result-stat">
            <span>Winning trades</span>
            <strong>${wins}</strong>
          </div>
          <div class="result-stat">
            <span>Losing / non-winning trades</span>
            <strong>${losses}</strong>
          </div>
          <div class="result-stat">
            <span>Observed win rate</span>
            <strong>${number(winRate)}%</strong>
          </div>
          <div class="result-stat">
            <span>Simulated final equity</span>
            <strong>${money(equity)}</strong>
          </div>
          <div class="result-stat">
            <span>Net return</span>
            <strong>${number(totalReturn)}%</strong>
          </div>
          <div class="result-stat">
            <span>Maximum drawdown</span>
            <strong>${number(maxDrawdown)}%</strong>
          </div>
        </div>

        <h3>Execution assumptions</h3>
        <p>Entry: next candle open after signal.</p>
        <p>Fees: assumed 0.10% per side.</p>
        <p>Slippage: assumed 0.05% per side.</p>
        <p>If stop-loss and target are touched in the same candle, stop-loss is assumed first.</p>

        <div class="risk-warning">
          These are simulated historical results, not live performance.
          Fees and slippage are assumptions, not your actual exchange costs.
          The simulation does not establish future profitability.
        </div>
      </div>
    `;

    toast("Backtest completed.");

  } catch (error) {
    output.innerHTML =
      `<div class="risk-warning">${esc(error.message)}</div>`;

    toast(error.message);

  } finally {
    setButtonLoading(button, false);
  }
}

/* =========================================================
   PAPER TRADING
========================================================= */

function defaultPaperAccount() {
  return {
    balance: STARTING_BALANCE,
    initialBalance: STARTING_BALANCE,
    positions: [],
    history: [],
    realized: 0,
    created: Date.now()
  };
}

function getPaperAccount() {
  return readJSON(STORE.paper, null) || defaultPaperAccount();
}

function savePaperAccount(account) {
  saveJSON(STORE.paper, account);
  renderPaperAccount();
}

function getRiskSettings() {
  return readJSON(STORE.risk, {
    balance: STARTING_BALANCE,
    riskPercent: 1,
    dailyLossLimit: 3
  });
}

function getDailyRealizedLoss(account) {
  const today = new Date().toDateString();

  return account.history
    .filter(trade =>
      new Date(trade.closedAt).toDateString() === today
    )
    .reduce((sum, trade) => sum + Math.min(0, trade.pnl), 0);
}

async function currentPrice(symbol) {
  const data = await request(
    API.spot + "/ticker/price?symbol=" +
    encodeURIComponent(symbol)
  );

  return Number(data.price);
}

function renderPaperAccount() {
  const account = getPaperAccount();

  const prices = lastMarketPrices;

  let unrealized = 0;

  account.positions.forEach(position => {
    const price = prices[position.symbol];

    if (!price) return;

    const direction = position.side === "LONG" ? 1 : -1;

    unrealized +=
      direction *
      (price - position.entry) /
      position.entry *
      position.amount;
  });

  if ($("paperBalance")) {
    $("paperBalance").textContent = money(account.balance);
  }

  if ($("paperOpenCount")) {
    $("paperOpenCount").textContent = account.positions.length;
  }

  if ($("paperClosedCount")) {
    $("paperClosedCount").textContent = account.history.length;
  }

  if ($("paperPnL")) {
    $("paperPnL").textContent = money(account.realized);
  }

  const positions = $("paperPositions");

  if (positions) {
    positions.innerHTML = account.positions.length
      ? `
        <table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Side</th>
              <th>Entry</th>
              <th>Current</th>
              <th>Unrealized P/L</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${account.positions.map(position => {
              const price = prices[position.symbol] || position.entry;
              const direction = position.side === "LONG" ? 1 : -1;

              const pnl =
                direction *
                (price - position.entry) /
                position.entry *
                position.amount;

              return `
                <tr>
                  <td>${esc(position.symbol)}</td>
                  <td>${esc(position.side)}</td>
                  <td>${money(position.entry)}</td>
                  <td>${money(price)}</td>
                  <td class="${pnl >= 0 ? "positive" : "negative"}">
                    ${money(pnl)}
                  </td>
                  <td>
                    <button class="outline"
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
    history.innerHTML = account.history.length
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
            ${account.history.slice().reverse().slice(0, 100).map(trade => `
              <tr>
                <td>${esc(trade.symbol)}</td>
                <td>${esc(trade.side)}</td>
                <td>${money(trade.entry)}</td>
                <td>${money(trade.exit)}</td>
                <td class="${trade.pnl >= 0 ? "positive" : "negative"}">
                  ${money(trade.pnl)}
                </td>
                <td>${esc(new Date(trade.closedAt).toLocaleString())}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `
      : '<p class="muted-note">No simulated trades yet.</p>';
  }

  updateRiskDisplay();
}

async function openPaperTrade() {
  const symbol = $("paperSymbol").value;
  const side = $("paperSide").value;
  const amount = Number($("paperAmount").value);

  const account = getPaperAccount();
  const risk = getRiskSettings();

  if (!Number.isFinite(amount) || amount < 10) {
    toast("Enter a valid simulated amount of at least 10 USDT.");
    return;
  }

  if (amount > account.balance) {
    toast("Insufficient virtual balance.");
    return;
  }

  const dailyLoss = getDailyRealizedLoss(account);
  const dailyLimit = account.initialBalance *
    risk.dailyLossLimit / 100;

  if (Math.abs(dailyLoss) >= dailyLimit) {
    toast("Daily simulated loss limit reached.");
    return;
  }

  try {
    const price = await currentPrice(symbol);

    const position = {
      id: String(Date.now()) + Math.random().toString(36).slice(2, 7),
      symbol,
      side,
      amount,
      entry: price,
      openedAt: Date.now(),
      openingFee: amount * FEE_RATE
    };

    account.balance -= amount + position.openingFee;

    if (account.balance < 0) {
      toast("Insufficient virtual balance after estimated fee.");
      return;
    }

    account.positions.push(position);

    savePaperAccount(account);

    const status = $("paperStatus");

    if (status) {
      status.textContent =
        "Simulated " + side + " opened for " +
        symbol + " at " + money(price) + ".";
    }

    toast("Simulated trade opened.");

  } catch (error) {
    toast(error.message);
  }
}

async function closePaperTrade(id) {
  const account = getPaperAccount();

  const index = account.positions.findIndex(
    position => position.id === id
  );

  if (index < 0) return;

  const position = account.positions[index];

  try {
    const exit = await currentPrice(position.symbol);

    const direction = position.side === "LONG" ? 1 : -1;

    const gross =
      direction *
      (exit - position.entry) /
      position.entry *
      position.amount;

    const closingFee = position.amount * FEE_RATE;

    const pnl =
      gross -
      position.openingFee -
      closingFee;

    account.balance += position.amount + gross - closingFee;
    account.realized += pnl;

    account.history.push({
      ...position,
      exit,
      pnl,
      closedAt: Date.now(),
      closingFee
    });

    account.positions.splice(index, 1);

    savePaperAccount(account);

    toast("Simulated position closed.");

  } catch (error) {
    toast(error.message);
  }
}

function resetPaperAccount() {
  if (!confirm("Reset the simulated account and delete its trade history?")) {
    return;
  }

  saveJSON(STORE.paper, defaultPaperAccount());

  renderPaperAccount();

  toast("Paper account reset.");
}

/* =========================================================
   RISK MANAGEMENT
========================================================= */

function updateRiskDisplay() {
  const account = getPaperAccount();
  const settings = getRiskSettings();

  const dailyLimit =
    account.initialBalance * settings.dailyLossLimit / 100;

  const dailyLoss = Math.abs(getDailyRealizedLoss(account));

  const riskBudget =
    settings.balance * settings.riskPercent / 100;

  const output = $("riskResult");

  if (output) {
    output.innerHTML = `
      <div class="result-card">
        <div class="result-grid">
          <div class="result-stat">
            <span>Risk budget per trade</span>
            <strong>${money(riskBudget)}</strong>
          </div>
          <div class="result-stat">
            <span>Maximum daily loss</span>
            <strong>${money(dailyLimit)}</strong>
          </div>
          <div class="result-stat">
            <span>Realized loss today</span>
            <strong>${money(dailyLoss)}</strong>
          </div>
        </div>
        <p class="${dailyLoss >= dailyLimit ? "risk-warning" : "risk-safe"}">
          ${dailyLoss >= dailyLimit
            ? "Daily simulated loss limit reached."
            : "Daily simulated loss limit has not been reached."}
        </p>
        <small>
          Risk budget is a planning reference, not a guaranteed maximum loss.
          The paper-trading module does not currently attach protective stop-loss
          orders to simulated positions.
        </small>
      </div>
    `;
  }
}

function saveRiskSettings() {
  const balance = Number($("riskBalance").value);
  const riskPercent = Number($("riskPercent").value);
  const dailyLossLimit = Number($("dailyLossLimit").value);

  if (!Number.isFinite(balance) || balance < 100) {
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

  saveJSON(STORE.risk, {
    balance,
    riskPercent,
    dailyLossLimit
  });

  updateRiskDisplay();

  toast("Risk settings saved.");
}

/* =========================================================
   ALERT SYSTEM
========================================================= */

function playAlertSound() {
  try {
    const AudioContext =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContext) return;

    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

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
    console.warn("Alert sound unavailable.", error);
  }
}

async function enableNotifications() {
  if (!("Notification" in window)) {
    toast("Browser notifications are not supported.");
    return;
  }

  const permission = await Notification.requestPermission();

  toast(
    permission === "granted"
      ? "Notifications enabled."
      : "Notification permission was not granted."
  );
}

function saveAlert(message) {
  const log = readJSON(STORE.alerts, []);

  log.push({
    message,
    time: Date.now()
  });

  saveJSON(STORE.alerts, log.slice(-50));

  renderAlertLog();
}

function renderAlertLog() {
  const container = $("alertLog");
  if (!container) return;

  const log = readJSON(STORE.alerts, []);

  if (!log.length) {
    container.innerHTML =
      '<p class="muted-note">No alerts yet.</p>';
    return;
  }

  container.innerHTML = log.slice().reverse().map(item => `
    <div class="alert-item">
      ${esc(item.message)}
      <br>
      <small>${esc(new Date(item.time).toLocaleString())}</small>
    </div>
  `).join("");
}

async function processAlert(result, symbol, interval, candles) {
  if (result.signal === "WAIT") return;

  const key = symbol + "_" + interval;

  const states = readJSON(STORE.alertState, {});
  const last = states[key];

  const identity = result.signal + "_" + result.candleTime;

  if (last === identity) return;

  states[key] = identity;

  saveJSON(STORE.alertState, states);

  const message =
    symbol + " " + result.signal +
    " signal on " + interval +
    ". Price: " + money(result.price);

  saveAlert(message);

  playAlertSound();

  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("AGU Crypto Analyzer", {
      body: message
    });
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

    if (button) button.textContent = "Start monitoring";

    if ($("alertStatus")) {
      $("alertStatus").textContent =
        "Monitoring is off.";
    }

    return;
  }

  monitoring = true;

  if (button) button.textContent = "Stop monitoring";

  if ($("alertStatus")) {
    $("alertStatus").textContent =
      "Monitoring is active while this page remains open.";
  }

  runAnalysis(true);

  monitorTimer = setInterval(() => {
    if (document.visibilityState === "visible") {
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
      <b>Frontend-only security status</b>
      <p>Market data is retrieved from public Binance endpoints.</p>
      <p>No exchange API secret is stored by this application.</p>
      <p>No real orders or payments can be executed.</p>
      <p>LocalStorage data is controlled by the browser and is not secure account storage.</p>
      <p>Authenticated backend, server-side permissions, encrypted credentials,
      audit logs, rate limiting and emergency trading controls are not yet installed.</p>
      <b>Live automatic trading is disabled.</b>
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

  renderPaperAccount();

  renderSecurityStatus();

  loadMarkets();

  if ($("year")) {
    $("year").textContent = new Date().getFullYear();
  }

  $("themeBtn")?.addEventListener("click", toggleTheme);

  $("refreshBtn")?.addEventListener("click", loadMarkets);

  $("analyzeBtn")?.addEventListener("click", () => {
    runAnalysis(false);
  });

  $("notifyBtn")?.addEventListener("click", enableNotifications);

  $("monitorBtn")?.addEventListener("click", toggleMonitoring);

  $("backtestBtn")?.addEventListener("click", runBacktest);

  $("paperOpenBtn")?.addEventListener("click", openPaperTrade);

  $("paperResetBtn")?.addEventListener("click", resetPaperAccount);

  $("saveRiskBtn")?.addEventListener("click", saveRiskSettings);

  $("paperPositions")?.addEventListener("click", event => {
    const button = event.target.closest("[data-close-paper]");

    if (button) {
      closePaperTrade(button.dataset.closePaper);
    }
  });

  setInterval(loadMarkets, 60000);

  // Refresh paper account prices from the latest market snapshot.
  setInterval(renderPaperAccount, 30000);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js")
      .catch(error => console.warn("Service worker:", error));
  }
}

document.addEventListener("DOMContentLoaded", initialize);
