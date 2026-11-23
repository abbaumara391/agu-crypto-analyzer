"use strict";

/* =========================================================
   AGU CRYPTO ANALYZER V3.3
   Owner: Umar Mohammed

   SECURITY:
   - Public Binance market data only.
   - No exchange API secrets.
   - No real order execution.
   - No payment processing.
   - Paper trading is browser-side simulation.
   - Paper stops require this page to remain active.
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
  oldRisk: "agu_paper_risk_v32"
};

const STARTING_BALANCE = 10000;
const FEE_RATE = 0.001;
const SLIPPAGE_RATE = 0.0005;

let monitoring = false;
let monitorTimer = null;
let lastAnalysis = null;
let lastMarketPrices = {};
let busyAnalysis = false;
let paperPriceTimer = null;
let paperBusy = false;

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
  localStorage.setItem(
    STORE.theme,
    current === "dark" ? "light" : "dark"
  );
  applyTheme();
}

/* =========================================================
   MARKET DATA
========================================================= */

async function loadMarkets() {
  const grid = $("marketGrid");

  try {
    const data = await request(API.spot + "/ticker/24hr");

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

    if ($("connection")) {
      $("connection").textContent = "Live market data";
      $("connection").className = "pill green";
    }

    renderPaperAccount();

  } catch (error) {
    const cached = readJSON(STORE.market, []);

    if (cached.length) {
      renderMarkets(cached, true);

      if ($("connection")) {
        $("connection").textContent = "Cached snapshot";
        $("connection").className = "pill muted";
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

    if (!groups.has(start)) groups.set(start, []);
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
  limit = 500,
  minimumOverride = null
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

  const minimum = minimumOverride ||
    (interval === "1w" ? 200 : 220);

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

  for (let i = 0; i < period; i++) sum += values[i];

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

    const trSum = tr.slice(start, i + 1)
      .reduce((a, b) => a + b, 0);

    const plusSum = plus.slice(start, i + 1)
      .reduce((a, b) => a + b, 0);

    const minusSum = minus.slice(start, i + 1)
      .reduce((a, b) => a + b, 0);

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
   SUPPORT / RESISTANCE AND PATTERNS
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
    ) highs.push(c.high);

    if (
      c.low < data[i - 1].low &&
      c.low < data[i - 2].low &&
      c.low <= data[i + 1].low &&
      c.low <= data[i + 2].low
    ) lows.push(c.low);
  }

  const resistance = highs
    .filter(v => v > price)
    .sort((a, b) => a - b);

  const support = lows
    .filter(v => v < price)
    .sort((a, b) => b - a);

  return {
    support: support[0] || Math.min(...data.map(c => c.low)),
    resistance: resistance[0] || Math.max(...data.map(c => c.high))
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

  if (lowerWick > body * 2 && upperWick < body * 1.2) {
    return "Hammer-like candle";
  }

  if (upperWick > body * 2 && lowerWick < body * 1.2) {
    return "Shooting-star-like candle";
  }

  if (
    current.close > current.open &&
    previous.close < previous.open &&
    current.close >= previous.open &&
    current.open <= previous.close
  ) return "Bullish engulfing";

  if (
    current.close < current.open &&
    previous.close > previous.open &&
    current.open >= previous.close &&
    current.close <= previous.open
  ) return "Bearish engulfing";

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
  ) signal = "BUY";

  if (
    bearish >= 4 &&
    bearish > bullish &&
    downTrend &&
    strength <= 48 &&
    strength >= 32 &&
    momentum.histogram < 0 &&
    volumeConfirmed &&
    strongADX
  ) signal = "SELL";

  if (signal === "WAIT") {
    const missing = [];

    if (!volumeConfirmed) missing.push("volume confirmation");
    if (!strongADX) missing.push("ADX trend strength");
    if (momentum.histogram === 0) missing.push("MACD direction");

    reason = missing.length
      ? "Missing: " + missing.join(", ") + "."
      : "Trend, momentum and directional evidence conflict.";
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
      reason = "Nearest resistance does not provide the required reward-to-risk ratio.";
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
      reason = "Nearest support does not provide the required reward-to-risk ratio.";
      stop = target1 = target2 = rewardRisk = null;
    }
  }

  if (signal !== "WAIT") {
    reason = "The base timeframe satisfies the configured strategy conditions.";
  }

  return {
    signal, price, e20, e50, e200,
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
  ) return "Bullish";

  if (
    down &&
    closes[closes.length - 1] < e20 &&
    strength < 50 &&
    momentum.histogram < 0
  ) return "Bearish";

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

  return {
    items,
    available: items.filter(
      item => item.trend !== "Unavailable"
    ).length,
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

  return { ...base, grade, gradeReason };
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
        <div class="result-stat"><span>Reference entry</span><strong>${money(result.price)}</strong></div>
        <div class="result-stat"><span>Stop-loss</span><strong>${money(result.stop)}</strong></div>
        <div class="result-stat"><span>Take profit 1</span><strong>${money(result.target1)}</strong></div>
        <div class="result-stat"><span>Take profit 2</span><strong>${money(result.target2)}</strong></div>
        <div class="result-stat"><span>Reward/risk</span><strong>${number(result.rewardRisk)} : 1</strong></div>
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
          <div class="metric"><span>${key}</span><strong>${money(value)}</strong></div>
        `).join("")}
      </div>

      <p class="muted-note">Candlestick observation: ${esc(result.pattern)}</p>
      <p class="muted-note">Evidence count: ${result.bullish} bullish · ${result.bearish} bearish.</p>
    </div>
  `;

  if ($("signalGrade")) {
    $("signalGrade").innerHTML = `
      <div class="result-card">
        <b class="grade-${result.grade.toLowerCase()}">${result.grade} signal grade</b>
        <p>${esc(result.gradeReason)}</p>
        <small>Grade measures evidence alignment, not probability of profit.</small>
      </div>
    `;
  }

  if ($("trendSummary")) {
    const text =
      result.e20 > result.e50 && result.e50 > result.e200
        ? "Bullish base-timeframe structure"
        : result.e20 < result.e50 && result.e50 < result.e200
          ? "Bearish base-timeframe structure"
          : "Mixed base-timeframe structure";

    $("trendSummary").innerHTML = `
      <div class="result-card">
        <b>${esc(text)}</b>
        <p>RSI: ${number(result.rsi)} · ADX: ${number(result.adx)}</p>
      </div>
    `;
  }

  renderMTF(mtf);

  lastAnalysis = { result, symbol, market, interval, mtf };
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
      ${item.error ? `<small>${esc(item.error)}</small>` : ""}
    </div>
  `).join("");

  if (status) {
    status.textContent =
      mtf.available + " / " + mtf.items.length +
      " confirmations available";
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
  if ($("credits")) {
    $("credits").textContent = getCredits() + " / 4";
  }
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

    const market = isAlert ? "spot" : $("marketType").value;

    const candles = await getCandles(symbol, interval, market, 500);
    const base = analyze(candles);

    let mtf = { items: [], available: 0 };

    if (!isAlert) {
      mtf = await getMTF(symbol, interval, market);
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
      if ($("analysisResult")) {
        $("analysisResult").innerHTML =
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
   BACKTESTING V3.3
========================================================= */

function calculateBacktestTrade(
  candles,
  index,
  feeRate,
  slippageRate,
  market
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

  // A spot backtest cannot open a short position.
  if (market === "spot" && analysis.signal === "SELL") {
    return null;
  }

  const entryCandle = candles[index];
  const side = analysis.signal === "BUY" ? "LONG" : "SHORT";

  const entry = side === "LONG"
    ? entryCandle.open * (1 + slippageRate)
    : entryCandle.open * (1 - slippageRate);

  const stop = analysis.stop;
  const target = analysis.target1;

  if (!Number.isFinite(stop) || !Number.isFinite(target)) {
    return null;
  }

  if (
    side === "LONG" &&
    (stop >= entry || target <= entry)
  ) return null;

  if (
    side === "SHORT" &&
    (stop <= entry || target >= entry)
  ) return null;

  const riskDistance = Math.abs(entry - stop);
  const riskFraction = riskDistance / entry;

  if (!riskFraction) return null;

  let exit = null;
  let outcome = "OPEN";
  let exitIndex = index;

  const maxHold = Math.min(candles.length - 1, index + 50);

  for (let j = index; j <= maxHold; j++) {
    const candle = candles[j];

    const stopHit = side === "LONG"
      ? candle.low <= stop
      : candle.high >= stop;

    const targetHit = side === "LONG"
      ? candle.high >= target
      : candle.low <= target;

    // Conservative same-candle assumption.
    if (stopHit) {
      exit = stop;
      outcome = "STOP LOSS";
      exitIndex = j;
      break;
    }

    if (targetHit) {
      exit = target;
      outcome = "TAKE PROFIT";
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

  const netReturn = grossReturn - feeRate * 2;

  return {
    side,
    entry,
    exit: executionExit,
    stop,
    target,
    outcome,
    netReturn,
    riskFraction,
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

    let limit = Number($("backtestCandles").value);

    if (limit < 500) {
      limit = 500;
      if ($("backtestCandles")) {
        $("backtestCandles").value = "500";
      }
      toast("Backtesting requires at least 500 candles. Using 500.");
    }

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
        SLIPPAGE_RATE,
        market
      );

      if (trade) {
        trades.push(trade);
        index = Math.max(index + 1, trade.exitIndex + 1);
      } else {
        index++;
      }

      if (index % 15 === 0) await sleep(0);
    }

    const wins = trades.filter(t => t.netReturn > 0).length;
    const losses = trades.filter(t => t.netReturn <= 0).length;

    const winRate = trades.length
      ? wins / trades.length * 100
      : 0;

    let equity = 10000;
    let peak = equity;
    let maxDrawdown = 0;

    const riskPerTrade = 0.01;
    const equityCurve = [];

    trades.forEach(trade => {
      // Risk 1% of equity, capped at 1x account equity.
      const riskCash = equity * riskPerTrade;
      const desiredNotional = riskCash / trade.riskFraction;
      const notional = Math.min(equity, desiredNotional);

      equity += notional * trade.netReturn;

      peak = Math.max(peak, equity);

      const drawdown = peak
        ? (peak - equity) / peak * 100
        : 0;

      maxDrawdown = Math.max(maxDrawdown, drawdown);

      equityCurve.push(equity);
    });

    const totalReturn = (equity - 10000) / 10000 * 100;

    const grossWins = trades
      .filter(t => t.netReturn > 0)
      .reduce((sum, t) => sum + t.netReturn, 0);

    const grossLosses = Math.abs(trades
      .filter(t => t.netReturn <= 0)
      .reduce((sum, t) => sum + t.netReturn, 0));

    const profitFactor = grossLosses > 0
      ? grossWins / grossLosses
      : grossWins > 0 ? Infinity : 0;

    const averageReturn = trades.length
      ? trades.reduce((sum, t) => sum + t.netReturn, 0) / trades.length
      : 0;

    const largestWin = trades.length
      ? Math.max(0, ...trades.map(t => t.netReturn))
      : 0;

    const largestLoss = trades.length
      ? Math.min(0, ...trades.map(t => t.netReturn))
      : 0;

    saveJSON("agu_last_backtest_v33", {
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
      profitFactor,
      averageReturn,
      time: Date.now()
    });

    output.innerHTML = `
      <div class="result-card">
        <h3>Backtest results — V3.3</h3>
        <p>${esc(symbol)} · ${esc(market)} · ${esc(interval)}</p>
        <p>Completed historical candles: ${candles.length}</p>

        <div class="result-grid">
          <div class="result-stat"><span>Total trades</span><strong>${trades.length}</strong></div>
          <div class="result-stat"><span>Winning trades</span><strong>${wins}</strong></div>
          <div class="result-stat"><span>Losing trades</span><strong>${losses}</strong></div>
          <div class="result-stat"><span>Observed win rate</span><strong>${number(winRate)}%</strong></div>
          <div class="result-stat"><span>Final simulated equity</span><strong>${money(equity)}</strong></div>
          <div class="result-stat"><span>Net return</span><strong>${number(totalReturn)}%</strong></div>
          <div class="result-stat"><span>Maximum drawdown</span><strong>${number(maxDrawdown)}%</strong></div>
          <div class="result-stat"><span>Profit factor</span><strong>${Number.isFinite(profitFactor) ? number(profitFactor) : "N/A"}</strong></div>
          <div class="result-stat"><span>Average trade return</span><strong>${number(averageReturn * 100, 3)}%</strong></div>
          <div class="result-stat"><span>Largest winning trade</span><strong>${number(largestWin * 100, 3)}%</strong></div>
          <div class="result-stat"><span>Largest losing trade</span><strong>${number(largestLoss * 100, 3)}%</strong></div>
        </div>

        <h3>Execution assumptions</h3>
        <p>Signals are calculated from candles available before entry.</p>
        <p>Entry: next candle open after signal.</p>
        <p>Position risk: 1% of simulated equity, capped at 1x equity.</p>
        <p>Fees: assumed 0.10% per side.</p>
        <p>Slippage: assumed 0.05% per side.</p>
        <p>Same-candle stop and target: stop-loss assumed first.</p>
        <p>Maximum holding period: 50 candles.</p>
        <p>Spot backtesting excludes short positions.</p>

        <div class="risk-warning">
          This is a base-timeframe-only historical simulation.
          It does not use multi-timeframe confirmation.
          Results are not live performance or proof of future profitability.
          Fee, slippage and execution assumptions may differ from real markets.
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
   PAPER ACCOUNT AND MIGRATION
========================================================= */

function defaultPaperAccount() {
  return {
    balance: STARTING_BALANCE,
    initialBalance: STARTING_BALANCE,
    positions: [],
    history: [],
    realized: 0,
    created: Date.now(),
    dayKey: new Date().toDateString(),
    dayStartEquity: STARTING_BALANCE
  };
}

function migratePaperAccount() {
  const existing = readJSON(STORE.paper, null);

  if (existing) return existing;

  const old = readJSON(STORE.oldPaper, null);

  if (!old) return defaultPaperAccount();

  const migrated = {
    ...old,
    positions: (old.positions || []).map(position => ({
      ...position,
      stopLoss: null,
      takeProfit: null,
      trailingPercent: 0,
      trailingStop: null,
      highestPrice: position.entry,
      lowestPrice: position.entry,
      protectionSet: false,
      riskAmount: null
    })),
    history: old.history || [],
    dayKey: new Date().toDateString(),
    dayStartEquity: Number(old.balance) || STARTING_BALANCE
  };

  saveJSON(STORE.paper, migrated);
  return migrated;
}

function getPaperAccount() {
  return migratePaperAccount();
}

function savePaperAccount(account) {
  saveJSON(STORE.paper, account);
  renderPaperAccount();
}

function defaultRiskSettings() {
  return {
    balance: STARTING_BALANCE,
    riskPercent: 1,
    dailyLossLimit: 3
  };
}

function getRiskSettings() {
  const current = readJSON(STORE.risk, null);

  if (current) return current;

  const old = readJSON(STORE.oldRisk, null);

  if (old) {
    saveJSON(STORE.risk, old);
    return old;
  }

  return defaultRiskSettings();
}

function currentDayKey() {
  return new Date().toDateString();
}

function positionGross(position, price) {
  const direction = position.side === "LONG" ? 1 : -1;

  return direction *
    (price - position.entry) /
    position.entry *
    position.amount;
}

function positionNetEstimate(position, price) {
  return positionGross(position, price) -
    (position.openingFee || 0) -
    position.amount * FEE_RATE;
}

function accountEquity(account, prices = lastMarketPrices) {
  let equity = account.balance;

  account.positions.forEach(position => {
    const price = Number(prices[position.symbol]) || position.entry;

    equity += position.amount +
      positionGross(position, price) -
      position.amount * FEE_RATE;
  });

  return equity;
}

function ensureDailySnapshot(account) {
  const today = currentDayKey();

  if (account.dayKey !== today) {
    account.dayKey = today;
    account.dayStartEquity = accountEquity(account);
    saveJSON(STORE.paper, account);
  }

  if (!Number.isFinite(account.dayStartEquity)) {
    account.dayStartEquity = accountEquity(account);
  }
}

function getDailyPnL(account) {
  const today = currentDayKey();

  const realizedToday = account.history
    .filter(trade =>
      new Date(trade.closedAt).toDateString() === today
    )
    .reduce((sum, trade) => sum + Number(trade.pnl || 0), 0);

  const unrealizedToday = account.positions
    .filter(position =>
      new Date(position.openedAt).toDateString() === today
    )
    .reduce((sum, position) => {
      const price =
        Number(lastMarketPrices[position.symbol]) || position.entry;

      return sum + positionNetEstimate(position, price);
    }, 0);

  return realizedToday + unrealizedToday;
}

function getDailyRealizedLoss(account) {
  const today = currentDayKey();

  return account.history
    .filter(trade =>
      new Date(trade.closedAt).toDateString() === today
    )
    .reduce((sum, trade) => sum + Math.min(0, Number(trade.pnl || 0)), 0);
}

/* =========================================================
   PAPER TRADING CONTROLS
========================================================= */

function injectPaperControls() {
  if ($("paperProtectionControls")) return;

  const amount = $("paperAmount");
  const status = $("paperStatus");

  const anchor = amount?.parentElement || status?.parentElement;

  if (!anchor) return;

  const wrapper = document.createElement("div");
  wrapper.id = "paperProtectionControls";
  wrapper.className = "result-card";

  wrapper.innerHTML = `
    <h3>V3.3 trade protection</h3>

    <label for="paperStopLoss">Stop-loss price (required)</label>
    <input id="paperStopLoss" type="number" min="0" step="any"
      placeholder="Enter stop-loss price">

    <label for="paperTakeProfit">Take-profit price (required)</label>
    <input id="paperTakeProfit" type="number" min="0" step="any"
      placeholder="Enter take-profit price">

    <label for="paperTrailingPercent">Trailing stop (%) — optional</label>
    <select id="paperTrailingPercent">
      <option value="0">Disabled</option>
      <option value="0.5">0.5%</option>
      <option value="1">1%</option>
      <option value="1.5">1.5%</option>
      <option value="2">2%</option>
      <option value="3">3%</option>
      <option value="5">5%</option>
    </select>

    <p class="muted-note">
      Position size is calculated from your account equity,
      selected risk percentage and stop-loss distance.
      The amount field remains the maximum notional size.
    </p>
  `;

  anchor.insertAdjacentElement("afterend", wrapper);
}

/* =========================================================
   PAPER RISK AND POSITION SIZING
========================================================= */

function calculatePositionSize(account, entry, stop, maxNotional, riskPercent) {
  const equity = accountEquity(account);

  const riskCash = equity * riskPercent / 100;
  const riskFraction = Math.abs(entry - stop) / entry;

  if (!riskFraction || !Number.isFinite(riskFraction)) {
    throw new Error("Invalid stop-loss distance.");
  }

  const riskBasedNotional = riskCash / riskFraction;

  const availableAfterFee =
    account.balance / (1 + FEE_RATE);

  const amount = Math.min(
    maxNotional,
    riskBasedNotional,
    availableAfterFee
  );

  if (!Number.isFinite(amount) || amount < 10) {
    throw new Error("Calculated position size is below 10 USDT.");
  }

  return {
    amount,
    riskCash,
    riskBasedNotional,
    equity
  };
}

function validateProtection(side, entry, stop, target) {
  if (
    !Number.isFinite(stop) ||
    !Number.isFinite(target) ||
    stop <= 0 ||
    target <= 0
  ) {
    throw new Error("Enter valid stop-loss and take-profit prices.");
  }

  if (side === "LONG" && !(stop < entry && target > entry)) {
    throw new Error(
      "For LONG: stop-loss must be below entry and take-profit above entry."
    );
  }

  if (side === "SHORT" && !(target < entry && stop > entry)) {
    throw new Error(
      "For SHORT: take-profit must be below entry and stop-loss above entry."
    );
  }
}

/* =========================================================
   PAPER TRADE OPEN
========================================================= */

async function openPaperTrade() {
  const symbol = $("paperSymbol").value;
  const side = $("paperSide").value;
  const maxAmount = Number($("paperAmount").value);

  const stop = Number($("paperStopLoss")?.value);
  const target = Number($("paperTakeProfit")?.value);
  const trailingPercent =
    Number($("paperTrailingPercent")?.value || 0);

  const account = getPaperAccount();
  const settings = getRiskSettings();

  if (!Number.isFinite(maxAmount) || maxAmount < 10) {
    toast("Enter a maximum notional amount of at least 10 USDT.");
    return;
  }

  if (account.positions.length >= 10) {
    toast("Maximum of 10 open simulated positions reached.");
    return;
  }

  try {
    ensureDailySnapshot(account);

    const price = await currentPrice(symbol);

    validateProtection(side, price, stop, target);

    const sizing = calculatePositionSize(
      account,
      price,
      stop,
      maxAmount,
      settings.riskPercent
    );

    const amount = sizing.amount;
    const openingFee = amount * FEE_RATE;

    const position = {
      id: String(Date.now()) + Math.random().toString(36).slice(2, 8),
      symbol,
      side,
      amount,
      entry: price,
      openedAt: Date.now(),
      openingFee,
      stopLoss: stop,
      originalStop: stop,
      takeProfit: target,
      trailingPercent,
      trailingStop: trailingPercent > 0
        ? side === "LONG"
          ? price * (1 - trailingPercent / 100)
          : price * (1 + trailingPercent / 100)
        : null,
      highestPrice: price,
      lowestPrice: price,
      protectionSet: true,
      riskAmount: sizing.riskCash,
      riskPercent: settings.riskPercent
    };

    const required = amount + openingFee;

    if (required > account.balance) {
      throw new Error("Insufficient virtual balance after estimated fee.");
    }

    account.balance -= required;
    account.positions.push(position);

    savePaperAccount(account);

    if ($("paperStatus")) {
      $("paperStatus").textContent =
        "Simulated " + side + " opened for " +
        symbol + " at " + money(price) +
        ". Estimated risk budget: " + money(sizing.riskCash) + ".";
    }

    toast("Protected simulated position opened.");

  } catch (error) {
    toast(error.message);
  }
}

/* =========================================================
   PAPER TRADE CLOSE
========================================================= */

async function closePaperTrade(id, exitOverride = null, reason = "MANUAL") {
  const account = getPaperAccount();

  const index = account.positions.findIndex(
    position => position.id === id
  );

  if (index < 0) return;

  const position = account.positions[index];

  try {
    const exit = Number.isFinite(exitOverride)
      ? exitOverride
      : await currentPrice(position.symbol);

    const gross = positionGross(position, exit);
    const closingFee = position.amount * FEE_RATE;

    const pnl =
      gross -
      (position.openingFee || 0) -
      closingFee;

    account.balance +=
      position.amount + gross - closingFee;

    account.realized += pnl;

    account.history.push({
      ...position,
      exit,
      pnl,
      closedAt: Date.now(),
      closingFee,
      exitReason: reason
    });

    account.positions.splice(index, 1);

    savePaperAccount(account);

    if ($("paperStatus")) {
      $("paperStatus").textContent =
        position.symbol + " " + position.side +
        " closed at " + money(exit) +
        ". Reason: " + reason +
        ". Net P/L: " + money(pnl);
    }

    toast("Simulated position closed: " + reason);

  } catch (error) {
    toast(error.message);
  }
}

/* =========================================================
   PROTECTIVE STOP AND TARGET MONITOR
========================================================= */

async function monitorPaperPositions() {
  if (paperBusy) return;

  const account = getPaperAccount();
  if (!account.positions.length) return;

  paperBusy = true;

  try {
    const symbols = [...new Set(
      account.positions.map(p => p.symbol)
    )];

    const results = await Promise.allSettled(
      symbols.map(async symbol => ({
        symbol,
        price: await currentPrice(symbol)
      }))
    );

    const prices = {};

    results.forEach(result => {
      if (result.status === "fulfilled") {
        prices[result.value.symbol] = result.value.price;
        lastMarketPrices[result.value.symbol] = result.value.price;
      }
    });

    for (const position of [...account.positions]) {
      const price = prices[position.symbol];
      if (!Number.isFinite(price)) continue;

      position.highestPrice = Math.max(
        Number(position.highestPrice || position.entry),
        price
      );

      position.lowestPrice = Math.min(
        Number(position.lowestPrice || position.entry),
        price
      );

      if (position.protectionSet && position.trailingPercent > 0) {
        const fraction = position.trailingPercent / 100;

        if (position.side === "LONG") {
          const candidate = price * (1 - fraction);

          position.trailingStop = Math.max(
            Number(position.trailingStop || 0),
            candidate
          );
        } else {
          const candidate = price * (1 + fraction);

          position.trailingStop = Math.min(
            Number(position.trailingStop || Infinity),
            candidate
          );
        }
      }

      if (!position.protectionSet) continue;

      let effectiveStop = Number(position.stopLoss);

      if (Number.isFinite(position.trailingStop)) {
        effectiveStop = position.side === "LONG"
          ? Math.max(effectiveStop, position.trailingStop)
          : Math.min(effectiveStop, position.trailingStop);
      }

      let reason = null;

      if (
        position.side === "LONG" &&
        price <= effectiveStop
      ) reason = position.trailingStop > position.originalStop
        ? "TRAILING STOP"
        : "STOP LOSS";

      if (
        position.side === "SHORT" &&
        price >= effectiveStop
      ) reason = position.trailingStop < position.originalStop
        ? "TRAILING STOP"
        : "STOP LOSS";

      if (
        position.side === "LONG" &&
        price >= position.takeProfit
      ) reason = "TAKE PROFIT";

      if (
        position.side === "SHORT" &&
        price <= position.takeProfit
      ) reason = "TAKE PROFIT";

      if (reason) {
        await closePaperTrade(position.id, price, reason);
      }
    }

    saveJSON(STORE.paper, account);
    renderPaperAccount();

  } catch (error) {
    console.warn("Paper position monitor:", error);
  } finally {
    paperBusy = false;
  }
}

/* =========================================================
   PAPER ACCOUNT DISPLAY
========================================================= */

function renderPaperAccount() {
  const account = getPaperAccount();

  ensureDailySnapshot(account);

  const prices = lastMarketPrices;

  let unrealized = 0;

  account.positions.forEach(position => {
    const price = Number(prices[position.symbol]) || position.entry;
    unrealized += positionGross(position, price);
  });

  const equity = accountEquity(account, prices);

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
        <p>Estimated account equity: <b>${money(equity)}</b></p>
        <p>Unrealized gross P/L: <b>${money(unrealized)}</b></p>
        <table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Side</th>
              <th>Entry</th>
              <th>Current</th>
              <th>Stop</th>
              <th>Target</th>
              <th>Net estimate</th>
              <th>Protection</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${account.positions.map(position => {
              const price =
                Number(prices[position.symbol]) || position.entry;

              const pnl = positionNetEstimate(position, price);

              const effectiveStop = position.trailingStop
                ? position.side === "LONG"
                  ? Math.max(position.stopLoss || 0, position.trailingStop)
                  : Math.min(position.stopLoss || Infinity, position.trailingStop)
                : position.stopLoss;

              return `
                <tr>
                  <td>${esc(position.symbol)}</td>
                  <td>${esc(position.side)}</td>
                  <td>${money(position.entry)}</td>
                  <td>${money(price)}</td>
                  <td>${position.protectionSet ? money(effectiveStop) : "Not set"}</td>
                  <td>${position.protectionSet ? money(position.takeProfit) : "Not set"}</td>
                  <td class="${pnl >= 0 ? "positive" : "negative"}">${money(pnl)}</td>
                  <td>${position.protectionSet ? "Active while page runs" : "Unprotected"}</td>
                  <td>
                    <button class="outline" data-close-paper="${esc(position.id)}">
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
              <th>Reason</th>
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
                <td class="${trade.pnl >= 0 ? "positive" : "negative"}">${money(trade.pnl)}</td>
                <td>${esc(trade.exitReason || "MANUAL")}</td>
                <td>${esc(new Date(trade.closedAt).toLocaleString())}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `
      : '<p class="muted-note">No simulated trades yet.</p>';
