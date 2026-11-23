"use strict";

/* =========================================
   AGU CRYPTO ANALYZER
   Owner: Umar Mohammed
   Technical Engine Version 2.0
========================================= */

const API = {
  spot: "https://data-api.binance.vision/api/v3",
  futures: "https://fapi.binance.com/fapi/v1"
};

const ASSETS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT",
  "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT",
  "LINKUSDT", "TONUSDT"
];

const TIMEFRAMES = {
  "30s": { custom: true, seconds: 30 },
  "1m":  { native: "1m" },
  "5m":  { native: "5m" },
  "10m": { custom: true, base: "5m", factor: 2 },
  "15m": { native: "15m" },
  "30m": { native: "30m" },
  "1h":  { native: "1h" },
  "4h":  { native: "4h" },
  "1d":  { native: "1d" },
  "1w":  { native: "1w" }
};

const $ = id => document.getElementById(id);

let monitoring = false;
let monitorTimer = null;
let lastAlert = {};
let alertBusy = false;

const INTERVAL_MS = {
  "30s": 30000,
  "1m": 60000,
  "5m": 300000,
  "10m": 600000,
  "15m": 900000,
  "30m": 1800000,
  "1h": 3600000,
  "4h": 14400000,
  "1d": 86400000,
  "1w": 604800000
};

/* =========================================
   GENERAL HELPERS
========================================= */

function money(value) {
  if (!Number.isFinite(value)) return "N/A";

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: value >= 1000 ? 2 : 8
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
  const timeout = setTimeout(() => controller.abort(), 20000);

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

function makeURL(base, path, params = {}) {
  const query = new URLSearchParams(params).toString();
  return base + path + (query ? "?" + query : "");
}

function setConnection(online, message) {
  const box = $("connection");
  if (!box) return;

  box.textContent = online ? "● Online" : "● Offline";
  box.className = online ? "pill green" : "pill muted";

  if (message) box.title = message;
}

async function marketRequest(marketType, path, params = {}) {
  const base = marketType === "futures"
    ? API.futures
    : API.spot;

  return request(makeURL(base, path, params));
}

/* =========================================
   LIVE MARKET WATCH
========================================= */

async function loadMarkets() {
  const grid = $("marketGrid");
  if (!grid) return;

  try {
    const data = await request(
      makeURL(API.spot, "/ticker/24hr")
    );

    const selected = data
      .filter(item => ASSETS.includes(item.symbol))
      .sort((a, b) =>
        ASSETS.indexOf(a.symbol) -
        ASSETS.indexOf(b.symbol)
      );

    if (!selected.length) {
      throw new Error("No matching market symbols.");
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

    setConnection(true, "Live market data connected.");

  } catch (error) {
    console.error("Market error:", error);

    const cached = localStorage.getItem("agu_market_cache");

    grid.innerHTML = cached
      ? cached + '<p class="muted-note">Cached data — not live prices.</p>'
      : '<p class="muted-note">Market connection failed: ' +
        error.message + '</p>';

    setConnection(false, error.message);
  }
}

/* =========================================
   CANDLE CONVERSION
========================================= */

function convertKlines(raw) {
  return raw.map(c => ({
    time: Number(c[0]),
    open: Number(c[1]),
    high: Number(c[2]),
    low: Number(c[3]),
    close: Number(c[4]),
    volume: Number(c[5])
  }));
}

/* =========================================
   CUSTOM 10-MINUTE CANDLES
========================================= */

function aggregateCandles(candles, intervalMs) {
  const groups = new Map();

  for (const candle of candles) {
    const bucket =
      Math.floor(candle.time / intervalMs) * intervalMs;

    if (!groups.has(bucket)) {
      groups.set(bucket, {
        time: bucket,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume
      });
    } else {
      const group = groups.get(bucket);

      group.high = Math.max(group.high, candle.high);
      group.low = Math.min(group.low, candle.low);
      group.close = candle.close;
      group.volume += candle.volume;
    }
  }

  return Array.from(groups.values())
    .sort((a, b) => a.time - b.time);
}

/* =========================================
   CUSTOM 30-SECOND CANDLES
   Built from Binance aggregate trades.
========================================= */

async function getThirtySecondCandles(symbol, marketType) {
  const now = Date.now();

  // Request approximately 100 minutes of trade history.
  const startTime = now - (200 * 30000) - 30000;

  let trades = [];
  let nextStart = startTime;

  for (let page = 0; page < 100; page++) {
    const batch = await marketRequest(
      marketType,
      "/aggTrades",
      {
        symbol,
        startTime: String(nextStart),
        endTime: String(now),
        limit: "1000"
      }
    );

    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }

    trades.push(...batch);

    const lastTrade = batch[batch.length - 1];
    const lastTime = Number(lastTrade.T);

    if (lastTime >= now - 30000) {
      break;
    }

    if (batch.length < 1000) {
      break;
    }

    nextStart = lastTime + 1;
  }

  if (!trades.length) {
    throw new Error("No trade data received for 30-second candles.");
  }

  const groups = new Map();

  for (const trade of trades) {
    const time = Number(trade.T);
    const bucket = Math.floor(time / 30000) * 30000;
    const price = Number(trade.p);
    const volume = Number(trade.q);

    if (!groups.has(bucket)) {
      groups.set(bucket, {
        time: bucket,
        open: price,
        high: price,
        low: price,
        close: price,
        volume
      });
    } else {
      const candle = groups.get(bucket);

      candle.high = Math.max(candle.high, price);
      candle.low = Math.min(candle.low, price);
      candle.close = price;
      candle.volume += volume;
    }
  }

  return Array.from(groups.values())
    .sort((a, b) => a.time - b.time)
    .slice(-200);
}

/* =========================================
   FETCH ALL SUPPORTED TIMEFRAMES
========================================= */

async function getCandles(symbol, interval, marketType) {
  const config = TIMEFRAMES[interval];

  if (!config) {
    throw new Error("Unsupported timeframe: " + interval);
  }

  let candles;

  if (interval === "30s") {
    candles = await getThirtySecondCandles(
      symbol,
      marketType
    );

  } else if (interval === "10m") {
    const raw = await marketRequest(
      marketType,
      "/klines",
      {
        symbol,
        interval: "5m",
        limit: "500"
      }
    );

    candles = aggregateCandles(
      convertKlines(raw),
      600000
    ).slice(-200);

  } else {
    const raw = await marketRequest(
      marketType,
      "/klines",
      {
        symbol,
        interval: config.native,
        limit: "200"
      }
    );

    candles = convertKlines(raw);
  }

const minimumCandles = interval === "30s" ? 30 : 50;

if (!Array.isArray(candles) || candles.length < minimumCandles) {
  throw new Error(
    "Insufficient historical candles for " + interval +
    ". Required " + minimumCandles +
    ", received " + (candles?.length || 0) + "."
  );
}

/* =========================================
   TECHNICAL INDICATORS
========================================= */

function sma(values, period) {
  if (values.length < period) return null;

  const recent = values.slice(-period);

  return recent.reduce((a, b) => a + b, 0) / period;
}

function ema(values, period) {
  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);

  let result = values
    .slice(0, period)
    .reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < values.length; i++) {
    result = (values[i] - result) * multiplier + result;
  }

  return result;
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

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];

    avgGain =
      (avgGain * (period - 1) + Math.max(change, 0)) / period;

    avgLoss =
      (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
  }

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;

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
    const c = candles[i];
    const p = candles[i - 1];

    ranges.push(Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close)
    ));
  }

  return sma(ranges, period);
}

/* =========================================
   BOLLINGER BANDS
========================================= */

function calculateBollinger(values, period = 20) {
  if (values.length < period) return null;

  const recent = values.slice(-period);
  const middle = sma(recent, period);

  const variance = recent.reduce(
    (sum, value) => sum + Math.pow(value - middle, 2),
    0
  ) / period;

  const deviation = Math.sqrt(variance);

  return {
    upper: middle + deviation * 2,
    middle,
    lower: middle - deviation * 2
  };
}

/* =========================================
   ADX TREND STRENGTH
========================================= */

function calculateADX(candles, period = 14) {
  if (candles.length < period * 2 + 1) return null;

  const trs = [];
  const plusDM = [];
  const minusDM = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    const up = current.high - previous.high;
    const down = previous.low - current.low;

    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);

    trs.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    ));
  }

  const dx = [];

  for (let i = period; i < trs.length; i++) {
    const tr = sma(trs.slice(i - period, i), period);
    const plus = sma(plusDM.slice(i - period, i), period);
    const minus = sma(minusDM.slice(i - period, i), period);

    if (!tr || tr === 0) continue;

    const plusDI = 100 * plus / tr;
    const minusDI = 100 * minus / tr;

    const denominator = plusDI + minusDI;

    dx.push(
      denominator === 0
        ? 0
        : 100 * Math.abs(plusDI - minusDI) / denominator
    );
  }

  return sma(dx, period);
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
   FIBONACCI RETRACEMENT
========================================= */

function calculateFibonacci(candles) {
  const recent = candles.slice(-100);

  const high = Math.max(...recent.map(c => c.high));
  const low = Math.min(...recent.map(c => c.low));

  const difference = high - low;

  return {
    level236: high - difference * 0.236,
    level382: high - difference * 0.382,
    level500: high - difference * 0.5,
    level618: high - difference * 0.618,
    level786: high - difference * 0.786
  };
}

/* =========================================
   CANDLESTICK PATTERNS
========================================= */

function detectPattern(candles) {
  const current = candles[candles.length - 1];
  const previous = candles[candles.length - 2];

  const body = Math.abs(current.close - current.open);
  const range = current.high - current.low;

  if (range <= 0) return "No clear pattern";

  const upperWick =
    current.high - Math.max(current.open, current.close);

  const lowerWick =
    Math.min(current.open, current.close) - current.low;

  if (
    previous.close < previous.open &&
    current.close > current.open &&
    current.close > previous.open &&
    current.open < previous.close
  ) {
    return "Bullish engulfing";
  }

  if (
    previous.close > previous.open &&
    current.close < current.open &&
    current.close < previous.open &&
    current.open > previous.close
  ) {
    return "Bearish engulfing";
  }

  if (body / range < 0.1) return "Doji";

  if (lowerWick > body * 2 && upperWick < body) {
    return "Hammer-like candle";
  }

  if (upperWick > body * 2 && lowerWick < body) {
    return "Shooting-star-like candle";
  }

  return "No clear pattern";
}

/* =========================================
   VOLUME ANALYSIS
========================================= */

function analyzeVolume(candles) {
  if (candles.length < 21) return null;

  const volumes = candles.map(c => c.volume);
  const average = sma(volumes.slice(0, -1), 20);
  const latest = volumes[volumes.length - 1];

  return {
    current: latest,
    average,
    ratio: average > 0 ? latest / average : null
  };
}

/* =========================================
   MAIN ANALYSIS ENGINE
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
  const adx = calculateADX(candles);
  const bollinger = calculateBollinger(closes);
  const fibonacci = calculateFibonacci(candles);
  const volume = analyzeVolume(candles);

  const levels = findLevels(candles);
  const pattern = detectPattern(candles);

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
    else if (rsi < 50 && rsi > 30) bearish++;
  }

  if (macd !== null) {
    if (macd > 0) bullish++;
    else if (macd < 0) bearish++;
  }

  if (ema20 !== null) {
    if (price > ema20) bullish++;
    else bearish++;
  }

  if (pattern === "Bullish engulfing") bullish++;
  if (pattern === "Bearish engulfing") bearish++;

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
    adx,
    bollinger,
    fibonacci,
    volume,
    pattern,
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
    return `
      <div class="metric">
        <span>${title}</span>
        <strong>${value}</strong>
      </div>
    `;
  }

  const bb = result.bollinger;
  const fib = result.fibonacci;
  const vol = result.volume;

  box.className = "analysis-result";

  box.innerHTML = `
    <div class="signal-banner">
      <p class="eyebrow">
        ${symbol} · ${interval} · ${marketType.toUpperCase()}
      </p>

      <h3 class="${signalClass}">${result.signal}</h3>

      <p>Reference price: $${money(result.price)}</p>

      <p class="muted-note">
        Bullish factors: ${result.bullish} |
        Bearish factors: ${result.bearish}
      </p>
    </div>

    <h3>Momentum and trend</h3>

    <div class="metrics">
      ${metric("RSI (14)", result.rsi?.toFixed(2) ?? "N/A")}
      ${metric("EMA 20", money(result.ema20))}
      ${metric("EMA 50", money(result.ema50))}
      ${metric("EMA 200", money(result.ema200))}
      ${metric("MACD", money(result.macd))}
      ${metric("ADX (14)", money(result.adx))}
      ${metric("ATR (14)", money(result.atr))}
      ${metric("Candlestick", result.pattern)}
    </div>

    <h3>Volatility and volume</h3>

    <div class="metrics">
      ${metric("Bollinger upper", money(bb?.upper))}
      ${metric("Bollinger middle", money(bb?.middle))}
      ${metric("Bollinger lower", money(bb?.lower))}
      ${metric("Current volume", money(vol?.current))}
      ${metric("Average volume", money(vol?.average))}
      ${metric("Volume ratio", vol?.ratio?.toFixed(2) ?? "N/A")}
    </div>

    <h3>Market structure</h3>

    <div class="metrics">
      ${metric("Support", "$" + money(result.support))}
      ${metric("Resistance", "$" + money(result.resistance))}
      ${metric("Fib 23.6%", money(fib?.level236))}
      ${metric("Fib 38.2%", money(fib?.level382))}
      ${metric("Fib 50%", money(fib?.level500))}
      ${metric("Fib 61.8%", money(fib?.level618))}
      ${metric("Fib 78.6%", money(fib?.level786))}
    </div>

    <h3>Trade planning references</h3>

    <div class="metrics">
      ${metric("Entry reference", "$" + money(result.price))}
      ${metric("Stop loss", "$" + money(result.stopLoss))}
      ${metric("Take profit 1", "$" + money(result.takeProfit1))}
      ${metric("Take profit 2", "$" + money(result.takeProfit2))}
      ${metric("Take profit 3", "$" + money(result.takeProfit3))}
    </div>

    <p class="disclaimer">
      Technical indicators are estimates, not guaranteed predictions.
      Trade levels are illustrative ATR-based references.
      Backtesting and independent risk management are essential.
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
  const credits = $("credits");
  if (credits) credits.textContent = getCredits() + " / 4";
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

  const button = $("analyzeBtn");

  if (!isAlert && button) {
    button.disabled = true;
    button.textContent = "Analyzing…";
  }

  try {
    const candles = await getCandles(
      symbol,
      interval,
      marketType
    );

    const result = analyzeCandles(candles);

    if (!isAlert) {
      const remaining = Math.max(0, getCredits() - 1);

      localStorage.setItem("agu_free_credits", remaining);

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

  } finally {
    if (!isAlert && button) {
      button.disabled = false;
      button.textContent = "Analyze market";
    }
  }
}

/* =========================================
   SOUND AND NOTIFICATIONS
========================================= */

function playAlertSound() {
  try {
    const AudioContext =
      window.AudioContext || window.webkitAudioContext;

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

  if (!log) return;

  if (log.querySelector(".muted-note")) {
    log.innerHTML = "";
  }

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

  } catch (error) {
    console.error("Monitoring error:", error);

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

window.addEventListener("online", loadMarkets);

window.addEventListener("offline", () => {
  setConnection(false, "Browser reports no internet connection.");
});

/* =========================================
   INITIALIZATION
========================================= */

document.addEventListener("DOMContentLoaded", () => {
  const year = $("year");

  if (year) {
    year.textContent = new Date().getFullYear();
  }

  updateCredits();

  loadMarkets();

  $("refreshBtn").addEventListener("click", loadMarkets);

  $("analyzeBtn").addEventListener("click", () => {
    runAnalysis(false);
  });

  $("notifyBtn").addEventListener("click", enableNotifications);

  $("monitorBtn").addEventListener("click", startMonitoring);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js")
      .catch(error => {
        console.warn("Service worker failed:", error);
      });
  }

  setInterval(loadMarkets, 60000);
});
