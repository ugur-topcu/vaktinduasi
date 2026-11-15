#!/usr/bin/env node
/* Vaktin Duası — Diyanet namaz vakitlerini resmî servisten çekip düz JSON dosyalarına yazar.
 *
 * Kaynak: Diyanet İşleri Başkanlığı Namaz Vakti servisi (awqatsalah.diyanet.gov.tr).
 * Kimlik bilgileri yalnızca ortam değişkenlerinden okunur (GitHub Actions "Secrets");
 * depoya, çıktıya veya günlüğe yazılmaz.
 *
 * Çıktı (OUT_DIR, varsayılan "vakitler"):
 *   yerler.json        { kaynak, guncelleme, iller: [{ id, ad, ilceler: [{ id, ad }] }] }
 *   ilce/<id>.json     { id, ad, il, kaynak, guncelleme, gunler: { "YYYY-AA-GG": [imsak, güneş, öğle, ikindi, akşam, yatsı] } }
 *   durum.json         son çalışmanın özeti
 *
 * Servis kotalıdır (uç + parametre başına günde birkaç istek). Bu yüzden betik:
 *   - yer listesini 30 günde bir yeniler,
 *   - vakti güncel olan ilçeleri atlar, en eski olandan başlar,
 *   - kota veya ağ hatasında o ana kadar yazdıklarını koruyup durur; ertesi gün kaldığı yerden sürer.
 *
 * Ortam değişkenleri: DIYANET_EMAIL, DIYANET_PASSWORD (zorunlu); DIYANET_API, OUT_DIR,
 * MAX_REQUESTS (1300), DELAY_MS (250), FRESH_DAYS (6), MIN_HORIZON_DAYS (20), ULKE (TÜRKİYE).
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const env = process.env;
const API = (env.DIYANET_API || 'https://awqatsalah.diyanet.gov.tr').replace(/\/+$/, '');
const OUT = env.OUT_DIR || 'vakitler';
const MAX_REQUESTS = Number(env.MAX_REQUESTS || 1300);
const DELAY_MS = Number(env.DELAY_MS ?? 250);
const FRESH_DAYS = Number(env.FRESH_DAYS || 6);
const MIN_HORIZON_DAYS = Number(env.MIN_HORIZON_DAYS || 20);
const COUNTRY = env.ULKE || 'TÜRKİYE';
const SOURCE = 'Diyanet İşleri Başkanlığı Namaz Vakti servisi (awqatsalah.diyanet.gov.tr)';
const FIELDS = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];

class StopError extends Error {}
let token = null;
let requestCount = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...args) => console.log(...args);
const fold = (s) => String(s || '').toLocaleUpperCase('tr-TR').replace(/İ/g, 'I').replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ş/g, 'S').replace(/Ç/g, 'C').replace(/Ğ/g, 'G').replace(/[^A-Z0-9]/g, '');
const titleCase = (s) => String(s || '').trim().toLocaleLowerCase('tr-TR').replace(/(^|[\s\-(/.])(\p{L})/gu, (_, a, b) => a + b.toLocaleUpperCase('tr-TR'));
const todayIstanbul = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
const addDays = (day, n) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

async function readJson(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; } }
async function writeJson(file, value) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(value) + '\n', 'utf8'); }

async function http(method, route, body, auth = true) {
  if (requestCount >= MAX_REQUESTS) throw new StopError('Bu çalışma için istek sınırına ulaşıldı (' + MAX_REQUESTS + ').');
  requestCount++;
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && token) headers.Authorization = 'Bearer ' + token;
  let response;
  try {
    response = await fetch(API + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  } catch (error) {
    throw new StopError('Ağ hatası: ' + (error?.name || 'bilinmiyor'));
  }
  if (DELAY_MS) await sleep(DELAY_MS);
  return response;
}

async function login() {
  const email = env.DIYANET_EMAIL, password = env.DIYANET_PASSWORD;
  // Örnek proje "Auth/Login", kılavuz "/api/Auth/Login" yazıyor; ikisi de denenir.
  for (const route of ['/Auth/Login', '/api/Auth/Login']) {
    const response = await http('POST', route, { email, password }, false);
    if (response.status === 404) continue;
    if (!response.ok) throw new Error('Giriş başarısız (HTTP ' + response.status + '). Kullanıcı adı ve şifreyi kontrol edin.');
    const json = await response.json().catch(() => null);
    const access = json?.data?.accessToken;
    if (!access) throw new Error('Giriş yanıtında erişim anahtarı yok.');
    token = access;
    return;
  }
  throw new Error('Giriş adresi bulunamadı.');
}

async function get(route) {
  let response = await http('GET', route);
  if (response.status === 401) { await login(); response = await http('GET', route); }
  if (response.status === 429 || response.status === 403) throw new StopError('Kota doldu veya erişim reddedildi (HTTP ' + response.status + '): ' + route);
  if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + route);
  const json = await response.json().catch(() => null);
  if (!json || json.success === false || json.data === undefined || json.data === null) throw new StopError('Beklenmeyen yanıt' + (json?.message ? ' (' + String(json.message).slice(0, 120) + ')' : '') + ': ' + route);
  return json.data;
}

function parseDay(row) {
  for (const key of ['gregorianDateLongIso8601', 'gregorianDateShortIso8601', 'gregorianDateShort']) {
    const value = String(row?.[key] || '').trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = /^(\d{2})[./-](\d{2})[./-](\d{4})/.exec(value);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return null;
}

function parseTimes(row) {
  const times = FIELDS.map((key) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(row?.[key] || '').trim()); return m && Number(m[1]) <= 23 && Number(m[2]) <= 59 ? m[1].padStart(2, '0') + ':' + m[2] : null; });
  if (times.some((t) => !t)) return null;
  const minutes = times.map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)));
  return minutes.every((v, i) => i === 0 || v > minutes[i - 1]) ? times : null;
}

async function loadPlaces(today) {
  const file = path.join(OUT, 'yerler.json');
  const current = await readJson(file);
  if (current?.iller?.length >= 81 && current.guncelleme && addDays(current.guncelleme.slice(0, 10), 30) >= today) return current;
  log('Yer listesi yenileniyor…');
  try {
    const countries = await get('/api/Place/Countries');
    const wanted = fold(COUNTRY);
    const country = countries.find((c) => [fold(c.name), fold(c.code)].some((v) => v === wanted || v === 'TURKIYE' || v === 'TURKEY' || v === 'TR'));
    if (!country) throw new Error('Ülke listesinde "' + COUNTRY + '" bulunamadı.');
    const states = await get('/api/Place/States/' + country.id);
    const iller = [];
    for (const state of states) {
      const cities = await get('/api/Place/Cities/' + state.id);
      iller.push({ id: state.id, ad: titleCase(state.name), ilceler: cities.map((c) => ({ id: c.id, ad: titleCase(c.name) })).sort((a, b) => a.ad.localeCompare(b.ad, 'tr')) });
    }
    iller.sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));
    const places = { kaynak: SOURCE, guncelleme: new Date().toISOString(), iller };
    await writeJson(file, places);
    log('Yer listesi yazıldı: ' + iller.length + ' il, ' + iller.reduce((n, il) => n + il.ilceler.length, 0) + ' ilçe.');
    return places;
  } catch (error) {
    if (current?.iller?.length) { log('Yer listesi yenilenemedi, eldeki liste kullanılıyor: ' + error.message); return current; }
    throw error;
  }
}

async function main() {
  if (!env.DIYANET_EMAIL || !env.DIYANET_PASSWORD) {
    log('DIYANET_EMAIL / DIYANET_PASSWORD tanımlı değil; eşitleme atlandı. (Diyanet erişimi açılınca depo ayarlarından "Secrets" olarak ekleyin.)');
    return 0;
  }
  const today = todayIstanbul();
  const status = { guncelleme: new Date().toISOString(), tamamlanan: 0, atlanan: 0, bekleyen: 0, hata: null };
  let failure = null;
  try {
    await login();
    const places = await loadPlaces(today);
    const queue = [];
    for (const il of places.iller) for (const ilce of il.ilceler) {
      const file = path.join(OUT, 'ilce', ilce.id + '.json');
      const existing = await readJson(file);
      const last = existing?.gunler ? Object.keys(existing.gunler).sort().pop() : null;
      const fresh = existing?.guncelleme && addDays(existing.guncelleme.slice(0, 10), FRESH_DAYS) > today && last && last >= addDays(today, MIN_HORIZON_DAYS);
      if (fresh) status.atlanan++;
      else queue.push({ il, ilce, file, existing, order: existing?.guncelleme || '' });
    }
    queue.sort((a, b) => a.order.localeCompare(b.order));
    status.bekleyen = queue.length;
    log(`İlçe sayısı: ${status.atlanan + queue.length}; güncel: ${status.atlanan}; indirilecek: ${queue.length}.`);
    for (const item of queue) {
      const rows = await get('/api/PrayerTime/Monthly/' + item.ilce.id);
      const gunler = {};
      for (const [day, times] of Object.entries(item.existing?.gunler || {})) if (day >= addDays(today, -1)) gunler[day] = times;
      let added = 0;
      for (const row of Array.isArray(rows) ? rows : []) { const day = parseDay(row), times = parseTimes(row); if (day && times) { gunler[day] = times; added++; } }
      if (!added) { log('Uyarı: geçerli vakit gelmedi, atlandı: ' + item.il.ad + ' / ' + item.ilce.ad); continue; }
      const sorted = Object.fromEntries(Object.keys(gunler).sort().map((k) => [k, gunler[k]]));
      await writeJson(item.file, { id: item.ilce.id, ad: item.ilce.ad, il: item.il.ad, kaynak: SOURCE, guncelleme: new Date().toISOString(), gunler: sorted });
      status.tamamlanan++;
      status.bekleyen--;
    }
  } catch (error) {
    failure = error;
    status.hata = error.message;
    log((error instanceof StopError ? 'Durduruldu: ' : 'Hata: ') + error.message);
  }
  status.istek = requestCount;
  await writeJson(path.join(OUT, 'durum.json'), status);
  log(`Bitti. Yazılan ilçe: ${status.tamamlanan}; bekleyen: ${status.bekleyen}; istek: ${requestCount}.`);
  // Kota/ağ kaynaklı duruşlar olağandır (ertesi gün sürer). Yalnızca hiç ilerleme olmadan gelen beklenmeyen hata başarısız sayılır.
  return failure && !(failure instanceof StopError) && status.tamamlanan === 0 ? 1 : 0;
}

main().then((code) => { process.exitCode = code; }, (error) => { console.error('Beklenmeyen hata: ' + (error?.message || error)); process.exitCode = 1; });
