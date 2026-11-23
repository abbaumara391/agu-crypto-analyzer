"use strict";

/* =========================================================
   AGU CRYPTO ANALYZER V3.3
   Owner: Umar Mohammed

   MARKET DATA:
   Binance public market endpoints.

   SECURITY:
   - No exchange API secrets.
   - No real order execution.
   - No payment processing.
   - No live trading.
   - Paper trading is browser-side simulation.
   - Existing V3.2 paper accounts are migrated.
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

let busyAnalysis = false;
let managingPaper = false;

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
        ? "☀ White Mode"
        : "🌙 Dark Mode";
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
      lastMarketPrices[item.symbol] =
        Number(item.lastPrice);
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
      cached.forEach(item => {
        lastMarketPrices[item.symbol] =
          Number(item.lastPrice);
      });

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

/* =========================================================
   ANALYSIS DISPLAY
========================================================= */

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
    container.innerHTML = `
      <div class="metric">
        <span>Higher timeframe</span>
        <strong>Not available for weekly analysis</strong>
      </div>
    `;

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

  const entry =
    side === "LONG"
      ? rawEntry * (1 + slippageRate)
      : rawEntry * (1 - slippageRate);

  const stop = analysis.stop;
  const target = analysis.target1;

  if (
    !Number.isFinite(stop) ||
    !Number.isFinite(target)
  ) {
    return null;
  }

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
  const wins = trades.filter(
    t => t.netReturn > 0
  );

  const losses = trades.filter(
    t => t.netReturn <= 0
  );

  const winRate = trades.length
    ? wins.length / trades.length * 100
    : 0;

  const grossProfit = wins.reduce(
    (sum, t) => sum + t.netReturn,
    0
  );

  const grossLoss = Math.abs(
    losses.reduce(
      (sum, t) => sum + t.netReturn,
      0
    )
  );

  const profitFactor =
    grossLoss > 0
      ? grossProfit / grossLoss
      : grossProfit > 0
        ? Infinity
        : 0;

  const averageWin = wins.length
    ? grossProfit / wins.length
    : 0;

  const averageLoss = losses.length
    ? grossLoss / losses.length
    : 0;

  const expectancy = trades.length
    ? trades.reduce(
        (sum, t) => sum + t.netReturn,
        0
      ) / trades.length
    : 0;

  let equity = 10000;
  let peak = equity;
  let maxDrawdown = 0;

  let maximumWinningStreak = 0;
  let maximumLosingStreak = 0;

  let winningStreak = 0;
  let losingStreak = 0;

  trades.forEach(trade => {
    equity *= 1 + trade.netReturn;

    peak = Math.max(peak, equity);

    const drawdown =
      peak > 0
        ? (peak - equity) / peak * 100
        : 0;

    maxDrawdown = Math.max(
      maxDrawdown,
      drawdown
    );

    if (trade.netReturn > 0) {
      winningStreak++;
      losingStreak = 0;

    } else {
      losingStreak++;
      winningStreak = 0;
    }

    maximumWinningStreak = Math.max(
      maximumWinningStreak,
      winningStreak
    );

    maximumLosingStreak = Math.max(
      maximumLosingStreak,
      losingStreak
    );
  });

  return {
    totalTrades: trades.length,

    wins: wins.length,
    losses: losses.length,

    winRate,

    grossProfit,
    grossLoss,

    profitFactor,

    averageWin,
    averageLoss,

    expectancy,

    equity,

    totalReturn:
      (equity - 10000) / 10000 * 100,

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

  output.innerHTML = `
    <div class="loading">
      Downloading historical candles
      and testing strategy…
    </div>
  `;

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
            <span>Win rate</span>
            <strong>${number(stats.winRate)}%</strong>
          </div>

          <div class="result-stat">
            <span>Profit factor</span>
            <strong>
              ${Number.isFinite(stats.profitFactor)
                ? number(stats.profitFactor)
                : "∞"}
            </strong>
          </div>

          <div class="result-stat">
            <span>Expectancy per trade</span>
            <strong>${number(stats.expectancy * 100)}%</strong>
          </div>

          <div class="result-stat">
            <span>Average winning return</span>
            <strong>${number(stats.averageWin * 100)}%</strong>
          </div>

          <div class="result-stat">
            <span>Average losing return</span>
            <strong>${number(stats.averageLoss * 100)}%</strong>
          </div>

          <div class="result-stat">
            <span>Final simulated equity</span>
            <strong>${money(stats.equity)}</strong>
          </div>

          <div class="result-stat">
            <span>Net return</span>
           
