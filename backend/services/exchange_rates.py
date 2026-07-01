import os
import time
import httpx
from dotenv import load_dotenv

load_dotenv()

CURRENCY_MAP = {
    'hollywood': {'code': 'USD', 'symbol': '$',  'country': 'United States'},
    'bollywood': {'code': 'INR', 'symbol': '₹',  'country': 'India'},
    'korean':    {'code': 'KRW', 'symbol': '₩',  'country': 'South Korea'},
    'japanese':  {'code': 'JPY', 'symbol': '¥',  'country': 'Japan'},
    'european':  {'code': 'EUR', 'symbol': '€',  'country': 'Europe'},
}

FALLBACK_RATES = {'USD': 1, 'INR': 84.5, 'KRW': 1360, 'JPY': 157, 'EUR': 0.93}

_cached_rates = None
_cache_expires = 0
_CACHE_TTL = 24 * 60 * 60  # 24h in seconds


async def _fetch_rates():
    key = os.getenv('EXCHANGE_RATE_API_KEY')
    if not key:
        return None
    url = f'https://v6.exchangerate-api.com/v6/{key}/latest/USD'
    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.get(url)
        res.raise_for_status()
        data = res.json()
        if data.get('result') != 'success':
            raise ValueError(f"exchangerate-api error: {data.get('error-type')}")
        return data['conversion_rates']


async def get_rate(currency_code):
    global _cached_rates, _cache_expires
    if currency_code == 'USD':
        return 1.0
    if not _cached_rates or time.time() > _cache_expires:
        try:
            rates = await _fetch_rates()
            if rates:
                _cached_rates = rates
                _cache_expires = time.time() + _CACHE_TTL
            else:
                _cached_rates = FALLBACK_RATES
                _cache_expires = time.time() + _CACHE_TTL
        except Exception as e:
            print(f'[rates] fetch failed, using fallback: {e}')
            _cached_rates = FALLBACK_RATES
            _cache_expires = time.time() + _CACHE_TTL
    return (_cached_rates or FALLBACK_RATES).get(currency_code, 1.0)


def format_usd(millions):
    if millions >= 1000:
        return f'${millions / 1000:.2f}B'
    return f'${millions:.1f}M'


def format_local(amount_local, currency_code, symbol):
    if currency_code == 'USD':
        m = amount_local / 1_000_000
        return f'{symbol}{m / 1000:.2f}B' if m >= 1000 else f'{symbol}{m:.1f}M'
    if currency_code in ('KRW', 'JPY'):
        return f'{symbol}{amount_local / 1_000_000_000:.1f}B'
    if currency_code == 'INR':
        return f'{symbol}{round(amount_local / 10_000_000)}Cr'
    if currency_code == 'EUR':
        m = amount_local / 1_000_000
        return f'{symbol}{m / 1000:.2f}B' if m >= 1000 else f'{symbol}{m:.1f}M'
    m = amount_local / 1_000_000
    return f'{symbol}{m:.1f}M'
