"use strict";

/* AGU CRYPTO ANALYZER — V3 RELIABILITY ENGINE
   Owner: Umar Mohammed | Spot + USDT-M Futures | No auto-trading
*/

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
  "1m": { native: "1m", ms: 60000 },
  "5m": { native: "5m", ms: 300000 },
  "10m": { base: "5m", ms: 600000 },
  "15m": { native: "15m", ms: 900000 },
  "30m": { native: "30m", ms: 1800000 },
  "1h": { native: "1h", ms: 3600000 },
  "4h": { native: "4h", ms: 14400000 },
  "1d": { native: "1d", ms: 86400000 },
  "1w": { native: "1w", ms: 604800000 }
};

const $ = id => document.getElementById(id);

const CREDIT = "agu_free_credits";
const MC = "agu_market_cache_v3";
const MT = "agu_market_cache_time_v3";
const AK = "agu_alert_state_v3";
const LK = "agu_alert_log_v3";

let monitoring = false;
let monitorTimer = null;
let alertBusy = false;
let lastAlert = readJSON(AK, {});


/* =========================================
   GENERAL HELPERS
========================================= */

function readJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch (_) {
    return fallback;
  }
}

function money(value) {
  if (!Number.isFinite(Number(value))) return "N/A";

  const number = Number(value);

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: number >= 1000 ? 2 : 8
  }).format(number);
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

function toast(message) {
  const element = $("toast");

  if (!element) return;

  element.textContent = message;
  element.classList.add("show");

  setTimeout(() => {
    element.classList.remove("show");
  }, 4000);
}

function makeURL(base, path, params = {}) {
  const query = new URLSearchParams(params).toString();

  return base + path + (query ? "?" + query : "");
}

async function request(url) {
  if (!navigator.onLine) {
    throw new Error("Device is offline.");
  }

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 20000);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error("Market API HTTP " + response.status);
    }

    return await response.json();

  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Market request timed out.");
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
}

function setConnection(status, message) {
  const element = $("connection");

  if (!element) return;

  element.textContent =
    status === "live"
      ? "● Live"
      : status === "cached"
        ? "● Cached"
        : "● Offline";

  element.className =
    status === "live"
      ? "pill green"
      : "pill muted";

  element.title = message || "";
}

function marketBase(market) {
  return market === "futures"
    ? API.futures
    : API.spot;
}

async function marketRequest(market, path, params = {}) {
  return request(
    makeURL(marketBase(market), path, params)
  );
}


/* =========================================
   LIVE MARKET WATCH
========================================= */

function renderMarketCards(items, cachedAt = null) {
  const grid = $("marketGrid");

  if (!grid) return;

  const html = items.map(item => {
    const change = Number(item.priceChangePercent);
    const positive = change >= 0;

    return `
      <article class="market-card">
        <div class="coin">
          ${escapeHTML(item.symbol.replace("USDT", ""))}
        </div>

        <span class="price">
          $${money(Number(item.lastPrice))}
        </span>

        <span class="${positive ? "positive" : "negative"}">
          ${positive ? "+" : ""}${change.toFixed(2)}%
        </span>

        <div class="muted-note">
          24-hour change
        </div>
      </article>
    `;
  }).join("");

  const cacheMessage = cachedAt
    ? `<p class="muted-note">
         Cached snapshot: ${new Date(cachedAt).toLocaleString()}
         — NOT live prices.
       </p>`
    : "";

  grid.innerHTML = html + cacheMessage;
}

async function loadMarkets() {
  const grid = $("marketGrid");

  if (!grid) return;

  try {
    const data = await request(
      makeURL(API.spot, "/ticker/24hr")
    );

    if (!Array.isArray(data)) {
      throw new Error("Unexpected API response.");
    }

    const selected = data
      .filter(item => ASSETS.includes(item.symbol))
      .sort((a, b) =>
        ASSETS.indexOf(a.symbol) -
        ASSETS.indexOf(b.symbol)
      );

    if (selected.length !== ASSETS.length) {
      throw new Error("Incomplete market response.");
    }

    renderMarketCards(selected);

    localStorage.setItem(
      MC,
      JSON.stringify(selected)
    );

    localStorage.setItem(
      MT,
      String(Date.now())
    );

    setConnection(
      "live",
      "Live prices received " + new Date().toLocaleString()
    );

  } catch (error) {
    console.warn(error);

    const cached = readJSON(MC, null);

    const cachedAt =
      Number(localStorage.getItem(MT)) || null;

    if (cached?.length) {
      renderMarketCards(cached, cachedAt);

      setConnection(
        "cached",
        "Cached only; age " +
        (cachedAt
          ? Math.round((Date.now() - cachedAt) / 60000) + " minutes"
          : "unknown") +
        ". " + error.message
      );

    } else {
      grid.innerHTML =
        `<p class="muted-note">
          Market data unavailable: ${escapeHTML(error.message)}
        </p>`;

      setConnection("offline", error.message);
    }
  }
}


/* =========================================
   CANDLE DATA
========================================= */

function convertKlines(raw) {
  if (!Array.isArray(raw)) {
    throw new Error("Invalid candle response.");
  }

  return raw.map(candle => ({
    time: Number(candle[0]),
    open: Number(candle[1]),
    high: Number(candle[2]),
    low: Number(candle[3]),
    close: Number(candle[4]),
    volume: Number(candle[5]),
    closeTime: Number(candle[6])
  })).filter(candle =>
    Object.values(candle).every(Number.isFinite) &&
    candle.high >= candle.low
  );
}

function aggregateCandles(candles, intervalMs) {
  const groups = new Map();

  for (const candle of candles) {
    const bucket =
      Math.floor(candle.time / intervalMs) * intervalMs;

    let group = groups.get(bucket);

    if (!group) {
      groups.set(bucket, {
        time: bucket,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        closeTime: bucket + intervalMs - 1
      });

    } else {
      group.high = Math.max(group.high, candle.high);
      group.low = Math.min(group.low, candle.low);
      group.close = candle.close;
      group.volume += candle.volume;
    }
  }

  return Array.from(groups.values())
    .sort((a, b) => a.time - b.time);
}

async function getCandles(symbol, interval, market) {
  const config = TF[interval];

  if (!config) {
    throw new Error("Unsupported timeframe: " + interval);
  }

  const raw = await marketRequest(
    market,
    "/klines",
    {
      symbol,
      interval: config.native || config.base,
      limit: "500"
    }
  );

  let candles = convertKlines(raw);

  if (config.base) {
    candles = aggregateCandles(
      candles,
      config.ms
    );
  }

  const now = Date.now();

  // Exclude unfinished candles.
  candles = candles.filter(
    candle => candle.closeTime < now
  );

  candles = candles.slice(-400);

  const minimum =
    interval === "1w" ? 200 : 220;

  if (candles.length < minimum) {
    throw new Error(
      `Insufficient completed candles for ${interval}: ` +
      `${candles.length}; need ${minimum}.`
    );
  }

  const last = candles[candles.length - 1];

  const age = now - last.closeTime;

  if (age > config.ms * 2.2) {
    throw new Error(
      "Latest completed candle is stale; analysis stopped."
    );
  }

  return {
    candles,
    lastCandleClose: last.closeTime,
    age
  };
}


/* =========================================
   TECHNICAL INDICATORS
========================================= */

function sma(values, period) {
  if (values.length < period) return null;

  return values
    .slice(-period)
    .reduce((a, b) => a + b, 0) / period;
}

function ema(values, period) {
  if (values.length < period) return null;

  let result = values
    .slice(0, period)
    .reduce((a, b) => a + b, 0) / period;

  const multiplier = 2 / (period + 1);

  for (let i = period; i < values.length; i++) {
    result += (values[i] - result) * multiplier;
  }

  return result;
}

function calculateRSI(values, period = 14) {
  if (values.length <= period) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];

    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
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

  if (averageLoss === 0) {
    return averageGain === 0 ? 50 : 100;
  }

  const rs = averageGain / averageLoss;

  return 100 - 100 / (1 + rs);
}

function calculateMACD(values) {
  const series = [];

  for (let i = 26; i <= values.length; i++) {
    const part = values.slice(0, i);

    series.push(
      ema(part, 12) - ema(part, 26)
    );
  }

  if (series.length < 9) return null;

  const line = series[series.length - 1];
  const signal = ema(series, 9);

  return {
    line,
    signal,
    histogram: line - signal
  };
}

function calculateATR(candles, period = 14) {
  const trueRanges = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    trueRanges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    ));
  }

  if (trueRanges.length < period) return null;

  let value =
    trueRanges.slice(0, period)
      .reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < trueRanges.length; i++) {
    value =
      (value * (period - 1) + trueRanges[i]) / period;
  }

  return value;
}

function calculateADX(candles, period = 14) {
  if (candles.length < period * 2 + 2) {
    return null;
  }

  const trueRanges = [];
  const plusDM = [];
  const minusDM = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    const up = current.high - previous.high;
    const down = previous.low - current.low;

    plusDM.push(
      up > down && up > 0 ? up : 0
    );

    minusDM.push(
      down > up && down > 0 ? down : 0
    );

    trueRanges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    ));
  }

  let trSmooth = trueRanges
    .slice(0, period)
    .reduce((a, b) => a + b, 0);

  let plusSmooth = plusDM
    .slice(0, period)
    .reduce((a, b) => a + b, 0);

  let minusSmooth = minusDM
    .slice(0, period)
    .reduce((a, b) => a + b, 0);

  const dx = [];

  for (let i = period; i < trueRanges.length; i++) {
    if (i > period) {
      trSmooth =
        trSmooth - trSmooth / period + trueRanges[i];

      plusSmooth =
        plusSmooth - plusSmooth / period + plusDM[i];

      minusSmooth =
        minusSmooth - minusSmooth / period + minusDM[i];
    }

    if (trSmooth <= 0) continue;

    const plusDI = 100 * plusSmooth / trSmooth;
    const minusDI = 100 * minusSmooth / trSmooth;

    const sum = plusDI + minusDI;

    dx.push(
      sum === 0
        ? 0
        : 100 * Math.abs(plusDI - minusDI) / sum
    );
  }

  if (dx.length < period) return null;

  let adx = dx
    .slice(0, period)
    .reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < dx.length; i++) {
    adx =
      (adx * (period - 1) + dx[i]) / period;
  }

  return adx;
}

function calculateBollinger(values, period = 20) {
  if (values.length < period) return null;

  const middle = sma(values, period);

  const variance = values
    .slice(-period)
    .reduce(
      (sum, value) => sum + Math.pow(value - middle, 2),
      0
    ) / period;

  const deviation = Math.sqrt(variance);

  return {
    upper: middle + 2 * deviation,
    middle,
    lower: middle - 2 * deviation
  };
}


/* =========================================
   MARKET STRUCTURE AND FIBONACCI
========================================= */

function findLevels(candles) {
  const recent = candles.slice(-100);

  const support = Math.min(
    ...recent.map(c => c.low)
  );

  const resistance = Math.max(
    ...recent.map(c => c.high)
  );

  const range = resistance - support;

  return {
    support,
    resistance,

    fibonacci: range > 0
      ? {
          level236: resistance - range * 0.236,
          level382: resistance - range * 0.382,
          level500: resistance - range * 0.5,
          level618: resistance - range * 0.618,
          level786: resistance - range * 0.786
        }
      : null
  };
}


/* =========================================
   CANDLESTICK PATTERNS
========================================= */

function detectPattern(candles) {
  const current = candles[candles.length - 1];
  const previous = candles[candles.length - 2];

  const body = Math.abs(
    current.close - current.open
  );

  const range = current.high - current.low;

  if (range <= 0) {
    return "No clear pattern";
  }

  const upperWick =
    current.high - Math.max(current.open, current.close);

  const lowerWick =
    Math.min(current.open, current.close) - current.low;

  if (
    previous.close < previous.open &&
    current.close > current.open &&
    current.close >= previous.open &&
    current.open <= previous.close
  ) {
    return "Bullish engulfing";
  }

  if (
    previous.close > previous.open &&
    current.close < current.open &&
    current.close <= previous.open &&
    current.open >= previous.close
  ) {
    return "Bearish engulfing";
  }

  if (body / range < 0.1) {
    return "Doji";
  }

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
  const volumes = candles.map(c => c.volume);

  const average = sma(
    volumes.slice(-21, -1),
    20
  );

  const current = volumes[volumes.length - 1];

  return {
    current,
    average,
    ratio: average > 0 ? current / average : null
  };
}


/* =========================================
   MAIN SIGNAL ENGINE
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
  const levels = findLevels(candles);
  const volume = analyzeVolume(candles);
  const pattern = detectPattern(candles);

  let bullish = 0;
  let bearish = 0;

  const evidence = [];

  if (ema20 !== null && ema50 !== null) {
    if (ema20 > ema50) {
      bullish++;
      evidence.push("EMA20 above EMA50");
    } else {
      bearish++;
      evidence.push("EMA20 below EMA50");
    }
  }

  if (ema50 !== null && ema200 !== null) {
    if (ema50 > ema200) {
      bullish++;
      evidence.push("EMA50 above EMA200");
    } else {
      bearish++;
      evidence.push("EMA50 below EMA200");
    }
  }

  if (rsi !== null) {
    if (rsi > 52 && rsi < 70) {
      bullish++;
      evidence.push("RSI bullish zone");
    } else if (rsi < 48 && rsi > 30) {
      bearish++;
      evidence.push("RSI bearish zone");
    }
  }

  if (macd) {
    if (macd.histogram > 0) {
      bullish++;
      evidence.push("MACD histogram positive");
    } else if (macd.histogram < 0) {
      bearish++;
      evidence.push("MACD histogram negative");
    }
  }

  if (ema20 !== null) {
    if (price > ema20) {
      bullish++;
      evidence.push("Price above EMA20");
    } else {
      bearish++;
      evidence.push("Price below EMA20");
    }
  }

  if (pattern === "Bullish engulfing") {
    bullish++;
    evidence.push(pattern);
  }

  if (pattern === "Bearish engulfing") {
    bearish++;
    evidence.push(pattern);
  }

  let signal = "WAIT";

  if (
    bullish >= 4 &&
    bullish > bearish &&
    adx !== null &&
    adx >= 18
  ) {
    signal = "BUY";

  } else if (
    bearish >= 4 &&
    bearish > bullish &&
    adx !== null &&
    adx >= 18
  ) {
    signal = "SELL";
  }

  let stopLoss = null;
  let takeProfit1 = null;
  let takeProfit2 = null;
  let takeProfit3 = null;
  let riskDistance = null;

  if (signal !== "WAIT") {
    riskDistance = atr * 1.5;

    const percentage = riskDistance / price;

    if (
      !Number.isFinite(riskDistance) ||
      riskDistance <= 0 ||
      percentage < 0.001 ||
      percentage > 0.15
    ) {
      signal = "WAIT";

      evidence.push(
        "Setup rejected: stop distance outside safety limits"
      );

    } else if (signal === "BUY") {
      stopLoss = price - riskDistance;

      takeProfit1 = price + riskDistance;

      takeProfit2 =
        price + riskDistance * (2.5 / 1.5);

      takeProfit3 =
        price + riskDistance * (3.5 / 1.5);

    } else {
      stopLoss = price + riskDistance;

      takeProfit1 = price - riskDistance;

      takeProfit2 =
        price - riskDistance * (2.5 / 1.5);

      takeProfit3 =
        price - riskDistance * (3.5 / 1.5);
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
    levels,
    volume,
    pattern,
    stopLoss,
    takeProfit1,
    takeProfit2,
    takeProfit3,
    riskDistance,
    evidence
  };
}


/* =========================================
   DISPLAY ANALYSIS
========================================= */

function displayAnalysis(
  result,
  symbol,
  interval,
  market,
  candleInfo
) {
  const box = $("analysisResult");

  if (!box) return;

  const signalClass =
    result.signal === "BUY"
      ? "signal-buy"
      : result.signal === "SELL"
        ? "signal-sell"
        : "signal-wait";

  function metric(title, value) {
    return `
      <div class="metric">
        <span>${escapeHTML(title)}</span>
        <strong>${value}</strong>
      </div>
    `;
  }

  const bb = result.bollinger;
  const fib = result.levels.fibonacci;
  const volume = result.volume;
  const macd = result.macd;

  box.className = "analysis-result";

  box.innerHTML = `
    <div class="signal-banner">

      <p class="eyebrow">
        ${escapeHTML(symbol)} ·
        ${escapeHTML(interval)} ·
        ${escapeHTML(market.toUpperCase())}
      </p>

      <h3 class="${signalClass}">
        ${result.signal}
      </h3>

      <p>
        Reference price: $${money(result.price)}
      </p>

      <p class="muted-note">
        Last completed candle:
        ${new Date(candleInfo.lastCandleClose).toLocaleString()}
      </p>

      <p class="muted-note">
        Bullish factors: ${result.bullish} |
        Bearish factors: ${result.bearish}
      </p>

      <p class="muted-note">
        Evidence:
        ${result.evidence.map(escapeHTML).join(" · ") ||
          "No directional evidence"}
      </p>

    </div>

    <h3>Momentum and trend</h3>

    <div class="metrics">
      ${metric("RSI (14)", result.rsi?.toFixed(2) ?? "N/A")}
      ${metric("EMA 20", money(result.ema20))}
      ${metric("EMA 50", money(result.ema50))}
      ${metric("EMA 200", money(result.ema200))}
      ${metric("MACD line", money(macd?.line))}
      ${metric("MACD signal", money(macd?.signal))}
      ${metric("MACD histogram", money(macd?.histogram))}
      ${metric("ADX (14)", money(result.adx))}
      ${metric("ATR (14)", money(result.atr))}
      ${metric("Candlestick", escapeHTML(result.pattern))}
    </div>

    <h3>Volatility and volume</h3>

    <div class="metrics">
      ${metric("Bollinger upper", money(bb?.upper))}
      ${metric("Bollinger middle", money(bb?.middle))}
      ${metric("Bollinger lower", money(bb?.lower))}
      ${metric("Current volume", money(volume?.current))}
      ${metric("Previous 20-candle average", money(volume?.average))}
      ${metric("Volume ratio", volume?.ratio?.toFixed(2) ?? "N/A")}
    </div>

    <h3>Market structure · 100-candle swing range</h3>

    <div class="metrics">
      ${metric("Support / swing low", "$" + money(result.levels.support))}
      ${metric("Resistance / swing high", "$" + money(result.levels.resistance))}
      ${metric("Fib 23.6%", money(fib?.level236))}
      ${metric("Fib 38.2%", money(fib?.level382))}
      ${metric("Fib 50%", money(fib?.level500))}
      ${metric("Fib 61.8%", money(fib?.level618))}
      ${metric("Fib 78.6%", money(fib?.level786))}
    </div>

    <h3>Trade planning references</h3>

    ${
      result.signal === "WAIT"
        ? `<p class="muted-note">
             No valid trade setup. Entry, stop loss and targets
             are intentionally not provided.
           </p>`
        : `
          <div class="metrics">
            ${metric("Entry reference", "$" + money(result.price))}
            ${metric("Stop loss", "$" + money(result.stopLoss))}
            ${metric("Take profit 1", "$" + money(result.takeProfit1))}
            ${metric("Take profit 2", "$" + money(result.takeProfit2))}
            ${metric("Take profit 3", "$" + money(result.takeProfit3))}
            ${metric("Stop distance", "$" + money(result.riskDistance))}
            ${metric("Reward / risk to TP1", "1 : 1")}
          </div>
        `
    }

    <p class="disclaimer">
      Completed-candle technical analysis only.
      Estimates are not guaranteed predictions.
      No backtested win rate is claimed.
      This tool does not place trades.
    </p>
  `;
}


/* =========================================
   FREE ANALYSIS CREDITS
========================================= */

function getCredits() {
  let value = localStorage.getItem(CREDIT);

  if (value === null) return 4;

  value = Number(value);

  return Number.isFinite(value)
    ? Math.max(0, Math.min(4, Math.floor(value)))
    : 4;
}

function updateCredits() {
  const element = $("credits");

  if (element) {
    element.textContent = getCredits() + " / 4";
  }
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
    ? $("alertSymbol")?.value
    : $("symbol")?.value;

  const interval = isAlert
    ? $("alertInterval")?.value
    : $("interval")?.value;

  const market = isAlert
    ? "spot"
    : $("marketType")?.value;

  if (!symbol || !TF[interval]) {
    if (!isAlert) {
      toast("Select a valid asset and timeframe.");
    }

    return null;
  }

  const button = $("analyzeBtn");

  if (!isAlert && button) {
    button.disabled = true;
    button.textContent = "Analyzing…";
  }

  try {
    const candleInfo = await getCandles(
      symbol,
      interval,
      market
    );

    const result = analyzeCandles(
      candleInfo.candles
    );

    if (!isAlert) {
      localStorage.setItem(
        CREDIT,
        String(Math.max(0, getCredits() - 1))
      );

      updateCredits();

      displayAnalysis(
        result,
        symbol,
        interval,
        market,
        candleInfo
      );
    }

    return {
      ...result,
      candleInfo
    };

  } catch (error) {
    console.error("Analysis error:", error);

    if (!isAlert) {
      const box = $("analysisResult");

      if (box) {
        box.className = "analysis-empty";
        box.textContent =
          "Analysis stopped: " + error.message;
      }
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
    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) return;

    const context = new AudioContextClass();

    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.frequency.value = 880;
    gain.gain.value = 0.12;

    oscillator.start();

    setTimeout(() => {
      oscillator.stop();
      context.close();
    }, 300);

  } catch (error) {
    console.warn("Alert sound unavailable:", error);
  }
}

async function enableNotifications() {
  if (!("Notification" in window)) {
    toast("Notifications are not supported.");
    return;
  }

  try {
    const permission =
      await Notification.requestPermission();

    toast(
      permission === "granted"
        ? "Browser notifications enabled."
        : "Notification permission not granted."
    );

  } catch (_) {
    toast("Could not request notification permission.");
  }
}


/* =========================================
   ALERT HISTORY
========================================= */

function renderStoredAlerts() {
  const log = $("alertLog");

  if (!log) return;

  const entries = readJSON(LK, []);

  if (!entries.length) return;

  log.innerHTML = "";

  entries.slice(0, 10).forEach(entry => {
    const item = document.createElement("div");

    item.className = "alert-item";
    item.textContent = entry;

    log.appendChild(item);
  });
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
    try {
      new Notification("AGU Crypto Analyzer", {
        body: message
      });

    } catch (error) {
      console.warn("Notification error:", error);
    }
  }

  const entry =
    new Date().toLocaleString() + " — " + message;

  const entries = readJSON(LK, []);

  entries.unshift(entry);

  localStorage.setItem(
    LK,
    JSON.stringify(entries.slice(0, 10))
  );

  const log = $("alertLog");

  if (log) {
    if (log.querySelector(".muted-note")) {
      log.innerHTML = "";
    }

    const item = document.createElement("div");

    item.className = "alert-item";
    item.textContent = entry;

    log.prepend(item);

    while (log.children.length > 10) {
      log.lastElementChild.remove();
    }
  }
}


/* =========================================
   SMART MONITORING
========================================= */

async function monitorMarket() {
  if (!monitoring || alertBusy) return;

  alertBusy = true;

  try {
    const symbol = $("alertSymbol")?.value;
    const interval = $("alertInterval")?.value;

    const result = await runAnalysis(true);

    if (!result) return;

    const key = symbol + "_" + interval;

    if (result.signal !== "WAIT") {
      const state =
        result.signal + "_" +
        result.candleInfo.lastCandleClose;

      if (lastAlert[key] !== state) {
        sendAlert(
          symbol,
          interval,
          result.signal,
          result.price
        );

        lastAlert[key] = state;

        localStorage.setItem(
          AK,
          JSON.stringify(lastAlert)
        );
      }
    }

    const status = $("alertStatus");

    if (status) {
      status.textContent =
        "Monitoring active. Last completed candle checked: " +
        new Date(
          result.candleInfo.lastCandleClose
        ).toLocaleString() + ".";
    }

  } catch (error) {
    console.warn("Monitoring error:", error);

  } finally {
    alertBusy = false;
  }
}

function startMonitoring() {
  const button = $("monitorBtn");
  const status = $("alertStatus");

  if (monitoring) {
    monitoring = false;

    clearInterval(monitorTimer);
    monitorTimer = null;

    if (button) {
      button.textContent = "Start monitoring";
    }

    if (status) {
      status.textContent = "Monitoring is off.";
    }

    return;
  }

  monitoring = true;

  if (button) {
    button.textContent = "Stop monitoring";
  }

  if (status) {
    status.textContent =
      "Monitoring every 60 seconds while this page remains open. " +
      "Fresh completed candles required.";
  }

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
  setConnection(
    "offline",
    "Browser reports no internet connection."
  );
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

  renderStoredAlerts();

  loadMarkets();

  $("refreshBtn")?.addEventListener(
    "click",
    loadMarkets
  );

  $("analyzeBtn")?.addEventListener(
    "click",
    () => runAnalysis(false)
  );

  $("notifyBtn")?.addEventListener(
    "click",
    enableNotifications
  );

  $("monitorBtn")?.addEventListener(
    "click",
    startMonitoring
  );

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./sw.js")
      .catch(error => {
        console.warn(
          "Service worker registration failed:",
          error
        );
      });
  }

  setInterval(loadMarkets, 60000);
});
